import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, TagStatus } from "@/integrations/supabase/types";

type StundenTag = Database["public"]["Tables"]["stunden_tage"]["Row"];
type StundenTaetigkeit = Database["public"]["Tables"]["stunden_taetigkeiten"]["Row"];
type StundenZulage = Database["public"]["Tables"]["stunden_zulagen"]["Row"];
type StundenFahrt = Database["public"]["Tables"]["stunden_fahrt"]["Row"];

export interface StundenTagFull {
  tag: StundenTag;
  taetigkeiten: StundenTaetigkeit[];
  zulagen: StundenZulage[];
  fahrt: StundenFahrt | null;
}

/** Ein typisierter Eintrag eines Tages (Baustelle/Firma/Krank/Urlaub/SW).
 *  Baustellen-Einträge haben zusätzlich baustelle_id + Tätigkeit. */
export interface SaveEintrag {
  position: number;
  art: TagStatus;
  taetigkeit_id: string | null;
  taetigkeit_freitext: string | null;
  baustelle_id: string | null;
  stunden: number;
  notiz: string | null;
}

export interface SaveZulage {
  zulagen_typ_id: string;
  stunden: number | null;
  notiz: string | null;
}

export interface SaveFahrt {
  fahrtgeld_eur: number;
  privat_pkw: boolean;
  km_gefahren: number | null;
  taggeld_kurz: number;
  taggeld_lang: number;
  taggeld_manuell: boolean;
}

export interface SaveStundenTagInput {
  id?: string;
  mitarbeiter_id: string;
  datum: string;
  arbeitsbeginn: string | null;
  anmerkung: string | null;
  /** Typisierte Einträge des Tages. tag_status + netto_stunden werden vom
   *  DB-Trigger daraus abgeleitet. */
  taetigkeiten: SaveEintrag[];
  zulagen: SaveZulage[];
  fahrt: SaveFahrt | null;
}

/** Liste der Stunden-Tage in einem Datums-Bereich (für TagBlocks + Auswertung). */
export function useStundenTageList(params: {
  fromDate: string;
  toDate?: string;
  mitarbeiterIds?: string[];
  enabled?: boolean;
}) {
  return useQuery<StundenTagFull[]>({
    queryKey: ["stunden_tage_list", params],
    queryFn: async () => {
      let q = supabase
        .from("stunden_tage")
        .select(
          `*,
           stunden_taetigkeiten(*),
           stunden_zulagen(*),
           stunden_fahrt(*)`,
        )
        .gte("datum", params.fromDate)
        .order("datum", { ascending: false });
      if (params.toDate) q = q.lte("datum", params.toDate);
      if (params.mitarbeiterIds && params.mitarbeiterIds.length > 0) {
        q = q.in("mitarbeiter_id", params.mitarbeiterIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return ((data as any[]) ?? []).map((row) => ({
        tag: {
          id: row.id,
          mitarbeiter_id: row.mitarbeiter_id,
          datum: row.datum,
          tag_status: row.tag_status,
          netto_stunden: Number(row.netto_stunden),
          vm_pause: row.vm_pause,
          mittag_pause: row.mittag_pause,
          arbeitsbeginn: row.arbeitsbeginn,
          anmerkung: row.anmerkung,
          status: row.status,
          erfasst_von: row.erfasst_von,
          bestaetigt_am: row.bestaetigt_am,
          freigegeben_zm_id: row.freigegeben_zm_id,
          freigegeben_zm_am: row.freigegeben_zm_am,
          freigegeben_buero_id: row.freigegeben_buero_id,
          freigegeben_buero_am: row.freigegeben_buero_am,
          abgelehnt_grund: row.abgelehnt_grund,
          created_at: row.created_at,
          updated_at: row.updated_at,
        } as StundenTag,
        taetigkeiten: ((row.stunden_taetigkeiten ?? []) as StundenTaetigkeit[]).sort(
          (a, b) => a.position - b.position,
        ),
        zulagen: (row.stunden_zulagen ?? []) as StundenZulage[],
        fahrt: (row.stunden_fahrt?.[0] ?? null) as StundenFahrt | null,
      }));
    },
    enabled: params.enabled ?? true,
    staleTime: 10_000,
  });
}

/** Save (Insert oder Update) eines kompletten Tages-Eintrags inkl. Children. */
export function useSaveStundenTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveStundenTagInput) => {
      let tagId = input.id;

      // tag_status + netto_stunden leitet der DB-Trigger aus den Einträgen
      // ab — beim Insert genügt ein provisorischer Status.
      const tagPayload: any = {
        mitarbeiter_id: input.mitarbeiter_id,
        datum: input.datum,
        tag_status: input.taetigkeiten[0]?.art ?? "baustelle",
        arbeitsbeginn: input.arbeitsbeginn,
        anmerkung: input.anmerkung,
      };

      if (tagId) {
        const { error } = await supabase
          .from("stunden_tage")
          .update(tagPayload)
          .eq("id", tagId);
        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from("stunden_tage")
          .insert({ ...tagPayload, erfasst_von: user?.id ?? null })
          .select("id")
          .single();
        if (error) throw error;
        tagId = data.id;
      }
      if (!tagId) throw new Error("Tag-ID fehlt nach Save");

      // Tätigkeiten komplett ersetzen
      await supabase.from("stunden_taetigkeiten").delete().eq("stunden_tag_id", tagId);
      if (input.taetigkeiten.length > 0) {
        const { error: tErr } = await supabase.from("stunden_taetigkeiten").insert(
          input.taetigkeiten.map((t, idx) => ({
            stunden_tag_id: tagId!,
            position: t.position || idx + 1,
            art: t.art,
            taetigkeit_id: t.taetigkeit_id,
            taetigkeit_freitext: t.taetigkeit_freitext,
            baustelle_id: t.baustelle_id,
            stunden: t.stunden,
            notiz: t.notiz,
          })),
        );
        if (tErr) throw tErr;
      }

      // Zulagen komplett ersetzen
      await supabase.from("stunden_zulagen").delete().eq("stunden_tag_id", tagId);
      if (input.zulagen.length > 0) {
        const { error: zErr } = await supabase.from("stunden_zulagen").insert(
          input.zulagen.map((z) => ({
            stunden_tag_id: tagId!,
            zulagen_typ_id: z.zulagen_typ_id,
            stunden: z.stunden,
            notiz: z.notiz,
          })),
        );
        if (zErr) throw zErr;
      }

      // Fahrt: upsert oder löschen
      if (input.fahrt) {
        const { error: fErr } = await supabase
          .from("stunden_fahrt")
          .upsert({ stunden_tag_id: tagId!, ...input.fahrt });
        if (fErr) throw fErr;
      } else {
        await supabase.from("stunden_fahrt").delete().eq("stunden_tag_id", tagId);
      }

      return tagId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stunden_tage_list"] });
    },
  });
}

/** Tag löschen (löscht auch Children via CASCADE). */
export function useDeleteStundenTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stunden_tage").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stunden_tage_list"] }),
  });
}

