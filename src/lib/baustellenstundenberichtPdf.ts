/**
 * Baustellenstundenbericht als PDF — Querformat A4, nach der Papier-Vorlage:
 * Firmenkopf · Titel · Monat/Jahr/Eintritt/Austritt · Pers.-Nr./Name ·
 * Raster Kostenstelle | Baustelle | Tage · Zulagen · Legende ·
 * Unterschriftsfelder.
 *
 * Geänderte Tagesspalten sind GELB solange der Bericht noch nicht
 * bestätigt ist (Hinweis: bitte durchschauen). Nach Büro-Bestätigung
 * wechseln dieselben Zellen auf GRÜN — "geprüft & OK".
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface BsbPdfRow {
  kostenstelle: string;
  baustelle: string;
  /** Anzeigewert je Tag — gleiche Reihenfolge wie tage[]. */
  zellen: string[];
  summe: string;
}

export interface BsbPdfInput {
  teilLabel: string; // z.B. "Teil I v. 1. bis 16."
  monat: string; // "Jänner"
  jahr: number;
  name: string;
  persNr: string;
  eintritt: string;
  austritt: string;
  tage: number[]; // Tagesnummern für die Kopfzeile
  tageIso: string[]; // parallele ISO-Daten (für Gelb-Diff)
  geaendert: Set<string>;
  rows: BsbPdfRow[];
  summenZeile: string[]; // Tages-Summen
  summeGesamt: string;
  zulagen: string[];
  unterschrift: string | null; // Base64-PNG
  unterschriebenAm: string | null;
  bestaetigtAm: string | null;
  /** Wenn true, werden geänderte Tagesspalten grün („geprüft") statt
   *  gelb („bitte durchschauen") gezeichnet. Defaultet zu false, damit
   *  Aufrufer ohne Status-Info das alte Verhalten erhalten. */
  geprueft?: boolean;
}

const BURGUNDY: [number, number, number] = [182, 86, 103];
const GELB: [number, number, number] = [254, 240, 138];
const GRUEN: [number, number, number] = [187, 247, 208];

let _logoCache: string | null = null;
async function getLogo(): Promise<string | null> {
  if (_logoCache) return _logoCache;
  try {
    const res = await fetch("/willroider-logo.jpg");
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    _logoCache = dataUrl;
    return dataUrl;
  } catch {
    return null;
  }
}

export async function makeBaustellenstundenberichtPdf(
  input: BsbPdfInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(); // 297
  const margin = 10;
  const logo = await getLogo();

  // ─── Kopf ──────────────────────────────────────────────────────────────
  if (logo) {
    try {
      doc.addImage(logo, "JPEG", margin, 8, 20, 20, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }

  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 95);
  doc.setFont("helvetica", "normal");
  const adr = [
    "Holzbau Willroider",
    "A-9500 Villach, Willroider Straße 13",
    "Tel. (0 42 42) 24 1 82 · office@willroider.at",
  ];
  adr.forEach((l, i) => doc.text(l, margin + 23, 12 + i * 3.4));

  // Titel zentriert
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BURGUNDY);
  doc.text(`Baustellenstundenbericht – ${input.teilLabel}`, pageW / 2, 14, {
    align: "center",
  });

  // Monat/Jahr/Eintritt/Austritt oben rechts
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  const boxX = pageW - margin - 52;
  const kv: [string, string][] = [
    ["Monat:", `${input.monat} ${input.jahr}`],
    ["Eintritt:", input.eintritt || "—"],
    ["Austritt:", input.austritt || "—"],
  ];
  kv.forEach(([k, v], i) => {
    doc.setFont("helvetica", "normal");
    doc.text(k, boxX, 11 + i * 4.2);
    doc.setFont("helvetica", "bold");
    doc.text(v, boxX + 16, 11 + i * 4.2);
  });

  // Pers.-Nr. + Name
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 30, 30);
  doc.text("Pers.-Nr.:", margin, 27);
  doc.setFont("helvetica", "bold");
  doc.text(input.persNr || "—", margin + 16, 27);
  doc.setFont("helvetica", "normal");
  doc.text("Name:", margin + 40, 27);
  doc.setFont("helvetica", "bold");
  doc.text(input.name, margin + 53, 27);

  // ─── Raster ────────────────────────────────────────────────────────────
  const head = [
    ["Kostenstelle", "Baustelle", ...input.tage.map(String), "Σ"],
  ];
  const body = input.rows.map((r) => [
    r.kostenstelle,
    r.baustelle,
    ...r.zellen,
    r.summe,
  ]);
  body.push(["", "Summe", ...input.summenZeile, input.summeGesamt]);

  const dayColStart = 2;
  const lastCol = dayColStart + input.tage.length;
  const summenRowIndex = body.length - 1;

  autoTable(doc, {
    startY: 31,
    head,
    body,
    theme: "grid",
    styles: {
      fontSize: 7,
      cellPadding: 1,
      halign: "center",
      valign: "middle",
      lineColor: [120, 120, 125],
      lineWidth: 0.1,
      textColor: [25, 25, 25],
    },
    headStyles: {
      fillColor: [232, 232, 234],
      textColor: [20, 20, 20],
      fontStyle: "bold",
      fontSize: 7,
    },
    columnStyles: {
      0: { cellWidth: 20, halign: "left" },
      1: { cellWidth: 50, halign: "left" },
      [lastCol]: { cellWidth: 14, fontStyle: "bold" },
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      const c = data.column.index;
      const markerFarbe = input.geprueft ? GRUEN : GELB;
      if (c >= dayColStart && c < lastCol) {
        const iso = input.tageIso[c - dayColStart];
        if (iso && input.geaendert.has(iso)) {
          data.cell.styles.fillColor = markerFarbe;
        }
      }
      if (data.section === "body" && data.row.index === summenRowIndex) {
        data.cell.styles.fontStyle = "bold";
        if (!(c >= dayColStart && c < lastCol && input.geaendert.has(input.tageIso[c - dayColStart]))) {
          data.cell.styles.fillColor = [243, 243, 244];
        }
      }
    },
  });

  // @ts-ignore — lastAutoTable
  let y = doc.lastAutoTable.finalY + 5;

  // ─── Zulagen ───────────────────────────────────────────────────────────
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.text("Zulagen etc.:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(
    input.zulagen.length > 0 ? input.zulagen.join("   ·   ") : "—",
    margin + 22,
    y,
  );
  y += 6;

  // ─── Legende ───────────────────────────────────────────────────────────
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 95);
  doc.text(
    "ZA = Zeitausgleich    K = Krankenstand    U = Urlaub    F = Feiertag    SW = Schlechtwetter    S = Sozialstunden",
    margin,
    y,
  );
  y += 7;

  // ─── Unterschriften ────────────────────────────────────────────────────
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(8);
  const colW = (pageW - 2 * margin) / 3;

  // aufgestellt (Mitarbeiter)
  if (input.unterschrift) {
    try {
      doc.addImage(input.unterschrift, "PNG", margin, y, 38, 14, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }
  doc.line(margin, y + 15, margin + colW - 8, y + 15);
  doc.text(
    `aufgestellt am: ${input.unterschriebenAm ?? ""}`,
    margin,
    y + 19,
  );

  // geprüft (Büro)
  doc.line(margin + colW, y + 15, margin + 2 * colW - 8, y + 15);
  doc.text(
    `geprüft am: ${input.bestaetigtAm ?? ""}`,
    margin + colW,
    y + 19,
  );

  // Lohnbüro
  doc.line(margin + 2 * colW, y + 15, pageW - margin, y + 15);
  doc.text("Lohnbüro EDV-erfasst am:", margin + 2 * colW, y + 19);

  doc.setFontSize(7);
  doc.setTextColor(120, 120, 125);
  doc.text(
    "Abgabe am 16. bzw. am darauffolgenden Werktag!",
    margin,
    y + 25,
  );

  return doc;
}
