/**
 * Client-Komprimierung von Fotos vor dem Upload.
 * Resize auf maxSide=2000 px lange Seite, JPEG q=0.85.
 * iPhone-Original (~8 MB) → ~400 KB.
 *
 * Fallback (HEIC/Crash) → Original wird zurückgegeben.
 */

const MAX_SIDE = 2000;
const QUALITY = 0.85;

function imageBitmapVerfuegbar(): boolean {
  return typeof createImageBitmap === "function";
}

async function loadImage(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if (imageBitmapVerfuegbar()) {
    try {
      return await createImageBitmap(file);
    } catch {
      // weiter zu HTMLImage-Fallback
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/**
 * Komprimiert ein Bild-File. Gibt ein neues File mit gleichem Namen aber
 * Suffix `.jpg` zurück. Bei Fehler oder unbekanntem Format → Original.
 */
export async function compressImage(file: File): Promise<File> {
  // Nur Bilder bearbeiten — sonst Original durchreichen
  if (!file.type.startsWith("image/")) return file;
  // HEIC kann der Browser nicht rendern → Original durchlassen
  if (/hei[cf]/i.test(file.type)) return file;

  try {
    const img = await loadImage(file);
    const w = (img as any).width as number;
    const h = (img as any).height as number;
    if (!w || !h) return file;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img as any, 0, 0, tw, th);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
