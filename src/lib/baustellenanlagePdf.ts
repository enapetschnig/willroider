/**
 * Baustellenmeldung / Baustellenanlage als PDF — dieselben Angaben wie das
 * Word-Formular (public/templates/baustellenanlage.docx), aufgebaut wie die
 * Vorlage „Baustellenmeldung Zimmerei Willroider".
 *
 * Für Baustellen mit neuer SharePoint-Struktur legt die App NUR dieses PDF
 * ab (Wunsch S. Egger, 16.10.2026: Baustellenanlage als PDF direkt in
 * „01-Baustellenmanagement"). Das Word-Formular bleibt für den Mailversand.
 */
import jsPDF from "jspdf";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const SCHWARZ: [number, number, number] = [20, 20, 20];
const GRAU: [number, number, number] = [110, 110, 115];
const LINIE: [number, number, number] = [200, 200, 205];

/** Helvetica (WinAnsi) kennt nur Latin-1 und ein paar Zeichen mehr. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const pdfText = (s: string) =>
  s.replace(/\r/g, "").replace(/[^ -ÿ\n]/g, (c) => (WIN_ANSI_EXTRA.includes(c) ? c : "?"));

const datumAT = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("de-AT") : "";

let _logo: string | null | undefined;
async function ladeLogo(): Promise<string | null> {
  if (_logo !== undefined) return _logo;
  try {
    const res = await fetch("/willroider-logo.jpg");
    if (!res.ok) return (_logo = null);
    const blob = await res.blob();
    _logo = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return _logo;
  } catch {
    return (_logo = null);
  }
}

export async function makeBaustellenanlagePdf(
  b: Partial<Baustelle>,
  bauleiterName: string,
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const links = 20;
  const breite = 170;
  let y = 18;

  const logo = await ladeLogo();
  if (logo) {
    try {
      doc.addImage(logo, "JPEG", links + breite - 45, y - 6, 45, 18);
    } catch {
      /* Logo ist Zierde */
    }
  }
  doc.setTextColor(...GRAU);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Lohnverrechnung  ·  Rechnungsprüfung  ·  Bauhof", links, y);

  y += 16;
  doc.setTextColor(...SCHWARZ);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Baustellenmeldung Zimmerei Willroider", links, y);
  y += 4;
  doc.setDrawColor(...LINIE);
  doc.line(links, y, links + breite, y);
  y += 9;

  const adresse = [b.baustellen_adresse, [b.plz, b.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const koord =
    b.koordinaten_lat != null && b.koordinaten_lng != null
      ? `${Number(b.koordinaten_lat).toFixed(5)}, ${Number(b.koordinaten_lng).toFixed(5)}`
      : "";
  const wohnanschrift = [
    b.bauherr_adresse,
    [(b as any).bauherr_plz, (b as any).bauherr_ort].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const summe = b.auftragssumme
    ? new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(Number(b.auftragssumme))
    : "";
  const bautraeger = b.bautraeger === true ? "Ja" : b.bautraeger === false ? "Nein" : "";

  const zeilen: [string, string][] = [
    ["Bauvorhaben", b.bvh_name ?? ""],
    ["Bauherr", b.bauherr ?? ""],
    ["Baustellenanschrift", adresse],
    ["Koordinaten Baustelle", koord],
    ["Wohnanschrift Bauherr", wohnanschrift],
    ["Baubeginn", datumAT(b.start_datum)],
    ["Voraussichtl. Ende", datumAT(b.end_datum)],
    ["Verantwortlicher Bauleiter und Beauftragter im Sinne des § 9 VStG", bauleiterName],
    ["Erfasst unter (Kostenstelle)", b.kostenstelle ?? ""],
    ["Art der Bauarbeiten", b.art_bauarbeiten ?? ""],
    ["Auftragssumme, ca.", summe],
    ["Beschäftigte i. M.", b.anzahl_mitarbeiter != null ? String(b.anzahl_mitarbeiter) : ""],
    ["Wird das Bauvorhaben als Bauträger ausgeführt", bautraeger],
  ];

  const labelBreite = 62;
  for (const [label, wert] of zeilen) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAU);
    const l = doc.splitTextToSize(pdfText(label + ":"), labelBreite - 3) as string[];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const w = doc.splitTextToSize(pdfText(wert || "—"), breite - labelBreite) as string[];
    const hoehe = Math.max(l.length * 4.2, w.length * 5.2) + 3;
    if (y + hoehe > 280) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAU);
    doc.text(l, links, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...SCHWARZ);
    doc.text(w, links + labelBreite, y);
    y += hoehe;
    doc.setDrawColor(...LINIE);
    doc.line(links, y - 2.5, links + breite, y - 2.5);
    y += 2;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRAU);
  doc.text(pdfText(`Erstellt am ${new Date().toLocaleDateString("de-AT")} aus der App`), links, 290);

  return doc.output("blob");
}
