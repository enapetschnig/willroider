-- ============================================================================
-- Zeiterfassung-Redesign Phase B:
-- Alte Trigger auf stundenbuchungen abdrehen (die referenzieren fehlzeit_typ
-- und arbeitsstunden, die wir jetzt nicht mehr schreiben), Monatsabschluss-RPC
-- auf das neue stunden_tage-Schema umstellen.
--
-- Die Tabelle stundenbuchungen selbst BLEIBT bestehen — sie ist mit ON DELETE
-- SET NULL aus urlaubs_buchungen + za_buchungen verlinkt, und ein DROP wuerde
-- die historischen Initial-Saldi entkoppeln (die FK auf NULL gesetzt). Da die
-- Tabelle leer ist, kostet sie nichts.
-- ============================================================================

-- Alte Urlaubs-Auto-Trigger entsorgen (sie liefen auf stundenbuchungen,
-- werden durch urlaub_auto_book_tag/-cleanup_tag in Phase A ersetzt).
DROP TRIGGER IF EXISTS stundenbuchungen_urlaub_auto ON public.stundenbuchungen;
DROP TRIGGER IF EXISTS stundenbuchungen_urlaub_cleanup ON public.stundenbuchungen;
DROP FUNCTION IF EXISTS public.urlaub_auto_book();
DROP FUNCTION IF EXISTS public.urlaub_auto_cleanup();

-- Monatsabschluss-RPC neu: liest aus stunden_tage statt stundenbuchungen.
-- Logik:
--   Soll = Werktage × tagesnorm × beschaeftigungsgrad (wie bisher)
--   Ist  = SUM(netto_stunden) aus stunden_tage im Monat
--          (deckt Arbeit + Fehlzeiten ab; Fahrstunden gibt's nicht mehr separat
--           — Fahrzeit wird in stunden_fahrt geloggt, geht aber nicht in die
--           Stunden-Summe ein)
CREATE OR REPLACE FUNCTION public.monatsabschluss_durchfuehren(
  p_monat TEXT,
  p_mitarbeiter_id UUID DEFAULT NULL
)
RETURNS TABLE (mitarbeiter_id UUID, soll NUMERIC, ist NUMERIC, differenz NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ma_id UUID;
  v_year INT;
  v_month INT;
  v_start DATE;
  v_end DATE;
  v_werktage INT;
  v_tagesnorm NUMERIC;
  v_beschgrad NUMERIC;
  v_za_faktor NUMERIC;
  v_soll NUMERIC;
  v_ist NUMERIC;
  v_diff NUMERIC;
  v_za_id UUID;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  v_year  := SPLIT_PART(p_monat, '-', 1)::INT;
  v_month := SPLIT_PART(p_monat, '-', 2)::INT;
  v_start := MAKE_DATE(v_year, v_month, 1);
  v_end   := (v_start + INTERVAL '1 month')::DATE;

  -- Werktage Mo-Fr im Monat
  SELECT COUNT(*) INTO v_werktage
    FROM generate_series(v_start, v_end - 1, INTERVAL '1 day') AS d
    WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  FOR v_ma_id IN
    SELECT id FROM public.profiles
    WHERE is_active = true
      AND (p_mitarbeiter_id IS NULL OR id = p_mitarbeiter_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.monatsabschluss ma
        WHERE ma.mitarbeiter_id = profiles.id AND ma.monat = p_monat
      )
  LOOP
    SELECT COALESCE(tagesnorm_stunden, 8.0),
           COALESCE(beschaeftigungsgrad, 1.0),
           COALESCE(za_faktor, 1.0)
      INTO v_tagesnorm, v_beschgrad, v_za_faktor
      FROM public.profile_konten_settings WHERE profile_id = v_ma_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_beschgrad := COALESCE(v_beschgrad, 1.0);
    v_za_faktor := COALESCE(v_za_faktor, 1.0);

    v_soll := ROUND(v_werktage * v_tagesnorm * v_beschgrad, 2);

    -- NEU: Ist-Stunden aus stunden_tage (alles inkl. Fehlzeit-Stunden)
    SELECT COALESCE(SUM(netto_stunden), 0) INTO v_ist
      FROM public.stunden_tage
      WHERE mitarbeiter_id = v_ma_id
        AND datum >= v_start AND datum < v_end;

    v_diff := ROUND((v_ist - v_soll) * v_za_faktor, 2);

    INSERT INTO public.za_buchungen
      (mitarbeiter_id, art, stunden, wirksam_am, monat, notiz, erstellt_von)
      VALUES
      (v_ma_id, 'monatsabschluss', v_diff, v_end - 1, p_monat,
       CONCAT('Soll ', v_soll, ' h / Ist ', v_ist, ' h / Faktor ', v_za_faktor),
       auth.uid())
      RETURNING id INTO v_za_id;

    INSERT INTO public.monatsabschluss
      (mitarbeiter_id, monat, soll_stunden, ist_stunden, differenz_stunden,
       za_buchung_id, abgeschlossen_von)
      VALUES (v_ma_id, p_monat, v_soll, v_ist, v_diff, v_za_id, auth.uid());

    mitarbeiter_id := v_ma_id;
    soll  := v_soll;
    ist   := v_ist;
    differenz := v_diff;
    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.monatsabschluss_durchfuehren IS
  'Phase B: liest Ist-Stunden aus stunden_tage statt der abgeloesten '
  'stundenbuchungen-Tabelle.';
