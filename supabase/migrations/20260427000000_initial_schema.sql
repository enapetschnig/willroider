-- =============================================
-- Holzbau Willroider App - Database Schema
-- =============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== Enums =====
DO $$ BEGIN CREATE TYPE app_role AS ENUM ('geschaeftsfuehrung','bauleiter','zimmermeister','buero','mitarbeiter'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE baustellen_status AS ENUM ('geplant','aktiv','abgeschlossen','pausiert'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE stunden_status AS ENUM ('offen','zm_freigabe','buero_freigabe','exportiert','abgelehnt'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE wochentyp AS ENUM ('L','K','F','U'); EXCEPTION WHEN duplicate_object THEN null; END $$; -- Lang/Kurz/Feiertag/Urlaub
DO $$ BEGIN CREATE TYPE evaluierung_typ AS ENUM ('kurz','lang'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===== Profiles =====
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vorname TEXT NOT NULL DEFAULT '',
  nachname TEXT NOT NULL DEFAULT '',
  pers_nr TEXT,
  email TEXT,
  telefon TEXT,
  qualifikation TEXT,
  fuehrerschein TEXT,
  kran_berechtigung BOOLEAN DEFAULT FALSE,
  partie_id UUID,
  is_active BOOLEAN DEFAULT FALSE,
  is_partieleiter BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== User Roles =====
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'mitarbeiter',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- ===== Partien (Teams) =====
CREATE TABLE IF NOT EXISTS public.partien (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  farbcode TEXT NOT NULL DEFAULT '#3b82f6',
  partieleiter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  beschreibung TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_partie_id_fkey;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_partie_id_fkey FOREIGN KEY (partie_id) REFERENCES public.partien(id) ON DELETE SET NULL;

-- ===== Fahrzeuge =====
CREATE TABLE IF NOT EXISTS public.fahrzeuge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kennzeichen TEXT NOT NULL UNIQUE,
  typ TEXT,
  bezeichnung TEXT,
  kapazitaet INTEGER,
  hat_anhaenger BOOLEAN DEFAULT FALSE,
  notizen TEXT,
  aktiv BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Baustellen =====
CREATE TABLE IF NOT EXISTS public.baustellen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bvh_name TEXT NOT NULL,
  kostenstelle TEXT UNIQUE,
  bauherr TEXT,
  bauherr_adresse TEXT,
  baustellen_adresse TEXT,
  plz TEXT,
  ort TEXT,
  koordinaten_lat DOUBLE PRECISION,
  koordinaten_lng DOUBLE PRECISION,
  start_datum DATE,
  end_datum DATE,
  status baustellen_status NOT NULL DEFAULT 'geplant',
  auftragssumme NUMERIC(12,2),
  bauleiter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  partie_id UUID REFERENCES public.partien(id) ON DELETE SET NULL,
  anzahl_mitarbeiter INTEGER,
  art_bauarbeiten TEXT,
  dacheindeckung TEXT,
  farben_grundierung TEXT,
  notizen TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Baustellen Termine (Kran/Material/Meilensteine) =====
CREATE TABLE IF NOT EXISTS public.baustellen_termine (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  termin_datum DATE NOT NULL,
  typ TEXT NOT NULL DEFAULT 'meilenstein',  -- 'kran' | 'material' | 'meilenstein'
  bezeichnung TEXT,
  notizen TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Arbeitseinteilung =====
CREATE TABLE IF NOT EXISTS public.einteilungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum DATE NOT NULL,
  baustelle_id UUID REFERENCES public.baustellen(id) ON DELETE SET NULL,
  fahrzeug_id UUID REFERENCES public.fahrzeuge(id) ON DELETE SET NULL,
  abfahrtszeit TIME,
  treffpunkt TEXT,
  material_hinweise TEXT,
  sonderaufgaben TEXT,
  hat_anhaenger BOOLEAN DEFAULT FALSE,
  kranfahrer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notizen TEXT,
  versendet_am TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.einteilung_mitarbeiter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  einteilung_id UUID NOT NULL REFERENCES public.einteilungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rolle TEXT, -- 'partieleiter' | 'kranfahrer' | 'lehrling' | 'mitarbeiter'
  gelesen_am TIMESTAMPTZ,
  bestaetigt_am TIMESTAMPTZ,
  abwesend BOOLEAN DEFAULT FALSE,
  abwesenheitsgrund TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(einteilung_id, mitarbeiter_id)
);

-- ===== Stundenbuchungen =====
CREATE TABLE IF NOT EXISTS public.stundenbuchungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  baustelle_id UUID REFERENCES public.baustellen(id) ON DELETE SET NULL,
  datum DATE NOT NULL,
  arbeitsstunden NUMERIC(5,2) DEFAULT 0,
  fahrstunden NUMERIC(5,2) DEFAULT 0,
  taggeld_kurz NUMERIC(5,2) DEFAULT 0,
  taggeld_lang NUMERIC(5,2) DEFAULT 0,
  km_gefahren NUMERIC(8,2) DEFAULT 0,
  fehlzeit_typ TEXT, -- 'U'rlaub | 'K'rank | 'F'eiertag | 'SW' | 'S'ozial
  fehlzeit_stunden NUMERIC(5,2) DEFAULT 0,
  taetigkeit TEXT,
  notizen TEXT,
  status stunden_status NOT NULL DEFAULT 'offen',
  freigegeben_zm_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  freigegeben_zm_am TIMESTAMPTZ,
  freigegeben_buero_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  freigegeben_buero_am TIMESTAMPTZ,
  abgelehnt_grund TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Arbeitszeitkalender =====
CREATE TABLE IF NOT EXISTS public.arbeitszeitkalender (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jahr INTEGER NOT NULL,
  kw INTEGER NOT NULL,
  wochentyp wochentyp NOT NULL DEFAULT 'L',
  soll_stunden NUMERIC(5,2) NOT NULL DEFAULT 38.5,
  feiertage TEXT,
  bu_tage INTEGER DEFAULT 0,
  notizen TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(jahr, kw)
);

-- ===== Evaluierungen / Sicherheitsunterweisungen =====
CREATE TABLE IF NOT EXISTS public.evaluierungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  datum DATE NOT NULL,
  typ evaluierung_typ NOT NULL DEFAULT 'kurz',
  vortragender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  checkliste JSONB DEFAULT '{}'::jsonb,
  abgeschlossen BOOLEAN DEFAULT FALSE,
  notizen TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.evaluierung_unterschriften (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluierung_id UUID NOT NULL REFERENCES public.evaluierungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unterschrift_data TEXT, -- base64 signature
  unterschrieben_am TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(evaluierung_id, mitarbeiter_id)
);

-- ===== Dokumente =====
CREATE TABLE IF NOT EXISTS public.dokumente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id UUID REFERENCES public.baustellen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ordner TEXT,
  typ TEXT,
  dateiname TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  groesse INTEGER,
  mimetype TEXT,
  hochgeladen_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notizen TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Kostenbuchungen =====
CREATE TABLE IF NOT EXISTS public.kostenbuchungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  datum DATE NOT NULL,
  kostenart TEXT NOT NULL,
  betrag NUMERIC(12,2) NOT NULL DEFAULT 0,
  beschreibung TEXT,
  beleg_dokument_id UUID REFERENCES public.dokumente(id) ON DELETE SET NULL,
  erfasst_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Bautagebuch =====
CREATE TABLE IF NOT EXISTS public.bautagebuch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baustelle_id UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  datum DATE NOT NULL,
  wetter TEXT,
  temperatur NUMERIC(5,2),
  taetigkeit TEXT,
  besonderheiten TEXT,
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_baustellen_status ON public.baustellen(status);
CREATE INDEX IF NOT EXISTS idx_baustellen_dates ON public.baustellen(start_datum, end_datum);
CREATE INDEX IF NOT EXISTS idx_einteilungen_datum ON public.einteilungen(datum);
CREATE INDEX IF NOT EXISTS idx_einteilung_mitarbeiter_ma ON public.einteilung_mitarbeiter(mitarbeiter_id);
CREATE INDEX IF NOT EXISTS idx_stundenbuchungen_datum ON public.stundenbuchungen(datum);
CREATE INDEX IF NOT EXISTS idx_stundenbuchungen_ma ON public.stundenbuchungen(mitarbeiter_id);
CREATE INDEX IF NOT EXISTS idx_stundenbuchungen_status ON public.stundenbuchungen(status);
CREATE INDEX IF NOT EXISTS idx_dokumente_baustelle ON public.dokumente(baustelle_id);

-- ===== Helper functions =====
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_role(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('geschaeftsfuehrung','bauleiter','buero')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_review(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('geschaeftsfuehrung','bauleiter','buero','zimmermeister')
  );
$$;

-- ===== Trigger: handle new user =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, vorname, nachname, email, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    NEW.email,
    FALSE
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'mitarbeiter');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== updated_at trigger =====
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['profiles','partien','fahrzeuge','baustellen','einteilungen','stundenbuchungen','evaluierungen']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER set_updated_at_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- ===== Enable RLS =====
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partien ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fahrzeuge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baustellen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baustellen_termine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.einteilungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.einteilung_mitarbeiter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stundenbuchungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arbeitszeitkalender ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluierungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluierung_unterschriften ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dokumente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kostenbuchungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bautagebuch ENABLE ROW LEVEL SECURITY;

-- ===== RLS POLICIES =====
-- profiles: read all auth users, update own, admin can update all
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin_role(auth.uid()))
  WITH CHECK (id = auth.uid() OR public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
CREATE POLICY "profiles_insert_admin" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE TO authenticated
  USING (public.is_admin_role(auth.uid()));

-- user_roles
DROP POLICY IF EXISTS "user_roles_select_all" ON public.user_roles;
CREATE POLICY "user_roles_select_all" ON public.user_roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "user_roles_admin_all" ON public.user_roles;
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- partien
DROP POLICY IF EXISTS "partien_select_all" ON public.partien;
CREATE POLICY "partien_select_all" ON public.partien FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "partien_modify_admin" ON public.partien;
CREATE POLICY "partien_modify_admin" ON public.partien FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- fahrzeuge
DROP POLICY IF EXISTS "fahrzeuge_select_all" ON public.fahrzeuge;
CREATE POLICY "fahrzeuge_select_all" ON public.fahrzeuge FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fahrzeuge_modify_admin" ON public.fahrzeuge;
CREATE POLICY "fahrzeuge_modify_admin" ON public.fahrzeuge FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- baustellen
DROP POLICY IF EXISTS "baustellen_select_all" ON public.baustellen;
CREATE POLICY "baustellen_select_all" ON public.baustellen FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "baustellen_modify_admin" ON public.baustellen;
CREATE POLICY "baustellen_modify_admin" ON public.baustellen FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- baustellen_termine
DROP POLICY IF EXISTS "termine_select_all" ON public.baustellen_termine;
CREATE POLICY "termine_select_all" ON public.baustellen_termine FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "termine_modify_admin" ON public.baustellen_termine;
CREATE POLICY "termine_modify_admin" ON public.baustellen_termine FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- einteilungen
DROP POLICY IF EXISTS "einteilungen_select_all" ON public.einteilungen;
CREATE POLICY "einteilungen_select_all" ON public.einteilungen FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "einteilungen_modify_admin" ON public.einteilungen;
CREATE POLICY "einteilungen_modify_admin" ON public.einteilungen FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS "einteilung_ma_select_all" ON public.einteilung_mitarbeiter;
CREATE POLICY "einteilung_ma_select_all" ON public.einteilung_mitarbeiter FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "einteilung_ma_modify_admin" ON public.einteilung_mitarbeiter;
CREATE POLICY "einteilung_ma_modify_admin" ON public.einteilung_mitarbeiter FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS "einteilung_ma_update_self" ON public.einteilung_mitarbeiter;
CREATE POLICY "einteilung_ma_update_self" ON public.einteilung_mitarbeiter FOR UPDATE TO authenticated
  USING (mitarbeiter_id = auth.uid()) WITH CHECK (mitarbeiter_id = auth.uid());

-- stundenbuchungen: own can insert/update; reviewers can review/update
DROP POLICY IF EXISTS "stunden_select_all" ON public.stundenbuchungen;
CREATE POLICY "stunden_select_all" ON public.stundenbuchungen FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.can_review(auth.uid()));

DROP POLICY IF EXISTS "stunden_insert_self" ON public.stundenbuchungen;
CREATE POLICY "stunden_insert_self" ON public.stundenbuchungen FOR INSERT TO authenticated
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS "stunden_update_self_or_admin" ON public.stundenbuchungen;
CREATE POLICY "stunden_update_self_or_admin" ON public.stundenbuchungen FOR UPDATE TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.can_review(auth.uid()))
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.can_review(auth.uid()));

DROP POLICY IF EXISTS "stunden_delete_admin" ON public.stundenbuchungen;
CREATE POLICY "stunden_delete_admin" ON public.stundenbuchungen FOR DELETE TO authenticated
  USING (public.is_admin_role(auth.uid()) OR mitarbeiter_id = auth.uid());

-- arbeitszeitkalender
DROP POLICY IF EXISTS "kalender_select_all" ON public.arbeitszeitkalender;
CREATE POLICY "kalender_select_all" ON public.arbeitszeitkalender FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "kalender_modify_admin" ON public.arbeitszeitkalender;
CREATE POLICY "kalender_modify_admin" ON public.arbeitszeitkalender FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- evaluierungen
DROP POLICY IF EXISTS "evaluierungen_select_all" ON public.evaluierungen;
CREATE POLICY "evaluierungen_select_all" ON public.evaluierungen FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "evaluierungen_modify" ON public.evaluierungen;
CREATE POLICY "evaluierungen_modify" ON public.evaluierungen FOR ALL TO authenticated
  USING (public.can_review(auth.uid())) WITH CHECK (public.can_review(auth.uid()));

DROP POLICY IF EXISTS "evaluierung_unt_select" ON public.evaluierung_unterschriften;
CREATE POLICY "evaluierung_unt_select" ON public.evaluierung_unterschriften FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "evaluierung_unt_modify" ON public.evaluierung_unterschriften;
CREATE POLICY "evaluierung_unt_modify" ON public.evaluierung_unterschriften FOR ALL TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.can_review(auth.uid()))
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.can_review(auth.uid()));

-- dokumente
DROP POLICY IF EXISTS "dokumente_select" ON public.dokumente;
CREATE POLICY "dokumente_select" ON public.dokumente FOR SELECT TO authenticated
  USING (
    public.can_review(auth.uid())
    OR mitarbeiter_id = auth.uid()
    OR (baustelle_id IS NOT NULL)
  );
DROP POLICY IF EXISTS "dokumente_insert" ON public.dokumente;
CREATE POLICY "dokumente_insert" ON public.dokumente FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "dokumente_modify" ON public.dokumente;
CREATE POLICY "dokumente_modify" ON public.dokumente FOR UPDATE TO authenticated
  USING (hochgeladen_von = auth.uid() OR public.is_admin_role(auth.uid()))
  WITH CHECK (hochgeladen_von = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS "dokumente_delete" ON public.dokumente;
CREATE POLICY "dokumente_delete" ON public.dokumente FOR DELETE TO authenticated
  USING (hochgeladen_von = auth.uid() OR public.is_admin_role(auth.uid()));

-- kostenbuchungen
DROP POLICY IF EXISTS "kostenbuchungen_select" ON public.kostenbuchungen;
CREATE POLICY "kostenbuchungen_select" ON public.kostenbuchungen FOR SELECT TO authenticated
  USING (public.can_review(auth.uid()));
DROP POLICY IF EXISTS "kostenbuchungen_modify" ON public.kostenbuchungen;
CREATE POLICY "kostenbuchungen_modify" ON public.kostenbuchungen FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid())) WITH CHECK (public.is_admin_role(auth.uid()));

-- bautagebuch
DROP POLICY IF EXISTS "bautagebuch_select_all" ON public.bautagebuch;
CREATE POLICY "bautagebuch_select_all" ON public.bautagebuch FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "bautagebuch_modify" ON public.bautagebuch;
CREATE POLICY "bautagebuch_modify" ON public.bautagebuch FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
