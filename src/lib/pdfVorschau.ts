/**
 * Erste Seite einer PDF als JPG-Bild (data-URL) — für Vorschau-Kacheln und
 * wenn im Bericht statt eines Fotos eine PDF (z. B. ein Plan) angehängt ist.
 * pdfjs wird erst bei Bedarf geladen.
 */
export async function pdfErsteSeiteAlsJpeg(
  quelle: string | ArrayBuffer,
  maxPx = 512,
  quality = 0.7,
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  // @ts-expect-error — Vite ?url-Import gibt String
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  (pdfjsLib.GlobalWorkerOptions as any).workerSrc = workerUrl;

  const buf = typeof quelle === "string" ? await (await fetch(quelle)).arrayBuffer() : quelle;
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxPx / viewport.width, maxPx / viewport.height);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(scaled.width);
    canvas.height = Math.round(scaled.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: scaled } as any).promise;
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    pdf.destroy();
  }
}

export function istPdf(typOderName: string | null | undefined): boolean {
  if (!typOderName) return false;
  return /^application\/pdf$/i.test(typOderName) || /\.pdf$/i.test(typOderName);
}
