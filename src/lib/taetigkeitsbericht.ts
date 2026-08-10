/**
 * Tätigkeitsbericht — Fachlogik der Angestellten-Zeiterfassung.
 *
 * Nachbau der alten Excel `Tätigkeitsbericht_Jän-Dez_2026.xlsx`:
 * eine Matrix Kostenstelle × Tag, Periode vom 21. des Vormonats bis zum 20.
 *
 * Gespeichert wird in denselben Tabellen wie die herkömmliche Erfassung
 * (`stunden_tage` + `stunden_taetigkeiten`) — kein zweiter Datentopf, damit
 * Auswertung, Monatsabschluss sowie ZA- und Urlaubskonto weiter mitrechnen.
 */

import { supabase } from "@/integrations/supabase/client";
import { feiertagAt, betrieblichFreiAt, type FeiertagInfo } from "@/lib/feiertage";

// ─── Periode 21.–20. ───────────────────────────────────────────────────

/** Eine Abrechnungsperiode: 21. des Vormonats bis 20. des Monats. */
export interface Periode {
  /** Der Monat, nach dem die Periode benannt ist (1–12). */
  monat: number;
  jahr: number;
  /** ISO-Datum des ersten Tages (immer ein 21.). */
  von: string;
  /** ISO-Datum des letzten Tages (immer ein 20.). */
  bis: string;
  /** Alle Tage der Periode, aufsteigend. */
  tage: string[];
}

const MONATE = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
/** Mo=0 … So=6 */
export const WOCHENTAG_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (jahr: number, monat: number, tag: number) =>
  `${jahr}-${pad(monat)}-${pad(tag)}`;

/** Wochentag-Index mit Montag = 0 (wie `stundenTime.weekdayIndexMonFirst`). */
export function wochentagIndex(isoDatum: string): number {
  const d = new Date(`${isoDatum}T00:00:00`).getDay(); // 0 = So
  return (d + 6) % 7;
}

/**
 * Baut die Periode, die nach (jahr, monat) benannt ist:
 * `periodeFuer(2026, 2)` → 21.01.2026 – 20.02.2026, Titel „Jänner - Februar 2026".
 */
export function periodeFuer(jahr: number, monat: number): Periode {
  const vonMonat = monat === 1 ? 12 : monat - 1;
  const vonJahr = monat === 1 ? jahr - 1 : jahr;
  const von = iso(vonJahr, vonMonat, 21);
  const bis = iso(jahr, monat, 20);

  const tage: string[] = [];
  const d = new Date(`${von}T00:00:00`);
  const ende = new Date(`${bis}T00:00:00`);
  while (d <= ende) {
    tage.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    d.setDate(d.getDate() + 1);
  }
  return { monat, jahr, von, bis, tage };
}

/** Die Periode, in die ein Datum fällt. Ab dem 21. zählt schon der Folgemonat. */
export function periodeVonDatum(isoDatum: string): Periode {
  const jahr = Number(isoDatum.slice(0, 4));
  const monat = Number(isoDatum.slice(5, 7));
  const tag = Number(isoDatum.slice(8, 10));
  if (tag <= 20) return periodeFuer(jahr, monat);
  return monat === 12 ? periodeFuer(jahr + 1, 1) : periodeFuer(jahr, monat + 1);
}

export function periodeVerschieben(p: Periode, schritte: number): Periode {
  const n = p.jahr * 12 + (p.monat - 1) + schritte;
  return periodeFuer(Math.floor(n / 12), (n % 12) + 1);
}

/**
 * Kopfzeile wie in der Excel: „Jänner - Februar 2026".
 * Über den Jahreswechsel schreibt die Excel „Dez.25 - Jän. 2026" — hier
 * einheitlich mit beiden Jahren, das ist eindeutiger.
 */
/** Fahrtdauer in Stunden aus Abfahrt/Ankunft („08:30" → „12:15" = 3,75). */
export function fahrtDauerH(abfahrt: string | null, ankunft: string | null): number {
  if (!abfahrt || !ankunft) return 0;
  const [ah, am] = abfahrt.split(":").map(Number);
  const [bh, bm] = ankunft.split(":").map(Number);
  const diff = bh * 60 + bm - (ah * 60 + am);
  return diff > 0 ? r2(diff / 60) : 0;
}

/** Kurzlabel der Periode fürs Fahrtenbuch/Lohnbüro: „Mai-Juni". */
export function periodeKurz(p: Periode): string {
  const vonMonat = p.monat === 1 ? 12 : p.monat - 1;
  return `${MONATE[vonMonat - 1]}-${MONATE[p.monat - 1]}`;
}

export function periodeTitel(p: Periode): string {
  const vonMonat = p.monat === 1 ? 12 : p.monat - 1;
  const vonJahr = p.monat === 1 ? p.jahr - 1 : p.jahr;
  if (vonJahr !== p.jahr) {
    return `${MONATE[vonMonat - 1]} ${vonJahr} - ${MONATE[p.monat - 1]} ${p.jahr}`;
  }
  return `${MONATE[vonMonat - 1]} - ${MONATE[p.monat - 1]} ${p.jahr}`;
}

// ─── Soll-Stunden ──────────────────────────────────────────────────────

/**
 * Wochenbild der Angestellten: 8,5 h Mo–Do, 5 h Fr, Wochenende frei = 39 h.
 * Entspricht Zeile „Sollstunden/Tag" der Excel.
 */
export const ANGESTELLTEN_SOLL = [8.5, 8.5, 8.5, 8.5, 5, 0, 0] as const;

/**
 * Farbwelt der Excel-Vorlage (Tätigkeitsbericht_Vorlage.xlsx), aus der
 * Datei ausgelesen — Bildschirm und PDF greifen auf DIESELBEN Werte zu,
 * damit beide gleich aussehen.
 */
export const TB_FARBEN = {
  /** Titelband „TÄTIGKEITSBERICHT" */
  titel: "#c0c0c0",
  /** Eingabefelder (Name, Fahrer, Kennzeichen) */
  eingabe: "#ffffcc",
  /** Samstag — 15 % Grau */
  samstag: "#d9d9d9",
  /** Sonntag und Feiertag — 35 % Grau, über die GANZE Spalte */
  sonnFeiertag: "#a6a6a6",
  /** Zwischensummen-Zeile */
  zwischensumme: "#d6e4f0",
  /** Stundensumme/Tag und GESAMT km */
  stundensumme: "#e2efda",
  /** Fahrtenbuch: Titelband (Schrift weiß) */
  fahrtenbuchTitel: "#1f3864",
  /** Fahrtenbuch: Kopfzeile (Schrift weiß) */
  fahrtenbuchKopf: "#2e75b6",
} as const;

/**
 * Spaltenfarbe eines Tages: Feiertag und Sonntag dunkel, Samstag hell —
 * wie in der Vorlage über die gesamte Spalte, von der Kopfzeile bis zur
 * letzten Summenzeile.
 */
export function tagSpaltenFarbe(isoDatum: string): string | undefined {
  if (tagesBeschriftung(isoDatum)) return TB_FARBEN.sonnFeiertag;
  const wt = wochentagIndex(isoDatum);
  if (wt === 6) return TB_FARBEN.sonnFeiertag;
  if (wt === 5) return TB_FARBEN.samstag;
  return undefined;
}

/**
 * Tages-Soll eines Angestellten.
 *
 * Feiertage senken das Soll **nicht** — genau wie in der Excel: dort steht am
 * 25.12. ein Soll von 8,5, und die Feiertag-Zeile liefert die 8,5 Stunden
 * dazu, wodurch DELTA null wird. Urlaub, Krankheit und Feiertag zählen also
 * als geleistete Zeit gegen das volle Soll.
 */
export function angestelltenSoll(isoDatum: string): number {
  return ANGESTELLTEN_SOLL[wochentagIndex(isoDatum)];
}

/** Beschriftung über der Tagesspalte: gesetzlicher Feiertag oder 24./31.12. */
export function tagesBeschriftung(isoDatum: string): FeiertagInfo | null {
  return feiertagAt(isoDatum) ?? betrieblichFreiAt(isoDatum);
}

// ─── Zeilen der Matrix ─────────────────────────────────────────────────

/** Eine wählbare Zeile: Baustelle oder interne Kostenstelle. */
export interface BerichtZeile {
  /** Stabiler Schlüssel: `bs:<uuid>` oder `int:<uuid>`. */
  key: string;
  /** 4-stellige Kostenstelle, wie in der Excel. Leer, wenn nicht gepflegt. */
  kst: string;
  bezeichnung: string;
  /** Gesetzt bei Baustellen-Zeilen. */
  baustelleId: string | null;
  /** Gesetzt bei internen Kostenstellen (`taetigkeiten_stamm`). */
  taetigkeitId: string | null;
  /** `baustelle` bringt Taggeld-Anspruch, `firma` nicht. */
  art: "baustelle" | "firma";
}

/**
 * Zieht die 4-stellige Kostenstelle aus dem langen Projektschlüssel:
 * `1404020-2601` → `4020`, `1404450` → `4450`.
 *
 * Genau diese vier Stellen stehen in der Excel-Spalte „Kst".
 */
export function kstAusKostenstelle(lang: string | null | undefined): string {
  if (!lang) return "";
  const m = /^140(\d{4})/.exec(lang);
  return m ? m[1] : lang;
}

/**
 * Alle wählbaren Zeilen: aktive und geplante Baustellen plus die internen
 * Kostenstellen aus `taetigkeiten_stamm` (bereich = 'buero').
 * Sortierung: interne zuerst (wie in der Excel), dann Baustellen nach Kst.
 */
export async function ladeBerichtZeilen(): Promise<BerichtZeile[]> {
  const [{ data: bs }, { data: intern }] = await Promise.all([
    supabase
      .from("baustellen")
      .select("id, bvh_name, kostenstelle, status")
      .in("status", ["aktiv", "geplant"]),
    supabase
      .from("taetigkeiten_stamm")
      .select("id, bezeichnung, kostenstelle, sort_order, is_active, bereich" as "*")
      .eq("bereich", "buero"),
  ]);

  const internZeilen: BerichtZeile[] = ((intern as any[]) ?? [])
    .filter((t) => t.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((t) => ({
      key: `int:${t.id}`,
      kst: t.kostenstelle ?? "",
      bezeichnung: t.bezeichnung,
      baustelleId: null,
      taetigkeitId: t.id,
      art: "firma" as const,
    }));

  const bsZeilen: BerichtZeile[] = ((bs as any[]) ?? [])
    .map((b) => ({
      key: `bs:${b.id}`,
      kst: kstAusKostenstelle(b.kostenstelle),
      bezeichnung: b.bvh_name ?? "(ohne Namen)",
      baustelleId: b.id as string,
      taetigkeitId: null,
      art: "baustelle" as const,
    }))
    .sort((a, b) => a.kst.localeCompare(b.kst) || a.bezeichnung.localeCompare(b.bezeichnung));

  return [...internZeilen, ...bsZeilen];
}

// ─── Summen (die Zeilen 28–40 der Excel) ───────────────────────────────

export interface BerichtSummen {
  /** Zeile 28 — Spaltensummen der Kostenstellen-Zeilen. */
  zwischensumme: Record<string, number>;
  zwischensummeGesamt: number;
  /** Zeile 33 — Zwischensumme + Urlaub + Sonderurlaub + Krankheit + Feiertag. */
  stundensumme: Record<string, number>;
  stundensummeGesamt: number;
  /** Zeile 34 */
  soll: Record<string, number>;
  sollGesamt: number;
  /** Zeile 35 */
  delta: Record<string, number>;
  deltaGesamt: number;
}

/** Auf zwei Stellen runden — verhindert 0.30000000000000004 in den Summen. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rechnet die Summenzeilen der Excel nach.
 *
 * @param tage      die Tage der Periode
 * @param zellen    `zellen[zeilenKey][iso]` = Stunden der Kostenstellen-Zeilen
 * @param sonder    die Abwesenheitszeilen: `sonder[art][iso]` mit
 *                  art ∈ urlaub | sonderurlaub | krankheit | feiertag
 */
export function berechneSummen(
  tage: string[],
  zellen: Record<string, Record<string, number>>,
  sonder: Record<string, Record<string, number>>,
): BerichtSummen {
  const zwischensumme: Record<string, number> = {};
  const stundensumme: Record<string, number> = {};
  const soll: Record<string, number> = {};
  const delta: Record<string, number> = {};

  for (const t of tage) {
    let zs = 0;
    for (const zeile of Object.values(zellen)) zs += zeile[t] ?? 0;
    zwischensumme[t] = r2(zs);

    let abw = 0;
    for (const art of Object.values(sonder)) abw += art[t] ?? 0;
    stundensumme[t] = r2(zs + abw);

    soll[t] = angestelltenSoll(t);
    delta[t] = r2(stundensumme[t] - soll[t]);
  }

  const sum = (m: Record<string, number>) => r2(tage.reduce((a, t) => a + (m[t] ?? 0), 0));
  return {
    zwischensumme,
    zwischensummeGesamt: sum(zwischensumme),
    stundensumme,
    stundensummeGesamt: sum(stundensumme),
    soll,
    sollGesamt: sum(soll),
    delta,
    deltaGesamt: sum(delta),
  };
}

/**
 * Der Warnhinweis aus Zeile 36 der Excel — dort per Formel
 * `IF(AH35>15; "…"; "")` an das Perioden-DELTA gebunden.
 */
export const UEBERSTUNDEN_WARNUNG =
  "Überstunden bitte nur im Rahmen der Überstundenpauschale bzw. auf ausdrückliche Anweisung leisten";
export const UEBERSTUNDEN_GRENZE = 15;
