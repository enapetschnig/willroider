// Web-Push an alle Geräte einer Person — mit E-Mail als Ersatz, wenn kein
// Gerät angemeldet ist. Genutzt von push-senden (Einzelversand, Test) und
// erinnerungen (Cron). Jeder Versand landet in benachrichtigungen_log.

import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.79.0";
import { sendeMail } from "./mail.ts";

export type Nachricht = {
  titel: string;
  text: string;
  /** Pfad in der App, der beim Antippen geöffnet wird („/taetigkeitsbericht“). */
  url?: string;
  /** Für das Protokoll und die Doppel-Vermeidung. */
  art: string;
  bezug?: string | null;
};

let konfiguriert = false;
export function pushKonfiguriert(): boolean {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  if (!konfiguriert) {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:office@willroider.at", pub, priv);
    konfiguriert = true;
  }
  return true;
}

type Abo = { id: string; endpoint: string; p256dh: string; auth: string; fehler: number };

/**
 * Schickt eine Nachricht an eine Person: Push auf jedes aktive Gerät, sonst
 * E-Mail (wenn gewünscht und eine Adresse da ist). Liefert den Kanal.
 */
export async function sendeAnPerson(
  sb: SupabaseClient,
  userId: string,
  n: Nachricht,
  opts: { mailErsatz?: boolean } = {},
): Promise<{ kanal: "push" | "mail" | "keiner"; geraete: number; fehler: string[] }> {
  const fehler: string[] = [];
  let geraete = 0;

  if (pushKonfiguriert()) {
    const { data: abos } = await sb
      .from("push_abos")
      .select("id, endpoint, p256dh, auth, fehler")
      .eq("user_id", userId)
      .eq("aktiv", true);
    const url = Deno.env.get("APP_URL") ?? "https://www.willroider.app";
    const payload = JSON.stringify({
      title: n.titel,
      body: n.text,
      url: n.url ? `${url.replace(/\/$/, "")}${n.url}` : url,
      tag: `${n.art}:${n.bezug ?? ""}`,
    });
    for (const abo of ((abos ?? []) as Abo[])) {
      try {
        await webpush.sendNotification(
          { endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } },
          payload,
          { TTL: 60 * 60 * 12, urgency: "normal" },
        );
        geraete++;
        await sb.from("push_abos").update({ zuletzt_ok_am: new Date().toISOString(), fehler: 0, letzter_fehler: null }).eq("id", abo.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        const text = `${status} ${(e as Error).message ?? ""}`.trim();
        fehler.push(text);
        // 404/410: Abo ist beim Browser weg → deaktivieren. Sonst zählen,
        // nach 5 Fehlern in Folge ebenfalls aus.
        const weg = status === 404 || status === 410;
        await sb
          .from("push_abos")
          .update({
            fehler: abo.fehler + 1,
            letzter_fehler: text.slice(0, 200),
            aktiv: !(weg || abo.fehler + 1 >= 5),
          })
          .eq("id", abo.id);
      }
    }
  }

  let kanal: "push" | "mail" | "keiner" = geraete > 0 ? "push" : "keiner";

  if (kanal === "keiner" && opts.mailErsatz) {
    const { data: p } = await sb.from("profiles").select("email, vorname").eq("id", userId).maybeSingle();
    const mail = (p as { email?: string | null } | null)?.email;
    if (mail) {
      const url = Deno.env.get("APP_URL") ?? "https://www.willroider.app";
      const link = n.url ? `${url.replace(/\/$/, "")}${n.url}` : url;
      const r = await sendeMail({
        to: mail,
        subject: n.titel,
        text: `${n.text}\n\nZur App: ${link}\n\nTipp: In der App unter Konto → Benachrichtigungen kannst du Push-Nachrichten aufs Handy einschalten.`,
      });
      if (r.ok) kanal = "mail";
      else fehler.push(`Mail: ${r.error}`);
    }
  }

  await sb.from("benachrichtigungen_log").insert({
    user_id: userId,
    art: n.art,
    bezug: n.bezug ?? null,
    kanal,
    titel: n.titel,
    text: n.text,
  });

  return { kanal, geraete, fehler };
}

/** Wurde diese Person zu diesem Anlass in den letzten `stunden` schon benachrichtigt? */
export async function schonGeschickt(
  sb: SupabaseClient,
  userId: string,
  art: string,
  bezug: string | null,
  stunden: number,
): Promise<boolean> {
  const seit = new Date(Date.now() - stunden * 3600 * 1000).toISOString();
  let q = sb
    .from("benachrichtigungen_log")
    .select("id")
    .eq("user_id", userId)
    .eq("art", art)
    .neq("kanal", "keiner")
    .gte("gesendet_am", seit)
    .limit(1);
  q = bezug === null ? q.is("bezug", null) : q.eq("bezug", bezug);
  const { data } = await q;
  return !!data && data.length > 0;
}
