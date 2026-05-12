// PDF-Text-Extraktion clientseitig via pdfjs-dist.
// Worker wird per Vite ?url-Import geladen (kein CDN nötig).

import * as pdfjsLib from "pdfjs-dist";
// @ts-expect-error — Vite löst ?url-Imports zu URL-String auf
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

(pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerUrl;

/**
 * Extrahiert den gesamten Text einer PDF-Datei.
 * Seiten werden mit doppeltem Zeilenumbruch getrennt.
 */
export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(text.trim());
  }
  return pages.join("\n\n");
}
