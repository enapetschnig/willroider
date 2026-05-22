/**
 * Dashboard-Karte für den Baustellenstundenbericht.
 * - Mitarbeiter: eigener offener Bericht → Durchsicht/Unterschrift.
 * - Büro/Admin: Anzahl unterschriebener Berichte, die auf Kontrolle warten.
 */

import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PenLine, FileCheck2, ChevronRight } from "lucide-react";
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
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 flex items-center gap-3">
            <PenLine className="h-8 w-8 text-amber-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-900">
                Dein Baustellenstundenbericht wartet auf dich
              </div>
              <div className="text-xs text-amber-800">
                {monatLabel(meinOffen.jahr, meinOffen.monat)} ·{" "}
                {meinOffen.teil === 1 ? "Teil I (1.–16.)" : "Teil II (17.–Ende)"}{" "}
                — durchsehen &amp; unterschreiben
              </div>
            </div>
            <Link to={`/stundenbericht/${meinOffen.id}`}>
              <Button size="sm" className="bg-amber-700 hover:bg-amber-800">
                Öffnen <ChevronRight className="h-3.5 w-3.5 ml-1" />
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
