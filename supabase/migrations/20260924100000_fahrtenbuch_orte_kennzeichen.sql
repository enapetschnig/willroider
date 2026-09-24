-- =====================================================================
-- Fahrtenbuch: Kennzeichen je Fahrt + Abfahrts-/Ankunftsort.
--
-- Änderungswunsch J. Mainhard 24.09.: „Fahrtenbuch Eingabe Kennzeichen,
-- Abfahrt - Ankunft über google maps". Umgesetzt ohne Google:
--   - kennzeichen  — je Fahrt (wechselnde Firmenautos). Leer = es gilt das
--                    Standard-Kennzeichen aus profiles.fahrtenbuch_kennzeichen.
--   - abfahrt_ort / ankunft_ort — Orte mit Adressvorschlägen (Firma,
--                    Baustellen, frühere Orte, OpenStreetMap-Suche).
--                    Die Spalten abfahrt/ankunft bleiben die Uhrzeiten.
--
-- Alles freiwillig und nur additiv: bestehende Fahrten werden nicht
-- angefasst, Rechte (RLS) bleiben gleich. Die Periodensperre
-- (tb_sperre_fahrtenbuch) gilt zeilenweise und damit auch für die neuen
-- Felder. Die km bleiben reine Tacho-Werte — es wird nichts berechnet.
-- =====================================================================

ALTER TABLE public.fahrtenbuch_eintraege
  ADD COLUMN IF NOT EXISTS kennzeichen TEXT,
  ADD COLUMN IF NOT EXISTS abfahrt_ort TEXT,
  ADD COLUMN IF NOT EXISTS ankunft_ort TEXT;

COMMENT ON COLUMN public.fahrtenbuch_eintraege.kennzeichen IS
  'Kennzeichen des Fahrzeugs dieser Fahrt. Leer = Standard-Kennzeichen der Person (profiles.fahrtenbuch_kennzeichen).';
COMMENT ON COLUMN public.fahrtenbuch_eintraege.abfahrt_ort IS
  'Abfahrtsort (Adresse). Die Uhrzeit steht weiter in abfahrt.';
COMMENT ON COLUMN public.fahrtenbuch_eintraege.ankunft_ort IS
  'Ankunftsort (Adresse). Die Uhrzeit steht weiter in ankunft.';

NOTIFY pgrst, 'reload schema';
