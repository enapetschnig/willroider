/**
 * Stunden-Eingabe: halbe Stunden über die ±-Knöpfe, freie Eingabe über die
 * Tastatur.
 *
 * Vorher stand hier `type="number"`. Der Browser parst das IMMER mit Punkt,
 * unabhängig von der Spracheinstellung — tippt man „9,5", wird der Feldwert
 * leer, und `Number("") || 0` machte daraus 0. Der Wert sprang also beim
 * Tippen auf null, deshalb „jetzt geht kein Komma oder Punkt".
 *
 * Jetzt: ein Textfeld mit eigenem Zwischenstand, `inputMode="decimal"` für
 * die Dezimaltastatur am Handy, Komma und Punkt beide erlaubt. Übernommen
 * wird beim Verlassen des Feldes und mit Enter, verworfen mit Escape.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus } from "lucide-react";
import {
  STUNDEN_SCHRITT,
  aufStundenRaster,
  parseStunden,
  stundenText,
} from "./zeiterfassungUi";

export function StundenZelle({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(() => stundenText(value));
  /** Zuletzt von außen gesehener Wert — erkennt Änderungen, die nicht aus
   *  diesem Feld kommen (anderes Gerät, Vorbelegung, Übernahme für alle). */
  const letzterWert = useRef(value);

  useEffect(() => {
    if (letzterWert.current !== value) {
      letzterWert.current = value;
      setText(stundenText(value));
    }
  }, [value]);

  const setzeWert = (v: number) => {
    letzterWert.current = v;
    setText(stundenText(v));
    onChange(v);
  };

  const uebernehmen = () => {
    const v = parseStunden(text);
    // Unlesbare Eingabe: alten Wert zurückschreiben statt auf 0 zu springen.
    if (v === null) {
      setText(stundenText(value));
      return;
    }
    if (v === value) {
      setText(stundenText(value));
      return;
    }
    setzeWert(v);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-12 w-12 shrink-0"
        aria-label="Eine halbe Stunde weniger"
        onClick={() =>
          setzeWert(Math.max(0, aufStundenRaster(value) - STUNDEN_SCHRITT))
        }
      >
        <Minus className="h-5 w-5" />
      </Button>
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={uebernehmen}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") setText(stundenText(value));
        }}
        aria-label="Stunden"
        className="h-12 text-xl font-bold text-center tabular-nums"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-12 w-12 shrink-0"
        aria-label="Eine halbe Stunde mehr"
        onClick={() => setzeWert(aufStundenRaster(value) + STUNDEN_SCHRITT)}
      >
        <Plus className="h-5 w-5" />
      </Button>
      <span className="h-12 flex items-center px-1 text-sm font-medium text-muted-foreground">
        h
      </span>
    </div>
  );
}
