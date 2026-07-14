import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  Bug,
  Heart,
  MessageCircle,
  Loader2,
  Check,
  Trash2,
  Eye,
  X,
} from "lucide-react";

type FeedbackRow = {
  id: string;
  erstellt_von: string | null;
  text: string;
  kategorie: string;
  seiten_kontext: string | null;
  app_version: string | null;
  status: string;
  admin_notiz: string | null;
  created_at: string;
};

const KAT: Record<string, { label: string; icon: typeof Lightbulb; cls: string }> = {
  idee: { label: "Idee", icon: Lightbulb, cls: "text-amber-700 border-amber-300 bg-amber-50" },
  problem: { label: "Problem", icon: Bug, cls: "text-red-700 border-red-300 bg-red-50" },
  lob: { label: "Lob", icon: Heart, cls: "text-pink-700 border-pink-300 bg-pink-50" },
  sonstiges: { label: "Sonstiges", icon: MessageCircle, cls: "text-slate-700 border-slate-300 bg-slate-50" },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  neu: { label: "Neu", cls: "bg-blue-100 text-blue-800" },
  gesehen: { label: "Gesehen", cls: "bg-slate-100 text-slate-700" },
  umgesetzt: { label: "Umgesetzt", cls: "bg-green-100 text-green-800" },
  abgelehnt: { label: "Abgelehnt", cls: "bg-zinc-100 text-zinc-500" },
};

type Filter = "offen" | "alle" | "umgesetzt";

export function AdminFeedback() {
  const { toast } = useToast();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("offen");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feedback" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ variant: "destructive", title: "Laden fehlgeschlagen", description: error.message });
      setLoading(false);
      return;
    }
    const list = (data as unknown as FeedbackRow[]) ?? [];
    setRows(list);
    // Namen der Ersteller nachladen
    const ids = Array.from(new Set(list.map((r) => r.erstellt_von).filter(Boolean))) as string[];
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, vorname, nachname")
        .in("id", ids);
      const m = new Map<string, string>();
      (profs ?? []).forEach((p: any) =>
        m.set(p.id, `${p.vorname ?? ""} ${p.nachname ?? ""}`.trim() || "—"),
      );
      setNamen(m);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("admin-feedback")
      .on("postgres_changes", { event: "*", schema: "public", table: "feedback" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (id: string, status: string) => {
    setBusyId(id);
    const { error } = await supabase.from("feedback" as any).update({ status }).eq("id", id);
    setBusyId(null);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
      return;
    }
    void load();
  };

  const remove = async (id: string) => {
    if (!confirm("Dieses Feedback endgültig löschen?")) return;
    setBusyId(id);
    const { error } = await supabase.from("feedback" as any).delete().eq("id", id);
    setBusyId(null);
    if (error) {
      toast({ variant: "destructive", title: "Löschen fehlgeschlagen", description: error.message });
      return;
    }
    void load();
  };

  const gefiltert = useMemo(() => {
    if (filter === "alle") return rows;
    if (filter === "umgesetzt") return rows.filter((r) => r.status === "umgesetzt");
    // offen = neu + gesehen
    return rows.filter((r) => r.status === "neu" || r.status === "gesehen");
  }, [rows, filter]);

  const neuCount = rows.filter((r) => r.status === "neu").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {(
          [
            { k: "offen", label: "Offen" },
            { k: "umgesetzt", label: "Umgesetzt" },
            { k: "alle", label: "Alle" },
          ] as { k: Filter; label: string }[]
        ).map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              filter === f.k ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
        {neuCount > 0 && (
          <Badge className="bg-blue-100 text-blue-800 ml-auto">{neuCount} neu</Badge>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Lädt …
        </div>
      ) : gefiltert.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Kein Feedback in dieser Ansicht.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {gefiltert.map((r) => {
            const kat = KAT[r.kategorie] ?? KAT.sonstiges;
            const Icon = kat.icon;
            const st = STATUS[r.status] ?? STATUS.neu;
            const name = r.erstellt_von ? namen.get(r.erstellt_von) ?? "…" : "Anonym";
            return (
              <Card key={r.id} className={r.status === "neu" ? "border-blue-200" : ""}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge variant="outline" className={`${kat.cls} gap-1`}>
                          <Icon className="h-3 w-3" /> {kat.label}
                        </Badge>
                        <Badge className={st.cls}>{st.label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {name} ·{" "}
                          {new Date(r.created_at).toLocaleDateString("de-AT", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">{r.text}</div>
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        {r.seiten_kontext ? `Seite: ${r.seiten_kontext}` : null}
                        {r.app_version ? `  ·  Version: ${r.app_version}` : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    {r.status === "neu" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, "gesehen")}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1.5" /> Gesehen
                      </Button>
                    )}
                    {r.status !== "umgesetzt" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-700 border-green-300 hover:bg-green-50"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, "umgesetzt")}
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" /> Umgesetzt
                      </Button>
                    )}
                    {r.status !== "abgelehnt" && r.status !== "umgesetzt" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-muted-foreground"
                        disabled={busyId === r.id}
                        onClick={() => setStatus(r.id, "abgelehnt")}
                      >
                        <X className="h-3.5 w-3.5 mr-1.5" /> Ablehnen
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive ml-auto"
                      disabled={busyId === r.id}
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
