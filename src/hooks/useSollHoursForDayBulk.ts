import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isoWeekParts, weekdayIndexMonFirst } from "@/lib/stundenTime";

/**
 * Bulk-Variante von useSollHoursForDay: berechnet Soll-Arbeitsstunden für
 * mehrere MA an einem Datum in einer Query — für die Polier-Bulk-Ansicht.
 *
 * Liefert Map<mitarbeiterId, sollStunden>.
 * Fallback bei fehlenden Settings: zimmerei_sommer, 8h tagesnorm, grad=1.
 */
export function useSollHoursForDayBulk(
  mitarbeiterIds: string[],
  date: string | null | undefined,
): { sollPerMa: Map<string, number>; isLoading: boolean } {
  const sortedIds = [...mitarbeiterIds].sort();
  const { data, isLoading } = useQuery({
    queryKey: ["soll_bulk", date, sortedIds],
    queryFn: async (): Promise<Map<string, number>> => {
      const result = new Map<string, number>();
      if (!date || mitarbeiterIds.length === 0) return result;

      const d = new Date(date + "T00:00:00");
      const wd = weekdayIndexMonFirst(d);
      const isWorkday = wd <= 4;

      const { data: settings } = await supabase
        .from("profile_konten_settings")
        .select("profile_id, arbeitszeitmodell, tagesnorm_stunden, beschaeftigungsgrad")
        .in("profile_id", mitarbeiterIds);

      const settingsMap = new Map<string, any>();
      (settings ?? []).forEach((s: any) => settingsMap.set(s.profile_id, s));

      const needsKalender = mitarbeiterIds.some((id) => {
        const s = settingsMap.get(id);
        return (s?.arbeitszeitmodell ?? "zimmerei_sommer") === "zimmerei_sommer";
      });

      let kalenderTagesStunden: number | null = null;
      if (needsKalender) {
        const { jahr, kw } = isoWeekParts(d);
        const { data: kal } = await supabase
          .from("arbeitszeitkalender")
          .select("soll_mo, soll_di, soll_mi, soll_do, soll_fr, soll_sa, soll_so")
          .eq("jahr", jahr)
          .eq("kw", kw)
          .maybeSingle();
        if (kal) {
          const arr = [
            kal.soll_mo,
            kal.soll_di,
            kal.soll_mi,
            kal.soll_do,
            kal.soll_fr,
            kal.soll_sa,
            kal.soll_so,
          ];
          kalenderTagesStunden = Number(arr[wd] ?? 0);
        }
      }

      for (const id of mitarbeiterIds) {
        const s = settingsMap.get(id);
        const modell = (s?.arbeitszeitmodell ?? "zimmerei_sommer") as
          | "zimmerei_sommer"
          | "fix_40h"
          | "individuell";
        const tagesnorm = Number(s?.tagesnorm_stunden ?? 8);
        const grad = Number(s?.beschaeftigungsgrad ?? 1);

        let hours = 0;
        if (modell === "zimmerei_sommer") {
          hours = kalenderTagesStunden != null
            ? kalenderTagesStunden
            : isWorkday
            ? 8
            : 0;
        } else if (modell === "fix_40h") {
          hours = isWorkday ? 8 : 0;
        } else {
          hours = isWorkday ? tagesnorm : 0;
        }
        result.set(id, hours * grad);
      }
      return result;
    },
    enabled: !!date && mitarbeiterIds.length > 0,
  });

  return {
    sollPerMa: data ?? new Map<string, number>(),
    isLoading,
  };
}
