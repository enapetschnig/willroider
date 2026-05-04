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
