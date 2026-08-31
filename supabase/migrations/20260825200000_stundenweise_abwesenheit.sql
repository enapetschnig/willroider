-- =====================================================================
-- Stundenweise Abwesenheit: „2 Stunden Arzttermin" / „2 Stunden Urlaub".
--
-- urlaubsantraege.stunden / krankmeldungen.stunden: NULL = ganze Tage
-- (bisheriges Verhalten, unverändert). Ein Wert > 0 heißt: nur diese
-- Stunden an EINEM Tag (der Dialog erzwingt von = bis).
--
-- Konto-Logik bleibt konsistent, weil die stundenweisen Einträge als
-- normale stunden_taetigkeiten (art urlaub/krank) landen — genau wie in
-- der Stundenerfassung und im Tätigkeitsbericht:
--   • Urlaub: der TAG:-Auto-Buchungs-Trigger bucht anteilige Tage
--     (Stunden / Tages-Soll); der Pauschal-Abzug des Antrags entfällt
--     für Stunden-Anträge (siehe genehmigeUrlaubsantrag im Frontend).
--   • Krank: kein Konto — nur die Tageszeile.
--
-- ACHTUNG vor dem Einspielen: pg_get_functiondef der LIVE-Funktion
-- krankmeldung_to_stunden_tage mit dem Repo-Stand abgleichen — die
-- Fassung hier basiert auf 20260527000000 + search_path-Fix.
-- =====================================================================

ALTER TABLE public.urlaubsantraege
  ADD COLUMN IF NOT EXISTS stunden numeric NULL
  CHECK (stunden IS NULL OR (stunden > 0 AND stunden <= 24));

ALTER TABLE public.krankmeldungen
  ADD COLUMN IF NOT EXISTS stunden numeric NULL
  CHECK (stunden IS NULL OR (stunden > 0 AND stunden <= 24));

COMMENT ON COLUMN public.urlaubsantraege.stunden IS
  'NULL = ganze Tage. > 0 = nur diese Stunden am Tag von (= bis).';
COMMENT ON COLUMN public.krankmeldungen.stunden IS
  'NULL = ganze Tage. > 0 = nur diese Stunden am Tag von (= bis), z. B. Arzttermin.';

-- ─── Krank-Trigger: Stunden-Fall ergänzt, Ganztages-Fall unverändert ──
CREATE OR REPLACE FUNCTION public.krankmeldung_to_stunden_tage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date;
  v_tag uuid;
  v_status text;
  v_pos int;
BEGIN
  -- Stundenweise (Arzttermin): KEIN Ganztages-Marker. Eine krank-Zeile
  -- mit den gemeldeten Stunden; vorhandene Arbeitsstunden des Tages
  -- bleiben stehen, der Recompute-Trigger setzt Status/Netto selbst.
  IF NEW.stunden IS NOT NULL AND NEW.stunden > 0 THEN
    d := NEW.von;
    SELECT id, status INTO v_tag, v_status
      FROM public.stunden_tage
     WHERE mitarbeiter_id = NEW.mitarbeiter_id AND datum = d;
    IF v_tag IS NULL THEN
      INSERT INTO public.stunden_tage
        (mitarbeiter_id, datum, tag_status, netto_stunden, status, erfasst_von)
      VALUES (NEW.mitarbeiter_id, d, 'krank', 0, 'erfasst', NEW.mitarbeiter_id)
      RETURNING id INTO v_tag;
    ELSIF v_status NOT IN ('erfasst', 'ma_bestaetigt') THEN
      RAISE EXCEPTION 'Der % ist bereits freigegeben — stundenweise Krankmeldung nicht mehr möglich.', d;
    END IF;
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
      FROM public.stunden_taetigkeiten WHERE stunden_tag_id = v_tag;
    INSERT INTO public.stunden_taetigkeiten (stunden_tag_id, position, stunden, art)
    VALUES (v_tag, v_pos, NEW.stunden, 'krank');
    RETURN NEW;
  END IF;

  -- Ganztages-Fall: unverändert wie bisher.
  d := NEW.von;
  WHILE d <= NEW.bis LOOP
    IF EXTRACT(DOW FROM d) BETWEEN 1 AND 5 THEN
      INSERT INTO public.stunden_tage (mitarbeiter_id, datum, tag_status, netto_stunden, status, erfasst_von)
      VALUES (NEW.mitarbeiter_id, d, 'krank', 0, 'ma_bestaetigt', NEW.mitarbeiter_id)
      ON CONFLICT (mitarbeiter_id, datum) DO UPDATE
        SET tag_status = 'krank', netto_stunden = 0
        WHERE public.stunden_tage.status = 'erfasst';
    END IF;
    d := d + INTERVAL '1 day';
  END LOOP;
  RETURN NEW;
END $$;

-- ─── Delete-Cleanup: stundenweise Meldungen räumen ihre Zeile ab ──────
CREATE OR REPLACE FUNCTION public.krankmeldung_cleanup_stunden_tage()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.stunden IS NOT NULL AND OLD.stunden > 0 THEN
    -- Nur die krank-Zeile mit exakt diesen Stunden am Von-Tag entfernen —
    -- Arbeitsstunden desselben Tages bleiben unangetastet.
    DELETE FROM public.stunden_taetigkeiten tt
     USING public.stunden_tage st
     WHERE tt.stunden_tag_id = st.id
       AND st.mitarbeiter_id = OLD.mitarbeiter_id
       AND st.datum = OLD.von
       AND tt.art = 'krank'
       AND tt.stunden = OLD.stunden
       AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
       AND tt.id = (
         SELECT tt2.id FROM public.stunden_taetigkeiten tt2
          WHERE tt2.stunden_tag_id = st.id AND tt2.art = 'krank' AND tt2.stunden = OLD.stunden
          ORDER BY tt2.position DESC LIMIT 1
       );
    -- Bleibt der Tag komplett leer, den Torso entfernen.
    DELETE FROM public.stunden_tage st
     WHERE st.mitarbeiter_id = OLD.mitarbeiter_id
       AND st.datum = OLD.von
       AND st.status IN ('erfasst', 'ma_bestaetigt')
       AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
       AND NOT EXISTS (
         SELECT 1 FROM public.stunden_taetigkeiten tt WHERE tt.stunden_tag_id = st.id
       );
    RETURN OLD;
  END IF;

  -- Ganztages-Fall: unverändert wie bisher.
  DELETE FROM public.stunden_tage st
   WHERE st.mitarbeiter_id = OLD.mitarbeiter_id
     AND st.datum BETWEEN OLD.von AND OLD.bis
     AND st.tag_status = 'krank'
     AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
     AND NOT EXISTS (
       SELECT 1 FROM public.stunden_taetigkeiten tt
        WHERE tt.stunden_tag_id = st.id
     );
  RETURN OLD;
END;
$$;
