/**
 * Eine PDF je Mitarbeiter (J. Maurer, 23.11.2026: „Bei den Berichten fehlen die
 * Kilometer optimal wäre eine PDF je Mitarbeiter mit Tätigkeitsbericht
 * Kilometerbuch und Krankscheine“).
 *
 * Reihenfolge: archivierter Tätigkeitsbericht → Fahrtenbuch der Periode →
 * Zulagen-Zettel → Krankenzettel (PDF-Seiten übernommen, Fotos auf A4).
 * Wird jedes Mal frisch im Browser gebaut; das Archiv-PDF (und die Kopie in
 * SharePoint) bleibt unverändert.
 *
 * Nie ein Dokument verlieren: lässt sich eine Beilage nicht einfügen
 * (kaputte/verschlüsselte PDF, unbekanntes Format), kommt sie als eigene
 * Datei daneben. Lässt sich schon der Bericht selbst nicht öffnen, liefert
 * die Funktion null — dann gilt der bisherige Weg (einzelne Dateien).
 */

import { supabase } from "@/integrations/supabase/client";
import { periodeFuer } from "@/lib/taetigkeitsbericht";
import { makeFahrtenbuchPdf } from "@/lib/taetigkeitsberichtPdf";
import { ladeZulagenZettel } from "@/lib/erschwerniszulagePdf";
import { ladeKrankenzettel, type BeilagenDatei } from "@/lib/berichtBeilagen";
import { heicZuJpeg, istHeic } from "@/lib/heic";
import type { jsPDF } from "jspdf";

/** Fahrtenbuch-PDF einer Person für die TB-Periode (21.–20.), null ohne Fahrten. */
export async function ladeFahrtenbuchPdf(
  mitarbeiterId: string,
  jahr: number,
  monat: number,
): Promise<{ doc: jsPDF; name: string; fahrten: number } | null> {
  const periode = periodeFuer(jahr, monat);
  const [{ data: fahrten, error }, { data: prof }] = await Promise.all([
    (supabase as any)
      .from("fahrtenbuch_eintraege")
      .select("*")
      .eq("mitarbeiter_id", mitarbeiterId)
      .gte("datum", periode.von)
      .lte("datum", periode.bis)
      .order("datum")
      .order("abfahrt", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("vorname, nachname, fahrtenbuch_kennzeichen").eq("id", mitarbeiterId).maybeSingle(),
  ]);
  if (error) throw error;
  if (!fahrten || (fahrten as any[]).length === 0) return null;
  const p = prof as { vorname?: string; nachname?: string; fahrtenbuch_kennzeichen?: string | null } | null;
  const name = `${p?.vorname ?? ""} ${p?.nachname ?? ""}`.trim();
  const doc = makeFahrtenbuchPdf({ name, kennzeichen: p?.fahrtenbuch_kennzeichen ?? "", periode, fahrten: fahrten as any });
  return { doc, name, fahrten: (fahrten as any[]).length };
}

export function fahrtenbuchDateiname(jahr: number, monat: number, name: string): string {
  return `Fahrtenbuch ${jahr}-${String(monat).padStart(2, "0")} ${name}.pdf`;
}

/** Foto als JPG, richtig gedreht (EXIF) und auf höchstens 2000 px verkleinert. */
async function fotoAlsJpg(blob: Blob, name: string): Promise<{ bytes: ArrayBuffer; w: number; h: number }> {
  let quelle = blob;
  if (istHeic(name) || istHeic(blob.type)) quelle = await heicZuJpeg(blob);
  const bild = await createImageBitmap(quelle, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const f = Math.min(1, 2000 / Math.max(bild.width, bild.height));
  const w = Math.max(1, Math.round(bild.width * f));
  const h = Math.max(1, Math.round(bild.height * f));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bild, 0, 0, w, h);
  bild.close?.();
  const jpg = await new Promise<Blob>((ok, fehler) =>
    canvas.toBlob((b) => (b ? ok(b) : fehler(new Error("Bild nicht lesbar"))), "image/jpeg", 0.85),
  );
  return { bytes: await jpg.arrayBuffer(), w, h };
}

const istPdf = (d: BeilagenDatei) => /\.pdf$/i.test(d.name) || d.inhalt.type === "application/pdf";
const istBild = (d: BeilagenDatei) =>
  /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(d.name) || d.inhalt.type.startsWith("image/");

export interface GesamtPdf {
  /** Die eine PDF der Person. */
  pdf: Blob;
  /** Beilagen, die sich nicht einfügen ließen — gehen als eigene Datei mit. */
  extra: BeilagenDatei[];
  fahrtenbuch: boolean;
  zulagenZettel: boolean;
  krankenzettel: number;
}

/**
 * Tätigkeitsbericht samt Fahrtenbuch, Zulagen-Zettel und Krankenzettel als
 * eine PDF. `null`, wenn sich der archivierte Bericht nicht öffnen lässt.
 */
export async function baueGesamtPdf(opts: {
  bericht: Blob;
  mitarbeiterId: string;
  jahr: number;
  monat: number;
  von: string;
  bis: string;
  mitFahrtenbuch?: boolean;
  mitZettel?: boolean;
  mitKrank?: boolean;
}): Promise<GesamtPdf | null> {
  const { PDFDocument, PageSizes } = await import("pdf-lib");
  let gesamt: import("pdf-lib").PDFDocument;
  try {
    const original = await PDFDocument.load(await opts.bericht.arrayBuffer());
    gesamt = await PDFDocument.create();
    const seiten = await gesamt.copyPages(original, original.getPageIndices());
    seiten.forEach((s) => gesamt.addPage(s));
  } catch (e) {
    console.warn("Bericht-PDF lässt sich nicht zusammenführen", e);
    return null;
  }

  const [fb, zettel, krank] = await Promise.all([
    opts.mitFahrtenbuch !== false ? ladeFahrtenbuchPdf(opts.mitarbeiterId, opts.jahr, opts.monat) : null,
    opts.mitZettel !== false ? ladeZulagenZettel({ mitarbeiterId: opts.mitarbeiterId, von: opts.von, bis: opts.bis }) : null,
    opts.mitKrank !== false ? ladeKrankenzettel(opts.mitarbeiterId, opts.von, opts.bis) : Promise.resolve([] as BeilagenDatei[]),
  ]);

  const pdfAnhaengen = async (bytes: ArrayBuffer) => {
    const quelle = await PDFDocument.load(bytes);
    const seiten = await gesamt.copyPages(quelle, quelle.getPageIndices());
    seiten.forEach((s) => gesamt.addPage(s));
  };

  if (fb) await pdfAnhaengen(fb.doc.output("arraybuffer") as ArrayBuffer);
  if (zettel) await pdfAnhaengen(zettel.output("arraybuffer") as ArrayBuffer);

  const extra: BeilagenDatei[] = [];
  let krankDrin = 0;
  for (const k of krank) {
    try {
      if (istPdf(k)) {
        await pdfAnhaengen(await k.inhalt.arrayBuffer());
      } else if (istBild(k)) {
        const { bytes, w, h } = await fotoAlsJpg(k.inhalt, k.name);
        const bild = await gesamt.embedJpg(bytes);
        // A4 hoch oder quer, je nach Foto; 10 mm Rand.
        const [aw, ah] = w > h ? [PageSizes.A4[1], PageSizes.A4[0]] : PageSizes.A4;
        const rand = 28;
        const f = Math.min((aw - 2 * rand) / w, (ah - 2 * rand) / h);
        const seite = gesamt.addPage([aw, ah]);
        seite.drawImage(bild, { x: (aw - w * f) / 2, y: (ah - h * f) / 2, width: w * f, height: h * f });
      } else {
        extra.push(k);
        continue;
      }
      krankDrin++;
    } catch (e) {
      console.warn("Krankenzettel nicht eingefügt, geht einzeln mit", k.name, e);
      extra.push(k);
    }
  }

  const bytes = await gesamt.save();
  return {
    pdf: new Blob([bytes], { type: "application/pdf" }),
    extra,
    fahrtenbuch: !!fb,
    zulagenZettel: !!zettel,
    krankenzettel: krankDrin,
  };
}

/** Blob → Base64 (ohne „data:…,“), für Mail-Anhänge. */
export async function blobAlsBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
