/**
 * Startseiten-Karten zum Tätigkeitsbericht:
 * - Angestellter: abgelaufene Periode (21.–20.) noch nicht unterschrieben
 * - Freigeber: N unterschriebene Berichte warten auf Freigabe
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronRight, FileCheck2, PenLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localIso } from "@/lib/dateFmt";
import { periodeTitel, periodeVerschieben, periodeVonDatum } from "@/lib/taetigkeitsbericht";

export function TaetigkeitsberichtHintCard() {
  const { user, profile, hasPermission } = useAuth();
  const istAngestellter = (profile as any)?.zeiterfassung_typ === "angestellter";
  const darfFreigeben = hasPermission("stunden.taetigkeitsbericht.freigeben");
  const [offenePeriode, setOffenePeriode] = useState<string | null>(null);
  const [wartend, setWartend] = useState(0);

  useEffect(() => {
    if (!user) return;
    const heute = localIso();
    // Nach dem 20. ist die vorige Periode abgelaufen und soll unterschrieben sein.
    if (istAngestellter && Number(heute.slice(8, 10)) > 20) {
      const p = periodeVerschieben(periodeVonDatum(heute), -1);
      (supabase as any)
        .from("taetigkeitsbericht_unterschriften")
        .select("id")
        .eq("mitarbeiter_id", user.id)
        .eq("jahr", p.jahr)
        .eq("monat", p.monat)
        .maybeSingle()
        .then(({ data }: { data: unknown }) => setOffenePeriode(data ? null : periodeTitel(p)));
    }
    if (darfFreigeben) {
      (supabase as any)
        .from("taetigkeitsbericht_unterschriften")
        .select("id", { count: "exact", head: true })
        .eq("status", "unterschrieben")
        .then(({ count }: { count: number | null }) => setWartend(count ?? 0));
    }
  }, [user, istAngestellter, darfFreigeben]);

  if (!offenePeriode && wartend === 0) return null;

  return (
    <>
      {offenePeriode && (
        <Card className="border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-amber-100 shadow-md">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 rounded-full bg-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
                <PenLine className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base text-amber-950 leading-tight">
                  Dein Tätigkeitsbericht wartet auf deine Unterschrift
                </div>
                <div className="text-xs sm:text-sm text-amber-900 mt-1">
                  {offenePeriode} — bitte kontrollieren und unterschreiben, danach gibt die
                  Geschäftsführung frei.
                </div>
              </div>
            </div>
            <Link to="/taetigkeitsbericht" className="block mt-3">
              <Button className="w-full sm:w-auto h-11 bg-amber-600 hover:bg-amber-700 text-white shadow-md">
                Jetzt öffnen <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
      {wartend > 0 && (
        <Card className="border-blue-300 bg-blue-50">
          <CardContent className="p-4 flex items-center gap-3">
            <FileCheck2 className="h-8 w-8 text-blue-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-blue-900">
                {wartend} Tätigkeitsbericht{wartend === 1 ? "" : "e"} warten auf Freigabe
              </div>
              <div className="text-xs text-blue-800">Unterschrieben — bitte prüfen und freigeben</div>
            </div>
            <Link to="/taetigkeitsberichte">
              <Button size="sm" className="bg-blue-700 hover:bg-blue-800">
                Freigeben <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </>
  );
}
