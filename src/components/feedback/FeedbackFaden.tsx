/**
 * Gesprächs-Faden zu einem Änderungswunsch.
 *
 * Dieselbe Komponente für beide Seiten:
 *  - Verwaltung: Rückfrage stellen, interne Notiz, Screenshot anhängen
 *  - Melder:     Rückfrage beantworten, Screenshot nachreichen
 * Was intern ist, sieht der Melder nie (RLS + Filter hier).
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Send,
  Paperclip,
  X,
  HelpCircle,
  Lock,
  MessageSquare,
} from "lucide-react";

export type Kommentar = {
  id: string;
  feedback_id: string;
  autor_id: string | null;
  text: string | null;
  ist_frage: boolean;
  ist_intern: boolean;
  anhang_pfad: string | null;
  anhang_name: string | null;
  anhang_typ: string | null;
  created_at: string;
};

const fmt = (s: string) =>
  new Date(s).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function FeedbackFaden({
  feedbackId,
  melderId,
  istAdmin,
  namen,
  onGeaendert,
}: {
  feedbackId: string;
  /** Wer den Wunsch eingereicht hat — für „von mir"/„von der Verwaltung". */
  melderId: string | null;
  istAdmin: boolean;
  namen: Map<string, string>;
  onGeaendert?: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<Kommentar[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [text, setText] = useState("");
  const [alsFrage, setAlsFrage] = useState(false);
  const [alsIntern, setAlsIntern] = useState(false);
  const [datei, setDatei] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [laedt, setLaedt] = useState(true);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("feedback_kommentare" as any)
      .select("*")
      .eq("feedback_id", feedbackId)
      .order("created_at");
    const list = (data as unknown as Kommentar[]) ?? [];
    setItems(list);
    // Signierte URLs für Anhänge (privater Bucket, 1 h)
    const m = new Map<string, string>();
    await Promise.all(
      list
        .filter((k) => k.anhang_pfad)
        .map(async (k) => {
          const { data: s } = await supabase.storage
            .from("feedback-dateien")
            .createSignedUrl(k.anhang_pfad!, 3600);
          if (s?.signedUrl) m.set(k.id, s.signedUrl);
        }),
    );
    setUrls(m);
    setLaedt(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`fk-${feedbackId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "feedback_kommentare",
          filter: `feedback_id=eq.${feedbackId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedbackId]);

  const senden = async () => {
    if (!text.trim() && !datei) return;
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        toast({ variant: "destructive", title: "Bitte neu anmelden." });
        return;
      }
      let pfad: string | null = null;
      if (datei) {
        if (datei.size > 10 * 1024 * 1024) {
          toast({ variant: "destructive", title: "Datei zu groß", description: "Maximal 10 MB." });
          return;
        }
        // Pfad MUSS mit der eigenen User-ID beginnen (Storage-Regel).
        const p = `${uid}/${crypto.randomUUID()}-${datei.name.replace(/[^\w.\-]/g, "_")}`;
        const { error } = await supabase.storage
          .from("feedback-dateien")
          .upload(p, datei, { contentType: datei.type, upsert: false });
        if (error) {
          toast({ variant: "destructive", title: "Anhang fehlgeschlagen", description: error.message });
          return;
        }
        pfad = p;
      }
      const { error } = await supabase.from("feedback_kommentare" as any).insert({
        feedback_id: feedbackId,
        autor_id: uid,
        text: text.trim() || null,
        ist_frage: istAdmin && alsFrage,
        ist_intern: istAdmin && alsIntern,
        anhang_pfad: pfad,
        anhang_name: datei?.name ?? null,
        anhang_typ: datei?.type ?? null,
      });
      if (error) {
        toast({ variant: "destructive", title: "Senden fehlgeschlagen", description: error.message });
        return;
      }
      setText("");
      setDatei(null);
      setAlsFrage(false);
      setAlsIntern(false);
      if (fileRef.current) fileRef.current.value = "";
      void load();
      onGeaendert?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {laedt ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lädt …
        </div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">
          Noch keine Rückfragen oder Notizen.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((k) => {
            const vonMelder = k.autor_id === melderId;
            return (
              <div
                key={k.id}
                className={`rounded-md border px-2.5 py-2 text-sm ${
                  k.ist_intern
                    ? "bg-slate-50 border-slate-300"
                    : k.ist_frage
                      ? "bg-amber-50 border-amber-300"
                      : vonMelder
                        ? "bg-background"
                        : "bg-primary/5 border-primary/30"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground">
                  {k.ist_intern && <Lock className="h-3 w-3" />}
                  {k.ist_frage && <HelpCircle className="h-3 w-3 text-amber-700" />}
                  <span className="font-semibold">
                    {namen.get(k.autor_id ?? "") ?? "Unbekannt"}
                  </span>
                  {k.ist_intern && <span className="text-slate-600">· interne Notiz</span>}
                  {k.ist_frage && <span className="text-amber-700">· Rückfrage</span>}
                  <span className="ml-auto tabular-nums">{fmt(k.created_at)}</span>
                </div>
                {k.text && <div className="whitespace-pre-wrap break-words">{k.text}</div>}
                {k.anhang_pfad && urls.get(k.id) && (
                  <div className="mt-1.5">
                    {k.anhang_typ?.startsWith("image/") ? (
                      <a href={urls.get(k.id)} target="_blank" rel="noreferrer">
                        <img
                          src={urls.get(k.id)}
                          alt={k.anhang_name ?? "Anhang"}
                          className="max-h-40 rounded border object-contain"
                        />
                      </a>
                    ) : (
                      <a
                        href={urls.get(k.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded border bg-muted/50 px-2 py-1 text-xs hover:bg-muted"
                      >
                        <Paperclip className="h-3 w-3" />
                        {k.anhang_name ?? "Anhang"}
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Schreiben */}
      <div className="space-y-1.5 pt-1">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={
            istAdmin
              ? "Rückfrage, Notiz oder Ergänzung …"
              : "Antwort schreiben …"
          }
          className="text-sm"
        />
        {datei && (
          <div className="flex items-center gap-1.5 text-xs bg-muted/50 rounded px-2 py-1">
            <Paperclip className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1">{datei.name}</span>
            <button
              onClick={() => {
                setDatei(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Anhang entfernen"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => setDatei(e.target.files?.[0] ?? null)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            title="Screenshot oder Datei anhängen"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
          {istAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  setAlsFrage((v) => !v);
                  if (!alsFrage) setAlsIntern(false);
                }}
                className={`text-xs px-2 py-1.5 rounded border transition ${
                  alsFrage
                    ? "bg-amber-100 border-amber-400 text-amber-900 font-semibold"
                    : "hover:bg-muted"
                }`}
                title="Der Melder bekommt einen roten Punkt und wird um Antwort gebeten"
              >
                <HelpCircle className="h-3.5 w-3.5 inline mr-1" />
                Als Rückfrage
              </button>
              <button
                type="button"
                onClick={() => {
                  setAlsIntern((v) => !v);
                  if (!alsIntern) setAlsFrage(false);
                }}
                className={`text-xs px-2 py-1.5 rounded border transition ${
                  alsIntern
                    ? "bg-slate-200 border-slate-400 text-slate-900 font-semibold"
                    : "hover:bg-muted"
                }`}
                title="Nur für die Verwaltung sichtbar — der Melder sieht das nie"
              >
                <Lock className="h-3.5 w-3.5 inline mr-1" />
                Nur intern
              </button>
            </>
          )}
          <Button
            size="sm"
            onClick={senden}
            disabled={busy || (!text.trim() && !datei)}
            className="ml-auto"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {alsFrage ? "Rückfrage senden" : "Senden"}
              </>
            )}
          </Button>
        </div>
        {istAdmin && alsFrage && (
          <div className="text-[10px] text-amber-800 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            Der Melder sieht einen roten Punkt, bis er geantwortet hat.
          </div>
        )}
      </div>
    </div>
  );
}
