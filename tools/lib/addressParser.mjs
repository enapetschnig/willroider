/**
 * Parst eine deutsche/österreichische Wohnadresse aus einer kompakten
 * Excel-Schreibweise wie sie in `Liste Zimmerei.xlsx` vorkommt:
 *
 *   "9500 Villach, Postgasse 2/8"        → {plz:"9500", ort:"Villach",      strasse:"Postgasse 2/8"}
 *   "9572 Deutsch-Griffen 104"           → {plz:"9572", ort:"Deutsch-Griffen", strasse:"104"}
 *   "9560 Feldkirchen, 10.Oktoberstr. 2" → {plz:"9560", ort:"Feldkirchen",  strasse:"10.Oktoberstr. 2"}
 *
 * Gibt null zurück wenn überhaupt kein Input. Gibt ein Objekt mit
 * `_error` zurück, wenn die PLZ nicht erkannt wurde — damit kann der
 * Aufrufer im Dry-Run klare Fehlermeldungen ausgeben.
 */

export function parseAddress(raw) {
  if (raw == null) return null;
  const trim = String(raw).trim().replace(/\s+/g, " ");
  if (!trim) return null;

  // PLZ = 4 Ziffern am Anfang (AT-PLZ-Norm).
  const plzMatch = trim.match(/^(\d{4})\s+(.+)$/);
  if (!plzMatch) {
    return { _error: `Keine 4-stellige PLZ am Anfang: "${raw}"` };
  }
  const plz = plzMatch[1];
  const rest = plzMatch[2].trim();

  // Branch A — Komma vorhanden: vor Komma = Ort, nach Komma = Straße
  if (rest.includes(",")) {
    const [ortPart, ...streetParts] = rest.split(",");
    return {
      plz,
      ort: ortPart.trim(),
      strasse: streetParts.join(",").trim(),
      land: "AT",
    };
  }

  // Branch B — kein Komma: letzter Token mit Ziffer = Hausnummer +
  // optionales Stockwerk; vorne = Ort. Beispiel: „Deutsch-Griffen 104"
  // → Ort „Deutsch-Griffen", Straße „104" (bloße Hausnummer).
  const tokenMatch = rest.match(/^(.+?)\s+(\d+\S*)$/);
  if (tokenMatch) {
    return {
      plz,
      ort: tokenMatch[1].trim(),
      strasse: tokenMatch[2].trim(),
      land: "AT",
    };
  }

  // Branch C — Notausgang: kein Komma, keine Hausnummer → alles in Ort
  return {
    plz,
    ort: rest,
    strasse: "",
    land: "AT",
  };
}
