import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type TaetigkeitStamm = Database["public"]["Tables"]["taetigkeiten_stamm"]["Row"];
type ZulageTyp = Database["public"]["Tables"]["zulagen_typen"]["Row"];
type PausenConfigRow = Database["public"]["Tables"]["pausen_config"]["Row"];
type ArbeitszeitLimitsRow = Database["public"]["Tables"]["arbeitszeit_limits"]["Row"];

// ─── Tätigkeiten-Stammdaten ────────────────────────────────────────────────

export function useTaetigkeitenStamm(opts?: {
  onlyActive?: boolean;
  /** Filtert auf Tätigkeiten dieses Bereichs (plus 'beide'). Ohne Filter
   *  werden alle Tätigkeiten geliefert — sinnvoll im BSB-Editor, wo
   *  bestehende Buchungen aus Halle UND Baustelle erscheinen können. */
  bereich?: "baustelle" | "halle";
}) {
  const onlyActive = opts?.onlyActive ?? true;
  const bereich = opts?.bereich;
  return useQuery<TaetigkeitStamm[]>({
    queryKey: ["taetigkeiten_stamm", { onlyActive, bereich }],
    queryFn: async () => {
      let q = supabase
        .from("taetigkeiten_stamm")
        .select("*")
        .order("sort_order")
        .order("bezeichnung");
      if (onlyActive) q = q.eq("is_active", true);
      if (bereich) q = q.in("bereich", [bereich, "beide"]);
      const { data, error } = await q;
      if (error) throw error;
      return (data as TaetigkeitStamm[]) ?? [];
    },
    staleTime: 60_000,
  });
}

export function useTaetigkeitMutation() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: async (payload: {
        bezeichnung: string;
        sort_order?: number;
        bereich?: "baustelle" | "halle" | "beide";
      }) => {
        const { data, error } = await supabase
          .from("taetigkeiten_stamm")
          .insert({
            bezeichnung: payload.bezeichnung,
            sort_order: payload.sort_order ?? 0,
            bereich: payload.bereich ?? "baustelle",
          })
          .select()
          .single();
        if (error) throw error;
        return data;
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: ["taetigkeiten_stamm"] }),
    }),
    update: useMutation({
      mutationFn: async (payload: {
        id: string;
        bezeichnung?: string;
        sort_order?: number;
        is_active?: boolean;
        bereich?: "baustelle" | "halle" | "beide";
      }) => {
        const { id, ...rest } = payload;
        const { error } = await supabase
          .from("taetigkeiten_stamm")
          .update(rest)
          .eq("id", id);
        if (error) throw error;
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: ["taetigkeiten_stamm"] }),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase
          .from("taetigkeiten_stamm")
          .delete()
          .eq("id", id);
        if (error) throw error;
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: ["taetigkeiten_stamm"] }),
    }),
  };
}

// ─── Zulagen-Stammdaten ────────────────────────────────────────────────────

export function useZulagenTypen(opts?: { onlyActive?: boolean }) {
  const onlyActive = opts?.onlyActive ?? true;
  return useQuery<ZulageTyp[]>({
    queryKey: ["zulagen_typen", { onlyActive }],
    queryFn: async () => {
      let q = supabase
        .from("zulagen_typen")
        .select("*")
        .order("sort_order")
        .order("bezeichnung");
      if (onlyActive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data as ZulageTyp[]) ?? [];
    },
    staleTime: 60_000,
  });
}

export function useZulageMutation() {
  const qc = useQueryClient();
  return {
    create: useMutation({
      mutationFn: async (payload: {
        bezeichnung: string;
        sort_order?: number;
        ermoeglicht_stunden_split?: boolean;
      }) => {
        const { data, error } = await supabase
          .from("zulagen_typen")
          .insert({
            bezeichnung: payload.bezeichnung,
            sort_order: payload.sort_order ?? 0,
            ermoeglicht_stunden_split: payload.ermoeglicht_stunden_split ?? true,
          })
          .select()
          .single();
        if (error) throw error;
        return data;
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: ["zulagen_typen"] }),
    }),
    update: useMutation({
      mutationFn: async (payload: {
        id: string;
        bezeichnung?: string;
        sort_order?: number;
        is_active?: boolean;
        ermoeglicht_stunden_split?: boolean;
      }) => {
        const { id, ...rest } = payload;
        const { error } = await supabase
          .from("zulagen_typen")
          .update(rest)
          .eq("id", id);
        if (error) throw error;
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: ["zulagen_typen"] }),
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase
          .from("zulagen_typen")
          .delete()
          .eq("id", id);
        if (error) throw error;
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: ["zulagen_typen"] }),
    }),
  };
}

// ─── MA-Zulagen-Zuordnung ──────────────────────────────────────────────────

/**
 * Liefert die zulage_typ_ids, die der gegebene Mitarbeiter erhalten darf.
 */
export function useMitarbeiterZulagen(mitarbeiterId: string | null | undefined) {
  return useQuery<string[]>({
    queryKey: ["mitarbeiter_zulagen", mitarbeiterId],
    queryFn: async () => {
      if (!mitarbeiterId) return [];
      const { data, error } = await supabase
        .from("mitarbeiter_zulagen")
        .select("zulagen_typ_id")
        .eq("mitarbeiter_id", mitarbeiterId);
      if (error) throw error;
      return (data ?? []).map((r) => r.zulagen_typ_id);
    },
    enabled: !!mitarbeiterId,
  });
}

export function useMitarbeiterZulagenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      mitarbeiter_id: string;
      zulagen_typ_ids: string[];
    }) => {
      const { mitarbeiter_id, zulagen_typ_ids } = payload;
      // Bestehende komplett ersetzen → einfacher als Diff
      const { error: delErr } = await supabase
        .from("mitarbeiter_zulagen")
        .delete()
        .eq("mitarbeiter_id", mitarbeiter_id);
      if (delErr) throw delErr;
      if (zulagen_typ_ids.length === 0) return;
      const rows = zulagen_typ_ids.map((tid) => ({
        mitarbeiter_id,
        zulagen_typ_id: tid,
      }));
      const { error: insErr } = await supabase
        .from("mitarbeiter_zulagen")
        .insert(rows);
      if (insErr) throw insErr;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["mitarbeiter_zulagen", vars.mitarbeiter_id] });
    },
  });
}

// ─── Pausen-Config ─────────────────────────────────────────────────────────

export function usePausenConfig() {
  return useQuery<{ vm: PausenConfigRow; mittag: PausenConfigRow }>({
    queryKey: ["pausen_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pausen_config").select("*");
      if (error) throw error;
      const map = new Map(((data as PausenConfigRow[]) ?? []).map((r) => [r.typ, r]));
      const vm = map.get("vormittag")!;
      const mittag = map.get("mittag")!;
      return { vm, mittag };
    },
    staleTime: 60_000,
  });
}

export function usePausenConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      typ: "vormittag" | "mittag";
      dauer_minuten?: number;
      default_aktiv?: boolean;
    }) => {
      const { typ, ...rest } = payload;
      const { error } = await supabase
        .from("pausen_config")
        .update(rest)
        .eq("typ", typ);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pausen_config"] }),
  });
}

// ─── Arbeitszeit-Limits ────────────────────────────────────────────────────

export function useArbeitszeitLimits() {
  return useQuery<ArbeitszeitLimitsRow>({
    queryKey: ["arbeitszeit_limits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("arbeitszeit_limits")
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("arbeitszeit_limits row missing — Migration prüfen");
      return data as ArbeitszeitLimitsRow;
    },
    staleTime: 60_000,
  });
}

export function useArbeitszeitLimitsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Omit<ArbeitszeitLimitsRow, "id" | "updated_at">>) => {
      const { error } = await supabase
        .from("arbeitszeit_limits")
        .update(payload)
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["arbeitszeit_limits"] }),
  });
}
