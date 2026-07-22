/**
 * PDF der Arbeitseinteilung (Poliereinsatz) — Gantt im Querformat.
 *
 * Zweck: Die Planung der nächsten Wochen zum Aushängen/Verschicken. Das
 * Layout folgt bewusst der Bildschirm-Ansicht: links Polier und BVH,
 * rechts die Balken über die Kalenderwochen, Abwesenheiten eigens.
 *
 * Der Zeitraum ist frei wählbar; die Tagesbreite passt sich an, damit
 * auch 8 Wochen noch auf die Seite gehen. Wird es zu eng, bricht das
 * Dokument automatisch auf mehrere Seiten um (Zeilen), nicht in die
 * Unlesbarkeit.
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
  farbe: string | null;
};

export type PdfAbwesenheit = {
  name: string;
  partieId: string | null;
  /** ISO-Datum → Art (urlaub | krank | schlechtwetter) */
  tage: Map<string, string>;
};

export type PoliereinsatzPdfInput = {
  von: string;
  bis: string;
  partien: PdfPartie[];
  zeitraeume: PdfZeitraum[];
  baustellen: Record<string, PdfBaustelle>;
  abwesenheiten: PdfAbwesenheit[];
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
const ABW_KURZ: Record<string, string> = {
  urlaub: "U",
  krank: "K",
  schlechtwetter: "SW",
};

const WT = ["S", "M", "D", "M", "D", "F", "S"];

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

/** "#3b82f6" → [59,130,246]; ungültig → Grau. */
function hexRgb(hex: string | null | undefined): [number, number, number] {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex.replace("#", "")))
    return [107, 114, 128];
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const fmt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export function makePoliereinsatzPdf(input: PoliereinsatzPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const M = 8;
  const LEFT_W = 62; // Polier/BVH + KST
  const ROW_H = 5.2;

  const tage = tageZwischen(input.von, input.bis);
  const dayW = (PAGE_W - 2 * M - LEFT_W) / Math.max(tage.length, 1);
  const gridX = M + LEFT_W;

  let y = 0;

  /** Kopf mit Titel + Spaltenköpfen; liefert das Y unter dem Kopf. */
  const zeichneKopf = (seite: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text("Arbeitseinteilung", M, M + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(`${fmt(input.von)} – ${fmt(input.bis)}`, M, M + 10);
    doc.setFontSize(7);
    doc.text(
      `Holzbau Willroider · erstellt ${fmt(
        new Date().toISOString().slice(0, 10),
      )}${seite > 1 ? ` · Seite ${seite}` : ""}`,
      PAGE_W - M,
      M + 5,
      { align: "right" },
    );

    // Legende in den Seitenkopf — sie stand vorher nur am Dokumentende und
    // fehlte damit ausgerechnet auf dem Blatt, das man aushängt.
    let lx = PAGE_W - M - 96;
    doc.setFontSize(5.6);
    Object.entries(ABW_KURZ).forEach(([art, kurz]) => {
      const [r, g, b] = ABW_FARBE[art];
      doc.setFillColor(r, g, b);
      doc.rect(lx, M + 7.6, 2.6, 2.6, "F");
      doc.setTextColor(90);
      doc.text(`${kurz} ${ABW_NAME[art]}`, lx + 3.4, M + 9.7);
      lx += art === "schlechtwetter" ? 26 : 20;
    });
    doc.setDrawColor(120);
    doc.setLineWidth(0.3);
    doc.rect(lx, M + 7.6, 2.6, 2.6, "S");
    doc.text("Start noch nicht fix", lx + 3.4, M + 9.7);

    let ky = M + 14;

    // KW-Zeile
    doc.setFontSize(6.5);
    doc.setTextColor(40);
    let i = 0;
    while (i < tage.length) {
      const kw = isoWeek(tage[i]);
      let n = 0;
      while (i + n < tage.length && isoWeek(tage[i + n]) === kw) n++;
      const x = gridX + i * dayW;
      doc.setFillColor(238, 238, 240);
      doc.rect(x, ky, n * dayW, 4.2, "F");
      doc.setDrawColor(200);
      doc.rect(x, ky, n * dayW, 4.2, "S");
      doc.setFont("helvetica", "bold");
      if (n * dayW > 9) doc.text(`KW ${kw}`, x + (n * dayW) / 2, ky + 3, { align: "center" });
      i += n;
    }
    ky += 4.2;

    // Tages-Zeile
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    tage.forEach((t, idx) => {
      const d = new Date(t + "T00:00:00");
      const frei = !isWerktag(d);
      const x = gridX + idx * dayW;
      doc.setFillColor(frei ? 224 : 248, frei ? 224 : 248, frei ? 228 : 250);
      doc.rect(x, ky, dayW, 4.2, "F");
      doc.setDrawColor(215);
      doc.rect(x, ky, dayW, 4.2, "S");
      doc.setTextColor(frei ? 130 : 60);
      if (dayW > 2.6) {
        doc.text(WT[d.getDay()], x + dayW / 2, ky + 1.9, { align: "center" });
        doc.text(String(d.getDate()), x + dayW / 2, ky + 3.8, { align: "center" });
      }
    });

    // Kopf der linken Spalte
    doc.setFillColor(238, 238, 240);
    doc.rect(M, M + 14, LEFT_W, 8.4, "F");
    doc.setDrawColor(200);
    doc.rect(M, M + 14, LEFT_W, 8.4, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(40);
    doc.text("Polier / BVH", M + 1.5, M + 19.5);
    doc.text("Zeitraum", M + LEFT_W - 1.5, M + 19.5, { align: "right" });

    return ky + 4.2;
  };

  /** Hintergrund-Raster einer Zeile (Wochenenden grau). */
  const zeichneRaster = (ry: number) => {
    tage.forEach((t, idx) => {
      const frei = !isWerktag(new Date(t + "T00:00:00"));
      if (frei) {
        doc.setFillColor(232, 232, 236);
        doc.rect(gridX + idx * dayW, ry, dayW, ROW_H, "F");
      }
    });
    doc.setDrawColor(228);
    doc.setLineWidth(0.1);
    doc.line(M, ry + ROW_H, PAGE_W - M, ry + ROW_H);
  };

  const neueSeite = (seite: number) => {
    doc.addPage();
    return zeichneKopf(seite);
  };

  let seite = 1;
  y = zeichneKopf(seite);
  const maxY = PAGE_H - M - 6;

  const idxVon = (iso: string) => tage.indexOf(iso);

  for (const p of input.partien) {
    const eigene = input.zeitraeume
      .filter((z) => z.partie_id === p.id && z.bis_datum >= input.von && z.von_datum <= input.bis)
      .sort((a, b) => a.von_datum.localeCompare(b.von_datum));
    const abw = input.abwesenheiten.filter(
      (a) => a.partieId === p.id && [...a.tage.keys()].some((t) => t >= input.von && t <= input.bis),
    );
    if (eigene.length === 0 && abw.length === 0) continue;

    if (y + ROW_H * 2 > maxY) {
      seite += 1;
      y = neueSeite(seite);
    }

    // Partie-Kopfzeile
    const [pr, pg, pb] = hexRgb(p.farbcode);
    doc.setFillColor(pr, pg, pb);
    doc.rect(M, y, PAGE_W - 2 * M, ROW_H, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    // „Sandner · Sandner" vermeiden, wenn Polier und Partie gleich heißen.
    const titel =
      p.leiterName && p.leiterName !== p.name
        ? p.leiterName + " · " + p.name
        : (p.leiterName ?? p.name);
    doc.text(titel, M + 1.5, y + 3.6);
    y += ROW_H;

    // Einsätze
    for (const z of eigene) {
      if (y + ROW_H > maxY) {
        seite += 1;
        y = neueSeite(seite);
      }
      zeichneRaster(y);
      const b = input.baustellen[z.baustelle_id];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(30);
      const name = b?.bvh_name ?? "?";
      doc.text(doc.splitTextToSize(name, LEFT_W - 22)[0] ?? name, M + 2.5, y + 3.5);
      doc.setTextColor(120);
      doc.setFontSize(5.2);
      doc.text(
        `${z.von_datum.slice(8, 10)}.${z.von_datum.slice(5, 7)}.–${z.bis_datum.slice(
          8,
          10,
        )}.${z.bis_datum.slice(5, 7)}.`,
        M + LEFT_W - 1.5,
        y + 3.5,
        { align: "right" },
      );

      // Balken — nur über Werktage, wie am Bildschirm
      const [br, bg, bb] = hexRgb(b?.farbe);
      const von = z.von_datum < input.von ? input.von : z.von_datum;
      const bis = z.bis_datum > input.bis ? input.bis : z.bis_datum;
      let start = -1;
      const flush = (endIdx: number) => {
        if (start < 0) return;
        const x = gridX + start * dayW;
        const w = (endIdx - start + 1) * dayW;
        doc.setFillColor(br, bg, bb);
        if (z.start_fix === false) {
          // Startzeitpunkt noch nicht fix → nur Umriss
          doc.setDrawColor(br, bg, bb);
          doc.setLineWidth(0.4);
          doc.rect(x + 0.2, y + 0.7, w - 0.4, ROW_H - 1.4, "S");
        } else {
          doc.rect(x + 0.2, y + 0.7, w - 0.4, ROW_H - 1.4, "F");
        }
        start = -1;
      };
      tageZwischen(von, bis).forEach((t) => {
        const idx = idxVon(t);
        if (idx < 0) return;
        if (isWerktag(new Date(t + "T00:00:00"))) {
          if (start < 0) start = idx;
        } else {
          flush(idx - 1);
        }
      });
      flush(idxVon(bis));
      y += ROW_H;
    }

    // Abwesenheiten der Partie
    for (const a of abw) {
      if (y + ROW_H > maxY) {
        seite += 1;
        y = neueSeite(seite);
      }
      zeichneRaster(y);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(5.6);
      doc.setTextColor(90);
      doc.text(a.name, M + 4, y + 3.5);
      a.tage.forEach((art, t) => {
        const idx = idxVon(t);
        if (idx < 0) return;
        const [r, g, bl] = ABW_FARBE[art] ?? [107, 114, 128];
        doc.setFillColor(r, g, bl);
        doc.rect(gridX + idx * dayW + 0.2, y + 0.7, dayW - 0.4, ROW_H - 1.4, "F");
        if (dayW > 3.4) {
          doc.setTextColor(255);
          doc.setFontSize(4.4);
          doc.text(ABW_KURZ[art] ?? "", gridX + idx * dayW + dayW / 2, y + 3.4, {
            align: "center",
          });
        }
      });
      y += ROW_H;
    }
  }

  return doc;
}
