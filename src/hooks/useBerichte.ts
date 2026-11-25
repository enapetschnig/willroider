import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, BerichtTyp, BerichtStatus } from "@/integrations/supabase/types";

type Bericht = Database["public"]["Tables"]["berichte"]["Row"];

export interface BerichteFilter {
  baustelleId?: string;
  fromDate?: string;
  toDate?: string;
  status?: BerichtStatus;
  typ?: BerichtTyp;
  polierId?: string;
}

export function useBerichteList(filter: BerichteFilter = {}) {
  return useQuery<Bericht[]>({
    queryKey: ["berichte_list", filter],
    queryFn: async () => {
      let q = supabase
        .from("berichte")
        .select("*")
        .order("datum", { ascending: false })
        .order("created_at", { ascending: false });
      if (filter.baustelleId) q = q.eq("baustelle_id", filter.baustelleId);
      if (filter.fromDate) q = q.gte("datum", filter.fromDate);
      if (filter.toDate) q = q.lte("datum", filter.toDate);
      if (filter.status) q = q.eq("status", filter.status);
      if (filter.typ) q = q.eq("typ", filter.typ);
      if (filter.polierId) q = q.eq("erfasst_von", filter.polierId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as Bericht[]) ?? [];
    },
    staleTime: 10_000,
  });
}

/** Mehrere Regieberichte am selben Tag und auf derselben Baustelle bekommen eine
 *  laufende Nummer (älteste = 1, bei gleicher Zeit nach id) — dieselbe Regel wie
 *  im Bericht (`ladeRegieberichteAmTag`). Seit 25.11.2026 (J. Maurer). */
export function regieNummern(
  liste: { id: string; typ: string; baustelle_id: string; datum: string; created_at: string }[],
): Map<string, number> {
  const gruppen = new Map<string, { id: string; created_at: string }[]>();
  for (const b of liste) {
    if (b.typ !== "regiebericht") continue;
    const k = `${b.baustelle_id}|${b.datum}`;
    gruppen.set(k, [...(gruppen.get(k) ?? []), b]);
  }
  const nr = new Map<string, number>();
  for (const g of gruppen.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    g.forEach((b, i) => nr.set(b.id, i + 1));
  }
  return nr;
}

/** Nr. der Regieberichte einer (gefilterten) Liste — gezählt über alle
 *  Regieberichte derselben Baustellen und Tage, unabhängig von Status-,
 *  Polier- oder sonstigem Filter. */
export function useRegieNummern(berichte: Bericht[]): Map<string, number> {
  const regie = berichte.filter((b) => b.typ === "regiebericht");
  const baustellen = [...new Set(regie.map((b) => b.baustelle_id))].sort();
  const tage = [...new Set(regie.map((b) => b.datum))].sort();
  const { data } = useQuery({
    queryKey: ["regie_nummern", baustellen, tage, regie.map((b) => b.id).sort()],
    enabled: regie.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("berichte")
        .select("id, typ, baustelle_id, datum, created_at")
        .eq("typ", "regiebericht")
        .in("baustelle_id", baustellen)
        .in("datum", tage);
      if (error) throw error;
      return regieNummern((data ?? []) as Bericht[]);
    },
    staleTime: 10_000,
  });
  return data ?? new Map<string, number>();
}
