-- =====================================================================
-- Werk- und Hallenstunden auf die Baustelle buchen.
--
-- Gemeldet: „Halle und Werk sollten Baustellen zur Auswahl stehen!
-- Stunden müssen auf die Baustelle gebucht werden. Auch die vom Werk."
--
-- Fachlich richtig: was im Werk vorgefertigt wird, gehört kostenmäßig auf
-- die Baustelle, für die es vorgefertigt wird.
--
-- WARUM EIN ZUSÄTZLICHES FELD UND KEINE UMDEUTUNG:
--
-- `baustelle_id` trägt heute die Maschine (Maschinen sind baustellen mit
-- kategorie='maschine'). Genau daran hängen drei Dinge:
--
--   1. DER TAGGELD-AUSSCHLUSS. stundenAggregation.taggeldFuerTag() zählt
--      Stunden NICHT fürs Taggeld, wenn baustelle_id eine Maschine ist —
--      Werkstattarbeit ist keine Auswärtstätigkeit. Böge man das Feld auf
--      die Ziel-Baustelle um, gäbe es ab sofort Taggeld für Werkstatt-
--      arbeit, bis hinein in die Lohnverrechnung.
--   2. Welche Seite einen Eintrag bearbeiten darf (gehoertZurHalle in
--      HalleErfassung, istMaschinenEintrag in Stunden). Nach einer
--      Umdeutung hielten BEIDE Seiten den Eintrag für „gehört der
--      anderen" — er wäre nirgends mehr änderbar.
--   3. Die Anzeige im Tages-Editor des Baustellenstundenberichts.
--
-- Deshalb: `baustelle_id` bleibt unverändert die Maschine, `ziel_baustelle_id`
-- kommt dazu. Alle drei Punkte funktionieren ohne eine Zeile Änderung
-- weiter; angepasst wird nur, was NACH BAUSTELLE auswertet.
-- =====================================================================

ALTER TABLE public.stunden_taetigkeiten
  ADD COLUMN IF NOT EXISTS ziel_baustelle_id UUID
    REFERENCES public.baustellen(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.stunden_taetigkeiten.ziel_baustelle_id IS
  'Nur bei Werk-/Hallenstunden: die Baustelle, FÜR die vorgefertigt wird. '
  'baustelle_id bleibt die Maschine — daran hängt der Taggeld-Ausschluss. '
  'Für Auswertungen nach Baustelle gilt: COALESCE(ziel_baustelle_id, baustelle_id).';

CREATE INDEX IF NOT EXISTS idx_stunden_taetigkeiten_ziel
  ON public.stunden_taetigkeiten (ziel_baustelle_id)
  WHERE ziel_baustelle_id IS NOT NULL;

-- Sicherheitsnetz: das Ziel darf keine Maschine sein, sonst wäre wieder
-- unklar, was Maschine und was Baustelle ist.
CREATE OR REPLACE FUNCTION public.pruefe_ziel_baustelle()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  IF NEW.ziel_baustelle_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.ziel_baustelle_id = NEW.baustelle_id THEN
    RAISE EXCEPTION 'Ziel-Baustelle darf nicht die Maschine selbst sein';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.baustellen
     WHERE id = NEW.ziel_baustelle_id AND kategorie = 'maschine'
  ) THEN
    RAISE EXCEPTION 'Ziel-Baustelle darf keine Maschine sein';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pruefe_ziel_baustelle ON public.stunden_taetigkeiten;
CREATE TRIGGER trg_pruefe_ziel_baustelle
  BEFORE INSERT OR UPDATE OF ziel_baustelle_id ON public.stunden_taetigkeiten
  FOR EACH ROW EXECUTE FUNCTION public.pruefe_ziel_baustelle();

NOTIFY pgrst, 'reload schema';


-- ─── Schnappschuss des Baustellenstundenberichts ─────────────────────
--
-- Der Bericht speichert bei der Erzeugung einen Schnappschuss der
-- Tageseinträge; stundenBerichtDiff vergleicht ihn später mit dem
-- Live-Stand und färbt Abweichungen gelb. Ohne `ziel_baustelle_id` im
-- Schnappschuss bliebe ein späteres Umbuchen unbemerkt.
--
-- Bewusst die UNVERÄNDERTE Fassung aus der Datenbank mit genau EINER
-- ergänzten Zeile — die Funktion enthält Feinheiten, die man beim
-- Neuschreiben verliert: den Cron-Aufruf (auth.uid() IS NULL), die
-- p_teil-Prüfung und den Filter auf aktive Mitarbeiter.
--
-- Altbestand bleibt ruhig: alte Schnappschüsse haben den Schlüssel nicht,
-- und stundenBerichtDiff behandelt „fehlt" und „null" gleich.
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
  v_snapshot JSONB;
  v_count INT := 0;
BEGIN
  -- Aufrufer: Admin/Büro (Test-Button) oder Cron (auth.uid() IS NULL).
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
  LOOP
    SELECT COALESCE(jsonb_object_agg(s.datum::text, s.entries), '{}'::jsonb)
      INTO v_snapshot
      FROM (
        SELECT st.datum,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'art', tt.art,
                     'baustelle_id', tt.baustelle_id,
                     'ziel_baustelle_id', tt.ziel_baustelle_id,
                     'taetigkeit_id', tt.taetigkeit_id,
                     'taetigkeit_freitext', tt.taetigkeit_freitext,
                     'stunden', tt.stunden
                   ) ORDER BY tt.position
                 ) FILTER (WHERE tt.id IS NOT NULL),
                 '[]'::jsonb
               ) AS entries
        FROM public.stunden_tage st
        LEFT JOIN public.stunden_taetigkeiten tt ON tt.stunden_tag_id = st.id
        WHERE st.mitarbeiter_id = v_ma_id
          AND st.datum BETWEEN v_von AND v_bis
        GROUP BY st.datum
      ) s;

    INSERT INTO public.stunden_berichte
      (mitarbeiter_id, jahr, monat, teil, von_datum, bis_datum, status, snapshot)
    VALUES
      (v_ma_id, p_jahr, p_monat, p_teil, v_von, v_bis, 'offen', v_snapshot)
    ON CONFLICT (mitarbeiter_id, jahr, monat, teil) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $function$;

NOTIFY pgrst, 'reload schema';
