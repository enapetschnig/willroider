/**
 * Zentrale Berechnungslogik für die Zeiterfassung (Phase A).
 *
 * Wichtigster Punkt: `netto_stunden` ist das, was der Mitarbeiter eingibt — also
 * die TATSÄCHLICHE Arbeitszeit, OHNE Pausen. Die Pausen-Dauern werden über die
 * Toggles `vm_pause` / `mittag_pause` und die Stammdaten aus `pausen_config`
 * ADDIERT, um die Anwesenheit am Arbeitsplatz zu erhalten.
 *
 * Beispiel: Arbeitsbeginn 07:00, 9,5 h netto, VM-Pause 20 min, Mittag 30 min
 *   → Brutto-Anwesenheit = 9,5 h + 50 min = 10,33 h
 *   → von 07:00 bis 17:20
 *
 * Diese Datei ist die EINZIGE Stelle, an der Pausen + Brutto + Von-Bis
 * berechnet werden — Stundenauswertung, PDF-Reports und Lohn-Export ziehen
 * sich die Zahlen alle von hier.
 */

export interface TagZeiten {
  /** Tatsächlich gearbeitete Stunden (Eingabe, ohne Pausen). */
  nettoArbeit: number;
  /** Summe aller aktivierten Pausen in Minuten. */
  pausenMinuten: number;
  /** Anwesenheit am Arbeitsplatz = netto + pausen/60. */
  bruttoAnwesenheit: number;
  /** Beginn — HH:MM. */
  von: string;
  /** Ende — HH:MM (kann ≥ 24:00 sein bei langen Tagen; wir cap nicht). */
  bis: string;
}

export interface PausenConfig {
  vmDauerMin: number;
  mittagDauerMin: number;
}

export interface ArbeitszeitLimits {
  maxNettoProTag: number;
  maxBruttoProTag: number;
  arbeitsbeginnDefault: string; // "HH:MM"
}

export interface BerechneTagInput {
  nettoStunden: number;
  /** Pausen-Felder werden nicht mehr genutzt (Brutto = Netto), bleiben aber
   *  optional erhalten, damit Altaufrufer kompilieren. */
  vmPause?: boolean;
  mittagPause?: boolean;
  pausenConfig?: PausenConfig;
  arbeitsbeginn: string; // "HH:MM"
}

function parseHHMM(s: string): { h: number; m: number } | null {
  if (!s || typeof s !== "string") return null;
  const parts = s.slice(0, 5).split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h, m };
}

function minutesToHHMM(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Zentrale Berechnung. Defensiv gegen leere/ungültige Eingaben.
 */
export function berechneTagZeiten(input: BerechneTagInput): TagZeiten {
  const netto = Math.max(0, Number(input.nettoStunden) || 0);
  // Pausen werden nicht mehr aufgeschlagen — der Mitarbeiter gibt die reine
  // Arbeitszeit ein, Brutto-Anwesenheit = Netto.
  const pausenMinuten = 0;
  const bruttoAnwesenheit = netto;

  const start = parseHHMM(input.arbeitsbeginn) ?? { h: 7, m: 0 };
  const startMin = start.h * 60 + start.m;
  const endMin = startMin + Math.round(bruttoAnwesenheit * 60);

  return {
    nettoArbeit: netto,
    pausenMinuten,
    bruttoAnwesenheit,
    von: minutesToHHMM(startMin),
    bis: minutesToHHMM(endMin),
  };
}

/**
 * Überstunden-Berechnung gegen das Tages-Soll des Mitarbeiters.
 */
export function ueberstundenForTag(
  zeiten: TagZeiten,
  sollStunden: number,
): { diff: number; istUeberstunde: boolean } {
  const diff = zeiten.nettoArbeit - Math.max(0, Number(sollStunden) || 0);
  return { diff, istUeberstunde: diff > 0 };
}

/**
 * Arbeitszeitgesetz-Check (Österreich): Standard-Limits.
 */
export function pruefArbeitszeitGesetz(
  zeiten: TagZeiten,
  limits: ArbeitszeitLimits,
): { ok: boolean; meldung?: string } {
  if (zeiten.nettoArbeit > limits.maxNettoProTag) {
    return {
      ok: false,
      meldung: `Netto-Arbeitszeit ${fmtH(zeiten.nettoArbeit)} überschreitet die zulässige Tagesgrenze von ${fmtH(
        limits.maxNettoProTag,
      )}.`,
    };
  }
  if (zeiten.bruttoAnwesenheit > limits.maxBruttoProTag) {
    return {
      ok: false,
      meldung: `Anwesenheit ${fmtH(zeiten.bruttoAnwesenheit)} überschreitet die zulässige Tagesgrenze von ${fmtH(
        limits.maxBruttoProTag,
      )}.`,
    };
  }
  return { ok: true };
}

/** Stunden-Format mit Komma: 9.5 → "9,50 h". */
export function fmtH(n: number): string {
  return `${(Number(n) || 0).toFixed(2).replace(".", ",")} h`;
}

/** Stunden-Format mit Komma ohne Einheit: 9.5 → "9,50". */
export function fmtHNum(n: number): string {
  return (Number(n) || 0).toFixed(2).replace(".", ",");
}
