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
 * „Für dieselbe Tätigkeit nur eine Zulage“ (J. Maurer, 19.11.2026):
 * Zulagen derselben Ausschluss-Gruppe (Schmutz 10 % / Abbruch 15 %) dürfen
 * nicht für dieselben Stunden gelten. Beide an einem Tag nur mit
 * Stundenangabe und zusammen höchstens die Arbeitsstunden des Tages.
 * Liefert den Hinweistext oder null.
 */
export function zulagenUeberschneidung(
  gewaehlt: readonly { zulagen_typ_id: string; stunden: number | null }[],
  typen: readonly unknown[],
  arbeitsStunden: number,
): string | null {
  const byId = new Map((typen as ZulagenTypRegel[]).map((t) => [t.id, t]));
  const gruppen = new Map<string, { namen: string[]; summe: number; ohneStunden: boolean }>();
  for (const z of gewaehlt) {
    const t = byId.get(z.zulagen_typ_id);
    const g = t?.ausschluss_gruppe;
    if (!t || !g) continue;
    if (z.stunden != null && Number(z.stunden) <= 0) continue;
    const e = gruppen.get(g) ?? { namen: [], summe: 0, ohneStunden: false };
    if (!e.namen.includes(t.bezeichnung)) e.namen.push(t.bezeichnung);
    if (z.stunden == null) e.ohneStunden = true;
    else e.summe += Number(z.stunden);
    gruppen.set(g, e);
  }
  for (const e of gruppen.values()) {
    if (e.namen.length < 2) continue;
    const liste = e.namen.join(" und ");
    if (e.ohneStunden || e.summe > arbeitsStunden + 0.001) {
      const max = String(Math.round(arbeitsStunden * 100) / 100).replace(".", ",");
      return `${liste} gibt es nicht für dieselben Stunden – bitte nur eine wählen oder die Stunden aufteilen (zusammen höchstens ${max} Std.).`;
    }
  }
  return null;
}

/** Andere Zulagen derselben Ausschluss-Gruppe (für „antippen = umschalten“). */
export function zulagenGleicheGruppe(typId: string, typen: readonly unknown[]): string[] {
  const t = typen as ZulagenTypRegel[];
  const g = t.find((x) => x.id === typId)?.ausschluss_gruppe;
  if (!g) return [];
  return t.filter((x) => x.id !== typId && x.ausschluss_gruppe === g).map((x) => x.id);
}
