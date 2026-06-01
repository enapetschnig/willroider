-- Bausatz-Kalkulator: zwei kleine Tabellen + RLS.
--
-- kalkulator_k3_saetze:  geteilte Mittellohn-/Zuschlagskalkulation
--                        (pro Gruppe: dach / decken / waende / regie / clt).
--                        Alle authentifizierten lesen, GF schreibt.
--
-- kalkulator_anfragen:   alle Anfragen aus dem HTML-Kalkulator landen hier
--                        (statt Google Sheet) — inkl. dem ganzen Bedarfstext
--                        und einem Status für die Bearbeitung.

-- ────────────────────────────────────────────────────────────────────────
-- K3-Sätze
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kalkulator_k3_saetze (
  gruppe       TEXT PRIMARY KEY
                 CHECK (gruppe IN ('dach','decken','waende','regie','clt')),
  grundlohn    NUMERIC NOT NULL DEFAULT 18.50,
  lnk          NUMERIC NOT NULL DEFAULT 95,
  unprod       NUMERIC NOT NULL DEFAULT 8,
  ggk          NUMERIC NOT NULL DEFAULT 10,
  bauzinsen    NUMERIC NOT NULL DEFAULT 0.5,
  wagnis       NUMERIC NOT NULL DEFAULT 3,
  gewinn       NUMERIC NOT NULL DEFAULT 6,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.kalkulator_k3_saetze ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kk_select ON public.kalkulator_k3_saetze;
CREATE POLICY kk_select ON public.kalkulator_k3_saetze
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS kk_write ON public.kalkulator_k3_saetze;
CREATE POLICY kk_write ON public.kalkulator_k3_saetze
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('geschaeftsfuehrung','buero')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('geschaeftsfuehrung','buero')
    )
  );

-- Default-Sätze seeden (aus dem HTML-Kalkulator)
INSERT INTO public.kalkulator_k3_saetze (gruppe, grundlohn, lnk, unprod, ggk, bauzinsen, wagnis, gewinn) VALUES
  ('dach',   18.50, 95, 8, 12, 0.5, 3, 7),
  ('decken', 18.50, 95, 8, 12, 0.5, 3, 7),
  ('waende', 18.50, 95, 8, 10, 0.5, 3, 6),
  ('regie',  18.50, 95, 8, 10, 0.5, 2, 6),
  ('clt',    18.50, 95, 8,  8, 0.5, 3, 7)
ON CONFLICT (gruppe) DO NOTHING;

CREATE OR REPLACE FUNCTION public.kalkulator_k3_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); NEW.updated_by = auth.uid(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_kalkulator_k3_upd ON public.kalkulator_k3_saetze;
CREATE TRIGGER trg_kalkulator_k3_upd
  BEFORE UPDATE ON public.kalkulator_k3_saetze
  FOR EACH ROW EXECUTE FUNCTION public.kalkulator_k3_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Anfragen
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kalkulator_anfragen (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erstellt_am         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kunde_name          TEXT NOT NULL,
  kunde_rolle         TEXT,
  kunde_code          TEXT,
  summe_netto         NUMERIC,
  positionen_anzahl   INT,
  eigene_anzahl       INT,
  bedarf_text         TEXT,        -- formatierter Klartext für die Mail
  raw_anfrage         JSONB,       -- komplette Anfrage als JSON
  versendet_an_mail   TEXT,        -- an wen die Bestätigungs-Mail ging
  versendet_am        TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'eingegangen'
                       CHECK (status IN ('eingegangen','in_bearbeitung','angeboten','abgeschlossen','storniert')),
  bearbeitet_von      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notiz_intern        TEXT
);
CREATE INDEX IF NOT EXISTS idx_kalkulator_anfragen_status
  ON public.kalkulator_anfragen(status);
CREATE INDEX IF NOT EXISTS idx_kalkulator_anfragen_erstellt
  ON public.kalkulator_anfragen(erstellt_am DESC);

ALTER TABLE public.kalkulator_anfragen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ka_select ON public.kalkulator_anfragen;
CREATE POLICY ka_select ON public.kalkulator_anfragen
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('geschaeftsfuehrung','buero')
    )
  );
-- Schreiben passiert ausschließlich über die Edge-Function mit Service-Role,
-- direkten Schreib-Zugriff für Update-Status erlauben wir nur GF/Büro.
DROP POLICY IF EXISTS ka_update ON public.kalkulator_anfragen;
CREATE POLICY ka_update ON public.kalkulator_anfragen
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('geschaeftsfuehrung','buero')
    )
  )
  WITH CHECK (TRUE);

COMMENT ON TABLE public.kalkulator_anfragen IS
  'Kundenanfragen aus dem Bausatz-Kalkulator (HTML-Tool unter /kalkulator). Insert läuft über Edge-Function kalkulator-bridge.';
COMMENT ON TABLE public.kalkulator_k3_saetze IS
  'Gemeinsame K3/K7-Kalkulationssätze (ÖNORM B2061) für den Bausatz-Kalkulator. Lesbar für alle, schreibbar nur Geschäftsführung/Büro.';
