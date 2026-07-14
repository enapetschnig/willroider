-- =====================================================================
-- partien.sort_order: Reihenfolge der Poliere wie im MS-Project-Ausdruck
-- (Poliereinsatz-Ansicht). Ohne Wert = ans Ende, alphabetisch.
-- =====================================================================

ALTER TABLE public.partien
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Reihenfolge laut Vorlage KW28 (Sandner, Gruber CH, Köfeler, …)
UPDATE public.partien SET sort_order = 10 WHERE name = 'Sandner';
UPDATE public.partien SET sort_order = 20 WHERE name = 'Gruber CH';
UPDATE public.partien SET sort_order = 30 WHERE name = 'Köfeler';
UPDATE public.partien SET sort_order = 40 WHERE name = 'Hallegger';
UPDATE public.partien SET sort_order = 50 WHERE name = 'Hinteregger';
UPDATE public.partien SET sort_order = 60 WHERE name = 'Tripold';
UPDATE public.partien SET sort_order = 70 WHERE name = 'Tauchhammer';
UPDATE public.partien SET sort_order = 80 WHERE name IN ('Produktion / Werkstatt', 'Produktion');
UPDATE public.partien SET sort_order = 90 WHERE name = 'Abbund K2';
UPDATE public.partien SET sort_order = 100 WHERE name = 'Flocken';

NOTIFY pgrst, 'reload schema';
