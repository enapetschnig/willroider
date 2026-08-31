// Ändert die E-Mail-Adresse eines Mitarbeiters — auf Wunsch AUCH als
// Anmelde-Adresse. Die Adresse lebt an zwei Orten: profiles.email (Anzeige)
// und auth.users.email (Login). Nur profiles zu ändern hieße, dass sich der
// Mitarbeiter mit der neuen Adresse nicht anmelden kann — deshalb läuft
// beides hier über die Service-Role, wie beim Anlegen (admin-create-employee).
//
// Sicherheits-Gate: nur is_admin_role darf aufrufen.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

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

  let body: { profile_id?: string; email?: string; auch_login?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Ungültiger Body' }, 400);
  }
  const profileId = (body.profile_id ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  if (!profileId) return jsonResponse({ error: 'profile_id fehlt' }, 400);
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'Keine gültige E-Mail-Adresse' }, 400);

  // Adresse darf nicht schon von einem anderen Konto verwendet werden.
  const { data: kollision } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .neq('id', profileId)
    .limit(1);
  if (kollision && kollision.length > 0) {
    return jsonResponse({ error: 'Diese E-Mail-Adresse ist bereits einem anderen Mitarbeiter zugeordnet.' }, 409);
  }

  // 1) Anmelde-Adresse (auth.users) — nur wenn gewünscht.
  if (body.auch_login) {
    const { error: authErr } = await supabase.auth.admin.updateUserById(profileId, {
      email,
      email_confirm: true, // Admin-Änderung: keine Bestätigungs-Mail-Schleife
    });
    if (authErr) {
      return jsonResponse({ error: `Anmelde-Adresse nicht geändert: ${authErr.message}` }, 500);
    }
  }

  // 2) Anzeige-Adresse (profiles) — immer.
  const { error: profErr } = await supabase
    .from('profiles')
    .update({ email })
    .eq('id', profileId);
  if (profErr) {
    return jsonResponse({ error: `Profil nicht aktualisiert: ${profErr.message}` }, 500);
  }

  return jsonResponse({ ok: true, auch_login: !!body.auch_login });
});
