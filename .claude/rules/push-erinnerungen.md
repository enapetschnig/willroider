---
paths:
  - "src/lib/push.ts"
  - "src/components/PushEinstellungDialog.tsx"
  - "src/components/dashboard/**"
  - "src/pages/Dashboard.tsx"
  - "src/components/StundenberichtErinnernDialog.tsx"
  - "supabase/functions/push-senden/**"
  - "supabase/functions/erinnerungen/**"
  - "supabase/functions/_shared/push.ts"
  - "supabase/functions/_shared/sms.ts"
---

# Push, Erinnerungen, Dashboard-Hinweise

- **Push statt Mail** für Erinnerungen (J. Maurer, 21.09.: „ja aber dann machen wir das mit push oder“).
  Web-Push mit VAPID (Secrets `VAPID_PUBLIC_KEY/PRIVATE/SUBJECT`, Public Key auch in `src/lib/push.ts` und
  `app_settings.push_vapid_public`) — **Schlüssel nie neu erzeugen**, sonst sind alle Abos tot.
  Service Worker lädt `push-sw.js` per `importScripts`. Einschalten je Gerät (Konto-Menü → Benachrichtigungen).
- Cron `erinnerungen` startet erst ab `app_settings.erinnerungen_ab` (2026-10-01), berücksichtigt Werktage/
  Feiertage; „tb_freigabe“ zählt nur fällige TB (ab dem 21.). Probelauf mit `probe: true` verschickt nichts.
- **SMS-Ersatz** (22.10.): `push-senden` mit `sms_ersatz: true` → ohne Push-Gerät SMS über Twilio
  (`sendeSms`), Nummer aus `profiles.telefon` oder Auth-Telefon; Mail-Ersatz überspringt `.invalid`.
  Erinnern dürfen Admins und Leute mit `stunden.bsb.bestaetigen`. Protokoll in `benachrichtigungen_log`
  (`bsb_unterschrift`/`bsb_erinnerung`), angezeigt als „erinnert am“.
- Tests: echte Mitarbeiter nie anschreiben; unbekannte ID → Kanal „keiner“.
- **Hinweise nur für Zuständige** (E. Winkler, 19.10.): „Stundenberichte warten auf Kontrolle“ nur mit
  `stunden.bsb.bestaetigen`; „Neue Anmeldungen“ nur mit `mitarbeiter.edit`; Bericht-Freigabe nur für den
  Bauleiter der Baustelle; SharePoint-Fehler für Bauleiter der Baustelle und Admins.
- **Dashboard führt direkt zum Offenen** (J. Maurer, 19.10.): bei genau einem Fall direkt hinein, sonst
  gefilterte Liste (z. B. `/mitarbeiter?neu=1`). Karten nach Fälligkeit, nicht 3-Tage-Sicht (11.09.).
- PWA-Update: `registerType: 'prompt'`; neue Version wird erst übernommen, wenn die App im Hintergrund ist
  (J. Maurer, 01.10.: „aktualisiert sich beim Öffnen nochmal“). Nicht auf `autoUpdate` zurückstellen.
