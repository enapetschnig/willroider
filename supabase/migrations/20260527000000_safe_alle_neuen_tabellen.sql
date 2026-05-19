-- Umfassende Safety-Migration: stellt sicher, dass ALLE Tabellen aus den
-- Migrations 20260524 + 20260525 + 20260526 existieren — idempotent.
-- Hintergrund: bei manchen Deploys laufen die ursprünglichen Migrations
-- nicht durch. Diese hier wirkt als Sicherheitsnetz und kann ohne Schaden
-- mehrfach ausgeführt werden.

-- ─── 1) tagesplanung_freigaben ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tagesplanung_freigaben (
  datum date PRIMARY KEY,
  freigegeben_am timestamptz NOT NULL DEFAULT now(),
  freigegeben_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notiz text
);
ALTER TABLE public.tagesplanung_freigaben ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tagesplanung_freigaben_select ON public.tagesplanung_freigaben;
CREATE POLICY tagesplanung_freigaben_select ON public.tagesplanung_freigaben
  FOR SELECT USING (true);
DROP POLICY IF EXISTS tagesplanung_freigaben_write ON public.tagesplanung_freigaben;
CREATE POLICY tagesplanung_freigaben_write ON public.tagesplanung_freigaben
  FOR ALL
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- ─── 2) manuell_geaendert-Spalten ──────────────────────────────────────
ALTER TABLE public.einteilungen
  ADD COLUMN IF NOT EXISTS manuell_geaendert boolean NOT NULL DEFAULT false;
ALTER TABLE public.einteilung_mitarbeiter
  ADD COLUMN IF NOT EXISTS manuell_geaendert boolean NOT NULL DEFAULT false;

-- ─── 3) urlaubsantraege + Enum ──────────────────────────────────────────
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
DROP POLICY IF EXISTS urlaubsantraege_select ON public.urlaubsantraege;
CREATE POLICY urlaubsantraege_select ON public.urlaubsantraege FOR SELECT
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS urlaubsantraege_insert ON public.urlaubsantraege;
CREATE POLICY urlaubsantraege_insert ON public.urlaubsantraege FOR INSERT
  WITH CHECK (mitarbeiter_id = auth.uid() AND status = 'offen');
DROP POLICY IF EXISTS urlaubsantraege_update ON public.urlaubsantraege;
CREATE POLICY urlaubsantraege_update ON public.urlaubsantraege FOR UPDATE
  USING (
    (mitarbeiter_id = auth.uid() AND status = 'offen')
    OR public.is_admin_role(auth.uid())
  )
  WITH CHECK (
    (mitarbeiter_id = auth.uid())
    OR public.is_admin_role(auth.uid())
  );

-- ─── 4) krankmeldungen + Trigger ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.krankmeldungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  von date NOT NULL,
  bis date NOT NULL,
  dokument_id uuid REFERENCES public.dokumente(id) ON DELETE SET NULL,
  notiz text,
  eingereicht_am timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT krank_range_chk CHECK (bis >= von)
);
CREATE INDEX IF NOT EXISTS idx_krank_ma ON public.krankmeldungen(mitarbeiter_id, von DESC);
ALTER TABLE public.krankmeldungen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS krank_select ON public.krankmeldungen;
CREATE POLICY krank_select ON public.krankmeldungen FOR SELECT
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS krank_insert ON public.krankmeldungen;
CREATE POLICY krank_insert ON public.krankmeldungen FOR INSERT
  WITH CHECK (mitarbeiter_id = auth.uid());
DROP POLICY IF EXISTS krank_update ON public.krankmeldungen;
CREATE POLICY krank_update ON public.krankmeldungen FOR UPDATE
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS krank_delete ON public.krankmeldungen;
CREATE POLICY krank_delete ON public.krankmeldungen FOR DELETE
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

CREATE OR REPLACE FUNCTION public.krankmeldung_to_stunden_tage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE d date;
BEGIN
  d := NEW.von;
  WHILE d <= NEW.bis LOOP
    IF EXTRACT(DOW FROM d) BETWEEN 1 AND 5 THEN
      INSERT INTO public.stunden_tage (mitarbeiter_id, datum, tag_status, netto_stunden, status, erfasst_von)
      VALUES (NEW.mitarbeiter_id, d, 'krank', 0, 'ma_bestaetigt', NEW.mitarbeiter_id)
      ON CONFLICT (mitarbeiter_id, datum) DO UPDATE
        SET tag_status = 'krank', netto_stunden = 0
        WHERE public.stunden_tage.status = 'erfasst';
    END IF;
    d := d + INTERVAL '1 day';
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_krankmeldung_insert ON public.krankmeldungen;
CREATE TRIGGER trg_krankmeldung_insert
  AFTER INSERT ON public.krankmeldungen
  FOR EACH ROW EXECUTE FUNCTION public.krankmeldung_to_stunden_tage();

-- ─── 5) lohnzettel ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lohnzettel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  dokument_id uuid NOT NULL REFERENCES public.dokumente(id) ON DELETE CASCADE,
  monat smallint CHECK (monat BETWEEN 1 AND 12),
  jahr smallint CHECK (jahr BETWEEN 2000 AND 2099),
  titel text,
  hochgeladen_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hochgeladen_am timestamptz NOT NULL DEFAULT now(),
  gelesen_am timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lohn_unique
  ON public.lohnzettel(mitarbeiter_id, jahr, monat)
  WHERE monat IS NOT NULL AND jahr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lohn_ma
  ON public.lohnzettel(mitarbeiter_id, jahr DESC, monat DESC);

ALTER TABLE public.lohnzettel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lohn_select ON public.lohnzettel;
CREATE POLICY lohn_select ON public.lohnzettel FOR SELECT
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS lohn_insert ON public.lohnzettel;
CREATE POLICY lohn_insert ON public.lohnzettel FOR INSERT
  WITH CHECK (public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS lohn_update ON public.lohnzettel;
CREATE POLICY lohn_update ON public.lohnzettel FOR UPDATE
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()))
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS lohn_delete ON public.lohnzettel;
CREATE POLICY lohn_delete ON public.lohnzettel FOR DELETE
  USING (public.is_admin_role(auth.uid()));

-- ─── 6) Storage-Bucket ma_dokumente ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('ma_dokumente', 'ma_dokumente', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS ma_dokumente_select ON storage.objects;
CREATE POLICY ma_dokumente_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ma_dokumente' AND (
      public.is_admin_role(auth.uid())
      OR (
        split_part(name, '/', 1) <> ''
        AND (split_part(name, '/', 1))::uuid = auth.uid()
      )
    )
  );
DROP POLICY IF EXISTS ma_dokumente_krank_insert ON storage.objects;
CREATE POLICY ma_dokumente_krank_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ma_dokumente'
    AND split_part(name, '/', 2) = 'krankmeldungen'
    AND (split_part(name, '/', 1))::uuid = auth.uid()
  );
DROP POLICY IF EXISTS ma_dokumente_lohn_insert ON storage.objects;
CREATE POLICY ma_dokumente_lohn_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ma_dokumente'
    AND split_part(name, '/', 2) = 'lohnzettel'
    AND public.is_admin_role(auth.uid())
  );
DROP POLICY IF EXISTS ma_dokumente_delete ON storage.objects;
CREATE POLICY ma_dokumente_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ma_dokumente' AND (
      public.is_admin_role(auth.uid())
      OR (
        split_part(name, '/', 2) = 'krankmeldungen'
        AND (split_part(name, '/', 1))::uuid = auth.uid()
      )
    )
  );

-- ─── 7) Realtime sicherstellen (idempotent via DO-Block) ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tagesplanung_freigaben'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tagesplanung_freigaben;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'urlaubsantraege'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.urlaubsantraege;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'krankmeldungen'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.krankmeldungen;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'lohnzettel'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lohnzettel;
  END IF;
END $$;

-- PostgREST: Schema-Cache reload
NOTIFY pgrst, 'reload schema';
