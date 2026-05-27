-- Halle/Werkstatt-Zeiterfassung: Maschinen als Baustellen-Kategorie.
-- baustellen bekommt eine `kategorie`-Spalte (baustelle | maschine). Die 6
-- Maschinen werden als baustellen-Zeilen mit kategorie='maschine' geseedet —
-- damit nutzen wir die gesamte bestehende Pipeline (Combobox, BSB, CSV,
-- Aggregationen) ohne weitere Tabelle.

ALTER TABLE public.baustellen
  ADD COLUMN IF NOT EXISTS kategorie TEXT NOT NULL DEFAULT 'baustelle'
  CHECK (kategorie IN ('baustelle','maschine'));

COMMENT ON COLUMN public.baustellen.kategorie IS
  'Trennt Kunden-Baustellen (baustelle) von internen Maschinen/Anlagen '
  '(maschine, z.B. Hundegger K2). Halle-Erfassung filtert auf maschine; '
  '/stunden filtert auf baustelle.';

-- Maschinen-Stamm seeden (ON CONFLICT auf kostenstelle, das ist UNIQUE)
INSERT INTO public.baustellen (bvh_name, kostenstelle, status, kategorie)
VALUES
  ('Hundegger K2',          '140-4755', 'aktiv', 'maschine'),
  ('Hundegger K2',          '140-4756', 'aktiv', 'maschine'),
  ('SC4 Hundegger',         '140-4757', 'aktiv', 'maschine'),
  ('Hacker Untha',          '140-4762', 'aktiv', 'maschine'),
  ('Elementierung Weinmann','140-4765', 'aktiv', 'maschine'),
  ('Isocell',               '140-4767', 'aktiv', 'maschine')
ON CONFLICT (kostenstelle) DO NOTHING;

NOTIFY pgrst, 'reload schema';
