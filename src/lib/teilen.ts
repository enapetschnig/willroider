/**
 * Hilfs-Funktionen zum Teilen einer Datei via Web Share API (Mobile/Native)
 * mit Fallback auf Download + WhatsApp Web (Desktop).
 *
 * Wichtig: window.open() MUSS synchron im User-Click-Kontext aufgerufen werden,
 * sonst blockieren Browser den Popup. Deshalb wird der WhatsApp-Web-Tab schon
 * VOR dem await navigator.share() geöffnet (auf Desktop) und nur geschlossen,
 * wenn der native Share doch funktioniert hat.
 */

export interface TeilenInput {
  blob: Blob;
  filename: string;
  /** Begleit-Text (z.B. „Tagesplanung 20.05.2026"). */
  text?: string;
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

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Teilt die PDF — strategieabhängig:
 *
 * - **Mobile (iOS/Android)**: navigator.share mit Files → System-Share-Sheet
 *   öffnet WhatsApp/Mail/Messages direkt. Falls Files nicht unterstützt:
 *   fallback auf nur Text-Share, plus Download.
 *
 * - **Desktop**: WhatsApp Web wird sofort in neuem Tab geöffnet (im User-
 *   Click-Kontext, damit kein Popup-Block), parallel startet der PDF-Download.
 *   User wählt im WhatsApp-Tab den Chat und zieht die PDF hinein.
 *
 * Liefert true wenn nativ via share() geklappt hat, sonst false.
 */
export async function teilenOderDownload(input: TeilenInput): Promise<boolean> {
  const file = new File([input.blob], input.filename, {
    type: input.blob.type || "application/pdf",
  });
  const text = input.text ?? input.filename;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  const mobile = isMobileDevice();
  const canShareFiles =
    typeof navigator !== "undefined" &&
    (navigator as any).canShare?.({ files: [file] });

  // ─── Mobile-Pfad: native Share-API ─────────────────────────────────
  if (mobile && canShareFiles) {
    try {
      await (navigator as any).share({
        files: [file],
        title: text,
        text,
      });
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      // Sonst: Fallback unten
    }
  }

  // ─── Desktop-Pfad (oder Mobile ohne File-Share) ────────────────────
  // 1) WhatsApp Web SOFORT öffnen (synchron im Click-Kontext)
  //    Das funktioniert nur wenn diese Funktion direkt aus einem User-Click
  //    aufgerufen wird — der erste synchrone Schritt nach dem Click.
  const waWindow = window.open(waUrl, "_blank");

  // 2) PDF herunterladen
  downloadBlob(input.blob, input.filename);

  // 3) Wenn Desktop trotzdem canShareFiles unterstützt (Chrome/Edge mit
  //    installierter WhatsApp-Desktop-App), zusätzlich nativen Share probieren
  if (!mobile && canShareFiles) {
    try {
      await (navigator as any).share({
        files: [file],
        title: text,
        text,
      });
      // Native Share hat geklappt — WhatsApp-Web-Tab kann zu (User wollte ja native)
      try {
        waWindow?.close();
      } catch {
        /* ignore */
      }
      return true;
    } catch {
      // Native Share abgelehnt — User nutzt den WhatsApp-Web-Tab
    }
  }

  return false;
}

/** Reiner Download ohne Share-Versuch. */
export function downloadDatei(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}
