import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { generateBaustellenmeldungPdf } from "@/lib/baustellenmeldungPdf";
import { ShieldCheck, Save } from "lucide-react";
import type { Database, BaustellenStatus, EvaluierungTyp } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];

interface Props {
  initial?: Partial<Baustelle> | null;
  onSaved?: (id: string) => void;
  onCancel?: () => void;
}

export function BaustellenmeldungForm({ initial, onSaved, onCancel }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [partien, setPartien] = useState<Partie[]>([]);
  const [saving, setSaving] = useState(false);

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
  const [startDatum, setStartDatum] = useState(initial?.start_datum ?? "");
  const [endDatum, setEndDatum] = useState(initial?.end_datum ?? "");
  const [bauleiterId, setBauleiterId] = useState<string>(initial?.bauleiter_id ?? "");
  const [kostenstelle, setKostenstelle] = useState(initial?.kostenstelle ?? "");
  const [artBauarbeiten, setArtBauarbeiten] = useState(initial?.art_bauarbeiten ?? "");
  const [auftragssumme, setAuftragssumme] = useState<string>(
    initial?.auftragssumme != null ? String(initial.auftragssumme) : ""
  );
  const [anzahlMitarbeiter, setAnzahlMitarbeiter] = useState<string>(
    initial?.anzahl_mitarbeiter != null ? String(initial.anzahl_mitarbeiter) : ""
  );
  const [bautraeger, setBautraeger] = useState<boolean>(initial?.bautraeger === true);
  const [partieId, setPartieId] = useState<string>(initial?.partie_id ?? "");
  const [status, setStatus] = useState<BaustellenStatus>(initial?.status ?? "geplant");
  const [pflichtEval, setPflichtEval] = useState<"" | EvaluierungTyp>("");
  const [notizen, setNotizen] = useState(initial?.notizen ?? "");

  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("*").order("nachname"),
      supabase.from("partien").select("*").order("name"),
    ]).then(([p, pt]) => {
      setProfiles((p.data as Profile[]) ?? []);
      setPartien((pt.data as Partie[]) ?? []);
    });
  }, []);

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
      start_datum: startDatum || null,
      end_datum: endDatum || null,
      bauleiter_id: bauleiterId || null,
      kostenstelle: kostenstelle || null,
      art_bauarbeiten: artBauarbeiten || null,
      auftragssumme: auftragssumme ? Number(auftragssumme) : null,
      anzahl_mitarbeiter: anzahlMitarbeiter ? Number(anzahlMitarbeiter) : null,
      bautraeger,
      partie_id: partieId || null,
      status,
      notizen: notizen || null,
      created_by: user?.id ?? null,
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

    // Pflicht-Evaluierung anlegen, falls gewählt UND Partie zugewiesen
    if (pflichtEval && partieId && !savedRow.pflicht_evaluierung_id) {
      const { data: members } = await supabase
        .from("profiles")
        .select("id")
        .eq("partie_id", partieId)
        .eq("is_active", true);

      const { data: evalData, error: evalErr } = await supabase
        .from("evaluierungen")
        .insert({
          baustelle_id: id!,
          datum: startDatum || new Date().toISOString().slice(0, 10),
          typ: pflichtEval,
          vortragender_id: bauleiterId || user?.id || null,
          checkliste: {},
          abgeschlossen: false,
        } as any)
        .select()
        .single();

      if (!evalErr && evalData && members && members.length > 0) {
        const rows = members.map((m: any) => ({
          evaluierung_id: evalData.id,
          mitarbeiter_id: m.id,
        }));
        await supabase.from("evaluierung_unterschriften").insert(rows as any);
        await supabase
          .from("baustellen")
          .update({ pflicht_evaluierung_id: evalData.id })
          .eq("id", id!);
        toast({
          title: "Pflicht-Evaluierung angelegt",
          description: `${members.length} Mitarbeiter müssen unterschreiben.`,
        });
      }
    }

    // PDF generieren und hochladen
    const bauleiterName = bauleiterId
      ? (() => {
          const p = profiles.find((x) => x.id === bauleiterId);
          return p ? `${p.vorname} ${p.nachname}` : "";
        })()
      : "";
    const pdfBlob = generateBaustellenmeldungPdf({ ...savedRow, ...payload }, bauleiterName);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const path = `${id}/baustellenmeldung/baustellenmeldung_${dateStr}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("baustellen")
      .upload(path, pdfBlob, { contentType: "application/pdf", upsert: true });

    if (!upErr) {
      await supabase.from("dokumente").insert({
        baustelle_id: id!,
        ordner: "baustellenmeldung",
        dateiname: `Baustellenmeldung ${bvhName} ${dateStr}.pdf`,
        storage_path: path,
        mimetype: "application/pdf",
        groesse: pdfBlob.size,
        hochgeladen_von: user?.id ?? null,
      } as any);
    }

    toast({
      title: initial?.id ? "Baustelle aktualisiert" : "Baustelle angelegt",
      description: "PDF im Ordner Baustellenmeldung abgelegt.",
    });
    setSaving(false);
    onSaved?.(id!);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Empfänger-Header */}
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

      {/* Stamm-Felder im Stil der docx */}
      <div className="space-y-3">
        <Field label="Bauvorhaben *">
          <Input value={bvhName} onChange={(e) => setBvhName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Bauherr">
          <Input value={bauherr} onChange={(e) => setBauherr(e.target.value)} />
        </Field>
        <Field label="Baustellenanschrift">
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
        <Field label="Wohnanschrift Bauherr">
          <Input
            value={bauherrAdresse}
            onChange={(e) => setBauherrAdresse(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Baubeginn">
            <Input
              type="date"
              value={startDatum}
              onChange={(e) => setStartDatum(e.target.value)}
            />
          </Field>
          <Field label="Vorraussichtl. Ende">
            <Input
              type="date"
              value={endDatum}
              onChange={(e) => setEndDatum(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Verantwortlicher Bauleiter / § 9 VStG-Beauftragter">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Erfasst unter (Kostenstelle)">
            <Input
              value={kostenstelle}
              onChange={(e) => setKostenstelle(e.target.value)}
              placeholder="z.B. KS-2026-001"
            />
          </Field>
          <Field label="Art der Bauarbeiten">
            <Input
              value={artBauarbeiten}
              onChange={(e) => setArtBauarbeiten(e.target.value)}
              placeholder="Holzfertighaus, Dachstuhl..."
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Auftragssumme ca. (EUR)">
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
      </div>

      {/* Partie + Pflicht-Evaluierung */}
      <Card className="border-primary/30">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Zuordnung &amp; Sicherheit
          </div>
          <Field label="Partie (Polier)">
            <select
              value={partieId}
              onChange={(e) => setPartieId(e.target.value)}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">— ohne Partie —</option>
              {partien.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pflicht-Evaluierung für die zugeordneten Mitarbeiter">
            <select
              value={pflichtEval}
              onChange={(e) => setPflichtEval(e.target.value as any)}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm"
              disabled={!partieId || !!initial?.pflicht_evaluierung_id}
            >
              <option value="">Keine</option>
              <option value="kurz">Kurzversion</option>
              <option value="lang">Langversion</option>
            </select>
            {pflichtEval && partieId && !initial?.pflicht_evaluierung_id && (
              <div className="text-[11px] text-muted-foreground mt-1">
                Mitarbeiter dieser Partie müssen die Evaluierung beim nächsten App-Öffnen
                unterschreiben.
              </div>
            )}
            {initial?.pflicht_evaluierung_id && (
              <div className="text-[11px] text-emerald-600 mt-1">
                Pflicht-Evaluierung bereits angelegt.
              </div>
            )}
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as BaustellenStatus)}
              className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="geplant">Geplant</option>
              <option value="aktiv">Aktiv</option>
              <option value="pausiert">Pausiert</option>
              <option value="abgeschlossen">Abgeschlossen</option>
            </select>
          </Field>
          <Field label="Notizen">
            <Textarea
              value={notizen}
              onChange={(e) => setNotizen(e.target.value)}
              rows={2}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 sticky bottom-0 bg-background pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Abbrechen
          </Button>
        )}
        <Button type="submit" disabled={saving} className="flex-1 h-11">
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Speichert…" : initial?.id ? "Speichern + PDF aktualisieren" : "Baustelle anlegen + PDF erstellen"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
