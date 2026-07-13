-- =====================================================================
-- Poliereinsatz-Ansicht (Wochenplanung nach MS-Project-Vorbild)
--
-- Neue Sicht in der Jahresplanung: Zeilen = Baustellen gruppiert nach
-- Polier (Partie), Balken = Einsatz-Zeitraum, Farbe = Bauleiter.
--
-- 1. poliereinsatz_zeitraeume: ein Zeitraum je Partie+Baustelle —
--    das Pendant zum MS-Project-Vorgang. start_fix=false ⇒ Balken wird
--    gestrichelt dargestellt (Starttermin noch nicht fix).
-- 2. profiles.planungsfarbe: Balkenfarbe des Bauleiters, im Admin
--    pflegbar. Vorbelegung laut Vorgabe: Maurer=Orange,
--    Egger Sebastian=Gelb, Egger Eckart=Rot, Gwenger=Blau,
--    Pließnig=Violett (+ Winkler=Grün als freie Farbe).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.poliereinsatz_zeitraeume (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partie_id    UUID NOT NULL REFERENCES public.partien(id) ON DELETE CASCADE,
  baustelle_id UUID NOT NULL REFERENCES public.baustellen(id) ON DELETE CASCADE,
  von_datum    DATE NOT NULL,
  bis_datum    DATE NOT NULL,
  start_fix    BOOLEAN NOT NULL DEFAULT TRUE,
  notiz        TEXT,
  erstellt_von UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT poliereinsatz_range_ok CHECK (bis_datum >= von_datum)
);

CREATE INDEX IF NOT EXISTS idx_poliereinsatz_partie
  ON public.poliereinsatz_zeitraeume(partie_id, von_datum);
CREATE INDEX IF NOT EXISTS idx_poliereinsatz_baustelle
  ON public.poliereinsatz_zeitraeume(baustelle_id);

ALTER TABLE public.poliereinsatz_zeitraeume ENABLE ROW LEVEL SECURITY;

-- Lesen: alle mit Planungs-Sicht (die Ansicht ist Teil der Jahresplanung)
DROP POLICY IF EXISTS poliereinsatz_select ON public.poliereinsatz_zeitraeume;
CREATE POLICY poliereinsatz_select ON public.poliereinsatz_zeitraeume
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'arbeitsplanung.view'));

-- Schreiben: wer die Jahresplanung bearbeiten darf
DROP POLICY IF EXISTS poliereinsatz_write ON public.poliereinsatz_zeitraeume;
CREATE POLICY poliereinsatz_write ON public.poliereinsatz_zeitraeume
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'arbeitsplanung.edit'))
  WITH CHECK (public.has_permission(auth.uid(), 'arbeitsplanung.edit'));

-- updated_at-Pflege (generische Projekt-Funktion)
DROP TRIGGER IF EXISTS trg_poliereinsatz_updated ON public.poliereinsatz_zeitraeume;
CREATE TRIGGER trg_poliereinsatz_updated
  BEFORE UPDATE ON public.poliereinsatz_zeitraeume
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Bauleiter-Planungsfarbe ──────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS planungsfarbe TEXT;

COMMENT ON COLUMN public.profiles.planungsfarbe IS
  'Balkenfarbe in der Poliereinsatz-Ansicht (Hex). Nur für Bauleiter relevant.';

-- Vorbelegung laut Vorgabe (idempotent: nur wenn noch leer)
UPDATE public.profiles SET planungsfarbe = '#f97316'  -- Orange
 WHERE nachname = 'Maurer' AND vorname = 'Johannes' AND planungsfarbe IS NULL;
UPDATE public.profiles SET planungsfarbe = '#eab308'  -- Gelb
 WHERE nachname = 'Egger' AND vorname = 'Sebastian' AND planungsfarbe IS NULL;
UPDATE public.profiles SET planungsfarbe = '#dc2626'  -- Rot
 WHERE nachname = 'Egger' AND vorname = 'Eckart' AND planungsfarbe IS NULL;
UPDATE public.profiles SET planungsfarbe = '#3b82f6'  -- Blau
 WHERE nachname = 'Gwenger' AND vorname = 'Niklas' AND planungsfarbe IS NULL;
UPDATE public.profiles SET planungsfarbe = '#8b5cf6'  -- Violett
 WHERE nachname = 'Pließnig' AND vorname = 'Christian' AND planungsfarbe IS NULL;
UPDATE public.profiles SET planungsfarbe = '#16a34a'  -- Grün (frei gewählt)
 WHERE nachname = 'Winkler' AND vorname = 'Elias' AND planungsfarbe IS NULL;

NOTIFY pgrst, 'reload schema';
