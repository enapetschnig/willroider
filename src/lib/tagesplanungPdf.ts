/**
 * PDF-Generator für die Tagesplanung — gleiches Word-Layout wie die Bildschirm-Ansicht.
 *
 * Times-Serif, dünne schwarze Borders, fett-unterstrichene BVH-Namen mit Kostenstelle,
 * kursive Tätigkeits-Spalte, Sonderfälle-Block unten.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { TagesPlanData } from "@/hooks/useTagesplanung";

const WOCHENTAG = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

function fmtHeaderDatum(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${WOCHENTAG[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}.${d.getFullYear()}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

export function makeTagesplanungPdf(plan: TagesPlanData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 12;

  // ─── Titel-Box ───────────────────────────────────────────────────────
  const titelY = MARGIN + 5;
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN + 25, titelY - 4, PAGE_W - 2 * (MARGIN + 25), 10);
  doc.setFont("times", "bolditalic");
  doc.setFontSize(18);
  doc.setTextColor(0);
  doc.text("Arbeitseinteilung Zimmerei", PAGE_W / 2, titelY + 3, {
    align: "center",
  });

  // ─── Datum ───────────────────────────────────────────────────────────
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  const datumText = fmtHeaderDatum(plan.datum);
  doc.text(datumText, PAGE_W / 2, titelY + 14, { align: "center" });
  // Unterstreichen
  const datumWidth = doc.getTextWidth(datumText);
  doc.setLineWidth(0.3);
  doc.line(
    PAGE_W / 2 - datumWidth / 2,
    titelY + 15,
    PAGE_W / 2 + datumWidth / 2,
    titelY + 15,
  );

  let y = titelY + 20;

  // ─── Tabelle BVH | Fahrz. | Tätigkeit | Mitarbeiter ─────────────────
  const body = plan.einteilungen.map((e) => {
    const bvhText = e.baustelle
      ? `${e.baustelle.bvh_name}\n${e.baustelle.kostenstelle ?? ""}`
      : "(intern)";
    const fahrzText = e.fahrzeuge.map((f) => f.kennzeichen).join("\n") || "—";
    const taetText = e.einteilung.taetigkeit ?? "—";
    const maText =
      e.mitarbeiter
        .map((m) =>
          m.profil ? `${m.profil.nachname} ${m.profil.vorname}` : "",
        )
        .filter(Boolean)
        .join("\n") || "—";
    return [bvhText, fahrzText, taetText, maText];
  });
  // Polier/Partieleiter steht (durch die Hook-Sortierung) an erster Stelle —
  // im PDF wird er wie in der App FETT gedruckt (Eigen-Rendering der Zelle).
  const leiterErste = plan.einteilungen.map(
    (e) => !!(e.mitarbeiter[0]?.profil as any)?.is_partieleiter,
  );

  autoTable(doc, {
    startY: y,
    head: [["BVH:", "Fahrz.", "Tätigkeit", "Mitarbeiter"]],
    body,
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10,
      cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "top",
    },
    headStyles: {
      fontStyle: "bolditalic",
      fontSize: 10,
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: 50, fontStyle: "bold" },
      1: { cellWidth: 25, fontStyle: "bold" },
      2: { cellWidth: 38, fontStyle: "italic" },
      3: { cellWidth: "auto" },
    },
    margin: { left: MARGIN, right: MARGIN },
    didParseCell: (data) => {
      // BVH-Spalte: erste Zeile fett-unterstrichen, zweite (Kostenstelle) klein-kursiv
      if (data.section === "body" && data.column.index === 0) {
        const raw = data.cell.raw as string;
        const lines = raw.split("\n");
        if (lines.length >= 2) {
          // Custom-Render: wir setzen den ganzen Cell-Text auf einen Wert und nutzen
          // didDrawCell für nachträgliches Zeichnen. Stattdessen einfacher: behalte
          // den Standard-Style fett, Kostenstelle erscheint dann mit fett.
          // Eleganter wäre eine eigene didDrawCell, aber für V1 reicht's so.
        }
      }
    },
    // Mitarbeiter-Spalte selbst zeichnen, wenn der erste MA ein Polier ist:
    // Standard-Druck unterdrücken (Höhe wurde schon aus dem Text berechnet)…
    willDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 3 && leiterErste[data.row.index]) {
        data.cell.text = [];
      }
    },
    // …und Zeile für Zeile drucken — erste Zeile (Polier) FETT.
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 3 && leiterErste[data.row.index]) {
        const lines = String(body[data.row.index][3]).split("\n");
        const x = data.cell.x + 3;
        const lh = (10 / doc.internal.scaleFactor) * 1.15;
        let ty = data.cell.y + 2;
        doc.setFontSize(10);
        lines.forEach((line, i) => {
          doc.setFont("times", i === 0 ? "bold" : "normal");
          doc.text(line, x, ty, { baseline: "top" });
          ty += lh;
        });
        doc.setFont("times", "normal");
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ─── Sonderfälle-Block ──────────────────────────────────────────────
  const urlaub = plan.abwesende.filter((a) => a.status === "urlaub");
  const krank = plan.abwesende.filter((a) => a.status === "krank");
  const sw = plan.abwesende.filter((a) => a.status === "schlechtwetter");

  const renderListe = (
    list: typeof plan.abwesende,
  ): string => {
    if (list.length === 0) return "—";
    return list
      .map((a) => {
        const name = `${a.ma.nachname} ${a.ma.vorname}`;
        const suffix =
          a.seit && a.bis
            ? ` (${shortDate(a.seit)} – ${shortDate(a.bis)})`
            : a.seit
            ? ` (seit ${shortDate(a.seit)})`
            : "";
        return `${name}${suffix}`;
      })
      .join(" · ");
  };

  // Sonderfälle in einer Box rendern
  doc.setFont("times", "bolditalic");
  doc.setFontSize(11);
  doc.setTextColor(0);

  const boxStartY = y;
  const sonderRows: [string, string][] = [
    ["Urlaub / ZA:", renderListe(urlaub)],
    ["Krank:", renderListe(krank)],
    ["Schlechtwetter:", renderListe(sw)],
  ];
  if (plan.freigabe?.notiz?.trim()) {
    sonderRows.push(["Sonstige Hinweise:", plan.freigabe.notiz.trim()]);
  }

  autoTable(doc, {
    startY: y,
    head: [["Sonderfälle:", ""]],
    body: sonderRows,
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10,
      cellPadding: { top: 1.5, right: 3, bottom: 1.5, left: 3 },
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
    },
    headStyles: {
      fontStyle: "bolditalic",
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: "bold" },
      1: { cellWidth: "auto" },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  // ─── Footer mit Freigabe-Info ────────────────────────────────────────
  // Notiz-only-Zeile (freigegeben_am NULL) hat keine Freigabe-Info.
  if (plan.freigabe?.freigegeben_am) {
    doc.setFont("times", "italic");
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(
      `Plan freigegeben am ${new Date(plan.freigabe.freigegeben_am).toLocaleString(
        "de-AT",
        {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
      )}`,
      PAGE_W / 2,
      y,
      { align: "center" },
    );
  }

  return doc;
}
