/**
 * Pflicht-Unterweisung einer Baustelle setzen — EIN Weg für alle Masken.
 *
 * Vorfall 08.10. (N. Gwenger): Painter Carport bekam über die Tagesplanung
 * („Standard-Unterweisung anlegen") eine Baustellen-Unterweisung und eine
 * Minute später über „Neue Evaluierung" die richtige Tagesbaustellen-
 * Unterweisung. Beide Wege setzten nur pflicht_evaluierung_id — die offenen
 * Zuteilungen der ersten blieben stehen, wurden um 08:00 fällig und
 * sperrten drei Mitarbeitern die App für eine Unterweisung, die niemand
 * mehr unterschreiben sollte.
 *
 * Wie unterweisung_setzen() in der Datenbank: Nach dem Wechsel werden die
 * OFFENEN, nicht unterschriebenen Zuteilungen der vorigen Unterweisung
 * archiviert. Geleistete Unterschriften bleiben als Nachweis.
 */
import { supabase } from "@/integrations/supabase/client";

export async function setzePflichtUnterweisung(
  baustelleId: string,
  evaluierungId: string,
): Promise<{ error: string | null }> {
  const { data: b } = await supabase
    .from("baustellen")
    .select("pflicht_evaluierung_id")
    .eq("id", baustelleId)
    .maybeSingle();
  const alt = (b as { pflicht_evaluierung_id?: string | null } | null)?.pflicht_evaluierung_id ?? null;

  const { error } = await supabase
    .from("baustellen")
    .update({ pflicht_evaluierung_id: evaluierungId } as any)
    .eq("id", baustelleId);
  if (error) return { error: error.message };

  if (alt && alt !== evaluierungId) {
    await offeneZuteilungenArchivieren(alt, "durch neue Unterweisung ersetzt");
  }
  return { error: null };
}

/** Offene, nicht unterschriebene Zuteilungen einer Unterweisung archivieren —
 *  danach sperrt sie niemandem mehr die App. */
export async function offeneZuteilungenArchivieren(evaluierungId: string, grund: string) {
  return supabase
    .from("evaluierung_unterschriften")
    .update({
      status: "archiviert",
      archiviert_am: new Date().toISOString(),
      archiviert_grund: grund,
      faellig_am: null,
    } as any)
    .eq("evaluierung_id", evaluierungId)
    .eq("status", "offen")
    .is("unterschrift_data", null);
}

/**
 * Falsch angelegte Unterweisung löschen. Zuteilungen und Unterschriften
 * hängen per ON DELETE CASCADE daran; war sie die Pflicht-Unterweisung,
 * steht die Baustelle danach ohne (ON DELETE SET NULL).
 */
export async function loescheUnterweisung(evaluierungId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from("evaluierungen")
    .delete()
    .eq("id", evaluierungId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Keine Berechtigung zum Löschen." };
  return { error: null };
}
