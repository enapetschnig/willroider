-- Storage policies for buckets
DROP POLICY IF EXISTS "dokumente_select" ON storage.objects;
DROP POLICY IF EXISTS "dokumente_insert" ON storage.objects;
DROP POLICY IF EXISTS "dokumente_update" ON storage.objects;
DROP POLICY IF EXISTS "dokumente_delete" ON storage.objects;

CREATE POLICY "dokumente_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('dokumente','baustellen','unterschriften'));

CREATE POLICY "dokumente_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('dokumente','baustellen','unterschriften'));

CREATE POLICY "dokumente_update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('dokumente','baustellen','unterschriften'))
WITH CHECK (bucket_id IN ('dokumente','baustellen','unterschriften'));

CREATE POLICY "dokumente_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('dokumente','baustellen','unterschriften'));

-- Seed data: Partien with the typical Holzbau colors
INSERT INTO public.partien (name, farbcode, beschreibung) VALUES
  ('Partie 1', '#3b82f6', 'Hauptpartie'),
  ('Partie 2', '#ef4444', 'Zweite Partie'),
  ('Partie 3', '#10b981', 'Dritte Partie'),
  ('Partie 4', '#f59e0b', 'Vierte Partie'),
  ('Werk/Vorfertigung', '#8b5cf6', 'Vorfertigung im Werk'),
  ('Bauhof', '#6b7280', 'Bauhof / Logistik')
ON CONFLICT (name) DO NOTHING;

-- Seed Fahrzeuge
INSERT INTO public.fahrzeuge (kennzeichen, typ, bezeichnung, kapazitaet, hat_anhaenger) VALUES
  ('VL-W 1', 'LKW', 'MAN TGL', 7, TRUE),
  ('VL-W 2', 'Pritsche', 'Mercedes Sprinter', 5, FALSE),
  ('VL-W 3', 'Bus', 'VW Crafter', 9, FALSE),
  ('VL-W 4', 'Pritsche', 'Iveco Daily', 6, TRUE)
ON CONFLICT (kennzeichen) DO NOTHING;

-- Seed Arbeitszeitkalender for current and next year (KW 1-52, default Long week 38.5h)
DO $$
DECLARE
  y INTEGER;
  k INTEGER;
BEGIN
  FOR y IN 2026..2027 LOOP
    FOR k IN 1..52 LOOP
      INSERT INTO public.arbeitszeitkalender (jahr, kw, wochentyp, soll_stunden)
      VALUES (y, k,
        CASE WHEN k % 2 = 0 THEN 'L'::wochentyp ELSE 'K'::wochentyp END,
        CASE WHEN k % 2 = 0 THEN 38.5 ELSE 36.0 END
      ) ON CONFLICT (jahr, kw) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
