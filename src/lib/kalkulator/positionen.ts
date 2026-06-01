/**
 * Bausatz-Kalkulator — Stammdaten (Positionen, Materialien).
 *
 * Extrahiert aus dem ursprünglichen HTML-Tool. Eine Position hat einen
 * Code (z. B. "36 12 01 A"), eine Bezeichnung, ein Aufbau-Textblock,
 * eine Einheit (m², lfm, Stk, …) und einen Basis-EP. Optional: K7-
 * Overrides werden separat in `useKalkulator` gehalten.
 */

export type Bereich = "dach" | "decken" | "waende" | "regie";

export interface Position {
  pos: string;
  bez: string;
  aufbau: string;
  eh: string;
  base: number;
  group: Bereich;
  isStuetze?: boolean;
}

export interface Sektion {
  pos: string;
  positionen: Position[];
}

export interface BereichDef {
  key: Bereich;
  titel: string;
  sektionen: Sektion[];
}

export const FIRMA = {
  name: "Holzbau Willroider GmbH",
  strasse: "Willroiderstraße 13",
  plz_ort: "9500 Villach",
  email: "office@willroider.at",
  uid: "ATU 79881978",
  fn: "FN 612643 x",
};

/** Materialien-Liste für die „Eigene Aufbauten"-Schichtenwahl (aus dem
 *  HTML-Original 1:1 übernommen). */
export const MATERIALIEN: string[] = [
  "GKB 12,5mm",
  "GKF 12,5mm",
  "GKB 15mm",
  "GKF 15mm",
  "Fermacell 15mm",
  "Rigidur 15mm",
  "Installationsebene 42mm",
  "OSB 15mm",
  "OSB 18mm",
  "Riegel 80mm",
  "Riegel 100mm",
  "Riegel 120mm",
  "Riegel 140mm",
  "Riegel 160mm",
  "Riegel 180mm",
  "Riegel 200mm",
  "Riegel 240mm",
  "Riegel 280mm",
  "Dämmung Zellulose",
  "Dämmung Steinwolle",
  "Dämmung Glaswolle",
  "Holzweichfaser 40mm",
  "Holzweichfaser 60mm",
  "Agepan 16mm",
  "Winddichtung kein UV",
  "Winddichtung bis 20mm",
  "Winddichtung bis 50mm",
  "Lattung stehend 20mm",
  "Lattung stehend 30mm",
  "Lattung stehend 40mm",
  "Lattung stehend 50mm",
  "Lattung liegend 20mm",
  "Lattung liegend 30mm",
  "Lattung liegend 40mm",
  "Lattung liegend 50mm",
  "Fassade Fichte",
  "Fassade Lärche",
  "Freie Eingabe (direkt eintippen)",
];

export type EigeneGruppe = "waende" | "decken" | "dach";
export const EIGENE_GRUPPE_LABEL: Record<EigeneGruppe, string> = {
  waende: "Wand",
  decken: "Decke",
  dach: "Dach",
};

export const BEREICHE: BereichDef[] = [
  {
    key: "dach",
    titel: "Dachkonstruktionen (36 12)",
    sektionen: [
      {
        pos: "36 12 01 — DACHKONSTRUKTIONEN",
        positionen: [
          {
            pos: "36 12 01 A",
            bez: "Walmdach",
            aufbau: "• CNC-Abbund Walmdach\n• Bauholz/Leimholz\n• Vordach gehobelt",
            eh: "m²",
            base: 35.42,
            group: "dach",
          },
          {
            pos: "36 12 01 A1",
            bez: "Satteldach",
            aufbau: "• CNC-Abbund Satteldach\n• Bauholz/Leimholz\n• Vordach gehobelt",
            eh: "m²",
            base: 31.8,
            group: "dach",
          },
          {
            pos: "36 12 01 B",
            bez: "Staubläden",
            aufbau: "• Staubläden einfräsen in Sparren",
            eh: "lfm",
            base: 24.07,
            group: "dach",
          },
          {
            pos: "36 12 01 C",
            bez: "Stützen Leimholz",
            aufbau: "• Leimholzstützen\n• Stützenfuß + Idefix\n• Länge variabel",
            eh: "Stk",
            base: 140.79,
            group: "dach",
            isStuetze: true,
          },
          {
            pos: "36 12 01 D",
            bez: "Zangendecke",
            aufbau: "• Zangendecke Leimholz sichtbar",
            eh: "m²",
            base: 36.94,
            group: "dach",
          },
          {
            pos: "36 12 01 E",
            bez: "AZ Gaupe",
            aufbau: "• Gaupe (Pauschal)",
            eh: "Pa",
            base: 257.38,
            group: "dach",
          },
          {
            pos: "36 12 01 X",
            bez: "AZ Schwalbenschwanz",
            aufbau: "• Schwalbenschwanz-Verbindung",
            eh: "Stk",
            base: 5.1,
            group: "dach",
          },
        ],
      },
    ],
  },
  {
    key: "decken",
    titel: "Holzrahmenbaudecken (36 14)",
    sektionen: [
      {
        pos: "36 14 01 — DECKEN MIT ZELLULOSE",
        positionen: [
          {
            pos: "36 14 01 A",
            bez: "DE 15-200-24 RS",
            aufbau: "• HWS-Platte 15mm\n• Deckenriegel 200mm (Zellulose)\n• Rauschalung 24mm",
            eh: "m²",
            base: 115.3,
            group: "decken",
          },
          {
            pos: "36 14 01 B",
            bez: "DE 15-240-24 RS",
            aufbau: "• HWS-Platte 15mm\n• Deckenriegel 240mm (Zellulose)\n• Rauschalung 24mm",
            eh: "m²",
            base: 122.84,
            group: "decken",
          },
          {
            pos: "36 14 01 C",
            bez: "DE 15-280-24 RS",
            aufbau: "• HWS-Platte 15mm\n• Deckenriegel 280mm (Zellulose)\n• Rauschalung 24mm",
            eh: "m²",
            base: 130.39,
            group: "decken",
          },
        ],
      },
      {
        pos: "36 14 07 — ZUSATZLEISTUNGEN",
        positionen: [
          {
            pos: "36 14 07 A",
            bez: "Unterzüge Decke",
            aufbau: "• Unterzüge Leimholz (Maßkonstruktion)",
            eh: "m³",
            base: 928.97,
            group: "decken",
          },
        ],
      },
    ],
  },
  {
    key: "waende",
    titel: "Riegelwände und Verkleidungen (36 15)",
    sektionen: [
      {
        pos: "36 15 01 — AUSSENWÄNDE PUTZTRÄGER",
        positionen: [
          {
            pos: "36 15 01 A",
            bez: "AW 15-160-60 WF",
            aufbau: "• OSB 15mm\n• Riegelwand 160mm (Zellulose)\n• HWF/DWD 60mm Putzträger",
            eh: "m²",
            base: 120.33,
            group: "waende",
          },
          {
            pos: "36 15 01 B",
            bez: "AW 15-200-16 WF",
            aufbau: "• OSB 15mm\n• Riegelwand 200mm (Zellulose)\n• HWF/DWD 16mm Putzträger",
            eh: "m²",
            base: 127.88,
            group: "waende",
          },
          {
            pos: "36 15 01 C",
            bez: "AW 15-240-16 WF",
            aufbau: "• OSB 15mm\n• Riegelwand 240mm (Zellulose)\n• HWF/DWD 16mm Putzträger",
            eh: "m²",
            base: 135.43,
            group: "waende",
          },
        ],
      },
      {
        pos: "36 15 02 — AUSSENWÄNDE HINTERLÜFTETE FASSADE",
        positionen: [
          {
            pos: "36 15 02 A",
            bez: "AW 15-160-16 DWD",
            aufbau: "• OSB 15mm\n• Riegelwand 160mm (Zellulose)\n• DWD 16mm hinterlüftet",
            eh: "m²",
            base: 110.89,
            group: "waende",
          },
          {
            pos: "36 15 02 B",
            bez: "AW 15-200-16 DWD",
            aufbau: "• OSB 15mm\n• Riegelwand 200mm (Zellulose)\n• DWD 16mm hinterlüftet",
            eh: "m²",
            base: 118.44,
            group: "waende",
          },
          {
            pos: "36 15 02 C",
            bez: "AW 15-240-16 DWD",
            aufbau: "• OSB 15mm\n• Riegelwand 240mm (Zellulose)\n• DWD 16mm hinterlüftet",
            eh: "m²",
            base: 125.98,
            group: "waende",
          },
        ],
      },
      {
        pos: "36 15 04 — INNENWÄNDE",
        positionen: [
          {
            pos: "36 15 04 A",
            bez: "IW 15-100-15",
            aufbau: "• OSB 15mm\n• Riegelwand 100mm (Zellulose)\n• OSB 15mm",
            eh: "m²",
            base: 97.88,
            group: "waende",
          },
          {
            pos: "36 15 04 B",
            bez: "IW 15-120-15",
            aufbau: "• OSB 15mm\n• Riegelwand 120mm (Zellulose)\n• OSB 15mm",
            eh: "m²",
            base: 101.66,
            group: "waende",
          },
          {
            pos: "36 15 04 C",
            bez: "IW 15-160-15",
            aufbau: "• OSB 15mm\n• Riegelwand 160mm (Zellulose)\n• OSB 15mm",
            eh: "m²",
            base: 109.2,
            group: "waende",
          },
          {
            pos: "36 15 04 F",
            bez: "IW 15-120 einseitig",
            aufbau: "• Rigidur 15mm\n• Riegelwand 120mm (einseitig)",
            eh: "m²",
            base: 77.66,
            group: "waende",
          },
        ],
      },
      {
        pos: "36 15 06 — FASSADEN (Aufzahlung auf AW)",
        positionen: [
          {
            pos: "36 15 06 A",
            bez: "AZ Holzfassade Fichte",
            aufbau: "• Lattung stehend\n• Fichte vorvergraut",
            eh: "m²",
            base: 89.17,
            group: "waende",
          },
          {
            pos: "36 15 06 B",
            bez: "AZ Holzfassade Lärche",
            aufbau: "• Lattung stehend\n• Lärche vorvergraut",
            eh: "m²",
            base: 114.01,
            group: "waende",
          },
        ],
      },
      {
        pos: "36 15 07/08 — AUFZAHLUNGEN",
        positionen: [
          {
            pos: "36 15 07 C",
            bez: "AZ 2. Abdichtungsebene Fensterbank",
            aufbau: "• Purenitkeil unter Fensterbank",
            eh: "lfm",
            base: 64.8,
            group: "waende",
          },
          {
            pos: "36 15 07 D",
            bez: "AZ Unterkonstr. Rollokasten",
            aufbau: "• Unterkonstruktion Rollokasten",
            eh: "lfm",
            base: 58.21,
            group: "waende",
          },
          {
            pos: "36 15 08 A",
            bez: "AZ Gipskarton 12,5mm",
            aufbau: "• GK-Platte 12,5mm (vormontiert)",
            eh: "m²",
            base: 13.45,
            group: "waende",
          },
        ],
      },
    ],
  },
  {
    key: "regie",
    titel: "Regieleistungen (36 90)",
    sektionen: [
      {
        pos: "36 90 01 — REGIE",
        positionen: [
          {
            pos: "36 90 01 A",
            bez: "Regiestunden Vorarbeiter",
            aufbau: "Zimmerer Vorarbeiter",
            eh: "h",
            base: 65,
            group: "regie",
          },
          {
            pos: "36 90 01 B",
            bez: "Regiestunden Facharbeiter",
            aufbau: "Zimmerer Facharbeiter",
            eh: "h",
            base: 65,
            group: "regie",
          },
          {
            pos: "36 90 01 C",
            bez: "Verladen der Bauteile",
            aufbau: "Hallenkran und Stapler",
            eh: "h",
            base: 85,
            group: "regie",
          },
          {
            pos: "36 90 01 D",
            bez: "Streicharbeiten",
            aufbau: "2× Anstrich nach Wahl",
            eh: "m²",
            base: 16.63,
            group: "regie",
          },
          {
            pos: "36 90 01 E",
            bez: "Untersicht 19mm Fichte NF",
            aufbau: "naturbelassen",
            eh: "m²",
            base: 13.16,
            group: "regie",
          },
          {
            pos: "36 90 01 F",
            bez: "Untersicht 27mm Fichte NF",
            aufbau: "naturbelassen",
            eh: "m²",
            base: 16.85,
            group: "regie",
          },
          {
            pos: "36 90 01 G",
            bez: "Rauschalung 23mm",
            aufbau: "",
            eh: "m²",
            base: 6.94,
            group: "regie",
          },
          {
            pos: "36 90 01 H",
            bez: "Konterlattung 50/80",
            aufbau: "",
            eh: "Stk",
            base: 5.12,
            group: "regie",
          },
          {
            pos: "36 90 01 I",
            bez: "Dachlatten 40/50",
            aufbau: "",
            eh: "Stk",
            base: 2.51,
            group: "regie",
          },
          {
            pos: "36 90 01 J",
            bez: "Naturholzplatten 19mm C/C",
            aufbau: "Verzug",
            eh: "m²",
            base: 22.14,
            group: "regie",
          },
          {
            pos: "36 90 01 K",
            bez: "Traufenlatten",
            aufbau: "",
            eh: "Stk",
            base: 6.75,
            group: "regie",
          },
          {
            pos: "36 90 01 L",
            bez: "AZ Farbe bauseitig",
            aufbau: "Abzug bei Kunden-Farbe",
            eh: "m²",
            base: -5.29,
            group: "regie",
          },
        ],
      },
    ],
  },
];

/** Alle Positionen flach, nützlich für Lookups. */
export function alleBereichPositionen(b: Bereich): Position[] {
  const def = BEREICHE.find((x) => x.key === b);
  if (!def) return [];
  return def.sektionen.flatMap((s) => s.positionen);
}
