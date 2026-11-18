/**
 * Letzte Position je Menüpunkt (E. Winkler 18.11.2026, „wie im Explorer“):
 * Wer in Baustellen → Baustelle → Dokumente → Ordner war, zu „Pläne“ wechselt
 * und wieder auf „Baustellen“ tippt, landet wieder im Ordner.
 *
 * - Gemerkt wird Pfad + Suchteil der URL (Reiter, Ordner usw. stehen dort).
 * - Nur für diese Sitzung (sessionStorage) und je Benutzer — beim Abmelden weg.
 * - Seiten ohne eigenen Menüpunkt (z. B. /stundenbericht/…, /evaluierung)
 *   zählen zu dem Menüpunkt, aus dem man gekommen ist.
 */
const PREFIX = "willroider:menuPos:";

/** Menüpunkt, zu dem ein Pfad gehört (längste passende Wurzel), sonst null. */
export function bereichFuer(pfad: string, wurzeln: string[]): string | null {
  let best: string | null = null;
  for (const w of wurzeln) {
    const passt = pfad === w || (w !== "/" && pfad.startsWith(w + "/"));
    if (passt && (!best || w.length > best.length)) best = w;
  }
  return best;
}

function lesen(userId: string): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(PREFIX + userId) || "{}");
  } catch {
    return {};
  }
}

export function positionMerken(userId: string, bereich: string, ziel: string) {
  try {
    const m = lesen(userId);
    if (m[bereich] === ziel) return;
    m[bereich] = ziel;
    sessionStorage.setItem(PREFIX + userId, JSON.stringify(m));
  } catch {
    /* privater Modus o. Ä. — dann eben ohne Gedächtnis */
  }
}

export function gemerktePosition(userId: string, bereich: string): string | null {
  return lesen(userId)[bereich] ?? null;
}

/** Eine gemerkte Position verwerfen (z. B. Baustelle gibt es nicht mehr). */
export function positionVergessen(userId: string, bereich: string) {
  try {
    const m = lesen(userId);
    delete m[bereich];
    sessionStorage.setItem(PREFIX + userId, JSON.stringify(m));
  } catch {
    /* egal */
  }
}

export function gedaechtnisLeeren() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    /* egal */
  }
}

/** Merkt im Verlaufseintrag, dass man über die gemerkte Position (Menü) hierherkam. */
export type MenueZustand = { ausMenue?: boolean; bereich?: string };
export function menueZustand(): MenueZustand | null {
  return ((window.history.state as { usr?: MenueZustand } | null)?.usr as MenueZustand) ?? null;
}

/** Zurück-Knopf einer Unterseite: wie bisher im Verlauf zurück — außer man kam über die
 *  gemerkte Position aus einem anderen Menüpunkt hierher; dann zur Übersicht (`ersatz`,
 *  ohne Angabe: Wurzel des Menüpunkts). */
export function zurueck(navigate: (ziel: string | number) => void, ersatz?: string) {
  const z = menueZustand();
  if (z?.ausMenue) navigate(ersatz ?? z.bereich ?? "/");
  else if (window.history.length > 1) navigate(-1);
  else navigate(ersatz ?? "/");
}

/** Suchparameter der aktuellen Adresse ändern (ohne neuen Verlaufseintrag). Liest die
 *  echte aktuelle Adresse, damit sich zwei Komponenten nicht gegenseitig überschreiben. */
export function suchParameterSetzen(
  navigate: (to: { pathname: string; search: string; hash: string }, opts: { replace: boolean; state: unknown }) => void,
  aenderungen: Record<string, string | null>,
) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(aenderungen)) {
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const neu = p.toString();
  const alt = window.location.search.replace(/^\?/, "");
  if (neu === alt) return;
  navigate(
    { pathname: window.location.pathname, search: neu ? `?${neu}` : "", hash: window.location.hash },
    { replace: true, state: (window.history.state as { usr?: unknown } | null)?.usr ?? null },
  );
}
