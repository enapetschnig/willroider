/**
 * Bautages- + Regiebericht als PDF (jsPDF + jspdf-autotable).
 * Wird bei Status-Wechsel auf 'freigegeben' generiert und in den Schriftverkehr-
 * Ordner der Baustelle hochgeladen — pro Bericht eine PDF-Datei mit fixem Pfad,
 * Re-Freigabe überschreibt.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import type { Database, BerichtTyp } from "@/integrations/supabase/types";

type Bericht = Database["public"]["Tables"]["berichte"]["Row"];
type BerichtMitarbeiter = Database["public"]["Tables"]["bericht_mitarbeiter"]["Row"];
type BerichtTaetigkeit = Database["public"]["Tables"]["bericht_taetigkeiten"]["Row"];
type BerichtAufmass = Database["public"]["Tables"]["bericht_aufmass"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const fmtNum = (n: number | null | undefined) =>
  n == null ? "" : Number(n).toFixed(2).replace(".", ",");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "long", year: "numeric" });

const TITEL: Record<BerichtTyp, string> = {
  bautagesbericht: "Bautagesbericht",
  regiebericht: "Regiebericht",
};

export interface BerichtPdfInput {
  bericht: Bericht;
  baustelle: Baustelle;
  polier: Profile | null;
  mitarbeiter: { row: BerichtMitarbeiter; profil: Profile | null }[];
  taetigkeiten: BerichtTaetigkeit[];
  aufmass: BerichtAufmass[];
  fotos: { signedUrl: string; bildunterschrift?: string | null }[];
}

/** Erzeugt das PDF-Dokument. */
export async function makeBerichtPdf(input: BerichtPdfInput): Promise<jsPDF> {
  const { bericht, baustelle, polier, mitarbeiter, taetigkeiten, aufmass, fotos } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 14;
  let y = MARGIN;

  // ─── Header ────────────────────────────────────────────────────────
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(TITEL[bericht.typ], MARGIN, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Holzbau Willroider`, PAGE_W - MARGIN, y - 2, { align: "right" });
  doc.setFontSize(8);
  doc.text("Willroiderstraße 13, 9500 Villach", PAGE_W - MARGIN, y + 2, { align: "right" });
  y += 8;
  doc.setDrawColor(200);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 5;

  // ─── Stammdaten 2-spaltig ──────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const stammRows: [string, string][] = [
    ["Baustelle", baustelle.bvh_name || "—"],
    ["Kostenstelle", baustelle.kostenstelle || "—"],
    ["Datum", fmtDate(bericht.datum)],
    ["Polier", polier ? `${polier.vorname} ${polier.nachname}` : "—"],
    ["Status", bericht.status],
  ];
  if (baustelle.bauherr) stammRows.push(["Bauherr", baustelle.bauherr]);
  const adr = [baustelle.baustellen_adresse, baustelle.plz, baustelle.ort]
    .filter(Boolean)
    .join(", ");
  if (adr) stammRows.push(["Adresse", adr]);

  autoTable(doc, {
    startY: y,
    body: stammRows.map(([k, v]) => [k, v]),
    theme: "plain",
    styles: { fontSize: 9, cellPadding: { top: 0.5, bottom: 0.5, left: 1, right: 1 } },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 30 }, 1: { cellWidth: "auto" } },
    margin: { left: MARGIN, right: MARGIN },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // ─── Wetter ────────────────────────────────────────────────────────
  if (bericht.wetter_beschreibung || bericht.temperatur_max != null) {
    const wetterStr =
      [
        bericht.wetter_beschreibung,
        bericht.temperatur_min != null && bericht.temperatur_max != null
          ? `${fmtNum(bericht.temperatur_min)}°C bis ${fmtNum(bericht.temperatur_max)}°C`
          : null,
        bericht.niederschlag_mm != null && bericht.niederschlag_mm > 0
          ? `Niederschlag ${fmtNum(bericht.niederschlag_mm)} mm`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");
    doc.setFont("helvetica", "bold");
    doc.text("Wetter:", MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(wetterStr, MARGIN + 18, y);
    y += 6;
  }

  // ─── Mitarbeiter-Tabelle ───────────────────────────────────────────
  if (mitarbeiter.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Mitarbeiter", "Stunden", "Tätigkeit / Notiz"]],
      body: mitarbeiter.map((m) => [
        m.profil ? `${m.profil.nachname} ${m.profil.vorname}` : "—",
        fmtNum(m.row.stunden_netto),
        m.row.taetigkeit_notiz ?? "",
      ]),
      headStyles: { fillColor: [50, 50, 50], textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: { 1: { halign: "right", cellWidth: 25 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ─── Tätigkeiten-Tabelle ───────────────────────────────────────────
  if (taetigkeiten.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Tätigkeit", "Std", "Notiz"]],
      body: taetigkeiten.map((t) => [
        t.bezeichnung,
        fmtNum(t.summe_stunden),
        t.notiz ?? "",
      ]),
      headStyles: { fillColor: [50, 50, 50], textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: { 1: { halign: "right", cellWidth: 20 } },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ─── Aufmaß ────────────────────────────────────────────────────────
  if (aufmass.length > 0) {
    if (y > PAGE_H - 40) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Aufmaß", MARGIN, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Pos", "Beschreibung", "Menge", "Einheit", "Notiz"]],
      body: aufmass.map((a, i) => [
        i + 1,
        a.beschreibung,
        a.menge != null ? fmtNum(a.menge) : "",
        a.einheit ?? "",
        a.notiz ?? "",
      ]),
      headStyles: { fillColor: [50, 50, 50], textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.5 },
      columnStyles: {
        0: { halign: "right", cellWidth: 10 },
        2: { halign: "right", cellWidth: 20 },
        3: { cellWidth: 18 },
      },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // ─── Freitext Besonderheiten ───────────────────────────────────────
  if (bericht.freitext_besonderheiten) {
    if (y > PAGE_H - 30) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Besonderheiten", MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(
      bericht.freitext_besonderheiten,
      PAGE_W - 2 * MARGIN,
    );
    doc.text(lines, MARGIN, y);
    y += lines.length * 5 + 4;
  }

  // ─── Fotos ─────────────────────────────────────────────────────────
  if (fotos.length > 0) {
    if (y > PAGE_H - 70) {
      doc.addPage();
      y = MARGIN;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Fotodokumentation", MARGIN, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const cols = 2;
    const gap = 4;
    const cellW = (PAGE_W - 2 * MARGIN - gap * (cols - 1)) / cols;
    const cellH = cellW * 0.7;

    for (let i = 0; i < fotos.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + col * (cellW + gap);
      const yCell = y + row * (cellH + 10);
      if (yCell + cellH > PAGE_H - MARGIN) {
        doc.addPage();
        y = MARGIN;
        // Restart Row-Berechnung für die neue Seite
        const newRow = Math.floor((i - 0) / cols);
        // Pragmatisch: einfacher Sprung — wir starten ab MARGIN ohne weitere Cells diese Seite
        doc.addImage(fotos[i].signedUrl, "JPEG", MARGIN, y, cellW, cellH, undefined, "FAST");
        if (fotos[i].bildunterschrift) {
          doc.text(fotos[i].bildunterschrift!, MARGIN, y + cellH + 4, { maxWidth: cellW });
        }
        y += cellH + 12;
        continue;
      }
      try {
        doc.addImage(fotos[i].signedUrl, "JPEG", x, yCell, cellW, cellH, undefined, "FAST");
        if (fotos[i].bildunterschrift) {
          doc.text(fotos[i].bildunterschrift!, x, yCell + cellH + 4, { maxWidth: cellW });
        }
      } catch {
        doc.text("(Foto konnte nicht geladen werden)", x, yCell + cellH / 2);
      }
    }
  }

  // ─── Footer mit Generierungs-Zeit ──────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Erstellt am ${new Date().toLocaleString("de-AT")} · Seite ${p}/${pageCount}`,
      PAGE_W / 2,
      PAGE_H - 6,
      { align: "center" },
    );
  }

  return doc;
}

/**
 * Generiert das PDF und lädt es in den Schriftverkehr-Ordner der Baustelle hoch.
 * Pfad: {baustelle_id}/2-schriftverkehr/{tagesberichte|regieberichte}/{datum}_{typ}.pdf
 * Bei Re-Freigabe wird die Datei überschrieben (upsert: true). Es entsteht
 * pro Bericht genau eine PDF-Datei + ein dokumente-Eintrag.
 */
export async function generateAndUploadBerichtPdf(
  input: BerichtPdfInput,
): Promise<{ dokumentId: string; storagePath: string }> {
  const doc = await makeBerichtPdf(input);
  const blob = doc.output("blob");

  const subOrdner =
    input.bericht.typ === "bautagesbericht" ? "tagesberichte" : "regieberichte";
  const filename = `${input.bericht.datum}_${input.bericht.typ}.pdf`;
  const storagePath = `${input.baustelle.id}/2-schriftverkehr/${subOrdner}/${filename}`;

  const { error: upErr } = await supabase.storage
    .from("baustellen")
    .upload(storagePath, blob, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) throw upErr;

  // dokumente-Upsert: 1 Eintrag pro Bericht-PDF
  const { data: existing } = await supabase
    .from("dokumente")
    .select("id")
    .eq("baustelle_id", input.baustelle.id)
    .eq("storage_path", storagePath)
    .maybeSingle();

  let dokumentId = existing?.id;
  if (dokumentId) {
    await supabase
      .from("dokumente")
      .update({ groesse: blob.size, mimetype: "application/pdf" })
      .eq("id", dokumentId);
  } else {
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("dokumente")
      .insert({
        baustelle_id: input.baustelle.id,
        ordner: "2-schriftverkehr",
        subpath: subOrdner,
        dateiname: filename,
        storage_path: storagePath,
        groesse: blob.size,
        mimetype: "application/pdf",
        hochgeladen_von: u.user?.id ?? null,
      } as any)
      .select("id")
      .single();
    if (error) throw error;
    dokumentId = data.id;
  }

  return { dokumentId: dokumentId!, storagePath };
}
