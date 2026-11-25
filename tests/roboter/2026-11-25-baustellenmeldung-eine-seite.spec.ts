// Probefahrt 25.11.2026 zu J. Maurer (Baustellen):
// „Baustellenmeldungen bitte auf einer A4 Seite darstellen ohne Datenverlust“
//  - Das abgelegte PDF (baustellenanlagePdf) hat immer genau eine Seite, auch bei sehr langen Texten,
//    und alle Angaben stehen drin (Schrift wird kleiner statt zweite Seite).
//  - Das Word-Formular für die Mail: Leerzeilen verkleinert, „Vorraussichtl. Ende“ in eigener Zeile,
//    alle Werte und beide Bauträger-Kästchen sind noch da.
// Läuft gegen den Dev-Server der Testumgebung (lädt /src/lib/*.ts per import()).
import { expect, test } from "@playwright/test";
import PizZip from "pizzip";

const API = process.env.TEST_API_URL ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55410";
test.skip(!API, "nur mit Testumgebung");

const LANG =
  "Abbund und Montage Dachstuhl, Aufstockung in Holzrahmenbauweise, Vordach, Fassade Lärche, Dachdämmung, Spenglerarbeiten, Gerüst, Kran, ";

test("Baustellenmeldung als PDF und Word auf einer A4-Seite ohne fehlende Angaben", async ({ page }) => {
  await page.goto(`${APP}/auth`);
  const erg = await page.evaluate(async (lang) => {
    const pdfMod = await import("/src/lib/baustellenanlagePdf.ts");
    const docxMod = await import("/src/lib/baustellenanlageDocx.ts");
    const b = {
      bvh_name: "BVH-Probe Zubau Halle",
      bauherr: "Bauherr-Probe GmbH",
      baustellen_adresse: "Probeweg 7",
      plz: "9500",
      ort: "Villach",
      bauherr_adresse: "Wohnweg 3",
      start_datum: "2026-11-09",
      end_datum: "2027-05-31",
      kostenstelle: "1409999",
      art_bauarbeiten: lang.repeat(16) + "ENDE-ART",
      auftragssumme: 622549.03,
      anzahl_mitarbeiter: 3,
      bautraeger: false,
      koordinaten_lat: 46.6,
      koordinaten_lng: 13.85,
    } as any;
    const zuText = async (blob: Blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return s;
    };
    const pdf = await zuText(await pdfMod.makeBaustellenanlagePdf(b, "Bauleiter Probe"));
    const kurz = await zuText(await pdfMod.makeBaustellenanlagePdf({ ...b, art_bauarbeiten: "Dachstuhl" }, "Bauleiter Probe"));
    const docx = await docxMod.generateBaustellenanlageDocx(b, "Bauleiter Probe");
    return { pdf, kurz, docxB64: btoa(await zuText(docx)) };
  }, LANG);

  const seiten = (s: string) => (s.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  expect(seiten(erg.kurz)).toBe(1);
  expect(seiten(erg.pdf)).toBe(1);
  for (const t of ["BVH-Probe Zubau Halle", "Bauherr-Probe GmbH", "1409999", "Bauleiter Probe", "31.5.2027", "ENDE-ART", "Nein"]) {
    expect(erg.pdf, t).toContain(t);
  }

  const zip = new PizZip(Buffer.from(erg.docxB64, "base64").toString("binary"), { base64: false } as any);
  const xml = zip.file("word/document.xml")!.asText();
  for (const t of ["BVH-Probe Zubau Halle", "Bauherr-Probe GmbH", "Probeweg 7", "9500 Villach", "1409999", "Bauleiter Probe", "ENDE-ART", "Lohnverrechnung", "Bauhof"]) {
    expect(xml, t).toContain(t);
  }
  // Baubeginn und Ende in getrennten Absätzen
  const absatzMitEnde = xml.slice(xml.lastIndexOf("<w:p", xml.indexOf("Vorraussichtl. Ende:")), xml.indexOf("Vorraussichtl. Ende:"));
  expect(absatzMitEnde).not.toContain("Baubeginn");
  // Leerzeilen zwischen den Feldern klein
  expect((xml.match(/<w:sz w:val="16"\/>/g) ?? []).length).toBeGreaterThan(10);
  // Bauträger: beide Kästchen da, „Nein“ angekreuzt
  expect(xml).toContain("☒");
  expect(xml).toContain("☐");
});
