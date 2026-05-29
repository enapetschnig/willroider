/**
 * MA-Dashboard-Card für offene Unterweisungs-Unterschriften.
 *  - 0 offen → rendert nichts
 *  - ≥1 offen, alle in Karenzfrist → orange Hinweis-Card
 *  - ≥1 offen mit Karenz abgelaufen → rot, „Pflicht jetzt"
 *
 * Click öffnet den steuerbaren `EvaluierungSignaturePrompt`. Realtime-
 * Update auf `evaluierung_unterschriften` damit die Card verschwindet,
 * sobald der MA unterschrieben hat.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, FileSignature, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { werktageSeit } from "@/lib/dateFmt";
import {
  EvaluierungSignaturePrompt,
  SIGNATURE_KARENZ_WERKTAGE,
} from "@/components/EvaluierungSignatureGate";

type OffeneRow = {
  unterschrift_id: string;
  evaluierung_id: string;
  evaluierung_datum: string;
  evaluierung_titel: string | null;
  tage_offen: number;
};

export function UnterschriftenCard() {
  const { user } = useAuth();
  const [offene, setOffene] = useState<OffeneRow[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("v_offene_unterschriften_mit_alter" as any)
      .select(
        "unterschrift_id, evaluierung_id, evaluierung_datum, evaluierung_titel, tage_offen",
      )
      .eq("mitarbeiter_id", user.id);
    setOffene((data as OffeneRow[]) ?? []);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel("dashboard-unterschriften-self")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "evaluierung_unterschriften",
          filter: `mitarbeiter_id=eq.${user.id}`,
        },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load, user]);

  if (offene.length === 0) return null;

  // Höchste Werktage-Zahl bestimmen — nimm Maximum aus DB-tage_offen
  // (kalendrisch) vs. clientseitiger Werktag-Logik. Karenz greift erst
  // bei Werktagen.
  const alteste = offene.reduce((max, r) => {
    const wt = werktageSeit(r.evaluierung_datum);
    return wt > max ? wt : max;
  }, 0);
  const ueberfaellig = alteste >= SIGNATURE_KARENZ_WERKTAGE;

  return (
    <>
      <Card
        className={
          ueberfaellig
            ? "border-2 border-red-400 bg-gradient-to-r from-red-50 to-rose-100 shadow-md"
            : "border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-amber-100 shadow-md"
        }
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <div
              className={`h-11 w-11 sm:h-12 sm:w-12 rounded-full flex items-center justify-center text-white shadow-md shrink-0 ${
                ueberfaellig ? "bg-red-600 animate-pulse" : "bg-amber-500"
              }`}
            >
              <ShieldAlert className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`font-bold text-base sm:text-lg leading-tight ${
                  ueberfaellig ? "text-red-950" : "text-amber-950"
                }`}
              >
                {offene.length === 1
                  ? "1 Unterweisung wartet auf deine Unterschrift"
                  : `${offene.length} Unterweisungen warten auf deine Unterschrift`}
              </div>
              <div
                className={`text-xs sm:text-sm mt-1 ${
                  ueberfaellig ? "text-red-900" : "text-amber-900"
                }`}
              >
                {ueberfaellig
                  ? `Pflicht — älteste Aufforderung seit ${alteste} Werktagen offen.`
                  : `Bitte zeitnah unterschreiben (Frist: ${SIGNATURE_KARENZ_WERKTAGE} Werktage).`}
              </div>
            </div>
            <Button
              className={`shrink-0 hidden sm:inline-flex ${
                ueberfaellig
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white"
              }`}
              onClick={() => setOpen(true)}
            >
              <FileSignature className="h-4 w-4 mr-1.5" /> Jetzt unterschreiben
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          <Button
            className={`sm:hidden block mt-3 w-full h-11 ${
              ueberfaellig
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-amber-600 hover:bg-amber-700 text-white"
            }`}
            onClick={() => setOpen(true)}
          >
            <FileSignature className="h-4 w-4 mr-1.5" /> Jetzt unterschreiben
          </Button>
        </CardContent>
      </Card>

      <EvaluierungSignaturePrompt open={open} onClose={() => setOpen(false)} />
    </>
  );
}
