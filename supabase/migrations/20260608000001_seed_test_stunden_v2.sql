-- Seed v2: findet den User über E-Mail ODER Rolle (Fallback: erster gf-User).
-- Idempotent, harmlos auf fremden DBs.

DO $$
DECLARE
  v_ma     uuid;
  v_bs     uuid;
  v_datum  date;
  v_tag_id uuid;
  v_start  date;
BEGIN
  -- 1) Profil suchen: E-Mail in profiles, oder in auth.users
  SELECT id INTO v_ma
    FROM public.profiles
   WHERE email = 'hallo@epowergmbh.at'
   LIMIT 1;
  IF v_ma IS NULL THEN
    SELECT p.id INTO v_ma
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE u.email = 'hallo@epowergmbh.at'
     LIMIT 1;
  END IF;
  IF v_ma IS NULL THEN
    SELECT p.id INTO v_ma
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
     WHERE ur.role = 'geschaeftsfuehrung'
     LIMIT 1;
  END IF;
  IF v_ma IS NULL THEN
    RAISE NOTICE 'Seed übersprungen: kein passendes Profil gefunden';
    RETURN;
  END IF;

  -- 2) Baustelle "neuer Test"
  SELECT id INTO v_bs FROM public.baustellen
   WHERE bvh_name = 'neuer Test' LIMIT 1;
  IF v_bs IS NULL THEN
    INSERT INTO public.baustellen (bvh_name, status)
      VALUES ('neuer Test', 'aktiv')
      RETURNING id INTO v_bs;
  END IF;

  -- 3) Range: Vorwochen-Montag bis Freitag-dieser-Woche
  v_start := (current_date - ((EXTRACT(ISODOW FROM current_date))::int - 1) - 7)::date;

  -- 4) Werktage füllen, vorhandene überspringen
  FOR v_datum IN
    SELECT (v_start + i)::date AS d
    FROM generate_series(0, 11) AS i
    WHERE EXTRACT(ISODOW FROM v_start + i) BETWEEN 1 AND 5
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.stunden_tage
       WHERE mitarbeiter_id = v_ma AND datum = v_datum
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.stunden_tage
      (mitarbeiter_id, datum, tag_status, netto_stunden, arbeitsbeginn, status)
      VALUES (v_ma, v_datum, 'baustelle', 8, '07:00', 'erfasst')
      RETURNING id INTO v_tag_id;

    INSERT INTO public.stunden_taetigkeiten
      (stunden_tag_id, position, art, baustelle_id, stunden)
      VALUES (v_tag_id, 1, 'baustelle', v_bs, 8);
  END LOOP;

  RAISE NOTICE 'Seed fertig: Mitarbeiter %, Baustelle %, ab %', v_ma, v_bs, v_start;
END $$;
