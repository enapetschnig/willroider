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
import { HeartPulse, Paperclip, Plus, Trash2, Loader2 } from "lucide-react";
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

function tageImRange(von: string, bis: string): number {
  const a = new Date(von + "T00:00:00").getTime();
  const b = new Date(bis + "T00:00:00").getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export function KrankmeldungenCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Krankmeldung[]>([]);
  const [doks, setDoks] = useState<Record<string, Dokument>>({});
  const [open, setOpen] = useState(false);

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
            <span className="text-sm font-semibold">Krankmeldungen</span>
          </div>
          <KrankmeldungDialog
            userId={userId}
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> Krankmeldung einreichen
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
                    ({tageImRange(k.von, k.bis)}{" "}
                    {tageImRange(k.von, k.bis) === 1 ? "Tag" : "Tage"})
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
      </CardContent>
    </Card>
  );
}

function KrankmeldungDialog({
  userId,
  open,
  onOpenChange,
  trigger,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger: React.ReactNode;
}) {
  const { toast } = useToast();
  const today = localIso();
  const [von, setVon] = useState(today);
  const [bis, setBis] = useState(today);
  const [notiz, setNotiz] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setVon(today);
      setBis(today);
      setNotiz("");
      setFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!von || !bis || bis < von) {
      toast({ variant: "destructive", title: "Ungültiges Datum" });
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
      const { error } = await supabase.from("krankmeldungen").insert({
        mitarbeiter_id: userId,
        von,
        bis,
        dokument_id: dokumentId,
        notiz: notiz.trim() || null,
      });
      if (error) {
        // Storage-Cleanup: hochgeladene Datei wieder entfernen
        if (dokumentId && storagePath) {
          try {
            await deleteMaDokument(dokumentId, storagePath);
          } catch {
            /* ignore */
          }
        }
        throw error;
      }
      toast({
        title: "Krankmeldung eingereicht",
        description: `${fmtDate(von)} – ${fmtDate(bis)}`,
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-red-500" />
            Krankmeldung einreichen
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
          <div>
            <Label className="text-sm">Krankenstandsbestätigung (optional)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                {file ? "Datei wechseln" : "Foto/PDF anhängen"}
              </Button>
              {file && (
                <div className="text-xs text-muted-foreground truncate flex-1">
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </div>
              )}
            </div>
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
            ⓘ Die Werktage im Zeitraum werden automatisch als <strong>krank</strong>{" "}
            in deiner Zeiterfassung markiert. Sa/So werden übersprungen.
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
            Einreichen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
