import { supabase } from "@/integrations/supabase/client";

/**
 * Signiert viele Pfade im Bucket „baustellen“ mit möglichst wenigen Aufrufen
 * (createSignedUrls, je 100 Pfade). Je Foto ein eigener createSignedUrl-Aufruf
 * gleichzeitig hat den Storage bei Berichten mit vielen Fotos überlastet
 * (429/544/500, 12.11.2026) – die Fotos blieben dann leer.
 * Liefert Pfad → Signed-URL; nicht signierbare Pfade fehlen in der Map.
 */
export async function signiereBaustellenPfade(
  pfade: string[],
  ttlSekunden: number,
): Promise<Map<string, string>> {
  const ergebnis = new Map<string, string>();
  const eindeutig = [...new Set(pfade.filter(Boolean))];
  for (let i = 0; i < eindeutig.length; i += 100) {
    const teil = eindeutig.slice(i, i + 100);
    const { data, error } = await supabase.storage
      .from("baustellen")
      .createSignedUrls(teil, ttlSekunden);
    if (!error && data) {
      for (const d of data) {
        if (d.path && d.signedUrl) ergebnis.set(d.path, d.signedUrl);
      }
    }
    // Was der Sammelaufruf nicht geliefert hat: einzeln nachholen,
    // aber nacheinander, damit der Storage nicht wieder überrannt wird.
    for (const pfad of teil) {
      if (ergebnis.has(pfad)) continue;
      const { data: einzeln } = await supabase.storage
        .from("baustellen")
        .createSignedUrl(pfad, ttlSekunden);
      if (einzeln?.signedUrl) ergebnis.set(pfad, einzeln.signedUrl);
    }
  }
  return ergebnis;
}
