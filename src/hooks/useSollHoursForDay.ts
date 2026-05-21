import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isoWeekParts, weekdayIndexMonFirst } from "@/lib/stundenTime";

interface SollResult {
  /** Soll-Arbeitsstunden für (Mitarbeiter, Tag) gemäß Modell. Bei 0 ist es ein freier Tag. */
  sollHours: number;
  /** "zimmerei_sommer" | "fix_40h" | "individuell" — woraus errechnet */
  source: "zimmerei_sommer" | "fix_40h" | "individuell" | "fallback";
  isLoading: boolean;
}

/**
 * Berechnet die Soll-Arbeitsstunden für einen bestimmten Tag eines Mitarbeiters,
 * gemäß seines Arbeitszeitmodells aus profile_konten_settings.
 *
 * - zimmerei_sommer: liest aus arbeitszeitkalender (jahr, kw) den Tageswert
 *   (soll_mo..soll_so). Deckt L/K-Wochen, Winter-40h, BU/Feiertage ab.
 * - fix_40h: Mo–Fr 8h, sonst 0.
 * - individuell: Mo–Fr tagesnorm_stunden, sonst 0.
 *
 * Wird mit dem Beschäftigungsgrad multipliziert (Teilzeit-Faktor).
 */
export function useSollHoursForDay(
  mitarbeiterId: string | null | undefined,
  date: string | null | undefined,
): SollResult {
  const [sollHours, setSollHours] = useState<number>(0);
  const [source, setSource] = useState<SollResult["source"]>("fallback");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!mitarbeiterId || !date) {
      setSollHours(0);
      setSource("fallback");
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      // 1. Settings laden
      const { data: settings } = await supabase
        .from("profile_konten_settings")
        .select("arbeitszeitmodell, tagesnorm_stunden, beschaeftigungsgrad")
        .eq("profile_id", mitarbeiterId)
        .maybeSingle();

      const modell = (settings?.arbeitszeitmodell ?? "zimmerei_sommer") as
        | "zimmerei_sommer"
        | "fix_40h"
        | "individuell";
      const tagesnorm = Number(settings?.tagesnorm_stunden ?? 8);
      const grad = Number(settings?.beschaeftigungsgrad ?? 1);

      const d = new Date(date + "T00:00:00");
      const wd = weekdayIndexMonFirst(d); // 0=Mo .. 6=So
      const isWorkday = wd <= 4; // Mo–Fr

      let hours = 0;
      let usedSource: SollResult["source"] = modell;

      if (modell === "zimmerei_sommer") {
        const { jahr, kw } = isoWeekParts(d);
        const { data: kal } = await supabase
          .from("arbeitszeitkalender")
          .select("soll_mo, soll_di, soll_mi, soll_do, soll_fr, soll_sa, soll_so")
          .eq("jahr", jahr)
          .eq("kw", kw)
          .maybeSingle();
        if (kal) {
          const map = [
            kal.soll_mo,
            kal.soll_di,
            kal.soll_mi,
            kal.soll_do,
            kal.soll_fr,
            kal.soll_sa,
            kal.soll_so,
          ];
          hours = Number(map[wd] ?? 0);
        } else {
          // Fallback bei fehlender Kalenderwoche: Tagesnorm Mo–Fr
          // (gleiche Logik wie konten.ts/tagesSoll).
          hours = isWorkday ? tagesnorm : 0;
          usedSource = "fallback";
        }
      } else if (modell === "fix_40h") {
        hours = isWorkday ? 8 : 0;
      } else {
        hours = isWorkday ? tagesnorm : 0;
      }

      hours = hours * grad;

      if (!cancelled) {
        setSollHours(hours);
        setSource(usedSource);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mitarbeiterId, date]);

  return { sollHours, source, isLoading };
}
