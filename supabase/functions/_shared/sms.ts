// Gemeinsame Helper für SMS-Einladung (Twilio).
// Wird von admin-create-employee + send-invitation Edge-Functions importiert.
//
// Bewusst minimal: ein Modul = drei Funktionen. Kein State, keine I/O.

/** AT-Phone-Normalisierung — Spiegel von src/lib/phone.ts.
 *  Akzeptiert 0664 1234567, +43 664 …, 0043 664 …, 664 …
 *  Liefert "+43XXXXXXXXX" (E.164) oder null bei ungültiger Eingabe. */
export function normalizeAtPhone(input: string | null | undefined): string | null {
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

/** Lesbares Initial-Passwort. Ausgeschlossen: l, o, I, O, 0, 1 — Verwechslungsgefahr in SMS. */
export function generateReadablePassword(length = 10): string {
  const chars = 'abcdefghkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join('');
}

export interface ComposeSmsOpts {
  vorname?: string;
  telefon: string;            // E.164, für OTP-URL und SMS-Text
  email?: string | null;
  magicLink?: string | null;  // wenn vorhanden → Magic-Link-Variante
  initialPassword?: string | null;
  appUrl: string;
}

/** Baut den SMS-Text:
 *  - mit magicLink: Sofort-Login-Link + Backup (Email/Passwort oder Telefon/Passwort)
 *  - ohne magicLink: Telefon-OTP-Anleitung + Backup-Passwort
 *  - in beiden Fällen: App-Install-Hinweis */
export function composeInvitationSms(opts: ComposeSmsOpts): string {
  const lines: string[] = [];
  const greeting = opts.vorname ? `Hallo ${opts.vorname},` : 'Hallo,';
  lines.push(greeting, '', 'deine Holzbau-Willroider-App ist bereit.');

  if (opts.magicLink) {
    lines.push('', `Sofort-Login: ${opts.magicLink}`);
    lines.push('', 'Falls Link nicht klappt:');
    lines.push(`• App-Login mit Telefon ${opts.telefon} → Code anfordern`);
    if (opts.email && opts.initialPassword) {
      lines.push(`• Oder mit E-Mail ${opts.email} + Passwort ${opts.initialPassword}`);
    } else if (opts.initialPassword) {
      lines.push(`• Backup-Passwort (Telefon + Passwort): ${opts.initialPassword}`);
    }
  } else {
    lines.push('', 'So loggst du dich ein:');
    lines.push(`1. App öffnen: ${opts.appUrl}/auth?phone=${encodeURIComponent(opts.telefon)}`);
    lines.push('2. „Code anfordern" tippen');
    lines.push('3. Du bekommst einen 6-stelligen Code');
    lines.push('4. Code eingeben → fertig');
    if (opts.initialPassword) {
      lines.push('', `Backup-Passwort (Telefon + Passwort): ${opts.initialPassword}`);
    }
  }

  lines.push('', 'App aufs Handy bringen:');
  lines.push('iPhone (Safari): Teilen → Zum Home-Bildschirm');
  lines.push('Android (Chrome): Menü → App installieren');
  return lines.join('\n');
}
