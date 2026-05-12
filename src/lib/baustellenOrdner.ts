// Zentrale Definition der Baustellen-Ordnerstruktur (Holzbau Willroider intern).
// Reihenfolge entspricht der File-Server-Aktenstruktur.

export type OrdnerKey =
  | "1-baustellenmanagement"
  | "2-schriftverkehr"
  | "3-aktenvermerke"
  | "4-vertrag"
  | "5-subunternehmer"
  | "6-abrechnung"
  | "7-lieferanten"
  | "8-kalkulation"
  | "91-plaene"
  | "92-sonstiges"
  | "93-dhp"
  | "94-statik"
  | "fotos"
  | "evaluierung";

export type OrdnerDef = {
  key: OrdnerKey;
  label: string;
  /** Hex-Farbe für Header-Akzent */
  color: string;
};

export const BAUSTELLEN_ORDNER: OrdnerDef[] = [
  { key: "1-baustellenmanagement", label: "1-Baustellenmanagement", color: "#dc2626" },
  { key: "2-schriftverkehr", label: "2-Schriftverkehr", color: "#0ea5e9" },
  { key: "3-aktenvermerke", label: "3-Aktenvermerke", color: "#8b5cf6" },
  { key: "4-vertrag", label: "4-Vertrag", color: "#10b981" },
  { key: "5-subunternehmer", label: "5-Subunternehmer-Professionisten", color: "#f59e0b" },
  { key: "6-abrechnung", label: "6-Abrechnung", color: "#ef4444" },
  { key: "7-lieferanten", label: "7-Lieferanten", color: "#06b6d4" },
  { key: "8-kalkulation", label: "8-Kalkulation", color: "#84cc16" },
  { key: "91-plaene", label: "91-Pläne", color: "#7c3aed" },
  { key: "92-sonstiges", label: "92-Sonstiges", color: "#6b7280" },
  { key: "93-dhp", label: "93-DHP", color: "#ec4899" },
  { key: "94-statik", label: "94-Statik", color: "#14b8a6" },
  { key: "fotos", label: "Fotos", color: "#3b82f6" },
  { key: "evaluierung", label: "Evaluierung / Unterweisung", color: "#65a30d" },
];

export const ordnerLabel = (key: string | null | undefined): string => {
  if (!key) return "—";
  const o = BAUSTELLEN_ORDNER.find((x) => x.key === key);
  return o ? o.label : key;
};

export const ordnerDef = (key: string | null | undefined): OrdnerDef | undefined =>
  BAUSTELLEN_ORDNER.find((x) => x.key === (key ?? "92-sonstiges"));

/** Default-Sichtbarkeit pro Rolle (Fallback wenn DB-Settings nicht geladen). */
export const DEFAULT_VISIBILITY: Record<string, OrdnerKey[]> = {
  geschaeftsfuehrung: BAUSTELLEN_ORDNER.map((o) => o.key),
  buero: BAUSTELLEN_ORDNER.map((o) => o.key),
  bauleiter: [
    "1-baustellenmanagement",
    "2-schriftverkehr",
    "3-aktenvermerke",
    "5-subunternehmer",
    "7-lieferanten",
    "91-plaene",
    "92-sonstiges",
    "93-dhp",
    "94-statik",
    "fotos",
    "evaluierung",
  ],
  zimmermeister: [
    "1-baustellenmanagement",
    "2-schriftverkehr",
    "3-aktenvermerke",
    "5-subunternehmer",
    "7-lieferanten",
    "91-plaene",
    "92-sonstiges",
    "93-dhp",
    "94-statik",
    "fotos",
    "evaluierung",
  ],
  mitarbeiter: ["fotos", "91-plaene", "92-sonstiges", "evaluierung"],
};

export type Visibility = Record<string, OrdnerKey[]>;
