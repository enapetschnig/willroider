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
  ladeEinteilungVorausfuellung,
  uebernehmeEinteilungVorausfuellung,
} from "@/hooks/useBerichtVorausfuellung";

type Bericht = Database["public"]["Tables"]["berichte"]["Row"];
type BerichtMA = Database["public"]["Tables"]["bericht_mitarbeiter"]["Row"];
type BerichtTaet = Database["public"]["Tables"]["bericht_taetigkeiten"]["Row"];
type BerichtAuf = Database["public"]["Tables"]["bericht_aufmass"]["Row"];
type BerichtFoto = Database["public"]["Tables"]["bericht_fotos"]["Row"];
type BerichtAend = Database["public"]["Tables"]["bericht_aenderungen"]["Row"];

/** Unterschrift am Bericht — Polier und/oder Kunde, beide freiwillig. */
export interface BerichtUnterschrift {
  id: string;
  bericht_id: string;
  rolle: "polier" | "kunde";
  name: string | null;
  unterschrift_data: string;
  unterschrieben_von: string | null;
  unterschrieben_am: string;
}

export interface BerichtFull {
  bericht: Bericht;
  mitarbeiter: BerichtMA[];
  taetigkeiten: BerichtTaet[];
  aufmass: BerichtAuf[];
  fotos: BerichtFoto[];
  aenderungen: BerichtAend[];
  unterschriften: BerichtUnterschrift[];
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
           bericht_aenderungen(*),
           bericht_unterschriften(*)`,
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
        unterschriften: (row.bericht_unterschriften ?? []) as BerichtUnterschrift[],
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

/** Löscht einen kompletten Bericht inkl. Children (CASCADE), Foto-/PDF-
 *  Dokumente und deren Storage-Dateien. Nur für Admin (RLS). */
export function useDeleteBericht() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Foto- + PDF-Dokumente einsammeln
      const [{ data: fotos }, { data: b }] = await Promise.all([
        supabase.from("bericht_fotos").select("dokument_id").eq("bericht_id", id),
        supabase
          .from("berichte")
          .select("pdf_dokument_id")
          .eq("id", id)
          .maybeSingle(),
      ]);
      let dokIds: string[] = [
        ...((fotos ?? []) as any[]).map((f) => f.dokument_id).filter(Boolean),
        ...((b as any)?.pdf_dokument_id ? [(b as any).pdf_dokument_id] : []),
      ];
      // Fotos, die auch in einem anderen Bericht hängen (z. B. Regiebericht
      // aus Bautagesbericht übernommen), nicht mitlöschen.
      if (dokIds.length > 0) {
        const { data: geteilt } = await supabase
          .from("bericht_fotos")
          .select("dokument_id")
          .in("dokument_id", dokIds)
          .neq("bericht_id", id);
        const behalten = new Set(((geteilt ?? []) as any[]).map((g) => g.dokument_id));
        dokIds = dokIds.filter((d) => !behalten.has(d));
      }
      // Storage-Dateien best-effort entfernen
      if (dokIds.length > 0) {
        const { data: docs } = await supabase
          .from("dokumente")
          .select("storage_path")
          .in("id", dokIds);
        const paths = ((docs ?? []) as any[])
          .map((d) => d.storage_path)
          .filter(Boolean);
        if (paths.length > 0) {
          try {
            await supabase.storage.from("baustellen").remove(paths);
          } catch {
            /* Storage-Cleanup ist best-effort — blockiert das Löschen nicht */
          }
        }
      }
      // Bericht löschen — Children (bericht_mitarbeiter/-taetigkeiten/-aufmass/
      // -fotos/-aenderungen) werden via ON DELETE CASCADE mitgelöscht.
      const { error } = await supabase.from("berichte").delete().eq("id", id);
      if (error) throw error;
      // Verwaiste dokumente-Zeilen aufräumen
      if (dokIds.length > 0) {
        await supabase.from("dokumente").delete().in("id", dokIds);
      }
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["bericht", id] });
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

/** Regieberichte einer Baustelle an einem Tag, älteste zuerst. Seit
 *  25.11.2026 darf es davon mehrere geben (J. Maurer). */
export async function ladeRegieberichteAmTag(
  baustelleId: string,
  datum: string,
): Promise<{ id: string; status: BerichtStatus; created_at: string }[]> {
  const { data, error } = await supabase
    .from("berichte")
    .select("id, status, created_at")
    .eq("baustelle_id", baustelleId)
    .eq("datum", datum)
    .eq("typ", "regiebericht")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return (data ?? []) as { id: string; status: BerichtStatus; created_at: string }[];
}

/** Erstellt oder findet einen Bericht für (baustelle, datum, typ).
 *  Bautagesbericht: einmal je Baustelle und Tag — race-sicher, bei
 *  UNIQUE-Konflikt wird der bestehende gelesen.
 *  Regiebericht: mehrere je Tag erlaubt — mit `neu: true` wird immer ein
 *  weiterer angelegt, sonst der älteste vorhandene geöffnet. */
export async function findeOderErstelleBericht(
  baustelleId: string,
  datum: string,
  typ: BerichtTyp,
  opts: { neu?: boolean } = {},
): Promise<{ id: string; created: boolean }> {
  const suche = async () => {
    const { data } = await supabase
      .from("berichte")
      .select("id")
      .eq("baustelle_id", baustelleId)
      .eq("datum", datum)
      .eq("typ", typ)
      .order("created_at")
      .limit(1);
    return ((data ?? [])[0] as { id: string } | undefined) ?? null;
  };
  if (!(opts.neu && typ === "regiebericht")) {
    const existing = await suche();
    if (existing) return { id: existing.id, created: false };
  }

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
    const again = await suche();
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
  opts: { neu?: boolean } = {},
): Promise<{ id: string; created: boolean; importiert: number; ausPlan: number }> {
  const r = await findeOderErstelleBericht(baustelleId, datum, typ, opts);
  let importiert = 0;
  let ausPlan = 0;
  if (r.created) {
    try {
      const vf = await ladeVorausfuellung(baustelleId, datum);
      if (vf.mitarbeiter.length > 0 || vf.taetigkeiten.length > 0) {
        await uebernehmeVorausfuellung(r.id, vf);
        importiert = vf.mitarbeiter.length;
      } else if (typ === "bautagesbericht") {
        // Noch keine Stunden gebucht (Bericht wird in der Früh angelegt):
        // grob aus dem Tagesplan vorbelegen — Leute und geplante Tätigkeit.
        const plan = await ladeEinteilungVorausfuellung(baustelleId, datum);
        ausPlan = await uebernehmeEinteilungVorausfuellung(r.id, plan);
      }
    } catch {
      /* Vorausfüllung optional — Bericht ist trotzdem angelegt. */
    }
  }
  return { ...r, importiert, ausPlan };
}

/** Legt aus einem Bautagesbericht einen Regiebericht für denselben Tag und
 *  dieselbe Baustelle an und übernimmt Wetter, Besonderheiten, Mitarbeiter,
 *  Tätigkeiten, Aufmaß und Fotos (Fotos verweisen auf dieselben Dateien).
 *  Unterschriften werden nicht übernommen (J. Maurer, 17.11.2026). Legt immer
 *  einen neuen an — ob schon Regieberichte für den Tag da sind, fragt die
 *  Oberfläche vorher (`ladeRegieberichteAmTag`, mehrere je Tag seit 25.11.2026). */
export async function uebernehmeInRegiebericht(
  quelleId: string,
  opts: { alsAdmin: boolean },
): Promise<{ id: string; created: boolean }> {
  const { data: q, error: qErr } = await supabase
    .from("berichte")
    .select("*")
    .eq("id", quelleId)
    .single();
  if (qErr) throw qErr;
  const quelle = q as any;

  const { data: { user } } = await supabase.auth.getUser();
  // Admin übernimmt für den Polier: der Regiebericht gehört dann ihm, damit
  // er ihn selbst weiterschreiben kann. Sonst gehört er dem, der übernimmt.
  const erfasstVon = opts.alsAdmin ? quelle.erfasst_von ?? user?.id ?? null : user?.id ?? null;
  const { data: neu, error: insErr } = await supabase
    .from("berichte")
    .insert({
      baustelle_id: quelle.baustelle_id,
      datum: quelle.datum,
      typ: "regiebericht",
      erfasst_von: erfasstVon,
      wetter_beschreibung: quelle.wetter_beschreibung,
      temperatur_min: quelle.temperatur_min,
      temperatur_max: quelle.temperatur_max,
      niederschlag_mm: quelle.niederschlag_mm,
      wetter_quelle: quelle.wetter_quelle,
      freitext_besonderheiten: quelle.freitext_besonderheiten,
      zeiterfassung_quelle_am: quelle.zeiterfassung_quelle_am,
      einteilung_quelle_am: quelle.einteilung_quelle_am ?? null,
    } as any)
    .select("id")
    .single();
  if (insErr) throw insErr;
  const zielId = neu.id as string;

  const ohne = (row: any, ...keys: string[]) => {
    const r = { ...row };
    for (const k of ["id", "bericht_id", "created_at", "updated_at", ...keys]) delete r[k];
    return r;
  };

  try {
    const [{ data: mas }, { data: taets }, { data: aufs }, { data: fotos }] = await Promise.all([
      supabase.from("bericht_mitarbeiter").select("*").eq("bericht_id", quelleId),
      supabase.from("bericht_taetigkeiten").select("*").eq("bericht_id", quelleId),
      supabase.from("bericht_aufmass").select("*").eq("bericht_id", quelleId),
      supabase.from("bericht_fotos").select("*").eq("bericht_id", quelleId),
    ]);

    if ((mas ?? []).length > 0) {
      const { error } = await supabase
        .from("bericht_mitarbeiter")
        .insert((mas as any[]).map((m) => ({ ...ohne(m), bericht_id: zielId })));
      if (error) throw error;
    }
    if ((taets ?? []).length > 0) {
      const { error } = await supabase
        .from("bericht_taetigkeiten")
        .insert((taets as any[]).map((t) => ({ ...ohne(t), bericht_id: zielId })));
      if (error) throw error;
    }
    // Aufmaß einzeln, damit Fotos ihre Aufmaß-Position behalten
    const aufMap = new Map<string, string>();
    for (const a of (aufs ?? []) as any[]) {
      const { data: na, error } = await supabase
        .from("bericht_aufmass")
        .insert({ ...ohne(a), bericht_id: zielId })
        .select("id")
        .single();
      if (error) throw error;
      aufMap.set(a.id, (na as any).id);
    }
    if ((fotos ?? []).length > 0) {
      const { error } = await supabase.from("bericht_fotos").insert(
        (fotos as any[]).map((f) => ({
          ...ohne(f),
          bericht_id: zielId,
          aufmass_position_id: f.aufmass_position_id
            ? aufMap.get(f.aufmass_position_id) ?? null
            : null,
        })),
      );
      if (error) throw error;
    }

    const d = new Date(quelle.datum).toLocaleDateString("de-AT");
    await supabase.from("bericht_aenderungen").insert({
      bericht_id: zielId,
      autor_id: user?.id ?? null,
      art: "vorausfuellung",
      details: `Aus Bautagesbericht vom ${d} übernommen (${(mas ?? []).length} MA, ${(taets ?? []).length} Tätigkeiten, ${(aufs ?? []).length} Aufmaß, ${(fotos ?? []).length} Fotos)`,
    });
  } catch (e) {
    // Halb kopiert soll nicht liegen bleiben — der Nutzer kann es nochmal probieren.
    await supabase.from("berichte").delete().eq("id", zielId);
    throw e;
  }

  return { id: zielId, created: true };
}
