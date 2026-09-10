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

  // Gleiche Reihenfolge wie in der SMS: zuerst installieren, dann dort
  // anmelden — sonst steht man am iPhone zweimal vor dem Login.
  const anmeldung = opts.telefon
    ? `Telefon ${opts.telefon} eingeben → „Code anfordern" → Code eintippen`
    : `E-Mail ${opts.email}${opts.initialPassword ? ` + Passwort ${opts.initialPassword}` : ''}`;
  zeilen.push('', 'So richtest du die App am Handy ein:');
  zeilen.push(`1. ${opts.appUrl} am Handy öffnen`);
  zeilen.push('2. Zum Startbildschirm hinzufügen (iPhone: Teilen → Zum Home-Bildschirm · Android: Menü → App installieren)');
  zeilen.push('3. App vom Startbildschirm öffnen');
  zeilen.push(`4. Anmelden: ${anmeldung}. Fertig!`);
  if (opts.magicLink) {
    zeilen.push('', `Am Computer oder nur schnell reinschauen: ${opts.magicLink}`);
  }
  if (opts.initialPassword && opts.telefon) {
    zeilen.push('', `Backup: E-Mail ${opts.email} + Passwort ${opts.initialPassword}`);
  }

  const text = zeilen.join('\n');
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Bewusst schlichtes HTML — Zustellbarkeit vor Schönheit. Der Login-Link
  // als klickbarer Knopf, der Rest wie die Textfassung.
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
  <p>${esc(greeting)}</p>
  <p>deine <strong>Holzbau-Willroider-App</strong> ist bereit.</p>
  <p><strong>So richtest du die App am Handy ein:</strong></p>
  <ol>
    <li><a href="${opts.appUrl}">${esc(opts.appUrl)}</a> am Handy öffnen</li>
    <li>Zum Startbildschirm hinzufügen<br><span style="font-size:13px;color:#555">iPhone: Teilen → „Zum Home-Bildschirm" · Android: Menü → „App installieren"</span></li>
    <li>App vom Startbildschirm öffnen</li>
    <li>Anmelden: ${esc(anmeldung)}. Fertig!</li>
  </ol>
  ${
    opts.magicLink
      ? `<p style="margin:20px 0;font-size:13px;color:#555">Am Computer oder nur schnell reinschauen: <a href="${opts.magicLink}" style="background:#a63d52;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-weight:600">Jetzt anmelden</a></p>`
      : ''
  }
  ${
    opts.initialPassword && opts.telefon
      ? `<p style="font-size:13px;color:#555">Backup: E-Mail <strong>${esc(opts.email)}</strong> + Passwort <strong>${esc(opts.initialPassword)}</strong></p>`
      : ''
  }
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
