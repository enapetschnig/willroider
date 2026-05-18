/**
 * Bautages- + Regiebericht als PDF (jsPDF + jspdf-autotable).
 * Wird bei Status-Wechsel auf 'freigegeben' generiert und in den Schriftverkehr-
 * Ordner der Baustelle hochgeladen — pro Bericht eine PDF-Datei mit fixem Pfad,
 * Re-Freigabe überschreibt.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import type {
  Database,
  BerichtTyp,
  BerichtStatus,
} from "@/integrations/supabase/types";

type Bericht = Database["public"]["Tables"]["berichte"]["Row"];
type BerichtMitarbeiter = Database["public"]["Tables"]["bericht_mitarbeiter"]["Row"];
type BerichtTaetigkeit = Database["public"]["Tables"]["bericht_taetigkeiten"]["Row"];
type BerichtAufmass = Database["public"]["Tables"]["bericht_aufmass"]["Row"];
type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// ─── Marken-Farben ──────────────────────────────────────────────────────
// Willroider-Burgundy aus index.css: hsl(349 40% 53%) ≈ #B65667
const BURGUNDY: [number, number, number] = [182, 86, 103];
const BURGUNDY_DARK: [number, number, number] = [140, 60, 75];
const BURGUNDY_BG: [number, number, number] = [248, 240, 242]; // sehr helles Burgundy
const TEXT_DARK: [number, number, number] = [40, 40, 45];
const TEXT_MUTED: [number, number, number] = [120, 120, 125];
const BORDER_LIGHT: [number, number, number] = [220, 220, 225];

const STATUS_COLOR: Record<BerichtStatus, [number, number, number]> = {
  entwurf: [120, 120, 125],
  eingereicht: [59, 130, 246], // blau
  freigegeben: [22, 163, 74], // grün
  archiviert: [80, 80, 85],
};
const STATUS_LABEL: Record<BerichtStatus, string> = {
  entwurf: "Entwurf",
  eingereicht: "Eingereicht",
  freigegeben: "Freigegeben",
  archiviert: "Archiviert",
};

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

/** Caching für das Logo (1x pro Session als dataURL geholt). */
let _logoCache: string | null | undefined = undefined;
async function getLogoDataUrl(): Promise<string | null> {
  if (_logoCache !== undefined) return _logoCache;
  try {
    const res = await fetch("/willroider-logo.jpg");
    if (!res.ok) {
      _logoCache = null;
      return null;
    }
    const blob = await res.blob();
    _logoCache = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return _logoCache;
  } catch {
    _logoCache = null;
    return null;
  }
}

/**
 * jsPDF.addImage akzeptiert keine plain HTTP-URLs — wir holen das Bild
 * als Blob und wandeln es in eine dataURL um.
 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Header: Logo + Titel + Firmen-Anschrift + Status-Badge + Trennlinie. */
function drawHeader(
  doc: jsPDF,
  bericht: Bericht,
  logo: string | null,
  pageW: number,
  margin: number,
): number {
  const LOGO_W = 24;
  const LOGO_H = 24;

  // Logo links oben
  if (logo) {
    try {
      doc.addImage(logo, "JPEG", margin, margin, LOGO_W, LOGO_H, undefined, "FAST");
    } catch {
      /* ignore */
    }
  }

  const textX = margin + LOGO_W + 6;

  // Titel groß und in Burgundy
  doc.setTextColor(...BURGUNDY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(TITEL[bericht.typ], textX, margin + 8);

  // Untertitel: Firma
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.text("Holzbau Willroider GmbH", textX, margin + 14);
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text("Willroiderstraße 13 · 9500 Villach · office@willroider.at", textX, margin + 18);

  // Status-Badge rechts oben
  const status = bericht.status;
  const badgeText = STATUS_LABEL[status];
  const badgeColor = STATUS_COLOR[status];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const badgeW = doc.getTextWidth(badgeText) + 8;
  const badgeH = 7;
  const badgeX = pageW - margin - badgeW;
  const badgeY = margin + 1;
  doc.setFillColor(...badgeColor);
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1.6, { align: "center" });

  // Datum rechts unter dem Badge
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_DARK);
  doc.text(fmtDate(bericht.datum), pageW - margin, badgeY + badgeH + 5, { align: "right" });

  // Trennlinie in Burgundy
  const y = margin + LOGO_H + 2;
  doc.setDrawColor(...BURGUNDY);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  doc.setLineWidth(0.2);
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setTextColor(...TEXT_DARK);

  return y + 5;
}

/** Section-Headline in Burgundy. */
function drawSectionTitle(doc: jsPDF, y: number, text: string, margin: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BURGUNDY);
  doc.text(text.toUpperCase(), margin, y);
  doc.setTextColor(...TEXT_DARK);
  doc.setFont("helvetica", "normal");
  return y + 5;
}

/** Erzeugt das PDF-Dokument. */
export async function makeBerichtPdf(input: BerichtPdfInput): Promise<jsPDF> {
  const { bericht, baustelle, polier, mitarbeiter, taetigkeiten, aufmass, fotos } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 14;

  const logo = await getLogoDataUrl();

  let y = drawHeader(doc, bericht, logo, PAGE_W, MARGIN);

  // ─── Stammdaten-Box mit Burgundy-getöntem Hintergrund ──────────────
  const stammLinks: [string, string][] = [
    ["Baustelle", baustelle.bvh_name || "—"],
    ["Datum", fmtDate(bericht.datum)],
    ["Polier", polier ? `${polier.vorname} ${polier.nachname}` : "—"],
  ];
  if (baustelle.kostenstelle) stammLinks.push(["Kostenstelle", baustelle.kostenstelle]);

  const stammRechts: [string, string][] = [];
  if (baustelle.bauherr) stammRechts.push(["Bauherr", baustelle.bauherr]);
  const adr = [baustelle.baustellen_adresse, baustelle.plz, baustelle.ort]
    .filter(Boolean)
    .join(", ");
  if (adr) stammRechts.push(["Adresse", adr]);

  // Zwei 2-Spalten-Tabellen nebeneinander (label | value)
  const boxStartY = y;
  const halfW = (PAGE_W - 2 * MARGIN - 4) / 2;

  autoTable(doc, {
    startY: boxStartY,
    body: stammLinks,
    theme: "plain",
    styles: {
      fontSize: 9,
      cellPadding: { top: 1, bottom: 1, left: 1, right: 1 },
      textColor: TEXT_DARK,
    },
    columnStyles: {
      0: { fontStyle: "bold", textColor: TEXT_MUTED, cellWidth: 24 },
      1: { cellWidth: halfW - 24 },
    },
    margin: { left: MARGIN, right: PAGE_W - MARGIN - halfW },
  });
  const leftEndY = (doc as any).lastAutoTable.finalY;

  if (stammRechts.length > 0) {
    autoTable(doc, {
      startY: boxStartY,
      body: stammRechts,
      theme: "plain",
      styles: {
        fontSize: 9,
        cellPadding: { top: 1, bottom: 1, left: 1, right: 1 },
        textColor: TEXT_DARK,
      },
      columnStyles: {
        0: { fontStyle: "bold", textColor: TEXT_MUTED, cellWidth: 24 },
        1: { cellWidth: halfW - 24 },
      },
      margin: { left: MARGIN + halfW + 4, right: MARGIN },
    });
  }
  const rightEndY = (doc as any).lastAutoTable.finalY;
  y = Math.max(leftEndY, rightEndY) + 5;

  // ─── Wetter-Box ────────────────────────────────────────────────────
  if (bericht.wetter_beschreibung || bericht.temperatur_max != null) {
    const wetterTeile: string[] = [];
    if (bericht.wetter_beschreibung) wetterTeile.push(bericht.wetter_beschreibung);
    if (bericht.temperatur_min != null && bericht.temperatur_max != null) {
      wetterTeile.push(
        `${fmtNum(bericht.temperatur_min)} bis ${fmtNum(bericht.temperatur_max)} °C`,
      );
    }
    if (bericht.niederschlag_mm != null && bericht.niederschlag_mm > 0) {
      wetterTeile.push(`Niederschlag ${fmtNum(bericht.niederschlag_mm)} mm`);
    }
    const wetterStr = wetterTeile.join("   ·   ");

    const wetterH = 9;
    doc.setFillColor(...BURGUNDY_BG);
    doc.roundedRect(MARGIN, y - 2, PAGE_W - 2 * MARGIN, wetterH, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BURGUNDY);
    doc.text("WETTER", MARGIN + 3, y + 3.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_DARK);
    doc.text(wetterStr, MARGIN + 22, y + 3.5);
    y += wetterH + 4;
  }

  // ─── Mitarbeiter-Tabelle ───────────────────────────────────────────
  if (mitarbeiter.length > 0) {
    y = drawSectionTitle(doc, y, "Mitarbeiter", MARGIN);
    autoTable(doc, {
      startY: y,
      head: [["Mitarbeiter", "Stunden", "Tätigkeit / Notiz"]],
      body: mitarbeiter.map((m) => [
        m.profil ? `${m.profil.nachname} ${m.profil.vorname}` : "—",
        fmtNum(m.row.stunden_netto),
        m.row.taetigkeit_notiz ?? "",
      ]),
      headStyles: {
        fillColor: BURGUNDY,
        textColor: 255,
        fontSize: 9,
        fontStyle: "bold",
        halign: "left",
      },
      styles: {
        fontSize: 9,
        cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
        textColor: TEXT_DARK,
        lineColor: BORDER_LIGHT,
      },
      alternateRowStyles: { fillColor: [250, 248, 249] },
      columnStyles: {
        0: { cellWidth: 55, fontStyle: "bold" },
        1: { halign: "right", cellWidth: 22 },
      },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ─── Tätigkeiten-Tabelle ───────────────────────────────────────────
  if (taetigkeiten.length > 0) {
    if (y > PAGE_H - 30) {
      doc.addPage();
      y = MARGIN;
    }
    y = drawSectionTitle(doc, y, "Tätigkeiten", MARGIN);
    autoTable(doc, {
      startY: y,
      head: [["Tätigkeit", "Std", "Notiz"]],
      body: taetigkeiten.map((t) => [
        t.bezeichnung,
        fmtNum(t.summe_stunden),
        t.notiz ?? "",
      ]),
      headStyles: {
        fillColor: BURGUNDY,
        textColor: 255,
        fontSize: 9,
        fontStyle: "bold",
        halign: "left",
      },
      styles: {
        fontSize: 9,
        cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
        textColor: TEXT_DARK,
        lineColor: BORDER_LIGHT,
      },
      alternateRowStyles: { fillColor: [250, 248, 249] },
      columnStyles: {
        0: { cellWidth: 70, fontStyle: "bold" },
        1: { halign: "right", cellWidth: 18 },
      },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ─── Aufmaß ────────────────────────────────────────────────────────
  if (aufmass.length > 0) {
    if (y > PAGE_H - 40) {
      doc.addPage();
      y = MARGIN;
    }
    y = drawSectionTitle(doc, y, "Aufmaß", MARGIN);
    autoTable(doc, {
      startY: y,
      head: [["Pos", "Beschreibung", "Menge", "Einheit", "Notiz"]],
      body: aufmass.map((a, i) => [
        String(i + 1),
        a.beschreibung,
        a.menge != null ? fmtNum(a.menge) : "",
        a.einheit ?? "",
        a.notiz ?? "",
      ]),
      headStyles: {
        fillColor: BURGUNDY,
        textColor: 255,
        fontSize: 9,
        fontStyle: "bold",
        halign: "left",
      },
      styles: {
        fontSize: 9,
        cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
        textColor: TEXT_DARK,
        lineColor: BORDER_LIGHT,
      },
      alternateRowStyles: { fillColor: [250, 248, 249] },
      columnStyles: {
        0: { halign: "right", cellWidth: 10, fontStyle: "bold" },
        2: { halign: "right", cellWidth: 22 },
        3: { cellWidth: 18 },
      },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ─── Freitext Besonderheiten ───────────────────────────────────────
  if (bericht.freitext_besonderheiten) {
    if (y > PAGE_H - 30) {
      doc.addPage();
      y = MARGIN;
    }
    y = drawSectionTitle(doc, y, "Besonderheiten", MARGIN);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...TEXT_DARK);
    // Box mit hellem Hintergrund + linkem Burgundy-Strich
    const lines = doc.splitTextToSize(
      bericht.freitext_besonderheiten,
      PAGE_W - 2 * MARGIN - 8,
    );
    const boxH = lines.length * 5 + 4;
    doc.setFillColor(...BURGUNDY_BG);
    doc.roundedRect(MARGIN, y - 2, PAGE_W - 2 * MARGIN, boxH, 1.2, 1.2, "F");
    doc.setFillColor(...BURGUNDY);
    doc.rect(MARGIN, y - 2, 1.5, boxH, "F");
    doc.text(lines, MARGIN + 5, y + 3);
    y += boxH + 5;
  }

  // ─── Fotos ─────────────────────────────────────────────────────────
  if (fotos.length > 0) {
    const fotoData = await Promise.all(
      fotos.map(async (f) => ({
        dataUrl: await fetchAsDataUrl(f.signedUrl),
        bildunterschrift: f.bildunterschrift ?? null,
      })),
    );

    if (y > PAGE_H - 80) {
      doc.addPage();
      y = MARGIN;
    }
    y = drawSectionTitle(doc, y, "Fotodokumentation", MARGIN);

    const cols = 2;
    const gap = 5;
    const cellW = (PAGE_W - 2 * MARGIN - gap * (cols - 1)) / cols;
    const cellH = cellW * 0.7;
    const captionH = 10;
    const rowH = cellH + captionH + 3;

    let i = 0;
    while (i < fotoData.length) {
      // Seitenumbruch wenn neue Zeile nicht mehr passt
      if (y + rowH > PAGE_H - 18) {
        doc.addPage();
        y = MARGIN;
        y = drawSectionTitle(doc, y, "Fotodokumentation (Fortsetzung)", MARGIN);
      }

      for (let col = 0; col < cols && i < fotoData.length; col++, i++) {
        const f = fotoData[i];
        const x = MARGIN + col * (cellW + gap);

        // Bild oder Platzhalter
        if (f.dataUrl) {
          try {
            doc.addImage(f.dataUrl, "JPEG", x, y, cellW, cellH, undefined, "FAST");
          } catch {
            doc.setDrawColor(...BORDER_LIGHT);
            doc.rect(x, y, cellW, cellH);
            doc.setTextColor(...TEXT_MUTED);
            doc.setFontSize(8);
            doc.text("(Foto konnte nicht geladen werden)", x + cellW / 2, y + cellH / 2, {
              align: "center",
            });
          }
        } else {
          doc.setDrawColor(...BORDER_LIGHT);
          doc.rect(x, y, cellW, cellH);
          doc.setTextColor(...TEXT_MUTED);
          doc.setFontSize(8);
          doc.text("(Foto konnte nicht geladen werden)", x + cellW / 2, y + cellH / 2, {
            align: "center",
          });
        }

        // Bildnummer-Badge oben links
        doc.setFillColor(...BURGUNDY);
        doc.roundedRect(x + 1.5, y + 1.5, 7, 5, 0.8, 0.8, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.text(String(i + 1), x + 5, y + 5, { align: "center" });

        // Bildunterschrift unter dem Bild
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...TEXT_DARK);
        doc.setFontSize(8);
        if (f.bildunterschrift) {
          const captionLines = doc.splitTextToSize(f.bildunterschrift, cellW);
          doc.text(captionLines, x, y + cellH + 4);
        }
      }
      y += rowH;
    }
  }

  // ─── Footer auf allen Seiten ───────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);

    // Footer-Trennlinie
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 11, PAGE_W - MARGIN, PAGE_H - 11);

    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont("helvetica", "normal");
    doc.text("Holzbau Willroider GmbH · Willroiderstraße 13 · 9500 Villach", MARGIN, PAGE_H - 6);
    doc.text(`Seite ${p} von ${pageCount}`, PAGE_W / 2, PAGE_H - 6, { align: "center" });
    doc.text(
      `Erstellt ${new Date().toLocaleString("de-AT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      PAGE_W - MARGIN,
      PAGE_H - 6,
      { align: "right" },
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
