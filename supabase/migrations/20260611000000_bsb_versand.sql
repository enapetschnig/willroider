-- BSB-Versand: Empfänger-Adresse pro Bericht protokollieren, RPC für
-- „Bestätigen + Versenden" in einem Schritt, kleine App-Settings-Tabelle
-- für den Default-Empfänger.

-- ─── 1) App-Einstellungen ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_einstellungen (
  schluessel TEXT PRIMARY KEY,
  wert       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_einstellungen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_einstellungen_select ON public.app_einstellungen;
CREATE POLICY app_einstellungen_select ON public.app_einstellungen
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS app_einstellungen_write ON public.app_einstellungen;
CREATE POLICY app_einstellungen_write ON public.app_einstellungen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

INSERT INTO public.app_einstellungen (schluessel, wert)
VALUES ('bsb_buero_mail', 'buero@willroider.at')
ON CONFLICT (schluessel) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_einstellungen_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_app_einstellungen_upd ON public.app_einstellungen;
CREATE TRIGGER trg_app_einstellungen_upd
  BEFORE UPDATE ON public.app_einstellungen
  FOR EACH ROW EXECUTE FUNCTION public.app_einstellungen_set_updated_at();

-- ─── 2) Versendet-Empfänger an stunden_berichte ─────────────────────────
ALTER TABLE public.stunden_berichte
  ADD COLUMN IF NOT EXISTS versendet_an_mail TEXT;

-- ─── 3) RPC: Versenden (bestätigt im selben Schritt, falls nötig) ───────
CREATE OR REPLACE FUNCTION public.stunden_bericht_versenden(
  p_id UUID,
  p_mail TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  r public.stunden_berichte;
  ist_neue_bestaetigung BOOLEAN := FALSE;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF p_mail IS NULL OR LENGTH(TRIM(p_mail)) = 0 THEN
    RAISE EXCEPTION 'Empfänger-Mail fehlt';
  END IF;

  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.status = 'offen' THEN
    RAISE EXCEPTION 'Bericht ist noch offen — der MA muss zuerst unterschreiben';
  END IF;

  IF r.status = 'unterschrieben' THEN
    -- Bestätigt + versendet in einem Schritt
    ist_neue_bestaetigung := TRUE;
    UPDATE public.stunden_berichte
      SET status            = 'versendet',
          bestaetigt_von    = auth.uid(),
          bestaetigt_am     = NOW(),
          versendet_am      = NOW(),
          versendet_an_mail = p_mail
      WHERE id = p_id;
  ELSE
    -- bestaetigt oder versendet → nur Versand-Felder aktualisieren
    UPDATE public.stunden_berichte
      SET status            = 'versendet',
          versendet_am      = NOW(),
          versendet_an_mail = p_mail
      WHERE id = p_id;
  END IF;

  -- Bei erstmaliger Bestätigung: ZA-Buchung über den Halbmonat anstoßen
  IF ist_neue_bestaetigung THEN
    PERFORM public.monatsabschluss_durchfuehren(r.von_datum, r.bis_datum, r.mitarbeiter_id);
  END IF;
END $$;

COMMENT ON FUNCTION public.stunden_bericht_versenden IS
  'Bestätigt (falls noch nicht) und markiert als versendet; löst beim ersten Mal den Monatsabschluss aus.';
