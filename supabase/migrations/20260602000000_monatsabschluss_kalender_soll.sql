-- ─── monatsabschluss_durchfuehren: Soll/Ist kalenderbasiert ────────────
-- Bisher rechnete der Abschluss-RPC das Soll als
--   Werktage(Mo-Fr) × Tagesnorm × Beschäftigungsgrad
-- — also OHNE Arbeitszeitkalender (L/K-Wochen) und OHNE Feiertage. Damit
-- bucht der Abschluss eine andere Zahl, als die Stundenauswertung anzeigt.
--
-- Neu: Soll = Summe der Tages-Soll-Werte aus dem arbeitszeitkalender
-- (exakt dieselbe Logik wie konten.ts/tagesSoll im Frontend). Ist =
-- gearbeitete Tage mit ihren Netto-Stunden + Abwesenheitstage (Urlaub/
-- Krank/SW/Feiertag) gutgeschrieben mit dem Tages-Soll → kein Minus für
-- Abwesenheit. Signatur unverändert.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.monatsabschluss_durchfuehren(
  p_von_datum DATE,
  p_bis_datum DATE,
  p_mitarbeiter_id UUID DEFAULT NULL
)
RETURNS TABLE (mitarbeiter_id UUID, soll NUMERIC, ist NUMERIC, differenz NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ma_id UUID;
  v_tagesnorm NUMERIC;
  v_beschgrad NUMERIC;
  v_za_faktor NUMERIC;
  v_modell TEXT;
  v_soll NUMERIC;
  v_ist NUMERIC;
  v_diff NUMERIC;
  v_za_id UUID;
  v_monat_label TEXT;
  v_year INT;
  v_month INT;
  v_h1_end DATE;
  v_full_end DATE;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF p_bis_datum < p_von_datum THEN
    RAISE EXCEPTION 'bis_datum vor von_datum';
  END IF;

  -- Periode-Label ableiten: H1 / H2 / ganzer Monat / freier Range
  v_year  := EXTRACT(YEAR FROM p_von_datum)::INT;
  v_month := EXTRACT(MONTH FROM p_von_datum)::INT;
  v_h1_end := MAKE_DATE(v_year, v_month, 15);
  v_full_end := (date_trunc('month', p_von_datum) + interval '1 month' - interval '1 day')::date;

  IF p_von_datum = MAKE_DATE(v_year, v_month, 1) AND p_bis_datum = v_full_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM');
  ELSIF p_von_datum = MAKE_DATE(v_year, v_month, 1) AND p_bis_datum = v_h1_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM') || '-H1';
  ELSIF p_von_datum = MAKE_DATE(v_year, v_month, 16) AND p_bis_datum = v_full_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM') || '-H2';
  ELSE
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM-DD') || '_' || TO_CHAR(p_bis_datum, 'YYYY-MM-DD');
  END IF;

  FOR v_ma_id IN
    SELECT id FROM public.profiles
    WHERE is_active = TRUE
      AND (p_mitarbeiter_id IS NULL OR id = p_mitarbeiter_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.monatsabschluss ma
        WHERE ma.mitarbeiter_id = profiles.id AND ma.monat = v_monat_label
      )
  LOOP
    SELECT COALESCE(tagesnorm_stunden, 8.0),
           COALESCE(beschaeftigungsgrad, 1.0),
           COALESCE(za_faktor, 1.0),
           COALESCE(arbeitszeitmodell, 'zimmerei_sommer')
      INTO v_tagesnorm, v_beschgrad, v_za_faktor, v_modell
      FROM public.profile_konten_settings WHERE profile_id = v_ma_id;
    v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
    v_beschgrad := COALESCE(v_beschgrad, 1.0);
    v_za_faktor := COALESCE(v_za_faktor, 1.0);
    v_modell    := COALESCE(v_modell, 'zimmerei_sommer');

    -- Soll = Summe Tages-Soll laut Kalender; Ist = gearbeitete Tage netto
    -- + Abwesenheitstage gutgeschrieben mit dem Tages-Soll.
    SELECT COALESCE(SUM(tg.day_soll), 0),
           COALESCE(SUM(
             CASE
               WHEN st.id IS NULL THEN 0
               WHEN st.tag_status IN ('baustelle', 'firma') THEN st.netto_stunden
               ELSE tg.day_soll
             END
           ), 0)
      INTO v_soll, v_ist
      FROM (
        SELECT d::date AS datum,
          (CASE
             WHEN v_modell = 'fix_40h' THEN
               CASE WHEN EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5 THEN 8.0 ELSE 0 END
             WHEN v_modell = 'individuell' THEN
               CASE WHEN EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5 THEN v_tagesnorm ELSE 0 END
             ELSE  -- zimmerei_sommer: aus dem Kalender, sonst Tagesnorm-Fallback
               CASE
                 WHEN k.jahr IS NULL THEN
                   CASE WHEN EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5 THEN v_tagesnorm ELSE 0 END
                 ELSE COALESCE(
                   CASE EXTRACT(ISODOW FROM d)::int
                     WHEN 1 THEN k.soll_mo WHEN 2 THEN k.soll_di WHEN 3 THEN k.soll_mi
                     WHEN 4 THEN k.soll_do WHEN 5 THEN k.soll_fr WHEN 6 THEN k.soll_sa
                     WHEN 7 THEN k.soll_so END, 0)
               END
           END) * v_beschgrad AS day_soll
        FROM generate_series(p_von_datum, p_bis_datum, interval '1 day') AS d
        LEFT JOIN public.arbeitszeitkalender k
          ON k.jahr = EXTRACT(ISOYEAR FROM d)::int
         AND k.kw   = EXTRACT(WEEK FROM d)::int
      ) tg
      LEFT JOIN public.stunden_tage st
        ON st.mitarbeiter_id = v_ma_id AND st.datum = tg.datum;

    v_soll := ROUND(v_soll, 2);
    v_ist  := ROUND(v_ist, 2);
    v_diff := ROUND((v_ist - v_soll) * v_za_faktor, 2);

    INSERT INTO public.za_buchungen
      (mitarbeiter_id, art, stunden, wirksam_am, monat, notiz, erstellt_von)
      VALUES
      (v_ma_id, 'monatsabschluss', v_diff, p_bis_datum, v_monat_label,
       CONCAT('Periode ', p_von_datum, '–', p_bis_datum,
              ': Soll ', v_soll, ' h / Ist ', v_ist, ' h / Faktor ', v_za_faktor),
       auth.uid())
      RETURNING id INTO v_za_id;

    INSERT INTO public.monatsabschluss
      (mitarbeiter_id, monat, von_datum, bis_datum, soll_stunden, ist_stunden,
       differenz_stunden, za_buchung_id, abgeschlossen_von)
      VALUES
      (v_ma_id, v_monat_label, p_von_datum, p_bis_datum,
       v_soll, v_ist, v_diff, v_za_id, auth.uid());

    mitarbeiter_id := v_ma_id;
    soll  := v_soll;
    ist   := v_ist;
    differenz := v_diff;
    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.monatsabschluss_durchfuehren IS
  'Schliesst eine Periode ab. Soll = Arbeitszeitkalender (L/K-Wochen), '
  'Ist = gearbeitete Netto-Stunden + Abwesenheit zum Tages-Soll gutgeschrieben.';

NOTIFY pgrst, 'reload schema';
