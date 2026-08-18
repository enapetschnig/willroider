/**
 * Die allgemeinen Kostenstellen der Zimmerei — abgetippt aus der
 * Kostenstellenübersicht 08.2026 (Blatt „140 4 Zimmerei", rechte Spalte).
 *
 * Diese Liste ist bewusst STATISCH: „Die allgemeinen Kostenstellen bleiben
 * immer so wie sie sind." Zwei Einträge wurden auf Wunsch gegenüber dem
 * Papier korrigiert: 140 4050 heißt hier Egger Sebastian (statt Gruber),
 * 140 4060 Winkler (statt Tindl).
 *
 * Die Fremdauftrags-Kostenstellen (140 40xx) sind zugleich die BASEN der
 * Sammel-Kostenstellen im Baustellenstamm (z. B. 1404030-2601) — die
 * Übersicht klappt darunter die zugehörigen Baustellen auf.
 */

export interface AllgemeineKst {
  /** 7-stellig ohne Trennzeichen, z. B. "1404020". */
  kst: string;
  name: string;
  /** Basis von Sammel-Kostenstellen (1404030-2601 …) — aufklappbar. */
  fremdauftrag?: boolean;
}

export const ALLGEMEINE_KOSTENSTELLEN: AllgemeineKst[] = [
  { kst: "1404020", name: "Egger – Fremdaufträge", fremdauftrag: true },
  { kst: "1404030", name: "Maurer – Fremdaufträge", fremdauftrag: true },
  { kst: "1404040", name: "Gwenger – Fremdaufträge", fremdauftrag: true },
  { kst: "1404050", name: "Egger Sebastian – Fremdaufträge", fremdauftrag: true },
  { kst: "1404060", name: "Winkler – Fremdaufträge", fremdauftrag: true },
  { kst: "1404070", name: "Pliessnig – Fremdaufträge", fremdauftrag: true },
  { kst: "1404750", name: "Verrechnung Abbundleistung" },
  { kst: "1404751", name: "Woodwork Brandschaden" },
  { kst: "1404755", name: "Hundegger K2" },
  { kst: "1404757", name: "Hundegger SC4" },
  { kst: "1404760", name: "Woodwork sonst. Kosten" },
  { kst: "1404762", name: "Hacker Untha" },
  { kst: "1404765", name: "Elementierung Weinmann" },
  { kst: "1404767", name: "ISOCELL" },
  { kst: "1404769", name: "Sonst. Maschinenpark" },
  { kst: "1404810", name: "Sprinter Merc. VI 418 DS" },
  { kst: "1404811", name: "Sprinter Merc. VI 481 DB" },
  { kst: "1404812", name: "Doppelk. VW VI 148 EW" },
  { kst: "1404813", name: "VW Caddy VI 494 FP" },
  { kst: "1404814", name: "Sprinter Merc. VI 278 CB" },
  { kst: "1404815", name: "Sprinter Merc. VI 502 FI" },
  { kst: "1404816", name: "Sprinter Merc. VI 611 FC" },
  { kst: "1404817", name: "LKW ISUZU VI 881 EN" },
  { kst: "1404818", name: "Sprinter Merc. VI 269 FY" },
  { kst: "1404819", name: "VW Caddy VI 843 FD" },
  { kst: "1404820", name: "Sprinter Merc. VI 767 FA" },
  { kst: "1404821", name: "E-Stapler" },
  { kst: "1404822", name: "Stapler Linde" },
  { kst: "1404848", name: "PKW BMW iX3 (Elektro) · Maurer" },
  { kst: "1404849", name: "PKW VI 147 FU (Elektro) · Pliessnig" },
  { kst: "1404850", name: "Volvo XC VI 227 BY" },
  { kst: "1404851", name: "Anhänger Zim. VI 279 DF" },
  { kst: "1404852", name: "Anhänger Zim. VI 140 EA" },
  { kst: "1404890", name: "Kalkulation Zimmerei" },
  { kst: "1404891", name: "WP Feistritz/Feldkirchen" },
  { kst: "1404895", name: "Planung Zimmerei" },
  { kst: "1404899", name: "Zimmerei allgemein" },
  { kst: "1404900", name: "Lagerverwaltung" },
  { kst: "1404901", name: "Lager Material Zimmerei" },
  { kst: "1404913", name: "Erweiterung Holzbau 2023" },
  { kst: "1404920", name: "Kleinwerkzeug Zimmerei" },
  { kst: "1404997", name: "Gewährleistungsaufwand" },
  { kst: "1404998", name: "Abgerechnete Bauten" },
  { kst: "1407890", name: "Verrechnung Willroider" },
];

/** „140 4450" — die Schreibweise der Papierliste. */
export const kstFormat = (kst: string): string =>
  /^\d{7}/.test(kst) ? `${kst.slice(0, 3)} ${kst.slice(3, 7)}${kst.slice(7)}` : kst;

/** Nur die Ziffern — macht "140-4755" und "1404755" vergleichbar. */
export const kstNormal = (kst: string | null | undefined): string =>
  (kst ?? "").replace(/\D/g, "");
