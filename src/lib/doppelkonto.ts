/**
 * Doppelkonto erkennen: Eine neue Selbst-Registrierung, zu der es schon
 * einen aktiven Mitarbeiter mit gleichem Nachnamen und passendem Vornamen
 * gibt (Vorfall 16.10.2026: „Matthias Fischer" meldete sich mit E-Mail neu
 * an, obwohl „Matthias Franz Fischer" längst freigeschaltet war — er meldet
 * sich per Telefonnummer an). Wer die neue Anmeldung freischaltet, hätte
 * zwei Mitarbeiter-Einträge.
 */
type Person = { id: string; vorname: string | null; nachname: string | null };

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function findeDoppelkonto<T extends Person>(neu: Person, aktive: T[]): T | null {
  const nach = norm(neu.nachname);
  const vor = norm(neu.vorname).split(" ")[0];
  if (!nach || !vor) return null;
  return (
    aktive.find((a) => {
      if (a.id === neu.id || norm(a.nachname) !== nach) return false;
      const v = norm(a.vorname);
      return v.split(" ")[0] === vor || v.includes(vor) || vor.includes(v.split(" ")[0] || "#");
    }) ?? null
  );
}
