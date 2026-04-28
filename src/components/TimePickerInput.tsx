import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface Props {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  /** Höhe des Buttons (default h-10) */
  size?: "sm" | "md";
}

/**
 * Time-Input mit Quick-Picker statt native Browser-Time-Picker.
 * Garantiert 15-Min-Schritte. Klick öffnet eine scrollbare Liste mit allen
 * 96 Optionen (00:00–23:45). Für ± 15min Buttons drumherum siehe TimeStepper
 * in Stunden.tsx.
 */
export function TimePickerInput({ label, value, onChange, className, size = "md" }: Props) {
  const [open, setOpen] = useState(false);
  const h = size === "sm" ? "h-10" : "h-11";
  return (
    <div className={className}>
      {label && (
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`w-full ${h} rounded-md border bg-background text-center text-sm font-semibold tabular-nums hover:bg-muted transition mt-1.5`}
            aria-label={label ?? "Zeit"}
          >
            {value}
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-32" align="center">
          <TimeListPicker
            value={value}
            onSelect={(v) => {
              onChange(v);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function TimeListPicker({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (v: string) => void;
}) {
  const [refEl, setRefEl] = useState<HTMLDivElement | null>(null);
  const options = useMemo(() => {
    const arr: string[] = [];
    for (let m = 0; m < 24 * 60; m += 15) arr.push(minToTime(m));
    return arr;
  }, []);
  useEffect(() => {
    if (!refEl) return;
    const target = refEl.querySelector<HTMLButtonElement>(`[data-time="${value}"]`);
    if (target) {
      const off = target.offsetTop - refEl.clientHeight / 2 + target.clientHeight / 2;
      refEl.scrollTop = Math.max(0, off);
    }
  }, [refEl, value]);
  return (
    <div ref={setRefEl} className="max-h-64 overflow-y-auto py-1">
      {options.map((t) => {
        const sel = t === value;
        return (
          <button
            key={t}
            type="button"
            data-time={t}
            onClick={() => onSelect(t)}
            className={`w-full text-center text-sm py-2 tabular-nums transition ${
              sel ? "bg-primary text-primary-foreground font-bold" : "hover:bg-muted"
            }`}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
