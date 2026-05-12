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

// Pfad-Helpers für Unterordner-Subpaths.

/** Joint Subpath-Teile mit '/', entfernt leere Segmente. */
export function joinSubpath(...parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").trim())
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** Normalisiert einen einzelnen Ordnernamen — entfernt Slashes und problematische Zeichen. */
export function sanitizeFolderName(name: string): string {
  const trimmed = (name ?? "").trim().replace(/[/\\:*?"<>|]/g, "_");
  return trimmed.replace(/\.+$/, "").slice(0, 100);
}

/** Aus allen Subpaths + currentSubpath: die direkten Kindordner extrahieren. */
export function getDirectSubfolders(
  allSubpaths: (string | null)[],
  currentSubpath: string
): string[] {
  const prefix = currentSubpath ? currentSubpath + "/" : "";
  const set = new Set<string>();
  for (const sp of allSubpaths) {
    if (!sp) continue;
    if (currentSubpath && !sp.startsWith(prefix) && sp !== currentSubpath) continue;
    if (!currentSubpath) {
      // alles unter "" — nimm erstes Segment
      const first = sp.split("/")[0];
      if (first) set.add(first);
    } else {
      const rest = sp.slice(prefix.length);
      const first = rest.split("/")[0];
      if (first) set.add(first);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "de"));
}

/** Listet rekursiv alle Files aus einem gedroppten Folder-Entry. */
type DroppedFile = { file: File; relativePath: string };

async function readEntryFiles(
  entry: any,
  pathPrefix: string
): Promise<DroppedFile[]> {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise<DroppedFile[]>((resolve) => {
      entry.file(
        (f: File) => {
          // Hänge den Pfad relativ zur Wurzel an
          const rel = pathPrefix ? joinSubpath(pathPrefix) : "";
          resolve([{ file: f, relativePath: rel }]);
        },
        () => resolve([])
      );
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all: DroppedFile[] = [];
    // readEntries muss mehrfach aufgerufen werden bis leer (Chrome-Limit)
    const readBatch = (): Promise<any[]> =>
      new Promise((resolve) => reader.readEntries((es: any[]) => resolve(es), () => resolve([])));
    while (true) {
      const entries = await readBatch();
      if (!entries || entries.length === 0) break;
      for (const e of entries) {
        const childPrefix = joinSubpath(pathPrefix, entry.name);
        const files = await readEntryFiles(e, childPrefix);
        all.push(...files);
      }
    }
    return all;
  }
  return [];
}

/**
 * Liest ein Drop-Event und gibt alle Dateien inkl. relativem Pfad zurück.
 * Folder-Drop wird rekursiv abgewickelt (Chrome/Edge/Firefox/Safari modern).
 * Falls webkitGetAsEntry nicht verfügbar (alte Browser), Fallback auf flat files.
 */
export async function readDropFiles(
  e: React.DragEvent | DragEvent
): Promise<DroppedFile[]> {
  const items = (e.dataTransfer?.items ?? []) as any;
  const fallbackFiles = e.dataTransfer?.files;
  const supportsEntry =
    items &&
    items.length > 0 &&
    typeof items[0]?.webkitGetAsEntry === "function";
  if (!supportsEntry) {
    const arr: DroppedFile[] = [];
    if (fallbackFiles)
      for (const f of Array.from(fallbackFiles))
        arr.push({ file: f, relativePath: "" });
    return arr;
  }
  const all: DroppedFile[] = [];
  // erst alle Entries sammeln, dann sequentiell verarbeiten (event-Lifetime!)
  const entries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  for (const entry of entries) {
    const files = await readEntryFiles(entry, "");
    all.push(...files);
  }
  return all;
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
