/**
 * Hilfs-Funktionen zum Teilen einer Datei via Web Share API
 * mit Fallback auf Download + Verknüpfungs-Link (WhatsApp Web).
 */

export interface TeilenInput {
  blob: Blob;
  filename: string;
  /** Begleit-Text (z.B. „Tagesplanung 20.05.2026"). */
  text?: string;
  /** Beim Fallback (kein Share-API) wird WhatsApp Web mit diesem Text geöffnet. */
  whatsappFallback?: boolean;
}

/** Lädt eine Datei mit einem Browser-Download herunter. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Öffnet WhatsApp Web (Desktop) oder WhatsApp-App (Mobile) mit pre-filled Text. */
function openWhatsAppWeb(text: string) {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

/**
 * Versucht die Datei zu teilen.
 *
 * - Auf Mobile (iOS/Android Chrome/Safari): native Share-Sheet via navigator.share
 *   (zeigt WhatsApp, Mail, Messages, etc. zur Auswahl)
 * - Auf Desktop: nicht alle Browser können Files sharen → Download startet,
 *   parallel öffnet WhatsApp Web mit Text + Anweisung „PDF ins Chat-Fenster ziehen"
 *
 * Liefert true wenn nativ via share() geklappt hat, sonst false (Fallback ausgeführt).
 */
export async function teilenOderDownload(input: TeilenInput): Promise<boolean> {
  const file = new File([input.blob], input.filename, {
    type: input.blob.type || "application/pdf",
  });
  const text = input.text ?? input.filename;

  // 1) Versuch: Web Share API mit Datei (klappt auf Mobile + Chromium-Desktop)
  if (typeof navigator !== "undefined" && (navigator as any).canShare?.({ files: [file] })) {
    try {
      await (navigator as any).share({
        files: [file],
        title: text,
        text,
      });
      return true;
    } catch (e) {
      // User hat abgebrochen oder API-Fehler — Fallback nicht starten wenn AbortError
      if ((e as Error).name === "AbortError") return false;
      // Sonst: weiter zum Fallback
    }
  }

  // 2) Fallback: Download + WhatsApp Web öffnen mit Anweisung
  downloadBlob(input.blob, input.filename);
  if (input.whatsappFallback !== false) {
    openWhatsAppWeb(text + " (PDF im Download-Ordner — bitte ins Chat ziehen)");
  }
  return false;
}

/** Reiner Download ohne Share-Versuch. */
export function downloadDatei(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}
