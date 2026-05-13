-- Fahrzeug-Stammdaten: Inventar-Nr + Kategorie (anlage/baustelle/bauleiter)
-- + Standard-Fahrer + Seed der 21 Fahrzeuge.

ALTER TABLE public.fahrzeuge
  ADD COLUMN IF NOT EXISTS inventar_nr TEXT,
  ADD COLUMN IF NOT EXISTS kategorie TEXT NOT NULL DEFAULT 'baustelle',
  ADD COLUMN IF NOT EXISTS standard_fahrer_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS standard_fahrer_notiz TEXT;

COMMENT ON COLUMN public.fahrzeuge.kategorie IS
  'anlage = Werkstatt-Maschine/Stapler (nicht zur Baustelle) · baustelle = Transporter/LKW/Anhänger · bauleiter = fest einem Bauleiter zugeordnetes PKW.';

CREATE INDEX IF NOT EXISTS idx_fahrzeuge_kategorie
  ON public.fahrzeuge(kategorie) WHERE aktiv = true;
CREATE INDEX IF NOT EXISTS idx_fahrzeuge_standard_fahrer
  ON public.fahrzeuge(standard_fahrer_id);

DO $$ BEGIN
  ALTER TABLE public.fahrzeuge
    ADD CONSTRAINT fahrzeuge_inventar_nr_key UNIQUE (inventar_nr);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN others THEN NULL;
END $$;

-- Kennzeichen darf bei Anlagen NULL sein (DB-Spalte ist NOT NULL aktuell?)
-- Falls ja: vor dem Seed temporär lockern.
DO $$ BEGIN
  ALTER TABLE public.fahrzeuge ALTER COLUMN kennzeichen DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- Eindeutige Sentinel-Kennzeichen für Anlagen (statt NULL — kennzeichen ist
-- ggf. UNIQUE; wir nutzen die Inventar-Nr als Fallback-Kennzeichen).
INSERT INTO public.fahrzeuge
  (inventar_nr, kennzeichen, typ, bezeichnung, kategorie,
   standard_fahrer_notiz, aktiv)
VALUES
  -- Anlagen
  ('140 4755', 'ANL-140-4755', 'anlage', 'Hundegger K2', 'anlage', NULL, true),
  ('140 4757', 'ANL-140-4757', 'anlage', 'SC4 Hundegger', 'anlage', NULL, true),
  ('140 4762', 'ANL-140-4762', 'anlage', 'Hacker Untha', 'anlage', NULL, true),
  ('140 4765', 'ANL-140-4765', 'anlage', 'Elementierung Weinmann', 'anlage', NULL, true),
  ('140 4767', 'ANL-140-4767', 'anlage', 'Isocell', 'anlage', NULL, true),
  ('140 4821', 'ANL-140-4821', 'stapler', 'E-Stapler', 'anlage', NULL, true),
  ('140 4822', 'ANL-140-4822', 'stapler', 'Stapler Linde', 'anlage', NULL, true),
  -- Baustellen-Fahrzeuge
  ('140 4810', 'VI 418 DS', 'kastenwagen', 'Sprinter Mercedes', 'baustelle', 'Hinteregger', true),
  ('140 4811', 'VI 481 DB', 'kastenwagen', 'Ford Transit', 'baustelle', 'Springer Auto (extern)', true),
  ('140 4812', 'VI 148 EW', 'doppelkabiner', 'Doppelkabiner VW', 'baustelle', 'Tripold', true),
  ('140 4814', 'VI 278 CB', 'kastenwagen', 'Sprinter Mercedes', 'baustelle', 'Gruber CH', true),
  ('140 4815', 'VI 502 FI', 'kastenwagen', 'Sprinter Mercedes', 'baustelle', 'Sandner', true),
  ('140 4816', 'VI 611 FC', 'kastenwagen', 'Sprinter Mercedes', 'baustelle', 'Köfeler', true),
  ('140 4818', 'VI 269 FY', 'kastenwagen', 'Sprinter Mercedes', 'baustelle', 'Tauchhammer', true),
  ('140 4820', 'VI 767 FA', 'kastenwagen', 'Sprinter Mercedes', 'baustelle', 'Hallegger', true),
  ('140 4851', 'VI 279 DF', 'anhaenger', 'Anhänger Zimmerei', 'baustelle', 'Alle', true),
  ('140 4852', 'VI 140 EA', 'anhaenger', 'Anhänger Zimmerei', 'baustelle', 'Alle', true),
  -- Bauleiter-Fahrzeuge
  ('140 4813', 'VI 494 FP', 'pkw', 'VW Caddy', 'bauleiter', 'Gwenger', true),
  ('140 4817', 'VI 881 EN', 'lkw', 'LKW ISUZU', 'bauleiter', 'Gruber Hans', true),
  ('140 4819', 'VI 843 FD', 'pkw', 'VW Caddy', 'bauleiter', 'Lampersberger', true),
  ('140 4849', 'VI 147 FU', 'pkw', 'BMW X1 Elektro', 'bauleiter', 'Pließnig', true)
ON CONFLICT (inventar_nr) DO UPDATE SET
  kennzeichen = EXCLUDED.kennzeichen,
  typ = EXCLUDED.typ,
  bezeichnung = EXCLUDED.bezeichnung,
  kategorie = EXCLUDED.kategorie,
  standard_fahrer_notiz = EXCLUDED.standard_fahrer_notiz,
  aktiv = EXCLUDED.aktiv;
