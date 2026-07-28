/**
 * Tätigkeitsbericht als PDF — Nachbau der alten Excel.
 *
 * Querformat A4, Serifenschrift, feines Gitter. Aufbau wie in
 * `baustellenstundenberichtPdf.ts` (autoTable mit theme "grid" und
 * `didParseCell` für die zellweise Einfärbung), Aufteilung in
 * `render…(doc, …)` + Factory wie in `stundenZettelPdf.ts`.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ANGESTELLTEN_SOLL,
  UEBERSTUNDEN_GRENZE,
  UEBERSTUNDEN_WARNUNG,
  WOCHENTAG_KURZ,
  r2,
  tagesBeschriftung,
  wochentagIndex,
  type BerichtSummen,
} from "@/lib/taetigkeitsbericht";

export interface TaetigkeitsberichtZeile {
  kst: string;
  bezeichnung: string;
  /** iso → Stunden */
  werte: Record<string, number>;
}

export interface TaetigkeitsberichtInput {
  name: string;
  /** „Jänner - Februar 2026" */
  titel: string;
  tage: string[];
  zeilen: TaetigkeitsberichtZeile[];
  /** urlaub | sonderurlaub | krankheit | feiertag → iso → Stunden */
  sonder: Record<string, Record<string, number>>;
  summen: BerichtSummen;
  taggeld6: Record<string, number>;
  taggeld11: Record<string, number>;
  km: Record<string, number>;
  kmSatz: number;
}

const GRAU: [number, number, number] = [244, 244, 244];
const WOCHENENDE: [number, number, number] = [232, 232, 232];

/** Zahl wie in der Excel: Komma, 0 bleibt leer. */
const z = (n: number | null | undefined): string =>
  n == null || n === 0 ? "" : String(r2(n)).replace(".", ",");

const summeVon = (tage: string[], m: Record<string, number>) =>
  r2(tage.reduce((a, t) => a + (m[t] ?? 0), 0));

export function renderTaetigkeitsbericht(
  doc: jsPDF,
  input: TaetigkeitsberichtInput,
  addPage = false,
): void {
  if (addPage) doc.addPage();
  const pageW = doc.internal.pageSize.getWidth(); // 297 mm
  const margin = 8;
  const { tage } = input;
  const freierTag = (iso: string) => ANGESTELLTEN_SOLL[wochentagIndex(iso)] === 0;

  // ─── Kopf ──────────────────────────────────────────────────────────
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0, 0, 0);
  // Gesperrt gesetzt wie im Original („T Ä T I G K E I T S B E R I C H T")
  doc.text("T Ä T I G K E I T S B E R I C H T", pageW / 2, 13, { align: "center" });

  doc.setFontSize(10);
  doc.text("NAME:", margin, 21);
  doc.setFont("times", "normal");
  doc.text(input.name, margin + 16, 21);
  doc.setFont("times", "bold");
  doc.text("Monat/Jahr:", pageW / 2 - 10, 21);
  doc.setFont("times", "normal");
  doc.text(input.titel, pageW / 2 + 12, 21);

  // ─── Tabelle ───────────────────────────────────────────────────────
  const head = [
    // Wochentagszeile
    ["", "", ...tage.map((t) => WOCHENTAG_KURZ[wochentagIndex(t)]), ""],
    // Datumszeile
    ["Kst", "Baustelle", ...tage.map((t) => `${t.slice(8)}.`), "Gesamt"],
  ];

  // autoTable-Zellen: einfache Strings oder {content, colSpan}
  type Zelle = string | { content: string; colSpan?: number; styles?: any };
  const body: Zelle[][] = [];
  /** Zeilenindizes, die grau hinterlegt werden (Abwesenheiten). */
  const grauZeilen = new Set<number>();
  /** Zeilenindizes in Fettdruck (Summen). */
  const fettZeilen = new Set<number>();

  input.zeilen.forEach((zl) => {
    body.push([
      zl.kst,
      zl.bezeichnung,
      ...tage.map((t) => z(zl.werte[t])),
      z(summeVon(tage, zl.werte)),
    ]);
  });

  const summenZeile = (
    label: string,
    werte: Record<string, number>,
    gesamt: number,
    opt: { grau?: boolean; fett?: boolean } = {},
  ) => {
    if (opt.grau) grauZeilen.add(body.length);
    if (opt.fett) fettZeilen.add(body.length);
    // Die Beschriftung braucht BEIDE linken Spalten (11 + 44 mm), sonst wird
    // sie abgeschnitten — „Zwischensumme" wurde zu „Zwischen".
    body.push([
      { content: label, colSpan: 2, styles: { halign: "left", fontStyle: "bold" } },
      ...tage.map((t) => z(werte[t])),
      z(gesamt),
    ]);
  };

  const s = input.summen;
  summenZeile("Zwischensumme", s.zwischensumme, s.zwischensummeGesamt, { fett: true });
  summenZeile("Urlaub", input.sonder.urlaub ?? {}, summeVon(tage, input.sonder.urlaub ?? {}), { grau: true });
  summenZeile("Sonderurlaub", input.sonder.sonderurlaub ?? {}, summeVon(tage, input.sonder.sonderurlaub ?? {}), { grau: true });
  summenZeile("Krankheit", input.sonder.krankheit ?? {}, summeVon(tage, input.sonder.krankheit ?? {}), { grau: true });
  summenZeile("Feiertag", input.sonder.feiertag ?? {}, summeVon(tage, input.sonder.feiertag ?? {}), { grau: true });
  summenZeile("Stundensumme/Tag", s.stundensumme, s.stundensummeGesamt, { fett: true });
  summenZeile("Sollstunden/Tag", s.soll, s.sollGesamt);
  summenZeile("DELTA", s.delta, s.deltaGesamt, { fett: true });
  summenZeile("Taggeld > 6 Std.", input.taggeld6, summeVon(tage, input.taggeld6));
  summenZeile("Taggeld > 11 Std.", input.taggeld11, summeVon(tage, input.taggeld11));
  summenZeile("gefahrene km", input.km, summeVon(tage, input.km));
  // Kilometergeld: Satz links, Betrag rechts — wie Zeile 40 der Excel.
  fettZeilen.add(body.length);
  body.push([
    {
      content: `${String(input.kmSatz).replace(".", ",")} € / km`,
      colSpan: 2,
      styles: { halign: "left", fontStyle: "bold" },
    },
    ...tage.map(() => ""),
    z(r2(summeVon(tage, input.km) * input.kmSatz)),
  ]);

  const tagSpalten = tage.length;
  const columnStyles: Record<number, any> = {
    0: { cellWidth: 11, fontStyle: "bold", halign: "left" },
    1: { cellWidth: 44, halign: "left" },
    [tagSpalten + 2]: { cellWidth: 13, halign: "right", fontStyle: "bold" },
  };
  const restBreite = pageW - 2 * margin - 11 - 44 - 13;
  for (let i = 0; i < tagSpalten; i++) {
    columnStyles[i + 2] = { cellWidth: restBreite / tagSpalten, halign: "right" };
  }

  autoTable(doc, {
    startY: 26,
    head,
    body,
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 6.5,
      cellPadding: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 },
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      valign: "middle",
      overflow: "hidden",
    },
    headStyles: {
      font: "times",
      fontSize: 6.5,
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      fontStyle: "bold",
      halign: "right",
    },
    columnStyles,
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      const spalte = data.column.index;
      const istTagSpalte = spalte >= 2 && spalte < tagSpalten + 2;
      const iso = istTagSpalte ? tage[spalte - 2] : null;

      // Wochenende / freier Freitag grau — wie die gesperrten Spalten der Excel
      if (iso && freierTag(iso)) data.cell.styles.fillColor = WOCHENENDE;

      if (data.section === "head") {
        // Erste Kopfzeile (Wochentage) ohne Rahmen und ohne Fettdruck
        if (data.row.index === 0) {
          data.cell.styles.lineWidth = 0;
          data.cell.styles.fontStyle = "normal";
          data.cell.styles.halign = "right";
        } else if (spalte === 0 || spalte === 1 || spalte === tagSpalten + 2) {
          data.cell.styles.halign = spalte === tagSpalten + 2 ? "right" : "left";
          data.cell.styles.fontStyle = "italic";
        }
        return;
      }

      const zeile = data.row.index;
      if (grauZeilen.has(zeile) && !(iso && freierTag(iso))) {
        data.cell.styles.fillColor = GRAU;
      }
      if (fettZeilen.has(zeile)) data.cell.styles.fontStyle = "bold";
      // Beschriftung der Summenzeilen linksbündig über beide Spalten
      if ((grauZeilen.has(zeile) || fettZeilen.has(zeile)) && spalte === 0) {
        data.cell.styles.halign = "left";
      }
    },
  });

  // ─── Fuß ───────────────────────────────────────────────────────────
  // @ts-ignore — lastAutoTable ist nicht typisiert
  let y = (doc as any).lastAutoTable.finalY + 6;

  if (input.summen.deltaGesamt > UEBERSTUNDEN_GRENZE) {
    doc.setFont("times", "italic");
    doc.setFontSize(7.5);
    doc.text(UEBERSTUNDEN_WARNUNG, margin, y);
    y += 7;
  }

  // Feiertage der Periode. Die Excel schreibt sie senkrecht über die
  // Tagesspalte; im Ausdruck sind die Spalten dafür zu schmal, deshalb als
  // Zeile darunter — mit Datum, damit die Zuordnung eindeutig bleibt.
  const feiertage = tage
    .map((t) => ({ t, info: tagesBeschriftung(t) }))
    .filter((x) => x.info);
  if (feiertage.length > 0) {
    doc.setFont("times", "normal");
    doc.setFontSize(7.5);
    doc.text(
      feiertage.map((x) => `${x.t.slice(8)}.${x.t.slice(5, 7)}. ${x.info!.name}`).join("   ·   "),
      margin,
      y,
    );
    y += 7;
  }

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.text(`Datum: ${new Date().toLocaleDateString("de-AT")}`, margin, y + 4);
  doc.text(
    "Unterschrift: ..................................................",
    pageW / 2 - 20,
    y + 4,
  );
}

export function makeTaetigkeitsberichtPdf(input: TaetigkeitsberichtInput): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  renderTaetigkeitsbericht(doc, input);
  return doc;
}

/** Sammel-PDF: ein Angestellter pro Seite. */
export function makeAlleTaetigkeitsberichtePdf(
  alle: TaetigkeitsberichtInput[],
): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  alle.forEach((input, i) => renderTaetigkeitsbericht(doc, input, i > 0));
  return doc;
}
