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
