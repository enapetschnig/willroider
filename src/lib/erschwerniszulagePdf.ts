/**
 * „Aufzeichnung Erschwerniszulage“ — der Zettel, den das Lohnbüro zu den
 * Zulagen braucht (Papiervorlage von J. Maurer, Wunsch 04.11.2026). Wird immer
 * frisch aus den Stunden gefüllt: ein Blatt je Kalenderwoche und Zulage.
 *
 * In der App werden nur die Stunden je Tag erfasst, nicht von wann bis wann.
 * Das Stundenraster zählt darum ab Arbeitsbeginn (sonst 07:00) durch; das steht
 * auch als Hinweis am Zettel. Maßgeblich ist die Summe.
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { addDays, getISOWeek, getISOWeekYear, startOfISOWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { localIso } from "@/lib/dateFmt";
import { fmtHNum } from "@/lib/zeiterfassung";
import { getLogo } from "@/lib/baustellenstundenberichtPdf";

/** Tätigkeiten lt. Kollektivvertrag § 6, wie auf der Papiervorlage. */
export const KV_PUNKTE: { punkt: string; text: string }[] = [
  { punkt: "a", text: "Aufsicht" },
  { punkt: "d", text: "Schmutz- Abbrucharbeiten" },
  { punkt: "f", text: "Erschütterungsarbeiten" },
  { punkt: "g", text: "Künettenarbeiten" },
  { punkt: "h", text: "Schachtarbeiten" },
  { punkt: "j", text: "Auf- Um- Abbauten Gerüst" },
  { punkt: "k", text: "Angeseilte Arbeiten" },
  { punkt: "m", text: "Arbeiten im Gebirge" },
  { punkt: "n", text: "Arbeiten mit Atemschutzgeräten" },
];

/** Zulagen-Typ der App → Punkt der Vorlage; unbekannte stehen im Klartext am Zettel. */
export function kvPunktFuerZulage(bezeichnung: string): string | null {
  const b = bezeichnung.toLowerCase();
  if (b.includes("aufsicht")) return "a";
  if (b.includes("schmutz") || b.includes("abbruch")) return "d";
  if (b.includes("erschütter")) return "f";
  if (b.includes("künette") || b.includes("kuenette")) return "g";
  if (b.includes("schacht")) return "h";
  if (b.includes("gerüst") || b.includes("geruest")) return "j";
  if (b.includes("angeseilt")) return "k";
  if (b.includes("gebirge") || b.includes("höhe") || b.includes("hoehe")) return "m";
  if (b.includes("atemschutz")) return "n";
  return null;
}

const WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const RASTER_VON = 6;
const RASTER_BIS = 19; // letzte Zeile der Vorlage: 19:00

export interface ZettelTagEingabe {
  datum: string;
  arbeitsbeginn: string | null;
  kostenstellen: string[];
  zulagen: { typId: string; bezeichnung: string; stunden: number | null }[];
}

export interface ZettelBlatt {
  kw: number;
  jahr: number;
  /** Mo–So; Sonntag wird nur gedruckt, wenn er belegt ist. */
  tage: {
    iso: string;
    /** null = kein Eintrag; 0 = Zulage ohne Stundenangabe („x“ wie am Stundenbericht). */
    stunden: number | null;
    beginn: number;
    kostenstellen: string[];
  }[];
  bezeichnung: string;
  kvPunkt: string | null;
  kostenstellen: string[];
  gesamt: number;
}

function beginnAlsZahl(b: string | null): number {
  const m = b?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 7;
}

/** Ein Blatt je Kalenderwoche und Zulage, nach Woche und Punkt sortiert. */
export function zulagenBlaetter(tage: ZettelTagEingabe[]): ZettelBlatt[] {
  const blaetter = new Map<string, ZettelBlatt>();
  for (const t of tage) {
    const datum = new Date(`${t.datum}T00:00:00`);
    for (const z of t.zulagen) {
      const kw = getISOWeek(datum);
      const jahr = getISOWeekYear(datum);
      const key = `${jahr}-${kw}-${z.typId}`;
      let blatt = blaetter.get(key);
      if (!blatt) {
        const montag = startOfISOWeek(datum);
        blatt = {
          kw,
          jahr,
          tage: Array.from({ length: 7 }, (_, i) => ({
            iso: localIso(addDays(montag, i)),
            stunden: null,
            beginn: 7,
            kostenstellen: [],
          })),
          bezeichnung: z.bezeichnung,
          kvPunkt: kvPunktFuerZulage(z.bezeichnung),
          kostenstellen: [],
          gesamt: 0,
        };
        blaetter.set(key, blatt);
      }
      const tag = blatt.tage.find((x) => x.iso === t.datum)!;
      const h = Number(z.stunden ?? 0) || 0;
      tag.stunden = (tag.stunden ?? 0) + h;
      tag.beginn = beginnAlsZahl(t.arbeitsbeginn);
      tag.kostenstellen = t.kostenstellen;
      blatt.gesamt += h;
      for (const k of t.kostenstellen) {
        if (!blatt.kostenstellen.includes(k)) blatt.kostenstellen.push(k);
      }
    }
  }
  return [...blaetter.values()].sort(
    (a, b) =>
      a.jahr - b.jahr ||
      a.kw - b.kw ||
      (a.kvPunkt ?? "z").localeCompare(b.kvPunkt ?? "z") ||
      a.bezeichnung.localeCompare(b.bezeichnung, "de"),
  );
}

/** Wie viel der Stunde `h` (06 … 19) unter die Zulage fällt, 0 … 1. */
export function anteilInStunde(h: number, beginn: number, stunden: number): number {
  const anteil = Math.min(h + 1, beginn + stunden) - Math.max(h, beginn);
  return anteil > 0 ? Math.min(anteil, 1) : 0;
}

export interface ZettelKopf {
  name: string;
  persNr: string;
  polier: string | null;
  /** Der Mitarbeiter ist selbst der Polier — seine Unterschrift gilt dort. */
  istSelbstPolier: boolean;
  unterschrift: string | null;
  unterschriebenAm: string | null;
  geprueftUnterschrift: string | null;
  geprueftAm: string | null;
}

const zahl = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const datumKurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

function bild(doc: jsPDF, daten: string | null, x: number, y: number) {
  if (!daten) return;
  try {
    doc.addImage(daten, "PNG", x, y, 38, 14, undefined, "FAST");
  } catch {
    /* beschädigte Unterschrift: Zettel trotzdem drucken */
  }
}

export async function makeErschwerniszulagePdf(blaetter: ZettelBlatt[], kopf: ZettelKopf): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const logo = await getLogo();
  const rand = 20;
  const breite = doc.internal.pageSize.getWidth() - 2 * rand;

  blaetter.forEach((blatt, seite) => {
    if (seite > 0) doc.addPage();
    doc.setTextColor(30, 30, 30);
    if (logo) {
      try {
        doc.addImage(logo, "JPEG", doc.internal.pageSize.getWidth() - rand - 40, 10, 40, 20, undefined, "FAST");
      } catch {
        /* ohne Logo weiter */
      }
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Aufzeichnung Erschwerniszulage", rand, 22);

    const kopfZeilen: [string, string][] = [
      ["Mitarbeiter:", kopf.name],
      ["Personal Nummer:", kopf.persNr || "—"],
      ["Kostenstelle:", blatt.kostenstellen.join(", ") || "—"],
      ["Kalenderwoche:", `${blatt.kw} / ${blatt.jahr}`],
    ];
    let y = 36;
    doc.setFontSize(10);
    for (const [label, wert] of kopfZeilen) {
      doc.setFont("helvetica", "normal");
      doc.text(label, rand, y);
      doc.setFont("helvetica", "bold");
      doc.text(wert, rand + 38, y);
      doc.setLineWidth(0.2);
      doc.line(rand + 37, y + 1, rand + breite, y + 1);
      y += 7;
    }

    const spalten = blatt.tage
      .map((t, i) => ({ t, name: WOCHENTAGE[i] }))
      .filter(({ t, name }) => name !== "Sonntag" || t.stunden !== null);
    const rasterZeilen = Array.from({ length: RASTER_BIS - RASTER_VON + 1 }, (_, i) => RASTER_VON + i);
    const body: string[][] = [
      ["Datum", ...spalten.map(({ t }) => datumKurz(t.iso))],
      ["KST", ...spalten.map(({ t }) => t.kostenstellen.join(" "))],
      ...rasterZeilen.map((h) => [
        `${String(h).padStart(2, "0")}:00`,
        ...spalten.map(({ t }) => {
          const a = t.stunden ? anteilInStunde(h, t.beginn, t.stunden) : 0;
          return a > 0 && a < 1 ? zahl(a) : "";
        }),
      ]),
      [
        "Summe",
        ...spalten.map(({ t }) => (t.stunden === null ? "" : t.stunden > 0 ? fmtHNum(t.stunden) : "x")),
      ],
    ];
    autoTable(doc, {
      startY: y + 1,
      margin: { left: rand, right: rand },
      head: [["", ...spalten.map((s) => s.name)]],
      body,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 0.9, halign: "center", lineColor: [120, 120, 120], lineWidth: 0.15, textColor: [30, 30, 30] },
      headStyles: { fillColor: [255, 255, 255], textColor: [30, 30, 30], fontStyle: "normal" },
      columnStyles: {
        0: { halign: "left", cellWidth: 17 },
        ...Object.fromEntries(spalten.map((_, i) => [i + 1, { cellWidth: (breite - 17) / spalten.length }])),
      },
      didParseCell: (d) => {
        if (d.section !== "body") return;
        const zeile = d.row.index;
        if (zeile === 1) d.cell.styles.fontSize = 6.5;
        if (zeile === body.length - 1) d.cell.styles.fontStyle = "bold";
        if (zeile >= 2 && zeile < body.length - 1 && d.column.index > 0) {
          const t = spalten[d.column.index - 1].t;
          if (t.stunden && anteilInStunde(rasterZeilen[zeile - 2], t.beginn, t.stunden) > 0) {
            d.cell.styles.fillColor = [205, 205, 210];
          }
        }
      },
    });
    // @ts-ignore — lastAutoTable
    y = doc.lastAutoTable.finalY + 6;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Gesamt pro Woche:", rand, y);
    doc.setFont("helvetica", "bold");
    doc.text(`${fmtHNum(blatt.gesamt)} Std`, rand + 38, y);
    doc.setLineWidth(0.2);
    doc.line(rand + 37, y + 1, rand + 90, y + 1);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 95);
    const hinweis = blatt.tage.some((t) => t.stunden === 0)
      ? "Raster ab Arbeitsbeginn durchgezählt, in der App sind nur Stunden je Tag erfasst. x = Zulage ohne Stundenangabe."
      : "Raster ab Arbeitsbeginn durchgezählt, in der App sind nur Stunden je Tag erfasst.";
    doc.text(hinweis, rand, y);
    doc.setTextColor(30, 30, 30);
    y += 7;

    doc.setFontSize(10);
    doc.text("Tätigkeit lt. Kollektivvertrag § 6", rand, y);
    y += 5;
    doc.setFontSize(9);
    for (const { punkt, text } of KV_PUNKTE) {
      const gewaehlt = blatt.kvPunkt === punkt;
      doc.setFont("helvetica", gewaehlt ? "bold" : "normal");
      doc.rect(rand + 4, y - 2.8, 3, 3);
      if (gewaehlt) doc.text("x", rand + 4.8, y - 0.3);
      doc.text(`${punkt})  ${text}`, rand + 10, y);
      if (gewaehlt) doc.text(`(${blatt.bezeichnung})`, rand + 75, y);
      y += 4.6;
    }
    if (!blatt.kvPunkt) {
      doc.setFont("helvetica", "bold");
      doc.rect(rand + 4, y - 2.8, 3, 3);
      doc.text("x", rand + 4.8, y - 0.3);
      doc.text(blatt.bezeichnung, rand + 10, y);
      y += 4.6;
    }

    // Unterschriften: die Vorlage verlangt den Polier. Eine Polier-Unterschrift
    // gibt es in der App nicht und sie wird nicht nachgestellt; gedruckt werden
    // sein Name und die echten Unterschriften aus dem Stundenbericht.
    y += 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (kopf.istSelbstPolier) bild(doc, kopf.unterschrift, rand + 32, y);
    doc.line(rand + 32, y + 15, rand + breite, y + 15);
    doc.text("Unterschrift Polier:", rand, y + 14);
    if (kopf.polier) {
      doc.setFontSize(8);
      doc.text(kopf.polier, rand + 32, y + 18.5);
      doc.setFontSize(9);
    }
    y += 21;
    const spalte = (breite - 8) / 2;
    if (!kopf.istSelbstPolier) bild(doc, kopf.unterschrift, rand, y);
    bild(doc, kopf.geprueftUnterschrift, rand + spalte + 8, y);
    doc.line(rand, y + 15, rand + spalte, y + 15);
    doc.line(rand + spalte + 8, y + 15, rand + breite, y + 15);
    doc.setFontSize(8);
    doc.text(`Mitarbeiter lt. Stundenbericht${kopf.unterschriebenAm ? ` am ${kopf.unterschriebenAm}` : ""}`, rand, y + 18.5);
    doc.text(`geprüft lt. Stundenbericht${kopf.geprueftAm ? ` am ${kopf.geprueftAm}` : ""}`, rand + spalte + 8, y + 18.5);
  });
  return doc;
}

/**
 * Zettel einer Person für einen Zeitraum aus der Datenbank; null, wenn sie dort
 * keine Zulagen hat. Unterschriften kommen aus dem Stundenbericht (berichtId).
 */
export async function ladeZulagenZettel(opts: {
  mitarbeiterId: string;
  von: string;
  bis: string;
  berichtId?: string | null;
  bueroSignaturOverride?: string | null;
}): Promise<jsPDF | null> {
  const { data: tageRaw, error } = await supabase
    .from("stunden_tage")
    .select(
      "datum, arbeitsbeginn, zulagen:stunden_zulagen!inner(zulagen_typ_id, stunden), taetigkeiten:stunden_taetigkeiten(art, baustelle_id, ziel_baustelle_id)",
    )
    .eq("mitarbeiter_id", opts.mitarbeiterId)
    .gte("datum", opts.von)
    .lte("datum", opts.bis)
    .order("datum");
  if (error) throw error;
  const zeilen = (tageRaw ?? []) as any[];
  if (zeilen.length === 0) return null;

  const baustellenIds = [
    ...new Set(
      zeilen.flatMap((t) =>
        (t.taetigkeiten ?? [])
          .filter((x: any) => x.art === "baustelle" || x.art === "firma")
          .map((x: any) => x.ziel_baustelle_id ?? x.baustelle_id)
          .filter(Boolean),
      ),
    ),
  ] as string[];
  const [{ data: baustellen }, { data: typen }, { data: profil }, { data: bericht }] = await Promise.all([
    baustellenIds.length > 0
      ? supabase.from("baustellen").select("id, kostenstelle").in("id", baustellenIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("zulagen_typen").select("id, bezeichnung"),
    supabase
      .from("profiles")
      .select("vorname, nachname, pers_nr, partie_id")
      .eq("id", opts.mitarbeiterId)
      .maybeSingle(),
    opts.berichtId
      ? supabase
          .from("stunden_berichte")
          .select("unterschrift_data, unterschrieben_am, bestaetigt_unterschrift_data, bestaetigt_am")
          .eq("id", opts.berichtId)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);
  const kstById = new Map(((baustellen as any[]) ?? []).map((b) => [b.id as string, (b.kostenstelle as string) ?? ""]));
  const typById = new Map(((typen as any[]) ?? []).map((t) => [t.id as string, t.bezeichnung as string]));

  const blaetter = zulagenBlaetter(
    zeilen.map((t) => ({
      datum: t.datum,
      arbeitsbeginn: t.arbeitsbeginn,
      kostenstellen: [
        ...new Set(
          (t.taetigkeiten ?? [])
            .filter((x: any) => x.art === "baustelle" || x.art === "firma")
            .map((x: any) => kstById.get(x.ziel_baustelle_id ?? x.baustelle_id) ?? "")
            .filter(Boolean),
        ),
      ] as string[],
      zulagen: (t.zulagen ?? []).map((z: any) => ({
        typId: z.zulagen_typ_id,
        bezeichnung: typById.get(z.zulagen_typ_id) ?? "Zulage",
        stunden: z.stunden,
      })),
    })),
  );

  const p = profil as any;
  let polier: string | null = null;
  let istSelbstPolier = false;
  if (p?.partie_id) {
    const { data: partie } = await supabase
      .from("partien")
      .select("partieleiter_id")
      .eq("id", p.partie_id)
      .maybeSingle();
    const leiterId = (partie as any)?.partieleiter_id as string | undefined;
    if (leiterId === opts.mitarbeiterId) istSelbstPolier = true;
    if (leiterId) {
      const { data: leiter } = await supabase.from("profiles").select("vorname, nachname").eq("id", leiterId).maybeSingle();
      if (leiter) polier = `${(leiter as any).vorname ?? ""} ${(leiter as any).nachname ?? ""}`.trim() || null;
    }
  }
  const b = bericht as any;
  const datum = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("de-AT") : null);
  return makeErschwerniszulagePdf(blaetter, {
    name: `${p?.vorname ?? ""} ${p?.nachname ?? ""}`.trim() || "Mitarbeiter",
    persNr: p?.pers_nr ?? "",
    polier,
    istSelbstPolier,
    unterschrift: b?.unterschrift_data ?? null,
    unterschriebenAm: datum(b?.unterschrieben_am),
    geprueftUnterschrift: opts.bueroSignaturOverride ?? b?.bestaetigt_unterschrift_data ?? null,
    geprueftAm: datum(b?.bestaetigt_am) ?? (opts.bueroSignaturOverride ? new Date().toLocaleDateString("de-AT") : null),
  });
}
