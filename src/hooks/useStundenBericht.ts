import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, StundenBerichtStatus } from "@/integrations/supabase/types";

export type StundenBericht = Database["public"]["Tables"]["stunden_berichte"]["Row"];
export type StundenBerichtAenderung =
  Database["public"]["Tables"]["stunden_bericht_aenderungen"]["Row"];

export interface BerichtMa {
  id: string;
  vorname: string | null;
  nachname: string | null;
  pers_nr: string | null;
}

export interface StundenBerichtMitMa extends StundenBericht {
  mitarbeiter: BerichtMa | null;
}

export interface StundenBerichtFull extends StundenBerichtMitMa {
  aenderungen: StundenBerichtAenderung[];
  eintrittsdatum: string | null;
}

/** Liste der Berichte (für Kontroll-Liste + Dashboard-Karte). */
export function useStundenBerichteList(params: {
  jahr?: number;
  monat?: number;
  teil?: number;
  mitarbeiterId?: string;
  status?: StundenBerichtStatus | StundenBerichtStatus[];
  enabled?: boolean;
}) {
  return useQuery<StundenBerichtMitMa[]>({
    queryKey: ["stunden_berichte", params],
    queryFn: async () => {
      let q = supabase
        .from("stunden_berichte")
        .select(
          `*, mitarbeiter:profiles!mitarbeiter_id(id, vorname, nachname, pers_nr)`,
        )
        .order("jahr", { ascending: false })
        .order("monat", { ascending: false })
        .order("teil", { ascending: true });
      if (params.jahr) q = q.eq("jahr", params.jahr);
      if (params.monat) q = q.eq("monat", params.monat);
      if (params.teil) q = q.eq("teil", params.teil);
      if (params.mitarbeiterId) q = q.eq("mitarbeiter_id", params.mitarbeiterId);
      if (params.status) {
        q = Array.isArray(params.status)
          ? q.in("status", params.status)
          : q.eq("status", params.status);
      }
      const { data, error } = await q;
      if (error) throw error;
      return ((data as any[]) ?? []) as StundenBerichtMitMa[];
    },
    enabled: params.enabled ?? true,
    staleTime: 10_000,
  });
}

/** Einzelbericht inkl. Audit-Log + Eintrittsdatum des Mitarbeiters. */
export function useStundenBericht(id: string | undefined) {
  return useQuery<StundenBerichtFull | null>({
    queryKey: ["stunden_bericht", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stunden_berichte")
        .select(
          `*,
           mitarbeiter:profiles!mitarbeiter_id(id, vorname, nachname, pers_nr),
           aenderungen:stunden_bericht_aenderungen(*)`,
        )
        .eq("id", id!)
        .single();
      if (error) throw error;
      const row = data as any;

      let eintrittsdatum: string | null = null;
      if (row?.mitarbeiter_id) {
        const { data: pks } = await supabase
          .from("profile_konten_settings")
          .select("eintrittsdatum")
          .eq("profile_id", row.mitarbeiter_id)
          .maybeSingle();
        eintrittsdatum = (pks as any)?.eintrittsdatum ?? null;
      }

      row.aenderungen = ((row.aenderungen ?? []) as StundenBerichtAenderung[]).sort(
        (a, b) => b.zeitpunkt.localeCompare(a.zeitpunkt),
      );
      row.eintrittsdatum = eintrittsdatum;
      return row as StundenBerichtFull;
    },
    enabled: !!id,
  });
}

/** Schreibt eine Audit-Zeile (z.B. nach einer Tages-Bearbeitung). */
export async function logBerichtAenderung(
  berichtId: string,
  art: string,
  details: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("stunden_bericht_aenderungen").insert({
    stunden_bericht_id: berichtId,
    autor_id: user?.id ?? null,
    art,
    details,
  });
}

/** Workflow-Aktionen — alle laufen über SECURITY-DEFINER-RPCs. */
export function useStundenBerichtAktionen() {
  const qc = useQueryClient();
  const inval = () => {
    qc.invalidateQueries({ queryKey: ["stunden_berichte"] });
    qc.invalidateQueries({ queryKey: ["stunden_bericht"] });
  };

  const erzeugen = useMutation({
    mutationFn: async (p: { jahr: number; monat: number; teil: number }) => {
      const { data, error } = await supabase.rpc("stunden_bericht_erzeugen" as any, {
        p_jahr: p.jahr,
        p_monat: p.monat,
        p_teil: p.teil,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: inval,
  });

  const unterschreiben = useMutation({
    mutationFn: async (p: { id: string; unterschrift: string }) => {
      const { error } = await supabase.rpc("stunden_bericht_unterschreiben" as any, {
        p_id: p.id,
        p_unterschrift: p.unterschrift,
      });
      if (error) throw error;
    },
    onSuccess: inval,
  });

  const bestaetigen = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("stunden_bericht_bestaetigen" as any, {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: inval,
  });

  const wiederOeffnen = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("stunden_bericht_wieder_oeffnen" as any, {
        p_id: id,
      });
      if (error) throw error;
    },
    onSuccess: inval,
  });

  const loeschen = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stunden_berichte").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: inval,
  });

  return { erzeugen, unterschreiben, bestaetigen, wiederOeffnen, loeschen };
}
