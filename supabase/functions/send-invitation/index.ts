// SMS-Zugang neu verschicken für manuell angelegte Mitarbeiter.
//
// Aufgerufen vom Admin-UI „Zugang senden" (AdminZugangVerschicken).
// Tut atomar:
//   1. Hard-Gate: nur profiles.angelegt_manuell = TRUE → schützt selbst-
//      registrierte User vor versehentlichem Passwort-Reset.
//   2. Telefonnummer übernehmen (falls vorher leer): profiles.telefon updaten +
//      bei auth.users phone setzen (mit phone_confirm).
//   3. Neues lesbares Initial-Passwort generieren + via
//      auth.admin.updateUserById() setzen.
//   4. Magic-Link generieren (nur wenn Email vorhanden) — sonst Telefon-OTP-
//      Anleitung in der SMS.
//   5. SMS via Twilio versenden + invitation_logs-Eintrag schreiben.
//
// Antwort: 200 + { success, twilio_sid, telefon, initial_password,
//                  magic_link, sms_status, sms_error }
// Bei Fehler: 200 + { success: false, error } (kein Throw, damit Frontend
// per supabase.functions.invoke sauber rendern kann).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.79.0';
import {
  normalizeAtPhone,
  generateReadablePassword,
  composeInvitationSms,
} from '../_shared/sms.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvitationRequest {
  /** Profil-ID (= auth.users.id). Pflicht — Hard-Gate prüft angelegt_manuell. */
  profile_id: string;
  /** Optional: neue/abweichende Telefonnummer. Format: AT (0664…) oder E.164.
   *  Wird normalisiert und in profiles.telefon + auth.users.phone übernommen. */
  telefon_override?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Kein Authorization-Header' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    // Admin-Check via is_admin_role-RPC
    const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin_role', {
      _user_id: user.id,
    });
    if (roleError || !isAdmin) {
      console.error('Admin check failed', roleError);
      return jsonResponse({ success: false, error: 'Forbidden: Admin only' }, 403);
    }

    const body: InvitationRequest = await req.json();
    if (!body.profile_id) {
      return jsonResponse({ success: false, error: 'profile_id fehlt' });
    }

    // ─── Profil laden + Hard-Gate ──────────────────────────────────────
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, vorname, nachname, email, telefon, angelegt_manuell, is_active')
      .eq('id', body.profile_id)
      .maybeSingle();

    if (profileErr || !profile) {
      console.error('Profile lookup failed:', profileErr);
      return jsonResponse({ success: false, error: 'Mitarbeiter nicht gefunden' });
    }

    if (!profile.angelegt_manuell) {
      return jsonResponse({
        success: false,
        error:
          'Dieser Mitarbeiter hat sich selbst registriert. Zugang per SMS verschicken ist nur für manuell angelegte Mitarbeiter erlaubt.',
      });
    }

    // ─── Telefonnummer ermitteln (Override > Profil) ───────────────────
    const telefonRaw = body.telefon_override ?? profile.telefon ?? '';
    const telefonE164 = normalizeAtPhone(telefonRaw);
    if (!telefonE164) {
      return jsonResponse({
        success: false,
        error: 'Ungültige Telefonnummer. Format z.B. 0664 1234567 oder +43 664 1234567.',
      });
    }

    // Wenn Override angegeben oder Profil-Telefon abweicht: aktualisieren
    if (telefonE164 !== profile.telefon) {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ telefon: telefonE164 })
        .eq('id', profile.id);
      if (updErr) {
        console.error('profiles.telefon update failed:', updErr);
        return jsonResponse({
          success: false,
          error: `Telefonnummer konnte nicht gespeichert werden: ${updErr.message}`,
        });
      }
    }

    // ─── Neues Initial-Passwort setzen ─────────────────────────────────
    const initialPassword = generateReadablePassword(10);
    const updatePayload: Record<string, unknown> = {
      password: initialPassword,
    };
    // Auch die phone-Spalte in auth.users syncen, falls geändert
    if (telefonE164 !== profile.telefon) {
      updatePayload.phone = telefonE164;
      updatePayload.phone_confirm = true;
    }
    const { error: pwErr } = await supabase.auth.admin.updateUserById(
      profile.id,
      updatePayload,
    );
    if (pwErr) {
      console.error('updateUserById failed:', pwErr);
      return jsonResponse({
        success: false,
        error: `Passwort-Reset fehlgeschlagen: ${pwErr.message}`,
      });
    }

    // ─── Twilio-Credentials prüfen ─────────────────────────────────────
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFrom = Deno.env.get('TWILIO_PHONE_NUMBER');
    if (!twilioSid || !twilioToken || !twilioFrom) {
      return jsonResponse({
        success: false,
        error:
          'Twilio-Credentials nicht konfiguriert. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in Supabase-Secrets setzen.',
      });
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://holzerleben.app';

    // ─── Magic-Link (nur wenn echte Email vorhanden) ───────────────────
    // Beim Import wurden Fake-Adressen "pers-XXX@willroider.invalid" gesetzt
    // als Platzhalter. Die sollen den MA in der SMS nicht verwirren und
    // sollen auch nicht für Magic-Links missbraucht werden.
    const hasRealEmail =
      !!profile.email && !profile.email.endsWith('@willroider.invalid');
    let magicLink: string | null = null;
    if (hasRealEmail) {
      const { data: linkRes, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: profile.email!,
        options: { redirectTo: `${appUrl}/` },
      });
      if (linkErr) {
        console.warn('generateLink warn (non-fatal):', linkErr);
      } else {
        magicLink = linkRes?.properties?.action_link ?? null;
      }
    }

    // ─── SMS-Text bauen ────────────────────────────────────────────────
    const smsText = composeInvitationSms({
      vorname: profile.vorname || undefined,
      telefon: telefonE164,
      email: hasRealEmail ? profile.email : null,
      magicLink,
      initialPassword,
      appUrl,
    });

    // ─── Twilio-Aufruf ─────────────────────────────────────────────────
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: telefonE164,
        From: twilioFrom,
        Body: smsText,
      }),
    });
    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error('Twilio error:', twilioData);
      await supabase.from('invitation_logs').insert({
        profile_id: profile.id,
        telefonnummer: telefonE164,
        gesendet_von: user.id,
        status: 'fehler',
        fehler: twilioData?.message ?? JSON.stringify(twilioData).slice(0, 500),
        sms_text: smsText,
      });
      return jsonResponse({
        success: false,
        error: `SMS-Versand fehlgeschlagen: ${twilioData?.message ?? 'unbekannt'}`,
        initial_password: initialPassword, // Passwort wurde gesetzt — Admin kann es mündlich weitergeben
        magic_link: magicLink,
        sms_status: 'error',
        sms_error: twilioData?.message ?? 'unbekannt',
      });
    }

    // Erfolg loggen
    await supabase.from('invitation_logs').insert({
      profile_id: profile.id,
      telefonnummer: telefonE164,
      gesendet_von: user.id,
      status: 'gesendet',
      twilio_sid: twilioData.sid,
      sms_text: smsText,
    });

    return jsonResponse({
      success: true,
      twilio_sid: twilioData.sid,
      telefon: telefonE164,
      email: profile.email,
      initial_password: initialPassword,
      magic_link: magicLink,
      sms_status: 'sent',
      sms_error: null,
      vorname: profile.vorname,
      nachname: profile.nachname,
      user_id: profile.id,
    });
  } catch (error) {
    console.error('send-invitation error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten',
    });
  }
});
