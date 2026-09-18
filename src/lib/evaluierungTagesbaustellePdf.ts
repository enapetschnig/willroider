/**
 * PDF „Evaluierung Tagesbaustellen“ — Gefahrenermittlung und Beurteilung bei
 * Bau- und Montagearbeiten, Sicherheits- und Gesundheitsschutzdokument lt.
 * §§ 4-5 ASchG. Nachbau der Excel-Vorlage von Ingenieurbüro Wulz (4 Seiten
 * A4 hoch): Kopf mit beiden Logos, Angaben zur Baustelle, zwei Seiten
 * Gefährdungen/Maßnahmen mit ☒/☐, zuletzt Unterweisender und die
 * Unterschriften der Mitarbeiter („Verstanden und zur Kenntnis genommen“).
 */

import jsPDF from "jspdf";
import { TAGESBAUSTELLE_FELDER, TAGESBAUSTELLE_GEFAHREN, type GefahrGruppe } from "@/lib/unterweisungen";

export type TagesbaustelleUnterschrift = {
  name: string;
  funktion: string;
  datum: string | null; // 18.09.2026
  unterschriftBase64: string | null;
};

export interface TagesbaustellePdfInput {
  datum: string; // Evaluierung durchgeführt am (dd.mm.yyyy)
  baustelle: string;
  kostenstelle: string;
  werte: Record<string, string>;
  vortragender: string;
  notizen: string;
  unterschriften: TagesbaustelleUnterschrift[];
}

const BLAU: [number, number, number] = [31, 78, 121];
const GRAU: [number, number, number] = [110, 110, 115];
const SCHWARZ: [number, number, number] = [20, 20, 20];
const SEITEN = 4;

const _cache: Record<string, string | null> = {};
async function ladeBild(pfad: string): Promise<string | null> {
  if (pfad in _cache) return _cache[pfad];
  try {
    const res = await fetch(pfad);
    if (!res.ok) return (_cache[pfad] = null);
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return (_cache[pfad] = dataUrl);
  } catch {
    return (_cache[pfad] = null);
  }
}

const an = (w: Record<string, string>, key: string) => w[key] === "x";
const box = (gesetzt: boolean) => (gesetzt ? "☒" : "☐"); // ☒ / ☐

function datumAnzeige(iso: string | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso + "T00:00:00").toLocaleDateString("de-AT");
  return iso;
}

export async function makeTagesbaustellePdf(input: TagesbaustellePdfInput): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(); // 210
  const pageH = doc.internal.pageSize.getHeight(); // 297
  const m = 14;
  const innen = pageW - 2 * m;
  const [logoW, logoWulz] = await Promise.all([
    ladeBild("/willroider-logo.jpg"),
    ladeBild("/wulz-logo.jpg"),
  ]);
  // Die Kästchen ☒/☐ gibt es in Helvetica nicht — ZapfDingbats/Symbol auch
  // nicht verlässlich. Deshalb werden sie gezeichnet.
  const kaestchen = (x: number, y: number, gesetzt: boolean) => {
    doc.setDrawColor(...SCHWARZ);
    doc.setLineWidth(0.3);
    doc.rect(x, y - 2.6, 3.2, 3.2);
    if (gesetzt) {
      doc.setLineWidth(0.5);
      doc.line(x + 0.5, y - 2.1, x + 2.7, y + 0.1);
      doc.line(x + 2.7, y - 2.1, x + 0.5, y + 0.1);
      doc.setLineWidth(0.3);
    }
  };

  const kopf = (seite: number) => {
    if (logoW) {
      try {
        doc.addImage(logoW, "JPEG", m, 10, 24, 12, undefined, "FAST");
      } catch {
        /* ohne Logo */
      }
    }
    if (logoWulz) {
      try {
        doc.addImage(logoWulz, "JPEG", pageW - m - 78, 9, 78, 14, undefined, "FAST");
      } catch {
        /* ohne Logo */
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAU);
    doc.text(
      "Externe Sicherheitsfachkraft: Ing. Stephan Wulz      § 3 (6) Person lt. ASchG: Johannes Maurer",
      pageW / 2,
      28,
      { align: "center" },
    );
    doc.setDrawColor(...BLAU);
    doc.setLineWidth(0.5);
    doc.line(m, 30, pageW - m, 30);
    // Fuß
    doc.setFontSize(7);
    doc.setTextColor(...GRAU);
    doc.text(`Seite ${seite} von ${SEITEN}`, m, pageH - 8);
    doc.text("Evaluierung Tagesbaustellen · Holzbau Willroider GmbH", pageW / 2, pageH - 8, {
      align: "center",
    });
    doc.text("Ingenieurbüro Wulz GmbH", pageW - m, pageH - 8, { align: "right" });
    doc.setTextColor(...SCHWARZ);
  };

  // ─── Seite 1: Titel + Angaben ─────────────────────────────────────────
  kopf(1);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...BLAU);
  doc.text("Gefahrenermittlung und Beurteilung", pageW / 2, 40, { align: "center" });
  doc.text("bei Bau- und Montagearbeiten", pageW / 2, 47, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...SCHWARZ);
  doc.text("Sicherheits- und Gesundheitsschutzdokument lt. §§ 4-5 ASchG", pageW / 2, 54, {
    align: "center",
  });
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text("HOLZBAU WILLROIDER GMBH", m, 62);
  doc.text("A-9500 VILLACH, WILLROIDERSTRASSE 13", pageW - m, 62, { align: "right" });
  doc.setDrawColor(...SCHWARZ);
  doc.setLineWidth(0.3);
  doc.line(m, 64, pageW - m, 64);

  const w = input.werte;
  const feld = (key: string) => (w[key] ?? "").trim();
  const zeilen: [string, string][] = [
    ["Evaluierung durchgeführt am", input.datum],
    ["Evaluierungsverfasser", feld("f.verfasser") || input.vortragender],
    ["Baustelle", input.kostenstelle ? `${input.baustelle} (${input.kostenstelle})` : input.baustelle],
    ["Anschrift", feld("f.anschrift")],
    ["Beschreibung des Bauvorhabens", feld("f.beschreibung")],
    ["Baubeginn", datumAnzeige(feld("f.baubeginn"))],
    ["Voraussichtliches Ende", datumAnzeige(feld("f.bauende"))],
    ["Herzustellendes Objekt", feld("f.objekt")],
    ["Vorgesehener Arbeitsablauf", feld("f.ablauf")],
    ["Bauleiter", [feld("f.bauleiter"), feld("f.bauleiter_tel") && `Handy ${feld("f.bauleiter_tel")}`].filter(Boolean).join(" · ")],
    ["Partieführer", [feld("f.partiefuehrer"), feld("f.partiefuehrer_tel") && `Handy ${feld("f.partiefuehrer_tel")}`].filter(Boolean).join(" · ")],
    ["Max. Anzahl der Arbeitnehmer", feld("f.max_an")],
    ["Subunternehmer", feld("f.sub")],
    ["Auszuführende Tätigkeit (Sub)", feld("f.sub_taetigkeit")],
    ["Anschrift Subunternehmer", feld("f.sub_anschrift")],
    ["Max. Anzahl AN des Subunternehmers", feld("f.sub_max")],
  ];
  // Alle Felder der Vorlage stehen im PDF — auch leere, wie auf dem Papier.
  void TAGESBAUSTELLE_FELDER;

  let y = 72;
  const labelW = 58;
  doc.setFontSize(9);
  for (const [label, wert] of zeilen) {
    const text = doc.splitTextToSize(wert || " ", innen - labelW - 2) as string[];
    const h = Math.max(1, text.length) * 4.4 + 2.6;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAU);
    doc.text(label, m, y + 3.2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...SCHWARZ);
    doc.text(text, m + labelW, y + 3.2);
    doc.setDrawColor(200, 200, 205);
    doc.setLineWidth(0.2);
    doc.line(m + labelW, y + h - 0.6, pageW - m, y + h - 0.6);
    y += h;
  }
  if (input.notizen.trim()) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAU);
    doc.text("Hinweise", m, y + 3.2);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...SCHWARZ);
    const t = doc.splitTextToSize(input.notizen.trim(), innen - labelW - 2) as string[];
    doc.text(t.slice(0, 8), m + labelW, y + 3.2);
  }

  // ─── Seiten 2+3: Gefährdungen / Maßnahmen ────────────────────────────
  const spalteL = m;
  const spalteR = m + innen * 0.42;
  const breiteL = innen * 0.42 - 3;
  const breiteR = innen * 0.58;

  const tabellenKopf = () => {
    doc.setFillColor(232, 238, 245);
    doc.rect(m, 36, innen, 13, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...BLAU);
    doc.text("Besondere Gefahren im Arbeitsbereich:", m + 2, 41);
    doc.setFontSize(8);
    doc.setTextColor(...SCHWARZ);
    doc.text("Gefährdung", spalteL + 2, 46.5);
    doc.text("Erforderliche Sicherheitsmaßnahmen", spalteR + 2, 46.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRAU);
    doc.text("(☒ vorhanden / ☐ nicht vorhanden)".replace("☒", "x").replace("☐", "o"), spalteL + 24, 46.5);
    doc.text("(x umzusetzen / o nicht erforderlich)", spalteR + 62, 46.5);
    doc.setTextColor(...SCHWARZ);
    return 52;
  };

  const gruppeHoehe = (g: GefahrGruppe): number => {
    doc.setFontSize(8.5);
    let hL = 6 + (g.hinweis ? 3.5 : 0);
    for (const z of g.zusatz ?? []) {
      const t = doc.splitTextToSize(`${z.label}: ${w[z.key] ?? ""}`, breiteL - 6) as string[];
      hL += t.length * 3.6 + 1.5;
    }
    let hR = 2;
    for (const ms of g.massnahmen) {
      const text = g.frei
        ? `${ms.label}: ${w[`t.${ms.key}`] ?? ""}`
        : ms.freitext && w[`t.${ms.key}`]
          ? `${ms.label}: ${w[`t.${ms.key}`]}`
          : ms.label;
      const t = doc.splitTextToSize(text, breiteR - 9) as string[];
      hR += t.length * 3.6 + 1.4;
    }
    return Math.max(hL, hR) + 3;
  };

  const zeichneGruppe = (g: GefahrGruppe, top: number): number => {
    const h = gruppeHoehe(g);
    const vorhanden = an(w, `g.${g.key}`);
    if (vorhanden) {
      doc.setFillColor(252, 245, 240);
      doc.rect(m, top, innen, h, "F");
    }
    doc.setDrawColor(150, 150, 155);
    doc.setLineWidth(0.25);
    doc.rect(m, top, innen, h);
    doc.line(spalteR - 1.5, top, spalteR - 1.5, top + h);

    // links
    let yl = top + 5;
    kaestchen(spalteL + 2, yl, vorhanden);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...SCHWARZ);
    const artFrei = g.frei ? (w[g.zusatz?.[0]?.key ?? ""] ?? "").trim() : "";
    doc.text(g.frei && artFrei ? `${g.label}: ${artFrei}` : g.label, spalteL + 7, yl, {
      maxWidth: breiteL - 8,
    });
    yl += 4;
    if (g.hinweis) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...GRAU);
      doc.text(`(${g.hinweis})`, spalteL + 7, yl);
      yl += 3.5;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SCHWARZ);
    for (const z of g.zusatz ?? []) {
      if (g.frei) continue; // Art der Gefährdung steht schon in der Überschrift
      const t = doc.splitTextToSize(`${z.label}: ${w[z.key] ?? ""}`, breiteL - 6) as string[];
      yl += 1.5;
      doc.text(t, spalteL + 2, yl + 1);
      yl += t.length * 3.6;
    }

    // rechts
    let yr = top + 5;
    doc.setFontSize(8);
    for (const ms of g.massnahmen) {
      const gesetzt = an(w, ms.key);
      const text = g.frei
        ? `${ms.label}: ${w[`t.${ms.key}`] ?? ""}`
        : ms.freitext && w[`t.${ms.key}`]
          ? `${ms.label}: ${w[`t.${ms.key}`]}`
          : ms.label;
      const t = doc.splitTextToSize(text, breiteR - 9) as string[];
      kaestchen(spalteR + 2, yr, gesetzt);
      doc.setTextColor(...(gesetzt || !vorhanden ? SCHWARZ : GRAU));
      doc.text(t, spalteR + 7, yr);
      yr += t.length * 3.6 + 1.4;
    }
    doc.setTextColor(...SCHWARZ);
    return h;
  };

  // Verteilung wie die Vorlage: erste Seite bis „Gefährdung Dritter“, dann
  // Bahn, Gewässer und Sonstige. Passt eine Gruppe nicht mehr, rutscht sie.
  doc.addPage();
  kopf(2);
  let yt = tabellenKopf();
  let seite = 2;
  for (const g of TAGESBAUSTELLE_GEFAHREN) {
    const h = gruppeHoehe(g);
    if (yt + h > pageH - 16 && seite < 3) {
      doc.addPage();
      seite = 3;
      kopf(3);
      yt = tabellenKopf();
    }
    if (yt + h > pageH - 16) break; // sicherheitshalber — passt in der Praxis
    yt += zeichneGruppe(g, yt);
  }
  if (seite < 3) {
    doc.addPage();
    kopf(3);
    tabellenKopf();
  }

  // ─── Seite 4: Unterweisender + Unterschriften ────────────────────────
  doc.addPage();
  kopf(4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...SCHWARZ);
  doc.text("Unterweisender:", m, 42);
  doc.setFont("helvetica", "normal");
  doc.text(input.vortragender || "—", m + 34, 42);
  doc.setDrawColor(...SCHWARZ);
  doc.setLineWidth(0.3);
  doc.line(pageW - m - 75, 52, pageW - m, 52);
  doc.setFontSize(7);
  doc.setTextColor(...GRAU);
  doc.text("Unterschrift und Datum der Unterweisung", pageW - m - 75, 56);
  doc.setTextColor(...SCHWARZ);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Verstanden und zur Kenntnis genommen durch Unterschrift:", m, 68);

  const spalten = [m, m + 52, m + 78, m + 122];
  const zeileH = 14;
  let ys = 74;
  doc.setFillColor(232, 238, 245);
  doc.rect(m, ys, innen, 7, "F");
  doc.setFontSize(8);
  doc.text("Name", spalten[0] + 2, ys + 4.8);
  doc.text("Datum", spalten[1] + 2, ys + 4.8);
  doc.text("Firma und Funktion", spalten[2] + 2, ys + 4.8);
  doc.text("Unterschrift", spalten[3] + 2, ys + 4.8);
  ys += 7;
  doc.setFont("helvetica", "normal");
  const maxZeilen = Math.floor((pageH - 18 - ys) / zeileH);
  const liste = [...input.unterschriften];
  while (liste.length < Math.min(maxZeilen, 10)) {
    liste.push({ name: "", funktion: "", datum: null, unterschriftBase64: null });
  }
  for (const u of liste.slice(0, maxZeilen)) {
    doc.setDrawColor(170, 170, 175);
    doc.setLineWidth(0.2);
    doc.rect(m, ys, innen, zeileH);
    for (const x of spalten.slice(1)) doc.line(x, ys, x, ys + zeileH);
    doc.setFontSize(8.5);
    doc.setTextColor(...SCHWARZ);
    doc.text(u.name, spalten[0] + 2, ys + 8.5, { maxWidth: 48 });
    doc.text(u.datum ?? "", spalten[1] + 2, ys + 8.5);
    doc.text(u.funktion, spalten[2] + 2, ys + 8.5, { maxWidth: 42 });
    if (u.unterschriftBase64) {
      try {
        const dataUrl = u.unterschriftBase64.startsWith("data:")
          ? u.unterschriftBase64
          : `data:image/png;base64,${u.unterschriftBase64}`;
        doc.addImage(dataUrl, "PNG", spalten[3] + 2, ys + 1, 36, zeileH - 2, undefined, "FAST");
      } catch {
        /* ohne Bild */
      }
    }
    ys += zeileH;
  }

  return doc;
}
