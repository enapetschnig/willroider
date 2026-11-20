-- J. Maurer, 20.11.2026 (Berichte-Archiv, BSB Tripolt Nov. Teil I):
-- „Bei den Zulagen kein Hacken oder Kreuz sondern hier müssen auch stunden eingetragen werden
--  … ist es ein Zufall das fast bei allen der letzte Tag eine Änderung aufweisst oder ist das ein fehler im System ?“
--
-- 1) Zulagen ohne Stunden (NULL = „alle Stunden“ im Formular) wurden so gespeichert → im BSB ein „x“,
--    in Summen/Erschwernis-Zettel zählten sie 0. Ab jetzt füllt die Datenbank fehlende Stunden mit den
--    Arbeitsstunden (Baustelle + Firma) des Tages — Netz für alle Masken und alte, zwischengespeicherte App-Stände.
-- 2) Die Markierung „nach Erstellung geändert“ verglich mit dem Stand vom Cron am 16./Monatsletzten um 19:00.
--    Wer den letzten Tag erst am Abend oder am nächsten Morgen schrieb, war immer „geändert“. Ab jetzt gilt der
--    Stand bei der Unterschrift des Mitarbeiters (Snapshot wird beim Unterschreiben neu gezogen).

-- ─── gemeinsamer Snapshot (Erzeugen + Unterschreiben) ─────────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_snapshot(p_ma UUID, p_von DATE, p_bis DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_object_agg(s.datum::text, s.entries), '{}'::jsonb)
  FROM (
    SELECT st.datum,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'art', tt.art,
                 'baustelle_id', tt.baustelle_id,
                 'ziel_baustelle_id', tt.ziel_baustelle_id,
                 'ort', tt.ort,
                 'taetigkeit_id', tt.taetigkeit_id,
                 'taetigkeit_freitext', tt.taetigkeit_freitext,
                 'stunden', tt.stunden
               ) ORDER BY tt.position
             ) FILTER (WHERE tt.id IS NOT NULL),
             '[]'::jsonb
           ) AS entries
    FROM public.stunden_tage st
    LEFT JOIN public.stunden_taetigkeiten tt ON tt.stunden_tag_id = st.id
    WHERE st.mitarbeiter_id = p_ma
      AND st.datum BETWEEN p_von AND p_bis
    GROUP BY st.datum
  ) s;
$$;
REVOKE ALL ON FUNCTION public.stunden_bericht_snapshot(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stunden_bericht_snapshot(UUID, DATE, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.stunden_bericht_erzeugen(p_jahr integer, p_monat integer, p_teil integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von DATE;
  v_bis DATE;
  v_ma_id UUID;
  v_count INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF p_teil NOT IN (1, 2) THEN
    RAISE EXCEPTION 'teil muss 1 oder 2 sein';
  END IF;

  v_von := MAKE_DATE(p_jahr, p_monat, CASE p_teil WHEN 1 THEN 1 ELSE 17 END);
  v_bis := CASE p_teil
    WHEN 1 THEN MAKE_DATE(p_jahr, p_monat, 16)
    ELSE (date_trunc('month', MAKE_DATE(p_jahr, p_monat, 1))
          + interval '1 month' - interval '1 day')::date
  END;

  FOR v_ma_id IN
    SELECT DISTINCT st.mitarbeiter_id
    FROM public.stunden_tage st
    JOIN public.profiles p ON p.id = st.mitarbeiter_id AND p.is_active = TRUE
    WHERE st.datum BETWEEN v_von AND v_bis
      -- Leasing Personal (ohne App-Zugang) bekommt keinen Stundenbericht —
      -- es könnte ihn nie unterschreiben (Wunsch 20.10.2026).
      AND COALESCE(p.zeiterfassung_typ, '') NOT IN ('angestellter', 'leasing')
  LOOP
    INSERT INTO public.stunden_berichte
      (mitarbeiter_id, jahr, monat, teil, von_datum, bis_datum, status, snapshot)
    VALUES
      (v_ma_id, p_jahr, p_monat, p_teil, v_von, v_bis, 'offen',
       public.stunden_bericht_snapshot(v_ma_id, v_von, v_bis))
    ON CONFLICT (mitarbeiter_id, jahr, monat, teil) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $function$;

CREATE OR REPLACE FUNCTION public.stunden_bericht_unterschreiben(p_id uuid, p_unterschrift text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.stunden_berichte;
BEGIN
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.mitarbeiter_id <> auth.uid() AND NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF r.status <> 'offen' THEN
    RAISE EXCEPTION 'Bericht ist nicht im Status offen';
  END IF;
  UPDATE public.stunden_berichte
    SET status = 'unterschrieben',
        unterschrift_data = p_unterschrift,
        unterschrieben_am = NOW(),
        -- Vergleichsstand = was der Mitarbeiter unterschrieben hat (J. Maurer, 20.11.2026)
        snapshot = public.stunden_bericht_snapshot(r.mitarbeiter_id, r.von_datum, r.bis_datum)
    WHERE id = p_id;
END $function$;

-- ─── Zulagen immer mit Stunden ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stunden_zulagen_stunden_fuellen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_h NUMERIC;
BEGIN
  IF NEW.stunden IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT SUM(tt.stunden) INTO v_h
    FROM public.stunden_taetigkeiten tt
   WHERE tt.stunden_tag_id = NEW.stunden_tag_id
     AND tt.art IN ('baustelle', 'firma');
  IF COALESCE(v_h, 0) > 0 THEN
    NEW.stunden := v_h;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stunden_zulagen_stunden_fuellen ON public.stunden_zulagen;
CREATE TRIGGER trg_stunden_zulagen_stunden_fuellen
  BEFORE INSERT OR UPDATE OF stunden ON public.stunden_zulagen
  FOR EACH ROW EXECUTE FUNCTION public.stunden_zulagen_stunden_fuellen();

-- Bestandsdaten (Sicherung: ~/roboter/sicherungen/willroider-2026-11-20-zulagen-stunden-bsb-stand/):
-- Zulagen ohne Stunden bekommen die Arbeitsstunden ihres Tages (das, was „alle“ im Formular bedeutete).
UPDATE public.stunden_zulagen z
   SET stunden = s.h
  FROM (
    SELECT tt.stunden_tag_id, SUM(tt.stunden) AS h
      FROM public.stunden_taetigkeiten tt
     WHERE tt.art IN ('baustelle', 'firma')
     GROUP BY tt.stunden_tag_id
  ) s
 WHERE z.stunden IS NULL
   AND s.stunden_tag_id = z.stunden_tag_id
   AND s.h > 0;
