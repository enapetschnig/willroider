// 4 fixe Ordner pro Angebot — analog zur Excel-Akquise-Struktur.
// Bei Auftrag-Annahme wandert der gesamte Inhalt in 8-Kalkulation
// im Baustellen-Ordner.

export type AngebotOrdnerKey =
  | "ausschreibungsunterlagen"
  | "plaene"
  | "subunternehmer"
  | "angebotsunterlagen";

export type AngebotOrdnerDef = {
  key: AngebotOrdnerKey;
  label: string;
  color: string;
};

export const ANGEBOT_ORDNER: AngebotOrdnerDef[] = [
  { key: "ausschreibungsunterlagen", label: "Ausschreibungsunterlagen", color: "#8b5cf6" },
  { key: "plaene",                   label: "Pläne",                    color: "#7c3aed" },
  { key: "subunternehmer",           label: "Subunternehmer",           color: "#f59e0b" },
  { key: "angebotsunterlagen",       label: "Angebotsunterlagen",       color: "#10b981" },
];

export const angebotOrdnerLabel = (key: string | null | undefined): string => {
  if (!key) return "—";
  const o = ANGEBOT_ORDNER.find((x) => x.key === key);
  return o ? o.label : key;
};

export const angebotOrdnerDef = (
  key: string | null | undefined
): AngebotOrdnerDef | undefined =>
  ANGEBOT_ORDNER.find((x) => x.key === (key ?? "angebotsunterlagen"));
