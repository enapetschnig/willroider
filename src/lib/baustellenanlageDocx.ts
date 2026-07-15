import PizZip from "pizzip";
import type { Database } from "@/integrations/supabase/types";

type Baustelle = Database["public"]["Tables"]["baustellen"]["Row"];

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("de-AT") : "";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Lädt das Original-DOCX-Template aus /templates/baustellenanlage.docx,
 * ersetzt jeden FORMTEXT-Feld-Inhalt der Reihe nach mit den Werten und
 * setzt die Bauträger-Checkboxen (Ja/Nein). Liefert ein neues docx-Blob.
 */
export async function generateBaustellenanlageDocx(
  b: Partial<Baustelle>,
  bauleiterName: string
): Promise<Blob> {
  const res = await fetch("/templates/baustellenanlage.docx");
  if (!res.ok) throw new Error("Template konnte nicht geladen werden");
  const arrayBuffer = await res.arrayBuffer();
  const zip = new PizZip(arrayBuffer);

  const docXmlPath = "word/document.xml";
  let xml = zip.file(docXmlPath)?.asText();
  if (!xml) throw new Error("document.xml nicht im Template");

  // ─── Werte in der Reihenfolge der FORMTEXT-Felder im Template ───
  const adrZeile1 = b.baustellen_adresse ?? "";
  const adrZeile2 = [b.plz, b.ort].filter(Boolean).join(" ");
  const koord =
    b.koordinaten_lat != null && b.koordinaten_lng != null
      ? `${Number(b.koordinaten_lat).toFixed(5)}, ${Number(b.koordinaten_lng).toFixed(5)}`
      : "";
  const auftragssumme = b.auftragssumme
    ? new Intl.NumberFormat("de-AT", {
        style: "currency",
        currency: "EUR",
      }).format(Number(b.auftragssumme))
    : "";

  const values: string[] = [
    b.bvh_name ?? "", // 1. Bauvorhaben
    b.bauherr ?? "", // 2. Bauherr
    adrZeile1, // 3. Baustellenanschrift Zeile 1
    adrZeile2, // 4. Baustellenanschrift Zeile 2 (PLZ Ort)
    koord, // 5. Koordinaten Baustelle
    [b.bauherr_adresse, [(b as any).bauherr_plz, (b as any).bauherr_ort].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "), // 6. Wohnanschrift Bauherr (Straße, PLZ Ort)
    fmtDate(b.start_datum), // 7. Baubeginn
    fmtDate(b.end_datum), // 8. Vorr. Ende
    bauleiterName, // 9. Verantwortlicher Bauleiter / § 9 VStG
    b.kostenstelle ?? "", // 10. Erfasst unter
    b.art_bauarbeiten ?? "", // 11. Art der Bauarbeiten
    auftragssumme, // 12. Auftragssumme
    b.anzahl_mitarbeiter != null ? String(b.anzahl_mitarbeiter) : "", // 13. Beschäftigte
  ];

  // ─── FORMTEXT-Replacement ───
  // Jedes FORMTEXT-Feld hat im XML die Struktur:
  //   <w:fldChar fldCharType="separate"/> [füll-runs] <w:fldChar fldCharType="end"/>
  // Wir ersetzen alles zwischen "separate" und dem nächsten "end" mit einem
  // einzigen Run, der den gewünschten Text trägt.
  let i = 0;
  xml = xml.replace(
    /<w:fldChar w:fldCharType="separate"\/>[\s\S]*?<w:fldChar w:fldCharType="end"\/>/g,
    () => {
      const v = values[i] ?? "";
      i++;
      const run = `<w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${escapeXml(
        v
      )}</w:t></w:r><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:fldChar w:fldCharType="end"/>`;
      return run;
    }
  );

  // ─── Bauträger-Checkbox: Ja / Nein ───
  // Das Template hat zwei <w:sdt>...<w14:checkbox>... Blöcke (in der Reihenfolge
  // Ja, Nein). Wir setzen den passenden auf gecheckt (☒ = U+2612), den anderen
  // auf ungecheckt (☐ = U+2610).
  const ja = b.bautraeger === true;
  let checkboxIdx = 0;
  xml = xml.replace(
    /<w:sdt>([\s\S]*?<w14:checkbox>[\s\S]*?<\/w:sdt>)/g,
    (full, inner) => {
      const isJa = checkboxIdx === 0;
      const shouldBeChecked = (isJa && ja) || (!isJa && b.bautraeger === false);
      checkboxIdx++;

      // Update <w14:checked w14:val="0"/> ↔ <w14:checked w14:val="1"/>
      let result = inner.replace(
        /<w14:checked w14:val="[01]"\/>/,
        shouldBeChecked ? '<w14:checked w14:val="1"/>' : '<w14:checked w14:val="0"/>'
      );
      // Update sichtbares Glyph ☐ → ☒ in <w:sdtContent>
      // Beide Codepoints: ☐ = ☐ ; ☒ = ☒
      const targetGlyph = shouldBeChecked ? "☒" : "☐";
      result = result.replace(
        /(<w:sdtContent>[\s\S]*?<w:t>)[☐☒](<\/w:t>)/,
        `$1${targetGlyph}$2`
      );
      return `<w:sdt>${result}`;
    }
  );

  zip.file(docXmlPath, xml);

  const out = zip.generate({ type: "blob", mimeType: DOCX_MIME, compression: "DEFLATE" });
  return out;
}

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
