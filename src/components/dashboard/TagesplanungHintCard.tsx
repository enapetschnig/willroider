import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Eye, ClipboardCheck, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { localIso } from "@/lib/dateFmt";
import { naechsterWerktag } from "@/lib/feiertage";

/**
 * Admin-Hint für die Tagesplanung im Dashboard. Zeigt:
 *   - ob der Plan für morgen freigegeben ist
 *   - wie viele MA den heutigen Plan noch nicht gelesen haben
 */
export function TagesplanungHintCard() {
  const { isAdmin } = useAuth();
  const [morgenIso, setMorgenIso] = useState<string>("");
  const [morgenFreigegeben, setMorgenFreigegeben] = useState<boolean>(true);
  const [ungelesen, setUngelesen] = useState<number>(0);

  useEffect(() => {
    if (!isAdmin) return;
    const today = localIso();
    const morgen = localIso(naechsterWerktag(today));
    setMorgenIso(morgen);

    (async () => {
      const [{ data: frei }, { data: emToday }] = await Promise.all([
        supabase
          .from("tagesplanung_freigaben")
          .select("datum")
          .eq("datum", morgen)
          .maybeSingle(),
        // Heutige Einteilungen → wie viele MA haben gelesen_am gesetzt?
        supabase
          .from("einteilung_mitarbeiter")
          .select("gelesen_am, einteilung:einteilungen!inner(datum)")
          .eq("einteilung.datum", today),
      ]);
      setMorgenFreigegeben(!!frei);
      const rows = (emToday ?? []) as any[];
      // Nur zählen wenn Plan für heute freigegeben ist
      const { data: heuteFrei } = await supabase
        .from("tagesplanung_freigaben")
        .select("datum")
        .eq("datum", today)
        .maybeSingle();
      if (heuteFrei) {
        setUngelesen(rows.filter((r) => !r.gelesen_am).length);
      } else {
        setUngelesen(0);
      }
    })();
  }, [isAdmin]);

  if (!isAdmin) return null;
  if (morgenFreigegeben && ungelesen === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <ClipboardCheck className="h-4 w-4 text-amber-700 shrink-0" />
          <span className="text-sm font-semibold text-amber-900">Tagesplanung</span>
        </div>
        <div className="space-y-1 text-sm text-amber-900">
          {!morgenFreigegeben && morgenIso && (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Plan für{" "}
                <span className="font-medium">
                  {new Date(morgenIso).toLocaleDateString("de-AT", {
                    weekday: "long",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>{" "}
                noch nicht freigegeben.
              </span>
            </div>
          )}
          {ungelesen > 0 && (
            <div className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium">{ungelesen}</span>{" "}
                {ungelesen === 1 ? "Mitarbeiter hat" : "Mitarbeiter haben"} den
                heutigen Plan noch nicht zur Kenntnis genommen.
              </span>
            </div>
          )}
        </div>
        <Link
          to="/tagesplanung"
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 hover:underline"
        >
          Zur Tagesplanung <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
