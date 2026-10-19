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
  const [offen, setOffen] = useState<{ id: string; typ: string; datum: string }[]>([]);
  const pruefCount = offen.length;

  useEffect(() => {
    if (!user || !canReview) return;
    (async () => {
      const { data } = await supabase
        .from("berichte")
        .select("id, typ, datum")
        .eq("status", "eingereicht")
        .order("datum");
      setOffen((data as { id: string; typ: string; datum: string }[]) ?? []);
    })();
  }, [user, canReview]);

  // Wunsch J. Maurer (19.10.2026): direkt dorthin, wo etwas zu tun ist.
  // Ein Bericht → gleich öffnen. Mehrere → Liste nur mit den eingereichten,
  // passender Art und ab dem ältesten (sonst fehlten Regieberichte bzw.
  // alles, was älter als 30 Tage ist).
  const typen = Array.from(new Set(offen.map((b) => b.typ)));
  const ziel =
    offen.length === 1
      ? `/berichte/${offen[0].id}`
      : `/berichte?status=eingereicht&from=${offen[0]?.datum ?? ""}${typen.length === 1 ? `&typ=${typen[0]}` : ""}`;

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
        <Link to={ziel}>
          <Button size="sm" className="bg-blue-700 hover:bg-blue-800">
            Prüfen <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
