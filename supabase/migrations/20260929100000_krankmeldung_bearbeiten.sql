-- =====================================================================
-- Krankmeldung nachträglich bearbeiten (Änderungswunsch J. Maurer 29.09.):
-- „bei Krankmeldungen … kann nichts mehr bearbeiten".
--
-- 1. Mitarbeiter dürfen die EIGENE Krankmeldung ändern (Datum, Stunden,
--    Notiz, Foto nachreichen) — löschen durften sie sie schon immer.
-- 2. Ändern sich von/bis/stunden, werden die Krank-Einträge in der
--    Zeiterfassung (und damit im Tätigkeitsbericht) umgebucht: erst wie
--    beim Löschen entfernen, dann wie beim Einreichen neu anlegen.
--    Die Logik steckt dafür in zwei Helfern, die auch die bestehenden
--    Insert-/Delete-Trigger verwenden (Verhalten dort unverändert).
-- =====================================================================

-- ─── Helfer: Krank-Einträge einer Meldung anlegen ────────────────────
CREATE OR REPLACE FUNCTION public.krankmeldung_eintragen(k public.krankmeldungen)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d date;
  v_tag uuid;
  v_status text;
  v_pos int;
BEGIN
  -- Stundenweise (Arzttermin): eine krank-Zeile mit den gemeldeten Stunden;
  -- vorhandene Arbeitsstunden des Tages bleiben stehen.
  IF k.stunden IS NOT NULL AND k.stunden > 0 THEN
    d := k.von;
    SELECT id, status INTO v_tag, v_status
      FROM public.stunden_tage
     WHERE mitarbeiter_id = k.mitarbeiter_id AND datum = d;
    IF v_tag IS NULL THEN
      INSERT INTO public.stunden_tage
        (mitarbeiter_id, datum, tag_status, netto_stunden, status, erfasst_von)
      VALUES (k.mitarbeiter_id, d, 'krank', 0, 'erfasst', k.mitarbeiter_id)
      RETURNING id INTO v_tag;
    ELSIF v_status NOT IN ('erfasst', 'ma_bestaetigt') THEN
      RAISE EXCEPTION 'Der % ist bereits freigegeben — stundenweise Krankmeldung nicht mehr möglich.', d;
    END IF;
    SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
      FROM public.stunden_taetigkeiten WHERE stunden_tag_id = v_tag;
    INSERT INTO public.stunden_taetigkeiten (stunden_tag_id, position, stunden, art)
    VALUES (v_tag, v_pos, k.stunden, 'krank');
    RETURN;
  END IF;

  -- Ganztages-Fall: Werktage als krank markieren.
  d := k.von;
  WHILE d <= k.bis LOOP
    IF EXTRACT(DOW FROM d) BETWEEN 1 AND 5 THEN
      INSERT INTO public.stunden_tage (mitarbeiter_id, datum, tag_status, netto_stunden, status, erfasst_von)
      VALUES (k.mitarbeiter_id, d, 'krank', 0, 'ma_bestaetigt', k.mitarbeiter_id)
      ON CONFLICT (mitarbeiter_id, datum) DO UPDATE
        SET tag_status = 'krank', netto_stunden = 0
        WHERE public.stunden_tage.status = 'erfasst';
    END IF;
    d := d + INTERVAL '1 day';
  END LOOP;
END $$;

-- ─── Helfer: Krank-Einträge einer Meldung entfernen ──────────────────
CREATE OR REPLACE FUNCTION public.krankmeldung_austragen(k public.krankmeldungen)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF k.stunden IS NOT NULL AND k.stunden > 0 THEN
    -- Nur die krank-Zeile mit exakt diesen Stunden am Von-Tag entfernen —
    -- Arbeitsstunden desselben Tages bleiben unangetastet.
    DELETE FROM public.stunden_taetigkeiten tt
     USING public.stunden_tage st
     WHERE tt.stunden_tag_id = st.id
       AND st.mitarbeiter_id = k.mitarbeiter_id
       AND st.datum = k.von
       AND tt.art = 'krank'
       AND tt.stunden = k.stunden
       AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
       AND tt.id = (
         SELECT tt2.id FROM public.stunden_taetigkeiten tt2
          WHERE tt2.stunden_tag_id = st.id AND tt2.art = 'krank' AND tt2.stunden = k.stunden
          ORDER BY tt2.position DESC LIMIT 1
       );
    -- Bleibt der Tag komplett leer, den Torso entfernen.
    DELETE FROM public.stunden_tage st
     WHERE st.mitarbeiter_id = k.mitarbeiter_id
       AND st.datum = k.von
       AND st.status IN ('erfasst', 'ma_bestaetigt')
       AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
       AND NOT EXISTS (
         SELECT 1 FROM public.stunden_taetigkeiten tt WHERE tt.stunden_tag_id = st.id
       );
    RETURN;
  END IF;

  DELETE FROM public.stunden_tage st
   WHERE st.mitarbeiter_id = k.mitarbeiter_id
     AND st.datum BETWEEN k.von AND k.bis
     AND st.tag_status = 'krank'
     AND NOT public.month_locked(st.mitarbeiter_id, st.datum)
     AND NOT EXISTS (
       SELECT 1 FROM public.stunden_taetigkeiten tt
        WHERE tt.stunden_tag_id = st.id
     );
END $$;

-- ─── Bestehende Trigger-Funktionen auf die Helfer umstellen ──────────
CREATE OR REPLACE FUNCTION public.krankmeldung_to_stunden_tage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.krankmeldung_eintragen(NEW);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.krankmeldung_cleanup_stunden_tage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.krankmeldung_austragen(OLD);
  RETURN OLD;
END $$;

-- ─── Neu: Ändern bucht um ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.krankmeldung_update_stunden_tage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Nur Notiz oder Foto geändert → Zeiterfassung bleibt, wie sie ist.
  IF NEW.von IS NOT DISTINCT FROM OLD.von
     AND NEW.bis IS NOT DISTINCT FROM OLD.bis
     AND NEW.stunden IS NOT DISTINCT FROM OLD.stunden THEN
    RETURN NEW;
  END IF;
  PERFORM public.krankmeldung_austragen(OLD);
  PERFORM public.krankmeldung_eintragen(NEW);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_krankmeldung_update ON public.krankmeldungen;
CREATE TRIGGER trg_krankmeldung_update
  AFTER UPDATE ON public.krankmeldungen
  FOR EACH ROW EXECUTE FUNCTION public.krankmeldung_update_stunden_tage();

-- Helfer nicht direkt aufrufbar machen — nur über die Trigger.
REVOKE ALL ON FUNCTION public.krankmeldung_eintragen(public.krankmeldungen) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.krankmeldung_austragen(public.krankmeldungen) FROM PUBLIC, anon, authenticated;

-- ─── Rechte: eigene Meldung ändern ───────────────────────────────────
DROP POLICY IF EXISTS krank_update ON public.krankmeldungen;
CREATE POLICY krank_update ON public.krankmeldungen
  FOR UPDATE TO authenticated
  USING (mitarbeiter_id = (select auth.uid()) OR public.is_admin_role((select auth.uid())))
  WITH CHECK (mitarbeiter_id = (select auth.uid()) OR public.is_admin_role((select auth.uid())));

NOTIFY pgrst, 'reload schema';
