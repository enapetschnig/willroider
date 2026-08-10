/**
 * Tätigkeitsbericht + Fahrtenbuch als PDF — Nachbau der Excel-Vorlage.
 *
 * Querformat A4, Serifenschrift, feines Gitter. Die Farben kommen aus
 * TB_FARBEN und sind dieselben wie am Bildschirm: Titelband silbergrau,
 * Samstag hell, Sonntag/Feiertag dunkel über die GANZE Spalte (mit dem
 * Feiertagsnamen senkrecht in der Tabelle), Zwischensumme blau,
 * Stundensumme grün. Die Unterschrift wird als Bild gedruckt, wenn sie
 * in der App geleistet wurde.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ANGESTELLTEN_SOLL,
  TB_FARBEN,
  UEBERSTUNDEN_GRENZE,
  UEBERSTUNDEN_WARNUNG,
  WOCHENTAG_KURZ,
  fahrtDauerH,
  periodeKurz,
  periodeTitel,
  r2,
  tagesBeschriftung,
  wochentagIndex,
  type BerichtSummen,
  type Periode,
} from "@/lib/taetigkeitsbericht";
import type { FahrtRow } from "@/components/taetigkeitsbericht/FahrtenbuchTab";

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
  /** Base64-PNG der in der App geleisteten Unterschrift. */
  unterschrift?: string | null;
  unterschriebenAm?: string | null;
}

/** "#d6e4f0" → [214, 228, 240] — die App-Farben unverändert ins PDF. */
function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
const SILBER = rgb(TB_FARBEN.titel);
const GELB = rgb(TB_FARBEN.eingabe);
const SA = rgb(TB_FARBEN.samstag);
const SO_FEIERTAG = rgb(TB_FARBEN.sonnFeiertag);
const BLAU = rgb(TB_FARBEN.zwischensumme);
const GRUEN = rgb(TB_FARBEN.stundensumme);
const NAVY = rgb(TB_FARBEN.fahrtenbuchTitel);
const KOPFBLAU = rgb(TB_FARBEN.fahrtenbuchKopf);

/** Zahl wie in der Excel: Komma, 0 bleibt leer. */
const z = (n: number | null | undefined): string =>
  n == null || n === 0 ? "" : String(r2(n)).replace(".", ",");

const summeVon = (tage: string[], m: Record<string, number>) =>
  r2(tage.reduce((a, t) => a + (m[t] ?? 0), 0));

/** Spaltenfarbe eines Tages fürs PDF — wie tagSpaltenFarbe am Bildschirm. */
function tagFill(iso: string): [number, number, number] | null {
  if (tagesBeschriftung(iso)) return SO_FEIERTAG;
  const wt = wochentagIndex(iso);
  if (wt === 6) return SO_FEIERTAG;
  if (wt === 5) return SA;
  return null;
}

export function renderTaetigkeitsbericht(
  doc: jsPDF,
  input: TaetigkeitsberichtInput,
  addPage = false,
): void {
  if (addPage) doc.addPage();
  const pageW = doc.internal.pageSize.getWidth(); // 297 mm
  const margin = 8;
  const { tage } = input;

  // ─── Kopf ──────────────────────────────────────────────────────────
  // Titelband silbergrau wie in der Vorlage, mit Rahmen.
  doc.setFillColor(...SILBER);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(margin, 7, pageW - 2 * margin, 9, "FD");
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0, 0, 0);
  doc.text("T Ä T I G K E I T S B E R I C H T", pageW / 2, 13.2, { align: "center" });

  // Name + Monat groß, auf gelbem Eingabefeld wie in der Excel.
  doc.setFontSize(11);
  doc.setFont("times", "bold");
  doc.text("NAME:", margin, 22.5);
  const nameW = doc.getTextWidth(input.name) + 6;
  doc.setFillColor(...GELB);
  doc.setLineWidth(0.2);
  doc.rect(margin + 16, 18.5, Math.max(nameW, 40), 5.5, "FD");
  doc.text(input.name, margin + 19, 22.5);
  doc.text("Monat/Jahr:", pageW / 2 - 10, 22.5);
  const titelW = doc.getTextWidth(input.titel) + 6;
  doc.setFillColor(...GELB);
  doc.rect(pageW / 2 + 13, 18.5, Math.max(titelW, 40), 5.5, "FD");
  doc.text(input.titel, pageW / 2 + 16, 22.5);

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
  /** Zeilenindex → Zeilenfarbe (Zwischensumme blau, Stundensumme grün). */
  const zeilenFarbe = new Map<number, [number, number, number]>();
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
  const matrixZeilen = input.zeilen.length;

  const summenZeile = (
    label: string,
    werte: Record<string, number>,
    gesamt: number,
    opt: { farbe?: [number, number, number]; fett?: boolean } = {},
  ) => {
    if (opt.farbe) zeilenFarbe.set(body.length, opt.farbe);
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
  summenZeile("Zwischensumme", s.zwischensumme, s.zwischensummeGesamt, { fett: true, farbe: BLAU });
  summenZeile("Urlaub", input.sonder.urlaub ?? {}, summeVon(tage, input.sonder.urlaub ?? {}));
  summenZeile("Sonderurlaub", input.sonder.sonderurlaub ?? {}, summeVon(tage, input.sonder.sonderurlaub ?? {}));
  summenZeile("Krankheit", input.sonder.krankheit ?? {}, summeVon(tage, input.sonder.krankheit ?? {}));
  summenZeile("Feiertag", input.sonder.feiertag ?? {}, summeVon(tage, input.sonder.feiertag ?? {}));
  summenZeile("Stundensumme/Tag", s.stundensumme, s.stundensummeGesamt, { fett: true, farbe: GRUEN });
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

  /** Zellrechtecke der Feiertagsspalten im Matrix-Block — für den
   *  senkrechten Feiertagsnamen IN der Tabelle (wie am Bildschirm). */
  const feiertagsBlock = new Map<number, { x: number; w: number; top: number; bottom: number }>();

  autoTable(doc, {
    startY: 27,
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
        // Sa/So/Feiertag tragen ihre Spaltenfarbe schon im Kopf
        const fill = iso ? tagFill(iso) : null;
        if (fill) data.cell.styles.fillColor = fill;
        return;
      }

      const zeile = data.row.index;
      const rf = zeilenFarbe.get(zeile);
      if (rf) data.cell.styles.fillColor = rf;
      // Die Tagesfarbe übersteuert die Zeilenfarbe — wie in der Vorlage.
      const fill = iso ? tagFill(iso) : null;
      if (fill) data.cell.styles.fillColor = fill;
      if (fettZeilen.has(zeile)) data.cell.styles.fontStyle = "bold";
      if ((zeilenFarbe.has(zeile) || fettZeilen.has(zeile)) && spalte === 0) {
        data.cell.styles.halign = "left";
      }
    },
    didDrawCell: (data) => {
      // Rechtecke der Feiertagsspalten über den Matrix-Block sammeln
      if (data.section !== "body") return;
      const spalte = data.column.index;
      if (spalte < 2 || spalte >= tagSpalten + 2) return;
      // Wie die Excel: der Name darf über den Kst-Block hinaus bis in die
      // Abwesenheitszeilen laufen (Zwischensumme/Urlaub/Sonderurlaub/
      // Krankheit) — dort ist die Feiertagsspalte leer. Ab der Feiertag-
      // Zeile stehen Zahlen, dort endet der Block.
      if (data.row.index >= matrixZeilen + 4) return;
      const iso = tage[spalte - 2];
      if (!tagesBeschriftung(iso)) return;
      const cur = feiertagsBlock.get(spalte);
      const top = cur ? Math.min(cur.top, data.cell.y) : data.cell.y;
      const bottom = cur
        ? Math.max(cur.bottom, data.cell.y + data.cell.height)
        : data.cell.y + data.cell.height;
      feiertagsBlock.set(spalte, { x: data.cell.x, w: data.cell.width, top, bottom });
    },
  });

  // Feiertagsname senkrecht in die dunkle Spalte schreiben — wie die Excel
  // (dort ist die Spalte über den Kst-Block verbunden und beschriftet).
  // Der Name muss in die Blockhöhe passen: bei wenigen Matrix-Zeilen wird
  // die Schrift verkleinert und notfalls gekürzt, sonst ragt er oben in
  // die Kopfzeile hinein.
  doc.setFont("times", "bold");
  doc.setTextColor(0, 0, 0);
  for (const [spalte, rect] of feiertagsBlock) {
    const iso = tage[spalte - 2];
    let name = (tagesBeschriftung(iso)?.name ?? "").toUpperCase();
    if (!name) continue;
    const platz = rect.bottom - rect.top - 1.5;
    let groesse = 5.5;
    doc.setFontSize(groesse);
    while (doc.getTextWidth(name) > platz && groesse > 3.5) {
      groesse -= 0.5;
      doc.setFontSize(groesse);
    }
    while (doc.getTextWidth(name) > platz && name.length > 2) {
      name = name.slice(0, -2) + "…";
    }
    // angle 90: Text läuft von (x,y) nach oben.
    doc.text(name, rect.x + rect.w / 2 + 1, rect.bottom - 0.8, { angle: 90 });
  }

  // ─── Fuß ───────────────────────────────────────────────────────────
  // @ts-ignore — lastAutoTable ist nicht typisiert
  let y = (doc as any).lastAutoTable.finalY + 6;

  if (input.summen.deltaGesamt > UEBERSTUNDEN_GRENZE) {
    doc.setFont("times", "italic");
    doc.setFontSize(7.5);
    doc.text(UEBERSTUNDEN_WARNUNG, margin, y);
    y += 7;
  }

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  if (input.unterschrift) {
    // Bild UNTER der Tabelle beginnen lassen, Grundlinie darunter —
    // sonst ragt die Unterschrift in die letzte Tabellenzeile.
    doc.text(
      `Datum: ${input.unterschriebenAm ?? new Date().toLocaleDateString("de-AT")}`,
      margin,
      y + 11,
    );
    doc.text("Unterschrift:", pageW / 2 - 20, y + 11);
    try {
      doc.addImage(input.unterschrift, "PNG", pageW / 2 + 4, y + 1, 44, 14, undefined, "FAST");
    } catch {
      /* beschädigtes Bild darf das PDF nicht verhindern */
    }
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.line(pageW / 2 + 4, y + 15.5, pageW / 2 + 52, y + 15.5);
  } else {
    doc.text(
      `Datum: ${input.unterschriebenAm ?? new Date().toLocaleDateString("de-AT")}`,
      margin,
      y + 4,
    );
    doc.text(
      "Unterschrift: ..................................................",
      pageW / 2 - 20,
      y + 4,
    );
  }
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

// ─── Fahrtenbuch ───────────────────────────────────────────────────────

export interface FahrtenbuchPdfInput {
  name: string;
  kennzeichen: string;
  periode: Periode;
  fahrten: FahrtRow[];
}

export function makeFahrtenbuchPdf(input: FahrtenbuchPdfInput): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 8;
  const label = periodeKurz(input.periode);

  // Titelband dunkelblau, weiße Schrift — wie das Excel-Blatt.
  doc.setFillColor(...NAVY);
  doc.rect(margin, 7, pageW - 2 * margin, 10, "F");
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(`FAHRTENBUCH ${periodeTitel(input.periode)}`, pageW / 2, 13.7, { align: "center" });

  // Fahrer + Kennzeichen auf gelben Eingabefeldern.
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.text("Fahrer:", margin, 24);
  doc.setFillColor(...GELB);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.rect(margin + 16, 20.2, 60, 5.5, "FD");
  doc.setFont("times", "normal");
  doc.text(input.name, margin + 18, 24);
  doc.setFont("times", "bold");
  doc.text("Kennzeichen:", margin + 90, 24);
  doc.setFillColor(...GELB);
  doc.rect(margin + 116, 20.2, 40, 5.5, "FD");
  doc.setFont("times", "normal");
  doc.text(input.kennzeichen, margin + 118, 24);

  const body = input.fahrten.map((f) => [
    label,
    new Date(f.datum + "T00:00:00").toLocaleDateString("de-AT"),
    f.abfahrt?.slice(0, 5) ?? "",
    f.ankunft?.slice(0, 5) ?? "",
    f.reiseweg ?? "",
    z(f.km_start),
    z(f.km_ende),
    z(f.km),
    f.kostenstelle ?? "",
    z(fahrtDauerH(f.abfahrt, f.ankunft)),
  ]);
  const gesamt = r2(input.fahrten.reduce((a, f) => a + Number(f.km ?? 0), 0));

  autoTable(doc, {
    startY: 28,
    head: [[
      "Tätigkeitsbericht",
      "Datum",
      "Abfahrt",
      "Ankunft",
      "Reiseweg / Bemerkungen",
      "km-Stand\nAbfahrt",
      "km-Stand\nAnkunft",
      "gefahrene km",
      "Kostenstelle",
      "Dauer (h)",
    ]],
    body,
    foot: [[
      { content: "GESAMT km:", colSpan: 7, styles: { halign: "right", fontStyle: "bold" } },
      { content: z(gesamt), styles: { halign: "right", fontStyle: "bold", fillColor: GRUEN } },
      "",
      "",
    ]],
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 8.5,
      cellPadding: 1.2,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      valign: "middle",
    },
    headStyles: {
      fillColor: KOPFBLAU,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
    },
    footStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
    },
    columnStyles: {
      0: { cellWidth: 30, fontStyle: "bold" },
      1: { cellWidth: 22 },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 20, halign: "right" },
      6: { cellWidth: 20, halign: "right" },
      7: { cellWidth: 18, halign: "right", fontStyle: "bold" },
      8: { cellWidth: 26 },
      9: { cellWidth: 15, halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  return doc;
}
