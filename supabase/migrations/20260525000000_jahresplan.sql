-- ─── Jahresplanung von der Tagesplanung entkoppeln ─────────────────────
-- Die Jahresplanung (Arbeitsplanung-Matrix) ist eine INTERNE Grobplanung
-- für Admin/Vorarbeiter. Sie darf die Tagesplanung — also das, was der
-- Mitarbeiter im Dashboard/MeinTag sieht — NICHT verändern.
--
-- Bisher teilten sich beide Seiten die Tabellen einteilungen /
-- einteilung_mitarbeiter / einteilung_fahrzeuge. Dadurch wirkte sich jede
-- Löschung in der Jahresplanung sofort auf die Tagesplanung aus.
--
-- Diese Migration gibt der Jahresplanung eigene Tabellen (Struktur 1:1
-- gespiegelt) und kopiert die bestehenden Einteilungen einmalig hinein,
-- damit die Jahresplanung-Ansicht unverändert aussieht. Ab jetzt sind
-- beide Seiten unabhängig; die Tagesplanung kann per Button
-- „Aus Jahresplanung übernehmen" einen Tag daraus vorbefüllen.
-- ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jahresplan_einteilungen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datum DATE NOT NULL,
  baustelle_id UUID REFERENCES public.baustellen(id) ON DELETE SET NULL,
  taetigkeit TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.jahresplan_mitarbeiter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  einteilung_id UUID NOT NULL REFERENCES public.jahresplan_einteilungen(id) ON DELETE CASCADE,
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(einteilung_id, mitarbeiter_id)
);

CREATE TABLE IF NOT EXISTS public.jahresplan_fahrzeuge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  einteilung_id UUID NOT NULL REFERENCES public.jahresplan_einteilungen(id) ON DELETE CASCADE,
  fahrzeug_id UUID NOT NULL REFERENCES public.fahrzeuge(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(einteilung_id, fahrzeug_id)
);

CREATE INDEX IF NOT EXISTS idx_jahresplan_einteilungen_datum
  ON public.jahresplan_einteilungen(datum);
CREATE INDEX IF NOT EXISTS idx_jahresplan_mitarbeiter_ma
  ON public.jahresplan_mitarbeiter(mitarbeiter_id);
CREATE INDEX IF NOT EXISTS idx_jahresplan_mitarbeiter_eid
  ON public.jahresplan_mitarbeiter(einteilung_id);
CREATE INDEX IF NOT EXISTS idx_jahresplan_fahrzeuge_eid
  ON public.jahresplan_fahrzeuge(einteilung_id);
CREATE INDEX IF NOT EXISTS idx_jahresplan_fahrzeuge_fid
  ON public.jahresplan_fahrzeuge(fahrzeug_id);

-- RLS: alle authentifizierten Nutzer lesen, nur Admin schreibt.
ALTER TABLE public.jahresplan_einteilungen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jahresplan_mitarbeiter ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jahresplan_fahrzeuge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jp_eint_select ON public.jahresplan_einteilungen;
CREATE POLICY jp_eint_select ON public.jahresplan_einteilungen
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS jp_eint_modify ON public.jahresplan_einteilungen;
CREATE POLICY jp_eint_modify ON public.jahresplan_einteilungen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS jp_ma_select ON public.jahresplan_mitarbeiter;
CREATE POLICY jp_ma_select ON public.jahresplan_mitarbeiter
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS jp_ma_modify ON public.jahresplan_mitarbeiter;
CREATE POLICY jp_ma_modify ON public.jahresplan_mitarbeiter
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS jp_fz_select ON public.jahresplan_fahrzeuge;
CREATE POLICY jp_fz_select ON public.jahresplan_fahrzeuge
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS jp_fz_modify ON public.jahresplan_fahrzeuge;
CREATE POLICY jp_fz_modify ON public.jahresplan_fahrzeuge
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- Einmalige Datenübernahme: bestehende Einteilungen 1:1 in die
-- Jahresplanung kopieren. Die IDs werden mitkopiert, damit die
-- FK-Beziehungen (einteilung_id) ohne Umschlüsselung gültig bleiben.
-- ON CONFLICT macht die Migration wiederholbar.
INSERT INTO public.jahresplan_einteilungen (id, datum, baustelle_id, taetigkeit, created_at, updated_at)
SELECT id, datum, baustelle_id, taetigkeit, created_at, updated_at
FROM public.einteilungen
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.jahresplan_mitarbeiter (id, einteilung_id, mitarbeiter_id, created_at)
SELECT id, einteilung_id, mitarbeiter_id, created_at
FROM public.einteilung_mitarbeiter
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.jahresplan_fahrzeuge (id, einteilung_id, fahrzeug_id, created_at)
SELECT id, einteilung_id, fahrzeug_id, created_at
FROM public.einteilung_fahrzeuge
ON CONFLICT (id) DO NOTHING;

-- Realtime aktivieren (idempotent — Tabelle evtl. schon in der Publication).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jahresplan_einteilungen;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jahresplan_mitarbeiter;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jahresplan_fahrzeuge;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.jahresplan_einteilungen IS
  'Interne Grobplanung (Arbeitsplanung-Matrix). Entkoppelt von einteilungen/Tagesplanung.';
