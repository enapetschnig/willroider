/**
 * „Als Kopie speichern“: Originalplan + Anmerkungen als neue PDF.
 *
 * Das Original bleibt Vektor (pdf-lib lädt die Seiten unverändert, die
 * Anmerkungen kommen als zusätzliche Zeichnung darüber). Bilder werden auf
 * eine Seite in Bildgröße gelegt. Fotos der Foto-Pins hängen nummeriert
 * auf eigenen Seiten hinten an.
 */
import type { AnmerkungsDaten, Form } from "./anmerkungen";
import { flaecheText, laengeText, polygonFlaeche, wolkenPunkte } from "./anmerkungen";

type Punkt = { x: number; y: number };

function hexZuRgb(hex: string) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
}

function dataUrlZuBytes(url: string): { bytes: Uint8Array; png: boolean } {
  const [kopf, b64] = url.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: /image\/png/.test(kopf) };
}

export async function planMitAnmerkungenAlsPdf(opts: {
  original: Blob;
  istPdf: boolean;
  daten: AnmerkungsDaten;
  titel: string;
}): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } = await import("pdf-lib");
  let doc: import("pdf-lib").PDFDocument;
  const bytes = new Uint8Array(await opts.original.arrayBuffer());
  if (opts.istPdf) {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } else {
    doc = await PDFDocument.create();
    const png = opts.original.type === "image/png";
    let bild;
    try {
      bild = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      // andere Bildarten (webp, gif) über die Zeichenfläche in JPG wandeln
      const bmp = await createImageBitmap(opts.original);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      const jpg = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
      bild = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    }
    const seite = doc.addPage([bild.width, bild.height]);
    seite.drawImage(bild, { x: 0, y: 0, width: bild.width, height: bild.height });
  }
  const schrift = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);
  const sicher = (t: string) =>
    [...t]
      .map((ch) => {
        if (ch === "\n") return ch;
        try {
          schrift.encodeText(ch);
          return ch;
        } catch {
          return "?";
        }
      })
      .join("");

  const fotos: { nr: number; bild: string; notiz?: string; seite: number }[] = [];
  const seiten = doc.getPages();

  seiten.forEach((seite, idx) => {
    const formen: Form[] = opts.daten.seiten[String(idx + 1)] ?? [];
    if (formen.length === 0) return;
    const rot = ((seite.getRotation().angle % 360) + 360) % 360;
    const box = opts.istPdf ? seite.getCropBox() : { x: 0, y: 0, width: seite.getWidth(), height: seite.getHeight() };
    const xMin = box.x, yMin = box.y, xMax = box.x + box.width, yMax = box.y + box.height;
    // Anzeige (wie pdf.js, Maßstab 1) → PDF-Koordinaten
    const zuPdf = (x: number, y: number): Punkt => {
      switch (rot) {
        case 90: return { x: y + xMin, y: x + yMin };
        case 180: return { x: xMax - x, y: y + yMin };
        case 270: return { x: xMax - y, y: yMax - x };
        default: return { x: x + xMin, y: yMax - y };
      }
    };
    const pfad = (punkte: number[], zu = false) => {
      let d = "";
      for (let i = 0; i < punkte.length; i += 2) {
        const p = zuPdf(punkte[i], punkte[i + 1]);
        d += `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${(-p.y).toFixed(2)} `;
      }
      return zu ? d + "Z" : d;
    };
    const linie = (punkte: number[], f: Form, zu = false, fuellung?: [number, number, number]) => {
      const [r, g, b] = hexZuRgb(f.farbe);
      seite.drawSvgPath(pfad(punkte, zu), {
        x: 0,
        y: 0,
        borderColor: rgb(r, g, b),
        borderWidth: f.breite,
        borderLineCap: LineCapStyle.Round,
        ...(fuellung ? { color: rgb(...fuellung), opacity: 0.18, borderOpacity: 1 } : {}),
      });
    };
    const text = (t: string, x: number, y: number, groesse: number, farbe: string, f = schrift) => {
      const [r, g, b] = hexZuRgb(farbe);
      sicher(t)
        .split("\n")
        .forEach((zeile, i) => {
          const p = zuPdf(x, y + groesse * 0.85 + i * groesse * 1.2);
          seite.drawText(zeile, { x: p.x, y: p.y, size: groesse, font: f, color: rgb(r, g, b), rotate: degrees(rot) });
        });
    };
    const masstext = (t: string, x: number, y: number, groesse: number, farbe: string) => {
      // weißer Hintergrund für Lesbarkeit
      const w = fett.widthOfTextAtSize(sicher(t), groesse);
      const ecken = [x - 2, y - 2, x + w + 2, y - 2, x + w + 2, y + groesse * 1.15, x - 2, y + groesse * 1.15];
      seite.drawSvgPath(pfad(ecken, true), { x: 0, y: 0, color: rgb(1, 1, 1), opacity: 0.85 });
      text(t, x, y, groesse, farbe, fett);
    };

    for (const f of formen) {
      switch (f.typ) {
        case "stift":
          if (f.punkte.length >= 4) linie(f.punkte, f);
          break;
        case "pfeil": {
          linie([f.x1, f.y1, f.x2, f.y2], f);
          const w = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
          const l = Math.max(f.breite * 5, 8);
          linie([
            f.x2 - l * Math.cos(w - 0.45), f.y2 - l * Math.sin(w - 0.45),
            f.x2, f.y2,
            f.x2 - l * Math.cos(w + 0.45), f.y2 - l * Math.sin(w + 0.45),
          ], f);
          break;
        }
        case "rechteck":
          linie([f.x1, f.y1, f.x2, f.y1, f.x2, f.y2, f.x1, f.y2], f, true);
          break;
        case "wolke": {
          const bogen = Math.max(f.breite * 6, 10);
          for (const b of wolkenPunkte(f.x1, f.y1, f.x2, f.y2, bogen)) linie(b, f);
          break;
        }
        case "laenge": {
          linie([f.x1, f.y1, f.x2, f.y2], f);
          const w = Math.atan2(f.y2 - f.y1, f.x2 - f.x1) + Math.PI / 2;
          const q = f.breite * 4;
          for (const [px, py] of [[f.x1, f.y1], [f.x2, f.y2]])
            linie([px - q * Math.cos(w), py - q * Math.sin(w), px + q * Math.cos(w), py + q * Math.sin(w)], f);
          const g = Math.max(f.breite * 6, 8);
          masstext(laengeText(Math.hypot(f.x2 - f.x1, f.y2 - f.y1), opts.daten.massstab), (f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2 - g * 1.4, g, f.farbe);
          break;
        }
        case "flaeche": {
          if (f.punkte.length < 6) break;
          linie(f.punkte, f, true, [...hexZuRgb(f.farbe)] as [number, number, number]);
          let cx = 0, cy = 0;
          const n = f.punkte.length / 2;
          for (let i = 0; i < n; i++) { cx += f.punkte[2 * i]; cy += f.punkte[2 * i + 1]; }
          const g = Math.max(f.breite * 6, 8);
          masstext(flaecheText(polygonFlaeche(f.punkte), opts.daten.massstab), cx / n, cy / n - g / 2, g, f.farbe);
          break;
        }
        case "text":
          text(f.text, f.x, f.y, f.groesse, f.farbe);
          break;
        case "foto": {
          const nr = fotos.length + 1;
          fotos.push({ nr, bild: f.bild, notiz: f.notiz, seite: idx + 1 });
          const p = zuPdf(f.x, f.y);
          const r = Math.max(f.breite * 4, 9);
          seite.drawCircle({ x: p.x, y: p.y, size: r, color: rgb(0.69, 0.21, 0.24), borderColor: rgb(1, 1, 1), borderWidth: r / 6 });
          const t = String(nr);
          const tw = fett.widthOfTextAtSize(t, r * 1.1);
          // Nummer mittig, Leserichtung wie angezeigt
          text(t, f.x - tw / 2, f.y - r * 0.6, r * 1.1, "#ffffff", fett);
          break;
        }
      }
    }
  });

  // Fotos der Pins auf eigenen Seiten (A4 hoch, zwei je Seite)
  if (fotos.length > 0) {
    const B = 595, H = 842, rand = 40;
    let seite = doc.addPage([B, H]);
    let platz = 0;
    seite.drawText(sicher(`Fotos zu ${opts.titel}`).slice(0, 90), { x: rand, y: H - rand - 4, size: 13, font: fett });
    for (const f of fotos) {
      if (platz === 2) {
        seite = doc.addPage([B, H]);
        platz = 0;
      }
      const oben = H - rand - 30 - platz * ((H - 2 * rand - 30) / 2);
      const hoehe = (H - 2 * rand - 30) / 2 - 30;
      try {
        const { bytes: bb, png } = dataUrlZuBytes(f.bild);
        const bild = png ? await doc.embedPng(bb) : await doc.embedJpg(bb);
        const s = Math.min((B - 2 * rand) / bild.width, hoehe / bild.height);
        seite.drawImage(bild, { x: rand, y: oben - 20 - bild.height * s, width: bild.width * s, height: bild.height * s });
      } catch {
        /* Foto nicht lesbar — nur Beschriftung */
      }
      const zeile = `Foto ${f.nr}${fotos.some((x) => x.seite > 1) ? ` (Seite ${f.seite})` : ""}${f.notiz ? ` – ${f.notiz}` : ""}`;
      seite.drawText(sicher(zeile).slice(0, 110), { x: rand, y: oben - 12, size: 10, font: fett });
      platz++;
    }
  }

  const out = await doc.save();
  return new Blob([out], { type: "application/pdf" });
}
