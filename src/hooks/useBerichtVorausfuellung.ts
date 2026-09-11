/**
 * Lädt die Stunden-Tage + Tätigkeiten für (baustelle, datum) aus der
 * Zeiterfassung (Phase A) und aggregiert sie zu vorgeschlagenen
 * Bericht-Inhalten: MA-Liste mit Summen + Tätigkeiten mit Gesamt-Stunden.
 *
 * Wird beim Erstellen eines Berichts ausgeführt und beim Klick auf den
 * „Daten neu übernehmen"-Button im ZeiterfassungReloadBanner.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface VorausgefuellterMa {
  mitarbeiter_id: string;
  stunden_netto: number;
}

export interface VorausgefuellteTaetigkeit {
  taetigkeit_id: string | null;
  bezeichnung: string;
  summe_stunden: number;
}

export interface VorausfuellungResult {
  mitarbeiter: VorausgefuellterMa[];
  taetigkeiten: VorausgefuellteTaetigkeit[];
  latest_updated_at: string | null; // jüngste updated_at aus stunden_tage
}

export async function ladeVorausfuellung(
  baustelleId: string,
  datum: string,
): Promise<VorausfuellungResult> {
  // 1. Tätigkeiten mit dieser Baustelle, die zu einem stunden_tag mit datum=X gehören
  const { data: tagTaetigkeiten, error } = await supabase
    .from("stunden_taetigkeiten")
    .select(
      `*,
       taetigkeit:taetigkeiten_stamm(id, bezeichnung),
       stunden_tag:stunden_tage!inner(id, mitarbeiter_id, datum, updated_at, tag_status)`,
    )
    .eq("baustelle_id", baustelleId);
  if (error) throw error;

  // Nur Baustellen-Einträge (art) dieses Tages — Firma/Urlaub/Krank-Segmente
  // gehören nicht in den Bautagesbericht.
  const relevant = ((tagTaetigkeiten as any[]) ?? []).filter(
    (row) => row.stunden_tag?.datum === datum && row.art === "baustelle",
  );

  // MA-Aggregation
  const maMap = new Map<string, number>();
  for (const r of relevant) {
    const mid = r.stunden_tag?.mitarbeiter_id as string | undefined;
    if (!mid) continue;
    maMap.set(mid, (maMap.get(mid) ?? 0) + Number(r.stunden ?? 0));
  }

  // Tätigkeits-Aggregation
  const taetigMap = new Map<
    string,
    { taetigkeit_id: string | null; bezeichnung: string; summe_stunden: number }
  >();
  for (const r of relevant) {
    const tid = r.taetigkeit_id as string | null;
    const bez = (r.taetigkeit?.bezeichnung as string | undefined) ?? r.taetigkeit_freitext;
    if (!bez) continue;
    const key = tid ?? `__freitext__${bez}`;
    const cur = taetigMap.get(key) ?? {
      taetigkeit_id: tid,
      bezeichnung: bez,
      summe_stunden: 0,
    };
    cur.summe_stunden += Number(r.stunden ?? 0);
    taetigMap.set(key, cur);
  }

  // Jüngstes updated_at über alle relevanten stunden_tage
  const latest = relevant
    .map((r) => r.stunden_tag?.updated_at as string | undefined)
    .filter((x): x is string => !!x)
    .sort()
    .pop();

  return {
    mitarbeiter: Array.from(maMap.entries()).map(([mitarbeiter_id, stunden_netto]) => ({
      mitarbeiter_id,
      stunden_netto: Math.round(stunden_netto * 100) / 100,
    })),
    taetigkeiten: Array.from(taetigMap.values()).map((t) => ({
      ...t,
      summe_stunden: Math.round(t.summe_stunden * 100) / 100,
    })),
    latest_updated_at: latest ?? null,
  };
}

/**
 * Vorbelegung aus dem TAGESPLAN (Einteilung): die eingeteilten Leute und die
 * geplante Tätigkeit — grob, ohne Stunden. Das ist der Stand in der Früh,
 * bevor jemand Stunden gebucht hat. Die Zeiterfassung ersetzt diese Zeilen
 * später (aus_einteilung=true), manuelle Zeilen bleiben.
 */
export interface EinteilungVorausfuellung {
  mitarbeiter: string[];
  taetigkeit: string | null;
}

export async function ladeEinteilungVorausfuellung(
  baustelleId: string,
  datum: string,
): Promise<EinteilungVorausfuellung> {
  const { data } = await supabase
    .from("einteilungen")
    .select("taetigkeit, einteilung_mitarbeiter(mitarbeiter_id, abwesend)")
    .eq("baustelle_id", baustelleId)
    .eq("datum", datum);
  const ids = new Set<string>();
  const taetigkeiten: string[] = [];
  for (const e of (data as any[]) ?? []) {
    for (const em of e.einteilung_mitarbeiter ?? []) {
      if (!em.abwesend && em.mitarbeiter_id) ids.add(em.mitarbeiter_id);
    }
    const t = (e.taetigkeit ?? "").trim();
    if (t && !taetigkeiten.includes(t)) taetigkeiten.push(t);
  }
  return { mitarbeiter: [...ids], taetigkeit: taetigkeiten.join(" · ") || null };
}

export async function uebernehmeEinteilungVorausfuellung(
  berichtId: string,
  r: EinteilungVorausfuellung,
): Promise<number> {
  if (r.mitarbeiter.length === 0 && !r.taetigkeit) return 0;
  await supabase.from("bericht_mitarbeiter").delete().eq("bericht_id", berichtId).eq("aus_einteilung", true);
  await supabase.from("bericht_taetigkeiten").delete().eq("bericht_id", berichtId).eq("aus_einteilung", true);
  if (r.mitarbeiter.length > 0) {
    await supabase.from("bericht_mitarbeiter").insert(
      r.mitarbeiter.map((mitarbeiter_id, idx) => ({
        bericht_id: berichtId,
        mitarbeiter_id,
        position: idx + 1,
        stunden_netto: 0,
        aus_zeiterfassung: false,
        aus_einteilung: true,
      })) as any,
    );
  }
  if (r.taetigkeit) {
    await supabase.from("bericht_taetigkeiten").insert({
      bericht_id: berichtId,
      position: 1,
      taetigkeit_id: null,
      bezeichnung: r.taetigkeit,
      summe_stunden: 0,
      aus_zeiterfassung: false,
      aus_einteilung: true,
    } as any);
  }
  await supabase
    .from("berichte")
    .update({ einteilung_quelle_am: new Date().toISOString() } as any)
    .eq("id", berichtId);
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("bericht_aenderungen").insert({
    bericht_id: berichtId,
    autor_id: user?.id ?? null,
    art: "vorausfuellung",
    details: `${r.mitarbeiter.length} MA${r.taetigkeit ? " + Tätigkeit" : ""} aus dem Tagesplan vorbelegt`,
  });
  return r.mitarbeiter.length;
}

/**
 * Schreibt die Vorausfüllung als bericht_mitarbeiter/bericht_taetigkeiten in die DB.
 * Ersetzt Zeilen mit aus_zeiterfassung=true — und, sobald die Zeiterfassung
 * Daten liefert, auch die Platzhalter aus dem Tagesplan (aus_einteilung).
 * Manuelle Zeilen bleiben unangetastet. Setzt berichte.zeiterfassung_quelle_am.
 */
export async function uebernehmeVorausfuellung(
  berichtId: string,
  result: VorausfuellungResult,
): Promise<void> {
  const hatDaten = result.mitarbeiter.length > 0 || result.taetigkeiten.length > 0;
  // Alte aus_zeiterfassung=true löschen; Plan-Platzhalter nur, wenn es
  // jetzt echte Stunden gibt — sonst stünde der Bericht in der Früh leer da.
  await supabase
    .from("bericht_mitarbeiter")
    .delete()
    .eq("bericht_id", berichtId)
    .or(hatDaten ? "aus_zeiterfassung.eq.true,aus_einteilung.eq.true" : "aus_zeiterfassung.eq.true");
  await supabase
    .from("bericht_taetigkeiten")
    .delete()
    .eq("bericht_id", berichtId)
    .or(hatDaten ? "aus_zeiterfassung.eq.true,aus_einteilung.eq.true" : "aus_zeiterfassung.eq.true");

  // Neue MAs
  if (result.mitarbeiter.length > 0) {
    await supabase.from("bericht_mitarbeiter").insert(
      result.mitarbeiter.map((m, idx) => ({
        bericht_id: berichtId,
        mitarbeiter_id: m.mitarbeiter_id,
        position: idx + 1,
        stunden_netto: m.stunden_netto,
        aus_zeiterfassung: true,
      })),
    );
  }
  // Neue Tätigkeiten
  if (result.taetigkeiten.length > 0) {
    await supabase.from("bericht_taetigkeiten").insert(
      result.taetigkeiten.map((t, idx) => ({
        bericht_id: berichtId,
        position: idx + 1,
        taetigkeit_id: t.taetigkeit_id,
        bezeichnung: t.bezeichnung,
        summe_stunden: t.summe_stunden,
        aus_zeiterfassung: true,
      })),
    );
  }
  // Snapshot-Marker + Audit-Log NUR setzen, wenn tatsaechlich Daten uebernommen
  // wurden. Sonst bleibt zeiterfassung_quelle_am=null und beim naechsten Oeffnen
  // versucht der Auto-Import erneut — falls inzwischen MAs gebucht wurden.
  if (result.mitarbeiter.length > 0 || result.taetigkeiten.length > 0) {
    await supabase
      .from("berichte")
      .update({ zeiterfassung_quelle_am: new Date().toISOString() })
      .eq("id", berichtId);

    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("bericht_aenderungen").insert({
      bericht_id: berichtId,
      autor_id: user?.id ?? null,
      art: "vorausfuellung",
      details: `${result.mitarbeiter.length} MA, ${result.taetigkeiten.length} Tätigkeiten aus Zeiterfassung`,
    });
  }
}

/** Lädt die Vorausfüllung asynchron; geeignet für UI-Preview. */
export function useVorausfuellung(
  baustelleId: string | null | undefined,
  datum: string | null | undefined,
  enabled = true,
) {
  return useQuery<VorausfuellungResult>({
    queryKey: ["vorausfuellung", baustelleId, datum],
    queryFn: () => ladeVorausfuellung(baustelleId!, datum!),
    enabled: enabled && !!baustelleId && !!datum,
  });
}

/** Prüft, ob die Zeiterfassung neuer ist als der letzte Snapshot. */
export async function pruefeZeiterfassungNeuer(
  baustelleId: string,
  datum: string,
  snapshotAm: string,
): Promise<boolean> {
  const r = await ladeVorausfuellung(baustelleId, datum);
  if (!r.latest_updated_at) return false;
  return r.latest_updated_at > snapshotAm;
}
