// SMS-Einladung an einen (neuen oder bestehenden) Mitarbeiter.
// Wird von Frontend (Re-Send-Button in Mitarbeiter-Liste) oder intern von
// der admin-create-employee Edge Function aufgerufen.
//
// Liefert: bei Erfolg HTTP 200 { success: true, twilio_sid }
//          bei Fehler HTTP 200 { success: false, error: '…' }
//          (HTTP-200 + success-Flag, damit supabase.functions.invoke
//          ohne Throw zurückkommt und das Frontend den Fehler sauber anzeigt.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.79.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvitationRequest {
  /** Telefonnummer in E.164 oder AT-Format (0664…, +43664…). Wird normalisiert. */
  telefonnummer: string;
  /** Optional: für Logging-Verknüpfung in invitation_logs */
  profile_id?: string;
  /** Optional: persönliche Anrede + Magic-Link/Passwort, sonst werden Fallbacks gesetzt */
  vorname?: string;
  email?: string;
  /** Falls vom Aufrufer bereitgestellt (admin-create-employee) — sonst hier generiert */
  magic_link?: string;
  /** Initial-Passwort als Backup für SMS (nur Aufruf von admin-create-employee) */
  initial_password?: string;
}

/** AT-Phone-Normalisierung — Spiegel von src/lib/phone.ts für die Edge Function. */
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

function composeSmsText(opts: {
  vorname?: string;
  magicLink: string;
  email?: string;
  initialPassword?: string;
}): string {
  const lines: string[] = [];
  const greeting = opts.vorname ? `Hallo ${opts.vorname},` : 'Hallo,';
  lines.push(greeting);
  lines.push('');
  lines.push('deine Holzbau-Willroider-App ist bereit.');
  lines.push('');
  lines.push(`Login: ${opts.magicLink}`);
  if (opts.email && opts.initialPassword) {
    lines.push('');
    lines.push('Falls Link nicht klappt:');
    lines.push(`Mail: ${opts.email}`);
    lines.push(`Passwort: ${opts.initialPassword}`);
  }
  lines.push('');
  lines.push('App aufs Handy bringen:');
  lines.push('iPhone (Safari): Teilen → Zum Home-Bildschirm');
  lines.push('Android (Chrome): Menü → App installieren');
  return lines.join('\n');
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

    // Admin-Check via is_admin_role-RPC (decken alle Admin-Rollen ab:
    // geschaeftsfuehrung, bauleiter, buero).
    const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin_role', {
      _user_id: user.id,
    });
    if (roleError || !isAdmin) {
      console.error('Admin check failed', roleError);
      return jsonResponse({ success: false, error: 'Forbidden: Admin only' }, 403);
    }

    const body: InvitationRequest = await req.json();

    const telefonE164 = normalizeAtPhone(body.telefonnummer);
    if (!telefonE164) {
      return jsonResponse({
        success: false,
        error: 'Ungültige Telefonnummer. Format z.B. 0664 1234567 oder +43 664 1234567.',
      });
    }

    // Twilio-Credentials prüfen
    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioFrom = Deno.env.get('TWILIO_PHONE_NUMBER');
    if (!twilioSid || !twilioToken || !twilioFrom) {
      return jsonResponse({
        success: false,
        error: 'Twilio-Credentials nicht konfiguriert. Bitte TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in Supabase-Secrets setzen.',
      });
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://holzerleben.app';

    // Magic Link: vom Aufrufer übergeben oder hier generieren
    let magicLink = body.magic_link;
    let resolvedEmail = body.email;
    if (!magicLink) {
      // Email aus profile holen falls nicht im Body und profile_id vorhanden
      if (!resolvedEmail && body.profile_id) {
        const { data: p } = await supabase
          .from('profiles')
          .select('email, vorname')
          .eq('id', body.profile_id)
          .maybeSingle();
        if (p?.email) resolvedEmail = p.email;
        if (p?.vorname && !body.vorname) body.vorname = p.vorname;
      }
      if (!resolvedEmail) {
        return jsonResponse({
          success: false,
          error: 'Email fehlt — kein Magic-Link generierbar.',
        });
      }
      const { data: linkRes, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: resolvedEmail,
        options: { redirectTo: `${appUrl}/` },
      });
      if (linkErr || !linkRes?.properties?.action_link) {
        console.error('generateLink error:', linkErr);
        return jsonResponse({
          success: false,
          error: `Magic-Link konnte nicht erstellt werden: ${linkErr?.message ?? 'unbekannt'}`,
        });
      }
      magicLink = linkRes.properties.action_link;
    }

    const smsText = composeSmsText({
      vorname: body.vorname,
      magicLink,
      email: resolvedEmail,
      initialPassword: body.initial_password,
    });

    // Twilio-Aufruf
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
      // Log als Fehler
      await supabase.from('invitation_logs').insert({
        profile_id: body.profile_id ?? null,
        telefonnummer: telefonE164,
        gesendet_von: user.id,
        status: 'fehler',
        fehler: twilioData?.message ?? JSON.stringify(twilioData).slice(0, 500),
        sms_text: smsText,
      });
      return jsonResponse({
        success: false,
        error: `SMS-Versand fehlgeschlagen: ${twilioData?.message ?? 'unbekannt'}`,
      });
    }

    // Erfolgreich loggen
    await supabase.from('invitation_logs').insert({
      profile_id: body.profile_id ?? null,
      telefonnummer: telefonE164,
      gesendet_von: user.id,
      status: 'gesendet',
      twilio_sid: twilioData.sid,
      sms_text: smsText,
    });

    return jsonResponse({
      success: true,
      twilio_sid: twilioData.sid,
      telefonnummer: telefonE164,
    });
  } catch (error) {
    console.error('send-invitation error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten',
    });
  }
});
