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
 *
 * Auch das PDF des Driversnote-Fahrtenberichts wird gelesen: die Text-
 * Bausteine werden über ihre x/y-Position wieder zu Tabellenzeilen
 * zusammengesetzt (eine Fahrt belegt dort mehrere Druckzeilen — Adressen
 * umgebrochen, die zwei km-Stände untereinander, die Kostenstelle als
 * Notiz unter dem Zweck).
 *
 * xlsx- und pdfjs-Bibliothek werden erst beim Import geladen — sie sind
 * groß und würden sonst das Start-Bundle aufblähen.
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
  let s = String(val).replace(/\s/g, "");
  // Deutsches Format: Punkt = Tausender, Komma = Dezimal (247.245,8)
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONATE: Record<string, string> = {
  jan: "01", jän: "01", feb: "02", mär: "03", mar: "03", apr: "04",
  mai: "05", jun: "06", jul: "07", aug: "08", sep: "09", okt: "10",
  oct: "10", nov: "11", dez: "12", dec: "12",
};

/** „22 Jul 2026" / „22. Juli 2026" → ISO. */
function toDatumDeutsch(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\.?\s+([A-Za-zÄäÖöÜü]+)\.?\s+(\d{4})$/);
  if (!m) return null;
  const monat = MONATE[m[2].slice(0, 3).toLowerCase()];
  if (!monat) return null;
  return `${m[3]}-${monat}-${m[1].padStart(2, "0")}`;
}

/** Spaltenindex über die Überschrift finden (Groß/Klein egal, Teiltreffer). */
function spalte(kopf: string[], ...muster: RegExp[]): number {
  for (const re of muster) {
    const i = kopf.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

// ─── PDF (Driversnote-Fahrtenbericht) ──────────────────────────────────

interface TextStueck {
  s: string;
  x: number;
  y: number;
}

async function parsePdf(
  file: File,
): Promise<{ fahrten: ImportFahrt[]; fehler: string | null }> {
  const pdfjsLib = await import("pdfjs-dist");
  // Worker wie in dokumente/Thumbnail.tsx — Vite liefert die URL.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  (pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerUrl;

  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const fahrten: ImportFahrt[] = [];
  let kopfGesehen = false;

  for (let seite = 1; seite <= doc.numPages; seite++) {
    const page = await doc.getPage(seite);
    const tc = await page.getTextContent();
    const stuecke: TextStueck[] = (tc.items as any[])
      .filter((it) => typeof it.str === "string" && it.str.trim() !== "")
      .map((it) => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

    // Druckzeilen über die y-Position bilden (Toleranz für Schriftgrößen).
    const zeilen: TextStueck[][] = [];
    for (const st of stuecke.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const letzte = zeilen[zeilen.length - 1];
      if (letzte && Math.abs(letzte[0].y - st.y) <= 4) letzte.push(st);
      else zeilen.push([st]);
    }

    // Spaltenpositionen aus der Kopfzeile („Datum … Strecke") der Seite.
    const kopfZeile = zeilen.find(
      (z) => z.some((t) => /^Datum$/i.test(t.s)) && z.some((t) => /^Strecke$/i.test(t.s)),
    );
    if (!kopfZeile) continue;
    kopfGesehen = true;
    const posVon = kopfZeile.find((t) => /^Von$/i.test(t.s))?.x ?? 83;
    const posNach = kopfZeile.find((t) => /^Nach$/i.test(t.s))?.x ?? 206;
    const posZweck = kopfZeile.find((t) => /^Zweck$/i.test(t.s))?.x ?? 330;
    const posStand = kopfZeile.find((t) => /Kilometerstand/i.test(t.s))?.x ?? 410;
    const posStrecke = kopfZeile.find((t) => /^Strecke$/i.test(t.s))?.x ?? 460;
    const kopfY = kopfZeile[0].y;

    /** Zu welcher Spalte gehört ein Textstück? (± Toleranz nach links) */
    const spalteVon = (x: number): "datum" | "von" | "nach" | "zweck" | "stand" | "strecke" | "rest" => {
      if (x < posVon - 8) return "datum";
      if (x < posNach - 8) return "von";
      if (x < posZweck - 8) return "nach";
      if (x < posStand - 8) return "zweck";
      if (x < posStrecke - 8) return "stand";
      if (x < posStrecke + 40) return "strecke";
      return "rest";
    };

    let offen: {
      datum: string;
      von: string[];
      nach: string[];
      zweckNotiz: string[];
      staende: number[];
      km: number | null;
    } | null = null;

    const abschliessen = () => {
      if (!offen || offen.km == null || offen.km <= 0) {
        offen = null;
        return;
      }
      // Erste Zweck-Zeile ist der Zweck („Geschäftlich"), alles danach die
      // Notiz — dort pflegen die Fahrer die Kostenstelle.
      const notiz = offen.zweckNotiz.slice(1).join(" ").trim();
      const zweck = offen.zweckNotiz[0] ?? "";
      fahrten.push({
        datum: offen.datum,
        abfahrt: null,
        ankunft: null,
        reiseweg: [offen.von.join(" "), offen.nach.join(" ")].filter(Boolean).join(" – ") || null,
        km_start: offen.staende.length > 0 ? r2(offen.staende[0]) : null,
        km_ende: offen.staende.length > 1 ? r2(offen.staende[offen.staende.length - 1]) : null,
        km: r2(offen.km),
        kostenstelle:
          notiz ||
          (zweck && !/^(geschäftlich|privat|business|personal)$/i.test(zweck) ? zweck : null),
      });
      offen = null;
    };

    for (const zeile of zeilen) {
      if (zeile[0].y >= kopfY) continue; // Kopf- und Titelbereich
      const datumsText = zeile.filter((t) => spalteVon(t.x) === "datum").map((t) => t.s).join(" ");
      const datum = toDatumDeutsch(datumsText);
      if (datum) {
        abschliessen();
        offen = { datum, von: [], nach: [], zweckNotiz: [], staende: [], km: null };
      }
      if (!offen) continue;
      for (const t of zeile) {
        switch (spalteVon(t.x)) {
          case "von":
            offen.von.push(t.s);
            break;
          case "nach":
            offen.nach.push(t.s);
            break;
          case "zweck":
            offen.zweckNotiz.push(t.s);
            break;
          case "stand": {
            const n = toZahl(t.s);
            if (n != null) offen.staende.push(n);
            break;
          }
          case "strecke": {
            const m = t.s.match(/^([\d.,]+)\s*km$/i);
            if (m && offen.km == null) offen.km = toZahl(m[1]);
            break;
          }
        }
      }
    }
    abschliessen();
  }

  if (!kopfGesehen) {
    return {
      fahrten: [],
      fehler:
        "In dem PDF wurde keine Fahrten-Tabelle gefunden — erwartet wird der Driversnote-Fahrtenbericht. Am zuverlässigsten ist der Excel-Export.",
    };
  }
  return { fahrten, fehler: null };
}

export async function parseFahrtenDatei(
  file: File,
): Promise<{ fahrten: ImportFahrt[]; fehler: string | null }> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return parsePdf(file);
  }
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
