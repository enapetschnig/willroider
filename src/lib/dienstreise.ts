// Auto-Berechnung Taggeld nach Bau-KV § 9 I Z 4
// (Holzbau-Willroider fällt unter Bau-KV — Sätze 12,60 / 20,30 / 33,60 / 16,90)

export type AutoTaggeldInput = {
  arbeitsstunden: number;
  fahrstunden: number;
  inFirma: boolean;
  isFehlzeit: boolean;
};

export type AutoTaggeldResult = { kurz: number; lang: number };

/**
 * Bau-KV § 9 I Z 4 — Taggeld kurz/lang pro Tag:
 * - in Firma oder Fehlzeit → 0/0
 * - Außendienst ≤ 3 h (arbeit + fahrt) → 0/0
 * - Arbeitszeit ≤ 9 h → 1× kurz (lit a, 12,60 €)
 * - Arbeitszeit  > 9 h → 1× lang (lit b, 20,30 €)
 * Übernachtung (§ 9 I Z 5 = 33,60 € und § 9 II Z 1 = 16,90 €/Nacht) ist hier
 * bewusst nicht abgedeckt.
 */
export function autoTaggeld(i: AutoTaggeldInput): AutoTaggeldResult {
  if (i.isFehlzeit || i.inFirma) return { kurz: 0, lang: 0 };
  const arbeit = i.arbeitsstunden ?? 0;
  const fahrt = i.fahrstunden ?? 0;
  if (arbeit + fahrt <= 3) return { kurz: 0, lang: 0 };
  if (arbeit <= 9) return { kurz: 1, lang: 0 };
  return { kurz: 0, lang: 1 };
}

/** Menschenlesbare Begründung für die Auto-Logik (für UI-Hinweis). */
export function autoTaggeldReason(i: AutoTaggeldInput): string {
  if (i.isFehlzeit) return "Fehlzeit — keine Diäten";
  if (i.inFirma) return "In Firma — keine Diäten";
  const arbeit = i.arbeitsstunden ?? 0;
  const fahrt = i.fahrstunden ?? 0;
  const aussen = arbeit + fahrt;
  if (aussen <= 3)
    return `Außendienst nur ${aussen.toFixed(1)} h (≤ 3 h) — keine Diäten`;
  if (arbeit <= 9)
    return `1× Taggeld kurz (Arbeit ${arbeit.toFixed(1)} h ≤ 9 h)`;
  return `1× Taggeld lang (Arbeit ${arbeit.toFixed(1)} h > 9 h)`;
}
