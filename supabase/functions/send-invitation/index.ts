// Zugang neu verschicken für manuell angelegte Mitarbeiter — per SMS,
// E-Mail oder beidem (kanal-Parameter; Standard SMS wie bisher).
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
import { composeInvitationEmail, sendeEinladungsMail } from '../_shared/mail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvitationRequest {
  /** Profil-ID (= auth.users.id). Pflicht — Hard-Gate prüft angelegt_manuell. */
  profile_id: string;
  /** Ausdrückliche Bestätigung, dass das bestehende Passwort eines
   *  selbst registrierten Nutzers zurückgesetzt werden darf. */
  reset_bestaetigt?: boolean;
  /** Optional: neue/abweichende Telefonnummer. Format: AT (0664…) oder E.164.
   *  Wird normalisiert und in profiles.telefon + auth.users.phone übernommen. */
  telefon_override?: string;
  /** Versandweg. Standard 'sms' — bestehende Aufrufer bleiben unverändert. */
  kanal?: 'sms' | 'email' | 'beide';
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

    // Selbst registrierte Nutzer sind geschützt: ein Versand setzt ihr
    // Passwort zurück. Das darf nicht VERSEHENTLICH passieren — mit
    // ausdrücklicher Bestätigung aus der Oberfläche (reset_bestaetigt)
    // ist es aber erlaubt, sonst käme man an sie nie wieder heran.
    if (!profile.angelegt_manuell && !body.reset_bestaetigt) {
      return jsonResponse({
        success: false,
        error:
          'Dieser Mitarbeiter hat sich selbst registriert. Ein Versand setzt sein bestehendes Passwort zurück — bitte in der Oberfläche ausdrücklich bestätigen.',
      });
    }

    const kanal = body.kanal === 'email' || body.kanal === 'beide' ? body.kanal : 'sms';
    const willSms = kanal === 'sms' || kanal === 'beide';
    const willMail = kanal === 'email' || kanal === 'beide';

    // Echte E-Mail? Die Import-Platzhalter (…@willroider.invalid) taugen
    // weder für Magic-Links noch für den Versand.
    const hasRealEmail =
      !!profile.email && !profile.email.endsWith('@willroider.invalid');
    if (willMail && !hasRealEmail) {
      return jsonResponse({
        success: false,
        error:
          'Keine echte E-Mail-Adresse hinterlegt. Bitte zuerst im Mitarbeiter-Bearbeiten eine E-Mail eintragen.',
      });
    }

    // ─── Telefonnummer ermitteln (Override > Profil) ───────────────────
    // Pflicht nur, wenn per SMS verschickt wird — eine reine E-Mail-
    // Einladung braucht keine Nummer (vorher ließ sich niemand ohne
    // Telefon einladen, auch mit hinterlegter E-Mail nicht).
    const telefonRaw = body.telefon_override ?? profile.telefon ?? '';
    const telefonE164 = normalizeAtPhone(telefonRaw);
    if (willSms && !telefonE164) {
      return jsonResponse({
        success: false,
        error: 'Ungültige Telefonnummer. Format z.B. 0664 1234567 oder +43 664 1234567.',
      });
    }

    // Wenn Override angegeben oder Profil-Telefon abweicht: aktualisieren
    if (telefonE164 && telefonE164 !== profile.telefon) {
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

    // Die ECHTE Login-Nummer aus auth.users holen. Der Abgleich muss gegen
    // sie laufen — nicht gegen profiles.telefon. Beide können auseinander-
    // laufen (z.B. wenn sich jemand mit Nummer A registriert hat und im
    // Profil Nummer B steht). Vorher wurde nur profiles.telefon verglichen:
    // stimmten SMS-Ziel und Profil überein, blieb die Login-Nummer
    // unangetastet — der Mitarbeiter bekam ein Passwort für eine Nummer,
    // mit der er sich gar nicht anmelden kann.
    const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
    const nurZiffern = (s: unknown) => String(s ?? '').replace(/\D/g, '');
    const loginNrAktuell = authUser?.user?.phone ?? null;
    const loginNrWeichtAb =
      !!telefonE164 && nurZiffern(telefonE164) !== nurZiffern(loginNrAktuell);
    // Für die E-Mail-Anmeldung muss auth.users.email zur Profil-Adresse
    // passen — sonst funktioniert weder der Magic-Link noch E-Mail+Passwort.
    const loginMailWeichtAb =
      willMail &&
      hasRealEmail &&
      (authUser?.user?.email ?? '').toLowerCase() !== profile.email!.toLowerCase();

    // ─── Telefon als Anmeldenummer setzen — bei JEDEM Kanal ───────────
    // Die Einladung (SMS wie Mail) verspricht „mit Telefon anmelden". Das
    // gilt nur, wenn auth.users.phone gesetzt ist. Vorher wurde die Nummer
    // nur beim SMS-Versand übernommen: Wer per Mail eingeladen wurde und
    // dann seine Handynummer eintippte, bekam von Supabase ein leeres
    // neues Konto (02./04.09.). Schlägt das Setzen fehl (Nummer schon
    // von einem anderen Konto belegt), wird sie in der Mail nicht genannt.
    let telefonLogin: string | null =
      telefonE164 && !loginNrWeichtAb ? telefonE164 : null;
    let hinweis: string | null = null;
    if (telefonE164 && loginNrWeichtAb) {
      const { error: telErr } = await supabase.auth.admin.updateUserById(profile.id, {
        phone: telefonE164,
        phone_confirm: true,
      });
      if (telErr) {
        console.warn('phone sync failed:', telErr);
        if (willSms) {
          return jsonResponse({
            success: false,
            error: `Telefonnummer konnte nicht als Anmeldenummer gesetzt werden: ${telErr.message}`,
          });
        }
        hinweis = `Telefonnummer ${telefonE164} konnte nicht als Anmeldenummer gesetzt werden (${telErr.message}). Anmeldung geht nur per E-Mail.`;
      } else {
        telefonLogin = telefonE164;
      }
    }

    // ─── Neues Initial-Passwort setzen ─────────────────────────────────
    const initialPassword = generateReadablePassword(10);
    const updatePayload: Record<string, unknown> = {
      password: initialPassword,
    };
    if (loginMailWeichtAb) {
      updatePayload.email = profile.email!.toLowerCase();
      updatePayload.email_confirm = true;
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

    // ─── Twilio-Credentials prüfen (nur beim SMS-Versand nötig) ────────
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFrom = Deno.env.get('TWILIO_PHONE_NUMBER');
    if (willSms && (!twilioSid || !twilioToken || !twilioFrom)) {
      return jsonResponse({
        success: false,
        error:
          'Twilio-Credentials nicht konfiguriert. TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in Supabase-Secrets setzen.',
      });
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://willroider.app';

    // ─── Magic-Link (nur wenn echte Email vorhanden) ───────────────────
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

    let smsStatus: 'sent' | 'skipped' | 'error' = 'skipped';
    let smsError: string | null = null;
    let twilioSidOut: string | null = null;

    if (willSms) {
      const smsText = composeInvitationSms({
        vorname: profile.vorname || undefined,
        telefon: telefonE164!,
        email: hasRealEmail ? profile.email : null,
        magicLink,
        initialPassword,
        appUrl,
      });

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: telefonE164!,
          From: twilioFrom!,
          Body: smsText,
        }),
      });
      const twilioData = await twilioResponse.json();

      if (!twilioResponse.ok) {
        console.error('Twilio error:', twilioData);
        smsStatus = 'error';
        smsError = twilioData?.message ?? 'unbekannt';
      } else {
        smsStatus = 'sent';
        twilioSidOut = twilioData.sid;
      }
      await supabase.from('invitation_logs').insert({
        profile_id: profile.id,
        telefonnummer: telefonE164,
        empfaenger: telefonE164,
        kanal: 'sms',
        gesendet_von: user.id,
        status: smsStatus === 'sent' ? 'gesendet' : 'fehler',
        twilio_sid: twilioSidOut,
        fehler: smsError,
        sms_text: smsText,
      });
    }

    // ─── E-Mail-Versand ────────────────────────────────────────────────
    let mailStatus: 'sent' | 'skipped' | 'error' = 'skipped';
    let mailError: string | null = null;

    if (willMail) {
      const mail = composeInvitationEmail({
        vorname: profile.vorname || undefined,
        email: profile.email!,
        telefon: telefonLogin,
        magicLink,
        initialPassword,
        appUrl,
      });
      const r = await sendeEinladungsMail({
        to: profile.email!,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      mailStatus = r.ok ? 'sent' : 'error';
      mailError = r.error ?? null;
      await supabase.from('invitation_logs').insert({
        profile_id: profile.id,
        telefonnummer: telefonE164,
        empfaenger: profile.email,
        kanal: 'email',
        gesendet_von: user.id,
        status: r.ok ? 'gesendet' : 'fehler',
        fehler: mailError,
        sms_text: mail.text,
      });
    }

    const irgendwasRaus = smsStatus === 'sent' || mailStatus === 'sent';
    const fehlerTexte = [
      smsStatus === 'error' ? `SMS: ${smsError}` : '',
      mailStatus === 'error' ? `E-Mail: ${mailError}` : '',
    ].filter(Boolean);

    return jsonResponse({
      success: irgendwasRaus,
      error: irgendwasRaus
        ? fehlerTexte.length > 0
          ? `Teilweise fehlgeschlagen — ${fehlerTexte.join(' · ')}`
          : undefined
        : `Versand fehlgeschlagen: ${fehlerTexte.join(' · ') || 'kein Kanal'}`,
      twilio_sid: twilioSidOut,
      telefon: telefonE164,
      email: profile.email,
      initial_password: initialPassword,
      magic_link: magicLink,
      sms_status: smsStatus,
      sms_error: smsError,
      mail_status: mailStatus,
      mail_error: mailError,
      hinweis,
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
