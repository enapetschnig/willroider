import exifr from "exifr";

/**
 * Liest EXIF-Daten aus einem Foto. Fällt graziös zurück auf file.lastModified
 * wenn keine EXIF-Infos vorhanden.
 */
export interface FotoMeta {
  geo_lat: number | null;
  geo_lng: number | null;
  aufgenommen_am: string | null; // ISO
}

export async function readFotoMeta(file: File): Promise<FotoMeta> {
  let geo_lat: number | null = null;
  let geo_lng: number | null = null;
  let aufgenommen_am: string | null = null;
  try {
    const data = await exifr.parse(file, {
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate", "GPSLatitude", "GPSLongitude"],
    });
    if (data) {
      if (typeof data.latitude === "number" && typeof data.longitude === "number") {
        geo_lat = data.latitude;
        geo_lng = data.longitude;
      }
      const dt = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate;
      if (dt instanceof Date) aufgenommen_am = dt.toISOString();
      else if (typeof dt === "string") aufgenommen_am = new Date(dt).toISOString();
    }
  } catch {
    // EXIF nicht lesbar — kein Problem
  }
  if (!aufgenommen_am && file.lastModified) {
    aufgenommen_am = new Date(file.lastModified).toISOString();
  }
  return { geo_lat, geo_lng, aufgenommen_am };
}
