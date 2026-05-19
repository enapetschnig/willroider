-- Krankmeldungen + Lohnzettel:
-- MA kann Krankmeldungen mit optionalem Foto/PDF hochladen → setzt automatisch
-- stunden_tage.tag_status='krank' für Werktage im Range.
-- Admin lädt Lohnzettel pro MA hoch; MA sieht eigene Liste und kann sie öffnen.
-- Sichtbarkeit über RLS strikt: MA sieht nur eigene; Admin sieht alles.

-- ─── 1) Storage-Bucket ma_dokumente ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('ma_dokumente', 'ma_dokumente', false)
ON CONFLICT (id) DO NOTHING;

-- RLS-Policies via storage.objects: Pfad-Präfix wird geprüft
-- Format: {mitarbeiter_uuid}/krankmeldungen/... oder {mitarbeiter_uuid}/lohnzettel/...
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

-- ─── 2) krankmeldungen-Tabelle ──────────────────────────────────────────
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
CREATE POLICY krank_select ON public.krankmeldungen FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS krank_insert ON public.krankmeldungen;
CREATE POLICY krank_insert ON public.krankmeldungen FOR INSERT TO authenticated
  WITH CHECK (mitarbeiter_id = auth.uid());

DROP POLICY IF EXISTS krank_update ON public.krankmeldungen;
CREATE POLICY krank_update ON public.krankmeldungen FOR UPDATE TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS krank_delete ON public.krankmeldungen;
CREATE POLICY krank_delete ON public.krankmeldungen FOR DELETE TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

-- ─── 3) Trigger: Krankmeldung → stunden_tage.tag_status='krank' ─────────
-- Setzt für jeden Werktag (Mo-Fr) im Range automatisch tag_status='krank'.
-- Bei bestehendem Eintrag: überschreibe nur wenn status='erfasst' (kein
-- versehentliches Überschreiben bestätigter/freigegebener/exportierter Tage).
CREATE OR REPLACE FUNCTION public.krankmeldung_to_stunden_tage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  d date;
BEGIN
  d := NEW.von;
  WHILE d <= NEW.bis LOOP
    -- Nur Werktage (DOW 1=Mo .. 5=Fr); Sa(6)/So(0) überspringen
    IF EXTRACT(DOW FROM d) BETWEEN 1 AND 5 THEN
      INSERT INTO public.stunden_tage (
        mitarbeiter_id, datum, tag_status, netto_stunden, status, erfasst_von
      )
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

-- ─── 4) lohnzettel-Tabelle ──────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_lohn_ma ON public.lohnzettel(mitarbeiter_id, jahr DESC, monat DESC);

ALTER TABLE public.lohnzettel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lohn_select ON public.lohnzettel;
CREATE POLICY lohn_select ON public.lohnzettel FOR SELECT TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS lohn_insert ON public.lohnzettel;
CREATE POLICY lohn_insert ON public.lohnzettel FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS lohn_update ON public.lohnzettel;
CREATE POLICY lohn_update ON public.lohnzettel FOR UPDATE TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()))
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

DROP POLICY IF EXISTS lohn_delete ON public.lohnzettel;
CREATE POLICY lohn_delete ON public.lohnzettel FOR DELETE TO authenticated
  USING (public.is_admin_role(auth.uid()));

-- ─── 5) Realtime ────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.krankmeldungen;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lohnzettel;

-- PostgREST Schema-Cache reloaden
NOTIFY pgrst, 'reload schema';
