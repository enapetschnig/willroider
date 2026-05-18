-- ─── Tagesplanung ─────────────────────────────────────────────────────
-- Erweitert das einteilungen-Modell um:
--   - tagesplanung_freigaben (1 Row pro Tag, Admin gibt Plan frei)
--   - manuell_geaendert-Flags auf einteilungen + einteilung_mitarbeiter
--     (für Konflikt-Detection beim Jahresplanung-Drag)
--   - urlaubsantraege (MA-Self-Service)
-- ───────────────────────────────────────────────────────────────────────

-- 1) Tagesfreigabe
CREATE TABLE IF NOT EXISTS public.tagesplanung_freigaben (
  datum date PRIMARY KEY,
  freigegeben_am timestamptz NOT NULL DEFAULT now(),
  freigegeben_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notiz text                       -- "Sonstige Hinweise" (Polierschule, Bundesheer, ...)
);

ALTER TABLE public.tagesplanung_freigaben ENABLE ROW LEVEL SECURITY;

CREATE POLICY tagesplanung_freigaben_select ON public.tagesplanung_freigaben
  FOR SELECT USING (true);
CREATE POLICY tagesplanung_freigaben_write ON public.tagesplanung_freigaben
  FOR ALL
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- 2) Manuell-Flags
ALTER TABLE public.einteilungen
  ADD COLUMN IF NOT EXISTS manuell_geaendert boolean NOT NULL DEFAULT false;

ALTER TABLE public.einteilung_mitarbeiter
  ADD COLUMN IF NOT EXISTS manuell_geaendert boolean NOT NULL DEFAULT false;

-- 3) Urlaubsantrag-Workflow
DO $$ BEGIN
  CREATE TYPE public.urlaubsantrag_status AS ENUM ('offen','genehmigt','abgelehnt','storniert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.urlaubsantraege (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  von date NOT NULL,
  bis date NOT NULL,
  arbeitstage numeric,
  kommentar text,
  status public.urlaubsantrag_status NOT NULL DEFAULT 'offen',
  eingereicht_am timestamptz NOT NULL DEFAULT now(),
  entschieden_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  entschieden_am timestamptz,
  CONSTRAINT urlaubsantrag_range_chk CHECK (bis >= von)
);

CREATE INDEX IF NOT EXISTS idx_urlaubsantraege_ma_status
  ON public.urlaubsantraege(mitarbeiter_id, status);
CREATE INDEX IF NOT EXISTS idx_urlaubsantraege_offen
  ON public.urlaubsantraege(status) WHERE status = 'offen';

ALTER TABLE public.urlaubsantraege ENABLE ROW LEVEL SECURITY;

-- MA sieht eigene Anträge, Admin alle.
CREATE POLICY urlaubsantraege_select ON public.urlaubsantraege
  FOR SELECT
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

-- MA darf eigene Anträge einreichen.
CREATE POLICY urlaubsantraege_insert ON public.urlaubsantraege
  FOR INSERT
  WITH CHECK (mitarbeiter_id = auth.uid() AND status = 'offen');

-- MA darf eigenen offenen Antrag stornieren; Admin darf alles ändern.
CREATE POLICY urlaubsantraege_update ON public.urlaubsantraege
  FOR UPDATE
  USING (
    (mitarbeiter_id = auth.uid() AND status = 'offen')
    OR public.is_admin_role(auth.uid())
  )
  WITH CHECK (
    (mitarbeiter_id = auth.uid())
    OR public.is_admin_role(auth.uid())
  );

-- Realtime für die neuen Tabellen aktivieren
ALTER PUBLICATION supabase_realtime ADD TABLE public.tagesplanung_freigaben;
ALTER PUBLICATION supabase_realtime ADD TABLE public.urlaubsantraege;
