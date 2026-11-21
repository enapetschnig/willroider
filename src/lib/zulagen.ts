// Erschwerniszulagen lt. Kollektivvertrag § 6 — die in der Praxis genutzten
// Codes als Auswahl. Vollständige KV-Liste hat 9 Punkte (a, d, f, g, h, j, k,
// m, n); Holzbau Willroider verwendet faktisch nur Aufsicht, Schmutz/Abbruch
// und Höhenzulage. „andere" deckt Sonderfälle ab.

export type ZulageTyp = "aufsicht" | "schmutz" | "hoehe" | "andere";

export const ZULAGEN: { code: ZulageTyp; label: string; kv: string; description: string }[] = [
  {
    code: "aufsicht",
    label: "Aufsicht",
    kv: "§ 6 a",
    description: "Aufsichtszulage",
  },
  {
    code: "schmutz",
    label: "Schmutz / Abbruch",
    kv: "§ 6 d",
    description: "Schmutz- und Abbrucharbeiten",
  },
  {
    code: "hoehe",
    label: "Höhenzulage",
    kv: "§ 6 m",
    description: "Arbeiten im Gebirge / in Höhe",
  },
  {
    code: "andere",
    label: "Andere",
    kv: "—",
    description: "Free-Text — konkreten KV-Punkt im Notiz-Feld nennen",
  },
];

export const zulagenLabel = (code: string | null | undefined): string => {
  if (!code) return "";
  const z = ZULAGEN.find((x) => x.code === code);
  return z ? z.label : code;
};

// ─── Regeln aus der Tabelle zulagen_typen (J. Maurer, 19.11.2026) ─────────

/** Felder von zulagen_typen, die für die Regeln gebraucht werden. Die
 *  Spalten ausschluss_gruppe/nur_zugeteilt fehlen in den generierten Typen. */
export interface ZulagenTypRegel {
  id: string;
  bezeichnung: string;
  ausschluss_gruppe?: string | null;
  nur_zugeteilt?: boolean | null;
}

const nurZugeteilt = (t: unknown) => !!(t as ZulagenTypRegel).nur_zugeteilt;

/**
 * Welche Zulagen darf eine Person wählen?
 * - Normale Zulagen: hat das Büro welche zugeteilt, genau diese; sonst alle
 *   (E. Winkler, 19.10.2026).
 * - Zulagen „nur für Zugeteilte“ (Vorarbeiterzulage): nur, wenn zugeteilt.
 *   Sie zählen nicht als Zuteilung — wer nur die Vorarbeiterzulage hat,
 *   behält alle normalen Zulagen.
 */
export function erlaubteZulagenIds(typen: readonly unknown[], zugeteilteIds: readonly string[]): string[] {
  const t = typen as ZulagenTypRegel[];
  const zug = new Set(zugeteilteIds);
  const normal = t.filter((x) => !nurZugeteilt(x));
  const normalZugeteilt = normal.filter((x) => zug.has(x.id));
  const basis = normalZugeteilt.length > 0 ? normalZugeteilt : normal;
  const extra = t.filter((x) => nurZugeteilt(x) && zug.has(x.id));
  const erlaubt = new Set([...basis, ...extra].map((x) => x.id));
  return t.filter((x) => erlaubt.has(x.id)).map((x) => x.id);
}

/**
 * „Für dieselbe Tätigkeit nur eine Zulage“ (J. Maurer, 19.11.2026; Christoph
 * am selben Tag: „nicht mehr beide gleichzeitig auswählbar – Auswahl des einen
 * nimmt das andere weg“): Zulagen derselben Ausschluss-Gruppe (Schmutz 10 % /
 * Abbruch 15 %) gibt es an einem Tag nur eine. Liefert den Hinweistext oder null.
 * arbeitsStunden bleibt für bestehende Aufrufer im Aufruf, zählt aber nicht mehr.
 */
export function zulagenUeberschneidung(
  gewaehlt: readonly { zulagen_typ_id: string; stunden: number | null }[],
  typen: readonly unknown[],
  _arbeitsStunden?: number,
): string | null {
  const byId = new Map((typen as ZulagenTypRegel[]).map((t) => [t.id, t]));
  const gruppen = new Map<string, string[]>();
  for (const z of gewaehlt) {
    const t = byId.get(z.zulagen_typ_id);
    const g = t?.ausschluss_gruppe;
    if (!t || !g) continue;
    if (z.stunden != null && Number(z.stunden) <= 0) continue;
    const namen = gruppen.get(g) ?? [];
    if (!namen.includes(t.bezeichnung)) namen.push(t.bezeichnung);
    gruppen.set(g, namen);
  }
  for (const namen of gruppen.values()) {
    if (namen.length < 2) continue;
    return `${namen.join(" und ")} gibt es nicht am selben Tag – bitte nur eine wählen.`;
  }
  return null;
}

/** Hinweis bei der Auswahl, welche der beiden gilt (J. Maurer, 19.11.2026, nach KV). */
export const SCHMUTZ_ABBRUCH_HINWEIS =
  "Nur eine von beiden: Abbruch einer Dippelbaum- oder Tramdecke samt Beschüttung = Schmutzzulage (10 %); " +
  "echter Abbruch (ganze Bauteile, Dachstühle, mit Staubentwicklung) = Abbruchzulage (15 %).";

/** Andere Zulagen derselben Ausschluss-Gruppe (antippen der einen nimmt die andere weg). */
export function zulagenGleicheGruppe(typId: string, typen: readonly unknown[]): string[] {
  const t = typen as ZulagenTypRegel[];
  const g = t.find((x) => x.id === typId)?.ausschluss_gruppe;
  if (!g) return [];
  return t.filter((x) => x.id !== typId && x.ausschluss_gruppe === g).map((x) => x.id);
}

/** Arbeitsstunden (Baustelle + Firma) eines Tages — „alle“ bei Zulagen. */
export function arbeitsStundenAusEintraegen(
  eintraege: readonly { art: string; stunden: number | string | null }[],
): number {
  const h = eintraege
    .filter((e) => e.art === "baustelle" || e.art === "firma")
    .reduce((s, e) => s + (Number(e.stunden) || 0), 0);
  return Math.round(h * 100) / 100;
}

/** Stunden einer gespeicherten Zulage; ohne Angabe (Altdaten) = Arbeitsstunden des Tages. */
export function zulageStunden(
  z: { stunden: number | string | null },
  eintraege: readonly { art: string; stunden: number | string | null }[],
): number {
  if (z.stunden != null) return Number(z.stunden) || 0;
  return arbeitsStundenAusEintraegen(eintraege);
}

/**
 * Stunden, mit denen eine Zulage gespeichert wird.
 * - leer („alle“) = Arbeitsstunden des Tages
 * - gleich den bisher gespeicherten Arbeitsstunden (also „ganzer Tag“, seit
 *   20.11.2026 als Zahl gespeichert) = neue Arbeitsstunden — sonst bliebe beim
 *   Kürzen 8 → 6 h die Zulage auf 8 stehen (Gegenprobe 21.11.2026)
 * - nie mehr als die Arbeitsstunden
 */
export function zulageStundenBeimSpeichern(
  stunden: number | string | null | undefined,
  arbeitStd: number,
  arbeitStdVorher: number,
): number {
  if (stunden == null || String(stunden).trim() === "") return arbeitStd;
  const h = Number(stunden) || 0;
  if (arbeitStdVorher > 0 && Math.abs(h - arbeitStdVorher) < 0.001) return arbeitStd;
  if (arbeitStd > 0 && h > arbeitStd) return arbeitStd;
  return h;
}
