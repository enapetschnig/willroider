import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { HeartPulse, Paperclip, Trash2, Search } from "lucide-react";
import { getMaDokumentSignedUrl, deleteMaDokument } from "@/lib/maUpload";
import type { Database } from "@/integrations/supabase/types";

type Krankmeldung = Database["public"]["Tables"]["krankmeldungen"]["Row"];
type Dokument = Database["public"]["Tables"]["dokumente"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

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

export function AdminKrankmeldungen() {
  const { toast } = useToast();
  const [items, setItems] = useState<Krankmeldung[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [doks, setDoks] = useState<Record<string, Dokument>>({});
  const [search, setSearch] = useState("");

  const load = async () => {
    const [{ data: items }, { data: ps }] = await Promise.all([
      supabase
        .from("krankmeldungen")
        .select("*")
        .order("von", { ascending: false }),
      supabase.from("profiles").select("*").eq("is_active", true),
    ]);
    const list = (items as Krankmeldung[]) ?? [];
    setItems(list);
    const profMap: Record<string, Profile> = {};
    (ps ?? []).forEach((p: any) => (profMap[p.id] = p));
    setProfiles(profMap);
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
      .channel("admin-krank")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "krankmeldungen" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((k) => {
      const p = profiles[k.mitarbeiter_id];
      const name = p ? `${p.vorname} ${p.nachname}` : "";
      return name.toLowerCase().includes(s);
    });
  }, [items, profiles, search]);

  const openDokument = async (dokId: string | null) => {
    if (!dokId) return;
    const d = doks[dokId];
    if (!d) return;
    const url = await getMaDokumentSignedUrl(d.storage_path);
    if (url) window.open(url, "_blank");
  };

  const remove = async (k: Krankmeldung) => {
    if (
      !window.confirm(
        `Krankmeldung von ${profiles[k.mitarbeiter_id]?.vorname ?? ""} ${profiles[k.mitarbeiter_id]?.nachname ?? ""} (${fmtDate(k.von)}–${fmtDate(k.bis)}) löschen?`,
      )
    )
      return;
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
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <HeartPulse className="h-4 w-4 text-red-500" />
          <span className="text-sm font-semibold">Krankmeldungen</span>
          <span className="text-xs text-muted-foreground">
            {items.length}{" "}
            {items.length === 1 ? "Eintrag" : "Einträge"}
          </span>
          <div className="ml-auto flex items-center gap-1.5 max-w-xs flex-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Mitarbeiter suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "Noch keine Krankmeldungen eingereicht."
              : "Keine Treffer für deine Suche."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((k) => {
                const p = profiles[k.mitarbeiter_id];
                const d = k.dokument_id ? doks[k.dokument_id] : null;
                const tage = tageImRange(k.von, k.bis);
                return (
                  <div
                    key={k.id}
                    className="p-3 flex items-center gap-3 flex-wrap"
                  >
                    <div className="flex-1 min-w-[180px]">
                      <div className="font-semibold text-sm">
                        {p?.nachname ?? "?"} {p?.vorname ?? ""}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {fmtDate(k.von)} – {fmtDate(k.bis)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {tage} {tage === 1 ? "Tag" : "Tage"}
                    </Badge>
                    {k.notiz && (
                      <div className="text-xs italic text-muted-foreground max-w-[200px] truncate">
                        „{k.notiz}"
                      </div>
                    )}
                    {d ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openDokument(k.dokument_id)}
                      >
                        <Paperclip className="h-3.5 w-3.5 mr-1.5" />
                        Datei
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        ohne Datei
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-8 w-8 p-0"
                      onClick={() => remove(k)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
