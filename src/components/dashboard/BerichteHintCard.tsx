/**
 * Dashboard-Card für Berichte.
 * - Polier (alle Roles außer Bauleiter/Admin): zeigt heutige Baustellen + Status
 *   ihres Bautagesberichts, plus offene Entwürfe der letzten 7 Tage.
 * - Bauleiter/Admin: zeigt Count der eingereichten Berichte (zu prüfen).
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileText, Plus, FileCheck2, ChevronRight } from "lucide-react";
import { localIso } from "@/lib/dateFmt";
import type { Database, BerichtStatus } from "@/integrations/supabase/types";

type Bericht = Database["public"]["Tables"]["berichte"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

export function BerichteHintCard() {
  const { user, isAdmin, canReview } = useAuth();
  const [pruefCount, setPruefCount] = useState(0);
  const [heuteBerichte, setHeuteBerichte] = useState<Bericht[]>([]);
  const [offeneEntwurfe, setOffeneEntwurfe] = useState<Bericht[]>([]);
  const [aktiveBaustellen, setAktiveBaustellen] = useState<Baustelle[]>([]);

  useEffect(() => {
    if (!user) return;
    const today = localIso();
    const woAgo = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return localIso(d);
    })();

    (async () => {
      // Polier: aktive Baustellen seiner Partie für heute
      if (!isAdmin && !canReview) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("partie_id")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.partie_id) {
          const { data: bs } = await supabase
            .from("baustellen")
            .select("*")
            .eq("partie_id", profile.partie_id)
            .in("status", ["aktiv", "geplant"])
            .order("bvh_name");
          setAktiveBaustellen((bs as Baustelle[]) ?? []);
        }
        const { data: heuteData } = await supabase
          .from("berichte")
          .select("*")
          .eq("datum", today)
          .eq("erfasst_von", user.id);
        setHeuteBerichte((heuteData as Bericht[]) ?? []);
        const { data: entwData } = await supabase
          .from("berichte")
          .select("*")
          .eq("erfasst_von", user.id)
          .eq("status", "entwurf")
          .gte("datum", woAgo)
          .lt("datum", today);
        setOffeneEntwurfe((entwData as Bericht[]) ?? []);
      }
      // Bauleiter: eingereichte Berichte
      if (canReview) {
        const { count } = await supabase
          .from("berichte")
          .select("id", { count: "exact", head: true })
          .eq("status", "eingereicht");
        setPruefCount(count ?? 0);
      }
    })();
  }, [user, isAdmin, canReview]);

  // Bauleiter-Variante: nur wenn welche eingereicht sind
  if (canReview) {
    if (pruefCount === 0) return null;
    return (
      <Card className="border-blue-300 bg-blue-50">
        <CardContent className="p-4 flex items-center gap-3">
          <FileCheck2 className="h-8 w-8 text-blue-700" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-blue-900">
              {pruefCount} Bericht{pruefCount === 1 ? "" : "e"} warten auf deine Freigabe
            </div>
            <div className="text-xs text-blue-800">Bautagesberichte + Regieberichte</div>
          </div>
          <Link to="/berichte?status=eingereicht">
            <Button size="sm" className="bg-blue-700 hover:bg-blue-800">
              Prüfen <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Polier-Variante
  if (aktiveBaustellen.length === 0 && offeneEntwurfe.length === 0) return null;

  const heuteByBaustelle = new Map(heuteBerichte.map((b) => [b.baustelle_id + b.typ, b]));

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="font-semibold text-sm flex items-center gap-1.5">
          <FileText className="h-4 w-4 text-primary" />
          Heutige Berichte
        </div>
        {aktiveBaustellen.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Keine aktiven Baustellen für deine Partie heute.
          </div>
        ) : (
          <div className="space-y-1.5">
            {aktiveBaustellen.map((b) => {
              const tag = heuteByBaustelle.get(b.id + "bautagesbericht");
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{b.bvh_name}</div>
                    {tag ? (
                      <div className="text-[11px] text-muted-foreground">
                        Bautagesbericht: <Badge variant="outline" className="text-[9px]">{tag.status}</Badge>
                      </div>
                    ) : (
                      <div className="text-[11px] text-amber-700">
                        Bautagesbericht noch offen
                      </div>
                    )}
                  </div>
                  <Link to={tag ? `/berichte/${tag.id}` : `/berichte`}>
                    <Button size="sm" variant={tag ? "outline" : "default"}>
                      {tag ? "Öffnen" : <><Plus className="h-3.5 w-3.5 mr-1" /> Erstellen</>}
                    </Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
        {offeneEntwurfe.length > 0 && (
          <div className="border-t pt-2 mt-2">
            <div className="text-[11px] text-amber-700 font-semibold mb-1">
              {offeneEntwurfe.length} Entwurf
              {offeneEntwurfe.length === 1 ? "" : "e"} aus der letzten Woche offen
            </div>
            <div className="space-y-1">
              {offeneEntwurfe.slice(0, 3).map((b) => (
                <Link
                  key={b.id}
                  to={`/berichte/${b.id}`}
                  className="block text-xs text-muted-foreground hover:text-foreground"
                >
                  · {new Date(b.datum).toLocaleDateString("de-AT")} ({b.typ})
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
