import { supabase } from "@/integrations/supabase/client";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// Storage-Pfad-Sanitization: Umlaut-Translit, ASCII-only, mehrfach-_ kombiniert.
// Original-Dateiname wird separat in der DB-Spalte gespeichert.
export function sanitizeStorageName(name: string): string {
  const translit: Record<string, string> = {
    ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss",
  };
  const ascii = name.replace(/[äöüÄÖÜß]/g, (c) => translit[c] ?? c);
  const safe = ascii.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  const trimmed = safe.replace(/^_+|_+$/g, "");
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return `file-${Date.now()}`;
  }
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

// Kopiert ein Storage-Objekt von einem Bucket+Pfad zu einem anderen.
// Lädt via signed URL und uploadet im Ziel-Bucket.
export async function copyStorageObject(
  srcBucket: string,
  srcPath: string,
  dstBucket: string,
  dstPath: string,
  contentType?: string | null
): Promise<{ error?: string }> {
  const { data: dl, error: dlErr } = await supabase.storage
    .from(srcBucket)
    .download(srcPath);
  if (dlErr || !dl) return { error: dlErr?.message ?? "Download fehlgeschlagen" };
  const { error: upErr } = await supabase.storage
    .from(dstBucket)
    .upload(dstPath, dl, { contentType: contentType ?? undefined, upsert: false });
  if (upErr) return { error: upErr.message };
  return {};
}
