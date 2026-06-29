// Send-SMS-Hook für Supabase Auth.
//
// Wird von Supabase Auth aufgerufen, wenn ein User per signInWithOtp({phone})
// einen Code anfordert. Supabase generiert den OTP-Code und übergibt ihn uns
// — wir verschicken ihn via Twilio.
//
// Vorteil dieses Setups gegenüber dem nativen Twilio-Provider in Auth:
// Twilio-Credentials leben an EINER Stelle (Edge-Function-Secrets).
//
// Erwartete ENV:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER   (gesetzt)
//   SEND_SMS_HOOK_SECRET  (von Supabase Auth → Auth Hooks; Format
//                          'v1,whsec_<base64>')

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const HOOK_SECRET_RAW = Deno.env.get('SEND_SMS_HOOK_SECRET') ?? '';
// Supabase liefert das Secret im Format "v1,whsec_<base64>".
// Die Webhook-Lib will den base64-Teil.
const HOOK_SECRET = HOOK_SECRET_RAW.replace(/^v1,whsec_/, '');

const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_FROM = Deno.env.get('TWILIO_PHONE_NUMBER');

interface SmsHookPayload {
  user: {
    id: string;
    phone?: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  sms: {
    otp: string;
    sms_type: string;
  };
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { http_code: status, message } }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

Deno.serve(async (req) => {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return errorResponse(
      500,
      'Twilio-Credentials nicht konfiguriert (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER)',
    );
  }

  const body = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));

  let payload: SmsHookPayload;
  if (HOOK_SECRET) {
    try {
      const wh = new Webhook(HOOK_SECRET);
      payload = wh.verify(body, headers) as SmsHookPayload;
    } catch (e) {
      console.error('Webhook-Signatur ungültig:', e);
      return errorResponse(401, 'Invalid webhook signature');
    }
  } else {
    try {
      payload = JSON.parse(body) as SmsHookPayload;
    } catch {
      return errorResponse(400, 'Body ist kein gültiges JSON');
    }
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return errorResponse(400, 'phone oder otp fehlt im Payload');
  }

  const to = phone.startsWith('+') ? phone : '+' + phone;
  const smsText = `Holzbau Willroider — dein Login-Code: ${otp}\n\nGültig 60 Sek. Niemals an Dritte weitergeben.`;

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const twilioRes = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: TWILIO_FROM,
      Body: smsText,
    }),
  });

  if (!twilioRes.ok) {
    const errData = await twilioRes.json().catch(() => ({}));
    console.error('Twilio error:', errData);
    return errorResponse(
      502,
      `Twilio-Versand fehlgeschlagen: ${errData?.message ?? 'unbekannt'}`,
    );
  }

  return new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
