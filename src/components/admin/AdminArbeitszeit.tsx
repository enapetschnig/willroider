import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarRange, Coffee, UserCog } from "lucide-react";
import Kalender from "@/pages/Kalender";
import { AdminStammdatenStunden } from "./AdminStammdatenStunden";
import { AdminEinstellungen } from "./AdminEinstellungen";

/**
 * Bündelt alle arbeitszeitbezogenen Admin-Einstellungen an EINEM Ort:
 *  - Arbeitszeitkalender (L/K-Wochen, Tages-Soll) — die einzige Quelle
 *    für alle Soll-/Minusstunden-Berechnungen.
 *  - Pausen & Tageslimits.
 *  - Pro-Mitarbeiter-Einstellungen (Modell, Tagesnorm, Beschäftigungsgrad).
 */
type Sub = "kalender" | "pausen" | "mitarbeiter";

const SUBS: { key: Sub; label: string; icon: typeof CalendarRange }[] = [
  { key: "kalender", label: "Arbeitszeitkalender", icon: CalendarRange },
  { key: "pausen", label: "Pausen & Limits", icon: Coffee },
  { key: "mitarbeiter", label: "Mitarbeiter-Einstellungen", icon: UserCog },
];

export function AdminArbeitszeit() {
  const [sub, setSub] = useState<Sub>("kalender");

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-2 flex flex-wrap gap-1.5">
          {SUBS.map((s) => {
            const Icon = s.icon;
            const active = s.key === sub;
            return (
              <button
                key={s.key}
                onClick={() => setSub(s.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {sub === "kalender" && <Kalender />}
      {sub === "pausen" && <AdminStammdatenStunden />}
      {sub === "mitarbeiter" && <AdminEinstellungen />}
    </div>
  );
}
