/**
 * WhatsApp-Sharing für PDFs — direkt in 1 Klick auf Mobile UND Desktop.
 *
 * Strategie:
 *  1. Mobile: navigator.share({ files }) → System-Share-Sheet → WhatsApp direkt
 *  2. Desktop / Fallback: PDF wird in Storage-Bucket "share-temp" hochgeladen,
 *     signed URL (7 Tage) erzeugt, WhatsApp Web mit pre-filled Text + URL geöffnet.
 *     Der Empfänger bekommt einen klickbaren Link.
 *  3. Letzter Fallback: nur Download (z.B. wenn Bucket fehlt).
 */

import { supabase } from "@/integrations/supabase/client";

export interface TeilenInput {
  blob: Blob;
  filename: string;
  /** Begleit-Text (z.B. „Arbeitseinteilung Mittwoch 20.05.2026"). */
  text: string;
}

export type TeilenMode = "share" | "url" | "download" | "missing-bucket";

export interface TeilenResult {
  ok: boolean;
  mode: TeilenMode;
  message?: string;
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

/**
 * Teilt eine PDF via WhatsApp — Mobile native, Desktop via Cloud-Upload + URL.
 * Funktioniert auch ohne native Share-API: PDF wird ins Storage hochgeladen
 * und der Empfänger bekommt einen signed URL.
 */
export async function teilePdfViaWhatsApp(
  input: TeilenInput,
): Promise<TeilenResult> {
  const file = new File([input.blob], input.filename, {
    type: "application/pdf",
  });

  // 1) Native Share — auf Mobile fast immer, auf Desktop nur mit installierter
  //    WhatsApp-Desktop-App + Browser-Share-Sheet
  if ((navigator as any).canShare?.({ files: [file] })) {
    try {
      await (navigator as any).share({
        files: [file],
        title: input.text,
        text: input.text,
      });
      return { ok: true, mode: "share" };
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return { ok: false, mode: "share", message: "Vom User abgebrochen" };
      }
      // Sonst: Cloud-Upload-Pfad
    }
  }

  // 2) Cloud-Upload + WhatsApp-Web-Link (Standard-Pfad auf Desktop)
  try {
    const id = crypto.randomUUID();
    const path = `${id}/${input.filename}`;
    const { error: upErr } = await supabase.storage
      .from("share-temp")
      .upload(path, input.blob, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upErr) {
      // Bucket fehlt? Spezifische Behandlung.
      const msg = upErr.message?.toLowerCase() ?? "";
      if (msg.includes("bucket") && msg.includes("not found")) {
        downloadBlob(input.blob, input.filename);
        return {
          ok: false,
          mode: "missing-bucket",
          message: "Storage-Bucket 'share-temp' fehlt — bitte Setup ausführen",
        };
      }
      throw upErr;
    }
    const { data: signed, error: urlErr } = await supabase.storage
      .from("share-temp")
      .createSignedUrl(path, 7 * 24 * 3600); // 7 Tage gültig
    if (urlErr || !signed?.signedUrl) {
      throw urlErr || new Error("Signed URL fehlgeschlagen");
    }
    const waText = `${input.text}\n${signed.signedUrl}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
    // window.open synchron — direkt im User-Click-Kontext aufrufen!
    // Da diese Funktion async ist und await drüber kommt, kann der Browser
    // das blockieren. Caller sollte synchron oben einen "platzhalter"-Tab
    // öffnen können, aber das ist für V1 ein akzeptables Trade-Off:
    // wenn Popup geblockt wird, gibt's Toast-Anweisung.
    const w = window.open(waUrl, "_blank");
    if (!w) {
      // Popup blockiert — Caller soll Modal mit "WhatsApp Web öffnen"-Button zeigen
      return {
        ok: true,
        mode: "url",
        message: signed.signedUrl,
      };
    }
    return { ok: true, mode: "url" };
  } catch (e) {
    // 3) Letzter Fallback: Download
    downloadBlob(input.blob, input.filename);
    return {
      ok: false,
      mode: "download",
      message: (e as Error).message,
    };
  }
}

/** Reiner Download ohne Share-Versuch. */
export function downloadDatei(blob: Blob, filename: string) {
  downloadBlob(blob, filename);
}

/**
 * Alte API-Kompatibilität — Wrapper um teilePdfViaWhatsApp damit bestehender Code
 * weiterläuft. Liefert true wenn nativ geteilt wurde, sonst false.
 */
export async function teilenOderDownload(input: {
  blob: Blob;
  filename: string;
  text?: string;
}): Promise<boolean> {
  const r = await teilePdfViaWhatsApp({
    blob: input.blob,
    filename: input.filename,
    text: input.text ?? input.filename,
  });
  return r.mode === "share";
}
