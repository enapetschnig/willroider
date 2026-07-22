/**
 * PDF der Arbeitseinteilung — 1:1-Nachbau der Poliereinsatz-Ansicht.
 *
 * Alles, was am Bildschirm zu sehen ist, steht auch im PDF und an
 * derselben Stelle:
 *   - linke Spalten  Polier/BVH · Zeitraum · KST · B · Bauleiter
 *   - Gruppenkopf je Partie (in Partie-Farbe getönt)
 *   - „Abwesend"-Zeile je Partie mit den Namen in den Balken
 *   - Einsatz-Balken in der Bauleiter-Farbe, BVH-Name IM Balken; passt er
 *     nicht hinein, steht er als Chip rechts daneben
 *   - „Start nicht fix" = schräg schraffiert mit gestricheltem Rand
 *   - Heute-Linie in Rot
 *   - unten der Block „Urlaube / Abwesenheiten"
 * Maße sind die Bildschirmwerte in mm umgerechnet (ROW_H 28px → 5.6mm).
 */

import jsPDF from "jspdf";
import { isWerktag } from "@/lib/feiertage";

export type PdfZeitraum = {
  id: string;
  partie_id: string;
  baustelle_id: string;
  von_datum: string;
  bis_datum: string;
  start_fix?: boolean | null;
};

export type PdfPartie = {
  id: string;
  name: string;
  farbcode: string | null;
  leiterName: string | null;
};

export type PdfBaustelle = {
  bvh_name: string | null;
  kostenstelle: string | null;
  bauleiterName: string | null;
  /** Planungsfarbe des Bauleiters — die Balkenfarbe. */
  farbe: string | null;
  /** false = Maschine/Anlage → in der Spalte „B" steht kein x */
  istBaustelle: boolean;
};

export type PdfAbwesenheit = {
  /** Nachname — steht im Balken, wie am Bildschirm. */
  name: string;
  /** Voller Name für den unteren Block. */
  vollname: string;
  partieId: string | null;
  /** ISO-Datum → urlaub | krank | schlechtwetter */
  tage: Map<string, string>;
  /** Eigene Farbe (Bauleiter) — sonst die Abwesenheits-Farbe. */
  planungsfarbe?: string | null;
  /** true = erscheint im unteren Block statt bei einer Partie. */
  imUnterenBlock?: boolean;
};

export type PoliereinsatzPdfInput = {
  von: string;
  bis: string;
  partien: PdfPartie[];
  zeitraeume: PdfZeitraum[];
  baustellen: Record<string, PdfBaustelle>;
  abwesenheiten: PdfAbwesenheit[];
  /** ISO von heute — für die rote Linie. */
  heute: string;
  /** Arbeitsfreie Tage aus dem Arbeitszeitkalender (kurze Woche, BU) —
   *  ohne sie wäre ein freier Freitag im PDF ein normaler Arbeitstag. */
  freieTage?: string[];
  /** Betriebsurlaubs-Tage — die Woche wird zusätzlich als „BU" beschriftet. */
  buTage?: string[];
};

const ABW_FARBE: Record<string, [number, number, number]> = {
  urlaub: [8, 145, 178],
  krank: [239, 68, 68],
  schlechtwetter: [245, 158, 11],
};
const ABW_NAME: Record<string, string> = {
  urlaub: "Urlaub",
  krank: "Krank",
  schlechtwetter: "Schlechtwetter",
};

const WT = ["S", "M", "D", "M", "D", "F", "S"];
const MON = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function tageZwischen(von: string, bis: string): string[] {
  const out: string[] = [];
  const d = new Date(von + "T00:00:00");
  const end = new Date(bis + "T00:00:00");
  while (d <= end) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`,
    );
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function isoWeek(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const t = new Date(d.valueOf());
  const day = (d.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3);
  const first = new Date(t.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((t.getTime() - first.getTime()) / 86400000 - 3 + ((first.getDay() + 6) % 7)) / 7,
    )
  );
}

function hexRgb(hex: string | null | undefined): [number, number, number] {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex.replace("#", ""))) return [107, 114, 128];
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Farbe mit Weiß mischen — bildet die Alpha-Tönung der Ansicht nach. */
function tint(rgb: [number, number, number], anteil: number): [number, number, number] {
  return [
    Math.round(255 - (255 - rgb[0]) * anteil),
    Math.round(255 - (255 - rgb[1]) * anteil),
    Math.round(255 - (255 - rgb[2]) * anteil),
  ];
}

const kurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const lang = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function makePoliereinsatzPdf(input: PoliereinsatzPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const M = 7;
  const ROW_H = 5.6; // = 28px am Bildschirm

  // Linke Spalten in denselben Verhältnissen wie in der Ansicht
  const C_BVH = 46;
  const C_ZEIT = 18;
  const C_KST = 15;
  const C_B = 4;
  const C_BL = 14;
  const LEFT_W = C_BVH + C_ZEIT + C_KST + C_B + C_BL;

  const tage = tageZwischen(input.von, input.bis);
  const dayW = (PAGE_W - 2 * M - LEFT_W) / Math.max(tage.length, 1);
  const gridX = M + LEFT_W;
  const idxVon = (iso: string) => tage.indexOf(iso);
  const frei = new Set(input.freieTage ?? []);
  const bu = new Set(input.buTage ?? []);
  /** Arbeitstag = Werktag UND im Kalender nicht als frei hinterlegt. */
  const istArbeitstag = (iso: string) =>
    isWerktag(new Date(iso + "T00:00:00")) && !frei.has(iso);
  const KOPF_H = 8.4; // zwei Kopfzeilen à 4.2

  /** Zusammenhängende Werktags-Abschnitte eines Zeitraums (wie am Schirm). */
  const arbeitstagSegmente = (von: string, bis: string) => {
    const segs: { start: number; end: number }[] = [];
    let start = -1;
    const v = von < input.von ? input.von : von;
    const b = bis > input.bis ? input.bis : bis;
    if (v > b) return segs;
    tageZwischen(v, b).forEach((t) => {
      const i = idxVon(t);
      if (i < 0) return;
      if (istArbeitstag(t)) {
        if (start < 0) start = i;
        if (i === tage.length - 1) segs.push({ start, end: i });
      } else if (start >= 0) {
        segs.push({ start, end: i - 1 });
        start = -1;
      }
    });
    if (start >= 0 && !segs.some((s) => s.start === start))
      segs.push({ start, end: idxVon(b) });
    return segs.filter((s) => s.end >= s.start);
  };

  /** Schräge Schraffur für „Start noch nicht fix" (wie das Streifenmuster). */
  const schraffur = (
    x: number,
    y: number,
    w: number,
    h: number,
    rgb: [number, number, number],
  ) => {
    const hell = tint(rgb, 0.33);
    doc.setFillColor(hell[0], hell[1], hell[2]);
    doc.rect(x, y, w, h, "F");
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    doc.setLineWidth(0.5);
    // 45°-Linien, an den Rechteck-Rändern beschnitten
    for (let k = -h; k < w; k += 1.6) {
      let x1 = x + k,
        y1 = y + h,
        x2 = x + k + h,
        y2 = y;
      if (x1 < x) {
        y1 -= x - x1;
        x1 = x;
      }
      if (x2 > x + w) {
        y2 += x2 - (x + w);
        x2 = x + w;
      }
      if (x1 <= x2 && y1 >= y2) doc.line(x1, y1, x2, y2);
    }
    doc.setLineWidth(0.3);
    doc.setLineDashPattern([0.7, 0.5], 0);
    doc.rect(x, y, w, h, "S");
    doc.setLineDashPattern([], 0);
  };

  let seite = 1;

  const zeichneKopf = (nr: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text("Arbeitseinteilung", M, M + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(`${lang(input.von)} – ${lang(input.bis)}`, M, M + 9.6);
    doc.setFontSize(7);
    doc.text(
      `Holzbau Willroider · erstellt ${lang(input.heute)}${nr > 1 ? ` · Seite ${nr}` : ""}`,
      PAGE_W - M,
      M + 5,
      { align: "right" },
    );

    // Legende wie in der Ansicht-Kopfleiste
    let lx = PAGE_W - M - 92;
    doc.setFontSize(5.6);
    Object.entries(ABW_NAME).forEach(([art, name]) => {
      const [r, g, b] = ABW_FARBE[art];
      doc.setFillColor(r, g, b);
      doc.circle(lx + 1, M + 8.5, 1, "F");
      doc.setTextColor(90);
      doc.text(name, lx + 3, M + 9.4);
      lx += art === "schlechtwetter" ? 28 : 20;
    });
    schraffur(lx, M + 7.4, 4, 2.4, [120, 120, 120]);
    doc.setTextColor(90);
    doc.text("Start nicht fix", lx + 5, M + 9.4);

    const ky = M + 13;

    // KW-Zeile: „KW 31 · 27. Jul" — exakt wie am Bildschirm
    doc.setFontSize(6.2);
    let i = 0;
    while (i < tage.length) {
      const kw = isoWeek(tage[i]);
      let n = 0;
      while (i + n < tage.length && isoWeek(tage[i + n]) === kw) n++;
      const x = gridX + i * dayW;
      doc.setFillColor(235, 235, 238);
      doc.rect(x, ky, n * dayW, 4.2, "F");
      doc.setDrawColor(205);
      doc.setLineWidth(0.1);
      doc.rect(x, ky, n * dayW, 4.2, "S");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40);
      const d = new Date(tage[i] + "T00:00:00");
      // Betriebsurlaubs-Woche wird wie am Bildschirm mit „BU" markiert
      const istBu = tage.slice(i, i + n).some((t) => bu.has(t));
      const txt = `KW ${kw} · ${d.getDate()}. ${MON[d.getMonth()]}${istBu ? "  BU" : ""}`;
      const kurzTxt = `KW ${kw}${istBu ? " BU" : ""}`;
      const w = n * dayW;
      if (doc.getTextWidth(txt) + 2 < w) doc.text(txt, x + w / 2, ky + 2.9, { align: "center" });
      else if (doc.getTextWidth(kurzTxt) + 1 < w)
        doc.text(kurzTxt, x + w / 2, ky + 2.9, { align: "center" });
      i += n;
    }

    // Tages-Zeile
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.8);
    tage.forEach((t, idx) => {
      const d = new Date(t + "T00:00:00");
      const istFrei = !istArbeitstag(t);
      const x = gridX + idx * dayW;
      const [fr, fg, fb] = istFrei ? [226, 226, 230] : [250, 250, 251];
      doc.setFillColor(fr, fg, fb);
      doc.rect(x, ky + 4.2, dayW, 4.2, "F");
      doc.setDrawColor(212);
      doc.rect(x, ky + 4.2, dayW, 4.2, "S");
      doc.setTextColor(istFrei ? 135 : 55);
      if (dayW > 2.4) {
        doc.text(WT[d.getDay()], x + dayW / 2, ky + 6, { align: "center" });
        doc.text(String(d.getDate()), x + dayW / 2, ky + 7.9, { align: "center" });
      }
    });

    // Kopf der linken Spalten
    doc.setFillColor(235, 235, 238);
    doc.rect(M, ky, LEFT_W, KOPF_H, "F");
    doc.setDrawColor(205);
    doc.rect(M, ky, LEFT_W, KOPF_H, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.6);
    doc.setTextColor(40);
    const base = ky + 6.2;
    doc.text("POLIER / BVH", M + 1.2, base);
    doc.text("ZEITRAUM", M + C_BVH + C_ZEIT - 1.2, base, { align: "right" });
    doc.text("KST", M + C_BVH + C_ZEIT + 1, base);
    doc.text("B", M + C_BVH + C_ZEIT + C_KST + C_B / 2, base, { align: "center" });
    doc.text("BAULEITER", M + C_BVH + C_ZEIT + C_KST + C_B + 1, base);

    return ky + KOPF_H;
  };

  /** Zeilen-Raster: Wochenenden/Feiertage grau, Trennlinie unten. */
  const zeichneRaster = (ry: number, tonung?: [number, number, number]) => {
    if (tonung) {
      doc.setFillColor(tonung[0], tonung[1], tonung[2]);
      doc.rect(M, ry, PAGE_W - 2 * M, ROW_H, "F");
    }
    tage.forEach((t, idx) => {
      if (!istArbeitstag(t)) {
        doc.setFillColor(0, 0, 0);
        doc.setGState(new (doc as any).GState({ opacity: 0.07 }));
        doc.rect(gridX + idx * dayW, ry, dayW, ROW_H, "F");
        doc.setGState(new (doc as any).GState({ opacity: 1 }));
      }
    });
    doc.setDrawColor(225);
    doc.setLineWidth(0.1);
    doc.line(M, ry + ROW_H, PAGE_W - M, ry + ROW_H);
  };

  let y = zeichneKopf(seite);
  const maxY = PAGE_H - M - 3;
  const platz = (n = 1) => {
    if (y + ROW_H * n <= maxY) return;
    seite += 1;
    doc.addPage();
    y = zeichneKopf(seite);
  };

  /** Einsatz-Zeile inkl. Balken — der Kern der Ansicht. */
  const zeichneEinsatz = (z: PdfZeitraum) => {
    platz();
    zeichneRaster(y);
    const b = input.baustellen[z.baustelle_id];
    const rgb = hexRgb(b?.farbe);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(25);
    const name = b?.bvh_name ?? "?";
    doc.text(
      (doc.splitTextToSize(name, C_BVH - 5) as string[])[0] ?? name,
      M + 3.5,
      y + 3.7,
    );
    doc.setFontSize(4.7);
    doc.setTextColor(115);
    doc.text(`${kurz(z.von_datum)}–${kurz(z.bis_datum)}`, M + C_BVH + C_ZEIT - 1.2, y + 3.7, {
      align: "right",
    });
    doc.text(
      (doc.splitTextToSize(b?.kostenstelle ?? "", C_KST - 1.5) as string[])[0] ?? "",
      M + C_BVH + C_ZEIT + 1,
      y + 3.7,
    );
    doc.setTextColor(40);
    if (b?.istBaustelle)
      doc.text("x", M + C_BVH + C_ZEIT + C_KST + C_B / 2, y + 3.7, { align: "center" });
    doc.text(
      (doc.splitTextToSize(b?.bauleiterName ?? "", C_BL - 1) as string[])[0] ?? "",
      M + C_BVH + C_ZEIT + C_KST + C_B + 1,
      y + 3.7,
    );

    const segs = arbeitstagSegmente(z.von_datum, z.bis_datum);
    if (segs.length === 0) {
      y += ROW_H;
      return;
    }
    const breitestes = segs.reduce((a, s) =>
      (s.end - s.start) > (a.end - a.start) ? s : a,
    );
    const labelPasst = (breitestes.end - breitestes.start + 1) * dayW >= 16;

    segs.forEach((s) => {
      const x = gridX + s.start * dayW;
      const w = (s.end - s.start + 1) * dayW;
      if (z.start_fix === false) {
        schraffur(x + 0.15, y + 0.6, w - 0.3, ROW_H - 1.2, rgb);
      } else {
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.roundedRect(x + 0.15, y + 0.6, w - 0.3, ROW_H - 1.2, 0.5, 0.5, "F");
      }
      if (s === breitestes && labelPasst) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5);
        doc.setTextColor(255);
        const platzInnen = w - 1.6;
        const t = (doc.splitTextToSize(name, platzInnen) as string[])[0] ?? name;
        doc.text(t, x + 0.9, y + 3.6);
      }
    });
    // Passt der Name nicht hinein → Chip rechts daneben, wie am Bildschirm
    if (!labelPasst) {
      const letzte = segs[segs.length - 1];
      const lx = gridX + (letzte.end + 1) * dayW + 0.6;
      const maxW = Math.min(38, PAGE_W - M - lx - 0.5);
      if (maxW > 6) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
        doc.setLineWidth(0.15);
        const t = (doc.splitTextToSize(name, maxW - 1.4) as string[])[0] ?? name;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5);
        const tw = Math.min(doc.getTextWidth(t) + 1.6, maxW);
        doc.roundedRect(lx, y + 0.9, tw, ROW_H - 1.8, 0.4, 0.4, "FD");
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        doc.text(t, lx + 0.8, y + 3.6);
      }
    }
    y += ROW_H;
  };

  /**
   * Balken einer Person in EINE bestehende Zeile zeichnen (setzt y nicht
   * weiter). Zusammenhängende Tage gleicher Art werden gebündelt, der
   * Nachname steht im Balken — genau wie am Bildschirm.
   */
  const zeichneAbwesenheitsBalken = (
    a: PdfAbwesenheit,
    zeilenY: number,
    eigenfarbe: boolean,
  ) => {
    const sortiert = [...a.tage.entries()].sort((x, z) => x[0].localeCompare(z[0]));
    let segStart = -1;
    let segArt = "";
    let vorigerIdx = -1;

    const flush = () => {
      if (segStart < 0) return;
      const x = gridX + segStart * dayW;
      const w = (vorigerIdx - segStart + 1) * dayW;
      const rgb =
        eigenfarbe && segArt === "urlaub" && a.planungsfarbe
          ? hexRgb(a.planungsfarbe)
          : (ABW_FARBE[segArt] ?? [107, 114, 128]);
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.roundedRect(x + 0.15, zeilenY + 0.6, w - 0.3, ROW_H - 1.2, 0.5, 0.5, "F");
      if (w >= 11) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(4.8);
        doc.setTextColor(255);
        const t = (doc.splitTextToSize(a.name, w - 1.4) as string[])[0] ?? a.name;
        doc.text(t, x + 0.8, zeilenY + 3.6);
      }
      segStart = -1;
    };

    for (const [iso, art] of sortiert) {
      const i = idxVon(iso);
      if (i < 0) continue;
      if (segStart < 0) {
        segStart = i;
        segArt = art;
      } else if (art !== segArt || i !== vorigerIdx + 1) {
        flush();
        segStart = i;
        segArt = art;
      }
      vorigerIdx = i;
    }
    flush();
  };

  /** „Abwesend"-Zeile einer Partie: ein Streifen für alle Mitglieder. */
  const zeichneAbwesenheitsZeile = (eintraege: PdfAbwesenheit[]) => {
    platz();
    zeichneRaster(y);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(5.4);
    doc.setTextColor(110);
    doc.text("Abwesend", M + 3.5, y + 3.7);
    eintraege.forEach((a) => zeichneAbwesenheitsBalken(a, y, false));
    y += ROW_H;
  };

  // ── Partien ────────────────────────────────────────────────────────
  for (const p of input.partien) {
    const eigene = input.zeitraeume
      .filter(
        (z) =>
          z.partie_id === p.id && z.bis_datum >= input.von && z.von_datum <= input.bis,
      )
      .sort((a, b) => a.von_datum.localeCompare(b.von_datum));
    const abw = input.abwesenheiten.filter(
      (a) => !a.imUnterenBlock && a.partieId === p.id && a.tage.size > 0,
    );
    if (eigene.length === 0 && abw.length === 0) continue;

    platz(2);
    // Gruppenkopf — getönt wie am Bildschirm (dort farbcode + 18 = ~9 %)
    const prgb = hexRgb(p.farbcode);
    zeichneRaster(y, tint(prgb, 0.16));
    doc.setFillColor(prgb[0], prgb[1], prgb[2]);
    doc.circle(M + 2.2, y + ROW_H / 2, 1.1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.4);
    doc.setTextColor(25);
    doc.text(p.leiterName ?? p.name, M + 4.5, y + 3.8);
    if (p.leiterName && p.leiterName !== p.name) {
      const w = doc.getTextWidth(p.leiterName ?? "");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.2);
      doc.setTextColor(110);
      doc.text(p.name, M + 5.5 + w, y + 3.8);
    }
    y += ROW_H;

    if (abw.length > 0) zeichneAbwesenheitsZeile(abw);
    eigene.forEach(zeichneEinsatz);
  }

  // ── Unterer Block: Urlaube / Abwesenheiten ─────────────────────────
  const unten = input.abwesenheiten.filter((a) => a.imUnterenBlock && a.tage.size > 0);
  if (unten.length > 0) {
    platz(2);
    zeichneRaster(y, [232, 232, 236]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(30);
    doc.text("Urlaube / Abwesenheiten", M + 1.5, y + 3.8);
    y += ROW_H;
    for (const a of unten) {
      platz();
      zeichneRaster(y);
      const rgb = hexRgb(a.planungsfarbe ?? "#9ca3af");
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.circle(M + 2.2, y + ROW_H / 2, 0.9, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.6);
      doc.setTextColor(30);
      doc.text(
        (doc.splitTextToSize(a.vollname, C_BVH - 5) as string[])[0] ?? a.vollname,
        M + 4.2,
        y + 3.7,
      );
      zeichneAbwesenheitsBalken(a, y, true);
      y += ROW_H;
    }
  }

  // ── Heute-Linie über alles ─────────────────────────────────────────
  const hi = idxVon(input.heute);
  if (hi >= 0) {
    const seiten = doc.internal.pages.length - 1;
    for (let s = 1; s <= seiten; s++) {
      doc.setPage(s);
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.5);
      doc.line(gridX + hi * dayW, M + 13, gridX + hi * dayW, PAGE_H - M);
    }
  }

  return doc;
}
