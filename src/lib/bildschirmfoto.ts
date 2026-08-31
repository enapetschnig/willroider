/**
 * Bild vom Bildschirm — für die Änderungswünsche aus der App.
 *
 * Bewusst html2canvas und NICHT getDisplayMedia: Letzteres verlangt bei
 * jedem Mal eine Freigabe und gibt es am Handy gar nicht. html2canvas
 * zeichnet den sichtbaren Ausschnitt aus dem DOM nach — das genügt völlig,
 * um zu zeigen, worum es geht.
 */

/** Was nicht mit aufs Bild soll (z.B. der Melde-Knopf selbst). */
const AUSBLENDEN = '[data-bildschirmfoto="aus"]';

export async function bildschirmfotoMachen(): Promise<string | null> {
  if (typeof document === "undefined") return null;

  try {
    const { default: html2canvas } = await import("html2canvas");

    // Volle INHALTSBREITE aufnehmen, nicht nur das Fenster: Bei breiten
    // Tabellen (Rechnungspositionen) steht das Wichtige oft rechts außerhalb.
    // Im Melde-Dialog lässt sich das Bild dann seitlich schieben.
    // Nach oben gedeckelt, damit kein unhandliches Riesenbild entsteht.
    const inhaltsbreite = Math.max(
      window.innerWidth,
      document.documentElement.scrollWidth || 0,
      document.body.scrollWidth || 0,
    );
    const breite = Math.min(inhaltsbreite, 2600);
    // Je breiter der Inhalt, desto kleiner der Maßstab — die Datei bleibt handlich.
    const massstab = breite > 1600 ? 1 : Math.min(2, 1400 / Math.max(1, breite));

    const leinwand = await html2canvas(document.body, {
      // Waagrecht alles, senkrecht der sichtbare Ausschnitt — das ist das,
      // was der Mensch gerade vor sich hat.
      x: 0,
      y: window.scrollY,
      width: breite,
      height: window.innerHeight,
      scale: Math.max(1, massstab),
      useCORS: true,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      logging: false,
      ignoreElements: (el) => el.matches?.(AUSBLENDEN) ?? false,
    });

    return leinwand.toDataURL("image/jpeg", 0.85);
  } catch (fehler) {
    // Ein fehlgeschlagenes Bild darf die Meldung nicht verhindern.
    console.warn("Bildschirmfoto nicht möglich:", fehler);
    return null;
  }
}

/** Data-URL zu Blob, für den Upload. */
export function datenUrlZuBlob(datenUrl: string): Blob {
  const [kopf, inhalt] = datenUrl.split(",");
  const mime = kopf.match(/data:(.*?);/)?.[1] ?? "image/jpeg";
  const roh = atob(inhalt);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
