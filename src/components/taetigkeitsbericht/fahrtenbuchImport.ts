/**
 * Import von Fahrten aus Fahrtenbuch-Apps (Driversnote & Co.).
 *
 * Gelesen wird die Excel-/CSV-Ausgabe der App; die Spalten werden über
 * ihre Überschriften gefunden, nicht über feste Positionen — damit
 * verkraftet der Import auch Format-Varianten. Referenz ist der
 * Driversnote-Export:
 *
 *   Start | Stopp | Von | Nach | Zweck | Notiz | Start Kilometerstand |
 *   Stopp Kilometerstand | Strecke | Km-Satz | Rückerstattung
 *
 * Die Kostenstelle pflegen die Fahrer dort im Notiz-Feld (z. B. 1404899).
 * Die xlsx-Bibliothek wird erst beim Import geladen — sie ist groß und
 * würde sonst das Start-Bundle aufblähen.
 */

/** Kaufmännisch auf 2 Stellen — bewusst lokal, damit dieses Modul keine
 *  App-Abhängigkeiten zieht (die xlsx-Bibliothek ist schwer genug). */
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface ImportFahrt {
  datum: string;
  abfahrt: string | null;
  ankunft: string | null;
  reiseweg: string | null;
  km_start: number | null;
  km_ende: number | null;
  km: number;
  kostenstelle: string | null;
}

/** Excel-Serial (Tage seit 30.12.1899, Bruchteil = Uhrzeit) → Datum+Zeit. */
function vonSerial(serial: number): { iso: string; zeit: string | null } {
  const tage = Math.floor(serial);
  const rest = serial - tage;
  const d = new Date(1899, 11, 30 + tage);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const minuten = Math.round(rest * 24 * 60);
  if (minuten <= 0) return { iso, zeit: null };
  return {
    iso,
    zeit: `${String(Math.floor(minuten / 60)).padStart(2, "0")}:${String(minuten % 60).padStart(2, "0")}`,
  };
}

/** Datum+Zeit aus Zelle — Excel-Serial, Date-Objekt oder Text. */
function toDatumZeit(val: unknown): { iso: string; zeit: string | null } | null {
  if (val == null || val === "") return null;
  if (typeof val === "number" && Number.isFinite(val)) return vonSerial(val);
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const iso = `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, "0")}-${String(val.getDate()).padStart(2, "0")}`;
    const zeit =
      val.getHours() || val.getMinutes()
        ? `${String(val.getHours()).padStart(2, "0")}:${String(val.getMinutes()).padStart(2, "0")}`
        : null;
    return { iso, zeit };
  }
  const s = String(val).trim();
  // 21.07.2026 06:30  ·  21.07.26  ·  2026-07-21 06:30
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const jahr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return {
      iso: `${jahr}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
      zeit: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : null,
    };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (m) {
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, zeit: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : null };
  }
  return null;
}

function toZahl(val: unknown): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  const n = Number(String(val).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Spaltenindex über die Überschrift finden (Groß/Klein egal, Teiltreffer). */
function spalte(kopf: string[], ...muster: RegExp[]): number {
  for (const re of muster) {
    const i = kopf.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export async function parseFahrtenDatei(
  file: File,
): Promise<{ fahrten: ImportFahrt[]; fehler: string | null }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { fahrten: [], fehler: "Die Datei enthält kein Tabellenblatt." };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as unknown[][];

  // Kopfzeile suchen: braucht „Start" und eine Strecken-/Von-Spalte.
  let kopfIdx = -1;
  let kopf: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = rows[i].map((c) => String(c ?? "").trim().toLowerCase());
    if (h.some((x) => /^start/.test(x)) && h.some((x) => /strecke|distan|^von$|^from$/.test(x))) {
      kopfIdx = i;
      kopf = h;
      break;
    }
  }
  if (kopfIdx < 0) {
    return {
      fahrten: [],
      fehler:
        "Keine passende Kopfzeile gefunden — erwartet wird ein Export mit Spalten wie Start, Von, Nach und Strecke (z. B. aus Driversnote).",
    };
  }

  const cStart = spalte(kopf, /^start$/, /^start(?!.*kilometer)/);
  const cStopp = spalte(kopf, /^stopp?$/, /^end/);
  const cVon = spalte(kopf, /^von$/, /^from$/);
  const cNach = spalte(kopf, /^nach$/, /^to$/);
  const cZweck = spalte(kopf, /^zweck/, /^purpose/);
  const cNotiz = spalte(kopf, /^notiz/, /^note/);
  const cKmStart = spalte(kopf, /start.*kilometerstand/, /start.*odometer/, /kilometerstand.*start/);
  const cKmEnde = spalte(kopf, /stopp?.*kilometerstand/, /end.*odometer/, /kilometerstand.*(stopp?|ende)/);
  const cStrecke = spalte(kopf, /^strecke/, /^distan/);

  const fahrten: ImportFahrt[] = [];
  for (const row of rows.slice(kopfIdx + 1)) {
    const start = cStart >= 0 ? toDatumZeit(row[cStart]) : null;
    if (!start) continue; // Leer-/Summenzeilen
    const stopp = cStopp >= 0 ? toDatumZeit(row[cStopp]) : null;

    const kmStart = cKmStart >= 0 ? toZahl(row[cKmStart]) : null;
    const kmEnde = cKmEnde >= 0 ? toZahl(row[cKmEnde]) : null;
    let km = cStrecke >= 0 ? toZahl(row[cStrecke]) : null;
    if (km == null && kmStart != null && kmEnde != null && kmEnde >= kmStart) {
      km = kmEnde - kmStart;
    }
    if (km == null || km <= 0) continue;

    const von = cVon >= 0 ? String(row[cVon] ?? "").trim() : "";
    const nach = cNach >= 0 ? String(row[cNach] ?? "").trim() : "";
    const notiz = cNotiz >= 0 ? String(row[cNotiz] ?? "").trim() : "";
    const zweck = cZweck >= 0 ? String(row[cZweck] ?? "").trim() : "";

    fahrten.push({
      datum: start.iso,
      abfahrt: start.zeit,
      ankunft: stopp?.zeit ?? null,
      reiseweg: [von, nach].filter(Boolean).join(" – ") || null,
      km_start: kmStart != null ? r2(kmStart) : null,
      km_ende: kmEnde != null ? r2(kmEnde) : null,
      km: r2(km),
      // Die Kostenstelle steht bei Driversnote im Notiz-Feld; sonstige
      // Notizen werden trotzdem übernommen, ein Zweck wie „Geschäftlich"
      // trägt dagegen keine Information.
      kostenstelle: notiz || (zweck && !/^(geschäftlich|privat|business|personal)$/i.test(zweck) ? zweck : null),
    });
  }
  return { fahrten, fehler: null };
}
