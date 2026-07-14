-- =====================================================================
-- profiles.ist_bauleiter: markiert Bauleiter. Nur diese erscheinen im
-- Baustellen-Formular im Dropdown "Verantwortlicher Bauleiter".
-- Backfill: alle mit gesetzter Planungsfarbe (= die etablierten
-- Bauleiter Maurer, Egger S., Egger E., Gwenger, Pließnig, Winkler).
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ist_bauleiter BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.profiles
   SET ist_bauleiter = TRUE
 WHERE planungsfarbe IS NOT NULL;

-- Zusätzlich: alle Profile, die bereits an einer Baustelle als Bauleiter
-- hinterlegt sind, ebenfalls markieren (falls ohne Planungsfarbe).
UPDATE public.profiles p
   SET ist_bauleiter = TRUE
 WHERE EXISTS (SELECT 1 FROM public.baustellen b WHERE b.bauleiter_id = p.id)
   AND p.ist_bauleiter = FALSE;

NOTIFY pgrst, 'reload schema';
