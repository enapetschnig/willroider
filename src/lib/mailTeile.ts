/**
 * Anhänge für den Mailversand auf mehrere Mails aufteilen (J. Maurer,
 * 19.11.2026: Berichte gesammelt versenden — ein Bericht mit Fotos hat
 * im Schnitt 3–4 MB, einzelne über 20 MB; das Mail-Limit liegt bei 35 MB).
 */
/** Dateien der Reihe nach auf Teile bis maxBytes verteilen (eine zu große Datei bildet einen eigenen Teil). */
export function teileNachGroesse<T extends { groesse?: number | null; blob?: Blob }>(
  items: T[],
  maxBytes: number,
): T[][] {
  const teile: T[][] = [];
  let aktuell: T[] = [];
  let summe = 0;
  for (const it of items) {
    const g = it.blob?.size ?? it.groesse ?? 0;
    if (aktuell.length > 0 && summe + g > maxBytes) {
      teile.push(aktuell);
      aktuell = [];
      summe = 0;
    }
    aktuell.push(it);
    summe += g;
  }
  if (aktuell.length > 0) teile.push(aktuell);
  return teile;
}
