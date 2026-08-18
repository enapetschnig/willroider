/**
 * Suchleiste für die Jahresplanungs-Gantts (Poliereinsatz + Mitarbeiter).
 *
 * Tippen zeigt Vorschläge (Baustelle, Kostenstelle, Mitarbeiter, Partie);
 * ein Klick springt zur Zeile und hebt sie kurz hervor — wie der
 * Maus-Hover, nur ein paar Sekunden lang. Die Ziele sind DOM-Elemente mit
 * bekannter id (domId), die die Gantt-Zeilen beim Rendern mitbekommen.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface SuchEintrag {
  /** Angezeigter Name — z. B. BVH oder „Nachname Vorname". */
  label: string;
  /** Kleingedrucktes — Kostenstelle, Partie … wird mitdurchsucht. */
  sub?: string;
  /** Zeilen-Kennung — die Gantt-Zeilen tragen sie als data-zeile. */
  zielId: string;
}

export function PlanungsSuche({
  eintraege,
  onSpringen,
  placeholder = "Suche BVH, Kostenstelle, Mitarbeiter …",
}: {
  eintraege: SuchEintrag[];
  /** Springt zur Zeile und markiert sie (setMarkierteZeile der Ansicht). */
  onSpringen: (zielId: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [offen, setOffen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Klick außerhalb schließt die Vorschläge
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const treffer = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const seen = new Set<string>();
    const out: SuchEintrag[] = [];
    for (const e of eintraege) {
      if (seen.has(e.zielId + e.label)) continue;
      if (e.label.toLowerCase().includes(q) || (e.sub ?? "").toLowerCase().includes(q)) {
        seen.add(e.zielId + e.label);
        out.push(e);
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [text, eintraege]);

  const springe = (e: SuchEintrag) => {
    setOffen(false);
    setText("");
    onSpringen(e.zielId);
  };

  return (
    <div ref={wrapRef} className="relative w-full sm:w-72">
      <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOffen(true);
        }}
        onFocus={() => setOffen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && treffer.length > 0) springe(treffer[0]);
          if (e.key === "Escape") setOffen(false);
        }}
        placeholder={placeholder}
        className="pl-9 h-9"
        aria-label="Planung durchsuchen"
      />
      {offen && treffer.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
          {treffer.map((t, i) => (
            <button
              key={t.zielId + t.label + i}
              type="button"
              onClick={() => springe(t)}
              className="w-full text-left px-3 py-2 hover:bg-muted flex flex-col gap-0"
            >
              <span className="text-sm font-medium truncate">{t.label}</span>
              {t.sub && <span className="text-xs text-muted-foreground truncate">{t.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
