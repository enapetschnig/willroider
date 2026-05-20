import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  Database,
  BerichtTyp,
  BerichtStatus,
} from "@/integrations/supabase/types";
import {
  ladeVorausfuellung,
  uebernehmeVorausfuellung,
} from "@/hooks/useBerichtVorausfuellung";

type Bericht = Database["public"]["Tables"]["berichte"]["Row"];
type BerichtMA = Database["public"]["Tables"]["bericht_mitarbeiter"]["Row"];
type BerichtTaet = Database["public"]["Tables"]["bericht_taetigkeiten"]["Row"];
type BerichtAuf = Database["public"]["Tables"]["bericht_aufmass"]["Row"];
type BerichtFoto = Database["public"]["Tables"]["bericht_fotos"]["Row"];
type BerichtAend = Database["public"]["Tables"]["bericht_aenderungen"]["Row"];

export interface BerichtFull {
  bericht: Bericht;
  mitarbeiter: BerichtMA[];
  taetigkeiten: BerichtTaet[];
  aufmass: BerichtAuf[];
  fotos: BerichtFoto[];
  aenderungen: BerichtAend[];
}

export function useBericht(id: string | null | undefined) {
  return useQuery<BerichtFull | null>({
    queryKey: ["bericht", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("berichte")
        .select(
          `*,
           bericht_mitarbeiter(*),
           bericht_taetigkeiten(*),
           bericht_aufmass(*),
           bericht_fotos(*),
           bericht_aenderungen(*)`,
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as any;
      return {
        bericht: {
          id: row.id,
          baustelle_id: row.baustelle_id,
          datum: row.datum,
          typ: row.typ,
          status: row.status,
          erfasst_von: row.erfasst_von,
          eingereicht_am: row.eingereicht_am,
          freigegeben_von: row.freigegeben_von,
          freigegeben_am: row.freigegeben_am,
          archiviert_am: row.archiviert_am,
          wetter_beschreibung: row.wetter_beschreibung,
          temperatur_min: row.temperatur_min,
          temperatur_max: row.temperatur_max,
          niederschlag_mm: row.niederschlag_mm,
          wetter_quelle: row.wetter_quelle,
          freitext_besonderheiten: row.freitext_besonderheiten,
          zeiterfassung_quelle_am: row.zeiterfassung_quelle_am,
          pdf_dokument_id: row.pdf_dokument_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        } as Bericht,
        mitarbeiter: ((row.bericht_mitarbeiter ?? []) as BerichtMA[]).sort(
          (a, b) => a.position - b.position,
        ),
        taetigkeiten: ((row.bericht_taetigkeiten ?? []) as BerichtTaet[]).sort(
          (a, b) => a.position - b.position,
        ),
        aufmass: ((row.bericht_aufmass ?? []) as BerichtAuf[]).sort(
          (a, b) => a.position - b.position,
        ),
        fotos: ((row.bericht_fotos ?? []) as BerichtFoto[]).sort(
          (a, b) => a.position - b.position,
        ),
        aenderungen: ((row.bericht_aenderungen ?? []) as BerichtAend[]).sort(
          (a, b) => b.zeitpunkt.localeCompare(a.zeitpunkt),
        ),
      };
    },
    enabled: !!id,
  });
}

export function useUpdateBerichtFelder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; patch: Partial<Bericht> }) => {
      const { error } = await supabase
        .from("berichte")
        .update(payload.patch)
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["bericht", vars.id] });
      qc.invalidateQueries({ queryKey: ["berichte_list"] });
    },
  });
}

export function useSetBerichtStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; newStatus: BerichtStatus }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const patch: any = { status: payload.newStatus };
      if (payload.newStatus === "eingereicht") patch.eingereicht_am = now;
      if (payload.newStatus === "freigegeben") {
        patch.freigegeben_von = user?.id ?? null;
        patch.freigegeben_am = now;
      }
      if (payload.newStatus === "archiviert") patch.archiviert_am = now;
      if (payload.newStatus === "entwurf") {
        patch.eingereicht_am = null;
        patch.freigegeben_von = null;
        patch.freigegeben_am = null;
        patch.archiviert_am = null;
      }
      const { error } = await supabase
        .from("berichte")
        .update(patch)
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["bericht", vars.id] });
      qc.invalidateQueries({ queryKey: ["berichte_list"] });
    },
  });
}

/** Erstellt oder findet einen Bericht für (baustelle, datum, typ).
 *  Race-sicher: bei UNIQUE-Konflikt (zwei User gleichzeitig) wird der bestehende
 *  Eintrag nachträglich gelesen. */
export async function findeOderErstelleBericht(
  baustelleId: string,
  datum: string,
  typ: BerichtTyp,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabase
    .from("berichte")
    .select("id")
    .eq("baustelle_id", baustelleId)
    .eq("datum", datum)
    .eq("typ", typ)
    .maybeSingle();
  if (existing) return { id: existing.id, created: false };

  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("berichte")
    .insert({
      baustelle_id: baustelleId,
      datum,
      typ,
      erfasst_von: user?.id ?? null,
    })
    .select("id")
    .single();
  if (!error) return { id: data.id, created: true };

  // 23505 = unique_violation — anderer User war schneller. Bestehenden lesen.
  if ((error as any).code === "23505") {
    const { data: again } = await supabase
      .from("berichte")
      .select("id")
      .eq("baustelle_id", baustelleId)
      .eq("datum", datum)
      .eq("typ", typ)
      .maybeSingle();
    if (again) return { id: again.id, created: false };
  }
  throw error;
}

/** Erstellt oder findet einen Bericht und befüllt — bei neu erstelltem
 *  Bericht — direkt MA + Tätigkeiten aus der Zeiterfassung (sofern vorhanden).
 *  Wird sowohl aus Berichte.tsx als auch aus MeinTag.tsx aufgerufen, damit der
 *  Auto-Import nicht erst im Detail-View greift. */
export async function findeOderErstelleBerichtMitVorausfuellung(
  baustelleId: string,
  datum: string,
  typ: BerichtTyp,
): Promise<{ id: string; created: boolean; importiert: number }> {
  const r = await findeOderErstelleBericht(baustelleId, datum, typ);
  let importiert = 0;
  if (r.created) {
    try {
      const vf = await ladeVorausfuellung(baustelleId, datum);
      if (vf.mitarbeiter.length > 0 || vf.taetigkeiten.length > 0) {
        await uebernehmeVorausfuellung(r.id, vf);
        importiert = vf.mitarbeiter.length;
      }
    } catch {
      /* Vorausfüllung optional — Bericht ist trotzdem angelegt. */
    }
  }
  return { ...r, importiert };
}
