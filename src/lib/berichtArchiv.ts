/**
 * Berichte-Archiv: fertige PDFs (Tätigkeitsbericht nach Freigabe,
 * Stundenbericht nach Bestätigung) in der App aufheben und als Kopie nach
 * SharePoint legen. Abgestimmt mit Johannes Maurer am 21.09.2026.
 *
 * Ablauf: PDF → Bucket „berichte-archiv" (<art>/<jahr>/<mitarbeiter>/…)
 * → Zeile in bericht_archiv → Edge Function bericht-ablegen kopiert nach
 * SharePoint (Unterordner je Jahr). Schlägt die Kopie fehl, holt der
 * Cron „bericht-ablage-nachholen" sie alle 10 Minuten nach.
 */

import type jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

export type ArchivArt = "taetigkeitsbericht" | "stundenbericht";

export interface ArchivEintrag {
  art: ArchivArt;
  mitarbeiterId: string;
  jahr: number;
  monat: number;
  teil?: number | null;
  periodeLabel: string;
  dateiname: string;
  /** Fertiges PDF — entweder das jsPDF-Dokument oder die Bytes. */
  doc?: jsPDF;
  blob?: Blob;
  berichtId?: string | null;
}

function sicherName(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim().slice(0, 150);
}

/** Storage-Schlüssel dürfen keine Umlaute enthalten (Supabase lehnt „ä“ ab) —
 *  der Anzeigename und die SharePoint-Datei behalten sie. */
function asciiName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^\w.\- ]/g, "_");
}

/** Legt das PDF ab und stößt die SharePoint-Kopie an. Liefert die Archiv-ID. */
export async function archiviereBericht(e: ArchivEintrag): Promise<string> {
  const blob = e.blob ?? (e.doc ? (e.doc.output("blob") as Blob) : null);
  if (!blob) throw new Error("Kein PDF zum Ablegen");
  const dateiname = sicherName(e.dateiname.endsWith(".pdf") ? e.dateiname : `${e.dateiname}.pdf`);
  // Eindeutiger Pfad: bei erneuter Freigabe kommt eine neue Datei dazu,
  // die alte bleibt (wie in SharePoint — dort wird nie überschrieben).
  const stempel = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const pfad = `${e.art}/${e.jahr}/${e.mitarbeiterId}/${stempel} ${asciiName(dateiname)}`;

  const { error: upErr } = await supabase.storage
    .from("berichte-archiv")
    .upload(pfad, blob, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`Ablage fehlgeschlagen: ${upErr.message}`);

  const { data: user } = await supabase.auth.getUser();
  const { data: zeile, error: insErr } = await (supabase as any)
    .from("bericht_archiv")
    .insert({
      art: e.art,
      mitarbeiter_id: e.mitarbeiterId,
      jahr: e.jahr,
      monat: e.monat,
      teil: e.teil ?? null,
      periode_label: e.periodeLabel,
      storage_pfad: pfad,
      dateiname,
      groesse: blob.size,
      bericht_id: e.berichtId ?? null,
      erstellt_von: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`Archiv-Eintrag fehlgeschlagen: ${insErr.message}`);

  // SharePoint-Kopie im Hintergrund — Fehler holt der Cron nach.
  supabase.functions
    .invoke("bericht-ablegen", { body: { modus: "ablegen", archiv_id: zeile.id } })
    .catch(() => undefined);

  return zeile.id as string;
}

/** Base64 (ohne data:-Präfix) → Blob, für PDFs, die schon als Anhang vorbereitet sind. */
export function base64ZuBlob(b64: string, typ = "application/pdf"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: typ });
}

/** Kurzlebiger Download-Link auf eine Archiv-Datei. */
export async function archivDownloadUrl(storagePfad: string, dateiname: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("berichte-archiv")
    .createSignedUrl(storagePfad, 120, { download: dateiname });
  if (error || !data?.signedUrl) throw error ?? new Error("Kein Link");
  return data.signedUrl;
}
