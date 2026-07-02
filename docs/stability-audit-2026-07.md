# Stabilitäts-Audit 2026-07-02

Multi-Agent-Audit über 6 Subsysteme (BSB-Flow, Edge-Functions, RBAC,
Zeiterfassung, DB-Integrität, Frontend-Robustheit). 57 Roh-Funde,
54 adversarial bestätigt, 3 widerlegt.

Zusätzlich vorab gefixt (nicht in dieser Liste): BSB-Versand-Root-Cause
(Service-Role-RPC → auth.uid() NULL → 'nicht berechtigt'), Commit 951bfc5.

## CRITICAL (2)

### [0] Kind-Tabellen-Policies prüfen weder Status noch Monatssperre — freigegebene/exportierte Tage bleiben über stunden_taetigkeiten frei änderbar
- **Status:** GEFIXT — Migration 20260702: st/sz/sf_write mit Status+month_locked-Check; HalleErfassung Status-Guard
- **Ort:** `DB:st_write/sz_write/sf_write (RLS stunden_taetigkeiten/zulagen/fahrt)`
- **Problem:** Die ALL-Policies st_write, sz_write und sf_write erlauben Schreibzugriff, sobald `is_admin_role() OR t.mitarbeiter_id = auth.uid() OR t.erfasst_von = auth.uid()` — ohne jeden Check auf t.status oder month_locked(). Die eigentlichen Stunden liegen aber in stunden_taetigkeiten, und der AFTER-Trigger stunden_tag_recompute ist SECURITY DEFINER und schreibt netto_stunden/tag_status ungehindert auf den (per RLS eigentlich gesperrten) Parent-Tag durch. Die stunden_tage_update-Policy (status IN ('erfasst','ma_bestaetigt') AND NOT month_locked) ist damit wirkungslos: der Header-Update wird zwar still geblockt, die Stunden selbst sind trotzdem änderbar. Die App löst das real aus: HalleErfassung.tsx hat keinerlei Status-Guard (submit ab Zeile 231 prüft aktuellerEigenerTag.tag.status nicht) und useStundenTag.ts macht immer DELETE+INSERT auf stunden_taetigkeiten.
- **Failure-Szenario:** Der Tag eines MA hat status='buero_freigabe' (vom Büro freigegeben, ggf. schon Lohn-exportiert) oder liegt in einem abgeschlossenen Monat (monatsabschluss-Zeile existiert). Der MA öffnet /halle für dieses Datum, ändert 8h auf 10h, klickt Speichern: (1) UPDATE stunden_tage matcht wegen RLS 0 Zeilen — kein Fehler, da useStundenTag.ts kein .select() macht; (2) DELETE+INSERT auf stunden_taetigkeiten geht durch (mitarbeiter_id=auth.uid()); (3) der SECURITY-DEFINER-Trigger setzt netto_stunden=10 auf dem freigegebenen Tag. Toast: 'Halle-Stunden gespeichert'. Die bereits abgerechneten Stunden in der DB stimmen nicht mehr mit dem Lohn-Export überein.
- **Fix-Hinweis:** In st_write/sz_write/sf_write denselben Status+month_locked-Check wie in stunden_tage_update aufnehmen (t.status IN ('erfasst','ma_bestaetigt') AND NOT month_locked(t.mitarbeiter_id, t.datum) für Nicht-Admins), und in HalleErfassung.tsx vor dem Save den Status prüfen wie Stunden.tsx:671 es tut.

### [1] Jeder User kann Baustellen-Dateien unwiederbringlich zerstören: Storage-Delete erlaubt, DB-Delete blockt still, Erfolgs-Toast trotzdem
- **Status:** GEFIXT — Migration 20260702: storage dokumente_delete/update nur Owner/Admin; BaustelleDokumente: DB-Delete zuerst mit Count-Check
- **Ort:** `src/components/BaustelleDokumente.tsx:456`
- **Problem:** deleteSelected (Z. 446-461) und remove (Z. 591-598) rufen erst supabase.storage.remove() und dann dokumente.delete() auf — beide ohne error-/count-Prüfung, danach kommt immer der Toast 'gelöscht'. In der Produktions-DB erlaubt die Storage-Policy 'dokumente_delete' (bucket baustellen) das Löschen für JEDEN authentifizierten User, die Tabellen-Policy 'dokumente_delete' auf public.dokumente aber nur für Uploader oder Admin. RLS auf DELETE wirft keinen Fehler, sondern löscht 0 Zeilen — selbst mit error-Check würde man es nicht sehen.
- **Failure-Szenario:** Mitarbeiter X (nicht Admin, nicht Uploader) öffnet eine Baustelle → Dokumente, markiert einen Plan eines Kollegen und klickt Löschen → confirm → Storage-Objekt wird gelöscht (Policy erlaubt es), die dokumente-Zeile bleibt (RLS, 0 rows). Toast: '1 Datei(en) gelöscht'. Die Datei erscheint nach Reload weiter in der Liste, Download/Thumbnail sind für immer kaputt — die eigentliche Datei ist unwiederbringlich weg.
- **Fix-Hinweis:** Storage-Delete-Policy auf dieselbe Bedingung wie die dokumente-Tabelle einschränken (Uploader/Admin); im Frontend erst DB-Zeile löschen (mit error- und count-Check via .select()), erst bei Erfolg Storage-Objekt entfernen; Fehler-Toast statt pauschalem Erfolgs-Toast.

## HIGH (14)

### [2] Produktions-Auth Site URL = http://localhost:3000 mit leerer Redirect-Allowlist → alle Magic-Links (Sofort-Login-SMS) landen auf localhost
- **Status:** GEFIXT — Auth-Config: site_url=https://willroider.app, Allowlist gesetzt
- **Ort:** `DB:auth_config (project ylqbxnsxksbtsqrcwtuq)`
- **Problem:** Die Auth-Konfiguration des Produktionsprojekts hat site_url='http://localhost:3000' und uri_allow_list='' (leer). send-invitation (index.ts:172-176, redirectTo `${appUrl}/`) und admin-create-employee (index.ts:238-242) erzeugen mit generateLink({type:'magiclink', options:{redirectTo:'https://willroider.app/'}}) einen Sofort-Login-Link, der prominent in der Einladungs-SMS steht. GoTrue validiert das redirect_to gegen die Allowlist; da 'https://willroider.app/' NICHT allowlisted ist und keine zusätzlichen Redirect-URLs existieren, fällt es auf die Site URL zurück = http://localhost:3000. Der Mitarbeiter wird nach Token-Verify auf localhost:3000 umgeleitet, das auf seinem Handy nicht erreichbar ist.
- **Failure-Szenario:** Admin legt Mitarbeiter mit E-Mail an bzw. schickt Zugang → SMS enthält 'Sofort-Login: https://…/auth/v1/verify?...&redirect_to=https://willroider.app/'. MA tippt drauf → GoTrue verifiziert → redirect auf http://localhost:3000/#access_token=… → Handy zeigt 'kann nicht verbunden werden'. Der Sofort-Login ist für JEDEN Mitarbeiter mit E-Mail kaputt.
- **Fix-Hinweis:** In Supabase Auth-Settings Site URL auf die echte App-Domain setzen und alle genutzten App-Domains (willroider.app/holzerleben.app) in die Redirect-Allowlist aufnehmen; APP_URL-Secret, site_url und Allowlist konsistent halten.

### [3] Admin ändert eigene Rolle → eigene user_roles-Zeile wird gelöscht, Re-Insert scheitert an RLS → Admin verliert alle Rechte (Lockout-Gefahr)
- **Status:** GEFIXT — Mitarbeiter.tsx setRole: atomares UPDATE statt delete+insert
- **Ort:** `src/pages/Mitarbeiter.tsx:256`
- **Problem:** setRole() macht delete-then-insert in zwei separaten Requests (Z.257-258). RLS-Policy user_roles_admin_all (qual UND with_check = is_admin_role(auth.uid()), in DB verifiziert) erlaubt den DELETE der eigenen Zeile noch (Rechte-Check vor dem Delete), aber der anschließende INSERT wird abgelehnt: nach dem committeten DELETE hat der Admin keine user_roles-Zeile mehr → has_permission('admin.view')=false → with_check schlägt fehl (42501). Die eigene Rolle ist damit ersatzlos weg. Das Rollen-Dropdown (Z.465-475 mobil, Z.567-578 Desktop) hat keinerlei Self-Guard — die eigene Zeile ist ganz normal editierbar.
- **Failure-Szenario:** Geschäftsführer öffnet /admin?tab=mitarbeiter, stellt bei sich selbst versehentlich das Rollen-Dropdown um (auch GF→GF reicht) → DELETE ok, INSERT RLS-Fehler-Toast → nach Reload/Token-Refresh leere App für ihn. Ist er der letzte User mit admin.view/system.admin_panel (aktuell 20 User auf 3 Admin-Rollen), kann NIEMAND mehr user_roles schreiben — Rettung nur per Service-Key/SQL. Zusatzrisiko für Fremd-User: schlägt der ungeprüfte DELETE (Z.257, error ignoriert) fehl und der INSERT klappt, hat der User wegen UNIQUE(user_id, role) statt UNIQUE(user_id) plötzlich ZWEI Rollen — my_permissions() liefert die Union (entzogene Rechte bleiben), und AuthContext.loadProfile() .maybeSingle() (AuthContext.tsx:73) errored bei 2 Zeilen → role=null.
- **Fix-Hinweis:** Rollenwechsel als atomare SECURITY-DEFINER-RPC (UPDATE rolle_id statt delete+insert), Self-Change blocken oder mindestens eigenes Dropdown disablen; UNIQUE-Constraint auf user_id allein umstellen.

### [4] Fehlgeschlagener my_permissions()-RPC wird als 'keine Rechte' behandelt (permissionsLoaded=true, leeres Set, kein Retry) → komplette leere App bis zum manuellen Reload
- **Status:** GEFIXT — AuthContext: 3 Versuche mit Backoff statt sofort leeres Set
- **Ort:** `src/contexts/AuthContext.tsx:54`
- **Problem:** loadPermissions() setzt bei JEDEM Fehler (Netz-Timeout, 5xx) permissions=∅ und permissionsLoaded=true (Z.56-63). Es gibt keinen Retry und keine Fehler-UI. Alle RequirePermission-Routes redirecten dann nach '/', und '/' selbst ist mit dashboard.view geguarded (App.tsx:83) — der <Navigate to="/"> auf '/' rendert null (kein Loop, in react-router 6.30.1 verifiziert: navigate-Identität stabil), d.h. der User sieht die AppShell mit komplett leerer Sidebar/Bottom-Nav und leerem Content ohne jede Meldung. Da handle() auch bei jedem TOKEN_REFRESHED (~stündlich) läuft, kann ein einziger transienter RPC-Fehler eine LAUFENDE Session live leeren.
- **Failure-Szenario:** Monteur auf der Baustelle mit wackligem LTE öffnet die PWA → my_permissions schlägt einmal fehl → App zeigt nur Logo+leeres Menü, keine Fehlermeldung, kein Retry; oder: User arbeitet gerade in /stunden, Token-Refresh zur vollen Stunde trifft ein Funkloch → Permissions werden gewiped, er wird auf die leere '/'-Seite geworfen und verliert ggf. ungespeicherte Eingaben.
- **Fix-Hinweis:** Bei RPC-Fehler alten Permission-Stand behalten + Retry mit Backoff; permissionsLoaded nur bei Erfolg setzen; für 'wirklich keine dashboard.view' eine echte NoAccess-Seite statt Redirect auf die selbst geguardete '/'.

### [5] month_locked() läuft ohne SECURITY DEFINER und liefert für Poliere (erfasst_von-Zweig) wegen RLS auf monatsabschluss immer false
- **Status:** GEFIXT — Migration 20260702: month_locked SECURITY DEFINER
- **Ort:** `DB:month_locked`
- **Problem:** month_locked(p_uid, p_datum) ist STABLE, aber NICHT SECURITY DEFINER, und prüft EXISTS auf public.monatsabschluss. Die Policy monatsabschluss_select erlaubt SELECT nur für `mitarbeiter_id = auth.uid() OR is_admin_role(auth.uid())`. In stunden_tage_update/delete wird month_locked(mitarbeiter_id, datum) aber auch im Zweig `erfasst_von = auth.uid()` ausgewertet: Ein Polier, der den Tag eines Partie-MA erfasst hat, sieht die monatsabschluss-Zeilen dieses MA nicht → EXISTS ist leer → month_locked=false → NOT month_locked=true. Die Monatssperre existiert für diesen Personenkreis schlicht nicht.
- **Failure-Szenario:** Büro schließt den Mai für MA Huber ab (monatsabschluss-Zeile 17.-31.05.). Polier Krainer (Rolle 'mitarbeiter', nicht Admin, erfasst_von der Mai-Tage) öffnet /stunden, wählt Huber und den 20.05. mit status='erfasst' und speichert neue Stunden — die RLS-Prüfung NOT month_locked(huber_id, '2026-05-20') läuft unter Krainers Rechten, sieht die Sperr-Zeile nicht und lässt den Update durch. Der abgeschlossene Monat wird geändert.
- **Fix-Hinweis:** month_locked als SECURITY DEFINER mit SET search_path anlegen (analog has_permission), damit die Sperrprüfung unabhängig von der RLS-Sichtbarkeit des Aufrufers funktioniert.

### [6] Save-Flow ohne Transaktion, DELETE-Fehler ignoriert und UPDATE ohne Row-Count-Prüfung — Abbruch mitten im Save löscht alle Tageseinträge, RLS-Blocks werden als Erfolg gemeldet
- **Status:** GEFIXT — useStundenTag: alle DELETE-Fehler geprüft, UPDATE mit Row-Count
- **Ort:** `src/hooks/useStundenTag.ts:153`
- **Problem:** useSaveStundenTag führt 5+ sequentielle Requests aus (UPDATE/INSERT stunden_tage, DELETE+INSERT stunden_taetigkeiten, DELETE+INSERT stunden_zulagen, UPSERT/DELETE stunden_fahrt) ohne Transaktion/RPC. Die DELETE-Aufrufe in Zeile 153, 171 und 191 prüfen den error nicht. Der UPDATE in Zeile 134-139 prüft nicht, ob überhaupt eine Zeile getroffen wurde — bei RLS-Block (status nicht mehr 'erfasst'/'ma_bestaetigt' oder month_locked) matcht er still 0 Zeilen, der Code läuft weiter und die Aufrufer (Stunden.tsx:791, HalleErfassung.tsx:309) zeigen 'gespeichert' an.
- **Failure-Szenario:** (a) MA auf einer Baustelle mit schlechtem Empfang speichert eine Änderung: DELETE stunden_taetigkeiten geht noch durch (Trigger setzt netto_stunden=0), dann bricht die Verbindung vor dem INSERT ab → alle Einträge des Tages sind weg, der Tag steht auf 0 h; fällt erst beim 14-Tage-Bericht auf. (b) Zwei Geräte bearbeiten denselben Tag: Gerät B's DELETE läuft, dann kollidiert sein INSERT mit dem unique constraint (stunden_tag_id, position) durch Gerät A → halbfertiger Zustand plus kryptische Fehlermeldung 'duplicate key value violates unique constraint'.
- **Fix-Hinweis:** Den kompletten Save in eine Postgres-RPC-Funktion (eine Transaktion) verlagern; mindestens aber alle error-Rückgaben prüfen und beim UPDATE `.select('id')` verwenden und bei 0 Zeilen einen Fehler werfen.

### [7] Zulagen gehen bei Polier-Sammelerfassung still verloren — RLS auf mitarbeiter_zulagen liefert Nicht-Admins für fremde MA 0 Zeilen
- **Status:** GEFIXT — Migration 20260702: mz_read erweitert (Partieleiter + create_andere)
- **Ort:** `src/pages/Stunden.tsx:721`
- **Problem:** Beim Speichern für fremde MA lädt der Code (Zeilen 720-728) mitarbeiter_zulagen des jeweiligen MA und filtert die im Formular gewählten Zulagen auf diese Menge (Zeile 730). Die RLS-Policy mz_read_own_or_admin erlaubt SELECT aber nur für `mitarbeiter_id = auth.uid() OR is_admin_role()`. Ein Polier ohne Admin-Rolle (real: Partieleiter Wolfgang Krainer, Rolle 'mitarbeiter', Partie 'Produktion / Werkstatt') bekommt für jeden fremden MA eine leere Menge → alle Zulagen werden für diese MA weggefiltert, ohne Fehler oder Hinweis. Dieselbe RLS trifft schon die Anzeige: die Union-Query (Zeilen 228-240) sieht nur die eigenen Zeilen, d.h. Zulagen-Chips der Partie-MA erscheinen gar nicht erst.
- **Failure-Szenario:** Polier Krainer erfasst für 5 Partie-Mitarbeiter den Tag inkl. Erschwerniszulage. Toast: '5 Einträge gespeichert'. In stunden_zulagen landet die Zulage aber nur bei ihm selbst (falls er sie überhaupt zugewiesen hat) — bei den 4 Kollegen fehlt sie. Die Lohnabrechnung der Kollegen ist zu niedrig, niemand bekommt einen Fehler zu sehen.
- **Fix-Hinweis:** Entweder mz_read_own_or_admin um Partieleiter/`stunden.create_andere` erweitern (z.B. is_partieleiter_of), oder die Zulagen-Berechtigungsprüfung serverseitig in den Save-RPC verlagern statt clientseitig gegen eine RLS-gefilterte Liste zu filtern.

### [8] Urlaubs-Genehmigung setzt stunden_tage direkt auf urlaub/0h, lässt stunden_taetigkeiten aber stehen — nächster Recompute macht den Urlaub rückgängig
- **Status:** TEILGEFIXT — taetigkeiten-Cleanup bei Genehmigung ergänzt
- **Ort:** `src/components/UrlaubAntragDialog.tsx:363`
- **Problem:** genehmigen() updated bestehende Tage im Urlaubszeitraum mit `{ tag_status: 'urlaub', netto_stunden: 0 }` (Zeilen 360-367), löscht aber die zugehörigen stunden_taetigkeiten nicht. Da netto_stunden/tag_status per SECURITY-DEFINER-Trigger stunden_tag_recompute aus den Einträgen abgeleitet werden, überschreibt jede spätere Berührung der Einträge (Speichern über /stunden, /halle, BSB-Editor) den Urlaub wieder mit den alten Arbeitsstunden. Zusätzlich bucht genehmigen() die Urlaubstage manuell aufs Konto (Zeile 320), während der Trigger für urlaub-Einträge eigene Auto-Buchungen anlegt — doppelte Kontoabzüge sind möglich. In der Prod-DB liegt bereits ein inkonsistenter Datensatz dieser Bauart: stunden_tage 23b584fd-5627-45ec-ba43-3fe5f188ca24 (Reibnegger, 2026-05-21) hat netto_stunden=0.00, aber 3 aktive Einträge mit Summe 11,5 h.
- **Failure-Szenario:** MA hat für den 10.08. bereits 8h Baustelle erfasst. Büro genehmigt Urlaub 10.-14.08. → Tag zeigt urlaub/0h, Konto wird um die Tage reduziert. Der MA öffnet später /stunden oder /halle für den 10.08. und speichert irgendetwas → der Trigger rechnet aus den nie gelöschten Einträgen tag_status='baustelle', netto=8h zurück. Ergebnis: Tag zählt wieder als Arbeit UND das Urlaubskonto bleibt belastet — Stunden und Urlaub doppelt.
- **Fix-Hinweis:** Beim Genehmigen die stunden_taetigkeiten des Zeitraums durch einen echten urlaub-Eintrag ersetzen (dann leitet der Trigger tag_status/netto korrekt ab und die Auto-Urlaubsbuchung übernimmt das Konto) statt stunden_tage direkt zu patchen; die manuelle Konto-Buchung in Zeile 320 entfernen oder deduplizieren.

### [9] Saldo-Views v_urlaubs_saldo/v_za_saldo umgehen RLS und sind sogar für anon lesbar
- **Status:** GEFIXT — Migration 20260702: Views security_invoker + anon-Revoke
- **Ort:** `supabase/migrations/20260514000000_konten.sql:69`
- **Problem:** Beide Views sind ohne security_invoker angelegt (reloptions=NULL, Owner postgres) und haben in Produktion SELECT-Grants für anon UND authenticated (information_schema.role_table_grants bestätigt). Da der View-Owner zugleich Tabellen-Owner ist, greift die RLS von urlaubs_buchungen/za_buchungen ('eigene Zeilen oder Admin') beim Zugriff über die View nicht. Die Views liefern mitarbeiter_id + saldo aller Mitarbeiter.
- **Failure-Szenario:** Beliebiger Request GET https://ylqbxnsxksbtsqrcwtuq.supabase.co/rest/v1/v_za_saldo?select=* nur mit dem öffentlichen anon-Key (ohne Login) → liefert ZA- und Urlaubssalden aller 46 Mitarbeiter. Ebenso kann jeder normale Mitarbeiter in der App die Konten aller Kollegen abfragen, obwohl die Tabellen-RLS das explizit verbietet.
- **Fix-Hinweis:** ALTER VIEW ... SET (security_invoker = on); zusätzlich REVOKE SELECT ON v_urlaubs_saldo, v_za_saldo FROM anon; (gleiches Muster für v_offene_unterschriften/_mit_alter prüfen).

### [10] st_write-Policy auf stunden_taetigkeiten prüft weder month_locked noch Buchungsstatus — Lock-Bypass auf abgeschlossene Perioden
- **Status:** GEFIXT — identisch mit Fund 0 (Migration 20260702)
- **Ort:** `supabase/migrations/20260521000000_zeiterfassung_redesign.sql:279`
- **Problem:** Die ALL-Policy st_write erlaubt jedem MA das Schreiben von Segmenten, sobald t.mitarbeiter_id=auth.uid() — ohne month_locked(mitarbeiter_id, datum)- und ohne status-Check (im Gegensatz zur stunden_tage_update-Policy, die beides prüft). Der SECURITY-DEFINER-Trigger stunden_tag_recompute schreibt daraufhin netto_stunden/tag_status des gesperrten stunden_tage-Eintrags um und legt/löscht urlaubs_buchungen — an der RLS vorbei.
- **Failure-Szenario:** Periode 1.–16.6. ist per stunden_bericht_bestaetigen abgeschlossen, ZA-Buchung existiert. MA ändert danach in der Zeiterfassung die Segmente des 5.6. von 9h auf 2h (INSERT/DELETE auf stunden_taetigkeiten ist per RLS erlaubt) → recompute setzt netto_stunden=2 auf dem gesperrten Tag → unterschriebener Bericht und gebuchte ZA-Differenz passen nicht mehr zu den Ist-Daten; ändert er ein Urlaubs-Segment, verschiebt sich zusätzlich rückwirkend das Urlaubskonto.
- **Fix-Hinweis:** st_write um AND NOT month_locked(t.mitarbeiter_id, t.datum) (und ggf. Status-Bedingung analog stunden_tage_update) erweitern.

### [11] Urlaubsgenehmigung führt zu doppeltem Urlaubsabzug (manuelle Antrag-Buchung + TAG-Auto-Buchung) und ist nicht gegen Doppelklick/Fehler abgesichert
- **Status:** TEILGEFIXT — Antrag-Genehmigung räumt jetzt stunden_taetigkeiten auf (alte TAG-Buchungen weg); Rest-Risiko wenn MA nachträglich Urlaub-Tätigkeit erfasst
- **Ort:** `src/components/UrlaubAntragDialog.tsx:319`
- **Problem:** genehmigen() bucht -arbeitstage als urlaubs_buchung ('Antrag: von – bis') und setzt die stunden_tage auf tag_status='urlaub', netto_stunden=0. Sobald der Tag später in der Zeiterfassung mit einem urlaub-Segment befüllt wird (Normalfall, siehe Prod-Daten: alle 9 Urlaubstage haben Segmente + 'TAG:...(auto)'-Buchungen aus stunden_tag_recompute), entsteht eine ZWEITE Abbuchung für denselben Tag. Zusätzlich: das UPDATE auf urlaubsantraege hat keinen .eq('status','offen')-Guard und der Insert-Fehler der Kontobuchung (Zeile 320) wird ignoriert.
- **Failure-Szenario:** Admin genehmigt Antrag 4.–8.5. (5 Arbeitstage) → -5,00 Tage gebucht. MA/ZM trägt danach für diese Tage je ein 9h-Urlaub-Segment ein → recompute bucht zusätzlich 5×-1,13 Tage → Konto zeigt ~-10,6 statt -5 Tage. Alternativ: zwei Büro-Nutzer klicken fast gleichzeitig 'Genehmigen' → beide Inserts laufen durch (keine Unique-Constraint auf urlaubs_buchungen) → doppelter Abzug.
- **Fix-Hinweis:** Genehmigung serverseitig als RPC mit Status-Guard (UPDATE ... WHERE status='offen' RETURNING) implementieren und entweder NUR die Auto-Buchung ODER nur die Antrag-Buchung verwenden; Insert-Fehler behandeln.

### [12] Mitarbeiter ohne erfasste stunden_tage bekommen nie einen Bericht und damit nie einen Periodenabschluss
- **Status:** OFFEN
- **Ort:** `DB:stunden_bericht_erzeugen`
- **Problem:** stunden_bericht_erzeugen iteriert nur über SELECT DISTINCT st.mitarbeiter_id FROM stunden_tage WHERE datum BETWEEN von AND bis. Ein aktiver MA ohne einen einzigen Eintrag in der Periode erhält keinen Bericht; da stunden_bericht_bestaetigen der einzige Aufrufer von monatsabschluss_durchfuehren ist (keine UI ruft die RPC direkt), wird für ihn nie abgeschlossen. Die alte Logik (durchfuehren über alle aktiven Profile) hätte ihm sein volles Fehl-Soll als Minusstunden gebucht — jetzt passiert gar nichts und die Periode bleibt für ihn unbegrenzt editierbar (month_locked greift nie).
- **Failure-Szenario:** MA vergisst/verweigert die Erfassung für 1.–16.11. komplett → Cron am 16.11. 18:00 UTC erzeugt für ihn keinen Bericht → keine ZA-Buchung mit Soll 80h/Ist 0h → sein ZA-Konto bleibt unverändert, während Kollegen mit nur einem erfassten Tag die vollen Minusstunden gebucht bekommen. Fällt niemandem auf, weil im Kontroll-Workflow schlicht kein Bericht auftaucht.
- **Fix-Hinweis:** Loop über alle aktiven Profile (LEFT JOIN stunden_tage) statt DISTINCT auf stunden_tage; leerer Snapshot '{}' ist bereits vorgesehen.

### [13] Polier-Edits an eingereichten Berichten verschwinden kommentarlos: UI erlaubt sie, RLS with_check blockt sie, Fehler werden verschluckt
- **Status:** OFFEN
- **Ort:** `src/pages/BerichtDetail.tsx:819`
- **Problem:** kannEditieren (Z. 204-207) erlaubt dem Polier explizit 'auch nach Einreichung nochmal' zu editieren. Die Produktions-RLS-Policies bt_write/bau_write/bm_write haben aber with_check nur für status='entwurf' (USING erlaubt entwurf+eingereicht) → INSERT und UPDATE auf bericht_taetigkeiten/bericht_aufmass schlagen für Nicht-Admins bei eingereichten Berichten mit 42501 fehl, DELETE geht durch. Genau diese Insert/Update-Aufrufe prüfen den error nicht: TaetigkeitenEditor.add (Z. 819) und .update (Z. 835), AufmassEditor.add (Z. 946) und .update (Z. 958). Auch berichte_update-RLS verlangt entwurf → Feld-Updates (Wetter, Besonderheiten) matchen 0 Zeilen ganz ohne Fehler.
- **Failure-Szenario:** Polier reicht seinen Bautagesbericht ein, merkt eine vergessene Tätigkeit und trägt sie nach (UI erlaubt es) → Klick auf 'hinzu' → Insert wird von RLS abgelehnt, error ignoriert, onChange() refetcht → die Zeile erscheint nie, keinerlei Fehlermeldung. Beim Ändern einer Stundenzahl springt das Feld nach onBlur still auf den alten Wert zurück. Der Bauleiter gibt später einen unvollständigen Bericht frei und verrechnet falsche Regiestunden.
- **Fix-Hinweis:** Entweder with_check der Policies auf entwurf+eingereicht erweitern (wie USING) oder kannEditieren auf entwurf beschränken; in jedem Fall alle Insert/Update-Fehler prüfen und als Toast anzeigen.

### [14] Urlaubsantrag genehmigen: Doppelklick bucht Urlaubstage doppelt ab, kein Status-Guard, kein busy-State
- **Status:** GEFIXT — UrlaubAntragDialog: busyId-Guard + Status-Guard (.eq status=offen) + Row-Count
- **Ort:** `src/components/UrlaubAntragDialog.tsx:431`
- **Problem:** AdminUrlaubsantraegeCard.genehmigen (Z. 303-370) hat keinen busy-/disabled-State am 'Genehmigen'-Button (Z. 431-437), das Status-Update filtert nur auf .eq('id') ohne .eq('status','offen'), die RLS-Update-Policy für Admins hat keinen Status-Guard, und urlaubs_buchungen hat laut Produktions-DB keinen Unique-Constraint, der Doppel-Buchungen verhindert. Zusätzlich werden die Fehler des urlaubs_buchungen-Inserts (Z. 320) und der stunden_tage-Inserts/Updates (Z. 347, 361) komplett verschluckt.
- **Failure-Szenario:** (a) Büro klickt auf langsamem Netz zweimal schnell 'Genehmigen' → beide Durchläufe laufen komplett durch → zwei urlaubs_buchungen mit -N Tagen → dem Mitarbeiter werden doppelt so viele Urlaubstage abgezogen, der Saldo in den Urlaubs-Konten stimmt nicht mehr. (b) Der urlaubs_buchungen-Insert schlägt fehl (Netzabriss nach Schritt 1) → Antrag steht auf 'genehmigt', aber es wird nie etwas vom Konto abgebucht und keine Urlaubs-Tage in stunden_tage angelegt — Toast meldet trotzdem 'Antrag genehmigt'.
- **Fix-Hinweis:** busy-State pro Antrag + Button disabled; Update mit .eq('status','offen') und .select() → bei 0 Zeilen abbrechen; alle Folge-Writes auf error prüfen; idealerweise das Ganze in eine SECURITY-DEFINER-RPC verschieben (atomar).

### [15] Rollenwechsel per delete+insert ist nicht atomar — schlägt der Insert fehl, hat der User gar keine Rolle mehr (leere App)
- **Status:** GEFIXT — identisch mit Fund 3
- **Ort:** `src/pages/Mitarbeiter.tsx:256`
- **Problem:** setRole (Z. 256-265) löscht erst ALLE user_roles-Zeilen des Users (Fehler wird ignoriert) und insertet danach die neue Rolle. Es gibt keinen Trigger, der einen Default wiederherstellt (nur trg_sync_user_role_enum BEFORE INSERT/UPDATE). Schlägt der Insert fehl (Netzabriss zwischen den beiden Requests, RLS-Problem), bleibt der User dauerhaft ohne Rolle — laut Commit-Historie ('user_roles.rolle_id zwangssyncen: neu registrierte User hatten leere App') bedeutet fehlende Rolle eine leere App ohne Permissions.
- **Failure-Szenario:** Admin ändert im Mitarbeiter-Tab die Rolle eines Poliers von 'zimmermeister' auf 'bauleiter'; nach dem Delete bricht die Verbindung ab, der Insert scheitert → Toast zeigt zwar 'Fehler', aber die alte Rolle ist bereits weg. Der Polier startet die App und sieht nur noch ein leeres Dashboard — bis jemand manuell die Rolle neu setzt.
- **Fix-Hinweis:** UPDATE statt delete+insert (user_roles.rolle_id updaten) oder eine RPC, die den Wechsel atomar macht; mindestens den Delete-Fehler prüfen und erst nach erfolgreichem Insert löschen (upsert mit onConflict user_id).

## MEDIUM (28)

### [16] Periodengrenzen inkonsistent: Monatsabschluss-H1 endet am 15., BSB Teil 1 am 16. — Dedupe ist nur Label-basiert, überlappende Perioden werden doppelt gebucht
- **Status:** OFFEN
- **Ort:** `DB:monatsabschluss_durchfuehren`
- **Problem:** monatsabschluss_durchfuehren erzeugt Spezial-Labels nur für H1=1.–15. (v_h1_end := MAKE_DATE(...,15)), H2=16.–Monatsende und ganzen Monat. Die BSB-Perioden (Teil 1 = 1.–16., Teil 2 = 17.–Ende, siehe stunden_bericht_erzeugen) treffen keines dieser Muster und fallen in den generischen Label-Zweig — real belegt: monatsabschluss enthält bereits '2026-05-17_2026-05-31'. Der Duplikat-Schutz ist ausschließlich 'NOT EXISTS ... WHERE ma.monat = v_monat_label', prüft also nur exakt gleiche Labels, NICHT überlappende Datumsbereiche. Der 16. gehört im BSB-System zu Teil 1, im Alt-System zu H2.
- **Failure-Szenario:** BSB Teil 2 Juni wird bestätigt → ZA-Buchung unter Label '2026-06-17_2026-06-30'. Später führt ein Admin (SQL/altes Tooling/künftiger UI-Button) monatsabschluss_durchfuehren für den ganzen Juni oder H2 (16.–30.) aus → Label '2026-06' bzw. '2026-06-H2' existiert nicht → NOT EXISTS greift nicht → die Differenzstunden 17.–30.6. (bzw. inkl. 16.) werden ein zweites Mal in za_buchungen gebucht; ZA-Konto des Mitarbeiters ist doppelt gutgeschrieben/belastet.
- **Fix-Hinweis:** Dedupe auf Datums-Überlappung umstellen (NOT EXISTS ... WHERE daterange(ma.von_datum, ma.bis_datum, '[]') && daterange(p_von_datum, p_bis_datum, '[]')) und v_h1_end an die BSB-Grenze (16.) angleichen bzw. die H1/H2-Spezial-Labels entfernen.

### [17] Inaktive Mitarbeiter werden beim Monatsabschluss stillschweigend übersprungen — Bericht wird 'versendet', aber die ZA-Buchung fehlt ohne Fehler
- **Status:** OFFEN
- **Ort:** `DB:monatsabschluss_durchfuehren`
- **Problem:** Die FOR-Schleife iteriert 'SELECT id FROM profiles WHERE is_active = TRUE AND (p_mitarbeiter_id IS NULL OR id = p_mitarbeiter_id) ...'. Wird stunden_bericht_versenden/bestaetigen für einen inzwischen deaktivierten MA aufgerufen, liefert die Schleife 0 Zeilen; PERFORM verwirft das leere Ergebnis, es gibt keine Exception und keinen Hinweis. Der Bericht wechselt trotzdem auf 'versendet'.
- **Failure-Szenario:** MA Gwenger scheidet am 20.6. aus (is_active=false), sein unterschriebener Juni-Teil-1-Bericht wird danach vom Büro bestätigt und versendet → Status 'versendet', PDF beim Büro, aber es entsteht weder ein monatsabschluss-Eintrag noch eine za_buchung für 1.–16.6. — die Endabrechnung seines ZA-Kontos fehlt und niemand bekommt es mit.
- **Fix-Hinweis:** Bei p_mitarbeiter_id IS NOT NULL den is_active-Filter weglassen (oder bei 0 verarbeiteten MAs eine Exception/NOTICE werfen), damit Austritte noch abgeschlossen werden.

### [18] Cron erzeugt Berichte nur exakt am 16./Monatsletzten um 18:00 UTC — Mitarbeiter, die ihre Stunden später nachtragen, bekommen nie automatisch einen Bericht; Nachträge des Stichtags erscheinen fälschlich als 'geändert'
- **Status:** OFFEN
- **Ort:** `DB:stunden_bericht_cron`
- **Problem:** stunden_bericht_cron (Schedule '0 18 * * *', DB-TZ UTC = 20:00 Wien im Sommer) feuert genau einmal pro Halbmonat und stunden_bericht_erzeugen legt Berichte nur für MAs an, die zu diesem Zeitpunkt bereits stunden_tage in der Periode haben. Es gibt keinen Nachlauf. Real belegt in der Produktions-DB: Gwenger hat die Tage 19.–29.5. erst am 3.6. erfasst (created_at 2026-06-03), also NACH dem Teil-2-Cron vom 31.5. Hätte er bis dahin gar keinen Tag der Periode erfasst, gäbe es für ihn keinen Bericht und seine Stunden liefen komplett am Kontroll-/Unterschrift-/ZA-Workflow vorbei, bis das Büro zufällig manuell 'Berichte erzeugen' klickt. Zusätzlich: Der Snapshot wird um 18:00 UTC eingefroren; alle am Stichtag (16./Letzter) danach erfassten Stunden weichen vom Snapshot ab und werden in App und PDF gelb als 'geändert' markiert, obwohl nichts nachträglich manipuliert wurde (kein Datenverlust — Ansicht und PDF sind live —, aber falsches Prüfsignal fürs Büro).
- **Failure-Szenario:** MA erfasst seine Stunden für 1.–16.7. erst am 17.7. → Cron lief am 16.7. und hat ihn übersprungen → kein Bericht Teil 1 Juli existiert; er kann nichts unterschreiben, das Büro sieht in der Liste nichts Fehlendes, die Periode wird nie abgeschlossen.
- **Fix-Hinweis:** Cron täglich fehlende Berichte der jeweils letzten abgeschlossenen Periode nacherzeugen lassen (stunden_bericht_erzeugen ist dank ON CONFLICT DO NOTHING idempotent), z.B. Tag 16–20 für Teil 1 und Letzter+1–5 für Teil 2; Snapshot beim ersten Öffnen durch den MA aktualisieren, solange Status 'offen'.

### [19] evaluierung-reminder wird nie ausgeführt — kein pg_cron-Job registriert
- **Status:** OFFEN
- **Ort:** `supabase/functions/evaluierung-reminder/index.ts:13`
- **Problem:** Die Function ist laut Kommentar (Zeile 13 'Aufruf via pg_cron') für den täglichen Cron-Betrieb gebaut, wird aber nirgends geplant: cron.job enthält nur 'bsb-abend' (0 18 * * *, stunden_bericht_cron). In den Migrationen gibt es nur cron.schedule('bsb-abend', …) (20260605000000_baustellenstundenbericht.sql:313), keinen Eintrag für evaluierung-reminder. Auch kein Frontend-Aufruf (grep in src/ leer). Die Function ist deployed (verify_jwt=false) aber tot.
- **Failure-Szenario:** Ein Mitarbeiter unterschreibt eine Unterweisung tagelang nicht. Es soll ein Reminder an Polier/Bauleiter gehen (Karenz 3 Tage). Da der Cron-Job fehlt, läuft die Function nie → reminder_geschickt_am bleibt NULL, es wird NIE ein Reminder verschickt. Das komplette Unterweisungs-Reminder-Feature ist wirkungslos.
- **Fix-Hinweis:** cron.schedule('evaluierung-reminder', '0 7 * * *', $$ SELECT net.http_post(...functions/v1/evaluierung-reminder..., service_role-Header) $$) per Migration anlegen (analog bsb-abend). Zusätzlich Auth/Secret prüfen, da die Function unauthentifiziert ist.

### [20] evaluierung-reminder liest nicht existierende Spalte profiles.telefonnummer → SMS werden nie versendet
- **Status:** OFFEN
- **Ort:** `supabase/functions/evaluierung-reminder/index.ts:111`
- **Problem:** Zeilen 110-111 (.select('id, vorname, nachname, telefonnummer')) und 128 (.select('id, telefonnummer')) sowie 131 (p.telefonnummer) greifen auf profiles.telefonnummer zu. Diese Spalte existiert nicht — die Spalte heißt profiles.telefon (per information_schema und Direkt-Query bestätigt: 'column "telefonnummer" does not exist'). PostgREST liefert damit einen Fehler, data ist null; der Code prüft die Fehler NICHT (nur `const { data: profiles } = await …`). Folge: Name-Nachladen (Zeile 112-115) füllt nichts, und die SMS-Schleife (Zeile 129) iteriert über [] → smsSent bleibt 0. Der reminder_geschickt_am-Flag-Update (Zeile 158-161) läuft trotzdem, sodass Fälle als 'erinnert' markiert werden, obwohl keine SMS rausging.
- **Failure-Szenario:** Selbst wenn die Function per Cron liefe: Für jeden überfälligen Fall wird reminder_geschickt_am gesetzt (Cooldown startet), aber wegen der falschen Spalte wird keine einzige Twilio-SMS gesendet — der Verantwortliche erfährt nichts, und wegen des gesetzten Flags kommt im 24h-Cooldown auch kein zweiter Versuch.
- **Fix-Hinweis:** telefonnummer → telefon in beiden Selects und in p.telefonnummer korrigieren; zusätzlich den Query-Error prüfen und loggen statt still zu verschlucken.

### [21] admin-create-employee-Fehlerdetails gehen verloren — Admin sieht nur 'Edge Function returned a non-2xx status code'
- **Status:** OFFEN
- **Ort:** `src/components/admin/NewMitarbeiterDialog.tsx:172`
- **Problem:** admin-create-employee gibt Validierungs-/Business-Fehler mit echten HTTP-Codes zurück (400 z.B. 'Telefonnummer schon vergeben oder Supabase Phone-Auth nicht aktiviert' index.ts:146-151; 500 via rollbackAndFail 'Rollen-Insert:…','Konto-Settings:…'). supabase.functions.invoke wirft bei non-2xx einen FunctionsHttpError und liefert data=null; der aussagekräftige Body steckt nur in error.context (bestätigt in functions-js FunctionsClient.js:88-90 / types.js:18-20). NewMitarbeiterDialog.tsx:172 zeigt aber nur error.message = die generische Meldung 'Edge Function returned a non-2xx status code'; der data?.error-Zweig (Zeile 181) ist für diese Fälle tot (data ist null). Anders als send-invitation, das bewusst 200+success:false zurückgibt, wurde admin-create-employee nicht darauf umgestellt.
- **Failure-Szenario:** Admin legt Mitarbeiter mit Telefonnummer an, die bereits einem anderen User gehört → Function antwortet 400 mit klarer Ursache. Der Admin sieht im Toast nur 'Anlegen fehlgeschlagen: Edge Function returned a non-2xx status code' und kann nicht erkennen, dass die Nummer doppelt ist — er probiert ratlos weiter.
- **Fix-Hinweis:** Entweder admin-create-employee wie send-invitation auf 200 + {error} umstellen, oder im Frontend bei FunctionsHttpError `await error.context.json()` auslesen und dessen .error anzeigen.

### [22] send-invitation: profiles.telefon wird vor dem auth.users-Sync geschrieben → dauerhafte Divergenz bei Phone-Unique-Violation
- **Status:** OFFEN — send-invitation Reihenfolge profiles.telefon vor auth-Sync
- **Ort:** `supabase/functions/send-invitation/index.ts:114`
- **Problem:** profiles.telefon wird zuerst aktualisiert (Zeile 114-118), erst danach setzt updateUserById password + phone/phone_confirm (Zeile 134-141). Schlägt der auth-Update fehl (z.B. users_phone_key UNIQUE-Violation, weil die Nummer schon einem anderen auth.users-Eintrag gehört — Index bestätigt: users_phone_key), wird bei Zeile 142-148 abgebrochen; profiles.telefon steht dann bereits auf der neuen Nummer, auth.users.phone aber noch auf der alten. Beim nächsten Versuch ist profile.telefon (frisch geladen) == telefonE164, sodass der Sync-Zweig (Zeile 114 und 134) übersprungen wird — auth.users.phone wird NIE korrigiert.
- **Failure-Szenario:** Admin schickt Zugang mit telefon_override, dessen Nummer bereits einem anderen Konto gehört → profiles.telefon zeigt danach eine Nummer, die dem MA gar nicht in auth.users zugeordnet ist. Der MA kann sich per Telefon-OTP nie einloggen (OTP geht an die falsche/alte auth-Nummer), und jeder Retry überspringt die Reparatur.
- **Fix-Hinweis:** auth.users-Update (phone) VOR profiles.telefon ausführen bzw. beide in einer konsistenten Reihenfolge mit Rollback; Sync nicht an profile.telefon-Gleichheit koppeln, sondern die tatsächliche auth.users.phone vergleichen.

### [23] dokument-versenden ohne Rollen-/Inhaltsprüfung → E-Mail-Relay über die Firmendomain
- **Status:** OFFEN
- **Ort:** `supabase/functions/dokument-versenden/index.ts:54`
- **Problem:** Die Function prüft nur, dass ein gültiger User eingeloggt ist (Zeile 54-60), aber keine Rolle. Empfänger, Betreff, Text, HTML und Anhänge (bis 35 MB) kommen komplett clientseitig als base64 — es wird NICHT verifiziert, dass die Anhänge aus dem geschützten Storage stammen. Versendet wird von 'Holzbau Willroider <dokumente@willroider.app>'. Damit kann jeder authentifizierte Account (auch niedrig privilegiert oder kompromittiert) beliebige Mails mit beliebigem Inhalt an beliebige Adressen über die Firmendomain verschicken.
- **Failure-Szenario:** Ein einfacher Mitarbeiter-Account (oder ein übernommener Login) ruft dokument-versenden mit fremdem Empfänger und Phishing-Inhalt auf → die Mail geht mit Firmenabsender raus und schädigt die Domain-Reputation; das ist nicht auf 'eigene Dokumente' begrenzt, obwohl der Kommentar das suggeriert.
- **Fix-Hinweis:** Auf berechtigte Rollen einschränken bzw. Anhänge serverseitig anhand einer übergebenen Storage-Referenz mit Service-Role laden statt beliebiges base64 vom Client zu akzeptieren; ggf. Rate-Limit.

### [24] Realtime-Permission-Refresh ist toter Code: user_roles und rollen_berechtigungen sind nicht in der supabase_realtime-Publication
- **Status:** OFFEN
- **Ort:** `src/contexts/AuthContext.tsx:113`
- **Problem:** AuthContext abonniert postgres_changes auf user_roles und rollen_berechtigungen (Z.113-139). Per DB-Query verifiziert: pg_publication_tables für supabase_realtime enthält KEINE dieser Tabellen (nur bericht_*, stunden_*, jahresplan_* usw.). Die Subscription meldet sich fehlerfrei an, empfängt aber nie ein Event. Gleiches gilt für profiles/partien im Mitarbeiter-Tab (Mitarbeiter.tsx:174-186). AdminBerechtigungen.tsx:243-245 verspricht ausdrücklich 'Änderungen wirken sofort … (Realtime)'.
- **Failure-Szenario:** Chef entzieht einem eingeloggten Mitarbeiter eine Berechtigung (oder ändert seine Rolle) → beim Mitarbeiter passiert nichts: Menüpunkte/Buttons bleiben bis zum nächsten Page-Reload bzw. Token-Refresh (~1 h, TOKEN_REFRESHED triggert loadProfile) sichtbar; er sieht dann RLS-Fehler bei Aktionen. Umgekehrt bekommt ein User neu vergebene Rechte nicht — 'App kaputt', bis jemand sagt: neu laden.
- **Fix-Hinweis:** ALTER PUBLICATION supabase_realtime ADD TABLE user_roles, rollen_berechtigungen (und ggf. profiles, partien) per Migration; DELETE-Events mit filter brauchen zudem REPLICA IDENTITY FULL.

### [25] Lockout-Schutz greift nur für system.manage_permissions — admin.view/system.admin_panel sind entziehbar und sperren dann den gesamten Admin-Bereich inkl. Berechtigungs-Editor aus
- **Status:** OFFEN
- **Ort:** `DB:fn_protect_admin_permission / rpc_save_role_permissions`
- **Problem:** Der Constraint-Trigger trg_protect_admin_permission (AFTER DELETE/UPDATE auf rollen_berechtigungen, deferred — in DB verifiziert) prüft nur, dass irgendeine Rolle system.manage_permissions behält. admin.view und system.admin_panel sind laut DB ist_kritisch=false, daher greift auch der UI-Guard isLockedForSelf (AdminBerechtigungen.tsx:201-205) nicht — die Checkboxen sind selbst für die eigene Rolle aktiv. is_admin_role() = has_permission(admin.view) OR has_permission(system.admin_panel) steuert aber die RLS auf user_roles und der Route-Guard /admin hängt an admin.view; der Berechtigungs-Editor liegt hinter /admin.
- **Failure-Szenario:** GF hakt in der Berechtigungs-Matrix bei der Rolle 'Geschäftsführung' versehentlich 'admin.view' und 'system.admin_panel' ab und speichert (rpc_save_role_permissions lässt es durch, Trigger feuert nicht, da system.manage_permissions unberührt) → nach refreshOwnPerms fliegt er sofort aus /admin (RequirePermission admin.view → Redirect '/'), is_admin_role()=false für alle GF → user_roles ist für niemanden mehr schreibbar und der Editor zum Rückgängigmachen ist unerreichbar. Selbstheilung unmöglich, nur direkte SQL/Service-Key-Reparatur.
- **Fix-Hinweis:** admin.view/system.admin_panel/dashboard.view als ist_kritisch markieren und den Lockout-Trigger erweitern: mindestens eine Rolle MIT zugewiesenen Usern muss admin.view+system.manage_permissions behalten.

### [26] Redirect-Fallback '/' zeigt auf eine selbst geguardete Route — User ohne dashboard.view landet auf einer leeren Seite ohne Meldung
- **Status:** OFFEN
- **Ort:** `src/components/RequirePermission.tsx:34`
- **Problem:** redirectTo default '/' (Z.24/34), aber '/' verlangt dashboard.view (App.tsx:83). dashboard.view ist ist_kritisch=false und für fremde Rollen frei abwählbar — ein Admin kann es z.B. der Rolle 'Mitarbeiter' entziehen (rpc_save_role_permissions hat keinen Schutz). Es gibt keine NoAccess-/Fallback-Seite; AppShell blendet ohne Permissions schlicht alle Nav-Items aus (AppShell.tsx:98-107, Mobile-Nav 247-256 filtert auf hasPermission, 'Start' hängt an dashboard.view).
- **Failure-Szenario:** Admin hakt in der Matrix bei Rolle 'Mitarbeiter' das Modul Dashboard ab (aktuell haben laut DB alle 5 Rollen dashboard.view — ein Klick genügt) → alle 26 Mitarbeiter sehen beim nächsten Login auf '/' nur noch Header + leere Bottom-Nav-Reste, keinerlei Hinweis warum. Deep-Links auf erlaubte Seiten (/stunden) funktionieren zwar, sind aber ohne 'Start'-Nav kaum auffindbar.
- **Fix-Hinweis:** Eigene 'Keine Berechtigung'-Seite als redirect-Ziel bzw. Inline-Fallback rendern; dashboard.view als kritisch markieren.

### [27] Custom-Rollen sind nirgends zuweisbar, werden im Mitarbeiter-Tab als 'Mitarbeiter' fehlangezeigt und durch jede Dropdown-Änderung zerstört
- **Status:** OFFEN
- **Ort:** `src/pages/Mitarbeiter.tsx:465`
- **Problem:** Prüfpunkt 5 zu Ende gedacht: NewRolleDialog legt Custom-Rollen mit legacy_enum=NULL an (AdminBerechtigungen.tsx:472-482); der Sync-Trigger setzt für solche User role='mitarbeiter' (COALESCE-Fallback, Richtung 1 — rolle_id bleibt dabei korrekt erhalten, das ist ok). Aber: Der Mitarbeiter-Tab liest/schreibt ausschließlich die ENUM-Spalte (Z.160, 256-258, Dropdown Z.465-475) und kennt nur die 5 System-Rollen. Es existiert im ganzen Frontend KEIN Weg, einem User eine Custom-Rolle zuzuweisen (grep über src bestätigt: kein Insert/Update mit rolle_id außer dem Rollen-Lösch-Flow).
- **Failure-Szenario:** Chef legt Rolle 'Polier extern' mit maßgeschneiderten Rechten an → kann sie niemandem geben (Feature faktisch tot). Wird sie per SQL zugewiesen, zeigt der Mitarbeiter-Tab den User als 'Mitarbeiter' an; sobald irgendein Admin dort das Dropdown anfasst (auch nur um den scheinbar falschen Wert zu 'korrigieren'), löscht setRole() die Custom-Zuweisung und ersetzt sie kommentarlos durch die ENUM-Rolle — der User verliert schlagartig seine Spezialrechte.
- **Fix-Hinweis:** Dropdown auf rollen-Tabelle (rolle_id) umstellen und user_roles.rolle_id updaten statt ENUM delete+insert.

### [28] Members werden nur bei isAdmin geladen — Custom-Rolle mit stunden.create_andere sieht einen leeren Personen-Picker
- **Status:** GEFIXT — Stunden.tsx: Members-Load an canCreateForOthers gekoppelt
- **Ort:** `src/pages/Stunden.tsx:181`
- **Problem:** Zeile 120 berechnet canCreateForOthers = isAdmin || hasPermission('stunden.create_andere'), Zeile 217 setzt daraus mode='admin' und rendert den PersonPicker. Der Lade-Effect (Zeilen 171-200, deps [user, isAdmin]) befüllt allMembers/allPartien aber nur im Zweig `if (isAdmin)` bzw. `else if (p)` (eigene Partie). Ein User mit stunden.create_andere, aber ohne admin.view/system.admin_panel (in der Prod-DB existiert genau so eine Rolle: 'zimmermeister' hat stunden.create_andere, aber keine Admin-Permission; isAdmin in AuthContext.tsx:164-171 prüft nur system.admin_panel/admin.view) und ohne eigene Partie bekommt allMembers=[] und allPartien=[]. Zusätzlich hat der Prefill-Effect (Zeile 148) dieselbe Asymmetrie: `if (isAdmin || polierPartie)` — Kollegen aus der Tagesplanung werden nicht vorselektiert.
- **Failure-Szenario:** Ein Mitarbeiter bekommt die Rolle 'zimmermeister' (oder eine Custom-Rolle 'Bauleiter-Vertretung' mit stunden.create_andere) zugewiesen. Er öffnet /stunden: Der Personen-Picker erscheint im Admin-Modus, aber der Dialog zeigt 'Keine weiteren Mitarbeiter.' und der 'Alle'-Button selektiert nur ihn selbst. Er kann für niemanden außer sich Stunden erfassen — obwohl die RLS-Policy stunden_tage_insert_self es ihm serverseitig erlauben würde.
- **Fix-Hinweis:** Ladebedingung in Zeile 181 auf canCreateForOthers erweitern (if (isAdmin || hasPermission('stunden.create_andere'))), Effect-Deps entsprechend anpassen, und im Prefill-Effect Zeile 148 ebenfalls canCreateForOthers verwenden.

### [29] stunden.create_andere und stunden.edit_alle umgehen Monatssperre und Status-Kette komplett — inkl. Löschen exportierter Tage
- **Status:** OFFEN
- **Ort:** `DB:stunden_tage_update/stunden_tage_delete (RLS)`
- **Problem:** stunden_tage_update: `is_admin OR has_permission('stunden.create_andere') OR has_permission('stunden.edit_alle') OR (owner AND status IN (...) AND NOT month_locked)` — die beiden Permission-Zweige haben keinerlei month_locked- oder Status-Einschränkung. stunden_tage_delete erlaubt has_permission('stunden.create_andere') sogar das Löschen JEDES Tages (auch status='exportiert', auch in gesperrten Monaten), während der Owner-Zweig korrekt auf status='erfasst' AND NOT month_locked eingeschränkt ist. 'stunden.create_andere' ist eine Erfassungs-Berechtigung (Rolle 'zimmermeister' hat sie ohne Admin-Rechte) — dass sie stärker ist als die Monatssperre, ist mit hoher Wahrscheinlichkeit nicht gewollt.
- **Failure-Szenario:** Ein Zimmermeister (Rolle mit stunden.create_andere, kein Admin) korrigiert im Juli 'versehentlich' einen Tag aus dem per Monatsabschluss (17.-31.05. existiert real in der Prod-DB) gesperrten Mai eines Mitarbeiters oder löscht ihn komplett — die Abrechnung, die das Büro auf Basis des Abschlusses gemacht hat, stimmt nicht mehr mit der DB überein, ohne dass es jemand merkt.
- **Fix-Hinweis:** Die Permission-Zweige in beiden Policies um `AND NOT month_locked(mitarbeiter_id, datum)` (und beim Delete um einen Status-Check) ergänzen; nur is_admin_role sollte die Sperre durchbrechen dürfen — oder eine eigene Permission stunden.locked_edit einführen.

### [30] Nach Teilfehler in der Sammelerfassung wird das Formular trotzdem geleert und das Datum weitergeschaltet — Eingaben der fehlgeschlagenen MA sind weg
- **Status:** OFFEN — Formular-Reset nach Teilfehler
- **Ort:** `src/pages/Stunden.tsx:804`
- **Problem:** submit() sammelt Fehler pro MA korrekt in errors[] (Zeile 780-782), aber der Reset-Block (Zeilen 804-814) hängt nur an `!aktuellerEigenerTag`: maEintraege wird geleert und date auf +1 Tag gesetzt, unabhängig davon ob errors.length > 0. Der destruktive Toast mit der Fehlerliste verschwindet nach wenigen Sekunden.
- **Failure-Szenario:** Polier speichert für 5 MA, bei Person 3 schlägt der Save fehl (z.B. RLS/Netzwerk). Toast '4 von 5 gespeichert' erscheint kurz, gleichzeitig springt das Formular auf den nächsten Tag und alle eingegebenen Stunden/Baustellen/Notizen sind weg. Der Polier kann den fehlgeschlagenen MA nicht einfach nachspeichern, sondern muss zum Datum zurücknavigieren und alles neu eingeben — oder es unterbleibt und dem MA fehlen die Stunden.
- **Fix-Hinweis:** Reset und setDate nur bei errors.length === 0 ausführen; bei Teilfehler die fehlgeschlagenen MA selektiert lassen und die erfolgreichen aus forUserIds entfernen.

### [31] Halle-Save ermittelt die Tag-ID nur aus der 14-Tage-Liste — ältere existierende Tage führen zu duplicate-key-Fehler statt Update
- **Status:** OFFEN
- **Ort:** `src/pages/HalleErfassung.tsx:299`
- **Problem:** aktuellerEigenerTag kommt aus useStundenTageList mit fromDate = heute−14 (Zeilen 104-113). saveMut bekommt `id: aktuellerEigenerTag?.tag.id` (Zeile 300). Wählt der User über das Datums-Input ein Datum, das älter als 14 Tage ist und für das bereits ein stunden_tage-Eintrag existiert, ist aktuellerEigenerTag undefined → useSaveStundenTag macht INSERT → unique constraint stunden_tage_mitarbeiter_id_datum_key schlägt zu. Dasselbe Fenster existiert direkt nach dem Seitenaufruf, solange die tageList-Query noch lädt. Stunden.tsx ist hier robust (frischer existing-SELECT in submit, Zeile 618), HalleErfassung nicht.
- **Failure-Szenario:** Werkstatt-MA will am 2.07. seine Stunden vom 15.06. korrigieren (dort existiert schon ein Tag). Er wählt das Datum auf /halle — die Seite zeigt 'Tag erfassen' statt 'Tag bearbeiten' (bestehende Einträge werden nicht geladen), er trägt neu ein und bekommt beim Speichern den kryptischen Fehler 'duplicate key value violates unique constraint "stunden_tage_mitarbeiter_id_datum_key"'. Bearbeiten älterer Tage ist über die Halle-Seite unmöglich.
- **Fix-Hinweis:** Vor dem Save den existierenden Tag frisch per SELECT auf (mitarbeiter_id, datum) auflösen (wie Stunden.tsx submit) oder fromDate an das gewählte Datum koppeln; zusätzlich Status-Guard ergänzen (siehe RLS-Finding).

### [32] Sollstunden 2026 KW45–53 sind uniforme 40h-Platzhalter (inkl. Weihnachtsfeiertagen) — automatische Abschlüsse ab 16.11. buchen falsches Soll
- **Status:** OFFEN
- **Ort:** `DB:arbeitszeitkalender`
- **Problem:** Alle Zeilen jahr=2026, kw=45–53 stehen auf Mo–Fr je 8,0h (im Kontrast zum gepflegten Muster, z.B. KW44: 0/9/9/9/6). Auch KW52/53 mit 24.12., 25.12., 28.–31.12. und 1.1.2027 (ISO-KW53/2026) haben volle 8h-Solltage. Der pg_cron-Job (täglich 18:00 UTC) erzeugt ab 16.11. automatisch Berichte, deren Bestätigung monatsabschluss_durchfuehren mit diesen falschen Sollwerten ausführt. Für Feiertage ohne manuell angelegten 'feiertag'-stunden_tag zählt Ist=0 gegen Soll=8h. Zudem existiert gar kein Kalender für 2025 (nur 2026/2027) — Alt-Perioden fielen auf den 40h-Fallback.
- **Failure-Szenario:** Büro bestätigt Mitte Januar den Bericht 17.–31.12.2026: Soll enthält je 8h für 24.12. und 25.12. (Feiertag/halber Tag) → jeder MA ohne Feiertags-Eintrag bekommt zu Unrecht bis zu 16 Minusstunden auf das ZA-Konto gebucht; bei realer Winterarbeitszeit (z.B. 36h-Woche) kommen weitere Fehl-Minusstunden pro Woche dazu.
- **Fix-Hinweis:** KW45–53/2026 (und 2027) mit echten Winter-/Feiertagswerten pflegen, bevor der erste November-Bericht bestätigt wird; Feiertage im Kalender mit 0h abbilden.

### [33] Doppelbuchungs-Schutz nur über exaktes Perioden-Label — überlappende Perioden werden doppelt ins ZA-Konto gebucht
- **Status:** OFFEN
- **Ort:** `DB:monatsabschluss_durchfuehren`
- **Problem:** Der Guard ist NOT EXISTS(... ma.monat = v_monat_label) plus UNIQUE(mitarbeiter_id, monat). Das Label hängt von von/bis ab ('YYYY-MM', '-H1', '-H2' oder 'von_bis'). Überlappende Zeiträume erzeugen unterschiedliche Labels und passieren den Guard. Die Funktion ist als RPC über PostgREST für jeden is_admin_role-Nutzer (auch Rolle bauleiter/buero) direkt aufrufbar. month_locked verhindert danach nur MA-Edits, nicht den zweiten Abschluss.
- **Failure-Szenario:** Bericht Teil 1 (1.–16.6.) wurde bestätigt → Label '2026-06-01_2026-06-16' + ZA-Buchung. Ein Admin ruft rpc('monatsabschluss_durchfuehren', {von:'2026-06-01', bis:'2026-06-30'}) auf → Label '2026-06' existiert nicht → zweite ZA-Buchung, die die Tage 1.–16. erneut enthält → Differenz der ersten Monatshälfte doppelt im ZA-Saldo.
- **Fix-Hinweis:** Vor dem Buchen auf Überlappung prüfen: NOT EXISTS (SELECT 1 FROM monatsabschluss WHERE mitarbeiter_id=... AND daterange(von_datum,bis_datum,'[]') && daterange(p_von_datum,p_bis_datum,'[]')) bzw. EXCLUDE-Constraint mit daterange.

### [34] Initial-Passwörter liegen dauerhaft im Klartext in invitation_logs.sms_text — lesbar für jeden mit admin.view (inkl. Rolle bauleiter)
- **Status:** OFFEN — Passwörter im Klartext in invitation_logs.sms_text (Redaktion nötig)
- **Ort:** `supabase/functions/send-invitation/index.ts:237`
- **Problem:** send-invitation und admin-create-employee speichern den kompletten SMS-Text inklusive generiertem Initial-Passwort in invitation_logs (in Prod: 2 von 4 Zeilen enthalten Passwörter). Die RLS ist zwar korrekt auf is_admin_role beschränkt (SELECT-Policy geprüft, anon hat keinen Zugriff) — aber is_admin_role umfasst neben geschaeftsfuehrung/buero auch bauleiter. Solange ein MA sein Passwort nie ändert (SMS-Login-Flow sieht keinen erzwungenen Wechsel vor), ist das dort gespeicherte Passwort sein aktuelles Login-Passwort.
- **Failure-Szenario:** Ein Nutzer mit Rolle bauleiter öffnet supabase.from('invitation_logs').select('sms_text') → erhält die Initial-Passwörter der eingeladenen Mitarbeiter und kann sich als beliebiger dieser MA einloggen (Stundeneinträge fälschen, Lohndaten einsehen), sofern das Passwort nie geändert wurde.
- **Fix-Hinweis:** Passwort vor dem Log-Insert aus sms_text maskieren (z.B. '••••'), Passwort-Wechsel beim Erst-Login erzwingen, bestehende Zeilen bereinigen.

### [35] krankmeldung_to_stunden_tage: einzige SECURITY-DEFINER-Funktion ohne search_path, schreibt ungeprüft in abgeschlossene Perioden und räumt beim Löschen nicht auf
- **Status:** GEFIXT — Migration 20260702: search_path gesetzt
- **Ort:** `supabase/migrations/20260527000000_safe_alle_neuen_tabellen.sql:98`
- **Problem:** pg_proc bestätigt: prosecdef=true, proconfig=NULL — als einzige DEFINER-Funktion ohne SET search_path=public (Injection-Härtungs-Lücke, Prüfpunkt 8). Inhaltlich: der AFTER-INSERT-Trigger legt krank-Tage ohne month_locked-Check auch in bereits bestätigte/abgeschlossene Perioden (SECURITY DEFINER umgeht die RLS von stunden_tage). Für DELETE auf krankmeldungen (per RLS krank_delete dem MA selbst erlaubt) gibt es keinen Trigger — die erzeugten krank-Tage bleiben stehen.
- **Failure-Szenario:** MA meldet am 20.6. rückwirkend Krankenstand 10.–14.6., obwohl der Bericht 1.–16.6. schon bestätigt und die ZA-Differenz gebucht ist → neue krank-Tage erscheinen in der gesperrten Periode, unterschriebener Bericht und ZA-Buchung stimmen nicht mehr mit den Daten überein. Löscht der MA die Krankmeldung danach wieder, bleiben die krank-Tage (mit Soll-Gutschrift bei künftigen Abschlüssen) trotzdem bestehen.
- **Fix-Hinweis:** SET search_path=public ergänzen; im Trigger month_locked prüfen (Tage in gesperrten Perioden ablehnen oder überspringen); AFTER DELETE-Trigger zum Aufräumen der erzeugten krank-Tage (nur status='ma_bestaetigt'/tag_status='krank').

### [36] Bericht wird trotz fehlgeschlagener PDF-Erzeugung freigegeben — das try/catch in freigeben() ist toter Code
- **Status:** OFFEN
- **Ort:** `src/pages/BerichtDetail.tsx:1493`
- **Problem:** freigeben() (Z. 1480-1506) kommentiert: 'PDF zuerst generieren — wenn das fehlschlägt, NICHT auf freigegeben wechseln'. Aber generatePdf() (Z. 1405-1472) fängt ALLE Fehler intern in seinem eigenen try/catch (Z. 1463) und wirft nie weiter. Das await generatePdf() in freigeben kann daher nie in den catch-Zweig laufen, und Z. 1504 setzt den Status immer auf 'freigegeben'. Zusätzlich ist statusMut.mutateAsync (Z. 1504) nicht in try/catch → bei DB-Fehler unhandled rejection.
- **Failure-Szenario:** Bauleiter klickt 'Freigeben + PDF erstellen', ein Foto-Signed-URL-Fetch oder der PDF-Upload schlägt fehl (Funkloch auf der Baustelle) → Toast 'PDF-Erstellung fehlgeschlagen' erscheint, aber der Bericht wechselt trotzdem auf Status 'freigegeben' ohne pdf_dokument_id — exakt der Zustand, der laut Code-Kommentar 'den Workflow blockiert' ('Per Mail teilen' verschickt dann '(PDF noch nicht generiert)').
- **Fix-Hinweis:** generatePdf soll den Fehler rethrowen (oder boolean zurückgeben) und freigeben nur bei Erfolg den Status setzen; statusMut.mutateAsync in try/catch.

### [37] finalizeLogin verschluckt Query-Fehler und loggt aktive User mit falscher Meldung 'Konto noch nicht freigeschaltet' aus
- **Status:** OFFEN
- **Ort:** `src/pages/Auth.tsx:59`
- **Problem:** finalizeLogin (Z. 58-77) destrukturiert nur { data: profile } ohne error-Check. Schlägt die profiles-Query fehl (Funkloch, kurzer Netzfehler direkt nach dem OTP-Login, RLS-Problem), ist profile null → !profile?.is_active greift → signOut + Toast 'Konto noch nicht freigeschaltet — wartet auf Freischaltung durch das Büro'.
- **Failure-Szenario:** Mitarbeiter tippt auf der Baustelle den korrekten SMS-Code ein, der Login gelingt, aber der anschließende profiles-Fetch scheitert am wackligen Netz → er wird sofort wieder ausgeloggt und bekommt gesagt, sein Konto sei nicht freigeschaltet. Er ruft im Büro an statt es einfach nochmal zu versuchen — das Büro findet ein aktives Konto und kann sich den Fehler nicht erklären.
- **Fix-Hinweis:** error prüfen und bei Query-Fehler eine 'Netzwerkfehler — bitte erneut versuchen'-Meldung zeigen (ohne signOut); nur bei explizitem is_active=false ausloggen.

### [38] Phone-OTP läuft nach 60 Sekunden ab (Prod-Config bestätigt) — zu knapp für SMS-Zustellung plus Eintippen
- **Status:** GEFIXT — Auth-Config: sms_otp_exp 60→300s
- **Ort:** `src/pages/Auth.tsx:115`
- **Problem:** Die Produktions-Auth-Config hat sms_otp_exp=60 (per Management-API verifiziert; die SMS sagt selbst 'Gültig 60 Sek.'). Twilio-Zustellung dauert oft 10-40s, dann muss der Nutzer die App wechseln und 6 Ziffern eintippen. handleVerifyOtp (Z. 121-127) zeigt bei Ablauf nur die rohe englische Supabase-Meldung ('Token has expired or is invalid') als Toast — für die Zielgruppe unverständlich, und es gibt keinen direkten 'Neuen Code anfordern'-Hinweis im Fehlerfall.
- **Failure-Szenario:** Zimmerer fordert Code an, SMS kommt nach 30s, er braucht 40s zum App-Wechsel und Eintippen → verifyOtp schlägt fehl mit englischem Fehlertext 'Token has expired or is invalid'. Nach mehreren Versuchen gibt er auf und ruft das Büro an — der Telefon-Login ist praktisch unbenutzbar bei langsamer SMS-Zustellung.
- **Fix-Hinweis:** sms_otp_exp auf 300-600s erhöhen (Supabase Dashboard/Management API, SMS-Text im send-sms-hook anpassen); Fehlermeldung in Auth.tsx auf 'expired/invalid' matchen und deutsch erklären + Resend-Button prominent anbieten.

### [39] Zeiterfassung-Save: Delete-Fehler im Replace-Pattern unchecked — Tageseinträge können verdoppelt werden oder verloren gehen
- **Status:** OFFEN
- **Ort:** `src/hooks/useStundenTag.ts:153`
- **Problem:** useSaveStundenTag ersetzt Kinder-Zeilen per delete→insert: die Deletes auf stunden_taetigkeiten (Z. 153), stunden_zulagen (Z. 171) und stunden_fahrt (Z. 191) prüfen den error nicht (die Inserts schon). supabase-js wirft bei fetch-Fehlern nicht, sondern liefert { error } → ein fehlgeschlagener Delete fällt still durch. Außerdem ist die Sequenz nicht transaktional: gelingt der Delete, scheitert aber der Insert, sind die alten Einträge bereits weg.
- **Failure-Szenario:** (a) Polier speichert den Tag erneut; der Delete-Request scheitert an kurzem Netzabriss, der Insert direkt danach gelingt → der Tag hat alte UND neue stunden_taetigkeiten, der DB-Trigger leitet daraus verdoppelte netto_stunden ab → falsche Stunden im Baustellenstundenbericht/Lohn. (b) Delete gelingt, Insert scheitert → alle Tätigkeiten des Tages sind weg, nur eine Fehlermeldung ohne Hinweis, dass vorhandene Daten gelöscht wurden.
- **Fix-Hinweis:** Delete-Errors prüfen und bei Fehler abbrechen (throw); besser: Save als RPC/Postgres-Funktion transaktional machen.

### [40] PWA: stilles autoUpdate ohne Update-Prompt/periodischen Check — veraltete Clients laufen tagelang, Lazy-Chunks 404en nach Deploy
- **Status:** OFFEN
- **Ort:** `vite.config.ts:17`
- **Problem:** VitePWA mit registerType 'autoUpdate' generiert einen SW mit skipWaiting+clientsClaim+cleanupOutdatedCaches (in dist/sw.js verifiziert); registerSW.js registriert nur, ohne Update-Intervall oder Reload-Handling. In der Standalone-PWA wird die Seite oft tagelang nicht neu geladen → der SW prüft nur bei Navigation auf Updates, User laufen mit altem Bundle gegen neue Edge-Functions/RPCs (Schema-Drift). Sobald der neue SW doch aktiviert (skipWaiting, während die alte Seite offen ist), räumt cleanupOutdatedCaches die alten Precache-Einträge weg — die alten Hash-Dateinamen existieren im neuen Vercel-Deployment nicht mehr (404). Die App nutzt Lazy-Chunks (pdfjs-dist + pdf.worker, mammoth in src/components/dokumente/Thumbnail.tsx Z. 48/50/127).
- **Failure-Szenario:** Bauleiter hat die PWA seit Montag offen; Mittwoch wird deployed. Er navigiert, der neue SW aktiviert sofort und löscht den alten Cache, die laufende Seite ist aber noch der alte Build → beim Öffnen des Dokumente-Tabs schlägt der Import von pdf.worker-<altHash>.mjs mit 404 fehl, alle PDF-Thumbnails zeigen dauerhaft den Fehlerzustand; parallel rufen alte Clients ggf. geänderte RPC-Signaturen auf und bekommen kryptische Fehler. Es gibt keinerlei Hinweis 'Neue Version verfügbar — neu laden'.
- **Fix-Hinweis:** registerType 'prompt' + virtual:pwa-register mit onNeedRefresh-Banner ('Neu laden'), oder bei autoUpdate ein registerSW mit periodischem update()-Intervall und automatischem window.location.reload() bei controllerchange.

### [41] load() ohne error-Handling: bei fehlgeschlagener Query zeigt der Zugang-senden-Tab 'Keine manuell angelegten Mitarbeiter gefunden'
- **Status:** GEFIXT — AdminZugangVerschicken: load() mit Fehler-Toast
- **Ort:** `src/components/admin/AdminZugangVerschicken.tsx:41`
- **Problem:** load() (Z. 37-72) destrukturiert bei beiden Queries (profiles Z. 41, invitation_logs Z. 48) nur data ohne error-Check. Bei Query-Fehler (Netz, RLS) wird rows=[] gesetzt und die UI rendert den Leer-Zustand 'Keine manuell angelegten Mitarbeiter gefunden' (Z. 222-228) statt einer Fehlermeldung. Schlägt nur die logs-Query fehl, zeigen alle MA fälschlich 'Noch nie verschickt' — der Admin verschickt erneut und rotiert damit unnötig Passwörter ('Frühere Passwörter funktionieren danach nicht mehr'). Zudem verliert sendZugang bei non-2xx-Antworten der Edge-Function (401/403) die eigentliche Fehlermeldung, weil functions.invoke dann data=null liefert und error.message nur 'Edge Function returned a non-2xx status code' ist.
- **Failure-Szenario:** Admin öffnet unterwegs den Tab 'Zugang senden' bei schlechtem Empfang → profiles-Query scheitert → Anzeige 'Keine manuell angelegten Mitarbeiter gefunden'. Der Admin schließt daraus, dass die importierten MA fehlen/gelöscht wurden, und legt sie schlimmstenfalls neu an. Variante: nur die logs-Query scheitert → alle Badges zeigen 'Noch nie verschickt' → Admin sendet erneut und invalidiert funktionierende Initial-Passwörter.
- **Fix-Hinweis:** Beide errors prüfen, Fehler-Card mit Retry-Button rendern; window.confirm (Z. 128) durch einen AlertDialog ersetzen (in Standalone-PWAs unzuverlässig und blockierend).

### [42] Angebot löschen: Storage-Dateien werden vor dem DB-Delete entfernt und der Delete-Fehler ignoriert — 'Angebot gelöscht' auch wenn nichts gelöscht wurde
- **Status:** OFFEN
- **Ort:** `src/pages/AngebotDetail.tsx:178`
- **Problem:** deleteAngebot (Z. 153-181) löscht zuerst alle Storage-Objekte (Z. 176, error unchecked) und dann die angebote-Zeile (Z. 178, error unchecked), zeigt danach immer 'Angebot gelöscht' und navigiert weg. Schlägt der DB-Delete fehl (Netzfehler; oder 0 Zeilen), existiert das Angebot weiter — aber seine Dokumente sind bereits unwiederbringlich aus dem Storage entfernt.
- **Failure-Szenario:** Admin löscht ein Angebot; nach dem Storage-remove bricht die Verbindung ab und der angebote-Delete scheitert → Toast 'Angebot gelöscht', Navigation zur Liste. Später taucht das Angebot wieder auf, aber alle hinterlegten Angebots-PDFs sind weg (Downloads schlagen fehl).
- **Fix-Hinweis:** Reihenfolge umdrehen (erst DB-Delete mit error-Check, dann Storage best-effort) oder beides in einer RPC; Erfolgs-Toast nur bei bestätigtem Delete.

### [43] Tagesplanung: MA-Zuteilung löscht alte Einteilung und ignoriert den Insert-Fehler — Mitarbeiter kann komplett aus dem Tagesplan verschwinden
- **Status:** OFFEN
- **Ort:** `src/pages/Tagesplanung.tsx:426`
- **Problem:** assignMaToBaustelle (Z. 387-438) entfernt zuerst alle heutigen einteilung_mitarbeiter-Zeilen des MA (Z. 418-423, error unchecked) und insertet ihn dann in die neue Einteilung (Z. 426-433) — der Insert-Fehler wird nicht geprüft (nur 'if (inserted)'). Gleiches Muster in addEinteilung (Z. 300-320: MA-/Fahrzeug-Inserts unchecked) und in den Kopier-Funktionen uebernehmePlanVomVortag/uebernehmeAusJahresplanung (Z. 551, 562, 654, 664: Inserts unchecked, Erfolgs-Toast 'N Einteilungen übernommen' kommt trotzdem).
- **Failure-Szenario:** Planer zieht einen MA per Drag&Drop auf eine andere Baustelle; der Delete geht durch, der Insert scheitert (kurzer Netzabriss) → der MA ist für heute NIRGENDS mehr eingeteilt, ohne Fehlermeldung. Auf 'Mein Tag' sieht der Mitarbeiter am Morgen keine Einteilung und fährt zur falschen/keiner Baustelle. Beim Vortags-Kopieren scheitert der MA-Insert einer Einteilung → Toast '5 Einteilungen übernommen', aber die Partie fehlt auf der Baustelle im Plan.
- **Fix-Hinweis:** Insert-Errors prüfen und bei Fehler den alten Zustand nicht löschen (Reihenfolge: erst insert, dann delete der alten Zuteilung) + Fehler-Toast; Kopier-Loops sollten Fehler zählen und im Toast ausweisen.

## LOW (10)

### [44] Zwei DB-Overloads von stunden_bericht_versenden → jeder 2-Argument-Aufruf scheitert deterministisch mit PGRST203 (Ambiguität)
- **Status:** GEFIXT — Migration 20260702: 2-arg-Overload gedroppt
- **Ort:** `src/hooks/useStundenBericht.ts:161`
- **Problem:** Migration 20260616000000_bsb_buero_unterschrift.sql hat stunden_bericht_versenden(p_id, p_mail, p_unterschrift DEFAULT NULL) per CREATE OR REPLACE angelegt, ohne die alte 2-Arg-Version stunden_bericht_versenden(p_id, p_mail) aus 20260611000000_bsb_versand.sql zu droppen — beide existieren in der Produktions-DB (pg_proc oids 20060 und 20488). Empirisch verifiziert: POST /rest/v1/rpc/stunden_bericht_versenden mit {p_id, p_mail} liefert PGRST203 'Could not choose the best candidate function between ...(p_id, p_mail) und ...(p_id, p_mail, p_unterschrift)'. Die exportierte versenden-Mutation im Hook ruft genau diese 2-Arg-Form auf. Aktuell wird sie von keiner Seite verwendet (Versand läuft über die Edge-Function, die 3 benannte Args schickt und daher eindeutig auflöst) — aber jede künftige Verwendung dieser 'Workflow-Aktion' bricht sofort.
- **Failure-Szenario:** Ein Entwickler verdrahtet aktionen.versenden.mutate({id, mail}) (z.B. als Fallback ohne Mail-Anhang) → PostgREST antwortet 300/PGRST203, kein Bericht wird je versendet; der Fehlertext ist für Endnutzer unverständlich.
- **Fix-Hinweis:** DROP FUNCTION public.stunden_bericht_versenden(uuid, text); in einer Migration — die 3-Arg-Version mit DEFAULT NULL deckt beide Fälle ab. Danach den 'as any'-Cast im Hook entfernen und p_unterschrift explizit mitschicken.

### [45] PDF druckt bei unbestätigten Berichten 'geprüft am <heute>' — das offizielle Dokument behauptet eine Büro-Prüfung, die nie stattfand
- **Status:** OFFEN
- **Ort:** `src/lib/bsbPdfHelper.ts:268`
- **Problem:** bestaetigtAm fällt auf new Date().toLocaleDateString('de-AT') zurück, wenn bericht.bestaetigt_am NULL ist; baustellenstundenberichtPdf.ts Zeile 261 druckt den Wert bedingungslos ('geprüft am: ...'). Damit trägt jedes PDF eines noch offenen oder nur unterschriebenen Berichts das heutige Datum im Geprüft-Feld. Betrifft auch den Bulk-Versand aus der Liste (ohne Büro-Signatur): Das ans Büro gemailte PDF weist eine Prüfung mit Datum aus, obwohl bestaetigt_am erst durch die (aktuell fehlschlagende) RPC gesetzt würde.
- **Failure-Szenario:** MA öffnet auf seinem noch offenen Bericht 'PDF ansehen' → das PDF zeigt 'geprüft am: 02.07.2026', obwohl das Büro nie geprüft hat; landet dieses PDF beim Lohnbüro, dokumentiert es eine nicht erfolgte Kontrolle.
- **Fix-Hinweis:** bestaetigtAm: bericht.bestaetigt_am ? ... : null durchreichen und im Template leer lassen; den Heute-Fallback nur setzen, wenn bueroSignaturOverride übergeben wurde (der Fall 'wird im selben Schritt bestätigt').

### [46] send-sms-hook 'fails open': ohne SEND_SMS_HOOK_SECRET wird unverifiziertes JSON verarbeitet → offenes SMS-Relay
- **Status:** GEFIXT — send-sms-hook: fail-closed ohne Secret
- **Ort:** `supabase/functions/send-sms-hook/index.ts:70`
- **Problem:** Die Function hat verify_jwt=false (config.toml + deployed bestätigt). Die Webhook-Signaturprüfung läuft nur, wenn HOOK_SECRET nicht leer ist (Zeile 62). Ist SEND_SMS_HOOK_SECRET leer/nicht gesetzt, geht der else-Zweig (Zeile 70-76) und parst den Body OHNE jede Verifikation, danach wird Twilio angesteuert (Zeile 88-99). Aktuell ist das Secret gesetzt (mitigiert), aber der Code 'failt open' statt 'closed': bei versehentlichem Löschen/Rotieren des Secrets wird der Endpoint zum offenen SMS-Relay.
- **Failure-Szenario:** Secret wird beim Rotieren kurz entfernt/leer gesetzt. Ein Angreifer POSTet {"user":{"phone":"+43…"},"sms":{"otp":"WERBUNG http://evil"}} an die öffentliche Function-URL → beliebige SMS gehen auf Kosten des Twilio-Accounts an beliebige Nummern (Toll-Fraud/Spam).
- **Fix-Hinweis:** Bei fehlendem HOOK_SECRET mit 500 abbrechen statt unverifiziert zu senden (fail closed).

### [47] Sync-Trigger Richtung 1 macht reine role-UPDATEs zum stillen No-Op — Migrations-Kommentar verspricht das Gegenteil
- **Status:** GEFIXT — Migration 20260702: Sync-Trigger behandelt reine role-Updates
- **Ort:** `supabase/migrations/20260629100000_user_roles_rolle_id_sync.sql:62`
- **Problem:** Keine Endlos-Rekursion (BEFORE-Trigger, NEW-Mutation feuert nicht erneut) — aber: Da nach dem Backfill JEDE user_roles-Zeile rolle_id gesetzt hat (DB verifiziert: 0 NULLs), greift bei jedem UPDATE zuerst der Richtung-1-Zweig (Z.62-67) und überschreibt NEW.role sofort wieder aus der ALTEN rolle_id. Ein 'UPDATE user_roles SET role=…' ohne rolle_id ist damit wirkungslos — kein Fehler, kein Hinweis. Der Kommentar der Migration ('greift auch für jeden Aufrufer der wider Erwarten nur role setzt', Z.11-13) stimmt nur für INSERTs; Richtung 2 ist bei UPDATEs de facto unerreichbar. Aktuell nutzt zwar kein Codepfad UPDATE-only-role (Frontend/Edge-Functions machen delete+insert, keine DB-Funktion updated user_roles — per pg_proc.prosrc geprüft), aber jeder künftige oder manuelle Schreibpfad tappt hinein.
- **Failure-Szenario:** Support befördert per SQL-Konsole einen User: UPDATE user_roles SET role='geschaeftsfuehrung' WHERE user_id=… → Statement meldet UPDATE 1, aber der Trigger setzt role sofort auf den legacy_enum der alten rolle_id zurück; rolle_id (die einzige Quelle für has_permission) bleibt unverändert — der User bleibt Mitarbeiter, niemand versteht warum.
- **Fix-Hinweis:** Richtung 1 nur ausführen wenn (TG_OP='INSERT' OR NEW.rolle_id IS DISTINCT FROM OLD.rolle_id); bei geändertem role-ENUM rolle_id neu ableiten.

### [48] Deep-Link geht beim Login verloren: state.from wird gesetzt, aber nie ausgewertet
- **Status:** OFFEN
- **Ort:** `src/pages/Auth.tsx:76`
- **Problem:** ProtectedRoute leitet Nicht-Eingeloggte mit state={{from: location}} nach /auth (ProtectedRoute.tsx:22), aber Auth.tsx navigiert nach erfolgreichem Login stur nach '/' (Z.40 bei bestehender Session, Z.76 nach Login) — location.state.from wird nirgends gelesen.
- **Failure-Szenario:** Mitarbeiter bekommt den 14-tägigen Baustellenstundenbericht-Link per SMS (/stundenbericht/:id), ist ausgeloggt → Login → landet am Dashboard statt am Bericht und muss den Link erneut öffnen; auf iOS-PWA ist die SMS dann oft weg.
- **Fix-Hinweis:** Nach Login zu (location.state?.from?.pathname ?? '/') navigieren.

### [49] Bedingter Early-Return vor den useState-Hooks — latenter 'Rendered fewer hooks'-Crash ohne ErrorBoundary
- **Status:** OFFEN
- **Ort:** `src/components/admin/AdminBerechtigungen.tsx:86`
- **Problem:** Der Guard `if (permissionsLoaded && !hasPermission(…)) return …` (Z.86-94) steht VOR ~10 useState/useEffect-Hooks (Z.96 ff.). Ändert sich hasPermission('system.manage_permissions') zur Laufzeit von true auf false (z.B. via refreshOwnPerms nach einem Save, oder sobald der Realtime-Fix aus Fund 2 kommt), rendert die Komponente plötzlich weniger Hooks → React wirft 'Rendered fewer hooks than expected' und die App hat keine ErrorBoundary (main.tsx) → weißer Bildschirm. Aktuell schwer auslösbar (permissionsLoaded ist beim Mount praktisch immer schon true), aber sobald Permissions live nachgeladen werden, wird das zum Crash.
- **Failure-Szenario:** GF A entzieht Rolle X system.manage_permissions, während User B (Rolle X) den Berechtigungen-Tab offen hat und selbst speichert → refreshOwnPerms flippt hasPermission → Hook-Anzahl schrumpft → React-Exception, weiße Seite statt der 'Keine Berechtigung'-Card.
- **Fix-Hinweis:** Guard hinter die Hook-Deklarationen verschieben oder in eine Wrapper-Komponente auslagern.

### [50] stunden_bericht_wieder_oeffnen prüft den Berichtsstatus nicht — offene Berichte werden ohne Unterschrift zu 'unterschrieben'
- **Status:** GEFIXT — Migration 20260702: Status-Guard in wieder_oeffnen
- **Ort:** `supabase/migrations/20260605000000_baustellenstundenbericht.sql:258`
- **Problem:** Die Funktion setzt bedingungslos status='unterschrieben' (bestaetigt_von/-am NULL), egal ob der Bericht 'bestaetigt', 'unterschrieben' oder noch 'offen' ist. Es fehlt das Pendant zum Status-Guard in stunden_bericht_bestaetigen ('nicht im Status unterschrieben').
- **Failure-Szenario:** Admin ruft wieder_oeffnen versehentlich auf einem noch offenen (nie unterschriebenen) Bericht auf → Status springt auf 'unterschrieben' mit unterschrift_data=NULL/unterschrieben_am=NULL → Büro kann den Bericht direkt bestätigen und die ZA-Buchung auslösen, ohne dass der Mitarbeiter je unterschrieben hat; der Kontroll-/Nachweiszweck des Workflows ist ausgehebelt.
- **Fix-Hinweis:** IF r.status <> 'bestaetigt' THEN RAISE EXCEPTION; bzw. bei 'offen' unverändert lassen; Zielstatus aus vorherigem Zustand ableiten (unterschrieben_am beibehalten nur wenn Unterschrift existiert).

### [51] Division durch 0 in stunden_tag_recompute, wenn tagesnorm_stunden=0 gesetzt wird — Zeiterfassung des MA crasht beim Speichern von Urlaub
- **Status:** GEFIXT — Migration 20260702: NULLIF-Guard gegen Division durch 0
- **Ort:** `DB:stunden_tag_recompute`
- **Problem:** profile_konten_settings hat keinerlei CHECK-Constraints (nur PK+FK, in Prod verifiziert). stunden_tag_recompute rechnet ROUND(v_urlaub / v_tagesnorm, 2); COALESCE fängt nur NULL, nicht 0. Setzt ein Admin tagesnorm_stunden=0 (z.B. für einen ruhenden MA), wirft jeder Save mit Urlaub-Segment division_by_zero und der komplette INSERT/UPDATE auf stunden_taetigkeiten schlägt fehl. Aktuell 0 betroffene Zeilen, aber nichts verhindert den Zustand.
- **Failure-Szenario:** Admin setzt in den Konten-Einstellungen eines MA tagesnorm_stunden auf 0 → der MA erfasst einen Urlaubstag → 'division by zero'-Fehler, der Tag lässt sich nicht mehr speichern; für den MA sieht es wie ein App-Totalausfall der Zeiterfassung aus.
- **Fix-Hinweis:** CHECK (tagesnorm_stunden > 0) auf profile_konten_settings; im Trigger NULLIF(v_tagesnorm, 0) mit Fallback 8.0.

### [52] Pflicht-Unterweisung anlegen: Unterschriften-Insert und baustellen-Update ohne Fehlerprüfung — Unterweisung kann wirkungslos bleiben
- **Status:** OFFEN
- **Ort:** `src/pages/BaustelleDetail.tsx:211`
- **Problem:** setPflichtUnterweisung (Z. 171-222) legt die Evaluierung mit error-Check an, aber der Insert der evaluierung_unterschriften-Zeilen (Z. 211) und das Setzen von baustellen.pflicht_evaluierung_id (Z. 213-216) sind unchecked. Der Toast behauptet anschließend 'X Mitarbeiter müssen unterschreiben'. Schlägt das Update fehl, referenziert die Baustelle die Pflicht-Unterweisung nie; schlagen die Unterschriften-Inserts fehl, greift der EvaluierungSignatureGate für die Partie-Mitglieder nicht.
- **Failure-Szenario:** Bauleiter legt für eine Baustelle die Pflicht-Unterweisung 'fertigteilmontage' an; der unterschriften-Insert scheitert → Toast '6 Mitarbeiter müssen unterschreiben', aber niemand bekommt den Signatur-Gate angezeigt und der Unterschriften-Fortschritt bleibt 0/0. Die Sicherheits-Dokumentation (Arbeitnehmerschutz) fehlt, ohne dass es jemand merkt.
- **Fix-Hinweis:** Beide Operationen auf error prüfen, bei Fehler die angelegte Evaluierung zurückrollen oder klaren Fehler-Toast zeigen.

### [53] Arbeitszeitkalender 'Jahr initialisieren': Insert-Fehler wird verschluckt, Erfolgs-Toast kommt immer
- **Status:** OFFEN
- **Ort:** `src/pages/Kalender.tsx:182`
- **Problem:** ensureYear (Z. 156-188) insertet die fehlenden KW-Zeilen ohne error-Check und zeigt danach immer 'N Wochen für JAHR angelegt'. Der Arbeitszeitkalender ist laut Projektdoku die einzige Quelle für Soll-Stunden — fehlende Wochen führen zu Soll=0 in der Stundenauswertung/ZA-Konten.
- **Failure-Szenario:** Admin klickt 'Jahr 2027 initialisieren', der Insert scheitert (RLS/Netz) → Toast '53 Wochen für 2027 angelegt', die Tabelle bleibt nach dem Reload leer. Wochen später liefern ZA-Konten und Stundenberichte für 2027 falsche Salden (Soll 0h), und niemand erinnert sich, dass die Initialisierung nie ankam.
- **Fix-Hinweis:** error prüfen, Fehler-Toast + kein Erfolgs-Toast; load() erst nach bestätigtem Insert.
