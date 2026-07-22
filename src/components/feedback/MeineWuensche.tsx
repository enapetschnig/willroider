/**
 * „Meine Änderungswünsche" — die Sicht des Melders.
 *
 * Bis jetzt verschwand ein abgeschickter Wunsch spurlos: es gab keinerlei
 * Ansicht der eigenen Einreichungen. Damit konnte eine Rückfrage den
 * Melder gar nicht erreichen. Hier sieht er Status, Verlauf und
 * beantwortet Rückfragen.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { FeedbackFaden } from "./FeedbackFaden";

type Wunsch = {
  id: string;
  text: string | null;
  kategorie: string;
  status: string;
  dringlichkeit: string | null;
  created_at: string;
  erstellt_von: string | null;
  offene_frage: boolean | null;
};

/** Was der Melder vom Verwaltungs-Status sehen soll — in seiner Sprache. */
const STATUS_MELDER: Record<string, { label: string; cls: string }> = {
  neu: { label: "Eingegangen", cls: "bg-blue-100 text-blue-800" },
  gesehen: { label: "Gesehen", cls: "bg-slate-100 text-slate-700" },
  sofort: { label: "Wird umgesetzt", cls: "bg-orange-100 text-orange-800" },
  besprechung: { label: "Wird besprochen", cls: "bg-violet-100 text-violet-800" },
  umgesetzt: { label: "Erledigt", cls: "bg-green-100 text-green-800" },
  abgelehnt: { label: "Nicht umgesetzt", cls: "bg-zinc-100 text-zinc-600" },
};

export function MeineWuensche({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Wunsch[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [offen, setOffen] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);

  const load = async () => {
    const { data } = await supabase
      .from("feedback" as any)
      .select("id, text, kategorie, status, dringlichkeit, created_at, erstellt_von, offene_frage")
      .eq("erstellt_von", userId)
      .order("created_at", { ascending: false });
    const list = (data as unknown as Wunsch[]) ?? [];
    setRows(list);
    // Namen aller Beteiligten (für den Faden)
    const { data: profs } = await supabase.from("profiles").select("id, vorname, nachname");
    setNamen(
      new Map(
        ((profs as any[]) ?? []).map((p) => [
          p.id,
          `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim() || "—",
        ]),
      ),
    );
    // Wunsch mit offener Rückfrage automatisch aufklappen — darum geht's.
    const frage = list.find((r) => r.offene_frage);
    if (frage) setOffen((cur) => cur ?? frage.id);
    setLaedt(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`meine-wuensche-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback", filter: `erstellt_von=eq.${userId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (laedt) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Du hast noch keinen Änderungswunsch geschickt.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const st = STATUS_MELDER[r.status] ?? STATUS_MELDER.neu;
        const auf = offen === r.id;
        return (
          <div
            key={r.id}
            className={`rounded-md border ${r.offene_frage ? "border-amber-400 bg-amber-50/50" : ""}`}
          >
            <button
              type="button"
              onClick={() => setOffen(auf ? null : r.id)}
              className="w-full text-left px-3 py-2.5 flex items-start gap-2"
            >
              {auf ? (
                <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <Badge className={`${st.cls} text-[10px]`}>{st.label}</Badge>
                  {r.offene_frage && (
                    <Badge className="bg-amber-500 text-white text-[10px] gap-1">
                      <HelpCircle className="h-3 w-3" />
                      Rückfrage — bitte antworten
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                    {new Date(r.created_at).toLocaleDateString("de-AT")}
                  </span>
                </div>
                <div className="text-sm line-clamp-2 break-words">
                  {r.text || "(Sprachnachricht)"}
                </div>
              </div>
            </button>
            {auf && (
              <div className="px-3 pb-3 border-t pt-2">
                <FeedbackFaden
                  feedbackId={r.id}
                  melderId={r.erstellt_von}
                  istAdmin={false}
                  namen={namen}
                  onGeaendert={load}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
