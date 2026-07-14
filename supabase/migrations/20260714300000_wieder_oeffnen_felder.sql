-- =====================================================================
-- stunden_bericht_wieder_oeffnen: beim Zurücksetzen auf 'unterschrieben'
-- auch die Versand-/Bestätigungs-Spalten leeren — sonst bleibt ein
-- wieder geöffneter Bericht inkonsistent (status='unterschrieben', aber
-- versendet_am/Unterschrift noch gesetzt).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.stunden_bericht_wieder_oeffnen(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.stunden_berichte;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.status NOT IN ('bestaetigt', 'versendet') THEN
    RAISE EXCEPTION 'Nur bestätigte oder versendete Berichte können wieder geöffnet werden (aktuell: %)', r.status;
  END IF;

  PERFORM public.monatsabschluss_oeffnen(r.von_datum, r.bis_datum, r.mitarbeiter_id);

  UPDATE public.stunden_berichte
    SET status = 'unterschrieben',
        bestaetigt_von = NULL,
        bestaetigt_am = NULL,
        bestaetigt_unterschrift_data = NULL,
        versendet_am = NULL,
        versendet_an_mail = NULL
    WHERE id = p_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
