-- =====================================================================
-- Unterschriften am Bericht — vor allem am Regiebericht.
--
-- Wunsch aus der Baustelle: „Ganz wichtig ist, dass der Regiebericht noch
-- durch den Kunden und Polier unterschrieben werden muss." Ausdrücklich
-- OHNE Zwang: es kann der Kunde unterschreiben, oder der Polier, oder
-- beide, oder keiner — und der Bericht bleibt danach bearbeitbar.
--
-- Eigene Tabelle statt Spalten auf `berichte`, weil damit später auch ein
-- zweiter Kundenvertreter unterschreiben kann, ohne das Schema zu ändern.
--
-- Das Zeichnen selbst kann die App schon: UnterschriftDialog liefert ein
-- Base64-PNG, genau wie beim Baustellenstundenbericht.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.bericht_unterschriften (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bericht_id         UUID NOT NULL REFERENCES public.berichte(id) ON DELETE CASCADE,
  rolle              TEXT NOT NULL CHECK (rolle IN ('polier', 'kunde')),
  -- Beim Kunden getippt (er hat kein Konto), beim Polier der Profilname.
  name               TEXT,
  unterschrift_data  TEXT NOT NULL,          -- Base64-PNG
  unterschrieben_von UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  unterschrieben_am  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Nochmal unterschreiben ersetzt die alte Unterschrift, statt eine
  -- zweite anzulegen.
  UNIQUE (bericht_id, rolle)
);

COMMENT ON TABLE public.bericht_unterschriften IS
  'Unterschriften am Bericht (Polier und/oder Kunde). Freiwillig — der '
  'Bericht lässt sich auch ohne freigeben und bleibt danach bearbeitbar.';

CREATE INDEX IF NOT EXISTS idx_bericht_unterschriften_bericht
  ON public.bericht_unterschriften (bericht_id);

ALTER TABLE public.bericht_unterschriften ENABLE ROW LEVEL SECURITY;

-- Lesen wie beim Bericht selbst.
DROP POLICY IF EXISTS bericht_unterschriften_select ON public.bericht_unterschriften;
CREATE POLICY bericht_unterschriften_select ON public.bericht_unterschriften
  FOR SELECT TO authenticated USING (TRUE);

-- Geschrieben wird ausschließlich über die RPC unten (SECURITY DEFINER).
-- Direktes Schreiben nur für Admins, als Notausgang.
DROP POLICY IF EXISTS bericht_unterschriften_modify ON public.bericht_unterschriften;
CREATE POLICY bericht_unterschriften_modify ON public.bericht_unterschriften
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));


-- ─── Unterschreiben ──────────────────────────────────────────────────
--
-- Die RPC ist nötig, nicht bequem: `berichte_update` erlaubt Nicht-Admins
-- nur im Status 'entwurf' zu schreiben. Der Polier soll aber auch einen
-- schon eingereichten Regiebericht unterschreiben können — sonst müsste
-- er ihn erst zurückholen, was den Ablauf verdreht.
CREATE OR REPLACE FUNCTION public.bericht_unterschreiben(
  p_bericht      UUID,
  p_rolle        TEXT,
  p_name         TEXT,
  p_unterschrift TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  b public.berichte;
BEGIN
  IF p_rolle NOT IN ('polier', 'kunde') THEN
    RAISE EXCEPTION 'Unbekannte Rolle: %', p_rolle;
  END IF;
  IF p_unterschrift IS NULL OR length(p_unterschrift) < 100 THEN
    RAISE EXCEPTION 'Keine Unterschrift übergeben';
  END IF;

  SELECT * INTO b FROM public.berichte WHERE id = p_bericht;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;

  -- Wer darf: Admin/Büro, der Ersteller, oder der Polier der Partie, die
  -- auf dieser Baustelle arbeitet. Der Kunde unterschreibt am Gerät des
  -- Poliers — deshalb dieselbe Prüfung für beide Rollen.
  IF NOT (
    public.is_admin_role(auth.uid())
    OR b.erfasst_von = auth.uid()
    OR public.is_partieleiter_of_baustelle(auth.uid(), b.baustelle_id)
    OR public.has_permission(auth.uid(), 'berichte.freigeben')
  ) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;

  IF b.status = 'archiviert' THEN
    RAISE EXCEPTION 'Bericht ist archiviert';
  END IF;

  INSERT INTO public.bericht_unterschriften
    (bericht_id, rolle, name, unterschrift_data, unterschrieben_von)
  VALUES (p_bericht, p_rolle, NULLIF(btrim(coalesce(p_name, '')), ''),
          p_unterschrift, auth.uid())
  ON CONFLICT (bericht_id, rolle) DO UPDATE
    SET name               = EXCLUDED.name,
        unterschrift_data  = EXCLUDED.unterschrift_data,
        unterschrieben_von = EXCLUDED.unterschrieben_von,
        unterschrieben_am  = NOW();

  -- Ins Änderungsprotokoll, damit nachvollziehbar bleibt, was NACH der
  -- Unterschrift noch geändert wurde (der Bericht bleibt ja offen).
  INSERT INTO public.bericht_aenderungen (bericht_id, autor_id, art, details)
  VALUES (p_bericht, auth.uid(), 'unterschrift',
          CASE WHEN p_rolle = 'kunde'
               THEN 'Kunde unterschrieben'
                    || coalesce(': ' || NULLIF(btrim(coalesce(p_name, '')), ''), '')
               ELSE 'Polier unterschrieben' END);
END $$;

GRANT EXECUTE ON FUNCTION public.bericht_unterschreiben(UUID, TEXT, TEXT, TEXT)
  TO authenticated;


-- ─── Unterschrift zurücknehmen ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bericht_unterschrift_entfernen(
  p_bericht UUID,
  p_rolle   TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  b public.berichte;
BEGIN
  SELECT * INTO b FROM public.berichte WHERE id = p_bericht;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF NOT (
    public.is_admin_role(auth.uid())
    OR b.erfasst_von = auth.uid()
    OR public.is_partieleiter_of_baustelle(auth.uid(), b.baustelle_id)
    OR public.has_permission(auth.uid(), 'berichte.freigeben')
  ) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;

  DELETE FROM public.bericht_unterschriften
   WHERE bericht_id = p_bericht AND rolle = p_rolle;

  INSERT INTO public.bericht_aenderungen (bericht_id, autor_id, art, details)
  VALUES (p_bericht, auth.uid(), 'unterschrift',
          CASE WHEN p_rolle = 'kunde' THEN 'Kunden-Unterschrift entfernt'
               ELSE 'Polier-Unterschrift entfernt' END);
END $$;

GRANT EXECUTE ON FUNCTION public.bericht_unterschrift_entfernen(UUID, TEXT)
  TO authenticated;

-- Live-Aktualisierung, damit die Unterschrift am zweiten Gerät sofort steht.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'bericht_unterschriften'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bericht_unterschriften;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
