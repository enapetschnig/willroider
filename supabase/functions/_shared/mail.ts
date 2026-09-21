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

  // Wie in der SMS: Anmeldename + Passwort, fertig. Die App erklärt am
  // Handy selbst, wie sie auf den Startbildschirm kommt.
  const anmeldung = opts.telefon
    ? `Telefon ${opts.telefon}`
    : `E-Mail ${opts.email}`;
  zeilen.push('', 'Anmelden mit:');
  zeilen.push(anmeldung);
  if (opts.initialPassword) zeilen.push(`Passwort: ${opts.initialPassword}`);
  if (opts.telefon) zeilen.push(`(geht auch mit E-Mail ${opts.email} + demselben Passwort)`);
  zeilen.push('', `App öffnen: ${opts.appUrl}/auth`);
  zeilen.push('Die App zeigt dir am Handy, wie du sie auf den Startbildschirm legst.');
  if (opts.magicLink) {
    zeilen.push('', `Sofort-Login ohne Passwort (1 Stunde gültig): ${opts.magicLink}`);
  }

  const text = zeilen.join('\n');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Bewusst schlichtes HTML — Zustellbarkeit vor Schönheit. Der Login-Link
  // als klickbarer Knopf, der Rest wie die Textfassung.
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
  <p>${esc(greeting)}</p>
  <p>deine <strong>Holzbau-Willroider-App</strong> ist bereit.</p>
  <p><strong>Anmelden mit:</strong><br>
  ${esc(anmeldung)}${opts.initialPassword ? `<br>Passwort: <strong>${esc(opts.initialPassword)}</strong>` : ''}
  ${opts.telefon ? `<br><span style="font-size:13px;color:#555">(geht auch mit E-Mail ${esc(opts.email)} + demselben Passwort)</span>` : ''}</p>
  <p style="margin:20px 0"><a href="${opts.appUrl}/auth" style="background:#a63d52;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">App öffnen</a></p>
  <p style="font-size:13px;color:#555">Die App zeigt dir am Handy, wie du sie auf den Startbildschirm legst.</p>
  ${opts.magicLink ? `<p style="font-size:13px;color:#555">Sofort-Login ohne Passwort (1 Stunde gültig): <a href="${opts.magicLink}">Link</a></p>` : ''}
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

/** Einfache Text-Mail über Resend — für Erinnerungen, wenn kein Push-Gerät da ist. */
export async function sendeMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'RESEND_API_KEY nicht konfiguriert' };
  const from = Deno.env.get('RESEND_FROM') ?? 'berichte@willroider.app';
  const replyTo = Deno.env.get('RESEND_REPLY_TO') ?? 'maurer@willroider.at';
  const html = `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-line">${
    opts.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')
  }</p>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, reply_to: [replyTo], to: [opts.to], subject: opts.subject, text: opts.text, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as any)?.message ?? `Resend antwortet ${res.status}` };
    return { ok: true, id: (data as any)?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Mail-Versand fehlgeschlagen' };
  }
}
