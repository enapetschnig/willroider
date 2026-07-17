/**
 * Bild-Generator für die Tagesplanung — PNG fürs WhatsApp-Teilen.
 *
 * Ein Bild zeigt in WhatsApp eine echte Vorschau im Chat (PDFs nur ein
 * Datei-Symbol). Hochformat, handy-lesbar, Polier fett wie in App/PDF.
 */

import type { TagesPlanData } from "@/hooks/useTagesplanung";

const W = 1080;
const PAD = 48;
const INNER = W - 2 * PAD;

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
  return `${WOCHENTAG[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}.${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Wortweiser Umbruch auf maxWidth; liefert die Zeilen. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w2 of words) {
    const test = cur ? `${cur} ${w2}` : w2;
    if (ctx.measureText(test).width <= maxWidth || !cur) cur = test;
    else {
      lines.push(cur);
      cur = w2;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Zeichnet den Plan (oder misst nur die Höhe, wenn `draw=false`).
 * Gibt die benötigte Gesamthöhe zurück.
 */
function layout(ctx: CanvasRenderingContext2D, plan: TagesPlanData, draw: boolean): number {
  let y = PAD;
  const text = (
    s: string,
    font: string,
    color: string,
    x: number,
    yy: number,
  ) => {
    if (!draw) return;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "top";
    ctx.fillText(s, x, yy);
  };

  // ── Kopf ───────────────────────────────────────────────────────────
  text("ARBEITSEINTEILUNG", "bold 46px Georgia, serif", "#111", PAD, y);
  y += 56;
  text(fmtHeaderDatum(plan.datum), "italic 34px Georgia, serif", "#333", PAD, y);
  y += 48;
  if (draw) {
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
  }
  y += 24;

  // ── Einteilungen ───────────────────────────────────────────────────
  for (const e of plan.einteilungen) {
    const startY = y;
    y += 18;

    // BVH + KST
    const bvh = e.baustelle?.bvh_name ?? "(intern)";
    ctx.font = "bold 34px Georgia, serif";
    for (const line of wrap(ctx, bvh, INNER - 40)) {
      text(line, "bold 34px Georgia, serif", "#111", PAD + 20, y);
      y += 42;
    }
    if (e.baustelle?.kostenstelle) {
      text(e.baustelle.kostenstelle, "26px Georgia, serif", "#777", PAD + 20, y);
      y += 34;
    }

    // Tätigkeit
    if (e.einteilung.taetigkeit) {
      ctx.font = "italic 28px Georgia, serif";
      for (const line of wrap(ctx, e.einteilung.taetigkeit, INNER - 40)) {
        text(line, "italic 28px Georgia, serif", "#555", PAD + 20, y);
        y += 36;
      }
    }

    // Fahrzeuge
    if (e.fahrzeuge.length > 0) {
      const fz = "Fahrzeug: " + e.fahrzeuge.map((f) => f.kennzeichen).join(", ");
      ctx.font = "26px Georgia, serif";
      for (const line of wrap(ctx, fz, INNER - 40)) {
        text(line, "26px Georgia, serif", "#555", PAD + 20, y);
        y += 34;
      }
    }

    // Mitarbeiter — Polier (erster, per Hook-Sortierung) FETT
    y += 6;
    e.mitarbeiter.forEach((m, i) => {
      if (!m.profil) return;
      const name = `${m.profil.nachname} ${m.profil.vorname}`;
      const istLeiter = i === 0 && !!(m.profil as any).is_partieleiter;
      text(
        (istLeiter ? "▪ " : "• ") + name,
        `${istLeiter ? "bold " : ""}30px Georgia, serif`,
        "#111",
        PAD + 32,
        y,
      );
      y += 40;
    });
    if (e.mitarbeiter.length === 0) {
      text("• —", "30px Georgia, serif", "#999", PAD + 32, y);
      y += 40;
    }

    y += 14;
    // Trennrahmen um den Block
    if (draw) {
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(PAD, startY, INNER, y - startY);
    }
    y += 16;
  }

  if (plan.einteilungen.length === 0) {
    text("Keine Einteilungen für diesen Tag.", "30px Georgia, serif", "#777", PAD, y);
    y += 44;
  }

  // ── Abwesende ──────────────────────────────────────────────────────
  if (plan.abwesende.length > 0) {
    y += 8;
    text("Abwesend:", "bold italic 30px Georgia, serif", "#111", PAD, y);
    y += 40;
    const STATUS: Record<string, string> = {
      urlaub: "Urlaub",
      krank: "krank",
      schlechtwetter: "SW",
    };
    const s = plan.abwesende
      .map((a) => `${a.ma.nachname} ${a.ma.vorname} (${STATUS[a.status] ?? a.status})`)
      .join(", ");
    ctx.font = "28px Georgia, serif";
    for (const line of wrap(ctx, s, INNER)) {
      text(line, "28px Georgia, serif", "#444", PAD, y);
      y += 36;
    }
  }

  // ── Fußzeile ───────────────────────────────────────────────────────
  y += 20;
  text("Holzbau Willroider · willroider.app", "24px Georgia, serif", "#999", PAD, y);
  y += 34;

  return y + PAD / 2;
}

/** Erzeugt das Tagesplan-Bild als PNG-Blob (2x-Auflösung für Schärfe). */
export async function makeTagesplanungBild(plan: TagesPlanData): Promise<Blob> {
  // 1) Höhe messen
  const probe = document.createElement("canvas");
  probe.width = W;
  probe.height = 10;
  const mctx = probe.getContext("2d")!;
  const hoehe = Math.ceil(layout(mctx, plan, false));

  // 2) In 2-facher Auflösung zeichnen
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = hoehe * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, hoehe);
  layout(ctx, plan, true);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Bild-Erzeugung fehlgeschlagen"))),
      "image/png",
    );
  });
}
