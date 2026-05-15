import { useEffect, useMemo, useState } from "react";
import { minToTime } from "@/lib/stundenTime";

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
  // Auf den aktuellen Wert scrollen, sobald die Liste gemountet ist
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
