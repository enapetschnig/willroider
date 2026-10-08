-- =====================================================================
-- Fahrtgeld in Stunden statt in Euro.
--
-- Änderungswunsch B. Sirnitzer 07.10.: „Hier darf man nur Fahrtgeld
-- auswählen dürfen. Kein Taggeld. Das wird ja automatisch über die Stunden
-- abgewickelt. Keine Geldangaben. Unter der Fahrtgeld-Auswahl muss dann
-- noch 0,5 Std, 1,0 Std und 1,5 Std auswählbar sein."
--
-- Entscheidung Christoph: Die Stunden werden nur vermerkt (Stundenzettel,
-- Baustellenstundenbericht, Auswertung) und vom Lohnbüro abgerechnet. Sie
-- zählen NICHT zu den Arbeitsstunden (Soll/Ist/Überstunden).
--
-- fahrtgeld_eur bleibt stehen, wird aber nicht mehr befüllt (war in allen
-- 230 Zeilen 0 und wurde nirgends ausgegeben).
-- =====================================================================

ALTER TABLE public.stunden_fahrt
  ADD COLUMN IF NOT EXISTS fahrtgeld_stunden NUMERIC(3,1) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.stunden_fahrt
    ADD CONSTRAINT stunden_fahrt_fahrtgeld_stunden_check
    CHECK (fahrtgeld_stunden >= 0 AND fahrtgeld_stunden <= 8);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.stunden_fahrt.fahrtgeld_stunden IS
  'Fahrtgeld des Poliers in Stunden (0 / 0,5 / 1,0 / 1,5). Wird nur vermerkt, zählt nicht zu den Arbeitsstunden.';
