import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FileText, ExternalLink } from "lucide-react";
import { getMaDokumentSignedUrl } from "@/lib/maUpload";
import type { Database } from "@/integrations/supabase/types";

type Lohnzettel = Database["public"]["Tables"]["lohnzettel"]["Row"];
type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];

const MONATE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

function fmtMonatJahr(l: Lohnzettel): string {
  if (l.monat && l.jahr) return `${MONATE[l.monat - 1]} ${l.jahr}`;
  if (l.titel) return l.titel;
  return new Date(l.hochgeladen_am).toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtRelativ(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return "heute";
  if (days < 2) return "gestern";
  if (days < 31) return `vor ${days} Tagen`;
  const months = Math.floor(days / 30);
  if (months < 12) return `vor ${months} ${months === 1 ? "Monat" : "Monaten"}`;
  const years = Math.floor(days / 365);
  return `vor ${years} ${years === 1 ? "Jahr" : "Jahren"}`;
}

export function LohnzettelCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Lohnzettel[]>([]);
  const [doks, setDoks] = useState<Record<string, Dokument>>({});

  const load = async () => {
    const { data } = await supabase
      .from("lohnzettel")
      .select("*")
      .eq("mitarbeiter_id", userId)
      .order("jahr", { ascending: false })
      .order("monat", { ascending: false })
      .order("hochgeladen_am", { ascending: false })
      .limit(12);
    const list = (data as Lohnzettel[]) ?? [];
    setItems(list);
    const dokIds = list.map((l) => l.dokument_id);
    if (dokIds.length > 0) {
      const { data: d } = await supabase
        .from("dokumente")
        .select("*")
        .in("id", dokIds);
      const map: Record<string, Dokument> = {};
      (d ?? []).forEach((x: any) => (map[x.id] = x));
      setDoks(map);
    }
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`lohn-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lohnzettel",
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

  const open = async (l: Lohnzettel) => {
    const d = doks[l.dokument_id];
    if (!d) return;
    const url = await getMaDokumentSignedUrl(d.storage_path);
    if (!url) {
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Datei konnte nicht geöffnet werden",
      });
      return;
    }
    window.open(url, "_blank");
    // Als gelesen markieren wenn noch nicht
    if (!l.gelesen_am) {
      await supabase
        .from("lohnzettel")
        .update({ gelesen_am: new Date().toISOString() })
        .eq("id", l.id);
    }
  };

  const ungelesen = items.filter((l) => !l.gelesen_am).length;

  if (items.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Lohnzettel</span>
          </div>
          {ungelesen > 0 && (
            <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary">
              {ungelesen} neu
            </Badge>
          )}
        </div>
        <div className="space-y-1">
          {items.slice(0, 6).map((l) => {
            const istNeu = !l.gelesen_am;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => open(l)}
                className={`w-full flex items-center gap-2 text-sm rounded px-2 py-1.5 text-left transition ${
                  istNeu ? "bg-primary/5 hover:bg-primary/10" : "bg-muted/30 hover:bg-muted/50"
                }`}
              >
                {istNeu && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                )}
                <span className={istNeu ? "font-medium" : ""}>
                  {fmtMonatJahr(l)}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {fmtRelativ(l.hochgeladen_am)}
                </span>
                <span className="flex-1" />
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            );
          })}
        </div>
        {items.length > 6 && (
          <div className="text-[11px] text-muted-foreground text-center">
            {items.length - 6} ältere Lohnzettel nicht angezeigt
          </div>
        )}
      </CardContent>
    </Card>
  );
}
