import PizZip from "pizzip";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type EinteilungBlock = {
  bvhName: string;
  kostenstelle: string | null;
  fahrzeuge: string[]; // Kennzeichen + optional Bezeichnung
  taetigkeit: string | null;
  mitarbeiter: string[]; // bereits formatiert als "Vorname Nachname" oder mit Suffix
};

export type SpezialBlock = {
  /** Erste Spalte: z.B. "Urlaub:" oder "Produktion:" */
  label: string;
  fahrzeuge: string[];
  taetigkeit: string | null;
  /** Pre-formatted Zeilen pro Mitarbeiter */
  mitarbeiter: string[];
};

export type TagesplanData = {
  /** ISO-Datum */
  datum: string;
  einteilungen: EinteilungBlock[];
  /** Werkstatt/Lager etc. */
  produktion?: SpezialBlock | null;
  urlaub?: SpezialBlock | null;
  polierschule?: SpezialBlock | null;
  krank?: SpezialBlock | null;
  stempeln?: SpezialBlock | null;
};

const WOCHENTAG = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Liefert OOXML, das Zeilen mit <w:br/> trennt — innerhalb eines Runs. */
function multilineRunXml(lines: string[]): string {
  const safe = lines.filter(Boolean).map(escapeXml);
  if (safe.length === 0) return "<w:r/>";
  return (
    "<w:r>" +
    safe
      .map((l, i) => (i === 0 ? `<w:t xml:space="preserve">${l}</w:t>` : `<w:br/><w:t xml:space="preserve">${l}</w:t>`))
      .join("") +
    "</w:r>"
  );
}

/** Erzeugt eine geklonte tr aus dem Template (basierend auf der Daten-Reihen-XML), mit ersetzten Werten. */
function buildDataRow(
  templateRowXml: string,
  values: { col1: string[]; col2: string[]; col3: string[]; col4: string[] }
): string {
  // Wir ersetzen in jeder Zelle den <w:p>-Inhalt komplett, da wir mehrere
  // Zeilen pro Zelle brauchen können. Strategie: jede Zelle hat genau ein <w:p>;
  // wir tauschen das <w:r>...</w:r> innerhalb dieses <w:p> aus.
  // Ansatz: scan tcs in Reihenfolge.
  const tcRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
  const cells = templateRowXml.match(tcRegex) ?? [];
  if (cells.length !== 4) {
    throw new Error(`Template-Daten-Reihe hat ${cells.length} Zellen, erwartet 4.`);
  }
  const cols = [values.col1, values.col2, values.col3, values.col4];
  const replaced = cells.map((tcXml, i) => {
    // Innerhalb der <w:tc>: ersetze ALLE <w:r>...</w:r> + jeglichen alten Marker durch unseren Multiline-Run
    // Ersetze den ersten <w:p>...</w:p>-Inhalt komplett.
    const newRun = multilineRunXml(cols[i]);
    // Greife auf das erste <w:p>...</w:p> zu und tausche dessen Innenleben.
    return tcXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/, (pTag) => {
      // pTag enthält evtl. <w:pPr>... — die behalten wir
      const pPrMatch = pTag.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/);
      const opener = pTag.match(/^<w:p\b[^>]*>/)?.[0] ?? "<w:p>";
      const inner = (pPrMatch ? pPrMatch[0] : "") + newRun;
      return `${opener}${inner}</w:p>`;
    });
  });
  // baue tr neu zusammen: der Anfang vor erster tc, dann ersetzte tcs, dann Ende
  const trOpener = templateRowXml.match(/^<w:tr\b[^>]*>(?:<w:trPr\b[\s\S]*?<\/w:trPr>)?/)?.[0] ?? "<w:tr>";
  return `${trOpener}${replaced.join("")}</w:tr>`;
}

export async function generateTagesplanDocx(data: TagesplanData): Promise<Blob> {
  const res = await fetch("/templates/arbeitseinteilung-tag.docx");
  if (!res.ok) throw new Error("Vorlage arbeitseinteilung-tag.docx konnte nicht geladen werden");
  const buf = await res.arrayBuffer();
  const zip = new PizZip(buf);

  const docPath = "word/document.xml";
  const xml = zip.file(docPath)?.asText();
  if (!xml) throw new Error("document.xml fehlt im Template");

  // ── Titel ──
  const date = new Date(data.datum);
  const wt = WOCHENTAG[date.getDay()];
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const titleText = `${wt} ${dd}.${mm}.${yyyy}`;

  let updated = xml.replace(/\{\{TITLE\}\}/g, escapeXml(titleText));

  // ── Daten-Reihe-Template extrahieren ──
  const dataRowMatch = updated.match(
    /<w:tr\b[^>]*>(?:(?!<\/w:tr>)[\s\S])*?\{\{BVH\}\}[\s\S]*?<\/w:tr>/
  );
  if (!dataRowMatch) throw new Error("Daten-Reihen-Template nicht gefunden");
  const dataRowXml = dataRowMatch[0];

  // ── Spacer-Reihe (leere Reihe direkt davor) ──
  // Wir suchen die <w:tr> direkt vor dataRow
  const spacerBefore = (() => {
    const idx = updated.indexOf(dataRowXml);
    const before = updated.slice(0, idx);
    const trBefore = before.match(/<w:tr\b[^>]*>(?:(?!<w:tr\b)[\s\S])*?<\/w:tr>(?![\s\S]*<w:tr\b[\s\S]*?<\/w:tr>[\s\S]*<\/w:tbl>)/);
    if (trBefore) return trBefore[0];
    // Fallback: finde alle <w:tr>, nimm vorletzten
    const all = before.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) ?? [];
    return all[all.length - 1] ?? "";
  })();

  // ── Baue alle Reihen zusammen ──
  const rows: string[] = [];
  const formatBaustelleCol1 = (e: EinteilungBlock): string[] => {
    const out = [`${e.bvhName}:`];
    if (e.kostenstelle) out.push(e.kostenstelle);
    return out;
  };
  for (const e of data.einteilungen) {
    if (rows.length > 0 && spacerBefore) rows.push(spacerBefore);
    rows.push(
      buildDataRow(dataRowXml, {
        col1: formatBaustelleCol1(e),
        col2: e.fahrzeuge.length > 0 ? e.fahrzeuge : [""],
        col3: e.taetigkeit ? [e.taetigkeit] : [""],
        col4: e.mitarbeiter.length > 0 ? e.mitarbeiter : [""],
      })
    );
  }

  const addSpezial = (b: SpezialBlock | null | undefined) => {
    if (!b) return;
    if (rows.length > 0 && spacerBefore) rows.push(spacerBefore);
    rows.push(
      buildDataRow(dataRowXml, {
        col1: [b.label],
        col2: b.fahrzeuge.length > 0 ? b.fahrzeuge : [""],
        col3: b.taetigkeit ? [b.taetigkeit] : [""],
        col4: b.mitarbeiter.length > 0 ? b.mitarbeiter : [""],
      })
    );
  };
  addSpezial(data.produktion);
  addSpezial(data.urlaub);
  addSpezial(data.polierschule);
  addSpezial(data.krank);
  addSpezial(data.stempeln);

  // Ersetze: spacerBefore + dataRowXml → rows.join("")
  const newRows = rows.join("");
  const oldBlock = (spacerBefore ?? "") + dataRowXml;
  const idxOldBlock = updated.indexOf(oldBlock);
  if (idxOldBlock >= 0) {
    updated = updated.slice(0, idxOldBlock) + newRows + updated.slice(idxOldBlock + oldBlock.length);
  } else {
    // Fallback: nur dataRowXml ersetzen
    updated = updated.replace(dataRowXml, newRows);
  }

  zip.file(docPath, updated);
  const out = zip.generate({
    type: "blob",
    mimeType: DOCX_MIME,
    compression: "DEFLATE",
  });
  return out;
}

/** Versendet (Web-Share-API) oder lädt das DOCX herunter. */
export async function shareOrDownloadDocx(blob: Blob, fileName: string) {
  try {
    const file = new File([blob], fileName, { type: DOCX_MIME });
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: { files?: File[]; title?: string }) => Promise<void>;
    };
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: fileName });
      return;
    }
  } catch {
    // ignore — auf Download fallen
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
