/** Auer-Referenzpreise — Lohn/Sonstiges/EP aus echten ONLV-Projekten.
 *  1:1 aus dem HTML-Original übernommen (Auswahl der wichtigsten
 *  Holzbau-Positionen). Im Admin-Tab durchsuchbar; kein Einfluss auf
 *  die K7-Preisermittlung — dient als Vergleichswerte. */

export interface AuerRow {
  bez: string;
  eh: string;
  lohn: number;
  sonst: number;
  ep: number;
  quelle: string;
}

export const AUER_BUILTIN: AuerRow[] = [
  {
    "bez": "Einrichten der Baustelle",
    "eh": "PA",
    "lohn": 543.75,
    "sonst": 3075.0,
    "ep": 3618.75,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Räumen der Baustelle",
    "eh": "PA",
    "lohn": 842.81,
    "sonst": 4766.25,
    "ep": 5609.06,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Gesamte Baustellengemeinkosten n.Prozent",
    "eh": "PA",
    "lohn": 0.0,
    "sonst": 13284.0,
    "ep": 13284.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Sonderkosten Holzbaustatik+Pläne AN",
    "eh": "PA",
    "lohn": 0.0,
    "sonst": 8364.0,
    "ep": 8364.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Sonderkosten Werkpläne",
    "eh": "PA",
    "lohn": 4062.5,
    "sonst": 0.0,
    "ep": 4062.5,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Luftdichtheitsmessung durch AN 1.OG",
    "eh": "PA",
    "lohn": 489.38,
    "sonst": 492.62,
    "ep": 982.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Luftdichtheitsmessung durch AN 2.OG",
    "eh": "PA",
    "lohn": 440.44,
    "sonst": 443.36,
    "ep": 883.8,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "4-Achs LKW mit 115mto Ladekran",
    "eh": "h",
    "lohn": 0.0,
    "sonst": 185.63,
    "ep": 185.63,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Arbeitsleistung FA/HA",
    "eh": "h",
    "lohn": 62.0,
    "sonst": 0.0,
    "ep": 62.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Erstzustellung Absetzer 7-10m3",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 12.3,
    "ep": 12.3,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Abfuhr Absetzer 7-10m3",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 123.0,
    "ep": 123.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Bereitstellung Abroller 10-30m3",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 12.3,
    "ep": 12.3,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Erstzustellung Abroller 10-30m3",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 18.45,
    "ep": 18.45,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Abfuhr Abroller 10-30m3 mit Deckel",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 135.3,
    "ep": 135.3,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Bereitstellung Absetzer 7-10m3",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 12.3,
    "ep": 12.3,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Bauschutt gemischt",
    "eh": "t",
    "lohn": 0.0,
    "sonst": 159.9,
    "ep": 159.9,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Baustellenabfall",
    "eh": "t",
    "lohn": 0.0,
    "sonst": 246.0,
    "ep": 246.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Holzfenster/Türen mit Glaseinsatz",
    "eh": "t",
    "lohn": 0.0,
    "sonst": 51.66,
    "ep": 51.66,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Altholz gemischt",
    "eh": "t",
    "lohn": 0.0,
    "sonst": 55.35,
    "ep": 55.35,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Bitumen,Bitumenbahnen fest, nicht gef.",
    "eh": "t",
    "lohn": 0.0,
    "sonst": 95.94,
    "ep": 95.94,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Asbestabfälle, künst. Mineralfasern",
    "eh": "t",
    "lohn": 0.0,
    "sonst": 1660.5,
    "ep": 1660.5,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Big Bag's für künstliche Mineralfasern",
    "eh": "Stk",
    "lohn": 0.0,
    "sonst": 12.3,
    "ep": 12.3,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Lamellenfassade auf Bestand",
    "eh": "m²",
    "lohn": 61.09,
    "sonst": 115.93,
    "ep": 177.02,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Lamellenfassade auf Neubau",
    "eh": "m²",
    "lohn": 61.09,
    "sonst": 115.93,
    "ep": 177.02,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Rhomboline DUO Lärche I auf WDVS waagrecht",
    "eh": "m²",
    "lohn": 67.97,
    "sonst": 102.23,
    "ep": 170.2,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Lamellenfassade auf WDVS",
    "eh": "m²",
    "lohn": 62.72,
    "sonst": 117.9,
    "ep": 180.62,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Rhomboline DUO Lärche I auf WDVS senkrecht",
    "eh": "m²",
    "lohn": 81.02,
    "sonst": 114.08,
    "ep": 195.1,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Terrassenbelag Lärche samt UK",
    "eh": "m²",
    "lohn": 70.14,
    "sonst": 87.44,
    "ep": 157.58,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "VAR. Thermoesche",
    "eh": "m²",
    "lohn": 70.69,
    "sonst": 165.83,
    "ep": 236.52,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Terrassen Feinsteinzeug",
    "eh": "m²",
    "lohn": 0.0,
    "sonst": 193.2,
    "ep": 193.2,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Drainage- und Belüftungsprofil 150mm",
    "eh": "m",
    "lohn": 0.0,
    "sonst": 126.5,
    "ep": 126.5,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Podestkonstruktion in BSH Lärche",
    "eh": "m²",
    "lohn": 30.7,
    "sonst": 55.61,
    "ep": 86.31,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. Podest I Stiege",
    "eh": "Stk",
    "lohn": 271.88,
    "sonst": 246.0,
    "ep": 517.88,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Lärchenschalung I auf Podestk. Stfl. waagrecht",
    "eh": "m²",
    "lohn": 59.81,
    "sonst": 46.34,
    "ep": 106.15,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Holzlamellen",
    "eh": "Stk",
    "lohn": 6.53,
    "sonst": 8.65,
    "ep": 15.18,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "1.OG Außenwände Aufbau I GESAMT",
    "eh": "m²",
    "lohn": 88.9,
    "sonst": 326.61,
    "ep": 415.51,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. Fassadenschalung senkrecht",
    "eh": "m²",
    "lohn": 13.05,
    "sonst": 11.86,
    "ep": 24.91,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. Anschluß Pergola",
    "eh": "m",
    "lohn": 13.59,
    "sonst": 14.76,
    "ep": 28.35,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. Dämmung 200mm",
    "eh": "m²",
    "lohn": 5.44,
    "sonst": 15.11,
    "ep": 20.55,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. Sockelausbildung",
    "eh": "m",
    "lohn": 8.16,
    "sonst": 7.38,
    "ep": 15.54,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. Einlagehölzer in Dämmung",
    "eh": "Stk",
    "lohn": 8.16,
    "sonst": 10.81,
    "ep": 18.97,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Holzrahmenbauwände",
    "eh": "m²",
    "lohn": 119.51,
    "sonst": 167.18,
    "ep": 286.69,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Installationsebene",
    "eh": "m²",
    "lohn": 6.53,
    "sonst": 10.01,
    "ep": 16.54,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Innenverkleidung",
    "eh": "m²",
    "lohn": 35.36,
    "sonst": 36.8,
    "ep": 72.16,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Lamellenfassade I Außenstiege",
    "eh": "m²",
    "lohn": 81.75,
    "sonst": 102.99,
    "ep": 184.74,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Lamellenfassade I Treppenauge",
    "eh": "m²",
    "lohn": 81.75,
    "sonst": 102.99,
    "ep": 184.74,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Holzmassivdecke BSP 18cm 5-lagig",
    "eh": "m²",
    "lohn": 16.04,
    "sonst": 199.48,
    "ep": 215.52,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Stahlkonstruktionen lt. Statik",
    "eh": "kg",
    "lohn": 0.0,
    "sonst": 5.18,
    "ep": 5.18,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Terrassentrennwände",
    "eh": "m²",
    "lohn": 19.84,
    "sonst": 251.1,
    "ep": 270.94,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "2.OG Außenwände Aufbau I GESAMT",
    "eh": "m²",
    "lohn": 88.9,
    "sonst": 326.61,
    "ep": 415.51,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Holzrahmenbauwände alternativ",
    "eh": "m²",
    "lohn": 119.51,
    "sonst": 167.18,
    "ep": 286.69,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Holzmassivdecke BSP 16cm 5-lagig",
    "eh": "m²",
    "lohn": 16.04,
    "sonst": 187.71,
    "ep": 203.75,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "BSH Bauteile für Unterzüge und Stützen 01",
    "eh": "m³",
    "lohn": 470.79,
    "sonst": 1346.7,
    "ep": 1817.49,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Aufz. BSH Bauteile in Sichtqualität.",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 25.0,
    "ep": 25.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Herstellen Dachöffnung Schleppgaube",
    "eh": "PA",
    "lohn": 1631.25,
    "sonst": 1237.5,
    "ep": 2868.75,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Außenwände Schleppgaube",
    "eh": "m²",
    "lohn": 135.88,
    "sonst": 213.99,
    "ep": 349.87,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Pultdach mit Kaltdach DN.ca. 5° Schleppgaube",
    "eh": "m²",
    "lohn": 34.57,
    "sonst": 84.09,
    "ep": 118.66,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Dachausbau Schleppgaube",
    "eh": "m²",
    "lohn": 76.68,
    "sonst": 44.04,
    "ep": 120.72,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Herstellen Dachöffnung Verbindungsgang",
    "eh": "PA",
    "lohn": 1359.38,
    "sonst": 825.0,
    "ep": 2184.38,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Außenwände Verbindungsgang",
    "eh": "m²",
    "lohn": 14.41,
    "sonst": 206.54,
    "ep": 220.95,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Pultdach mit Kaltdach DN.ca. 5° Verbindungsgang",
    "eh": "m²",
    "lohn": 33.75,
    "sonst": 82.46,
    "ep": 116.21,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Dachausbau Verbindungsgang",
    "eh": "m²",
    "lohn": 76.68,
    "sonst": 44.04,
    "ep": 120.72,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Massivholzplatte schräg BSP 5s 180mm",
    "eh": "m²",
    "lohn": 16.04,
    "sonst": 199.48,
    "ep": 215.52,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "BSH Bauteile für Unterzüge und Stützen 02",
    "eh": "m³",
    "lohn": 470.79,
    "sonst": 1346.7,
    "ep": 1817.49,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Außenwände Ergänzung Sauna",
    "eh": "m²",
    "lohn": 149.47,
    "sonst": 235.39,
    "ep": 384.86,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Ergänzung Satteldach",
    "eh": "m²",
    "lohn": 42.36,
    "sonst": 98.31,
    "ep": 140.67,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Dachausbau Ergänzug Satteldach",
    "eh": "m²",
    "lohn": 76.68,
    "sonst": 44.04,
    "ep": 120.72,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Brüstung/Attika bei Terrassen",
    "eh": "m²",
    "lohn": 119.9,
    "sonst": 309.68,
    "ep": 429.58,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Terrassenbelag Lärche samt UK I Schleppgaube",
    "eh": "m²",
    "lohn": 70.14,
    "sonst": 88.45,
    "ep": 158.59,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Terrassenbelag Lärche samt UK I Holzpodestkonstruktion",
    "eh": "m²",
    "lohn": 70.14,
    "sonst": 88.45,
    "ep": 158.59,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Attikawand",
    "eh": "m²",
    "lohn": 119.9,
    "sonst": 309.68,
    "ep": 429.58,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Attikawand I bauseitige Verblechung",
    "eh": "m²",
    "lohn": 79.11,
    "sonst": 246.29,
    "ep": 325.4,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Regiestunde Facharbeiter",
    "eh": "h",
    "lohn": 65.0,
    "sonst": 0.0,
    "ep": 65.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Regiestunde Hilfsarbeiter",
    "eh": "h",
    "lohn": 60.0,
    "sonst": 0.0,
    "ep": 60.0,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "BSH GL24c Nsi Standarddimensionen",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 671.1,
    "ep": 671.1,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "BSH GL24c Si Standarddimensionen",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 701.1,
    "ep": 701.1,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "KVH C24 Nsi Standarddimensionen",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 479.7,
    "ep": 479.7,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "KVH C24 Si Standarddimensionen",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 590.4,
    "ep": 590.4,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Dachlatten 40x60mm Fichte",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 350.55,
    "ep": 350.55,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Fassadenschalung heimische Lärche",
    "eh": "m²",
    "lohn": 0.0,
    "sonst": 33.46,
    "ep": 33.46,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Fasenschalung Fichte B - 24*145mm N+F",
    "eh": "m²",
    "lohn": 0.0,
    "sonst": 33.46,
    "ep": 33.46,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Rauschalung Fichte 23mm",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 264.45,
    "ep": 264.45,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Konterlatten 60x80mm Fichte",
    "eh": "m³",
    "lohn": 0.0,
    "sonst": 350.55,
    "ep": 350.55,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Befestigungskonstruktionen in kg",
    "eh": "kg",
    "lohn": 0.0,
    "sonst": 10.46,
    "ep": 10.46,
    "quelle": "00126B Nockresort.ON"
  },
  {
    "bez": "Sicherheits- und Gesundheitsschutzvorkehrungen",
    "eh": "PA",
    "lohn": 2437.5,
    "sonst": 4305.0,
    "ep": 6742.5,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Abdeckungen herst. vorhalt. demont.",
    "eh": "PA",
    "lohn": 2120.63,
    "sonst": 1652.09,
    "ep": 3772.72,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Umwehrung Absturzkanten herst.vorhalt.demon",
    "eh": "PA",
    "lohn": 1087.5,
    "sonst": 856.67,
    "ep": 1944.17,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Umwehrung Balkone/Loggien herst.vorhalt.demon",
    "eh": "PA",
    "lohn": 1359.38,
    "sonst": 1070.84,
    "ep": 2430.22,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Abgrenzungen herst. vorhalt. demont.",
    "eh": "PA",
    "lohn": 543.75,
    "sonst": 428.34,
    "ep": 972.09,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Sich-Anschlaganker Bet.Stahl",
    "eh": "Stk",
    "lohn": 54.38,
    "sonst": 150.72,
    "ep": 205.1,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "System-G.",
    "eh": "m²",
    "lohn": 0.0,
    "sonst": 8.73,
    "ep": 8.73,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "System-G.Gebrauchsüberl.",
    "eh": "VE",
    "lohn": 0.0,
    "sonst": 0.38,
    "ep": 0.38,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzmassivwand BSP 10cm 3-lagig",
    "eh": "m²",
    "lohn": 14.41,
    "sonst": 96.19,
    "ep": 110.6,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzmassivwand BSP 12cm 3-lagig",
    "eh": "m²",
    "lohn": 14.41,
    "sonst": 103.32,
    "ep": 117.73,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzmassivwand BSP 9cm 3-lagig",
    "eh": "m²",
    "lohn": 14.41,
    "sonst": 89.93,
    "ep": 104.34,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzmassivdecke BSP 12cm 5-lagig",
    "eh": "m²",
    "lohn": 9.51,
    "sonst": 102.86,
    "ep": 112.37,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzmassivdecke BSP 14cm 5-lagig",
    "eh": "m²",
    "lohn": 9.51,
    "sonst": 109.56,
    "ep": 119.07,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzmassivdecke BSP 6cm 3-lagig",
    "eh": "m²",
    "lohn": 9.51,
    "sonst": 75.71,
    "ep": 85.22,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Pultdach Holzkonstruktion-Rauhschalung 27,9cm",
    "eh": "m²",
    "lohn": 47.96,
    "sonst": 79.54,
    "ep": 127.5,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Satteldach Sparren + Pfetten",
    "eh": "m²",
    "lohn": 14.81,
    "sonst": 57.3,
    "ep": 72.11,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Dach Dampfbremse",
    "eh": "m²",
    "lohn": 4.89,
    "sonst": 4.29,
    "ep": 9.18,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Dachdämmung als Einblasdämmung Zellulose",
    "eh": "m²",
    "lohn": 9.14,
    "sonst": 16.53,
    "ep": 25.67,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Bekleidung Dach innen m.OSB 15mm",
    "eh": "m²",
    "lohn": 10.89,
    "sonst": 7.24,
    "ep": 18.13,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzrahmenwand 20cm dick",
    "eh": "m²",
    "lohn": 52.27,
    "sonst": 90.9,
    "ep": 143.17,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzriegel-Zwischenwand 15cm dick",
    "eh": "m²",
    "lohn": 59.52,
    "sonst": 74.04,
    "ep": 133.56,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Fassadenschalung + UK Lärche gehobelt",
    "eh": "m²",
    "lohn": 60.9,
    "sonst": 74.29,
    "ep": 135.19,
    "quelle": "05025Holzwohnbau Wai"
  },
  {
    "bez": "Holzbalkenlage gedämmt, 25cm dick",
    "eh": "m²",
    "lohn": 57.83,
    "sonst": 91.5,
    "ep": 149.33,
    "quelle": "05025Holzwohnbau Wai"
  }
];
