/**
 * Was zu einem Stunden-/Tätigkeitsbericht mitgehört (J. Maurer, 04.11.2026):
 * der ausgefüllte Zulagen-Zettel und die Krankenzettel der Person in der
 * Periode. Gemeinsam für Archiv, Berichtsliste und Bericht.
 */

import { supabase } from "@/integrations/supabase/client";
import { ladeZulagenZettel } from "@/lib/erschwerniszulagePdf";
import { periodeFuer } from "@/lib/taetigkeitsbericht";

export interface ArchivPeriode {
  art: "taetigkeitsbericht" | "stundenbericht";
  jahr: number;
  monat: number;
  teil: number | null;
}

/** Zeitraum des Berichts: TB 21.–20., Stundenbericht Teil I 1.–16. / Teil II 17.–Ende. */
export function archivZeitraum(z: ArchivPeriode): { von: string; bis: string } {
  if (z.art === "taetigkeitsbericht") {
    const p = periodeFuer(z.jahr, z.monat);
    return { von: p.von, bis: p.bis };
  }
  const mm = String(z.monat).padStart(2, "0");
  const letzter = new Date(z.jahr, z.monat, 0).getDate();
  return z.teil === 2
    ? { von: `${z.jahr}-${mm}-17`, bis: `${z.jahr}-${mm}-${String(letzter).padStart(2, "0")}` }
    : { von: `${z.jahr}-${mm}-01`, bis: `${z.jahr}-${mm}-16` };
}

export interface BeilagenStand {
  zulagen: boolean;
  krankenzettel: number;
  /** Krankenstandstage der Periode, für die kein Zettel in der App liegt. */
  krankOhneZettel: number;
}

/**
 * Überblick je Mitarbeiter und Zeitraum, für die Zeilen im Archiv. Krankmeldungen
 * darf nur die Verwaltung lesen; ohne dieses Recht bleibt die Krank-Spalte leer,
 * statt einen fehlenden Zettel zu behaupten.
 */
export async function beilagenUebersicht(
  eintraege: { schluessel: string; mitarbeiterId: string; von: string; bis: string }[],
  mitKrank: boolean,
): Promise<Map<string, BeilagenStand>> {
  const stand = new Map<string, BeilagenStand>();
  if (eintraege.length === 0) return stand;
  const ids = [...new Set(eintraege.map((e) => e.mitarbeiterId))];
  const von = eintraege.reduce((m, e) => (e.von < m ? e.von : m), eintraege[0].von);
  const bis = eintraege.reduce((m, e) => (e.bis > m ? e.bis : m), eintraege[0].bis);

  const { data: zulagen } = await supabase
    .from("stunden_tage")
    .select("mitarbeiter_id, datum, zulagen:stunden_zulagen!inner(id)")
    .in("mitarbeiter_id", ids)
    .gte("datum", von)
    .lte("datum", bis)
    .limit(5000);

  let krankTage: { mitarbeiter_id: string; datum: string }[] = [];
  let meldungen: { mitarbeiter_id: string; von: string; bis: string; dokument_id: string }[] = [];
  if (mitKrank) {
    const [{ data: ganzeTage }, { data: teilTage }, { data: km }] = await Promise.all([
      supabase
        .from("stunden_tage")
        .select("mitarbeiter_id, datum")
        .in("mitarbeiter_id", ids)
        .eq("tag_status", "krank")
        .gte("datum", von)
        .lte("datum", bis)
        .limit(5000),
      supabase
        .from("stunden_tage")
        .select("mitarbeiter_id, datum, zeilen:stunden_taetigkeiten!inner(art)")
        .in("mitarbeiter_id", ids)
        .eq("zeilen.art", "krank")
        .gte("datum", von)
        .lte("datum", bis)
        .limit(5000),
      supabase
        .from("krankmeldungen")
        .select("mitarbeiter_id, von, bis, dokument_id")
        .in("mitarbeiter_id", ids)
        .lte("von", bis)
        .gte("bis", von)
        .not("dokument_id", "is", null),
    ]);
    krankTage = [...((ganzeTage as any[]) ?? []), ...((teilTage as any[]) ?? [])];
    meldungen = (km as any[]) ?? [];
  }

  for (const e of eintraege) {
    const imZeitraum = (x: { mitarbeiter_id: string; datum: string }) =>
      x.mitarbeiter_id === e.mitarbeiterId && x.datum >= e.von && x.datum <= e.bis;
    const eigene = meldungen.filter((m) => m.mitarbeiter_id === e.mitarbeiterId && m.von <= e.bis && m.bis >= e.von);
    const krank = new Set(krankTage.filter(imZeitraum).map((k) => k.datum));
    stand.set(e.schluessel, {
      zulagen: ((zulagen as any[]) ?? []).some(imZeitraum),
      krankenzettel: new Set(eigene.map((m) => m.dokument_id)).size,
      krankOhneZettel: [...krank].filter((d) => !eigene.some((m) => m.von <= d && m.bis >= d)).length,
    });
  }
  return stand;
}

export interface BeilagenDatei {
  name: string;
  inhalt: Blob;
}

/** Name wie im Mail-Versand (archiv-versenden): „Krankmeldung Name von bis bis.ext“. */
export async function ladeKrankenzettel(mitarbeiterId: string, von: string, bis: string): Promise<BeilagenDatei[]> {
  const { data, error } = await supabase
    .from("krankmeldungen")
    .select("von, bis, dokument_id, dokument:dokument_id(storage_path, dateiname), person:mitarbeiter_id(vorname, nachname)")
    .eq("mitarbeiter_id", mitarbeiterId)
    .lte("von", bis)
    .gte("bis", von)
    .not("dokument_id", "is", null);
  if (error) throw error;
  const dateien: BeilagenDatei[] = [];
  const gesehen = new Set<string>();
  for (const k of (data as any[]) ?? []) {
    if (!k.dokument?.storage_path || gesehen.has(k.dokument_id)) continue;
    gesehen.add(k.dokument_id);
    const { data: blob, error: dErr } = await supabase.storage.from("ma_dokumente").download(k.dokument.storage_path);
    if (dErr || !blob) throw dErr ?? new Error("Krankenzettel nicht gefunden");
    const ext = String(k.dokument.dateiname ?? k.dokument.storage_path).split(".").pop()?.toLowerCase() ?? "pdf";
    const wer = `${k.person?.vorname ?? ""} ${k.person?.nachname ?? ""}`.trim();
    const zeit = k.von === k.bis ? k.von : `${k.von} bis ${k.bis}`;
    dateien.push({ name: `Krankmeldung ${wer} ${zeit}.${ext}`.replace(/[\\/:*?"<>|]/g, "-"), inhalt: blob });
  }
  return dateien;
}

/** „Stundenbericht 2026-10 Teil II Max Muster.pdf“ → „Erschwerniszulage 2026-10 Teil II Max Muster.pdf“ */
export function zettelDateiname(berichtDatei: string): string {
  const name = berichtDatei.replace(/^(Stundenbericht|Tätigkeitsbericht|Taetigkeitsbericht|BSB)[ _]/, "");
  return `Erschwerniszulage ${name}`;
}

/** Zulagen-Zettel und Krankenzettel einer Person, fertig für ZIP/Download. */
export async function ladeBeilagen(opts: {
  mitarbeiterId: string;
  von: string;
  bis: string;
  berichtId?: string | null;
  berichtDatei: string;
}): Promise<BeilagenDatei[]> {
  const [zettel, krank] = await Promise.all([
    ladeZulagenZettel(opts),
    ladeKrankenzettel(opts.mitarbeiterId, opts.von, opts.bis),
  ]);
  const zettelDatei: BeilagenDatei[] = zettel
    ? [{ name: zettelDateiname(opts.berichtDatei), inhalt: zettel.output("blob") as Blob }]
    : [];
  return [...zettelDatei, ...krank];
}
