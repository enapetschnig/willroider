// Ordner-Klasse aus dem echten SharePoint-Ordnernamen — Gegenstück zu
// src/lib/ordnerKlasse.ts (bei Änderung beide nachziehen).
//
// Ersetzt die Tabellen sharepoint_ordner_mapping / sharepoint_upload_ziel:
// Egal wie ein Bauleiter nummeriert („1-", „02-", gar nicht) — der Name
// entscheidet. Die Klasse steuert Rechte und automatische Ablagen; in der
// App wird der echte Name gezeigt.

export function ordnerKlasse(name: string | null | undefined): string {
  const n = (name ?? "")
    .toLowerCase()
    .replace(/^\d+[-_. ]*/, "")
    .trim();
  if (!n) return "92-sonstiges";
  if (/baustellenmanagement/.test(n)) return "1-baustellenmanagement";
  if (/schriftverkehr/.test(n)) return "2-schriftverkehr";
  if (/vertrag/.test(n)) return "4-vertrag";
  if (/aktenvermerk/.test(n)) return "3-aktenvermerke";
  if (/\bsub|professionist/.test(n)) return "5-subunternehmer-professionisten";
  if (/rechnung/.test(n)) return "6-abrechnung";
  if (/lieferant/.test(n)) return "7-lieferanten";
  if (/leistungsverzeichnis|^lv\b/.test(n)) return "95-leistungsverzeichnis";
  if (/kalkulation|angebot/.test(n)) return "8-kalkulation";
  if (/pl(ä|ae)n|ausarbeitung/.test(n)) return "91-plaene";
  if (/dhp/.test(n)) return "93-dhp";
  if (/statik/.test(n)) return "94-statik";
  if (/^(fotos?|bilder|photos?)$/.test(n)) return "fotos";
  if (/unterweisung|evaluierung/.test(n)) return "evaluierung";
  return "92-sonstiges";
}

/**
 * Klasse einer Datei aus ihren Pfadsegmenten (ohne Dateiname): die Klasse
 * des obersten Ordners — außer ein Unterordner „Fotos" darunter, der zählt
 * als Fotos (so lag es in allen Vorlagen).
 */
export function dateiKlasse(segmente: string[]): { ordner: string; top: string; subpath: string } {
  if (segmente.length === 0) return { ordner: "92-sonstiges", top: "", subpath: "" };
  const [top, ...rest] = segmente;
  let ordner = ordnerKlasse(top);
  if (rest.length > 0 && /^(fotos?|bilder)$/i.test(rest[0]) && ordner !== "fotos") {
    ordner = "fotos";
  }
  return { ordner, top, subpath: rest.join("/") };
}
