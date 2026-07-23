import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { pruefeEdgeAntwort } from "@/lib/edgeError";
import { useAuth } from "@/contexts/AuthContext";
import { generateBaustellenanlageDocx, DOCX_MIME } from "@/lib/baustellenanlageDocx";
import { Save, Mail, X } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { localIso } from "@/lib/dateFmt";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** Feste Empfänger der Baustellenmeldung — im Formular abwählbar/ergänzbar. */
const FESTE_EMPFAENGER = ["schneider@willroider.at", "maurer@willroider.at"];

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Blob → base64, blockweise gegen Stack-Overflow bei großen Dateien. */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

/** Sammel-Kostenstellen mit automatischer Nummernvergabe (<Basis>-<JJ><NN>). */
const SAMMEL_KST = [
  "1404020",
  "1404030",
  "1404040",
  "1404050",
  "1404060",
  "1404070",
];

interface Props {
  initial?: Partial<Baustelle> | null;
  onSaved?: (id: string) => void;
  onCancel?: () => void;
}

/**
 * Erfasst die Baustelle exakt nach der Vorlage „1.1 Baustellenanlage.docx".
 * Nur die 13 Originalfelder. Partie / Pflicht-Unterweisung etc. werden
 * danach in der BaustelleDetail-Seite (Team-Tab) zugeordnet.
 */
export function BaustellenmeldungForm({ initial, onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);
  const [versendend, setVersendend] = useState(false);
  /**
   * Empfänger der Baustellenmeldung. Die beiden festen sind vorausgewählt,
   * lassen sich aber abwählen; weitere kommen über das Feld darunter dazu.
   * Steht bewusst ÜBER dem Anlegen-Knopf: man sieht vor dem Absenden, wer
   * die Meldung bekommt, statt es hinterher in einem zweiten Dialog zu tun.
   */
  const [empfaengerListe, setEmpfaengerListe] = useState<
    { mail: string; aktiv: boolean }[]
  >(FESTE_EMPFAENGER.map((mail) => ({ mail, aktiv: true })));
  const [neueMail, setNeueMail] = useState("");
  const aktiveEmpfaenger = empfaengerListe.filter((e) => e.aktiv).map((e) => e.mail);

  const addEmpfaenger = () => {
    const m = neueMail.trim();
    if (!m) return;
    if (!MAIL_RE.test(m)) {
      toast({
        variant: "destructive",
        title: "Adresse ungültig",
        description: `„${m}" ist keine gültige E-Mail-Adresse.`,
      });
      return;
    }
    if (empfaengerListe.some((e) => e.mail.toLowerCase() === m.toLowerCase())) {
      toast({ title: "Adresse steht schon in der Liste" });
      setNeueMail("");
      return;
    }
    setEmpfaengerListe((l) => [...l, { mail: m, aktiv: true }]);
    setNeueMail("");
  };

  const [bvhName, setBvhName] = useState(initial?.bvh_name ?? "");
  const [bauherr, setBauherr] = useState(initial?.bauherr ?? "");
  const [adresse, setAdresse] = useState(initial?.baustellen_adresse ?? "");
  const [plz, setPlz] = useState(initial?.plz ?? "");
  const [ort, setOrt] = useState(initial?.ort ?? "");
  const [koordLat, setKoordLat] = useState<string>(
    initial?.koordinaten_lat != null ? String(initial.koordinaten_lat) : ""
  );
  const [koordLng, setKoordLng] = useState<string>(
    initial?.koordinaten_lng != null ? String(initial.koordinaten_lng) : ""
  );
  const [bauherrAdresse, setBauherrAdresse] = useState(initial?.bauherr_adresse ?? "");
  const [bauherrPlz, setBauherrPlz] = useState<string>((initial as any)?.bauherr_plz ?? "");
  const [bauherrOrt, setBauherrOrt] = useState<string>((initial as any)?.bauherr_ort ?? "");
  // Koordinaten sind optional (Karten-Pins) — standardmäßig eingeklappt.
  const [zeigeKoordinaten, setZeigeKoordinaten] = useState(
    !!(initial?.koordinaten_lat || initial?.koordinaten_lng),
  );
  const [startDatum, setStartDatum] = useState(initial?.start_datum ?? "");
  const [endDatum, setEndDatum] = useState(initial?.end_datum ?? "");
  const [bauleiterId, setBauleiterId] = useState<string>(initial?.bauleiter_id ?? "");
  const [kostenstelle, setKostenstelle] = useState(initial?.kostenstelle ?? "");

  /** Nächste freie Nummer für eine Sammel-Kostenstelle vergeben.
   *  Format: <Basis>-<JJ><NN>, z.B. 1404030-2603 (Jahr 26, laufende Nr. 03). */
  const vergebeNaechsteKst = async (basis: string) => {
    const jj = String(new Date().getFullYear()).slice(-2);
    const prefix = `${basis}-${jj}`;
    const { data } = await supabase
      .from("baustellen")
      .select("kostenstelle")
      .like("kostenstelle", `${prefix}%`);
    let maxNr = 0;
    ((data as { kostenstelle: string | null }[]) ?? []).forEach((r) => {
      const m = (r.kostenstelle ?? "").match(
        new RegExp(`^${basis}-${jj}(\\d{2})$`),
      );
      if (m) maxNr = Math.max(maxNr, parseInt(m[1], 10));
    });
    if (maxNr >= 99) {
      toast({
        variant: "destructive",
        title: "Nummernkreis voll",
        description: `Für ${prefix} sind alle Nummern bis 99 vergeben.`,
      });
      return;
    }
    const nn = String(maxNr + 1).padStart(2, "0");
    setKostenstelle(`${prefix}${nn}`);
  };
  const [artBauarbeiten, setArtBauarbeiten] = useState(initial?.art_bauarbeiten ?? "");
  const [auftragssumme, setAuftragssumme] = useState<string>(
    initial?.auftragssumme != null ? String(initial.auftragssumme) : ""
  );
  const [anzahlMitarbeiter, setAnzahlMitarbeiter] = useState<string>(
    initial?.anzahl_mitarbeiter != null ? String(initial.anzahl_mitarbeiter) : ""
  );
  const [bautraeger, setBautraeger] = useState<boolean>(initial?.bautraeger === true);
  const [besonderesAugenmerk, setBesonderesAugenmerk] = useState<string>(
    (initial as any)?.besonderes_augenmerk ?? "",
  );

  useEffect(() => {
    // Nur Bauleiter — sie sind im "Verantwortlicher Bauleiter"-Dropdown wählbar.
    // Der aktuell gesetzte Bauleiter wird zusätzlich geladen, falls er (aus
    // Altbestand) nicht (mehr) als Bauleiter markiert ist.
    supabase
      .from("profiles")
      .select("*")
      .eq("ist_bauleiter", true)
      .eq("is_active", true)
      .order("nachname")
      .then(async ({ data }) => {
        let list = (data as Profile[]) ?? [];
        const aktuell = initial?.bauleiter_id;
        if (aktuell && !list.some((p) => p.id === aktuell)) {
          const { data: extra } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", aktuell)
            .maybeSingle();
          if (extra) list = [extra as Profile, ...list];
        }
        setProfiles(list);
      });
  }, [initial?.bauleiter_id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bvhName.trim()) {
      toast({ variant: "destructive", title: "Bauvorhaben fehlt" });
      return;
    }
    setSaving(true);

    const payload: any = {
      bvh_name: bvhName.trim(),
      bauherr: bauherr || null,
      baustellen_adresse: adresse || null,
      plz: plz || null,
      ort: ort || null,
      koordinaten_lat: koordLat ? Number(koordLat) : null,
      koordinaten_lng: koordLng ? Number(koordLng) : null,
      bauherr_adresse: bauherrAdresse || null,
      bauherr_plz: bauherrPlz || null,
      bauherr_ort: bauherrOrt || null,
      start_datum: startDatum || null,
      end_datum: endDatum || null,
      bauleiter_id: bauleiterId || null,
      kostenstelle: kostenstelle || null,
      art_bauarbeiten: artBauarbeiten || null,
      auftragssumme: auftragssumme ? Number(auftragssumme) : null,
      anzahl_mitarbeiter: anzahlMitarbeiter ? Number(anzahlMitarbeiter) : null,
      bautraeger,
      besonderes_augenmerk: besonderesAugenmerk.trim() || null,
      created_by: user?.id ?? null,
      ...(initial?.id ? {} : { status: "geplant" }),
    };

    let id = initial?.id;
    let savedRow: Baustelle | null = null;
    if (id) {
      const { data, error } = await supabase
        .from("baustellen")
        .update(payload)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        setSaving(false);
        return;
      }
      savedRow = data as Baustelle;
    } else {
      const { data, error } = await supabase
        .from("baustellen")
        .insert(payload)
        .select()
        .single();
      if (error) {
        toast({ variant: "destructive", title: "Fehler", description: error.message });
        setSaving(false);
        return;
      }
      savedRow = data as Baustelle;
      id = savedRow.id;
    }

    // DOCX 1:1 aus dem Original-Template erzeugen und ablegen
    const bauleiterName = bauleiterId
      ? (() => {
          const p = profiles.find((x) => x.id === bauleiterId);
          return p ? `${p.vorname} ${p.nachname}` : "";
        })()
      : "";
    /** Frisch erzeugte DOCX für den Mailversand (base64, kein zweiter Download). */
    let docxFuerMail: { dateiname: string; base64: string; dokumentId?: string } | null = null;
    try {
      const docxBlob = await generateBaustellenanlageDocx(
        { ...savedRow, ...payload },
        bauleiterName
      );
      const dateStr = localIso().replace(/-/g, "");
      const path = `${id}/1-baustellenmanagement/baustellenanlage_${dateStr}.docx`;
      const { error: upErr } = await supabase.storage
        .from("baustellen")
        .upload(path, docxBlob, { contentType: DOCX_MIME, upsert: true });
      if (upErr) {
        // Datei nicht abgelegt → kein Doku-Eintrag, kein Mailversand, und
        // vor allem KEIN falsches „Erfolg". Der Nutzer weiß sonst nicht,
        // dass die DOCX fehlt.
        toast({
          variant: "destructive",
          title: "Baustelle gespeichert, aber DOCX-Ablage fehlgeschlagen",
          description: `${upErr.message} — Bitte die Baustellenmeldung später erneut speichern.`,
        });
      } else {
        const dateiname = `Baustellenanlage ${bvhName} ${dateStr}.docx`;
        // Pfad enthält nur Datum → beim mehrfachen Speichern am selben Tag
        // wird die Datei überschrieben (upsert). Deshalb den vorhandenen
        // dokumente-Eintrag AKTUALISIEREN statt jedes Mal einen neuen
        // anzulegen — sonst zeigten mehrere Zeilen auf dieselbe Datei.
        const { data: vorhanden } = await supabase
          .from("dokumente")
          .select("id")
          .eq("storage_path", path)
          .maybeSingle();
        let dokId = (vorhanden as any)?.id as string | undefined;
        if (dokId) {
          await supabase
            .from("dokumente")
            .update({ dateiname, groesse: docxBlob.size } as any)
            .eq("id", dokId);
        } else {
          const { data: dok, error: insErr } = await supabase
            .from("dokumente")
            .insert({
              baustelle_id: id!,
              ordner: "1-baustellenmanagement",
              dateiname,
              storage_path: path,
              mimetype: DOCX_MIME,
              groesse: docxBlob.size,
              hochgeladen_von: user?.id ?? null,
            } as any)
            .select("id")
            .single();
          if (insErr) console.error("Dokument-Eintrag:", insErr.message);
          dokId = (dok as any)?.id;
        }
        // Für den direkt anschließenden Mailversand merken. Die DOCX liegt
        // ohnehin schon im Speicher — kein erneuter Download nötig.
        if (aktiveEmpfaenger.length > 0) {
          docxFuerMail = { dateiname, base64: await blobToBase64(docxBlob), dokumentId: dokId };
        }
      }
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "DOCX-Erstellung fehlgeschlagen",
        description: err?.message ?? String(err),
      });
    }

    toast({
      title: initial?.id ? "Baustelle aktualisiert" : "Baustelle angelegt",
      description: docxFuerMail
        ? "Baustellenmeldung als DOCX im Ordner Baustellenanlage abgelegt."
        : "Gespeichert.",
    });

    // Versand direkt im Anschluss — die Empfänger stehen schon im Formular,
    // es braucht keinen zweiten Dialog. Ein Fehler beim Versand darf das
    // erfolgreiche Anlegen NICHT rückgängig machen; er wird nur gemeldet.
    if (aktiveEmpfaenger.length > 0 && docxFuerMail) {
      setVersendend(true);
      try {
        const antwort = await supabase.functions.invoke("dokument-versenden", {
          body: {
            empfaenger: aktiveEmpfaenger.join(", "),
            betreff: `Baustellenmeldung ${bvhName}`,
            text:
              `Hallo,\n\nim Anhang die Baustellenmeldung für „${bvhName}".\n\n` +
              `Mit freundlichen Grüßen`,
            attachments: [
              { filename: docxFuerMail.dateiname, contentBase64: docxFuerMail.base64 },
            ],
            dokumentIds: docxFuerMail.dokumentId ? [docxFuerMail.dokumentId] : [],
          },
        });
        // Echter Fehlertext statt „non-2xx status code"
        await pruefeEdgeAntwort(antwort);
        toast({
          title: "Baustellenmeldung versendet",
          description: `An ${aktiveEmpfaenger.join(", ")}.`,
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Mail nicht versendet",
          description: `${(e as Error).message} — Die Baustelle ist angelegt, die DOCX liegt im Ordner „Baustellenanlage" und kann dort von Hand verschickt werden.`,
        });
      } finally {
        setVersendend(false);
      }
    }

    setSaving(false);
    onSaved?.(id!);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Empfänger-Header (wie Vorlage oben) */}
      <Card className="border-2">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {["Lohnverrechnung", "Rechnungsprüfung", "Bauhof"].map((r) => (
              <div
                key={r}
                className="text-center text-[10px] sm:text-xs font-semibold border rounded py-2 bg-muted/40"
              >
                {r}
              </div>
            ))}
          </div>
          <div className="text-center text-base sm:text-lg font-bold">
            Baustellenmeldung Zimmerei Willroider
          </div>
        </CardContent>
      </Card>

      {/* Felder exakt in der Reihenfolge der Vorlage */}
      <div className="space-y-3">
        <Field label="Bauvorhaben *">
          <Input value={bvhName} onChange={(e) => setBvhName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Bauherr">
          <Input value={bauherr} onChange={(e) => setBauherr(e.target.value)} />
        </Field>

        {/* Wohnanschrift Bauherr — Straße / PLZ / Ort */}
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Wohnanschrift Bauherr
          </div>
          <Field label="Straße, Hausnummer">
            <Input
              value={bauherrAdresse}
              onChange={(e) => setBauherrAdresse(e.target.value)}
              placeholder="Straße, Hausnummer"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="PLZ">
              <Input value={bauherrPlz} onChange={(e) => setBauherrPlz(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Ort">
                <Input value={bauherrOrt} onChange={(e) => setBauherrOrt(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        {/* Baustellenanschrift — Straße / PLZ / Ort */}
        <div className="rounded-md border bg-muted/20 p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Baustellenanschrift
          </div>
          <Field label="Straße, Hausnummer">
            <Input
              value={adresse}
              onChange={(e) => setAdresse(e.target.value)}
              placeholder="Straße, Hausnummer"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="PLZ">
              <Input value={plz} onChange={(e) => setPlz(e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Ort">
                <Input value={ort} onChange={(e) => setOrt(e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Koordinaten optional — für Karten-Pins, standardmäßig eingeklappt */}
          <button
            type="button"
            onClick={() => setZeigeKoordinaten((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {zeigeKoordinaten ? "Koordinaten ausblenden" : "Koordinaten (optional, für Karte)"}
          </button>
          {zeigeKoordinaten && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Koordinaten Lat">
                <Input
                  inputMode="decimal"
                  value={koordLat}
                  onChange={(e) => setKoordLat(e.target.value)}
                  placeholder="46.6111"
                />
              </Field>
              <Field label="Koordinaten Lng">
                <Input
                  inputMode="decimal"
                  value={koordLng}
                  onChange={(e) => setKoordLng(e.target.value)}
                  placeholder="13.8558"
                />
              </Field>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Baubeginn">
            <Input type="date" value={startDatum} onChange={(e) => setStartDatum(e.target.value)} />
          </Field>
          <Field label="Vorraussichtl. Ende">
            <Input type="date" value={endDatum} onChange={(e) => setEndDatum(e.target.value)} />
          </Field>
        </div>
        <Field label="Verantwortlicher Bauleiter und Beauftragter im Sinne des § 9 VStG">
          <select
            value={bauleiterId}
            onChange={(e) => setBauleiterId(e.target.value)}
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">— wählen —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.vorname} {p.nachname}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Erfasst unter (Kostenstelle)">
          <Input
            value={kostenstelle}
            onChange={(e) => setKostenstelle(e.target.value)}
            placeholder="z.B. 1404030-2603"
          />
          {/* Sammel-Kostenstellen: Knopf vergibt automatisch die nächste
              freie Nummer im Format <Basis>-<JJ><NN> (z.B. 1404030-2603). */}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {SAMMEL_KST.map((basis) => (
              <button
                key={basis}
                type="button"
                onClick={() => vergebeNaechsteKst(basis)}
                className="text-[11px] px-2 py-1 rounded border bg-muted hover:bg-muted/70 font-mono"
                title={`Nächste freie Nummer für ${basis} vergeben`}
              >
                {basis}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Art der Bauarbeiten">
          <Input
            value={artBauarbeiten}
            onChange={(e) => setArtBauarbeiten(e.target.value)}
            placeholder="Holzfertighaus, Dachstuhl…"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Auftragssumme, ca. (EUR)">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={auftragssumme}
              onChange={(e) => setAuftragssumme(e.target.value)}
            />
          </Field>
          <Field label="Beschäftigte i. M.">
            <Input
              type="number"
              inputMode="numeric"
              value={anzahlMitarbeiter}
              onChange={(e) => setAnzahlMitarbeiter(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-md border">
          <Switch checked={bautraeger} onCheckedChange={setBautraeger} id="bautraeger" />
          <Label htmlFor="bautraeger" className="cursor-pointer flex-1">
            Bauvorhaben wird als <strong>Bauträger</strong> ausgeführt
          </Label>
        </div>
        <Field
          label="Besonderes Augenmerk"
          hint={'Wird dem Polier beim Bericht-Schreiben als Warnkarte oben angezeigt (z.B. „Vorsicht, schwacher Holzboden im 2. OG").'}
        >
          <Textarea
            value={besonderesAugenmerk}
            onChange={(e) => setBesonderesAugenmerk(e.target.value)}
            rows={2}
            placeholder="Hinweis, der bei jedem Bericht oben sichtbar wird"
          />
        </Field>

        {/* Empfänger — bewusst hier, direkt über den Knöpfen: man sieht vor
            dem Klick, wer die Meldung bekommt. Abwählen = geht nicht raus. */}
        <div className="rounded-md border p-3 bg-muted/20 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Mail className="h-4 w-4 text-primary" />
            Baustellenmeldung per Mail senden an
          </div>
          <div className="flex flex-wrap gap-1.5">
            {empfaengerListe.map((e, i) => {
              const fest = FESTE_EMPFAENGER.includes(e.mail);
              return (
                <span
                  key={e.mail}
                  className={`inline-flex items-center gap-1.5 rounded-full border pl-2 pr-1 py-1 text-xs transition ${
                    e.aktiv
                      ? "bg-primary/10 border-primary text-primary font-medium"
                      : "bg-background text-muted-foreground line-through"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setEmpfaengerListe((l) =>
                        l.map((x, xi) => (xi === i ? { ...x, aktiv: !x.aktiv } : x)),
                      )
                    }
                    title={e.aktiv ? "Nicht senden an diese Adresse" : "Wieder aktivieren"}
                  >
                    {e.mail}
                  </button>
                  {!fest && (
                    <button
                      type="button"
                      onClick={() =>
                        setEmpfaengerListe((l) => l.filter((_, xi) => xi !== i))
                      }
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`${e.mail} entfernen`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={neueMail}
              onChange={(ev) => setNeueMail(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault(); // sonst würde das Formular abschicken
                  addEmpfaenger();
                }
              }}
              placeholder="weitere E-Mail-Adresse…"
              className="h-9 text-sm"
              inputMode="email"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addEmpfaenger}
              disabled={!neueMail.trim()}
            >
              Hinzufügen
            </Button>
          </div>
          {aktiveEmpfaenger.length === 0 && (
            <div className="text-[11px] text-amber-700">
              Keine Adresse ausgewählt — die Baustelle wird nur angelegt, es
              geht keine Mail raus.
            </div>
          )}
        </div>
      </div>

      <div
        className="flex flex-col sm:flex-row gap-2 sticky bottom-0 bg-background pt-2 -mx-1 px-1"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 4px)" }}
      >
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Abbrechen
          </Button>
        )}
        <Button type="submit" disabled={saving} className="flex-1 h-11">
          <Save className="h-4 w-4 mr-2" />
          {versendend
            ? "Versendet…"
            : saving
              ? "Speichert…"
              : (initial?.id
                  ? "Speichern + DOCX aktualisieren"
                  : "Baustelle anlegen + DOCX erstellen") +
                (aktiveEmpfaenger.length > 0
                  ? " + an " + aktiveEmpfaenger.length + " senden"
                  : "")}
        </Button>
      </div>

    </form>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
