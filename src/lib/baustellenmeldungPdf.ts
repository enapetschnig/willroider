import jsPDF from "jspdf";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("de-AT") : "";
const fmtMoney = (n: number | null | undefined) =>
  n != null ? new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(Number(n)) : "";

export function generateBaustellenmeldungPdf(
  b: Partial<Baustelle>,
  bauleiterName: string
): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 18; // margin

  // Empfänger-Boxen oben rechts
  const recipients = ["Lohnverrechnung", "Rechnungsprüfung", "Bauhof"];
  const boxW = 38;
  const boxH = 14;
  const boxStartX = W - M - 3 * boxW - 4;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  recipients.forEach((r, i) => {
    const x = boxStartX + i * (boxW + 2);
    doc.rect(x, M, boxW, boxH);
    doc.text(r, x + boxW / 2, M + 5, { align: "center" });
  });

  // Titel
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Baustellenmeldung Zimmerei Willroider", W / 2, M + 28, { align: "center" });

  // Felder
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  let y = M + 42;
  const labelX = M;
  const valueX = M + 70;
  const lineW = W - valueX - M;
  const rowH = 9;

  const drawRow = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, labelX, y);
    doc.setFont("helvetica", "normal");
    // Linie
    doc.setLineWidth(0.2);
    doc.line(valueX, y + 1, valueX + lineW, y + 1);
    if (value) {
      doc.text(value, valueX + 2, y);
    }
    y += rowH;
  };

  drawRow("Bauvorhaben:", b.bvh_name ?? "");
  drawRow("Bauherr:", b.bauherr ?? "");

  const adr = [b.baustellen_adresse, [b.plz, b.ort].filter(Boolean).join(" ")]
    .filter((x) => x && x.trim())
    .join(", ");
  drawRow("Baustellenanschrift:", adr);

  const koord =
    b.koordinaten_lat != null && b.koordinaten_lng != null
      ? `${Number(b.koordinaten_lat).toFixed(5)}, ${Number(b.koordinaten_lng).toFixed(5)}`
      : "";
  drawRow("Koordinaten Baustelle:", koord);
  drawRow("Wohnanschrift Bauherr:", b.bauherr_adresse ?? "");

  // Baubeginn / Ende in einer Zeile (zwei halbe Spalten)
  doc.setFont("helvetica", "bold");
  doc.text("Baubeginn:", labelX, y);
  doc.setFont("helvetica", "normal");
  const bbStartX = M + 30;
  const bbW = 40;
  doc.line(bbStartX, y + 1, bbStartX + bbW, y + 1);
  if (b.start_datum) doc.text(fmtDate(b.start_datum), bbStartX + 2, y);

  doc.setFont("helvetica", "bold");
  doc.text("Vorraussichtl. Ende:", bbStartX + bbW + 6, y);
  doc.setFont("helvetica", "normal");
  const veStartX = bbStartX + bbW + 6 + 36;
  const veW = W - M - veStartX;
  doc.line(veStartX, y + 1, veStartX + veW, y + 1);
  if (b.end_datum) doc.text(fmtDate(b.end_datum), veStartX + 2, y);
  y += rowH;

  // Verantwortlicher Bauleiter (zweizeilig, weil längeres Label)
  doc.setFont("helvetica", "bold");
  doc.text("Verantwortlicher Bauleiter und", labelX, y);
  doc.text("Beauftragter im Sinne des § 9 VStG:", labelX, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.line(valueX, y + 5, valueX + lineW, y + 5);
  if (bauleiterName) doc.text(bauleiterName, valueX + 2, y + 4);
  y += rowH + 4;

  drawRow("Erfasst unter:", b.kostenstelle ?? "");
  drawRow("Art der Bauarbeiten:", b.art_bauarbeiten ?? "");

  // Auftragssumme + Beschäftigte in einer Zeile
  doc.setFont("helvetica", "bold");
  doc.text("Auftragssumme, ca.:", labelX, y);
  doc.setFont("helvetica", "normal");
  const asStartX = M + 36;
  const asW = 40;
  doc.line(asStartX, y + 1, asStartX + asW, y + 1);
  if (b.auftragssumme) doc.text(fmtMoney(b.auftragssumme), asStartX + 2, y);

  doc.setFont("helvetica", "bold");
  doc.text("Beschäftigte i.M.:", asStartX + asW + 6, y);
  doc.setFont("helvetica", "normal");
  const bsStartX = asStartX + asW + 6 + 32;
  const bsW = W - M - bsStartX;
  doc.line(bsStartX, y + 1, bsStartX + bsW, y + 1);
  if (b.anzahl_mitarbeiter != null)
    doc.text(String(b.anzahl_mitarbeiter), bsStartX + 2, y);
  y += rowH + 2;

  // Bauträger-Frage
  doc.setFont("helvetica", "bold");
  doc.text("Wird das Bauvorhaben als Bauträger ausgeführt:", labelX, y);
  doc.setFont("helvetica", "normal");
  const yesX = labelX + 92;
  const noX = yesX + 22;
  // Ja-Box
  doc.rect(yesX, y - 3.5, 4, 4);
  doc.text("Ja", yesX + 6, y);
  if (b.bautraeger === true) {
    doc.setFont("helvetica", "bold");
    doc.text("X", yesX + 0.7, y - 0.4);
    doc.setFont("helvetica", "normal");
  }
  // Nein-Box
  doc.rect(noX, y - 3.5, 4, 4);
  doc.text("Nein", noX + 6, y);
  if (b.bautraeger === false) {
    doc.setFont("helvetica", "bold");
    doc.text("X", noX + 0.7, y - 0.4);
    doc.setFont("helvetica", "normal");
  }
  y += rowH + 6;

  // Footer mit Datum
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Erstellt am ${new Date().toLocaleDateString("de-AT")} · Holzbau Willroider GmbH`,
    M,
    285
  );

  return doc.output("blob");
}
