/**
 * HEIC/HEIF (Handy-Fotos von iPhone und manchen Android-Geräten) kann
 * Chrome/Edge/Firefox weder anzeigen noch auf eine Zeichenfläche malen,
 * und jsPDF kann sie nicht einbetten. Deshalb wird HEIC im Browser in JPG
 * umgewandelt — beim Hochladen (compressImage) und als Rückfall beim
 * Anzeigen alter Dateien.
 *
 * Die Umwandlungs-Bibliothek ist groß (~3 MB) und wird nur bei Bedarf
 * nachgeladen.
 */

const HEIC_TYP = /^image\/hei[cf](-sequence)?$/i;
const HEIC_ENDUNG = /\.(heic|heif)$/i;

/** Erkennung über MIME-Typ oder Dateiendung (Android liefert oft keinen Typ). */
export function istHeic(typOderName: { type?: string | null; name?: string | null } | string | null | undefined): boolean {
  if (!typOderName) return false;
  if (typeof typOderName === "string") return HEIC_TYP.test(typOderName) || HEIC_ENDUNG.test(typOderName);
  return HEIC_TYP.test(typOderName.type ?? "") || HEIC_ENDUNG.test(typOderName.name ?? "");
}

/** Wandelt HEIC in einen JPG-Blob. Wirft bei Fehler. */
export async function heicZuJpeg(blob: Blob, quality = 0.85): Promise<Blob> {
  const { heicTo } = await import("heic-to");
  return await heicTo({ blob, type: "image/jpeg", quality });
}

/**
 * Lädt ein Bild von einer (signierten) URL. Ist es HEIC, wird es in JPG
 * umgewandelt. Liefert den Blob oder null.
 */
export async function ladeBildAlsBrowserBlob(url: string, pfadOderTyp?: string | null): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (istHeic(pfadOderTyp) || istHeic(blob.type)) {
      try {
        return await heicZuJpeg(blob);
      } catch (e) {
        console.error("HEIC-Umwandlung fehlgeschlagen", e);
        return null;
      }
    }
    return blob;
  } catch {
    return null;
  }
}
