/**
 * Menü-Card für die Halle/Werkstatt-Zeiterfassung — immer sichtbarer
 * Shortcut auf dem Dashboard. Klick führt zu `/halle`.
 */

import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, Wrench } from "lucide-react";

export function HalleHintCard() {
  return (
    <Link to="/halle" className="block">
      <Card className="border-primary/30 bg-primary/5 hover:bg-primary/10 transition">
        <CardContent className="p-4 flex items-center gap-3">
          <Wrench className="h-8 w-8 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              Halle / Werkstatt-Zeiterfassung
            </div>
            <div className="text-xs text-muted-foreground">
              Stunden auf Maschinen erfassen — Hundegger, Weinmann, Isocell …
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
