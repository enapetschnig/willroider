-- Pflicht-Unterweisungs-Workflow:
-- 1) Wenn ein MA neu zu einer Einteilung hinzugefügt wird auf einer
--    Baustelle mit pflicht_evaluierung_id → Unterschriften-Aufforderung
--    automatisch anlegen.
-- 2) Wenn eine Baustelle eine neue pflicht_evaluierung_id bekommt →
--    rückwirkend für alle bereits eingeteilten MA Aufforderungen anlegen.
-- 3) View v_offene_unterschriften — pro Verantwortlichem (Polier + Bauleiter).

-- Trigger 1: bei neuer Einteilung
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_zuteilen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_baustelle_id UUID;
  v_pflicht_id UUID;
BEGIN
  SELECT baustelle_id INTO v_baustelle_id
    FROM public.einteilungen WHERE id = NEW.einteilung_id;
  IF v_baustelle_id IS NULL THEN RETURN NEW; END IF;
  SELECT pflicht_evaluierung_id INTO v_pflicht_id
    FROM public.baustellen WHERE id = v_baustelle_id;
  IF v_pflicht_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.evaluierung_unterschriften
    WHERE evaluierung_id = v_pflicht_id
      AND mitarbeiter_id = NEW.mitarbeiter_id
  ) THEN RETURN NEW; END IF;
  INSERT INTO public.evaluierung_unterschriften
    (evaluierung_id, mitarbeiter_id, unterschrift_data)
  VALUES (v_pflicht_id, NEW.mitarbeiter_id, NULL);
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS einteilung_mitarbeiter_pflicht_unterweisung
  ON public.einteilung_mitarbeiter;
CREATE TRIGGER einteilung_mitarbeiter_pflicht_unterweisung
  AFTER INSERT ON public.einteilung_mitarbeiter
  FOR EACH ROW EXECUTE FUNCTION public.pflicht_unterweisung_zuteilen();

-- Trigger 2: bei Änderung der Pflicht-Unterweisung an einer Baustelle
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_nachholen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.pflicht_evaluierung_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.pflicht_evaluierung_id IS NOT DISTINCT FROM NEW.pflicht_evaluierung_id THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.evaluierung_unterschriften
    (evaluierung_id, mitarbeiter_id, unterschrift_data)
  SELECT NEW.pflicht_evaluierung_id, em.mitarbeiter_id, NULL
  FROM public.einteilung_mitarbeiter em
  JOIN public.einteilungen e ON e.id = em.einteilung_id
  WHERE e.baustelle_id = NEW.id
  ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS baustellen_pflicht_unterweisung_changed
  ON public.baustellen;
CREATE TRIGGER baustellen_pflicht_unterweisung_changed
  AFTER INSERT OR UPDATE OF pflicht_evaluierung_id ON public.baustellen
  FOR EACH ROW EXECUTE FUNCTION public.pflicht_unterweisung_nachholen();

-- View: offene Unterschriften pro Verantwortlichem (Polier + Bauleiter)
CREATE OR REPLACE VIEW public.v_offene_unterschriften AS
WITH offene AS (
  SELECT u.id AS unterschrift_id,
         u.evaluierung_id,
         u.mitarbeiter_id,
         e.baustelle_id,
         e.notizen AS evaluierung_titel,
         e.datum AS evaluierung_datum
  FROM public.evaluierung_unterschriften u
  JOIN public.evaluierungen e ON e.id = u.evaluierung_id
  WHERE u.unterschrift_data IS NULL
),
mit_verantwortlichen AS (
  SELECT o.*,
         b.bvh_name,
         b.bauleiter_id,
         (SELECT partieleiter_id FROM public.partien p
          WHERE p.id = b.partie_id) AS polier_id
  FROM offene o
  JOIN public.baustellen b ON b.id = o.baustelle_id
)
SELECT 'polier'::text AS rolle,
       polier_id AS verantwortlich_id,
       baustelle_id, evaluierung_id, unterschrift_id, mitarbeiter_id,
       bvh_name, evaluierung_titel, evaluierung_datum
FROM mit_verantwortlichen WHERE polier_id IS NOT NULL
UNION ALL
SELECT 'bauleiter',
       bauleiter_id,
       baustelle_id, evaluierung_id, unterschrift_id, mitarbeiter_id,
       bvh_name, evaluierung_titel, evaluierung_datum
FROM mit_verantwortlichen WHERE bauleiter_id IS NOT NULL;

COMMENT ON FUNCTION public.pflicht_unterweisung_zuteilen IS
  'AFTER INSERT auf einteilung_mitarbeiter: legt eine Unterschriften-Aufforderung an, wenn die Baustelle eine Pflicht-Unterweisung hat.';
COMMENT ON FUNCTION public.pflicht_unterweisung_nachholen IS
  'AFTER UPDATE pflicht_evaluierung_id auf baustellen: rollt rückwirkend Aufforderungen für alle bereits Eingeteilten aus.';
COMMENT ON VIEW public.v_offene_unterschriften IS
  'Offene Unterschriften pro Polier/Bauleiter. Mehrere Zeilen pro Unterschrift (eine pro Verantwortlichem).';
