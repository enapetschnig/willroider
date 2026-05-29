/**
 * Dashboard-Card für Berichte — nur für Bauleiter/Admin (canReview):
 * Zeigt die Anzahl eingereichter Bautages-/Regie­berichte, die auf
 * Freigabe warten. Polier-Variante (heutige Baustellen + Bautages­
 * bericht-Status) ist bewusst entfernt: der Polier macht das täglich
 * und braucht keine separate Dashboard-Erinnerung.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileCheck2, ChevronRight } from "lucide-react";

export function BerichteHintCard() {
  const { user, canReview } = useAuth();
  const [pruefCount, setPruefCount] = useState(0);

  useEffect(() => {
    if (!user || !canReview) return;
    (async () => {
      const { count } = await supabase
        .from("berichte")
        .select("id", { count: "exact", head: true })
        .eq("status", "eingereicht");
      setPruefCount(count ?? 0);
    })();
  }, [user, canReview]);

  if (!canReview || pruefCount === 0) return null;

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
