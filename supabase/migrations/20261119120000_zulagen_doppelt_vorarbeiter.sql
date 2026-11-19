-- Zulagen (J. Maurer, 19.11.2026)
-- 1) „Für dieselbe Tätigkeit nur eine Zulage“: Schmutzzulage (10 %, z. B. Abbruch
--    Dippelbaum-/Tramdecke samt Beschüttung) und Abbruchzulage (15 %, echter
--    Rückbau) dürfen nicht für dieselben Stunden gelten. Zulagen mit derselben
--    ausschluss_gruppe zusammen höchstens so viele Stunden wie die Arbeitszeit
--    des Tages; geprüft in der App vor dem Speichern (lib/zulagen.ts).
-- 2) Vorarbeiterzulage: nur für ausdrücklich zugeteilte Mitarbeiter
--    (nur_zugeteilt). Zählt nicht als „bewusste Zuteilung“ für die übrigen
--    Zulagen (keine Zuteilung = alle normalen Zulagen bleibt).

ALTER TABLE public.zulagen_typen
  ADD COLUMN IF NOT EXISTS ausschluss_gruppe text,
  ADD COLUMN IF NOT EXISTS nur_zugeteilt boolean NOT NULL DEFAULT false;

UPDATE public.zulagen_typen
   SET ausschluss_gruppe = 'schmutz_abbruch'
 WHERE bezeichnung IN ('Schmutzzulage', 'Abbruchzulage')
   AND ausschluss_gruppe IS DISTINCT FROM 'schmutz_abbruch';

INSERT INTO public.zulagen_typen (bezeichnung, sort_order, is_active, ermoeglicht_stunden_split, nur_zugeteilt)
SELECT 'Vorarbeiterzulage', 25, true, true, true
WHERE NOT EXISTS (SELECT 1 FROM public.zulagen_typen WHERE bezeichnung = 'Vorarbeiterzulage');

-- Sicherheitsnetz für ältere, noch nicht aktualisierte App-Stände: Zulagen
-- „nur für Zugeteilte“ bei nicht zugeteilten Personen still weglassen (nicht
-- ablehnen — das Speichern ist nicht transaktional und darf nicht mitten
-- drin abbrechen).
CREATE OR REPLACE FUNCTION public.stunden_zulagen_nur_zugeteilt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.zulagen_typen z
              WHERE z.id = NEW.zulagen_typ_id AND z.nur_zugeteilt)
     AND NOT EXISTS (
       SELECT 1
         FROM public.stunden_tage t
         JOIN public.mitarbeiter_zulagen mz
           ON mz.mitarbeiter_id = t.mitarbeiter_id
          AND mz.zulagen_typ_id = NEW.zulagen_typ_id
        WHERE t.id = NEW.stunden_tag_id)
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stunden_zulagen_nur_zugeteilt ON public.stunden_zulagen;
CREATE TRIGGER trg_stunden_zulagen_nur_zugeteilt
  BEFORE INSERT ON public.stunden_zulagen
  FOR EACH ROW EXECUTE FUNCTION public.stunden_zulagen_nur_zugeteilt();
