-- =====================================================================
-- Tätigkeitsbericht — Zeiterfassung für Angestellte
--
-- AUSGANGSLAGE: Die Angestellten führen ihre Zeiten in einer Excel
-- („Tätigkeitsbericht", Matrix Kostenstelle × Tag, Periode 21.–20.), weil
-- die App-Erfassung auf Bauarbeiter zugeschnitten ist (Baustelle, Zulagen,
-- Taggeld, Fahrtgeld je Tag). Von 12 Personen mit Gehalt (GE) hatten 4
-- keinen einzigen erfassten Tag.
--
-- DIESE MIGRATION legt das Fundament. Wichtig: die neue Oberfläche schreibt
-- in DIESELBEN Tabellen (stunden_tage + stunden_taetigkeiten) wie die
-- bestehende Erfassung. Kein zweiter Datentopf — damit rechnen Auswertung,
-- Monatsabschluss sowie ZA- und Urlaubskonto unverändert mit und die Zahlen
-- können nicht auseinanderlaufen.
--
--   1. profiles.zeiterfassung_typ  — der Umschalter pro Mitarbeiter
--   2. taetigkeiten_stamm.bereich = 'buero' + Spalte kostenstelle
--      → die internen Kostenstellen der Excel (4890 Kalkulation usw.)
--   3. Arbeitszeitmodell 'angestellter' (8,5/8,5/8,5/8,5/5 = 39 h)
--   4. Berechtigung stunden.taetigkeitsbericht
-- =====================================================================


-- ─── 1. Umschalter am Profil ─────────────────────────────────────────
--
-- Muster: profiles.in_tagesplanung (20260716200000). Gehört an das Profil,
-- nicht in profile_konten_settings — letzteres ist reine Soll-/Konten-
-- Konfiguration.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS zeiterfassung_typ TEXT NOT NULL DEFAULT 'bauarbeiter';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_zeiterfassung_typ_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_zeiterfassung_typ_check
      CHECK (zeiterfassung_typ IN ('bauarbeiter', 'angestellter'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.zeiterfassung_typ IS
  '''bauarbeiter'' = herkömmliche Tageserfassung (/stunden). '
  '''angestellter'' = Tätigkeitsbericht, Matrix Kostenstelle × Tag.';

-- Vorbelegung: die Partie Büro. Bewusst NICHT über qualifikation =
-- ''Gehalt (GE)'' — darunter sind auch Reibnegger und Lampersberger, die
-- auf Baustellen arbeiten und in der Tagesplanung stehen.
UPDATE public.profiles p
   SET zeiterfassung_typ = 'angestellter'
 WHERE p.zeiterfassung_typ = 'bauarbeiter'
   AND p.partie_id IN (SELECT id FROM public.partien WHERE name = 'Büro');


-- ─── 2. Interne Kostenstellen ────────────────────────────────────────
--
-- taetigkeiten_stamm trägt schon einen bereich ('baustelle' | 'halle',
-- Migration 20260614000000). Dritter Bereich 'buero' statt einer neuen
-- Tabelle — dadurch greifen Stammdaten-Pflege, RLS und die bestehende
-- Verknüpfung stunden_taetigkeiten.taetigkeit_id unverändert.
-- Der bestehende CHECK erlaubt nur 'baustelle' | 'halle' | 'beide' und
-- würde die neuen Zeilen abweisen.
ALTER TABLE public.taetigkeiten_stamm
  DROP CONSTRAINT IF EXISTS taetigkeiten_stamm_bereich_check;
ALTER TABLE public.taetigkeiten_stamm
  ADD CONSTRAINT taetigkeiten_stamm_bereich_check
  CHECK (bereich IN ('baustelle', 'halle', 'beide', 'buero'));

ALTER TABLE public.taetigkeiten_stamm
  ADD COLUMN IF NOT EXISTS kostenstelle TEXT;

COMMENT ON COLUMN public.taetigkeiten_stamm.kostenstelle IS
  'Nur bereich = ''buero'': die 4-stellige Kostenstelle des Tätigkeitsberichts '
  '(z.B. 4890 Kalkulation). Bei Baustellen-Zeilen steckt sie in baustellen.kostenstelle.';

-- Startbestand 1:1 aus der Excel. sort_order in Zehnerschritten, damit
-- später etwas dazwischen passt.
INSERT INTO public.taetigkeiten_stamm (bezeichnung, kostenstelle, bereich, sort_order, is_active)
VALUES
  -- Interne Kostenstellen
  ('Kalkulation',                '4890', 'buero',  10, TRUE),
  ('Planung Verkauf',            '4895', 'buero',  20, TRUE),
  ('Zim Allgemein',              '4899', 'buero',  30, TRUE),
  ('Lager und Verw.',            '4901', 'buero',  40, TRUE),
  ('Zimmerei Erweiterung 2023',  '4913', 'buero',  50, TRUE),
  ('Gewährleistung',             '4997', 'buero',  60, TRUE),
  -- Bauleiter-Sammelkonten. In den Kostenstellen der Baustellen ist das
  -- die mittlere Vierergruppe: 1404020-2601 → 4020.
  ('Egger',                      '4020', 'buero', 110, TRUE),
  ('Maurer',                     '4030', 'buero', 120, TRUE),
  ('Gwenger',                    '4040', 'buero', 130, TRUE),
  ('Gruber',                     '4050', 'buero', 140, TRUE),
  ('Winkler',                    '4060', 'buero', 150, TRUE),
  ('Pließnig',                   '4070', 'buero', 160, TRUE),
  -- Eigene Zeile im Bericht: 24.12. und 31.12. laufen in der Excel als
  -- Sonderurlaub, nicht als gesetzlicher Feiertag.
  ('Sonderurlaub',               NULL,   'buero', 900, TRUE)
ON CONFLICT DO NOTHING;


-- ─── 3. Arbeitszeitmodell für Angestellte ────────────────────────────
--
-- profile_konten_settings.arbeitszeitmodell steuert das Tages-Soll
-- (useSollHoursForDay). Bisher stehen alle 45 auf 'zimmerei_sommer', das
-- den Arbeitszeitkalender der Arbeiter liest (9/9/9/9/6 bzw. 9/9/9/9/0).
-- Angestellte haben fix 8,5 Mo–Do und 5,0 Fr = 39 h.
UPDATE public.profile_konten_settings s
   SET arbeitszeitmodell = 'angestellter'
 WHERE s.profile_id IN (
   SELECT id FROM public.profiles WHERE zeiterfassung_typ = 'angestellter'
 );

-- Wer noch keine Konten-Einstellung hat, bekommt eine — sonst fällt das
-- Soll still auf 8 h/Mo-Fr zurück und DELTA wäre dauerhaft falsch.
INSERT INTO public.profile_konten_settings (profile_id, arbeitszeitmodell)
SELECT p.id, 'angestellter'
  FROM public.profiles p
 WHERE p.zeiterfassung_typ = 'angestellter'
   AND NOT EXISTS (
     SELECT 1 FROM public.profile_konten_settings s WHERE s.profile_id = p.id
   )
ON CONFLICT (profile_id) DO NOTHING;


-- ─── 4. Berechtigung ─────────────────────────────────────────────────
--
-- Der Menüpunkt selbst hängt am Schalter zeiterfassung_typ (jeder
-- Angestellte sieht seinen eigenen Bericht). Diese Berechtigung ist für
-- die, die FREMDE Berichte sehen dürfen — Büro und Geschäftsführung.
INSERT INTO public.berechtigungen
  (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order)
VALUES
  ('stunden.taetigkeitsbericht', 'stunden', 'view', 'taetigkeitsbericht',
   'Tätigkeitsberichte der Angestellten',
   'Sieht und bearbeitet die Tätigkeitsberichte aller Angestellten (Matrix Kostenstelle × Tag)',
   FALSE, 347)
ON CONFLICT (schluessel) DO NOTHING;

INSERT INTO public.rollen_berechtigungen (rolle_id, berechtigung_id)
SELECT r.id, b.id
  FROM public.rollen r, public.berechtigungen b
 WHERE r.schluessel IN ('geschaeftsfuehrung', 'buero')
   AND b.schluessel = 'stunden.taetigkeitsbericht'
ON CONFLICT DO NOTHING;


-- ─── 5. Umschalter gegen Selbstbedienung sichern ─────────────────────
--
-- profiles_update_self erlaubt jedem, sein EIGENES Profil zu ändern; der
-- Schutz-Trigger friert bisher nur is_partieleiter, is_active und partie_id
-- ein. Ohne Ergänzung könnte sich jeder Zimmerer selbst auf „Angestellter"
-- stellen — und damit Taggeld, Zulagen und sein Soll (39 h statt
-- Arbeitszeitkalender) verlieren.
--
-- in_tagesplanung und ist_bauleiter waren aus demselben Grund offen
-- (jemand hätte sich aus der Tagesplanung nehmen oder sich zum Bauleiter
-- machen können) — bei der Gelegenheit mitgeschlossen.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  -- Nur echte, eingeloggte Nicht-Admin-Nutzer werden eingeschränkt.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_role(auth.uid()) THEN
    NEW.is_partieleiter   := OLD.is_partieleiter;
    NEW.is_active         := OLD.is_active;
    NEW.partie_id         := OLD.partie_id;
    NEW.in_tagesplanung   := OLD.in_tagesplanung;
    NEW.ist_bauleiter     := OLD.ist_bauleiter;
    NEW.zeiterfassung_typ := OLD.zeiterfassung_typ;
  END IF;
  RETURN NEW;
END $$;


-- ─── 6. Änderungsprotokoll erweitern ─────────────────────────────────
--
-- Der Umschalter entscheidet, wo jemand seine Stunden schreibt — eine
-- Änderung daran muss nachvollziehbar sein (wie is_active, partie_id …).
CREATE OR REPLACE FUNCTION public.log_profiles_aenderung()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.partie_id IS DISTINCT FROM OLD.partie_id THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'partie_id', OLD.partie_id::text, NEW.partie_id::text, auth.uid());
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'is_active', OLD.is_active::text, NEW.is_active::text, auth.uid());
  END IF;
  IF NEW.is_partieleiter IS DISTINCT FROM OLD.is_partieleiter THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'is_partieleiter', OLD.is_partieleiter::text, NEW.is_partieleiter::text, auth.uid());
  END IF;
  IF NEW.in_tagesplanung IS DISTINCT FROM OLD.in_tagesplanung THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'in_tagesplanung', OLD.in_tagesplanung::text, NEW.in_tagesplanung::text, auth.uid());
  END IF;
  IF NEW.zeiterfassung_typ IS DISTINCT FROM OLD.zeiterfassung_typ THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'zeiterfassung_typ', OLD.zeiterfassung_typ, NEW.zeiterfassung_typ, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_profiles ON public.profiles;
CREATE TRIGGER trg_log_profiles
  AFTER UPDATE OF partie_id, is_active, is_partieleiter, in_tagesplanung, zeiterfassung_typ
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_profiles_aenderung();

NOTIFY pgrst, 'reload schema';
