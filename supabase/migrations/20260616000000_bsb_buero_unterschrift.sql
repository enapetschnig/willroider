-- BSB: Büro-Unterschrift (Maurer/Büro/GF) zusätzlich zur MA-Unterschrift.
-- Beim „Bestätigen & ans Büro senden" unterschreibt der bestätigende
-- User ebenfalls — die Signatur wird im Bericht persistiert und im PDF
-- + in der Detail-Ansicht angezeigt.

ALTER TABLE public.stunden_berichte
  ADD COLUMN IF NOT EXISTS bestaetigt_unterschrift_data TEXT;

-- RPC erweitern: optionaler Parameter p_unterschrift. Bei NULL bleibt
-- das Verhalten wie bisher (rückwärtskompatibel, falls alte Clients
-- noch zwei-Parameter aufrufen — sie würden allerdings durch das
-- neue Signature-Schema einen Default brauchen).
CREATE OR REPLACE FUNCTION public.stunden_bericht_versenden(
  p_id UUID,
  p_mail TEXT,
  p_unterschrift TEXT DEFAULT NULL
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
    ist_neue_bestaetigung := TRUE;
    UPDATE public.stunden_berichte
      SET status                       = 'versendet',
          bestaetigt_von               = auth.uid(),
          bestaetigt_am                = NOW(),
          bestaetigt_unterschrift_data = COALESCE(p_unterschrift, bestaetigt_unterschrift_data),
          versendet_am                 = NOW(),
          versendet_an_mail            = p_mail
      WHERE id = p_id;
  ELSE
    UPDATE public.stunden_berichte
      SET status                       = 'versendet',
          versendet_am                 = NOW(),
          versendet_an_mail            = p_mail,
          bestaetigt_unterschrift_data = COALESCE(p_unterschrift, bestaetigt_unterschrift_data)
      WHERE id = p_id;
  END IF;

  IF ist_neue_bestaetigung THEN
    PERFORM public.monatsabschluss_durchfuehren(r.von_datum, r.bis_datum, r.mitarbeiter_id);
  END IF;
END $$;

COMMENT ON FUNCTION public.stunden_bericht_versenden(UUID, TEXT, TEXT) IS
  'Bestätigt (falls noch nicht) und markiert als versendet, persistiert die Büro-Unterschrift; löst beim ersten Mal den Monatsabschluss aus.';
