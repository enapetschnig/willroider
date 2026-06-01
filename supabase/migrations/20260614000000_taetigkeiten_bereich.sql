-- Tätigkeiten-Stammdaten nach Bereich trennen.
-- Bisher: eine flache Liste, alle Tätigkeiten für jede Erfassung gleich.
-- Neu: jede Tätigkeit gehört entweder zur Baustelle, zur Halle/Werkstatt,
-- oder zu beiden. Damit zeigt /halle nur Halle-typische Tätigkeiten
-- (Riegelwerk, OSB Montage, Lagerverwaltung, …) und /stunden nur
-- Baustellen-Tätigkeiten (Montage, Dachstuhl, Fassade, …).

ALTER TABLE public.taetigkeiten_stamm
  ADD COLUMN IF NOT EXISTS bereich TEXT NOT NULL DEFAULT 'baustelle'
    CHECK (bereich IN ('baustelle','halle','beide'));

CREATE INDEX IF NOT EXISTS idx_taetigkeiten_bereich
  ON public.taetigkeiten_stamm(bereich, is_active);

-- ────────────────────────────────────────────────────────────────────────
-- Halle/Werkstatt-Tätigkeiten (vom User vorgegebene Liste)
-- Ersetzt die bisherige Mischlisten-Verwendung in /halle.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO public.taetigkeiten_stamm(bezeichnung, sort_order, bereich) VALUES
  ('Riegelwerk',                    10, 'halle'),
  ('Dämmen',                        20, 'halle'),
  ('OSB Montage',                   30, 'halle'),
  ('Agepan Montage',                40, 'halle'),
  ('Holzweichfaser Montage',        50, 'halle'),
  ('Gips Montage',                  60, 'halle'),
  ('Abbund Dach',                   70, 'halle'),
  ('Abbund Riegel',                 80, 'halle'),
  ('Reparatur bzw. Service',        90, 'halle'),
  ('Verladen',                     100, 'halle'),
  ('Streichen',                    110, 'halle'),
  ('Lagerverwaltung',              120, 'halle'),
  ('Zusammenräumen',               130, 'halle')
ON CONFLICT (bezeichnung)
  DO UPDATE SET bereich = EXCLUDED.bereich,
                sort_order = EXCLUDED.sort_order,
                is_active = TRUE;

-- ────────────────────────────────────────────────────────────────────────
-- Zusätzliche Baustellen-Tätigkeiten (vom User vorgegeben).
-- Die bestehenden Baustellen-Tätigkeiten (Dachstuhl aufstellen, Holzbau
-- aufstellen, …) bleiben unverändert mit bereich='baustelle' (Default).
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO public.taetigkeiten_stamm(bezeichnung, sort_order, bereich) VALUES
  ('Montage',                        5, 'baustelle'),
  ('Dachstuhl',                     15, 'baustelle'),
  ('Wände',                         25, 'baustelle'),
  ('Kaltdach',                      45, 'baustelle'),
  ('Terrassenboden',                55, 'baustelle'),
  ('Carport',                       65, 'baustelle'),
  ('Abbruch',                       75, 'baustelle')
ON CONFLICT (bezeichnung)
  DO UPDATE SET bereich = EXCLUDED.bereich,
                is_active = TRUE;
-- 'Fassade' existiert schon und ist baustelle — kein Konflikt nötig.

COMMENT ON COLUMN public.taetigkeiten_stamm.bereich IS
  'Wo wird diese Tätigkeit erfasst: baustelle (in /stunden), halle (in /halle) oder beide.';
