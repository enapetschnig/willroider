-- =====================================================================
-- Stability-Fixes Runde 2 (Audit 2026-07-02, docs/stability-audit-2026-07.md)
--
--  1. [24] Realtime-Publication: user_roles + rollen_berechtigungen
--     fehlten → der Permission-Refresh im AuthContext war toter Code,
--     Rollen-Änderungen kamen erst nach manuellem Reload an.
--  2. [16][33] monatsabschluss_durchfuehren: Dedupe lief nur über das
--     exakte Perioden-Label → überlappende Perioden (BSB-Teil 1.–16.
--     vs. Monatsabschluss H1 1.–15.) wurden doppelt ins ZA-Konto
--     gebucht. Jetzt: Datums-Overlap-Check. Zusätzlich H1/H2-Grenzen
--     an die BSB-Teile angepasst (16./17. statt 15./16.).
--  3. [17] Inaktive MA: bei explizitem p_mitarbeiter_id (BSB-
--     Bestätigung) wird der MA jetzt auch abgeschlossen, wenn er
--     inzwischen deaktiviert wurde — vorher wurde der Bericht
--     'versendet' ohne dass ein Abschluss passierte.
--  4. [18] stunden_bericht_cron: erzeugt Nachzügler-Berichte täglich
--     (idempotent) statt nur exakt am Stichtag.
--  5. [34] invitation_logs: Klartext-Passwörter in sms_text redigiert.
-- =====================================================================

-- ─── 1. Realtime für Permission-Refresh ───────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rollen_berechtigungen;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ─── 2+3. monatsabschluss_durchfuehren ────────────────────────────────
CREATE OR REPLACE FUNCTION public.monatsabschluss_durchfuehren(
  p_von_datum date, p_bis_datum date, p_mitarbeiter_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(mitarbeiter_id uuid, soll numeric, ist numeric, differenz numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  -- Periode-Label: H1/H2-Grenzen an die BSB-Teile angepasst
  -- (Teil 1 = 1.–16., Teil 2 = 17.–Ende).
  v_year  := EXTRACT(YEAR FROM p_von_datum)::INT;
  v_month := EXTRACT(MONTH FROM p_von_datum)::INT;
  v_h1_end := MAKE_DATE(v_year, v_month, 16);
  v_full_end := (date_trunc('month', p_von_datum) + interval '1 month' - interval '1 day')::date;

  IF p_von_datum = MAKE_DATE(v_year, v_month, 1) AND p_bis_datum = v_full_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM');
  ELSIF p_von_datum = MAKE_DATE(v_year, v_month, 1) AND p_bis_datum = v_h1_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM') || '-H1';
  ELSIF p_von_datum = MAKE_DATE(v_year, v_month, 17) AND p_bis_datum = v_full_end THEN
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM') || '-H2';
  ELSE
    v_monat_label := TO_CHAR(p_von_datum, 'YYYY-MM-DD') || '_' || TO_CHAR(p_bis_datum, 'YYYY-MM-DD');
  END IF;

  FOR v_ma_id IN
    SELECT id FROM public.profiles
    -- Inaktive MA werden bei explizitem Aufruf (p_mitarbeiter_id) mit
    -- abgeschlossen — der BSB-Versand darf nicht still ohne Abschluss enden.
    WHERE (is_active = TRUE OR id = p_mitarbeiter_id)
      AND (p_mitarbeiter_id IS NULL OR id = p_mitarbeiter_id)
      -- Dedupe über DATUMS-OVERLAP statt Label-Gleichheit: verhindert
      -- Doppelbuchung bei überlappenden Perioden (z.B. 1.–16. und 1.–15.).
      AND NOT EXISTS (
        SELECT 1 FROM public.monatsabschluss ma
        WHERE ma.mitarbeiter_id = profiles.id
          AND ma.von_datum <= p_bis_datum
          AND ma.bis_datum >= p_von_datum
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
             ELSE
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
END $function$;

-- ─── 4. Cron: Nachzügler-Berichte täglich nacherzeugen ────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_cron()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today DATE := current_date;
  v_last  DATE := (date_trunc('month', current_date)
                   + interval '1 month' - interval '1 day')::date;
  v_prev  DATE := (date_trunc('month', current_date) - interval '1 month')::date;
BEGIN
  -- Regulär am Stichtag
  IF EXTRACT(DAY FROM v_today) = 16 THEN
    PERFORM public.stunden_bericht_erzeugen(
      EXTRACT(YEAR FROM v_today)::int, EXTRACT(MONTH FROM v_today)::int, 1);
  ELSIF v_today = v_last THEN
    PERFORM public.stunden_bericht_erzeugen(
      EXTRACT(YEAR FROM v_today)::int, EXTRACT(MONTH FROM v_today)::int, 2);
  END IF;

  -- Nachzügler (idempotent via ON CONFLICT DO NOTHING in erzeugen):
  -- MA, die ihre Stunden erst nach dem Stichtag erfassen, bekommen so
  -- trotzdem einen Bericht.
  IF EXTRACT(DAY FROM v_today) > 16 THEN
    PERFORM public.stunden_bericht_erzeugen(
      EXTRACT(YEAR FROM v_today)::int, EXTRACT(MONTH FROM v_today)::int, 1);
  END IF;
  PERFORM public.stunden_bericht_erzeugen(
    EXTRACT(YEAR FROM v_prev)::int, EXTRACT(MONTH FROM v_prev)::int, 1);
  PERFORM public.stunden_bericht_erzeugen(
    EXTRACT(YEAR FROM v_prev)::int, EXTRACT(MONTH FROM v_prev)::int, 2);
END;
$$;

-- ─── 5. Klartext-Passwörter in Logs redigieren ────────────────────────
UPDATE public.invitation_logs
   SET sms_text = regexp_replace(sms_text, '(Passwort[^:]*: ?)\S+', '\1[redigiert]', 'g')
 WHERE sms_text LIKE '%Passwort%';

NOTIFY pgrst, 'reload schema';
