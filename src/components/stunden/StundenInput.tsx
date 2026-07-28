/**
 * Eingabefeld für Stunden — Komma UND Punkt erlaubt.
 *
 * Schmale Variante von {@link StundenZelle} ohne ±-Knöpfe, für alle Stellen,
 * an denen nur ein Zahlenfeld gebraucht wird (Zulagen, Bericht-Tätigkeiten,
 * Tages-Korrektur).
 *
 * Warum nicht einfach `type="number"`: der Browser parst das immer mit
 * Punkt, unabhängig von der Spracheinstellung. Bei „9,5" wird der Feldwert
 * leer und der Wert springt auf 0 — genau der gemeldete Fehler.
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { parseStunden, stundenText } from "./zeiterfassungUi";

export function StundenInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  ariaLabel = "Stunden",
  /** true = leeres Feld bedeutet „nicht gesetzt" statt 0 (z.B. Zulagen). */
  leerAlsNull = false,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  leerAlsNull?: boolean;
}) {
  const [text, setText] = useState(() => (value == null ? "" : stundenText(value)));
  const letzterWert = useRef(value);

  useEffect(() => {
    if (letzterWert.current !== value) {
      letzterWert.current = value;
      setText(value == null ? "" : stundenText(value));
    }
  }, [value]);

  const uebernehmen = () => {
    const roh = text.trim();
    if (roh === "" && leerAlsNull) {
      letzterWert.current = null;
      onChange(null);
      return;
    }
    const v = parseStunden(roh);
    // Unlesbare Eingabe: alten Wert zurückschreiben statt still zu nullen.
    if (v === null) {
      setText(value == null ? "" : stundenText(value));
      return;
    }
    letzterWert.current = v;
    setText(stundenText(v));
    if (v !== value) onChange(v);
  };

  return (
    <Input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => setText(e.target.value)}
      onBlur={uebernehmen}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") setText(value == null ? "" : stundenText(value));
      }}
    />
  );
}
