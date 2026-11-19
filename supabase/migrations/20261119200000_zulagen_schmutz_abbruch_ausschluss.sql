-- Schmutz- ODER Abbruchzulage je Tag, nie beide (J. Maurer, 19.11.2026;
-- Christoph: „nicht mehr beide gleichzeitig auswählbar – Auswahl des einen
-- nimmt das andere weg, auch serverseitig/DB absichern“).
--
-- Die App lässt nur noch eine wählen. Sicherheitsnetz für ältere App-Stände:
-- wird eine Zulage einer ausschluss_gruppe gespeichert, fällt die andere
-- derselben Gruppe am selben Tag weg (die zuletzt gespeicherte gilt). Nicht
-- ablehnen — das Speichern ist nicht transaktional und darf nicht mitten
-- drin abbrechen.
--
-- Altfälle: Tage, die heute schon beide haben, bleiben unangetastet, bis
-- der Kunde je Tag entschieden hat (Rückfrage im Änderungswunsch). Sie stehen
-- in zulagen_ausschluss_altfaelle; danach Zeilen dort löschen.

CREATE TABLE IF NOT EXISTS public.zulagen_ausschluss_altfaelle (
  stunden_tag_id uuid PRIMARY KEY REFERENCES public.stunden_tage(id) ON DELETE CASCADE,
  erfasst_am timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zulagen_ausschluss_altfaelle ENABLE ROW LEVEL SECURITY;

INSERT INTO public.zulagen_ausschluss_altfaelle (stunden_tag_id)
SELECT sz.stunden_tag_id
  FROM public.stunden_zulagen sz
  JOIN public.zulagen_typen z ON z.id = sz.zulagen_typ_id
 WHERE z.ausschluss_gruppe IS NOT NULL
 GROUP BY sz.stunden_tag_id, z.ausschluss_gruppe
HAVING count(DISTINCT sz.zulagen_typ_id) > 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.stunden_zulagen_ausschluss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gruppe text;
BEGIN
  SELECT ausschluss_gruppe INTO v_gruppe FROM public.zulagen_typen WHERE id = NEW.zulagen_typ_id;
  IF v_gruppe IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.zulagen_ausschluss_altfaelle a WHERE a.stunden_tag_id = NEW.stunden_tag_id) THEN
    RETURN NEW;
  END IF;
  DELETE FROM public.stunden_zulagen sz
   USING public.zulagen_typen z
   WHERE sz.stunden_tag_id = NEW.stunden_tag_id
     AND sz.id <> NEW.id
     AND z.id = sz.zulagen_typ_id
     AND z.ausschluss_gruppe = v_gruppe
     AND z.id <> NEW.zulagen_typ_id;
  RETURN NEW;
END;
$$;

-- Name sortiert nach trg_stunden_zulagen_nur_zugeteilt → läuft danach
-- (lässt jener die Zeile weg, wird hier nichts gelöscht).
DROP TRIGGER IF EXISTS trg_stunden_zulagen_schmutz_abbruch ON public.stunden_zulagen;
CREATE TRIGGER trg_stunden_zulagen_schmutz_abbruch
  BEFORE INSERT OR UPDATE OF zulagen_typ_id, stunden_tag_id ON public.stunden_zulagen
  FOR EACH ROW EXECUTE FUNCTION public.stunden_zulagen_ausschluss();
