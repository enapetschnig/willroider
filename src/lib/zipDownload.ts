/**
 * Mehrere Dateien als eine ZIP herunterladen (Wunsch J. Maurer, 22.10.2026:
 * Stunden- und Tätigkeitsberichte gesammelt herunterladen). Der Browser
 * blockiert viele Einzel-Downloads hintereinander — darum eine ZIP.
 */
import JSZip from "jszip";

export async function zipHerunterladen(
  dateien: { name: string; inhalt: Blob }[],
  zipName: string,
): Promise<void> {
  const zip = new JSZip();
  const vergeben = new Set<string>();
  for (const d of dateien) {
    // Gleiche Namen (z. B. zwei Stände) nicht überschreiben.
    let name = d.name.replace(/[\\/:*?"<>|]/g, "_");
    for (let i = 2; vergeben.has(name.toLowerCase()); i++) name = d.name.replace(/(\.\w+)?$/, ` (${i})$1`);
    vergeben.add(name.toLowerCase());
    zip.file(name, d.inhalt);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  dateiHerunterladen(blob, zipName.endsWith(".zip") ? zipName : `${zipName}.zip`);
}

/**
 * Datei direkt auf dieser Seite speichern, ohne neues Fenster. Ein Fenster, das
 * erst nach dem Laden aufgeht, sperren Browser ab dem zweiten Mal; im
 * Download-Ordner liegt dann immer nur die erste Datei (J. Maurer, 04.11.2026).
 */
export function dateiHerunterladen(inhalt: Blob, name: string): void {
  const url = URL.createObjectURL(inhalt);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
