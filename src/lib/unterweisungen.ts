// Holzbau Willroider — alle 3 Unterweisungs-Typen mit echtem Content
// Quelle: ~/Downloads/unterweisungen/

import type { EvaluierungTyp } from "@/integrations/supabase/types";

export type UnterweisungType = "werkstatt" | "baustelle" | "fertigteilmontage";

export type Section =
  | { kind: "text"; heading?: string; lines: string[] }
  | { kind: "checklist"; heading: string; items: { key: string; label: string }[] }
  | {
      kind: "arbeitsmittel";
      heading: string;
      items: { key: string; label: string }[];
    };

export interface UnterweisungContent {
  id: UnterweisungType;
  title: string;
  subtitle: string;
  shortLabel: string;
  rechtsgrundlage: string;
  sections: Section[];
  bestätigung: string;
}

export const UNTERWEISUNG_OPTIONS: { value: UnterweisungType; label: string; description: string }[] = [
  {
    value: "werkstatt",
    label: "Werkstatt-Unterweisung",
    description: "§ 14 ASchG · Maschinen, PSA, allgemeine Sicherheit in der Halle",
  },
  {
    value: "baustelle",
    label: "Baustellen-Gefahrenevaluierung",
    description: "Gefahren auf der Baustelle, Arbeitsmittel, Schutzmaßnahmen",
  },
  {
    value: "fertigteilmontage",
    label: "Montageanweisung Fertigteile",
    description: "Wand- & Deckenelemente, Anschlagen, Versetzen, Lagerung",
  },
];

export function unterweisungLabel(typ: EvaluierungTyp | null | undefined): string {
  switch (typ) {
    case "werkstatt":
      return "Werkstatt";
    case "baustelle":
      return "Baustelle";
    case "fertigteilmontage":
      return "Fertigteilmontage";
    case "kurz":
      return "Kurzversion";
    case "lang":
      return "Langversion";
    default:
      return "—";
  }
}

// ─────────────────────────────────────────────────────────
// 1. Werkstatt-Unterweisung (§ 14 ASchG)
// ─────────────────────────────────────────────────────────
const WERKSTATT: UnterweisungContent = {
  id: "werkstatt",
  title: "Arbeits- und Sicherheitsunterweisung",
  subtitle: "Werkstatt / Halle",
  shortLabel: "Werkstatt",
  rechtsgrundlage: "§ 14 ASchG · Zimmerei Willroider",
  sections: [
    {
      kind: "checklist",
      heading: "Allgemeine Sicherheitsanweisungen",
      items: [
        { key: "gehörschutz", label: "Gehörschutz tragen (immer bei oder in der Nähe von Holzbearbeitungsmaschinen >85 dBA)" },
        { key: "staubmaske", label: "Staubmaske beim Lackieren / bei Holzstaub" },
        { key: "kleidung", label: "Keine lose Kleidung" },
        { key: "schuhwerk", label: "Gutes Schuhwerk / Sicherheitsschuhe" },
        { key: "ausgeschlafen", label: "Ausgeschlafen am Arbeitsplatz erscheinen" },
        { key: "alkohol", label: "Keine Beeinträchtigung durch Alkohol, Drogen oder Medikamente" },
        { key: "rauchen", label: "Rauchen in der Werkstatt verboten" },
        { key: "absaugung", label: "Immer mit Absaugung arbeiten" },
        { key: "staub", label: "Staub vermeiden – nicht mit Druckluft, sondern mit Staubsauger reinigen" },
        { key: "schutzbrille", label: "Schutzbrille bei bestimmten Arbeiten tragen" },
        { key: "verpackung", label: "Sicherheitsratschläge auf Verpackungen lesen und befolgen" },
        { key: "schutzvorrichtungen", label: "Sämtliche Schutzvorrichtungen verwenden (Spaltkeil, Schutzhauben usw.)" },
        { key: "sorgfalt", label: "Größte Sorgfalt beim Arbeiten mit Holzbearbeitungsmaschinen" },
        { key: "heben", label: "Schwere/große Gegenstände nur mit Hilfsmittel oder zu zweit heben & tragen" },
        { key: "lagerung", label: "Platten nur im Plattenregal oder dafür vorgesehenem Platz lagern" },
        { key: "kran", label: "Bei Kranabladung aus dem Gefahrenbereich gehen" },
        { key: "meldung", label: "Fehlende Sicherheitseinrichtungen / Schäden an Maschinen sofort dem Werksmeister melden" },
        { key: "lackieren", label: "Nur mit Absaugung lackieren" },
        { key: "handschuhe_chemie", label: "Schutzhandschuhe beim Beizen, Ölen, Laugen usw." },
        { key: "schmuck", label: "Kein Schmuck (Ringe, Ketten, Uhren) – Verletzungsgefahr" },
        { key: "haare", label: "Lange Haare zusammenbinden" },
        { key: "handschuhe_maschine", label: "Niemals mit Handschuhen an Holzbearbeitungsmaschinen arbeiten" },
        { key: "sauberkeit", label: "Arbeitsbereich sauber halten" },
      ],
    },
    {
      kind: "text",
      heading: "EV 55001 · Abricht- & Fügehobelmaschine",
      lines: [
        "Messerabdeckung vorne + hinten",
        "Schiebelehre verwenden",
        "Umstellen nur bei stehender Maschine",
        "Spanabnahme nicht zu groß",
        "Keine stumpfen Messer",
        "Reinigung und Gleitmittel nur bei stehender Maschine",
      ],
    },
    {
      kind: "text",
      heading: "EV 55002 · Deckenlaufkran",
      lines: ["Niemals unter Last stehen"],
    },
    {
      kind: "text",
      heading: "EV 55003 · Bandsäge",
      lines: ["Zugriffschutz", "Schiebestock", "Band so weit wie möglich geschlossen halten"],
    },
    {
      kind: "text",
      heading: "EV 55004 · Pendelsäge",
      lines: [
        "Links oder rechts neben der Maschine stehen",
        "Nur Querholz kappen – nicht zum Längsschneiden!",
      ],
    },
    {
      kind: "text",
      heading: "EV 55005 · Formatkreissäge",
      lines: [
        "Spaltkeil",
        "Schutzhaube",
        "Schiebestock",
        "Sägeabdeckung unten",
        "Richtiges Sägeblatt (Hohlzahn / Wechselzahn / Flachzahn) je nach Material",
        "Sägeblatt-Höhe knapp über Werkstück",
      ],
    },
    {
      kind: "text",
      heading: "EV 55006 · Schwenk-Fräsmaschine",
      lines: [
        "Vorschub verwenden",
        "Zugriffschutz",
        "Durchgehender Anschlag",
        "Fräsköpfe mit Prüfzeichen",
        "Spanabnahme nicht zu groß (Rückschlag-Gefahr)",
        "Rückschlagsicherung (Ein- und Ausfahren)",
        "Drehzahl beachten",
      ],
    },
    {
      kind: "text",
      heading: "EV 55007 · Dickenhobelmaschine",
      lines: [
        "Spanabnahme nicht zu groß",
        "Keine stumpfen Messer",
        "Reinigung und Gleitmittel nur bei stehender Maschine",
      ],
    },
    {
      kind: "text",
      heading: "EV 55008 · Standbohrmaschine",
      lines: ["Keine lose Kleidung", "Schutzkleidung"],
    },
    {
      kind: "text",
      heading: "EV 55009 · Stehende Plattensäge",
      lines: [
        "Bei ständigem Plattenzuschnitt Hebeeinrichtung verwenden",
        "Spaltkeile nur für Einsetzschneidarbeiten entfernen / ausschwenken",
        "Nur Werkstücke bearbeiten, die sicher aufliegen und nicht abrutschen können",
        "Werkstück beim Sägevorgang nicht hintergreifen",
      ],
    },
    {
      kind: "text",
      heading: "EV 55101 · Kreissäge",
      lines: [
        "Spaltkeil, Schutzhaube, Schiebestock, Sägeabdeckung unten",
        "Richtiges Sägeblatt je nach Material",
        "Sägeblatt-Höhe knapp über Werkstück",
      ],
    },
    {
      kind: "text",
      heading: "EV 55102 · Abbundanlage",
      lines: [
        "Not-Aus + Reset-Taste am Bedienpult kennen",
        "Fehler-/Warn-/Gefahrenhinweise am PC und an der Maschine beachten",
        "Kollisions- und Endlagenüberwachung",
        "Schutztüren / Maschinenumwehrung verhindert direkten Zugriff zu den Werkzeugen",
        "Bei Längsbearbeitungen: Klemmung des Holzes, halbautomatischer Prozess",
        "Bei Balken länger 8 m: reduzierte Geschwindigkeit, Volumen-abhängige Anpassung",
        "Bei Stoßgefahr: Rundum-Warnleuchte",
        "Bei Quetschgefahr: Sicherheitslichtschranke / Umzäunung > 1,6 m Höhe",
        "Bei Bauteilen < 1300 mm: spezielle Bearbeitungsstrategie (reduzierte Geschwindigkeit, vorpositioniert)",
      ],
    },
    {
      kind: "text",
      heading: "EV 55201 · Metallbandschleifmaschine",
      lines: ["Schutzbrille", "Keine offene Kleidung", "Ohrenschützer"],
    },
    {
      kind: "text",
      heading: "EV 55202 · Metallkreissäge",
      lines: ["Spaltkeil, Schutzhaube, Schiebestock, Sägeabdeckung unten", "Richtiges Sägeblatt je nach Material"],
    },
    {
      kind: "text",
      heading: "EV 55203 · Universalbiegegerät",
      lines: ["Schutzbrille tragen"],
    },
  ],
  bestätigung:
    "Ich bestätige, dass ich die Unterweisungsinhalte voll inhaltlich verstanden habe und einhalte. Mir ist bekannt, dass ein dem widersprechendes Verhalten vom Arbeitgeber nicht geduldet wird.",
};

// ─────────────────────────────────────────────────────────
// 2. Baustellen-Gefahrenevaluierung
// ─────────────────────────────────────────────────────────
const BAUSTELLE: UnterweisungContent = {
  id: "baustelle",
  title: "Gefahrenevaluierung Baustelle",
  subtitle: "Zimmerei / Tischlerei",
  shortLabel: "Baustelle",
  rechtsgrundlage:
    "ASchG · Sicherheits- und Gesundheitsschutzdokument gemäß DOK-VO für Arbeitsstätten mit bis zu 10 Arbeitnehmern",
  sections: [
    {
      kind: "text",
      heading: "Hinweis",
      lines: [
        "Bei der Gefahrenermittlung und -beurteilung nach § 4 ASchG wurden für die unten gelisteten Arbeitsmittel und Bereiche Schutzmaßnahmen festgelegt. Die Schulung ist vor Arbeitsbeginn auf der Baustelle durchzuführen.",
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Krane",
      items: [
        { key: "turmdrehkran", label: "Turmdrehkran" },
        { key: "lkw_ladekran", label: "LKW-Ladekran (Reichweite & Tragfähigkeit)" },
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Hebevorrichtungen",
      items: [
        { key: "bauaufzug", label: "Bauaufzug (Höhe & Tragfähigkeit)" },
        { key: "hebebuehne", label: "Hebebühnen (Reichweite & Tragfähigkeit)" },
        { key: "arbeitskorb_turm", label: "Arbeitskorb für Turmkran" },
        { key: "arbeitskorb_lkw", label: "Arbeitskorb für LKW-Kran" },
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Gerüste & Absturzsicherung",
      items: [
        { key: "haengegeruest", label: "Hängegerüst" },
        { key: "schutzgeruest", label: "Schutzgerüst" },
        { key: "konsolgeruest", label: "Konsolgerüst" },
        { key: "fanggeruest", label: "Fanggerüst" },
        { key: "fangnetz", label: "Fangnetz" },
        { key: "leitern", label: "Leitern" },
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Werkzeuge",
      items: [
        { key: "kettensaege", label: "Kettensäge" },
        { key: "nagelmaschine", label: "Nagelmaschine" },
        { key: "kompressor", label: "Kompressor" },
        { key: "handkreissaege", label: "Handkreissäge" },
        { key: "bohrmaschine", label: "Bohrmaschine" },
        { key: "handhobel", label: "Handhobel" },
        { key: "kappsaege", label: "Kappsäge" },
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Handwerkzeuge",
      items: [
        { key: "hacken", label: "Hacken" },
        { key: "zapin", label: "Zapin" },
        { key: "haemmer", label: "Hämmer" },
        { key: "zwingen", label: "Zwingen" },
        { key: "seile", label: "Seile" },
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Persönliche Schutzausrüstung (PSA)",
      items: [
        { key: "gurte", label: "Gurte / Geschirre" },
        { key: "psa_seile", label: "Sicherungs-Seile" },
        { key: "helme", label: "Schutzhelme" },
        { key: "arbeitsschuhe", label: "Arbeitsschuhe" },
        { key: "schutzbrillen", label: "Schutzbrillen" },
        { key: "gehoerschutz", label: "Gehörschutz" },
        { key: "mundschutz", label: "Mund-/Atemschutz" },
      ],
    },
    {
      kind: "text",
      heading: "Wichtig",
      lines: ["Anseilschutz ab einer Absturzhöhe von über 3 m verwenden!"],
    },
    {
      kind: "arbeitsmittel",
      heading: "Erste Hilfe",
      items: [
        { key: "verbandskasten", label: "Verbandskasten vorhanden" },
        { key: "ersthelfer", label: "Ersthelfer vor Ort (Name)" },
      ],
    },
    {
      kind: "arbeitsmittel",
      heading: "Baustellensicherung",
      items: [
        { key: "bauzaun", label: "Bauzaun / Absperrung" },
        { key: "absicherung_zugaenge", label: "Absicherung Zugänge & Wege" },
        { key: "warntafeln", label: "Warntafeln" },
        { key: "warnlichter", label: "Warnlichter" },
        { key: "absicherung_e_leitungen", label: "Absicherung von E-Leitungen" },
        { key: "kelag", label: "KELAG verständigen (falls erforderlich)" },
      ],
    },
    {
      kind: "text",
      heading: "Diverses",
      lines: [
        'Montageanleitung für Fertigteilelemente beachten (siehe gesonderte Unterweisung „Fertigteilmontage").',
      ],
    },
  ],
  bestätigung:
    "Ich bestätige, dass die Gefahrenevaluierung vor Arbeitsbeginn durchgeführt wurde. Ich habe die Unterweisung erhalten, verstanden und werde die festgelegten Schutzmaßnahmen einhalten.",
};

// ─────────────────────────────────────────────────────────
// 3. Montageanweisung Fertigteilelemente
// ─────────────────────────────────────────────────────────
const FERTIGTEILMONTAGE: UnterweisungContent = {
  id: "fertigteilmontage",
  title: "Montageanweisung Fertigteilelemente",
  subtitle: "Wand- und Deckenelemente · Holzbauweise",
  shortLabel: "Fertigteilmontage",
  rechtsgrundlage: "Holzfertigteilbau · Versetz- und Hebearbeiten",
  sections: [
    {
      kind: "text",
      heading: "1. Grundausstattung von Material und Maschinen",
      lines: [
        "Schlagbohrmaschine, Bohrer, Dübel, Schrauben & Beilagscheiben, Schlagschrauber mit Stecknuss",
        "Zimmererhammer, Vorschlaghammer, Schrauben, Nägel, Zange, Schraubenzieher",
        "Nivellier-Stativ, Nivellier-Gerät, Nivellier-Latte, Alulatte mit Libelle",
        "Rollmaßband, Zollstock, Kabeltrommel, Beißer, Brechstange",
        "Kettensäge, Handkreissäge",
        "Schrägstützen (Metall), Kanthölzer und Unterlagshölzer in verschiedenen Stärken",
        "Geeignete Aufstiegshilfe, persönliche Schutzausrüstung & Verlegeplan",
      ],
    },
    {
      kind: "checklist",
      heading: "2. Arbeitnehmerschutz",
      items: [
        { key: "psa_kran", label: "PSA für Kranarbeiten tragen (insbesondere Helm!)" },
        { key: "elemente_fixiert", label: "Bewegliche Teile der Elemente während des Versetzens fixieren" },
        { key: "ablage", label: "Elemente NICHT als Ablage für Werkzeug oder Material verwenden" },
        { key: "absturz", label: "Sämtliche Maßnahmen gegen Absturz treffen" },
        { key: "ueber_personen", label: "Elemente niemals über Personen hinweg heben" },
        { key: "rampe", label: "Beim Befahren von Rampen: niemand hinter (Abrollbereich) oder neben (Kippbereich) der Rampe" },
      ],
    },
    {
      kind: "text",
      heading: "3. Vorarbeiten",
      lines: [
        "Vor Beginn: Grundriss der Wände (inkl. Türen & Durchgänge) auf Bodenplatte/Decke auftragen",
        "Höchsten Punkt der Bodenplatte/Decke ausnivellieren",
        "Wände mit Holzklötzen unterlegen (Anzahl lt. Statik) – kippsicher und gegen Wegrutschen",
        "Vor Verlegen von Plattenelementen: tragsichere und standsichere Unterstellungen anordnen",
      ],
    },
    {
      kind: "text",
      heading: "4. Liefervoraussetzungen",
      lines: [
        "Einwandfreie Zu- und Abfahrt sicherstellen (Kurvenradien, Rampen, Durchfahrtshöhen, Gewichtsbeschränkungen)",
        "Befestigte Standplätze für Transportfahrzeug, Kran und Zwischenlagerung",
        "Anlieferung in der Reihenfolge des Versetzens (siehe Verlegeplan)",
      ],
    },
    {
      kind: "text",
      heading: "5. Transport zur Baustelle",
      lines: [
        "Transport liegend oder stehend auf Verladebock, gezurrt nach ÖNORM V5750",
        "Maximale Maße: Höhe 4,0 m · Breite 2,50 m · Länge 12 m (Anhänger) / 16,5 m (Sattel-KFZ) / 18,5 m (Züge)",
        "Bei Überschreitung: Ausnahmegenehmigung einholen",
        "Ladungssicherung durch: Verspannen (Gurte/Ketten/Drahtseile), Verkeilen (Keile/Hölzer) oder Versperren",
        "Nur geprüfte Zurrgurte verwenden",
      ],
    },
    {
      kind: "text",
      heading: "6. Gewicht",
      lines: [
        "Gewicht jedes Elements aus dem Verlegeplan entnehmen (Element-Nummer beachten)",
        "Schwere und sperrige Elemente mit Halteseil führen",
      ],
    },
    {
      kind: "text",
      heading: "7. Lagerung & Zwischenlagerung",
      lines: [
        "Elemente nach Möglichkeit direkt vom Transportfahrzeug versetzen",
        "Lagerfläche: ebene und tragfähige Unterlage",
        "Anschlagpunkte / Befestigungsmittel vor Beschädigung schützen – beschädigte Mittel aussortieren",
        "Zwischenpolsterhölzer mind. 4 cm hoch, bei Einbauteilen erhöhen",
        "Auf der Baustelle keine höheren Stapel als am Transportfahrzeug",
        "Stapel gegen Kippen (Wind!) sichern – Niederbinden mit Zurrgurten",
      ],
    },
    {
      kind: "text",
      heading: "8. Kippen von Elementen",
      lines: [
        "Waagrechter Umdrehplatz mit Polsterhölzern auslegen",
        "Bretter als Kippunterstützung – niemals punktförmig unterlegen",
        "Randabstände und Durchbiegung beachten",
        "Beim Aufdrehen: Kran muss heben, nicht drücken",
        "Bei großen Elementhöhen Bruchgefahr → Rücksprache mit Bauleiter",
      ],
    },
    {
      kind: "checklist",
      heading: "9. Versetzen",
      items: [
        { key: "senkrecht", label: "Senkrechte Stellung durch den Kran prüfen" },
        { key: "abstand", label: "30%-Sicherheit zwischen Kran-Tragkraft und Element-Gewicht einhalten" },
        { key: "reihenfolge", label: "Verlegeplan-Reihenfolge einhalten (Element-Nummern abgleichen)" },
        { key: "verbleibende", label: "Verbleibende Elemente während des Versetzens sichern" },
        { key: "mängel_pruefen", label: "Elemente vor Einbau auf Mängel prüfen (Risse, Verformungen)" },
        { key: "anker", label: "Nur eingebaute Anker / Befestigungspunkte zum Versetzen nutzen" },
        { key: "einschwenken", label: "Beim Einschwenken bereits gestellte Elemente nicht beschädigen" },
        { key: "schraegstuetzen", label: "Wandelemente mit 2 Schrägstützen pro Element sichern, Lot mit Spindel einstellen" },
        { key: "anschlagmittel", label: "Anschlagmittel erst entfernen, wenn das Element kippsicher befestigt ist" },
        { key: "aushaengen", label: "Aushängen nur mit PSA – Anlegeleitern oder Arbeitskorb vom Kran aus" },
      ],
    },
    {
      kind: "text",
      heading: "10. Anschlagen von Lasten",
      lines: [
        "Anschlagmittel müssen dauerhaft gekennzeichnet sein",
        "Bei mehrsträngigen Gehängen: nur 2 Stränge als tragend annehmen",
        "Anschlagmittel an scharfen Kanten schützen (Kantenschutz)",
        "Lasthaken: max. 10 % Aufweitung im Hakenmaul, max. 5 % Abnutzung – nur mit funktionstüchtiger Hakenmaulsicherung",
        "Anschlagmittel mind. 1× jährlich von Fachkundigem prüfen lassen",
        "Nur werkseitig vorgesehene Befestigungspunkte verwenden",
        "Winkel zwischen Gehänge und Element ≥ 60°",
        "Element waagrecht anheben – Verkürzungen bei Bedarf",
        "Langsam und ruckfrei anheben/absenken",
        "Lasten mit zusätzlicher Sicherung gegen unbeabsichtigtes Lösen",
      ],
    },
    {
      kind: "text",
      heading: "Hebegurte",
      lines: [
        "Nur geprüfte Gurte – nicht verdreht, verlängert oder verknotet",
        "Vollflächig auflegen, nicht über scharfe Kanten biegen",
        "Tragfähigkeit auf vernähtem Etikett prüfen",
        "Genähter Bereich darf nicht um Kanten gebogen werden",
      ],
    },
  ],
  bestätigung:
    "Ich bestätige, dass ich die Montageanweisung für Fertigteilelemente vollständig gelesen, verstanden und akzeptiert habe. Ich werde die Vorgaben bei Versetzarbeiten einhalten.",
};

const ALL: Record<UnterweisungType, UnterweisungContent> = {
  werkstatt: WERKSTATT,
  baustelle: BAUSTELLE,
  fertigteilmontage: FERTIGTEILMONTAGE,
};

export function getUnterweisung(typ: EvaluierungTyp | null | undefined): UnterweisungContent | null {
  if (!typ) return null;
  if (typ in ALL) return ALL[typ as UnterweisungType];
  // Legacy 'kurz'/'lang' fallback → Baustelle (am ähnlichsten)
  if (typ === "kurz" || typ === "lang") return BAUSTELLE;
  return null;
}
