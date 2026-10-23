-- =====================================================================
-- „Bestätigen" und „Ans Büro senden" getrennt (Wunsch J. Maurer,
-- 23.10.2026). Bestätigen speichert jetzt auch die Büro-Unterschrift,
-- damit sie später beim Versand ins PDF kommt.
-- Aufrufe nur mit p_id funktionieren weiter (Standardwert NULL).
-- =====================================================================

DROP FUNCTION IF EXISTS public.stunden_bericht_bestaetigen(uuid);

CREATE OR REPLACE FUNCTION public.stunden_bericht_bestaetigen(p_id uuid, p_unterschrift text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.stunden_berichte;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.status <> 'unterschrieben' THEN
    RAISE EXCEPTION 'Bericht ist nicht im Status unterschrieben';
  END IF;

  UPDATE public.stunden_berichte
    SET status = 'bestaetigt',
        bestaetigt_von = auth.uid(),
        bestaetigt_am = NOW(),
        bestaetigt_unterschrift_data = COALESCE(p_unterschrift, bestaetigt_unterschrift_data)
    WHERE id = p_id;

  PERFORM public.monatsabschluss_durchfuehren(r.von_datum, r.bis_datum, r.mitarbeiter_id);
END $$;

REVOKE ALL ON FUNCTION public.stunden_bericht_bestaetigen(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stunden_bericht_bestaetigen(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
