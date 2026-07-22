/**
 * Besprechungs-Modus für Änderungswünsche.
 *
 * Zweck: In der Besprechung EINEN Wunsch groß vor sich haben, ihn
 * gemeinsam ansehen und sofort entscheiden — ohne durch eine Liste zu
 * scrollen. Ein Wunsch pro Ansicht, Fortschritt oben, Entscheidung unten.
 * Notizen und Screenshots landen im selben Faden wie Rückfragen.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Zap,
  UsersRound,
  Paperclip,
  Mic,
  Loader2,
} from "lucide-react";
import { FeedbackFaden } from "@/components/feedback/FeedbackFaden";

export type BesprechungsWunsch = {
  id: string;
  text: string | null;
  kategorie: string;
  status: string;
  dringlichkeit: string | null;
  created_at: string;
  erstellt_von: string | null;
  seiten_kontext: string | null;
  audio_pfad: string | null;
  audio_sekunden: number | null;
  anhang_pfad: string | null;
  anhang_name: string | null;
  anhang_typ: string | null;
};

const DRINGLICHKEIT: Record<string, { label: string; cls: string }> = {
  sofort: { label: "🔴 Dringend", cls: "border-red-300 text-red-800 bg-red-50" },
  normal: { label: "🟡 Normal", cls: "border-amber-300 text-amber-800 bg-amber-50" },
  besprechen: { label: "💬 Zuerst besprechen", cls: "border-violet-300 text-violet-800 bg-violet-50" },
  irgendwann: { label: "💡 Nur eine Idee", cls: "border-slate-300 text-slate-600 bg-slate-50" },
};

const STATUS_LABEL: Record<string, string> = {
  neu: "Neu",
  gesehen: "Gesehen",
  sofort: "Sofort umsetzen",
  besprechung: "Zur Besprechung",
  umgesetzt: "Umgesetzt",
  abgelehnt: "Abgelehnt",
};

export function BesprechungsModus({
  open,
  onOpenChange,
  wuensche,
  namen,
  onGeaendert,
  darfSofort = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  wuensche: BesprechungsWunsch[];
  namen: Map<string, string>;
  onGeaendert: () => void;
  /** „Sofort umsetzen" ist Führung/Büro vorbehalten. */
  darfSofort?: boolean;
}) {
  const { toast } = useToast();
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [medien, setMedien] = useState<Map<string, string>>(new Map());
  /** Was in dieser Sitzung schon entschieden wurde — für den Abschluss. */
  const [erledigt, setErledigt] = useState<Set<string>>(new Set());

  const aktuell = wuensche[idx];

  useEffect(() => {
    if (open) {
      setIdx(0);
      setErledigt(new Set());
    }
  }, [open]);

  // Signierte URLs für Bild-/Audio-Anhänge des aktuellen Wunsches
  useEffect(() => {
    if (!aktuell) return;
    (async () => {
      const m = new Map<string, string>();
      if (aktuell.anhang_pfad) {
        const { data } = await supabase.storage
          .from("feedback-dateien")
          .createSignedUrl(aktuell.anhang_pfad, 3600);
        if (data?.signedUrl) m.set("anhang", data.signedUrl);
      }
      if (aktuell.audio_pfad) {
        const { data } = await supabase.storage
          .from("feedback-audio")
          .createSignedUrl(aktuell.audio_pfad, 3600);
        if (data?.signedUrl) m.set("audio", data.signedUrl);
      }
      setMedien(m);
    })();
  }, [aktuell?.id]);

  const setzeStatus = async (status: string) => {
    if (!aktuell || busy) return;
    setBusy(true);
    const { error } = await supabase
      .from("feedback" as any)
      .update({ status })
      .eq("id", aktuell.id);
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    setErledigt((s) => new Set(s).add(aktuell.id));
    onGeaendert();
    // Automatisch zum nächsten — das ist der Rhythmus einer Besprechung.
    if (idx < wuensche.length - 1) setIdx(idx + 1);
    else
      toast({
        title: "Alle durch",
        description: `${wuensche.length} ${wuensche.length === 1 ? "Wunsch" : "Wünsche"} besprochen.`,
      });
  };

  const fortschritt = useMemo(
    () => (wuensche.length === 0 ? 0 : ((idx + 1) / wuensche.length) * 100),
    [idx, wuensche.length],
  );

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <UsersRound className="h-5 w-5 text-primary" />
            Besprechung
            <span className="text-sm font-normal text-muted-foreground ml-auto tabular-nums">
              {wuensche.length === 0 ? "0 von 0" : `${idx + 1} von ${wuensche.length}`}
              {erledigt.size > 0 && ` · ${erledigt.size} entschieden`}
            </span>
          </DialogTitle>
          <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${fortschritt}%` }}
            />
          </div>
        </DialogHeader>

        {!aktuell ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Keine Wünsche für die Besprechung. Alles erledigt. 🎉
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-3">
            {/* Kopf des Wunsches */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={DRINGLICHKEIT[aktuell.dringlichkeit ?? "normal"]?.cls}>
                {DRINGLICHKEIT[aktuell.dringlichkeit ?? "normal"]?.label}
              </Badge>
              <Badge variant="outline">{STATUS_LABEL[aktuell.status] ?? aktuell.status}</Badge>
              {erledigt.has(aktuell.id) && (
                <Badge className="bg-green-100 text-green-800">in dieser Runde entschieden</Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {namen.get(aktuell.erstellt_von ?? "") ?? "Unbekannt"} ·{" "}
                {new Date(aktuell.created_at).toLocaleDateString("de-AT")}
              </span>
            </div>

            {/* Der Wunsch — groß genug zum gemeinsamen Lesen */}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-base leading-relaxed whitespace-pre-wrap break-words">
                {aktuell.text || <span className="italic text-muted-foreground">(nur Sprachnachricht)</span>}
              </div>
              {aktuell.seiten_kontext && (
                <div className="text-[11px] text-muted-foreground mt-2">
                  Seite: {aktuell.seiten_kontext}
                </div>
              )}
            </div>

            {medien.get("audio") && (
              <div className="flex items-center gap-2 rounded-md border px-2.5 py-2">
                <Mic className="h-4 w-4 text-primary shrink-0" />
                <audio controls src={medien.get("audio")} className="h-8 flex-1" />
              </div>
            )}
            {medien.get("anhang") && (
              <div>
                {aktuell.anhang_typ?.startsWith("image/") ? (
                  <a href={medien.get("anhang")} target="_blank" rel="noreferrer">
                    <img
                      src={medien.get("anhang")}
                      alt={aktuell.anhang_name ?? "Anhang"}
                      className="max-h-72 rounded-md border object-contain"
                    />
                  </a>
                ) : (
                  <a
                    href={medien.get("anhang")}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs hover:bg-muted"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-primary" />
                    {aktuell.anhang_name ?? "Anhang öffnen"}
                  </a>
                )}
              </div>
            )}

            {/* Notizen, Rückfragen, Screenshots — im Faden */}
            <div className="border-t pt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Notizen &amp; Rückfragen
              </div>
              <FeedbackFaden
                feedbackId={aktuell.id}
                melderId={aktuell.erstellt_von}
                istAdmin
                namen={namen}
                onGeaendert={onGeaendert}
              />
            </div>
          </div>
        )}

        {/* Entscheidung + Navigation */}
        {aktuell && (
          <div className="border-t p-3 space-y-2 shrink-0 bg-card">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <Button
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 h-10"
                disabled={busy || !darfSofort}
                title={darfSofort ? "Für die Umsetzung freigeben" : "Nur Geschäftsführung/Büro"}
                onClick={() => setzeStatus("sofort")}
              >
                <Zap className="h-4 w-4 mr-1.5" /> Freigeben
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-violet-700 border-violet-300 h-10"
                disabled={busy}
                onClick={() => setzeStatus("besprechung")}
              >
                <UsersRound className="h-4 w-4 mr-1.5" /> Vertagen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-green-700 border-green-300 h-10"
                disabled={busy}
                onClick={() => setzeStatus("umgesetzt")}
              >
                <Check className="h-4 w-4 mr-1.5" /> Erledigt
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive border-destructive/40 h-10"
                disabled={busy}
                onClick={() => setzeStatus("abgelehnt")}
              >
                <X className="h-4 w-4 mr-1.5" /> Ablehnen
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={idx === 0}
                onClick={() => setIdx(idx - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Zurück
              </Button>
              {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={idx >= wuensche.length - 1}
                onClick={() => setIdx(idx + 1)}
              >
                Überspringen <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
