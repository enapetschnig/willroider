-- J. Maurer, 20.11.2026 (Stundenberichte, Erschwerniszulage-Zettel Tripolt KW 47):
-- „dann übernimmt er auch das x was alles verfällscht“
--
-- Eine Zulage ohne Stunden wurde im BSB/Zettel als „x“ gedruckt und zählte 0 h. Seit 20261120100000 füllt die DB
-- fehlende Stunden mit den Arbeitsstunden des Tages. Blieb danach trotzdem nichts (Tag nur Schlechtwetter/Urlaub,
-- oder ausdrücklich 0 h), entstand weiter eine Zulage ohne Stunden. Ab jetzt wird so eine Zulage gar nicht
-- gespeichert (die App filtert sie schon vorher heraus; das hier ist das Netz).
-- Der Trigger heißt jetzt „…_0_…“, damit er vor dem Schmutz/Abbruch-Ausschluss läuft — sonst würde der die
-- andere Zulage des Tages löschen, obwohl die neue danach gar nicht gespeichert wird.
-- Bestand: 0 Zulagen ohne Stunden bzw. mit 0 h (geprüft 20.11.2026) → keine Datenänderung.

CREATE OR REPLACE FUNCTION public.stunden_zulagen_stunden_fuellen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_h NUMERIC;
BEGIN
  IF NEW.stunden IS NULL THEN
    SELECT SUM(tt.stunden) INTO v_h
      FROM public.stunden_taetigkeiten tt
     WHERE tt.stunden_tag_id = NEW.stunden_tag_id
       AND tt.art IN ('baustelle', 'firma');
    IF COALESCE(v_h, 0) > 0 THEN
      NEW.stunden := v_h;
    END IF;
  END IF;
  -- nie eine Zulage ohne Stunden („x“) speichern
  IF COALESCE(NEW.stunden, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stunden_zulagen_stunden_fuellen ON public.stunden_zulagen;
DROP TRIGGER IF EXISTS trg_stunden_zulagen_0_stunden_fuellen ON public.stunden_zulagen;
CREATE TRIGGER trg_stunden_zulagen_0_stunden_fuellen
  BEFORE INSERT OR UPDATE OF stunden ON public.stunden_zulagen
  FOR EACH ROW EXECUTE FUNCTION public.stunden_zulagen_stunden_fuellen();
