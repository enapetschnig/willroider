import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Minus, Plus } from "lucide-react";
import { shiftTime } from "@/lib/stundenTime";
import { TimeListPicker } from "./TimeListPicker";

export function TimeStepper({
  label,
  value,
  onChange,
  big = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  big?: boolean;
}) {
  const inputH = big ? "h-12" : "h-11";
  const btnH = big ? "h-12 w-12" : "h-11 w-11";
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex items-stretch gap-1 mt-1.5">
        <Button
          type="button"
          variant="outline"
          className={`${btnH} shrink-0 px-0`}
          onClick={() => onChange(shiftTime(value, -15))}
          aria-label={`${label} −15 min`}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`${inputH} flex-1 rounded-md border bg-background text-center font-semibold tabular-nums hover:bg-muted transition`}
              aria-label={`${label} ändern`}
            >
              {value}
            </button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-32" align="center">
            <TimeListPicker
              value={value}
              onSelect={(v) => {
                onChange(v);
                setPickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="outline"
          className={`${btnH} shrink-0 px-0`}
          onClick={() => onChange(shiftTime(value, 15))}
          aria-label={`${label} +15 min`}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
