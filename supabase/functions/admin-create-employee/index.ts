// Admin-Anlage eines Mitarbeiter-Kontos. Erstellt:
// 1. auth.users-Eintrag (mit Telefon-Pflicht + optional Email + Initial-Passwort)
// 2. profile (über handle_new_user-Trigger; danach via Service-Role ergänzt)
// 3. user_roles (Trigger setzt 'mitarbeiter' — wenn andere Rolle gewünscht: ersetzen)
// 4. profile_konten_settings
// 5. optional initial urlaubs_buchungen / za_buchungen (Saldo zum Eintritt)
// 6. Magic Link via supabase.auth.admin.generateLink() — nur wenn Email vorhanden
// 7. SMS-Einladung via Twilio (inline): bei Email → Magic Link, sonst Telefon-OTP-
//    Anleitung. Initial-Passwort als Backup immer mit drin.
//
// Sicherheits-Gates: nur is_admin_role darf aufrufen. Bei jedem Fehler nach
// createUser wird der angelegte User wieder gelöscht (Rollback).
//
// VORAUSSETZUNG für Telefon-OTP-Login: Supabase Auth → Providers → Phone
// muss aktiviert + mit Twilio (gleiche Creds wie unten) konfiguriert sein.

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
  telefon: string;          // PFLICHT — wird normalisiert auf E.164
  email?: string;           // optional, echte Mail
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
  const emailInput = (body.email ?? '').trim().toLowerCase();
  const eintrittsdatum = (body.eintrittsdatum ?? '').trim();
  const rolle = body.rolle as AppRole;

  if (!vorname || !nachname) return jsonResponse({ error: 'Vorname und Nachname sind Pflicht' }, 400);
  if (emailInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
    return jsonResponse({ error: 'Ungültige E-Mail' }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eintrittsdatum)) return jsonResponse({ error: 'Eintrittsdatum ungültig (YYYY-MM-DD)' }, 400);
  if (!ALLOWED_ROLES.includes(rolle)) return jsonResponse({ error: 'Ungültige Rolle' }, 400);

  const telefonE164 = normalizeAtPhone(body.telefon);
  if (!telefonE164) {
    return jsonResponse({
      error: 'Telefonnummer ist Pflicht und muss als 0664… oder +43… eingegeben sein.',
    }, 400);
  }

  const arbeitszeitmodell: Arbeitszeitmodell =
    ALLOWED_AZ_MODELLE.includes(body.arbeitszeitmodell as Arbeitszeitmodell)
      ? (body.arbeitszeitmodell as Arbeitszeitmodell)
      : 'zimmerei_sommer';

  // ─── Auth-User erstellen ───────────────────────────────────────────────
  const initialPassword = generateReadablePassword(10);

  const createParams: any = {
    phone: telefonE164,
    phone_confirm: true,
    password: initialPassword,
    user_metadata: { vorname, nachname, admin_created: true },
  };
  if (emailInput) {
    createParams.email = emailInput;
    createParams.email_confirm = true;
  }

  const { data: authCreated, error: createError } = await supabase.auth.admin.createUser(createParams);
  if (createError || !authCreated?.user) {
    const msg = createError?.message ?? 'createUser fehlgeschlagen';
    const hint = msg.toLowerCase().includes('phone')
      ? 'Telefonnummer schon vergeben oder Supabase Phone-Auth nicht aktiviert.'
      : msg.toLowerCase().includes('email')
      ? 'E-Mail bereits vergeben'
      : msg;
    return jsonResponse({ error: hint }, 400);
  }

  const newUserId = authCreated.user.id;

  // ─── Rollback-Helper ───────────────────────────────────────────────────
  const rollbackAndFail = async (err: string) => {
    console.error('rollback after create:', err);
    try {
      await supabase.auth.admin.deleteUser(newUserId);
    } catch (e) {
      console.error('rollback failed', e);
    }
    return jsonResponse({ error: err }, 500);
  };

  // ─── Profile-Felder ergänzen ────────────────────────────────────────────
  const profileUpdate: Record<string, unknown> = {
    telefon: telefonE164,
    geburtsdatum: body.geburtsdatum || null,
    partie_id: body.partie_id ?? null,
    is_partieleiter: body.is_partieleiter ?? false,
    is_active: true,
  };
  if (emailInput) profileUpdate.email = emailInput;

  const { error: profileErr } = await supabase
    .from('profiles')
    .update(profileUpdate)
    .eq('id', newUserId);
  if (profileErr) return rollbackAndFail(`Profil-Update: ${profileErr.message}`);

  // ─── Rolle korrigieren falls != 'mitarbeiter' ───────────────────────────
  if (rolle !== 'mitarbeiter') {
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

  // ─── Initial-Saldi ─────────────────────────────────────────────────────
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

  const initialZaStunden = Number(body.initial_za_stunden ?? 0);
  if (initialZaStunden !== 0) {
    const { error: zaErr } = await supabase.from('za_buchungen').insert({
      mitarbeiter_id: newUserId,
      art: 'initial',
      stunden: initialZaStunden,
      wirksam_am: eintrittsdatum,
      monat: eintrittsdatum.slice(0, 7),
      notiz: 'Initial-Saldo bei Mitarbeiter-Anlage',
      erstellt_von: user.id,
    });
    if (zaErr) return rollbackAndFail(`ZA-Initial: ${zaErr.message}`);
  }

  // ─── Magic Link generieren (nur wenn Email vorhanden) ─────────────────
  const appUrl = Deno.env.get('APP_URL') || 'https://willroider.app';
  let magicLink: string | null = null;
  if (emailInput) {
    try {
      const { data: linkRes, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: emailInput,
        options: { redirectTo: `${appUrl}/` },
      });
      if (linkErr) console.error('generateLink error:', linkErr);
      else magicLink = linkRes?.properties?.action_link ?? null;
    } catch (e) {
      console.error('generateLink threw:', e);
    }
  }

  // ─── SMS senden ────────────────────────────────────────────────────────
  let smsStatus: 'sent' | 'skipped' | 'error' = 'skipped';
  let smsError: string | null = null;
  let twilioSid: string | null = null;

  if (body.send_sms_invite) {
    const twilioSid_env = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFrom = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!twilioSid_env || !twilioToken || !twilioFrom) {
      smsStatus = 'error';
      smsError = 'Twilio-Credentials nicht konfiguriert';
    } else {
      // SMS-Template: bei Email → Magic-Link-Variante, sonst Telefon-OTP-Anleitung
      const smsLines: string[] = [];
      smsLines.push(`Hallo ${vorname},`, '', 'deine Holzbau-Willroider-App ist bereit.');
      if (magicLink) {
        smsLines.push('', `Sofort-Login: ${magicLink}`);
        smsLines.push('', 'Falls Link nicht klappt:');
        smsLines.push(`• App-Login mit Telefon ${telefonE164} → Code anfordern`);
        smsLines.push(`• Oder mit E-Mail ${emailInput} + Passwort ${initialPassword}`);
      } else {
        smsLines.push('', 'So loggst du dich ein:');
        smsLines.push(`1. App öffnen: ${appUrl}/auth?phone=${encodeURIComponent(telefonE164)}`);
        smsLines.push('2. "Code anfordern" tippen');
        smsLines.push('3. Du bekommst einen 6-stelligen Code');
        smsLines.push('4. Code eingeben → fertig');
        smsLines.push('', `Backup-Passwort (Telefon + Passwort): ${initialPassword}`);
      }
      smsLines.push('', 'App aufs Handy bringen:');
      smsLines.push('iPhone (Safari): Teilen → Zum Home-Bildschirm');
      smsLines.push('Android (Chrome): Menü → App installieren');
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
  }

  return jsonResponse({
    success: true,
    user_id: newUserId,
    telefon: telefonE164,
    email: emailInput || null,
    initial_password: initialPassword,
    magic_link: magicLink,
    sms_status: smsStatus,
    sms_error: smsError,
    twilio_sid: twilioSid,
  });
});
