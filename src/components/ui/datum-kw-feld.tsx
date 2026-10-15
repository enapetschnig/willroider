/**
 * Datumsfeld mit Kalenderwochen-Spalte (Wunsch 15.10.2026, J. Maurer).
 *
 * Der eingebaute Datumswähler des Browsers (input type="date") kann keine
 * KW anzeigen — in der Planung denkt aber jeder in Kalenderwochen. Dieses
 * Feld zeigt links die ISO-KW; ein Tipp darauf wählt den Montag (bzw. mit
 * `wocheWaehlt="ende"` den Freitag) dieser Woche.
 *
 * Wert wie beim input: "YYYY-MM-DD" oder "".
 */
import { useState } from "react";
import { de } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { localIso } from "@/lib/dateFmt";

const alsDatum = (iso: string): Date | undefined =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00") : undefined;

export function DatumKwFeld({
  value,
  onChange,
  min,
  wocheWaehlt = "anfang",
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  /** Tipp auf die KW: Montag ("anfang") oder Freitag ("ende"). */
  wocheWaehlt?: "anfang" | "ende";
  className?: string;
  "aria-label"?: string;
}) {
  const [offen, setOffen] = useState(false);
  const gewaehlt = alsDatum(value);
  const minDatum = min ? alsDatum(min) : undefined;

  const waehle = (d: Date | undefined) => {
    if (!d) return;
    onChange(localIso(d));
    setOffen(false);
  };

  return (
    <Popover open={offen} onOpenChange={setOffen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <span className={cn("truncate", !gewaehlt && "text-muted-foreground")}>
            {gewaehlt ? gewaehlt.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "Datum wählen"}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={de}
          weekStartsOn={1}
          ISOWeek
          showWeekNumber
          selected={gewaehlt}
          defaultMonth={gewaehlt ?? minDatum}
          disabled={minDatum ? { before: minDatum } : undefined}
          onSelect={waehle}
          onWeekNumberClick={(_kw, tage) => {
            const tag = wocheWaehlt === "ende" ? tage[Math.min(4, tage.length - 1)] : tage[0];
            if (tag && !(minDatum && tag < minDatum)) waehle(tag);
          }}
          formatters={{ formatWeekNumber: (kw) => `${kw}` }}
          classNames={{
            // Die leere Kopfzelle über der KW-Spalte beschriften.
            head_row:
              "flex [&>td:first-child]:flex [&>td:first-child]:items-center [&>td:first-child]:justify-center [&>td:first-child]:before:content-['KW'] [&>td:first-child]:before:text-[0.7rem] [&>td:first-child]:before:font-semibold [&>td:first-child]:before:text-primary",
            weeknumber:
              "h-9 w-9 inline-flex items-center justify-center rounded-md text-[0.75rem] font-semibold text-primary bg-primary/5 hover:bg-primary/15",
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
