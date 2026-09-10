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

  // Reihenfolge ist Absicht: ZUERST auf den Startbildschirm, DANN dort
  // anmelden. Wer sich im Browser anmeldet und danach installiert, steht am
  // iPhone in der App erneut vor dem Login (getrennter Speicher).
  lines.push('', 'So richtest du die App ein:');
  lines.push(`1. Link öffnen: ${opts.appUrl}/auth?phone=${encodeURIComponent(opts.telefon)}`);
  lines.push('2. Zum Startbildschirm hinzufügen (iPhone: Teilen → Zum Home-Bildschirm · Android: Menü → App installieren)');
  lines.push('3. App vom Startbildschirm öffnen');
  lines.push('4. Nummer eingeben → „Code anfordern" → Code eintippen. Fertig!');
  if (opts.magicLink) {
    lines.push('', `Ohne Installation, nur schnell reinschauen: ${opts.magicLink}`);
  }
  if (opts.initialPassword) {
    lines.push(
      '',
      opts.email
        ? `Backup: E-Mail ${opts.email} oder Telefon + Passwort ${opts.initialPassword}`
        : `Backup-Passwort (Telefon + Passwort): ${opts.initialPassword}`,
    );
  }
  return lines.join('\n');
}
