/** Merkt sich die letzte Auswahl auf /berichte (Typ, Zeitraum, Status,
 *  Baustelle) für den Zurück-Pfeil im Bericht. Nur im Browser-Tab. */
export const BERICHTE_AUSWAHL_KEY = "berichte.letzteAuswahl";

/** Link zurück zur Berichte-Liste mit der zuletzt gewählten Auswahl. */
export function berichteListePfad(): string {
  try {
    const q = sessionStorage.getItem(BERICHTE_AUSWAHL_KEY);
    return q ? `/berichte?${q}` : "/berichte";
  } catch {
    return "/berichte";
  }
}
