/**
 * Upload-Helper für Mitarbeiter-bezogene Dokumente (Krankmeldungen + Lohnzettel).
 *
 * Speichert in den Storage-Bucket `ma_dokumente` mit folgender Pfad-Konvention:
 *   {mitarbeiter_id}/krankmeldungen/{uuid}_{safeName}
 *   {mitarbeiter_id}/lohnzettel/{uuid}_{safeName}
 *
 * Bilder werden komprimiert (compressImage); PDFs/Word direkt durchgereicht.
 * Erzeugt einen `dokumente`-Eintrag für die Tabellenverknüpfung.
 */

import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import { sanitizeStorageName, MAX_UPLOAD_BYTES } from "@/lib/uploadHelpers";

export interface UploadMaDokumentInput {
  mitarbeiterId: string;
  subpath: "krankmeldungen" | "lohnzettel";
  file: File;
  ordnerLabel: "krankmeldung" | "lohnzettel";
  notiz?: string;
}

export interface UploadMaDokumentResult {
  dokumentId: string;
  storagePath: string;
}

/**
 * Lädt eine Datei in `ma_dokumente` hoch und legt einen `dokumente`-Eintrag an.
 * Wirft bei Fehlern (Storage-Upload-Fail oder DB-Fail).
 */
export async function uploadMaDokument(
  input: UploadMaDokumentInput,
): Promise<UploadMaDokumentResult> {
  let toUpload = input.file;

  // Bilder komprimieren (Krankmeldungs-Fotos)
  if (input.file.type.startsWith("image/")) {
    try {
      toUpload = await compressImage(input.file);
    } catch {
      // Bei HEIC oder Fehler: Original durchreichen
      toUpload = input.file;
    }
  }

  if (toUpload.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Datei zu groß (max. ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`,
    );
  }

  const safeName = sanitizeStorageName(toUpload.name);
  const id = crypto.randomUUID();
  const storagePath = `${input.mitarbeiterId}/${input.subpath}/${id}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("ma_dokumente")
    .upload(storagePath, toUpload, {
      contentType: toUpload.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) throw upErr;

  const { data: u } = await supabase.auth.getUser();
  const { data: dok, error } = await supabase
    .from("dokumente")
    .insert({
      mitarbeiter_id: input.mitarbeiterId,
      ordner: input.ordnerLabel,
      dateiname: toUpload.name,
      storage_path: storagePath,
      groesse: toUpload.size,
      mimetype: toUpload.type || "application/octet-stream",
      hochgeladen_von: u.user?.id ?? null,
      notizen: input.notiz ?? null,
    } as any)
    .select("id")
    .single();
  if (error) {
    // Cleanup: hochgeladene Datei wieder löschen
    await supabase.storage.from("ma_dokumente").remove([storagePath]);
    throw error;
  }
  return { dokumentId: dok.id, storagePath };
}

/** Erzeugt eine 1h-gültige signed URL zum Öffnen der Datei. */
export async function getMaDokumentSignedUrl(
  storagePath: string,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from("ma_dokumente")
    .createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

/** Löscht Storage-Objekt + dokumente-Eintrag (best effort). */
export async function deleteMaDokument(
  dokumentId: string,
  storagePath: string,
): Promise<void> {
  await supabase.storage.from("ma_dokumente").remove([storagePath]);
  await supabase.from("dokumente").delete().eq("id", dokumentId);
}
