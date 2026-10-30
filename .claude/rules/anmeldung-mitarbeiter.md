---
paths:
  - "src/pages/Auth.tsx"
  - "src/pages/RegistrierungBestaetigung.tsx"
  - "src/pages/Mitarbeiter.tsx"
  - "src/pages/Admin.tsx"
  - "src/components/admin/**"
  - "src/components/InstallGuide.tsx"
  - "src/components/InstallPromptDialog.tsx"
  - "src/contexts/**"
  - "src/lib/doppelkonto.ts"
  - "src/lib/phone.ts"
  - "src/lib/pwaInstall.ts"
  - "supabase/functions/admin-create-employee/**"
  - "supabase/functions/admin-update-email/**"
  - "supabase/functions/send-invitation/**"
  - "supabase/functions/send-sms-hook/**"
  - "supabase/functions/_shared/sms.ts"
  - "supabase/functions/_shared/mail.ts"
---

# Anmeldung, Mitarbeiter, Rechte

## Anmeldung / Einladung
- **Nummer + Passwort** ist der Standard, SMS-Code nur Reserve (10.09.). Passwort immer „willroider“ +
  4 Ziffern (`generateSimplePassword` in `_shared/sms.ts`) — Christoph: „das passwort soll immer einfach
  irgendwas mit willroider und einer nummer hinten sein“. Die SMS enthält die Anleitung, keinen Code-Zwang.
- Einladung per SMS oder E-Mail (01.09.); die Handynummer wird immer als Anmeldenummer gesetzt.
  „Zugang senden“: Nummer eintippen, senden — ein Schritt; doppelte Nummern mit Namen.
- **Eine falsche Anmeldung legt nie ein Konto an** (SMS-OTP mit `shouldCreateUser: false`). Neu entsteht nur
  etwas über „Registrieren“ (J. Maurer, 04.09. Geisterkonten Lampersberger/Tauchhammer; 19.10. Fall Fischer).
- Doppelte Registrierung verhindern (19.10.): `registrierung_pruefen(vorname, nachname)` vor `signUp`, auch
  anonym, liefert nur „schon angelegt“ + Art (telefon/email). `lib/doppelkonto.ts` zeigt „gibt es schon als …“.
- **Zusammenführen** statt nur löschen: `doppelte_anmeldung_entfernen(id)` (nur `mitarbeiter.edit`, nur nie
  freigeschaltete Konten ohne Daten), dann E-Mail per `admin-update-email` am echten Konto eintragen.
- Personalblatt: Telefonnummer wird immer im Profil gespeichert; Häkchen „auch als Anmeldenummer/-Adresse“
  zeigen den echten Stand (RPC `anmeldedaten`) (J. Maurer, 16.09.).
- Install-Anleitung kommt nach dem ersten Anmelden von selbst, passend zum Gerät (10.09.).
- Platzhalter-Adressen `…@willroider.invalid` (Leasing, ohne Mail) — Mail-Versand überspringt sie.
- Nur 9 von 33 hatten Push, 25 nur Platzhalter-Mail (22.10.) → SMS-Ersatz, siehe `push-erinnerungen.md`.

## Freischalten / Rechte
- Neue Anmeldungen sehen, freischalten, archivieren nur mit `mitarbeiter.edit` (Maurer, Pließnig) — auch in
  der DB: Trigger `profiles_freischalten_pruefen` für `is_active`/`je_freigeschaltet` (E. Winkler, 19.10.).
- Testkonten brauchen nach dem Anlegen `je_freigeschaltet = true` **und** `is_active = true`.
- **Testzugang** (Christoph, 30.10.: „mich sollte man auch in der app nicht sehen ich will nur testen“): Konten in
  `testzugaenge` (nur per SQL, RLS ohne Policies) dürfen sich anmelden, obwohl archiviert — `hat_testzugang()` in
  `Auth.tsx` (`finalizeLogin`) und `AuthContext` → `ProtectedRoute`. Archiviert = in keiner Liste, Planung,
  Erinnerung; `has_permission` prüft `is_active` nicht, die Rechte bleiben. Eingetragen ist Christophs Konto (vom
  Büro am 21.10. archiviert; „Konto noch nicht freigeschaltet“ kommt auch bei archivierten Konten). **Nicht wieder
  aktivieren und nicht per RLS ausblenden:** Sein Konto hängt an Einteilungen/Stunden/Berichten von Mai–Oktober,
  ein unsichtbares Profil ließe dort Namen leer (Absturzgefahr bei Joins).
- Login-Prüfung mit Wegwerfkonto (30.10.): Admin-API anlegen (`pruef-<ts>@willroider.invalid`), archivieren, im
  Browser anmelden; Aufräumen = Auth-User löschen **plus** `aenderungsprotokoll`/`rollen_berechtigungen_audit`
  (die Log-Trigger schreiben beim Anlegen mit), danach alle uuid-Spalten auf Reste prüfen.
- Rechte je Person (`user_berechtigungen`, `MitarbeiterRechteDialog`) gehen der Rolle vor; Ordner-Ausnahme je
  Person gilt auch für Bauleiter (14.09.).
- **Einfache Handyansicht** (`einfacheAnsicht` in `AuthContext`): Mitarbeiter starten in Mein Tag, kurzes Menü.
- Mitarbeiter/Vorarbeiter sehen keine Kosten (Christoph, 05/2026: „die Menüpunkte 'Kosten' nicht sehen“).
- Kalkulator und Anleitung sind aus dem Menü genommen (Christoph, 15.09.), Routen bestehen noch.
- Schutz gegen versehentliche Stammdaten-Änderungen (18.07., Anlass Fischer-Fall).

## Leasing Personal (Kundenmail 20.10.)
- Reiter „Leasing Personal“ in Mitarbeiter & Partien; `zeiterfassung_typ = 'leasing'`, `profiles.leasing_firma`.
  Kein App-Zugang, einteilbar, Polier schreibt die Stunden. Christoph: **kein Stundenbericht**, Prüfung in der
  Stundenauswertung (Filter Eigenes/Leasing, Summe je Firma). Nicht in Zugang senden, Urlaubs-/ZA-Konten,
  Lohnzettel. `admin-create-employee` mit `leasing: true` (Platzhalter-Mail, Zufallspasswort, Rolle Mitarbeiter).
