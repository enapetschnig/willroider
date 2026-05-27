/**
 * Stunden-Stepper im Viertelstunden-Raster (0,25 h). Native Browser-Spinner
 * ausgeblendet, Tippen am Handy via großer ±-Knöpfe.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus } from "lucide-react";
import { aufViertelstunde } from "./zeiterfassungUi";

export function StundenZelle({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-12 w-12 shrink-0"
        onClick={() => onChange(Math.max(0, aufViertelstunde(value) - 0.25))}
      >
        <Minus className="h-5 w-5" />
      </Button>
      <Input
        type="number"
        step={0.25}
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        onBlur={() => onChange(aufViertelstunde(value))}
        className="h-12 text-xl font-bold text-center tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-12 w-12 shrink-0"
        onClick={() => onChange(aufViertelstunde(value) + 0.25)}
      >
        <Plus className="h-5 w-5" />
      </Button>
      <span className="h-12 flex items-center px-1 text-sm font-medium text-muted-foreground">
        h
      </span>
    </div>
  );
}
