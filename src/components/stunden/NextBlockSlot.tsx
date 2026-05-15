import { ArrowDown } from "lucide-react";
import { fmtTime } from "@/lib/stundenTime";

/**
 * Visueller Brücken-Slot zwischen den bereits gebuchten Blöcken und dem
 * Eingabe-Form. Zeigt klar: „dein nächster Block beginnt hier".
 */
export function NextBlockSlot({
  blockNr,
  startsAt,
  onClick,
}: {
  /** 1-basiert, der nächste Block-Index (Block 1 wenn leer, Block 2 nach Block 1 etc.) */
  blockNr: number;
  /** Startzeit als HH:MM:SS oder HH:MM oder null (Fehlzeit / leerer Tag) */
  startsAt: string | null;
  onClick?: () => void;
}) {
  const time = startsAt ? fmtTime(startsAt) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full group rounded-md border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition px-4 py-3 flex items-center justify-center gap-2 text-primary"
    >
      <ArrowDown className="h-4 w-4 group-hover:translate-y-0.5 transition" />
      <span className="font-semibold text-sm">
        {time
          ? `Weiteren Block ab ${time} erfassen`
          : `Block ${blockNr} erfassen`}
      </span>
    </button>
  );
}
