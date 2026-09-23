/**
 * Push-Benachrichtigungen (Web Push) — Anmeldung des Geräts.
 *
 * Ablauf: Erlaubnis fragen → beim Browser abonnieren (VAPID-Schlüssel) →
 * Abo in push_abos speichern. Geschickt wird serverseitig (Edge Functions
 * push-senden / erinnerungen). Auf dem iPhone geht das nur, wenn die App
 * auf dem Home-Bildschirm installiert ist.
 */

import { supabase } from "@/integrations/supabase/client";

/** Öffentlicher VAPID-Schlüssel — der private liegt nur am Server. */
export const VAPID_PUBLIC_KEY =
  "BDuZKVfMrIISDeiJVzWRfAv7CRyhUYCyNFxMcS5p8L9XNYbk10ZO9cMzFogAv4x-AuN4eMo4fTEgByPtV1ZxQiU";

export type PushStatus =
  | "nicht_unterstuetzt"
  | "ios_nicht_installiert"
  | "verweigert"
  | "aus"
  | "an";

export function pushUnterstuetzt(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function istIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

export function istInstalliert(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function base64ZuBytes(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registrierung(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const r = await navigator.serviceWorker.getRegistration();
  if (r) return r;
  // „ready" löst nie auf, wenn gar kein Service Worker registriert ist
  // (z. B. im Entwicklungsmodus) — deshalb mit Zeitlimit.
  return await Promise.race<ServiceWorkerRegistration | null>([
    navigator.serviceWorker.ready.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

/** Aktueller Stand auf diesem Gerät. */
export async function pushStatus(): Promise<PushStatus> {
  if (istIos() && !istInstalliert()) return "ios_nicht_installiert";
  if (!pushUnterstuetzt()) return "nicht_unterstuetzt";
  if (Notification.permission === "denied") return "verweigert";
  const reg = await registrierung();
  if (!reg) return "nicht_unterstuetzt";
  const abo = await reg.pushManager.getSubscription();
  return abo ? "an" : "aus";
}

/** Gerät anmelden. Wirft mit verständlicher Meldung. */
export async function pushEinschalten(userId: string): Promise<void> {
  if (istIos() && !istInstalliert()) {
    throw new Error("Auf dem iPhone zuerst die App auf den Home-Bildschirm legen (Teilen → Zum Home-Bildschirm).");
  }
  if (!pushUnterstuetzt()) throw new Error("Dieser Browser unterstützt keine Push-Nachrichten.");
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt.");
  const reg = await registrierung();
  if (!reg) throw new Error("Service Worker nicht bereit — bitte Seite neu laden.");
  let abo = await reg.pushManager.getSubscription();
  if (!abo) {
    abo = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ZuBytes(VAPID_PUBLIC_KEY),
    });
  }
  const j = abo.toJSON();
  // Über die Datenbank-Funktion: sie übernimmt ein Gerät auch dann, wenn es
  // vorher jemand anderem gehörte (geteiltes Tablet). Die Zeilenregel ließe
  // das direkte Überschreiben fremder Zeilen zu Recht nicht zu.
  const { error } = await (supabase as any).rpc("push_abo_registrieren", {
    p_endpoint: abo.endpoint,
    p_p256dh: j.keys?.p256dh ?? "",
    p_auth: j.keys?.auth ?? "",
    p_geraet: navigator.userAgent.slice(0, 160),
  });
  if (error) throw new Error(error.message);
}

/** Gerät abmelden. */
export async function pushAusschalten(): Promise<void> {
  const reg = await registrierung();
  const abo = reg ? await reg.pushManager.getSubscription() : null;
  if (!abo) return;
  await (supabase as any).from("push_abos").delete().eq("endpoint", abo.endpoint);
  await abo.unsubscribe();
}

/** Nach dem Login: bestehendes Browser-Abo still mit dem Konto verknüpfen
 *  (z. B. wenn sich auf demselben Handy jemand anderes anmeldet). */
export async function pushAboAuffrischen(userId: string): Promise<void> {
  try {
    if (!pushUnterstuetzt() || Notification.permission !== "granted") return;
    const reg = await registrierung();
    const abo = reg ? await reg.pushManager.getSubscription() : null;
    if (!abo) return;
    const j = abo.toJSON();
    await (supabase as any).rpc("push_abo_registrieren", {
      p_endpoint: abo.endpoint,
      p_p256dh: j.keys?.p256dh ?? "",
      p_auth: j.keys?.auth ?? "",
      p_geraet: navigator.userAgent.slice(0, 160),
    });
  } catch {
    /* still */
  }
}

/** Beim Abmelden: dieses Gerät vom Konto lösen, damit auf einem geteilten
 *  Gerät keine Erinnerungen der vorigen Person mehr ankommen. Die Erlaubnis
 *  im Browser bleibt; meldet sich jemand an, übernimmt pushAboAuffrischen. */
export async function pushVomKontoLoesen(): Promise<void> {
  try {
    if (!pushUnterstuetzt()) return;
    const reg = await registrierung();
    const abo = reg ? await reg.pushManager.getSubscription() : null;
    if (!abo) return;
    await (supabase as any).from("push_abos").delete().eq("endpoint", abo.endpoint);
  } catch {
    /* still — Abmelden darf daran nicht scheitern */
  }
}

/** Testnachricht an die eigenen Geräte. */
export async function pushTest(): Promise<{ ok: boolean; geraete: number; fehler: string[] }> {
  const { data, error } = await supabase.functions.invoke("push-senden", { body: { an_mich: true } });
  if (error) throw error;
  return data as { ok: boolean; geraete: number; fehler: string[] };
}
