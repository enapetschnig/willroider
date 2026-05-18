// Admin-Anlage eines Mitarbeiter-Kontos. Erstellt:
// 1. auth.users-Eintrag mit Initial-Passwort + email_confirmed
// 2. profile (über handle_new_user-Trigger; danach via Service-Role ergänzt)
// 3. user_roles (Trigger setzt 'mitarbeiter' — wenn andere Rolle gewünscht: ersetzen)
// 4. profile_konten_settings
// 5. optional initial urlaubs_buchungen / za_buchungen (Saldo zum Eintritt)
// 6. Magic Link via supabase.auth.admin.generateLink()
// 7. optional SMS-Einladung via Twilio (inline, mit Magic Link + Backup-Passwort)
//
// Sicherheits-Gates: nur is_admin_role darf aufrufen. Bei jedem Fehler nach
// createUser wird der angelegte User wieder gelöscht (Rollback).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.79.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AppRole = 'geschaeftsfuehrung' | 'bauleiter' | 'zimmermeister' | 'buero' | 'mitarbeiter';
type Arbeitszeitmodell = 'zimmerei_sommer' | 'fix_40h' | 'individuell';

interface CreateEmployeeRequest {
  // Stammdaten
  vorname: string;
  nachname: string;
  email: string;
  telefon?: string;
  geburtsdatum?: string;
  // Rolle + Partie
  rolle: AppRole;
  partie_id?: string | null;
  is_partieleiter?: boolean;
  // Konto-Settings
  eintrittsdatum: string;
  beschaeftigungsgrad?: number;
  tagesnorm_stunden?: number;
  arbeitszeitmodell?: Arbeitszeitmodell;
  urlaub_jahresanspruch_tage?: number;
  // Initial-Saldi
  initial_urlaub_tage?: number;
  initial_za_stunden?: number;
  // Einladung
  send_sms_invite?: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function normalizeAtPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.trim().replace(/[\s\-()/.]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    return /^\d{6,15}$/.test(digits) ? `+${digits}` : null;
  }
  if (cleaned.startsWith('00')) {
    const digits = cleaned.slice(2);
    return /^\d{6,15}$/.test(digits) ? `+${digits}` : null;
  }
  if (cleaned.startsWith('0')) {
    const digits = cleaned.slice(1);
    return /^\d{5,14}$/.test(digits) ? `+43${digits}` : null;
  }
  if (/^\d{5,14}$/.test(cleaned)) return `+43${cleaned}`;
  return null;
}

/**
 * Erzeugt ein 10-stelliges Initial-Passwort, das auch per Stimme oder Hand
 * gut lesbar ist (keine 0/O, 1/l/I-Verwechslungen).
 */
function generateReadablePassword(length = 10): string {
  const chars = 'abcdefghkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

const ALLOWED_ROLES: AppRole[] = [
  'geschaeftsfuehrung',
  'bauleiter',
  'zimmermeister',
  'buero',
  'mitarbeiter',
];

const ALLOWED_AZ_MODELLE: Arbeitszeitmodell[] = ['zimmerei_sommer', 'fix_40h', 'individuell'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // ─── Auth + Admin-Check ────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Kein Authorization-Header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin_role', {
    _user_id: user.id,
  });
  if (roleError || !isAdmin) return jsonResponse({ error: 'Forbidden: Admin only' }, 403);

  // ─── Body validieren ───────────────────────────────────────────────────
  let body: CreateEmployeeRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Body ist kein gültiges JSON' }, 400);
  }

  const vorname = (body.vorname ?? '').trim();
  const nachname = (body.nachname ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const eintrittsdatum = (body.eintrittsdatum ?? '').trim();
  const rolle = body.rolle as AppRole;

  if (!vorname || !nachname) return jsonResponse({ error: 'Vorname und Nachname sind Pflicht' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: 'Ungültige E-Mail' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eintrittsdatum)) return jsonResponse({ error: 'Eintrittsdatum ungültig (YYYY-MM-DD)' }, 400);
  if (!ALLOWED_ROLES.includes(rolle)) return jsonResponse({ error: 'Ungültige Rolle' }, 400);

  const arbeitszeitmodell: Arbeitszeitmodell =
    ALLOWED_AZ_MODELLE.includes(body.arbeitszeitmodell as Arbeitszeitmodell)
      ? (body.arbeitszeitmodell as Arbeitszeitmodell)
      : 'zimmerei_sommer';

  const telefonE164 = body.telefon ? normalizeAtPhone(body.telefon) : null;
  if (body.telefon && !telefonE164) {
    return jsonResponse({ error: 'Telefon konnte nicht als E.164 normalisiert werden' }, 400);
  }

  // ─── Auth-User erstellen ───────────────────────────────────────────────
  const initialPassword = generateReadablePassword(10);

  const { data: authCreated, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: initialPassword,
    email_confirm: true,
    user_metadata: { vorname, nachname, admin_created: true },
  });
  if (createError || !authCreated?.user) {
    const msg = createError?.message ?? 'createUser fehlgeschlagen';
    return jsonResponse({ error: msg.includes('already') ? 'E-Mail bereits vergeben' : msg }, 400);
  }

  const newUserId = authCreated.user.id;

  // ─── Rollback-Helper (löscht User wenn nachfolgende Inserts schiefgehen) ─
  const rollbackAndFail = async (err: string) => {
    console.error('rollback after create:', err);
    try {
      await supabase.auth.admin.deleteUser(newUserId);
    } catch (e) {
      console.error('rollback failed', e);
    }
    return jsonResponse({ error: err }, 500);
  };

  // ─── Profile-Felder ergänzen (Trigger handle_new_user hat das Grundgerüst) ─
  const profileUpdate: Record<string, unknown> = {
    telefon: telefonE164,
    geburtsdatum: body.geburtsdatum || null,
    partie_id: body.partie_id ?? null,
    is_partieleiter: body.is_partieleiter ?? false,
    is_active: true, // Admin hat angelegt → sofort aktiv
  };
  const { error: profileErr } = await supabase
    .from('profiles')
    .update(profileUpdate)
    .eq('id', newUserId);
  if (profileErr) return rollbackAndFail(`Profil-Update: ${profileErr.message}`);

  // ─── Rolle korrigieren falls != 'mitarbeiter' ───────────────────────────
  if (rolle !== 'mitarbeiter') {
    // Trigger hat user_roles(user_id, 'mitarbeiter') angelegt → ersetzen
    await supabase.from('user_roles').delete().eq('user_id', newUserId);
    const { error: roleInsertErr } = await supabase
      .from('user_roles')
      .insert({ user_id: newUserId, role: rolle });
    if (roleInsertErr) return rollbackAndFail(`Rollen-Insert: ${roleInsertErr.message}`);
  }

  // ─── profile_konten_settings ───────────────────────────────────────────
  const { error: kontenErr } = await supabase.from('profile_konten_settings').insert({
    profile_id: newUserId,
    eintrittsdatum,
    beschaeftigungsgrad: body.beschaeftigungsgrad ?? 1.0,
    tagesnorm_stunden: body.tagesnorm_stunden ?? 8.0,
    urlaub_jahresanspruch_tage: body.urlaub_jahresanspruch_tage ?? 25,
    arbeitszeitmodell,
  });
  if (kontenErr) return rollbackAndFail(`Konto-Settings: ${kontenErr.message}`);

  // ─── Initial-Urlaubssaldo ──────────────────────────────────────────────
  const initialUrlaubTage = Number(body.initial_urlaub_tage ?? 0);
  if (initialUrlaubTage > 0) {
    const { error: ubErr } = await supabase.from('urlaubs_buchungen').insert({
      mitarbeiter_id: newUserId,
      art: 'initial',
      tage: initialUrlaubTage,
      wirksam_am: eintrittsdatum,
      notiz: 'Initial-Saldo bei Mitarbeiter-Anlage',
      erstellt_von: user.id,
    });
    if (ubErr) return rollbackAndFail(`Urlaubs-Initial: ${ubErr.message}`);
  }

  // ─── Initial-ZA-Saldo ──────────────────────────────────────────────────
  const initialZaStunden = Number(body.initial_za_stunden ?? 0);
  if (initialZaStunden !== 0) {
    const { error: zaErr } = await supabase.from('za_buchungen').insert({
      mitarbeiter_id: newUserId,
      art: 'initial',
      stunden: initialZaStunden,
      wirksam_am: eintrittsdatum,          // Pflichtfeld in za_buchungen
      monat: eintrittsdatum.slice(0, 7),
      notiz: 'Initial-Saldo bei Mitarbeiter-Anlage',
      erstellt_von: user.id,
    });
    if (zaErr) return rollbackAndFail(`ZA-Initial: ${zaErr.message}`);
  }

  // ─── Magic Link generieren ──────────────────────────────────────────────
  const appUrl = Deno.env.get('APP_URL') || 'https://holzerleben.app';
  let magicLink: string | null = null;
  try {
    const { data: linkRes, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${appUrl}/` },
    });
    if (linkErr) {
      console.error('generateLink error:', linkErr);
    } else {
      magicLink = linkRes?.properties?.action_link ?? null;
    }
  } catch (e) {
    console.error('generateLink threw:', e);
  }

  // ─── SMS senden (optional) ─────────────────────────────────────────────
  let smsStatus: 'sent' | 'skipped' | 'error' = 'skipped';
  let smsError: string | null = null;
  let twilioSid: string | null = null;

  if (body.send_sms_invite && telefonE164 && magicLink) {
    const twilioSid_env = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFrom = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!twilioSid_env || !twilioToken || !twilioFrom) {
      smsStatus = 'error';
      smsError = 'Twilio-Credentials nicht konfiguriert';
    } else {
      const smsLines = [
        `Hallo ${vorname},`,
        '',
        'deine Holzbau-Willroider-App ist bereit.',
        '',
        `Login: ${magicLink}`,
        '',
        'Falls Link nicht klappt:',
        `Mail: ${email}`,
        `Passwort: ${initialPassword}`,
        '',
        'App aufs Handy bringen:',
        'iPhone (Safari): Teilen → Zum Home-Bildschirm',
        'Android (Chrome): Menü → App installieren',
      ];
      const smsText = smsLines.join('\n');

      try {
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid_env}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${twilioSid_env}:${twilioToken}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ To: telefonE164, From: twilioFrom, Body: smsText }),
          },
        );
        const twilioData = await twilioRes.json();
        if (twilioRes.ok) {
          smsStatus = 'sent';
          twilioSid = twilioData.sid ?? null;
          await supabase.from('invitation_logs').insert({
            profile_id: newUserId,
            telefonnummer: telefonE164,
            gesendet_von: user.id,
            status: 'gesendet',
            twilio_sid: twilioSid,
            sms_text: smsText,
          });
        } else {
          smsStatus = 'error';
          smsError = twilioData?.message ?? JSON.stringify(twilioData);
          await supabase.from('invitation_logs').insert({
            profile_id: newUserId,
            telefonnummer: telefonE164,
            gesendet_von: user.id,
            status: 'fehler',
            fehler: smsError?.slice(0, 500),
            sms_text: smsText,
          });
        }
      } catch (e) {
        smsStatus = 'error';
        smsError = e instanceof Error ? e.message : 'Unbekannter Fehler';
      }
    }
  } else if (body.send_sms_invite && !telefonE164) {
    smsStatus = 'error';
    smsError = 'Telefon fehlt';
  } else if (body.send_sms_invite && !magicLink) {
    smsStatus = 'error';
    smsError = 'Magic Link konnte nicht erstellt werden';
  }

  return jsonResponse({
    success: true,
    user_id: newUserId,
    email,
    initial_password: initialPassword,
    magic_link: magicLink,
    sms_status: smsStatus,
    sms_error: smsError,
    twilio_sid: twilioSid,
  });
});
