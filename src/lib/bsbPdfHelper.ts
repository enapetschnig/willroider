/**
 * Lädt einen einzelnen Baustellenstundenbericht inkl. aller Daten und
 * baut daraus das PDF — gemeinsam genutzt von der Detail-Seite (für
 * Download/Vorschau) und vom Versand-Dialog (Vorschau + Mail-Anhang).
 */

import { supabase } from "@/integrations/supabase/client";
import { localIso } from "@/lib/dateFmt";
import { fmtHNum } from "@/lib/zeiterfassung";
import {
  geaenderteTage,
  type BerichtSnapshot,
} from "@/lib/stundenBerichtDiff";
import { aggregiereZulagen } from "@/lib/stundenAggregation";
import {
  makeBaustellenstundenberichtPdf,
  type BsbPdfRow,
} from "@/lib/baustellenstundenberichtPdf";
import type { StundenTagFull } from "@/hooks/useStundenTag";
import type { TagStatus } from "@/integrations/supabase/types";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const STATUS_LABEL: Record<TagStatus, string> = {
  baustelle: "Baustelle",
  firma: "Firma",
  krank: "Krank",
  urlaub: "Urlaub",
  schlechtwetter: "Schlechtwetter",
  feiertag: "Feiertag",
};
const ABWESEND_KUERZEL: Partial<Record<TagStatus, string>> = {
  urlaub: "U",
  krank: "K",
  schlechtwetter: "SW",
  feiertag: "F",
};
const ART_ORDER: Record<TagStatus, number> = {
  baustelle: 0,
  firma: 1,
  urlaub: 2,
  krank: 3,
  schlechtwetter: 4,
  feiertag: 5,
};

interface RasterRow {
  key: string;
  art: TagStatus;
  label: string;
  kostenstelle: string;
  perDay: Map<string, number>;
}

export interface BuildBerichtPdfResult {
  doc: import("jspdf").default;
  fileName: string;
  maName: string;
}

/** Hauptfunktion: nimmt eine `stunden_berichte.id` und liefert das fertige
 *  PDF + den vorgeschlagenen Dateinamen + den Mitarbeiter-Namen. */
export async function buildBerichtPdf(
  berichtId: string,
): Promise<BuildBerichtPdfResult> {
  // 1) Bericht inkl. MA + Aenderungen
  const { data: bRaw, error: bErr } = await supabase
    .from("stunden_berichte")
    .select(
      `*, mitarbeiter:profiles!mitarbeiter_id(id, vorname, nachname, pers_nr)`,
    )
    .eq("id", berichtId)
    .single();
  if (bErr) throw bErr;
  const bericht = bRaw as any;

  // 2) Eintrittsdatum aus profile_konten_settings
  let eintrittsdatum: string | null = null;
  if (bericht.mitarbeiter_id) {
    const { data: pks } = await supabase
      .from("profile_konten_settings")
      .select("eintrittsdatum")
      .eq("profile_id", bericht.mitarbeiter_id)
      .maybeSingle();
    eintrittsdatum = (pks as any)?.eintrittsdatum ?? null;
  }

  // 3) Tage + Taetigkeiten + Zulagen + Fahrt
  const { data: tageRaw, error: tErr } = await supabase
    .from("stunden_tage")
    .select(
      `*,
       taetigkeiten:stunden_taetigkeiten(*),
       zulagen:stunden_zulagen(*),
       fahrt:stunden_fahrt(*)`,
    )
    .eq("mitarbeiter_id", bericht.mitarbeiter_id)
    .gte("datum", bericht.von_datum)
    .lte("datum", bericht.bis_datum)
    .order("datum");
  if (tErr) throw tErr;
  const tage: StundenTagFull[] = (tageRaw ?? []).map((t: any) => ({
    tag: t,
    taetigkeiten: t.taetigkeiten ?? [],
    zulagen: t.zulagen ?? [],
    fahrt: Array.isArray(t.fahrt) ? t.fahrt[0] ?? null : t.fahrt ?? null,
  }));

  // 4) Baustellen-Map
  const { data: bs } = await supabase
    .from("baustellen")
    .select("id, bvh_name, kostenstelle");
  const baustelleMap = new Map(
    ((bs as any[]) ?? []).map((b) => [b.id as string, b]),
  );

  // 5) Zulagen-Typen
  const { data: zt } = await supabase
    .from("zulagen_typen")
    .select("id, bezeichnung");

  // 6) Raster aufbauen (Baustelle x Tag)
  const periodeTage: { iso: string; tag: number; wd: string; frei: boolean }[] =
    [];
  const d = new Date(bericht.von_datum + "T00:00:00");
  const end = new Date(bericht.bis_datum + "T00:00:00");
  while (d <= end) {
    const dow = d.getDay();
    periodeTage.push({
      iso: localIso(d),
      tag: d.getDate(),
      wd: WD[dow],
      frei: dow === 0 || dow === 6,
    });
    d.setDate(d.getDate() + 1);
  }

  const rowsMap = new Map<string, RasterRow>();
  for (const t of tage) {
    for (const e of t.taetigkeiten as any[]) {
      let key: string;
      let label: string;
      let kst = "";
      if (e.art === "baustelle") {
        key = `b:${e.baustelle_id ?? "none"}`;
        const b = e.baustelle_id ? baustelleMap.get(e.baustelle_id) : null;
        label = (b as any)?.bvh_name ?? "Baustelle";
        kst = (b as any)?.kostenstelle ?? "";
      } else if (e.art === "firma") {
        key = "firma";
        label = "Firma";
      } else {
        key = e.art;
        label = STATUS_LABEL[e.art as TagStatus];
      }
      let row = rowsMap.get(key);
      if (!row) {
        row = {
          key,
          art: e.art,
          label,
          kostenstelle: kst,
          perDay: new Map(),
        };
        rowsMap.set(key, row);
      }
      row.perDay.set(
        t.tag.datum,
        (row.perDay.get(t.tag.datum) ?? 0) + Number(e.stunden || 0),
      );
    }
  }
  const rows = [...rowsMap.values()].sort(
    (a, b) =>
      ART_ORDER[a.art] - ART_ORDER[b.art] || a.label.localeCompare(b.label),
  );

  // 7) Diff + Zulagen-Aggregation
  const geaendert = geaenderteTage(
    bericht.snapshot as BerichtSnapshot | undefined,
    tage,
  );
  const zulagenAgg = aggregiereZulagen(tage, (zt as any[]) ?? []);

  // 8) BsbPdfInput zusammenbauen (gleicher Code-Pfad wie StundenBericht.tsx)
  const pdfRows: BsbPdfRow[] = rows.map((row) => {
    const arbeit = row.art === "baustelle" || row.art === "firma";
    return {
      kostenstelle: row.kostenstelle,
      baustelle: row.label,
      zellen: periodeTage.map((d) => {
        const v = row.perDay.get(d.iso);
        return v === undefined
          ? ""
          : arbeit
            ? fmtHNum(v)
            : (ABWESEND_KUERZEL[row.art] ?? "✓");
      }),
      summe: arbeit
        ? fmtHNum([...row.perDay.values()].reduce((s, v) => s + v, 0))
        : "",
    };
  });
  const summenZeile = periodeTage.map((dd) => {
    let s = 0;
    for (const r of rows) {
      if (r.art === "baustelle" || r.art === "firma")
        s += r.perDay.get(dd.iso) ?? 0;
    }
    return s > 0 ? fmtHNum(s) : "";
  });
  const summeGesamt = fmtHNum(
    rows
      .filter((r) => r.art === "baustelle" || r.art === "firma")
      .reduce(
        (s, r) => s + [...r.perDay.values()].reduce((a, v) => a + v, 0),
        0,
      ),
  );

  const monatName = new Date(
    bericht.jahr,
    bericht.monat - 1,
    1,
  ).toLocaleDateString("de-AT", { month: "long" });
  const maName = bericht.mitarbeiter
    ? `${bericht.mitarbeiter.vorname ?? ""} ${bericht.mitarbeiter.nachname ?? ""}`.trim()
    : "Mitarbeiter";

  const doc = await makeBaustellenstundenberichtPdf({
    teilLabel:
      bericht.teil === 1
        ? "Teil I v. 1. bis 16."
        : "Teil II v. 17. bis Monatsende",
    monat: monatName,
    jahr: bericht.jahr,
    name: maName,
    persNr: bericht.mitarbeiter?.pers_nr ?? "",
    eintritt: eintrittsdatum
      ? new Date(eintrittsdatum).toLocaleDateString("de-AT")
      : "",
    austritt: "",
    tage: periodeTage.map((d) => d.tag),
    tageIso: periodeTage.map((d) => d.iso),
    geaendert,
    rows: pdfRows,
    summenZeile,
    summeGesamt,
    zulagen: zulagenAgg.map(
      (z) => `${z.bezeichnung} ${fmtHNum(z.summe_stunden)} h`,
    ),
    unterschrift: bericht.unterschrift_data,
    unterschriebenAm: bericht.unterschrieben_am
      ? new Date(bericht.unterschrieben_am).toLocaleDateString("de-AT")
      : null,
    bestaetigtAm: bericht.bestaetigt_am
      ? new Date(bericht.bestaetigt_am).toLocaleDateString("de-AT")
      : null,
  });

  const safeNa = maName.replace(/[^a-zA-Z0-9-]+/g, "_");
  const fileName = `BSB_${safeNa}_${bericht.jahr}-${String(bericht.monat).padStart(2, "0")}_Teil${bericht.teil}.pdf`;

  return { doc, fileName, maName };
}
