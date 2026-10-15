// Materialliste (Excel-Vorlage von S. Egger) mit den Stammdaten einer
// Baustelle füllen — Wunsch 15.10.2026.
//
// Die Vorlage hat ein Blatt „Stammdaten"; alle anderen Blätter (Deckblatt,
// Ordner-Etiketten, Evaluierung, ÜA-Checkliste, Materiallisten …) holen
// BVH, Kostenstelle, Adresse usw. per Formel von dort. Es reicht also,
// die Zellen C2–C14 zu setzen.
//
// Bewusst KEINE Excel-Bibliothek: die gängigen werfen beim Speichern
// Dropdowns (x14-Datenüberprüfung), Bilder in Zellen und Druckeinstellungen
// still weg. Hier wird nur das XML der betroffenen Zellen ersetzt, alles
// andere bleibt Byte für Byte, wie es war. Excel rechnet beim Öffnen neu
// (fullCalcOnLoad); die zwischengespeicherten Werte der einfachen
// Verweise „=Stammdaten!C2" werden gleich mitgesetzt, damit auch die
// Vorschau (SharePoint/App, rechnet nicht) die richtigen Kopfdaten zeigt.

import { strFromU8, strToU8, unzipSync, zipSync } from "npm:fflate@0.8.2";

export type MaterialStammdaten = {
  bvh: string;
  bauherr?: string | null;
  bauherrStrasse?: string | null;
  bauherrPlzOrt?: string | null;
  baustelleStrasse?: string | null;
  baustellePlzOrt?: string | null;
  baubeginn?: string | null; // YYYY-MM-DD
  ende?: string | null; // YYYY-MM-DD
  kostenstelle?: string | null;
  auftragssumme?: number | null;
  beschaeftigte?: number | null;
  /** Bauleiter als „Vorname Nachname" (wie in der App). */
  bauleiter?: { vorname: string; nachname: string } | null;
};

type Wert = { art: "text"; text: string } | { art: "zahl"; zahl: number } | { art: "leer" };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Excel-Seriennummer eines Datums (Tage seit 30.12.1899). */
function excelDatum(iso: string): number {
  const [j, m, t] = iso.split("-").map(Number);
  return Math.round((Date.UTC(j, m - 1, t) - Date.UTC(1899, 11, 30)) / 86400000);
}

/** Texte der gemeinsamen Zeichenkettentabelle (Index → Text). */
function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const aus: string[] = [];
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    const teile = [...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    aus.push(
      teile
        .join("")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    );
  }
  return aus;
}

/** Pfad des Blatt-XML zu einem Blattnamen. */
function blattPfad(dateien: Record<string, Uint8Array>, name: string): string | null {
  const wb = strFromU8(dateien["xl/workbook.xml"]);
  const rels = strFromU8(dateien["xl/_rels/workbook.xml.rels"]);
  const sheet = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((s) => s.includes(`name="${esc(name)}"`));
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1];
  if (!rid) return null;
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
  const ziel = rel?.match(/Target="([^"]+)"/)?.[1];
  if (!ziel) return null;
  return ziel.startsWith("/") ? ziel.slice(1) : `xl/${ziel}`;
}

/** Inhalt einer Zelle neu setzen; Stil (s="…") bleibt. Die Zelle muss existieren. */
function zelleSetzen(xml: string, ref: string, wert: Wert): string {
  const re = new RegExp(`<c r="${ref}"((?:\\s+[a-zA-Z:]+="[^"]*")*)\\s*(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (!m) return xml;
  const attrs = m[1].replace(/\s+t="[^"]*"/, "");
  let neu: string;
  if (wert.art === "text") neu = `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(wert.text)}</t></is></c>`;
  else if (wert.art === "zahl") neu = `<c r="${ref}"${attrs}><v>${wert.zahl}</v></c>`;
  else neu = `<c r="${ref}"${attrs}/>`;
  return xml.replace(re, neu);
}

/** Wert einer Zelle (für die Bauleiter-Liste). */
function zellText(xml: string, ref: string, ss: string[]): string | null {
  const m = xml.match(new RegExp(`<c r="${ref}"((?:\\s+[a-zA-Z:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`));
  if (!m || !m[2]) return null;
  const v = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (/t="s"/.test(m[1]) && v != null) return ss[Number(v)] ?? null;
  const is = m[2].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)?.[1];
  return is ?? v ?? null;
}

const normName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Bauleiter so schreiben, wie ihn das Dropdown der Vorlage kennt
 * („Maurer Hannes", „Egger Sebastian") — sonst meldet Excel einen
 * ungültigen Wert. Gesucht wird in Blatt „Bauleiter" A5:A20 über den
 * Nachnamen und den Vornamen (auch Kurzformen: Hannes ⊂ Johannes).
 */
function bauleiterAusListe(
  dateien: Record<string, Uint8Array>,
  ss: string[],
  bl: { vorname: string; nachname: string },
): string {
  const fallback = `${bl.nachname} ${bl.vorname}`.trim();
  const pfad = blattPfad(dateien, "Bauleiter");
  if (!pfad || !dateien[pfad]) return fallback;
  const xml = strFromU8(dateien[pfad]);
  const nach = normName(bl.nachname);
  const vor = normName(bl.vorname);
  for (let r = 5; r <= 20; r++) {
    const roh = zellText(xml, `A${r}`, ss);
    if (!roh) continue;
    const t = normName(roh).split(" ");
    if (t[0] !== nach) continue;
    const v = t.slice(1).join(" ");
    if (!v || v === vor || vor.includes(v) || v.includes(vor)) return roh.trim();
  }
  return fallback;
}

/** Füllt die Vorlage; gibt die neue .xlsx zurück. */
export function materiallisteFuellen(vorlage: Uint8Array, d: MaterialStammdaten): Uint8Array {
  const dateien = unzipSync(vorlage);
  const pfad = blattPfad(dateien, "Stammdaten");
  if (!pfad || !dateien[pfad]) throw new Error("Blatt „Stammdaten“ fehlt in der Vorlage");
  const ss = sharedStrings(dateien["xl/sharedStrings.xml"] ? strFromU8(dateien["xl/sharedStrings.xml"]) : undefined);

  const text = (s: string | null | undefined): Wert => (s && s.trim() ? { art: "text", text: s.trim() } : { art: "leer" });
  const zahl = (n: number | null | undefined): Wert => (n != null && Number.isFinite(n) ? { art: "zahl", zahl: n } : { art: "leer" });
  const datum = (iso: string | null | undefined): Wert => (iso ? { art: "zahl", zahl: excelDatum(iso) } : { art: "leer" });

  const werte: Record<string, Wert> = {
    C2: text(d.bvh),
    C3: text(d.bauherr),
    C4: text(d.bauherrStrasse),
    C5: text(d.bauherrPlzOrt),
    C6: text(d.baustelleStrasse),
    C7: text(d.baustellePlzOrt),
    C9: datum(d.baubeginn),
    C10: datum(d.ende),
    C11: text(d.kostenstelle),
    C12: zahl(d.auftragssumme),
    C13: zahl(d.beschaeftigte),
  };
  if (d.bauleiter) werte.C14 = text(bauleiterAusListe(dateien, ss, d.bauleiter));

  let xml = strFromU8(dateien[pfad]);
  for (const [ref, w] of Object.entries(werte)) xml = zelleSetzen(xml, ref, w);
  dateien[pfad] = strToU8(xml);

  // Zwischengespeicherte Werte einfacher Verweise auf Stammdaten!Cn in
  // allen Blättern nachziehen (Vorschau rechnet nicht selbst).
  const verweis = /^\(?\s*Stammdaten!\$?C\$?(\d+)\s*\)?$/;
  for (const name of Object.keys(dateien)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    let s = strFromU8(dateien[name]);
    let geaendert = false;
    s = s.replace(
      /<c r="([A-Z]+\d+)"((?:\s+[a-zA-Z:]+="[^"]*")*)\s*>(<f(?:\s[^>]*)?>([^<]*)<\/f>)(?:<v>[\s\S]*?<\/v>)?<\/c>/g,
      (ganz, ref: string, attrs: string, fTag: string, formel: string) => {
        const m = formel.match(verweis);
        if (!m) return ganz;
        const w = werte[`C${m[1]}`];
        if (!w) return ganz;
        geaendert = true;
        const a = attrs.replace(/\s+t="[^"]*"/, "");
        if (w.art === "text") return `<c r="${ref}"${a} t="str">${fTag}<v>${esc(w.text)}</v></c>`;
        if (w.art === "zahl") return `<c r="${ref}"${a}>${fTag}<v>${w.zahl}</v></c>`;
        return `<c r="${ref}"${a} t="str">${fTag}<v></v></c>`;
      },
    );
    if (geaendert) dateien[name] = strToU8(s);
  }

  // Beim Öffnen alles neu rechnen lassen.
  let wb = strFromU8(dateien["xl/workbook.xml"]);
  wb = /<calcPr\b[^>]*fullCalcOnLoad=/.test(wb)
    ? wb
    : wb.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  dateien["xl/workbook.xml"] = strToU8(wb);

  return zipSync(dateien, { level: 6 });
}
