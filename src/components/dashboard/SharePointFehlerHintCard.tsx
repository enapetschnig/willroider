/**
 * Dashboard-Hinweis: Der SharePoint-Ordner einer neuen Baustelle konnte auch
 * nach mehreren automatischen Versuchen nicht angelegt werden (Auftrag in
 * sharepoint_auftraege mit Status „fehler").
 *
 * Christoph, 19.10.2026: „ich will, dass das immer funktioniert" — dazu
 * gehört, dass ein Fehler nicht still bleibt. Sichtbar für den Bauleiter
 * der Baustelle und für Admins (Mitarbeiter bearbeiten). Der Knopf führt in
 * den Reiter „Team", dort lässt sich der Ordner nach Vorlage anlegen.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudOff, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Fehler = { baustelle_id: string; bvh_name: string; meldung: string | null };

export function SharePointFehlerHintCard() {
  const { user, hasPermission } = useAuth();
  const admin = hasPermission("mitarbeiter.edit");
  const [fehler, setFehler] = useState<Fehler[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("sharepoint_auftraege")
        .select("baustelle_id, meldung, baustellen!inner(bvh_name, bauleiter_id, sharepoint_item_id)")
        .eq("status", "fehler")
        .is("baustellen.sharepoint_item_id", null);
      const rows = ((data as any[]) ?? []).filter((r) => admin || r.baustellen?.bauleiter_id === user.id);
      const jeBaustelle = new Map<string, Fehler>();
      for (const r of rows) {
        jeBaustelle.set(r.baustelle_id, { baustelle_id: r.baustelle_id, bvh_name: r.baustellen?.bvh_name ?? "?", meldung: r.meldung });
      }
      setFehler([...jeBaustelle.values()]);
    })();
  }, [user, admin]);

  if (fehler.length === 0) return null;
  const erster = fehler[0];

  return (
    <Card className="border-red-300 bg-red-50">
      <CardContent className="p-4 flex items-center gap-3">
        <CloudOff className="h-8 w-8 text-red-700 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-red-900">
            {fehler.length === 1
              ? `SharePoint-Ordner für „${erster.bvh_name}“ konnte nicht angelegt werden`
              : `${fehler.length} SharePoint-Ordner konnten nicht angelegt werden`}
          </div>
          <div className="text-xs text-red-800 truncate">
            {fehler.length === 1
              ? erster.meldung ?? "Bitte in der Baustelle im Reiter „Team“ nachholen."
              : fehler.map((f) => f.bvh_name).join(" · ")}
          </div>
        </div>
        <Link to={`/baustellen/${erster.baustelle_id}?tab=team`}>
          <Button size="sm" className="bg-red-700 hover:bg-red-800">
            Ansehen <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
