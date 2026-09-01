// Gemeinsame Helper für die E-Mail-Einladung (Resend).
// Gegenstück zu sms.ts — gleicher Inhalt, andere Verpackung.
// Wird von admin-create-employee + send-invitation importiert.

export interface ComposeMailOpts {
  vorname?: string;
  email: string;
  telefon?: string | null;
  magicLink?: string | null;
  initialPassword?: string | null;
  appUrl: string;
}

/** Baut Betreff, Text- und HTML-Fassung der Einladung. */
export function composeInvitationEmail(opts: ComposeMailOpts): {
  subject: string;
  text: string;
  html: string;
} {
  const greeting = opts.vorname ? `Hallo ${opts.vorname},` : 'Hallo,';
  const zeilen: string[] = [greeting, '', 'deine Holzbau-Willroider-App ist bereit.'];

  if (opts.magicLink) {
    zeilen.push('', `Sofort-Login: ${opts.magicLink}`);
    zeilen.push('', 'Falls der Link nicht klappt:');
    if (opts.initialPassword) {
      zeilen.push(`• Anmeldung mit E-Mail ${opts.email} + Passwort ${opts.initialPassword}`);
    }
    if (opts.telefon) {
      zeilen.push(`• Oder mit Telefon ${opts.telefon} → Code anfordern`);
    }
  } else {
    zeilen.push('', 'So loggst du dich ein:');
    zeilen.push(`1. App öffnen: ${opts.appUrl}/auth`);
    zeilen.push(`2. E-Mail ${opts.email} eingeben`);
    if (opts.initialPassword) zeilen.push(`3. Passwort: ${opts.initialPassword}`);
  }

  zeilen.push('', 'App aufs Handy bringen:');
  zeilen.push('iPhone (Safari): Teilen → Zum Home-Bildschirm');
  zeilen.push('Android (Chrome): Menü → App installieren');

  const text = zeilen.join('\n');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Bewusst schlichtes HTML — Zustellbarkeit vor Schönheit. Der Login-Link
  // als klickbarer Knopf, der Rest wie die Textfassung.
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
  <p>${esc(greeting)}</p>
  <p>deine <strong>Holzbau-Willroider-App</strong> ist bereit.</p>
  ${
    opts.magicLink
      ? `<p style="margin:20px 0"><a href="${opts.magicLink}" style="background:#a63d52;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">Jetzt anmelden</a></p>
  <p style="font-size:13px;color:#555">Falls der Knopf nicht klappt:</p>
  <ul style="font-size:13px;color:#555">
    ${opts.initialPassword ? `<li>Anmeldung mit E-Mail <strong>${esc(opts.email)}</strong> + Passwort <strong>${esc(opts.initialPassword)}</strong></li>` : ''}
    ${opts.telefon ? `<li>Oder mit Telefon ${esc(opts.telefon)} → „Code anfordern"</li>` : ''}
  </ul>`
      : `<p>So loggst du dich ein:</p>
  <ol>
    <li>App öffnen: <a href="${opts.appUrl}/auth">${esc(opts.appUrl)}</a></li>
    <li>E-Mail <strong>${esc(opts.email)}</strong> eingeben</li>
    ${opts.initialPassword ? `<li>Passwort: <strong>${esc(opts.initialPassword)}</strong></li>` : ''}
  </ol>`
  }
  <p style="font-size:13px;color:#555;margin-top:24px"><strong>App aufs Handy bringen:</strong><br>
  iPhone (Safari): Teilen → Zum Home-Bildschirm<br>
  Android (Chrome): Menü → App installieren</p>
</div>`;

  return { subject: 'Dein Zugang zur Holzbau-Willroider-App', text, html };
}

/** Verschickt die Einladung über Resend. Kein Throw — der Aufrufer
 *  entscheidet, wie er den Fehler meldet. */
export async function sendeEinladungsMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'RESEND_API_KEY nicht konfiguriert' };
  const from = Deno.env.get('RESEND_FROM') ?? 'berichte@willroider.app';
  const replyTo = Deno.env.get('RESEND_REPLY_TO') ?? 'maurer@willroider.at';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        reply_to: [replyTo],
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (data as any)?.message ?? `Resend antwortet ${res.status}` };
    }
    return { ok: true, id: (data as any)?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Mail-Versand fehlgeschlagen' };
  }
}
