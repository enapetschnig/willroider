/**
 * Dashboard-Karte für den Baustellenstundenbericht.
 * - Mitarbeiter: eigener offener Bericht → Durchsicht/Unterschrift.
 * - Büro/Admin: Anzahl unterschriebener Berichte, die auf Kontrolle warten.
 */

import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PenLine, FileCheck2, ChevronRight, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useStundenBerichteList } from "@/hooks/useStundenBericht";

function monatLabel(jahr: number, monat: number): string {
  return new Date(jahr, monat - 1, 1).toLocaleDateString("de-AT", {
    month: "long",
    year: "numeric",
  });
}

export function StundenBerichtHintCard() {
  const { user, canReview } = useAuth();

  const meine = useStundenBerichteList({
    mitarbeiterId: user?.id,
    status: "offen",
    enabled: !!user,
  });
  const kontrolle = useStundenBerichteList({
    status: "unterschrieben",
    enabled: !!user && canReview,
  });

  const meinOffen = meine.data?.[0];
  const kontrollCount = kontrolle.data?.length ?? 0;

  if (!meinOffen && kontrollCount === 0) return null;

  return (
    <>
      {meinOffen && (
        <Card className="border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-amber-100 shadow-md">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-amber-500 flex items-center justify-center text-white shadow-md shrink-0">
                <PenLine className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base sm:text-lg text-amber-950 leading-tight">
                  Dein Baustellenstundenbericht wartet auf deine Durchsicht
                </div>
                <div className="text-xs sm:text-sm text-amber-900 mt-1">
                  {monatLabel(meinOffen.jahr, meinOffen.monat)} ·{" "}
                  {meinOffen.teil === 1
                    ? "Teil I (1.–16.)"
                    : "Teil II (17.–Ende)"}{" "}
                  — bitte kontrollieren, ggf. ändern und unterschreiben.
                </div>
              </div>
              <Link
                to={`/stundenbericht/${meinOffen.id}`}
                className="shrink-0 hidden sm:block"
              >
                <Button className="bg-amber-600 hover:bg-amber-700 text-white shadow-md">
                  Jetzt öffnen
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              </Link>
            </div>
            <Link
              to={`/stundenbericht/${meinOffen.id}`}
              className="sm:hidden block mt-3"
            >
              <Button className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white shadow-md">
                Jetzt öffnen
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {canReview && kontrollCount > 0 && (
        <Card className="border-blue-300 bg-blue-50">
          <CardContent className="p-4 flex items-center gap-3">
            <FileCheck2 className="h-8 w-8 text-blue-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-blue-900">
                {kontrollCount} Stundenbericht{kontrollCount === 1 ? "" : "e"}{" "}
                warten auf Kontrolle
              </div>
              <div className="text-xs text-blue-800">
                Unterschrieben — bitte prüfen &amp; bestätigen
              </div>
            </div>
            <Link to="/stundenberichte?status=unterschrieben">
              <Button size="sm" className="bg-blue-700 hover:bg-blue-800">
                Prüfen <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </>
  );
}
