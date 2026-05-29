/**
 * PDF einer unterschriebenen Evaluierung — Sicherheits-Unterweisungs-
 * Protokoll pro Mitarbeiter. Querformat A4, Firmenkopf, Baustellen-Daten,
 * Checklisten-Tabelle (i.O./nicht i.O./n.A.), Notizen, Unterschrift-Block.
 *
 * Nutzt denselben jsPDF + autoTable Stack wie `baustellenstundenberichtPdf`.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ChecklisteItem = {
  /** Wir akzeptieren mehrere Schreibweisen, weil das Schema historisch
   *  gewachsen ist (KI-Dialog vs. manuell). */
  text?: string;
  bezeichnung?: string;
  frage?: string;
  ergebnis?: "io" | "nio" | "na" | string | null;
  status?: "io" | "nio" | "na" | string | null;
  anmerkung?: string;
  notiz?: string;
};

export interface EvaluierungPdfInput {
  titel: string; // notizen oder „Sicherheits-Unterweisung"
  typLabel: string; // „Werkstatt" / „Baustelle" / „Fertigteilmontage"
  datum: string; // 28.05.2026
  bvhName: string;
  kostenstelle: string;
  ort: string;
  vortragender: string;
  checkliste: ChecklisteItem[];
  notizen: string;
  mitarbeiterName: string;
  unterschriftBase64: string | null; // base64 PNG (inkl. data:URL oder rein)
  unterschriebenAm: string | null; // 28.05.2026 14:30
}

const BURGUNDY: [number, number, number] = [182, 86, 103];
const GRUEN: [number, number, number] = [22, 163, 74];
const ROT: [number, number, number] = [220, 38, 38];
const GRAU: [number, number, number] = [120, 120, 125];

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

function ergebnisLabel(e: ChecklisteItem): {
  text: string;
  color: [number, number, number];
} {
  const v = (e.ergebnis ?? e.status ?? "").toString().toLowerCase();
  if (v === "io" || v === "i.o.") return { text: "i.O.", color: GRUEN };
  if (v === "nio" || v === "n.i.o." || v === "nicht_io")
    return { text: "nicht i.O.", color: ROT };
  if (v === "na" || v === "n.a." || v === "nicht_anwendbar")
    return { text: "n.A.", color: GRAU };
  return { text: "—", color: GRAU };
}

function itemText(e: ChecklisteItem): string {
  return e.text || e.bezeichnung || e.frage || "";
}

function itemAnm(e: ChecklisteItem): string {
  return e.anmerkung || e.notiz || "";
}

export async function makeEvaluierungPdf(
  input: EvaluierungPdfInput,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(); // 210
  const margin = 14;
  const logo = await getLogo();

  // ─── Kopf ──
  if (logo) {
    try {
      doc.addImage(logo, "JPEG", margin, 10, 22, 22, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 95);
  doc.setFont("helvetica", "normal");
  const adr = [
    "Holzbau Willroider",
    "A-9500 Villach, Willroider Straße 13",
    "Tel. (0 42 42) 24 1 82 · office@willroider.at",
  ];
  adr.forEach((l, i) => doc.text(l, margin + 25, 14 + i * 3.6));

  // Titel
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BURGUNDY);
  doc.text("Sicherheits-Unterweisung", pageW / 2, 18, { align: "center" });
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(`Typ: ${input.typLabel} · ${input.datum}`, pageW / 2, 24, {
    align: "center",
  });

  // ─── Baustellen-Block ──
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  let y = 40;
  const kv: [string, string][] = [
    ["Bauvorhaben:", input.bvhName],
    ["Kostenstelle:", input.kostenstelle || "—"],
    ["Ort:", input.ort || "—"],
    ["Vortragender:", input.vortragender || "—"],
    ["Mitarbeiter:", input.mitarbeiterName],
  ];
  kv.forEach(([k, v]) => {
    doc.setFont("helvetica", "normal");
    doc.text(k, margin, y);
    doc.setFont("helvetica", "bold");
    doc.text(v, margin + 32, y);
    y += 5;
  });

  // ─── Checkliste ──
  y += 4;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BURGUNDY);
  doc.text("Checkliste", margin, y);
  y += 3;

  const items = (input.checkliste ?? []).filter((i) => itemText(i).trim());
  if (items.length === 0) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(120, 120, 125);
    doc.text("Keine Checklisten-Punkte erfasst.", margin, y + 6);
    y += 12;
  } else {
    autoTable(doc, {
      startY: y + 2,
      head: [["Punkt", "Ergebnis", "Anmerkung"]],
      body: items.map((it) => [itemText(it), ergebnisLabel(it).text, itemAnm(it)]),
      theme: "grid",
      styles: {
        fontSize: 9,
        cellPadding: 1.8,
        lineColor: [180, 180, 185],
        lineWidth: 0.1,
        textColor: [25, 25, 25],
        valign: "top",
      },
      headStyles: {
        fillColor: [232, 232, 234],
        textColor: [20, 20, 20],
        fontStyle: "bold",
        fontSize: 9,
      },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 28, halign: "center", fontStyle: "bold" },
        2: { cellWidth: "auto" },
      },
      didParseCell: (data) => {
        // Spalte „Ergebnis" einfärben (nur im body)
        if (
          data.section === "body" &&
          data.column.index === 1 &&
          data.row.index < items.length
        ) {
          const col = ergebnisLabel(items[data.row.index]).color;
          data.cell.styles.textColor = col;
        }
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ─── Notizen ──
  if (input.notizen && input.notizen.trim()) {
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...BURGUNDY);
    doc.text("Notizen", margin, y);
    y += 5;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(input.notizen, pageW - 2 * margin);
    doc.text(lines, margin, y);
    y += lines.length * 4 + 6;
  }

  // ─── Unterschrift-Block ──
  if (y > 230) {
    doc.addPage();
    y = 20;
  }
  doc.setDrawColor(180, 180, 185);
  doc.setLineWidth(0.1);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BURGUNDY);
  doc.text("Unterschrift Mitarbeiter", margin, y);
  y += 4;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 30, 30);
  doc.text(input.mitarbeiterName, margin, y + 3);
  if (input.unterschriebenAm) {
    doc.setTextColor(120, 120, 125);
    doc.text(`Unterschrieben am ${input.unterschriebenAm}`, margin, y + 7);
    doc.setTextColor(30, 30, 30);
  }

  if (input.unterschriftBase64) {
    try {
      const dataUrl = input.unterschriftBase64.startsWith("data:")
        ? input.unterschriftBase64
        : `data:image/png;base64,${input.unterschriftBase64}`;
      // rechte Seite: 70 × 25 mm
      const sigX = pageW - margin - 70;
      const sigY = y - 2;
      doc.addImage(dataUrl, "PNG", sigX, sigY, 70, 25, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }

  return doc;
}
