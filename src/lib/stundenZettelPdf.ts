/**
 * PDF-Stundenzettel pro Mitarbeiter pro Monat.
 *
 * Format A4 Portrait, 1–2 Seiten pro MA:
 *   - Header: Firma + MA-Name + Monat
 *   - Tabelle: Datum | Wt | Status | Netto | Tätigkeiten | Zulagen | Taggeld
 *   - Aggregations-Block: Tätigkeiten-Summen, Zulagen-Summen, Taggeld-Summen
 *   - Summen-Box: Soll · Ist · Differenz → ZA-Buchung
 *   - Unterschriftenfeld
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StundenTagFull } from "@/hooks/useStundenTag";
import {
  aggregiereTaetigkeiten,
  aggregiereZulagen,
  aggregiereTaggeld,
  taggeldFuerTag,
  fmtEur,
  fmtTaetigkeitenInline,
  fmtZulagenInline,
  type TaetigkeitName,
  type ZulagenTypName,
  type PausenDauer,
  TAGGELD_SATZ_KURZ_EUR,
  TAGGELD_SATZ_LANG_EUR,
} from "@/lib/stundenAggregation";

const STATUS_LABEL: Record<string, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "SW",
  feiertag: "Feiertag",
};

const WT_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const PAGE_W = 210;
const MARGIN = 12;

export interface StundenzettelData {
  mitarbeiter: { id: string; vorname: string; nachname: string };
  monat: string; // "2026-04"
  tage: StundenTagFull[];
  soll: number;
  ist: number;
  diff: number;
  taetigkeitenStamm: TaetigkeitName[];
  zulagenTypen: ZulagenTypName[];
  pausen: PausenDauer;
}

function monatLabel(monat: string): string {
  const [y, m] = monat.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("de-AT", {
    year: "numeric",
    month: "long",
  });
}

function fmtH(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} h`;
}

function fmtDate(iso: string): { wt: string; date: string } {
  const d = new Date(iso + "T00:00:00");
  return {
    wt: WT_KURZ[d.getDay()],
    date: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`,
  };
}

/** Schreibt einen einzelnen MA-Stundenzettel in das gegebene jsPDF-Dokument.
 *  Wenn `addPage=true`, wird vorher eine neue Seite hinzugefügt — so kann
 *  diese Funktion für Multi-MA-PDFs wiederholt aufgerufen werden. */
export function renderStundenzettel(
  doc: jsPDF,
  data: StundenzettelData,
  addPage = false,
): void {
  if (addPage) doc.addPage();

  const aggTaet = aggregiereTaetigkeiten(data.tage, data.taetigkeitenStamm);
  const aggZul = aggregiereZulagen(data.tage, data.zulagenTypen);
  const aggTg = aggregiereTaggeld(data.tage, data.pausen);

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Holzbau Willroider — Stundenzettel", PAGE_W / 2, 15, { align: "center" });

  doc.setFontSize(11);
  doc.text(`${data.mitarbeiter.nachname} ${data.mitarbeiter.vorname}`, MARGIN, 24);
  doc.setFont("helvetica", "normal");
  doc.text(monatLabel(data.monat), PAGE_W - MARGIN, 24, { align: "right" });

  // Tages-Tabelle
  const sortiert = [...data.tage].sort((a, b) => a.tag.datum.localeCompare(b.tag.datum));
  const body = sortiert.map((t) => {
    const d = fmtDate(t.tag.datum);
    const status = STATUS_LABEL[t.tag.tag_status] ?? t.tag.tag_status;
    const netto = Number(t.tag.netto_stunden);
    const taet = fmtTaetigkeitenInline(t, data.taetigkeitenStamm);
    const zul = fmtZulagenInline(t, data.zulagenTypen);
    const tg = taggeldFuerTag(t, data.pausen);
    const tgK = tg.kurz;
    const tgL = tg.lang;
    const tgStr = tgL > 0 ? `${tgL}× L` : tgK > 0 ? `${tgK}× K` : "—";
    return [d.date, d.wt, status, fmtH(netto), taet || "—", zul || "—", tgStr];
  });

  autoTable(doc, {
    startY: 30,
    head: [["Datum", "Wt", "Status", "Netto", "Tätigkeiten", "Zulagen", "Taggeld"]],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.5, valign: "middle" },
    headStyles: { fillColor: [240, 240, 240], textColor: 30, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 8 },
      2: { cellWidth: 22 },
      3: { cellWidth: 18, halign: "right" },
      4: { cellWidth: 62 },
      5: { cellWidth: 42 },
      6: { cellWidth: 16, halign: "center" },
    },
  });

  // Position nach der Tabelle
  // @ts-ignore — jspdf-autotable hängt lastAutoTable an
  let y = doc.lastAutoTable.finalY + 6;

  // Aggregations-Block: 2 Spalten nebeneinander
  const colW = (PAGE_W - 2 * MARGIN - 6) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Tätigkeiten im Monat", leftX, y);
  doc.text("Zulagen", rightX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  let yL = y + 4;
  let yR = y + 4;
  if (aggTaet.length === 0) {
    doc.setTextColor(120);
    doc.text("—", leftX, yL);
    doc.setTextColor(0);
    yL += 4;
  } else {
    for (const a of aggTaet) {
      doc.text(`${a.bezeichnung}`, leftX, yL);
      doc.text(fmtH(a.summe_stunden), leftX + colW - 1, yL, { align: "right" });
      yL += 4;
    }
  }
  if (aggZul.length === 0) {
    doc.setTextColor(120);
    doc.text("—", rightX, yR);
    doc.setTextColor(0);
    yR += 4;
  } else {
    for (const z of aggZul) {
      doc.text(`${z.bezeichnung} (${z.anzahl_tage} Tag${z.anzahl_tage === 1 ? "" : "e"})`, rightX, yR);
      doc.text(fmtH(z.summe_stunden), rightX + colW - 1, yR, { align: "right" });
      yR += 4;
    }
  }

  y = Math.max(yL, yR) + 4;

  // Taggeld + Summen-Box
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Taggeld", leftX, y);
  doc.text("Soll · Ist · Differenz", rightX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  y += 4;

  doc.text(`Kurz (${fmtEur(TAGGELD_SATZ_KURZ_EUR)})`, leftX, y);
  doc.text(`${aggTg.kurz_anzahl}× · ${fmtEur(aggTg.kurz_eur)}`, leftX + colW - 1, y, {
    align: "right",
  });
  doc.text(`Soll (Kalender)`, rightX, y);
  doc.text(fmtH(data.soll), rightX + colW - 1, y, { align: "right" });
  y += 4;

  doc.text(`Lang (${fmtEur(TAGGELD_SATZ_LANG_EUR)})`, leftX, y);
  doc.text(`${aggTg.lang_anzahl}× · ${fmtEur(aggTg.lang_eur)}`, leftX + colW - 1, y, {
    align: "right",
  });
  doc.text(`Ist (Netto)`, rightX, y);
  doc.text(fmtH(data.ist), rightX + colW - 1, y, { align: "right" });
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.text("Summe", leftX, y);
  doc.text(fmtEur(aggTg.total_eur), leftX + colW - 1, y, { align: "right" });
  doc.text("Differenz → ZA-Buchung", rightX, y);
  doc.text(`${data.diff > 0 ? "+" : ""}${fmtH(data.diff)}`, rightX + colW - 1, y, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");

  // Unterschriftenfeld
  y += 18;
  doc.setFontSize(8);
  doc.line(MARGIN, y, MARGIN + 70, y);
  doc.line(PAGE_W - MARGIN - 70, y, PAGE_W - MARGIN, y);
  doc.text("Mitarbeiter", MARGIN, y + 4);
  doc.text("Büro", PAGE_W - MARGIN - 70, y + 4);
}

/** Generiert einen einzelnen Stundenzettel als jsPDF-Objekt. */
export function makeStundenzettelPdf(data: StundenzettelData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  renderStundenzettel(doc, data, false);
  return doc;
}

/** Generiert ein PDF mit allen Stundenzetteln hintereinander (1 MA pro Seite). */
export function makeAlleStundenzettelPdf(alleData: StundenzettelData[]): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  alleData.forEach((d, idx) => {
    renderStundenzettel(doc, d, idx > 0);
  });
  return doc;
}
