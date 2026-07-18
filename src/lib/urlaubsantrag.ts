/**
 * Gemeinsame Genehmigen-/Ablehnen-Logik für Urlaubsanträge.
 * Wird von der Verwaltung (Urlaubs-Konten) UND der Jahresplanung
 * (Mitarbeiter-Reiter, Klick auf „U? beantragt"-Balken) verwendet —
 * eine Logik, überall synchron.
 */

import { supabase } from "@/integrations/supabase/client";
import { isWerktag } from "@/lib/feiertage";
import { localIso } from "@/lib/dateFmt";
import type { Database } from "@/integrations/supabase/types";

export type Urlaubsantrag = Database["public"]["Tables"]["urlaubsantraege"]["Row"];

export type AntragResult = {
  ok: boolean;
  /** true = war schon von jemand anderem entschieden (kein Fehler). */
  alreadyDecided?: boolean;
  message?: string;
};

/**
 * Genehmigt einen Antrag: Status setzen (mit Doppelklick-/Parallel-Guard),
 * Urlaubskonto abbuchen, Urlaubs-Tage in stunden_tage anlegen/umstellen
 * (inkl. 0h-Tätigkeitszeile — sonst zeigt der Baustellenstundenbericht
 * „Kein Eintrag" statt U).
 */
export async function genehmigeUrlaubsantrag(a: Urlaubsantrag): Promise<AntragResult> {
  const { data: u } = await supabase.auth.getUser();

  // 1) Antrag claimen — Guard gegen Doppelklick/parallele Entscheider
  const { data: claimed, error: err1 } = await supabase
    .from("urlaubsantraege")
    .update({
      status: "genehmigt",
      entschieden_von: u.user?.id ?? null,
      entschieden_am: new Date().toISOString(),
    })
    .eq("id", a.id)
    .eq("status", "offen")
    .select("id");
  if (err1) return { ok: false, message: err1.message };
  if (!claimed || claimed.length === 0) return { ok: false, alreadyDecided: true };

  // 2) Urlaubskonto abbuchen
  if (a.arbeitstage && Number(a.arbeitstage) > 0) {
    const { error: buchErr } = await supabase.from("urlaubs_buchungen").insert({
      mitarbeiter_id: a.mitarbeiter_id,
      art: "urlaub_genommen",
      tage: -Math.abs(Number(a.arbeitstage)),
      wirksam_am: a.von,
      notiz: `Antrag: ${a.von} – ${a.bis}`,
      erstellt_von: u.user?.id ?? null,
    });
    if (buchErr) {
      return {
        ok: true,
        message: `Antrag genehmigt, aber Konto-Buchung fehlgeschlagen: ${buchErr.message} — bitte manuell im Urlaubs-Konto nachtragen.`,
      };
    }
  }

  // 3) Urlaubs-Tage in stunden_tage (nur Werktage)
  const werktageInRange: string[] = [];
  let d = new Date(a.von + "T00:00:00");
  const ende = new Date(a.bis + "T00:00:00");
  while (d <= ende) {
    if (isWerktag(d)) werktageInRange.push(localIso(d));
    d.setDate(d.getDate() + 1);
  }
  if (werktageInRange.length > 0) {
    const { data: existing } = await supabase
      .from("stunden_tage")
      .select("id, datum, status")
      .eq("mitarbeiter_id", a.mitarbeiter_id)
      .in("datum", werktageInRange);
    const existingSet = new Set((existing ?? []).map((r: any) => r.datum));
    const toInsert = werktageInRange.filter((x) => !existingSet.has(x));
    if (toInsert.length > 0) {
      const { data: neueTage, error: insErr } = await supabase
        .from("stunden_tage")
        .insert(
          toInsert.map((datum) => ({
            mitarbeiter_id: a.mitarbeiter_id,
            datum,
            tag_status: "urlaub" as const,
            netto_stunden: 0,
            status: "ma_bestaetigt" as const,
          })),
        )
        .select("id");
      if (insErr) console.error("Urlaubs-Tage-Insert:", insErr);
      // 0h-Tätigkeitszeile je Tag — für die U-Anzeige im BSB/Raster
      if (neueTage && neueTage.length > 0) {
        await supabase.from("stunden_taetigkeiten").insert(
          neueTage.map((t: any) => ({
            stunden_tag_id: t.id,
            position: 1,
            stunden: 0,
            art: "urlaub" as const,
          })),
        );
      }
    }
    // Bestehende (noch nicht freigegebene) Tage auf Urlaub umstellen.
    // Tätigkeiten löschen (alte Stunden/TAG-Buchungen weg) + 0h-Zeile neu.
    const ueberschreibbar = (existing ?? []).filter(
      (r: any) => r.status === "erfasst" || r.status === "ma_bestaetigt",
    );
    if (ueberschreibbar.length > 0) {
      const tagIds = ueberschreibbar.map((r: any) => r.id);
      const { error: ttDelErr } = await supabase
        .from("stunden_taetigkeiten")
        .delete()
        .in("stunden_tag_id", tagIds);
      if (ttDelErr) console.error("Taetigkeiten-Cleanup:", ttDelErr);
      const { error: updErr } = await supabase
        .from("stunden_tage")
        .update({ tag_status: "urlaub", netto_stunden: 0 })
        .in("id", tagIds);
      if (updErr) console.error("Urlaubs-Tage-Update:", updErr);
      await supabase.from("stunden_taetigkeiten").insert(
        tagIds.map((id: string) => ({
          stunden_tag_id: id,
          position: 1,
          stunden: 0,
          art: "urlaub" as const,
        })),
      );
    }
  }
  return { ok: true };
}

/** Lehnt einen offenen Antrag ab (mit Parallel-Guard). */
export async function lehneUrlaubsantragAb(antragId: string): Promise<AntragResult> {
  const { data: u } = await supabase.auth.getUser();
  const { data: claimed, error } = await supabase
    .from("urlaubsantraege")
    .update({
      status: "abgelehnt",
      entschieden_von: u.user?.id ?? null,
      entschieden_am: new Date().toISOString(),
    })
    .eq("id", antragId)
    .eq("status", "offen")
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!claimed || claimed.length === 0) return { ok: false, alreadyDecided: true };
  return { ok: true };
}
