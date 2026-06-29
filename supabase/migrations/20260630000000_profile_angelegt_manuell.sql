-- =====================================================================
-- profiles.angelegt_manuell: True wenn der MA via admin-create-employee
-- angelegt wurde (Flag aus auth.users.raw_user_meta_data->>'admin_created').
--
-- Hintergrund: „Zugang per SMS verschicken" darf nur für manuell
-- angelegte MA möglich sein. Selbst-registrierte User behalten ihren
-- bestehenden Login unangetastet.
--
-- Idempotent.
-- =====================================================================

-- 1) Spalte hinzufügen
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS angelegt_manuell BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.angelegt_manuell IS
  'TRUE wenn das Profil via admin-create-employee angelegt wurde. Steuert Sichtbarkeit der „Zugang per SMS"-Aktion. Selbst-registrierte MA = FALSE.';

-- 2) Backfill: bestehende MA aus auth.users.raw_user_meta_data.admin_created
UPDATE public.profiles p
   SET angelegt_manuell = TRUE
  FROM auth.users u
 WHERE u.id = p.id
   AND (u.raw_user_meta_data->>'admin_created')::boolean IS TRUE
   AND p.angelegt_manuell = FALSE;

-- 3) handle_new_user erweitern: Flag aus user_metadata übernehmen
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wvf UUID;
BEGIN
  SELECT id INTO v_wvf FROM public.partien WHERE name = 'Werkvorfertigung' LIMIT 1;
  INSERT INTO public.profiles (id, vorname, nachname, email, is_active, partie_id, angelegt_manuell)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    NEW.email,
    FALSE,
    v_wvf,
    COALESCE((NEW.raw_user_meta_data->>'admin_created')::boolean, FALSE)
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'mitarbeiter');
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
