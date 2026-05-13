import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Database, ArbeitszeitModell } from "@/integrations/supabase/types";
import { monatsSoll, type TagessollKalender, ladeKalenderMap } from "@/lib/konten";

type Stunde = Database["public"]["Tables"]["stundenbuchungen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Partie = Database["public"]["Tables"]["partien"]["Row"];
type PKS = Database["public"]["Tables"]["profile_konten_settings"]["Row"];

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : "");
const fmtNum = (n: number) => Number(n).toFixed(2).replace(".", ",");

export type PdfInput = {
  monat: string;
  rows: Stunde[]; // bereits gefiltert für DIESEN MA
  member: Profile;
  baustellen: Baustelle[];
  partie?: Partie | null;
  pks?: PKS | null;
  kalender?: Map<string, TagessollKalender>;
};

/** Erstellt einen Stundenzettel als PDF für einen einzelnen Mitarbeiter. */
export function makeStundenzettelPdf(input: PdfInput): jsPDF {
  const { monat, rows, member, baustellen, partie, pks, kalender } = input;
  const baustelleById = new Map(baustellen.map((b) => [b.id, b]));

  const [year, month] = monat.split("-").map(Number);
  const tagesnorm = Number(pks?.tagesnorm_stunden ?? 8);
  const grad = Number(pks?.beschaeftigungsgrad ?? 1);
  const modell =
    (pks?.arbeitszeitmodell as ArbeitszeitModell) ?? "zimmerei_sommer";
  const soll = monatsSoll(
    year,
    month,
    kalender ?? new Map(),
    modell,
    tagesnorm,
    grad
  );

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  // Header
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("HOLZBAU WILLROIDER", 14, y);
  doc.setFontSize(11);
  doc.text(`Stundenzettel ${monatLabel(monat)}`, pageWidth - 14, y, { align: "right" });
  y += 6;
  doc.setDrawColor(180);
  doc.line(14, y, pageWidth - 14, y);
  y += 6;

  // MA-Stammdaten
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Mitarbeiter: ${member.vorname} ${member.nachname}`, 14, y);
  if (member.pers_nr) doc.text(`Pers.-Nr.: ${member.pers_nr}`, 100, y);
  y += 5;
  if (partie?.name) doc.text(`Partie: ${partie.name}`, 14, y);
  if (pks?.eintrittsdatum) {
    doc.text(
      `Eintritt: ${new Date(pks.eintrittsdatum).toLocaleDateString("de-AT")}`,
      100,
      y
    );
  }
  y += 4;

  // Sortiert nach Datum
  const sorted = [...rows].sort((a, b) =>
    a.datum.localeCompare(b.datum) ||
    (a.start_zeit ?? "").localeCompare(b.start_zeit ?? "")
  );

  let sumA = 0,
    sumFa = 0,
    sumFe = 0,
    sumTgK = 0,
    sumTgL = 0,
    sumKm = 0;
  const body = sorted.map((r) => {
    const d = new Date(r.datum);
    const b = baustelleById.get(r.baustelle_id ?? "");
    const pause =
      r.pause_von && r.pause_bis
        ? `${fmtTime(r.pause_von)}-${fmtTime(r.pause_bis)}`
        : "";
    sumA += Number(r.arbeitsstunden ?? 0);
    sumFa += Number(r.fahrstunden ?? 0);
    sumFe += Number(r.fehlzeit_stunden ?? 0);
    sumTgK += Number(r.taggeld_kurz ?? 0);
    sumTgL += Number(r.taggeld_lang ?? 0);
    sumKm += Number(r.km_gefahren ?? 0);
    return [
      d.toLocaleDateString("de-AT"),
      WT[d.getDay()],
      [b?.bvh_name, r.taetigkeit].filter(Boolean).join(" · ") ||
        (r.in_firma ? "Firma" : ""),
      fmtTime(r.start_zeit),
      fmtTime(r.end_zeit),
      pause,
      Number(r.arbeitsstunden ?? 0)
        ? fmtNum(Number(r.arbeitsstunden))
        : "",
      Number(r.fahrstunden ?? 0) ? fmtNum(Number(r.fahrstunden)) : "",
      r.taggeld_kurz ? String(r.taggeld_kurz) : "",
      r.taggeld_lang ? String(r.taggeld_lang) : "",
      r.km_gefahren ? String(r.km_gefahren) : "",
      r.zulage_typ
        ? `${r.zulage_typ}${r.zulage_stunden ? ` ${fmtNum(Number(r.zulage_stunden))}h` : ""}`
        : "",
      r.fehlzeit_typ
        ? `${r.fehlzeit_typ} ${fmtNum(Number(r.fehlzeit_stunden ?? 0))}h`
        : "",
    ];
  });

  const ist = sumA + sumFa + sumFe;
  body.push([
    "Σ",
    "",
    "",
    "",
    "",
    "",
    fmtNum(sumA),
    fmtNum(sumFa),
    String(sumTgK),
    String(sumTgL),
    String(sumKm),
    "",
    fmtNum(sumFe),
  ]);

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Datum",
        "Wt",
        "BVH / Tätigkeit",
        "Start",
        "Ende",
        "Pause",
        "Arb h",
        "Fa h",
        "TG K",
        "TG L",
        "KM",
        "Zulage",
        "Fehl",
      ],
    ],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.2, valign: "middle" },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 7 },
      2: { cellWidth: 50 },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 12, halign: "center" },
      5: { cellWidth: 18, halign: "center" },
      6: { cellWidth: 11, halign: "right" },
      7: { cellWidth: 10, halign: "right" },
      8: { cellWidth: 10, halign: "right" },
      9: { cellWidth: 10, halign: "right" },
      10: { cellWidth: 10, halign: "right" },
      11: { cellWidth: 18 },
      12: { cellWidth: 13 },
    },
    didParseCell: (data) => {
      // Σ-Zeile fett
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [240, 240, 240];
      }
    },
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as any).lastAutoTable.finalY ?? y + 50;
  let yy = finalY + 6;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Soll: ${fmtNum(soll)} h    Ist: ${fmtNum(ist)} h    Differenz: ${fmtNum(
      ist - soll
    )} h`,
    14,
    yy
  );
  yy += 12;

  // Unterschriften
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.line(14, yy, 80, yy);
  doc.line(110, yy, 175, yy);
  yy += 4;
  doc.text("Unterschrift Mitarbeiter", 14, yy);
  doc.text("Unterschrift Arbeitgeber", 110, yy);

  return doc;
}

export function downloadStundenzettel(input: PdfInput) {
  const doc = makeStundenzettelPdf(input);
  const safeName = `${input.member.nachname}_${input.member.vorname}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );
  doc.save(`Stundenzettel_${safeName}_${input.monat}.pdf`);
}

/** Sammel-PDF mit allen Stundenzetteln (ein MA pro Seite). */
export function downloadAlleStundenzettel(inputs: PdfInput[]) {
  if (inputs.length === 0) return;
  const first = inputs[0];
  const doc = makeStundenzettelPdf(first);
  for (let i = 1; i < inputs.length; i++) {
    doc.addPage();
    const inner = makeStundenzettelPdf(inputs[i]);
    // Pages aus inner kopieren: einfacher Ansatz — wir kombinieren PDFs
    // indem wir alle Seiten direkt zeichnen. Da jsPDF kein einfaches
    // mergePages hat, generieren wir alles in einem einzigen doc neu.
  }
  // Komplette Neu-Generierung in einem doc:
  const out = new jsPDF({ unit: "mm", format: "a4" });
  for (let i = 0; i < inputs.length; i++) {
    if (i > 0) out.addPage();
    redrawInto(out, inputs[i]);
  }
  out.save(`Stundenzettel_alle_${first.monat}.pdf`);
}

function redrawInto(doc: jsPDF, input: PdfInput) {
  const { monat, rows, member, baustellen, partie, pks, kalender } = input;
  const baustelleById = new Map(baustellen.map((b) => [b.id, b]));
  const [year, month] = monat.split("-").map(Number);
  const tagesnorm = Number(pks?.tagesnorm_stunden ?? 8);
  const grad = Number(pks?.beschaeftigungsgrad ?? 1);
  const modell =
    (pks?.arbeitszeitmodell as ArbeitszeitModell) ?? "zimmerei_sommer";
  const soll = monatsSoll(
    year,
    month,
    kalender ?? new Map(),
    modell,
    tagesnorm,
    grad
  );
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("HOLZBAU WILLROIDER", 14, y);
  doc.setFontSize(11);
  doc.text(`Stundenzettel ${monatLabel(monat)}`, pageWidth - 14, y, { align: "right" });
  y += 6;
  doc.setDrawColor(180);
  doc.line(14, y, pageWidth - 14, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Mitarbeiter: ${member.vorname} ${member.nachname}`, 14, y);
  if (member.pers_nr) doc.text(`Pers.-Nr.: ${member.pers_nr}`, 100, y);
  y += 5;
  if (partie?.name) doc.text(`Partie: ${partie.name}`, 14, y);
  if (pks?.eintrittsdatum) {
    doc.text(
      `Eintritt: ${new Date(pks.eintrittsdatum).toLocaleDateString("de-AT")}`,
      100,
      y
    );
  }
  y += 4;

  const sorted = [...rows].sort((a, b) =>
    a.datum.localeCompare(b.datum) ||
    (a.start_zeit ?? "").localeCompare(b.start_zeit ?? "")
  );
  let sumA = 0,
    sumFa = 0,
    sumFe = 0,
    sumTgK = 0,
    sumTgL = 0,
    sumKm = 0;
  const body = sorted.map((r) => {
    const d = new Date(r.datum);
    const b = baustelleById.get(r.baustelle_id ?? "");
    const pause =
      r.pause_von && r.pause_bis
        ? `${fmtTime(r.pause_von)}-${fmtTime(r.pause_bis)}`
        : "";
    sumA += Number(r.arbeitsstunden ?? 0);
    sumFa += Number(r.fahrstunden ?? 0);
    sumFe += Number(r.fehlzeit_stunden ?? 0);
    sumTgK += Number(r.taggeld_kurz ?? 0);
    sumTgL += Number(r.taggeld_lang ?? 0);
    sumKm += Number(r.km_gefahren ?? 0);
    return [
      d.toLocaleDateString("de-AT"),
      WT[d.getDay()],
      [b?.bvh_name, r.taetigkeit].filter(Boolean).join(" · ") ||
        (r.in_firma ? "Firma" : ""),
      fmtTime(r.start_zeit),
      fmtTime(r.end_zeit),
      pause,
      Number(r.arbeitsstunden ?? 0)
        ? fmtNum(Number(r.arbeitsstunden))
        : "",
      Number(r.fahrstunden ?? 0) ? fmtNum(Number(r.fahrstunden)) : "",
      r.taggeld_kurz ? String(r.taggeld_kurz) : "",
      r.taggeld_lang ? String(r.taggeld_lang) : "",
      r.km_gefahren ? String(r.km_gefahren) : "",
      r.zulage_typ
        ? `${r.zulage_typ}${r.zulage_stunden ? ` ${fmtNum(Number(r.zulage_stunden))}h` : ""}`
        : "",
      r.fehlzeit_typ
        ? `${r.fehlzeit_typ} ${fmtNum(Number(r.fehlzeit_stunden ?? 0))}h`
        : "",
    ];
  });
  const ist = sumA + sumFa + sumFe;
  body.push([
    "Σ",
    "",
    "",
    "",
    "",
    "",
    fmtNum(sumA),
    fmtNum(sumFa),
    String(sumTgK),
    String(sumTgL),
    String(sumKm),
    "",
    fmtNum(sumFe),
  ]);

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Datum",
        "Wt",
        "BVH / Tätigkeit",
        "Start",
        "Ende",
        "Pause",
        "Arb h",
        "Fa h",
        "TG K",
        "TG L",
        "KM",
        "Zulage",
        "Fehl",
      ],
    ],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.2, valign: "middle" },
    headStyles: { fillColor: [60, 60, 60], textColor: 255, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 7 },
      2: { cellWidth: 50 },
      3: { cellWidth: 12, halign: "center" },
      4: { cellWidth: 12, halign: "center" },
      5: { cellWidth: 18, halign: "center" },
      6: { cellWidth: 11, halign: "right" },
      7: { cellWidth: 10, halign: "right" },
      8: { cellWidth: 10, halign: "right" },
      9: { cellWidth: 10, halign: "right" },
      10: { cellWidth: 10, halign: "right" },
      11: { cellWidth: 18 },
      12: { cellWidth: 13 },
    },
    didParseCell: (data) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [240, 240, 240];
      }
    },
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as any).lastAutoTable.finalY ?? y + 50;
  let yy = finalY + 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Soll: ${fmtNum(soll)} h    Ist: ${fmtNum(ist)} h    Differenz: ${fmtNum(
      ist - soll
    )} h`,
    14,
    yy
  );
  yy += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.line(14, yy, 80, yy);
  doc.line(110, yy, 175, yy);
  yy += 4;
  doc.text("Unterschrift Mitarbeiter", 14, yy);
  doc.text("Unterschrift Arbeitgeber", 110, yy);
}

function monatLabel(monat: string): string {
  const [y, m] = monat.split("-").map(Number);
  const names = [
    "Januar","Februar","März","April","Mai","Juni",
    "Juli","August","September","Oktober","November","Dezember",
  ];
  return `${names[m - 1]} ${y}`;
}
