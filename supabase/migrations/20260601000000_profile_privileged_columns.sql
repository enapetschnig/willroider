-- ─── profiles: privilegierte Spalten gegen Self-Service schützen ───────
-- Die Policy profiles_update_self erlaubt jedem Nutzer ein UPDATE auf die
-- EIGENE profiles-Zeile. Postgres-RLS ist zeilen-, nicht spaltenbasiert —
-- dadurch könnte ein Mitarbeiter sich selbst:
--   - is_partieleiter = true  → Polier-Rechte (canCreateBaustelle etc.)
--   - is_active       = true  → Zugang trotz Deaktivierung
--   - partie_id       = ...   → in eine fremde Partie verschieben
-- setzen (Privilege Escalation).
--
-- Dieser BEFORE-UPDATE-Trigger setzt diese Spalten für eingeloggte
-- Nicht-Admins stillschweigend auf den alten Wert zurück. Admin-Edits
-- (auth.uid() ist Admin) und System-/Edge-Function-Zugriffe per
-- service_role (auth.uid() IS NULL) laufen unverändert durch.
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  -- Nur echte, eingeloggte Nicht-Admin-Nutzer werden eingeschränkt.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_role(auth.uid()) THEN
    NEW.is_partieleiter := OLD.is_partieleiter;
    NEW.is_active       := OLD.is_active;
    NEW.partie_id       := OLD.partie_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_profile_privileged ON public.profiles;
CREATE TRIGGER protect_profile_privileged
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_privileged_columns();

COMMENT ON FUNCTION public.protect_profile_privileged_columns IS
  'Verhindert, dass Nicht-Admins privilegierte profiles-Spalten '
  '(is_partieleiter/is_active/partie_id) an der eigenen Zeile ändern.';
