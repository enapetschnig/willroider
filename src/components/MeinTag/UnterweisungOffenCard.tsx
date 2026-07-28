/**
 * Hinweis auf offene Unterweisungen in „Mein Tag".
 *
 * Gemeldet: „Polier + Mitarbeiter muss die Unterweisung sehen und
 * unterschreiben. Am ersten Tag auf einer neuen Baustelle …"
 *
 * Entschieden wurde: erst der Hinweis, die harte Sperre später — damit
 * die Unterweisungen in Ruhe hinterlegt werden können. Die Vollbild-Sperre
 * gibt es bereits (EvaluierungSignatureGate über der ganzen App); sie
 * greift, sobald die Karenzfrist der Unterweisung abgelaufen ist.
 *
 * Diese Karte macht vorher sichtbar, was ansteht, und öffnet denselben
 * Unterschrifts-Ablauf freiwillig.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { werktageSeit } from "@/lib/dateFmt";
import {
  EvaluierungSignaturePrompt,
  ladeOffeneUnterschriften,
  type OpenSignature,
} from "@/components/EvaluierungSignatureGate";

export function UnterweisungOffenCard() {
  const { user } = useAuth();
  const [offen, setOffen] = useState<OpenSignature[]>([]);
  const [dialog, setDialog] = useState(false);

  const laden = useCallback(async () => {
    if (!user?.id) return;
    setOffen(await ladeOffeneUnterschriften(user.id));
  }, [user?.id]);

  useEffect(() => {
    laden();
    if (!user?.id) return;
    const ch = supabase
      .channel(`unterweisung-offen-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "evaluierung_unterschriften",
          filter: `mitarbeiter_id=eq.${user.id}`,
        },
        () => laden(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, laden]);

  if (offen.length === 0) return null;

  // Wie viele Werktage bleiben, bis die App gesperrt wird?
  const restTage = Math.min(
    ...offen.map((o) => o.karenzWerktage - werktageSeit(o.datum)),
  );
  const dringend = restTage <= 1;

  return (
    <>
      <Card
        className={
          dringend
            ? "border-destructive/40 bg-destructive/5"
            : "border-amber-300 bg-amber-50 dark:bg-amber-950/20"
        }
      >
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert
              className={`h-5 w-5 shrink-0 mt-0.5 ${
                dringend ? "text-destructive" : "text-amber-700"
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                {offen.length === 1
                  ? "Eine Unterweisung ist noch offen"
                  : `${offen.length} Unterweisungen sind noch offen`}
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {offen.slice(0, 4).map((o) => (
                  <li key={o.unterschriftId}>
                    {o.baustelleName}
                    {o.kostenstelle ? ` · ${o.kostenstelle}` : ""}
                  </li>
                ))}
                {offen.length > 4 && <li>… und {offen.length - 4} weitere</li>}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {restTage <= 0
                  ? "Ohne Unterschrift lässt sich die App nicht mehr benutzen."
                  : `Bitte vor dem ersten Arbeitstag auf der Baustelle unterschreiben — noch ${restTage} ${
                      restTage === 1 ? "Werktag" : "Werktage"
                    }.`}
              </p>
            </div>
          </div>
          <Button size="sm" className="w-full h-10" onClick={() => setDialog(true)}>
            Ansehen und unterschreiben
          </Button>
        </CardContent>
      </Card>

      <EvaluierungSignaturePrompt
        open={dialog}
        onClose={() => {
          setDialog(false);
          laden();
        }}
      />
    </>
  );
}
