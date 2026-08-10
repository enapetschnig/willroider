-- =====================================================================
-- Fahrtenbuch für Angestellte + Unterschrift am Tätigkeitsbericht.
--
-- Nachbau des Blatts „Fahrtenbuch" aus der Excel-Vorlage
-- (Tätigkeitsbericht_Vorlage.xlsx): Datum, Abfahrt/Ankunft, Reiseweg,
-- km-Stände, gefahrene km, Kostenstelle. In der App gibt es je
-- Berichtsperiode (21.–20.) ein Fahrtenbuch; die gefahrenen Kilometer
-- fließen direkt in die km-Zeile des Tätigkeitsberichts.
--
-- Dazu: die Unterschrift am Tätigkeitsbericht wird jetzt digital
-- geleistet (Maus/Stift) und je Periode gespeichert — vorher stand im
-- Ausdruck nur eine Punktelinie.
--
-- Und: der Mitarbeiter-Wechsler im Tätigkeitsbericht ist künftig der
-- Geschäftsführung vorbehalten (Wunsch: „man sollte nicht die
-- Tätigkeitsberichte von anderen Mitarbeitern öffnen können"). Das
-- Lohnbüro ist die GF selbst — Büro verliert nur den Fremdzugriff,
-- nicht den eigenen Bericht.
-- =====================================================================

-- ─── 1. Fahrtenbuch ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fahrtenbuch_eintraege (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  datum          DATE NOT NULL,
  abfahrt        TIME,
  ankunft        TIME,
  reiseweg       TEXT,
  km_start       NUMERIC(8,1),
  km_ende        NUMERIC(8,1),
  -- Gefahrene km: aus den Ständen gerechnet oder direkt eingegeben.
  km             NUMERIC(7,1) NOT NULL DEFAULT 0 CHECK (km >= 0),
  kostenstelle   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.fahrtenbuch_eintraege IS
  'Fahrtenbuch der Angestellten, eine Zeile je Fahrt. Die km je Tag '
  'fließen in die Zeile „gefahrene km" des Tätigkeitsberichts.';

CREATE INDEX IF NOT EXISTS idx_fahrtenbuch_ma_datum
  ON public.fahrtenbuch_eintraege (mitarbeiter_id, datum);

DROP TRIGGER IF EXISTS set_updated_at_fahrtenbuch ON public.fahrtenbuch_eintraege;
CREATE TRIGGER set_updated_at_fahrtenbuch
  BEFORE UPDATE ON public.fahrtenbuch_eintraege
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.fahrtenbuch_eintraege ENABLE ROW LEVEL SECURITY;

-- Lesen: eigene Fahrten; GF/Admin und der Tätigkeitsbericht-Fremdzugriff
-- sehen alle (das Lohnbüro braucht sie für die Abrechnung).
DROP POLICY IF EXISTS fahrtenbuch_select ON public.fahrtenbuch_eintraege;
CREATE POLICY fahrtenbuch_select ON public.fahrtenbuch_eintraege
  FOR SELECT TO authenticated USING (
    mitarbeiter_id = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'stunden.taetigkeitsbericht')
  );

-- Schreiben: die eigenen Fahrten, Admin alle.
DROP POLICY IF EXISTS fahrtenbuch_modify ON public.fahrtenbuch_eintraege;
CREATE POLICY fahrtenbuch_modify ON public.fahrtenbuch_eintraege
  FOR ALL TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()))
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));

-- Kennzeichen für den Fahrtenbuch-Kopf (je Person, wie in der Excel).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fahrtenbuch_kennzeichen TEXT;


-- ─── 2. Unterschrift am Tätigkeitsbericht ────────────────────────────
CREATE TABLE IF NOT EXISTS public.taetigkeitsbericht_unterschriften (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mitarbeiter_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Periode wie in lib/taetigkeitsbericht: jahr + Endmonat (21.–20.).
  jahr               INT NOT NULL,
  monat              INT NOT NULL CHECK (monat BETWEEN 1 AND 12),
  unterschrift_data  TEXT NOT NULL,           -- Base64-PNG
  unterschrieben_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Neu unterschreiben ersetzt die alte Unterschrift.
  UNIQUE (mitarbeiter_id, jahr, monat)
);

COMMENT ON TABLE public.taetigkeitsbericht_unterschriften IS
  'Digitale Unterschrift unter dem Tätigkeitsbericht, eine je Periode. '
  'Wird in der App gezeichnet (Maus/Stift) und im PDF gedruckt.';

ALTER TABLE public.taetigkeitsbericht_unterschriften ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tb_unterschrift_select ON public.taetigkeitsbericht_unterschriften;
CREATE POLICY tb_unterschrift_select ON public.taetigkeitsbericht_unterschriften
  FOR SELECT TO authenticated USING (
    mitarbeiter_id = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.has_permission(auth.uid(), 'stunden.taetigkeitsbericht')
  );

DROP POLICY IF EXISTS tb_unterschrift_modify ON public.taetigkeitsbericht_unterschriften;
CREATE POLICY tb_unterschrift_modify ON public.taetigkeitsbericht_unterschriften
  FOR ALL TO authenticated
  USING (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()))
  WITH CHECK (mitarbeiter_id = auth.uid() OR public.is_admin_role(auth.uid()));


-- ─── 3. Fremdzugriff nur noch Geschäftsführung ───────────────────────
DELETE FROM public.rollen_berechtigungen rb
 USING public.rollen r, public.berechtigungen b
 WHERE rb.rolle_id = r.id AND rb.berechtigung_id = b.id
   AND r.schluessel = 'buero'
   AND b.schluessel = 'stunden.taetigkeitsbericht';

-- Live-Aktualisierung: km-Zeile im Bericht folgt dem Fahrtenbuch sofort.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'fahrtenbuch_eintraege'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fahrtenbuch_eintraege;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
