import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { HeartPulse, Paperclip, Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import {
  uploadMaDokument,
  getMaDokumentSignedUrl,
  deleteMaDokument,
} from "@/lib/maUpload";
import { localIso } from "@/lib/dateFmt";
import type { Database } from "@/integrations/supabase/types";

type Krankmeldung = Database["public"]["Tables"]["krankmeldungen"]["Row"];
type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/** Entwurf einer NEUEN Krankmeldung — überlebt, wenn das Handy die Seite
 *  beim Fotografieren neu lädt (J. Maurer 29.09.: „fliegt man aus dem
 *  Vorgang“). Gelöscht beim Einreichen oder Abbrechen. */
const ENTWURF_PREFIX = "krankmeldung-entwurf-";
interface Entwurf {
  von: string;
  bis: string;
  notiz: string;
  stundenModus: boolean;
  stundenWert: string;
  datei?: string;
}
function ladeEntwurf(userId: string): Entwurf | null {
  try {
    const roh = sessionStorage.getItem(ENTWURF_PREFIX + userId);
    return roh ? (JSON.parse(roh) as Entwurf) : null;
  } catch {
    return null;
  }
}
function speichereEntwurf(userId: string, e: Entwurf | null) {
  try {
    if (e) sessionStorage.setItem(ENTWURF_PREFIX + userId, JSON.stringify(e));
    else sessionStorage.removeItem(ENTWURF_PREFIX + userId);
  } catch {
    /* privater Modus o. Ä. — dann eben ohne Entwurf */
  }
}
/** Gibt es einen offenen Entwurf? (für „Mehr“ in der einfachen Ansicht) */
export function hatKrankmeldungEntwurf(): boolean {
  try {
    return Object.keys(sessionStorage).some((k) => k.startsWith(ENTWURF_PREFIX));
  } catch {
    return false;
  }
}

function tageImRange(von: string, bis: string): number {
  const a = new Date(von + "T00:00:00").getTime();
  const b = new Date(bis + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export function KrankmeldungenCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Krankmeldung[]>([]);
  const [doks, setDoks] = useState<Record<string, Dokument>>({});
  // Offener Entwurf nach einem Neuladen → Formular gleich wieder öffnen.
  const [open, setOpen] = useState(() => !!ladeEntwurf(userId));
  const [bearbeiten, setBearbeiten] = useState<Krankmeldung | null>(null);

  const load = async () => {
    const { data: items } = await supabase
      .from("krankmeldungen")
      .select("*")
      .eq("mitarbeiter_id", userId)
      .order("von", { ascending: false })
      .limit(10);
    const list = (items as Krankmeldung[]) ?? [];
    setItems(list);
    const dokIds = list.map((k) => k.dokument_id).filter((x): x is string => !!x);
    if (dokIds.length > 0) {
      const { data: d } = await supabase
        .from("dokumente")
        .select("*")
        .in("id", dokIds);
      const map: Record<string, Dokument> = {};
      (d ?? []).forEach((x: any) => (map[x.id] = x));
      setDoks(map);
    } else {
      setDoks({});
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`krank-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "krankmeldungen",
          filter: `mitarbeiter_id=eq.${userId}`,
        },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const openDokument = async (k: Krankmeldung) => {
    if (!k.dokument_id) return;
    const d = doks[k.dokument_id];
    if (!d) return;
    const url = await getMaDokumentSignedUrl(d.storage_path);
    if (url) window.open(url, "_blank");
  };

  const remove = async (k: Krankmeldung) => {
    if (!window.confirm("Krankmeldung wirklich löschen?")) return;
    try {
      // ERST die Krankmeldung in der DB löschen (mit Row-Count-Check),
      // damit das Attest bei einem Fehlschlag (z.B. RLS) nicht verloren geht.
      const { data: deleted, error } = await supabase
        .from("krankmeldungen")
        .delete()
        .eq("id", k.id)
        .select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        // RLS blockiert den Delete ohne Fehler → 0 Zeilen gelöscht
        toast({
          variant: "destructive",
          title: "Löschen nicht möglich",
          description: "Die Krankmeldung wurde nicht gelöscht (fehlende Berechtigung).",
        });
        return;
      }
      // NUR bei Erfolg: Attest-Dokument aus dem Storage entfernen
      const d = k.dokument_id ? doks[k.dokument_id] : null;
      if (d) {
        try {
          await deleteMaDokument(d.id, d.storage_path);
        } catch (storageErr) {
          // Storage-Fehler nicht eskalieren – die Krankmeldung ist bereits gelöscht
          console.error("Attest-Dokument konnte nicht gelöscht werden:", storageErr);
        }
      }
      toast({
        title: "Krankmeldung gelöscht",
        description: "Automatisch erzeugte Krank-Tage wurden entfernt.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <HeartPulse className="h-4 w-4 text-red-500" />
            <span className="text-sm font-semibold">Krankmeldung / Arzttermin</span>
          </div>
          <KrankmeldungDialog
            userId={userId}
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> Krankmeldung/Arzttermin
              </Button>
            }
          />
        </div>

        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Keine Krankmeldungen.
          </div>
        ) : (
          <div className="space-y-1.5">
            {items.map((k) => {
              const d = k.dokument_id ? doks[k.dokument_id] : null;
              return (
                <div
                  key={k.id}
                  className="flex items-center gap-2 text-sm bg-muted/30 rounded px-2 py-1.5"
                >
                  <span className="tabular-nums">
                    {fmtDate(k.von)} – {fmtDate(k.bis)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(k as any).stunden
                      ? `(${String((k as any).stunden).replace(".", ",")} Std.)`
                      : `(${tageImRange(k.von, k.bis)} ${tageImRange(k.von, k.bis) === 1 ? "Tag" : "Tage"})`}
                  </span>
                  {k.notiz && (
                    <span className="text-xs italic text-muted-foreground truncate max-w-[120px]">
                      „{k.notiz}"
                    </span>
                  )}
                  <span className="flex-1" />
                  {d && (
                    <button
                      type="button"
                      onClick={() => openDokument(k)}
                      className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
                      title={d.dateiname}
                    >
                      <Paperclip className="h-3 w-3" />
                      Datei
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBearbeiten(k)}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5"
                    title="Bearbeiten (Datum, Stunden, Notiz, Foto nachreichen)"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(k)}
                    className="text-red-700 hover:bg-red-50 rounded p-0.5"
                    title="Löschen"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {/* Bestehende Krankmeldung ändern — gleicher Dialog, vorbefüllt. */}
        <KrankmeldungDialog
          userId={userId}
          open={!!bearbeiten}
          onOpenChange={(v) => !v && setBearbeiten(null)}
          vorhanden={bearbeiten}
          vorhandenDok={bearbeiten?.dokument_id ? doks[bearbeiten.dokument_id] ?? null : null}
        />
      </CardContent>
    </Card>
  );
}

function KrankmeldungDialog({
  userId,
  open,
  onOpenChange: onOpenChangeRoh,
  trigger,
  vorhanden,
  vorhandenDok,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger?: React.ReactNode;
  /** Gesetzt = bestehende Krankmeldung bearbeiten statt neu einreichen. */
  vorhanden?: Krankmeldung | null;
  vorhandenDok?: Dokument | null;
}) {
  // Schließen (Abbrechen, X, Einreichen) verwirft den Entwurf.
  const onOpenChange = (v: boolean) => {
    if (!v && !vorhanden) speichereEntwurf(userId, null);
    onOpenChangeRoh(v);
  };
  const { toast } = useToast();
  const today = localIso();
  const [von, setVon] = useState(today);
  const [bis, setBis] = useState(today);
  const [notiz, setNotiz] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stundenweise (Arzttermin) — nur anbieten, wenn die DB-Spalte existiert
  // (Migration 20260825200000).
  const [stundenModus, setStundenModus] = useState(false);
  const [stundenWert, setStundenWert] = useState("2");
  const [stundenVerfuegbar, setStundenVerfuegbar] = useState(false);

  const [dateiFehlt, setDateiFehlt] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const entwurf = vorhanden ? null : ladeEntwurf(userId);
      const vStd = vorhanden ? Number((vorhanden as any).stunden) || 0 : 0;
      setVon(vorhanden?.von ?? entwurf?.von ?? today);
      setBis(vorhanden?.bis ?? entwurf?.bis ?? today);
      setNotiz(vorhanden?.notiz ?? entwurf?.notiz ?? "");
      setFile(null);
      setStundenModus(vorhanden ? vStd > 0 : entwurf?.stundenModus ?? false);
      setStundenWert(vStd > 0 ? String(vStd).replace(".", ",") : entwurf?.stundenWert ?? "2");
      // Nach einem Neuladen ist das gewählte Foto weg — darauf hinweisen.
      setDateiFehlt(entwurf?.datei ?? null);
      supabase
        .from("krankmeldungen")
        .select("stunden" as "*")
        .limit(1)
        .then(({ error }) => setStundenVerfuegbar(!error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vorhanden?.id]);

  // Entwurf laufend sichern (nur bei neuen Meldungen).
  useEffect(() => {
    if (!open || vorhanden) return;
    speichereEntwurf(userId, {
      von,
      bis,
      notiz,
      stundenModus,
      stundenWert,
      datei: file?.name ?? dateiFehlt ?? undefined,
    });
  }, [open, vorhanden, userId, von, bis, notiz, stundenModus, stundenWert, file, dateiFehlt]);

  const stunden = Number(stundenWert.replace(",", ".")) || 0;
  const istStunden = stundenModus && stundenVerfuegbar && von === bis;

  const submit = async () => {
    if (!von || !bis || bis < von) {
      toast({ variant: "destructive", title: "Ungültiges Datum" });
      return;
    }
    if (istStunden && (stunden <= 0 || stunden > 24)) {
      toast({ variant: "destructive", title: "Bitte eine Stundenzahl zwischen 0,5 und 24 angeben" });
      return;
    }
    setBusy(true);
    try {
      let dokumentId: string | null = null;
      let storagePath: string | null = null;
      if (file) {
        const r = await uploadMaDokument({
          mitarbeiterId: userId,
          subpath: "krankmeldungen",
          file,
          ordnerLabel: "krankmeldung",
          notiz: notiz.trim() || undefined,
        });
        dokumentId = r.dokumentId;
        storagePath = r.storagePath;
      }
      let error: { message: string } | null = null;
      if (vorhanden) {
        // Bearbeiten: Die Datenbank bucht die Krank-Stunden im Tätigkeits-
        // bericht selbst um, wenn sich Datum oder Stunden ändern.
        const { data: geaendert, error: upErr } = await supabase
          .from("krankmeldungen")
          .update({
            von,
            bis,
            stunden: istStunden ? stunden : null,
            dokument_id: dokumentId ?? vorhanden.dokument_id,
            notiz: notiz.trim() || null,
          } as any)
          .eq("id", vorhanden.id)
          .select("id");
        error =
          upErr ??
          (!geaendert || geaendert.length === 0
            ? { message: "Die Krankmeldung konnte nicht geändert werden (fehlende Berechtigung)." }
            : null);
      } else {
        const { error: insErr } = await supabase.from("krankmeldungen").insert({
          mitarbeiter_id: userId,
          von,
          bis,
          ...(istStunden ? { stunden } : {}),
          dokument_id: dokumentId,
          notiz: notiz.trim() || null,
        } as any);
        error = insErr;
      }
      if (error) {
        // Storage-Cleanup: hochgeladene Datei wieder entfernen
        if (dokumentId && storagePath) {
          try {
            await deleteMaDokument(dokumentId, storagePath);
          } catch {
            /* ignore */
          }
        }
        throw new Error(error.message);
      }
      // Foto ersetzt → das alte Dokument aufräumen.
      if (vorhanden && dokumentId && vorhandenDok) {
        try {
          await deleteMaDokument(vorhandenDok.id, vorhandenDok.storage_path);
        } catch {
          /* ignore */
        }
      }
      if (!vorhanden) speichereEntwurf(userId, null);
      toast({
        title: vorhanden
          ? "Krankmeldung geändert"
          : istStunden
            ? "Arzttermin eingetragen"
            : "Krankmeldung eingereicht",
        description: istStunden
          ? `${fmtDate(von)} · ${String(stunden).replace(".", ",")} Stunden`
          : `${fmtDate(von)} – ${fmtDate(bis)}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-red-500" />
            {vorhanden ? "Krankmeldung bearbeiten" : "Krankmeldung / Arzttermin"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-sm">Von</Label>
              <Input
                type="date"
                value={von}
                onChange={(e) => setVon(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm">Bis</Label>
              <Input
                type="date"
                value={bis}
                onChange={(e) => setBis(e.target.value)}
                min={von}
              />
            </div>
          </div>
          {stundenVerfuegbar && von === bis && (
            <label className="flex items-center gap-2 text-sm cursor-pointer rounded border px-3 py-2">
              <input
                type="checkbox"
                checked={stundenModus}
                onChange={(e) => setStundenModus(e.target.checked)}
                className="h-4 w-4"
              />
              <span>
                Nur stundenweise (z. B. Arzttermin)
                <span className="block text-[11px] text-muted-foreground">
                  Der restliche Tag bleibt normale Arbeitszeit
                </span>
              </span>
            </label>
          )}
          {istStunden && (
            <div>
              <Label className="text-sm">Stunden</Label>
              <Input
                inputMode="decimal"
                value={stundenWert}
                onChange={(e) => setStundenWert(e.target.value)}
                className="w-28"
              />
            </div>
          )}
          <div>
            <Label className="text-sm">Krankenstandsbestätigung (optional)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setDateiFehlt(null);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                {file || vorhandenDok ? "Datei wechseln" : "Foto/PDF anhängen"}
              </Button>
              {file ? (
                <div className="text-xs text-muted-foreground truncate flex-1">
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </div>
              ) : vorhandenDok ? (
                <div className="text-xs text-muted-foreground truncate flex-1">
                  Angehängt: {vorhandenDok.dateiname}
                </div>
              ) : null}
            </div>
            {dateiFehlt && !file && (
              <div className="text-[11px] text-amber-700 mt-1">
                Das Foto „{dateiFehlt}“ ist nicht angekommen — bitte noch einmal anhängen.
              </div>
            )}
            <div className="text-[11px] text-muted-foreground mt-1">
              Foto vom Handy, PDF oder Word.
            </div>
          </div>
          <div>
            <Label className="text-sm">Notiz (optional)</Label>
            <Textarea
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              rows={2}
              placeholder="z.B. Magen-Darm-Infekt"
            />
          </div>
          <div className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded p-2">
            {istStunden ? (
              <>
                ⓘ Es werden <strong>{String(stunden).replace(".", ",")} Stunden krank</strong>{" "}
                in deiner Zeiterfassung eingetragen — bereits erfasste Arbeitsstunden
                des Tages bleiben stehen.
              </>
            ) : (
              <>
                ⓘ Die Werktage im Zeitraum werden automatisch als <strong>krank</strong>{" "}
                in deiner Zeiterfassung markiert. Sa/So werden übersprungen.
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {vorhanden ? "Speichern" : "Einreichen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
