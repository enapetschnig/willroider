/**
 * Normalisiert eine österreichische Telefonnummer auf E.164-Format (+43...).
 *
 * Akzeptiert verschiedene Eingabe-Varianten:
 * - "+43 664 123 4567"   -> "+436641234567"
 * - "0664/1234567"        -> "+436641234567"
 * - "0043-664-1234567"    -> "+436641234567"
 * - "664 123 4567"        -> "+436641234567" (assumiert AT-Mobilnetz)
 *
 * @param input Eingabe-String (oder null/undefined)
 * @param defaultCountryCode Vorwahl ohne "+" (Default "43" = Österreich)
 * @returns E.164-String oder null wenn nicht parsebar
 */
export function normalizeAtPhone(
  input: string | null | undefined,
  defaultCountryCode = "43",
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Trenner entfernen
  const cleaned = trimmed.replace(/[\s\-()/.]/g, "");
  if (!cleaned) return null;

  // Internationales Format
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (!/^\d{6,15}$/.test(digits)) return null;
    return `+${digits}`;
  }

  // 0049... / 0043... → ersetze 00 durch +
  if (cleaned.startsWith("00")) {
    const digits = cleaned.slice(2);
    if (!/^\d{6,15}$/.test(digits)) return null;
    return `+${digits}`;
  }

  // Inlands-Format mit führender 0 (z.B. 0664 → +43664)
  if (cleaned.startsWith("0")) {
    const digits = cleaned.slice(1);
    if (!/^\d{5,14}$/.test(digits)) return null;
    return `+${defaultCountryCode}${digits}`;
  }

  // Reine Ziffern ohne führende 0 — assumiere AT und prefixe +43
  if (/^\d{5,14}$/.test(cleaned)) {
    return `+${defaultCountryCode}${cleaned}`;
  }

  return null;
}

/**
 * Prüft, ob ein Eingabe-String als gültige Telefonnummer normalisiert werden kann.
 */
export function isValidAtPhone(input: string | null | undefined): boolean {
  return normalizeAtPhone(input) !== null;
}
