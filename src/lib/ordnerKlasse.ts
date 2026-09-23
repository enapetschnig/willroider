/**
 * Ordner-Klasse: ordnet einen echten SharePoint-Ordnernamen einer der
 * App-Ordnerarten zu — über den Namen, nicht über eine Tabelle je Bauleiter.
 *
 * Damit gilt für alle Nummerierungen dasselbe: „1-Baustellenmanagement",
 * „02-Baustellenmanagement" und „Baustellenmanagement" sind dieselbe Klasse.
 * Die Klasse steuert nur noch Rechte (wer darf welche Art sehen), Farben
 * und die automatischen Ablagen. Angezeigt wird der echte Name.
 *
 * Gegenstück in supabase/functions/_shared/ordnerklasse.ts — bei Änderung
 * beide nachziehen (Änderungswunsch Elias Winkler, 21.09.2026).
 */

import type { OrdnerKey } from "@/lib/baustellenOrdner";

export function ordnerKlasse(name: string | null | undefined): OrdnerKey {
  const n = (name ?? "")
    .toLowerCase()
    .replace(/^\d+[-_. ]*/, "")
    .trim();
  if (!n) return "92-sonstiges";
  if (/baustellenmanagement/.test(n)) return "1-baustellenmanagement";
  // „Vertrag, Schriftverkehr" ist der Berichtsordner — Schriftverkehr vor Vertrag prüfen.
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
 * Klasse aus oberstem Ordner + Unterpfad — muss mit pfadKlasse in
 * supabase/functions/_shared/ordnerklasse.ts übereinstimmen: ein Unterordner
 * „Fotos" gilt als Fotos, „Unterweisung"/„Evaluierung" als Unterweisung,
 * sonst zählt der oberste Ordner. Sonst lehnt die Speicherregel z. B. ein
 * Foto eines Mitarbeiters in „02-Baustellenmanagement/Fotos" ab.
 */
export function pfadKlasse(top: string, subpath: string | null | undefined): OrdnerKey {
  const erstes = (subpath ?? "").split("/")[0]?.trim() ?? "";
  if (/^(fotos?|bilder)$/i.test(erstes)) return "fotos";
  if (/unterweisung|evaluierung/i.test(erstes)) return "evaluierung";
  return ordnerKlasse(top);
}

/** Pfadteil für Speicher-Schlüssel: Supabase lehnt Umlaute und manche
 *  Sonderzeichen im Schlüssel ab. Der Anzeigename bleibt unverändert. */
export function speicherPfadTeil(teil: string): string {
  return teil
    .replace(/[äöüÄÖÜß]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" })[c] ?? c)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.\- ]+/g, "_")
    .trim() || "_";
}
