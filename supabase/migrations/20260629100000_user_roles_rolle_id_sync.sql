-- =====================================================================
-- user_roles.rolle_id zwangssyncen mit user_roles.role.
--
-- Bug: handle_new_user und admin-create-employee setzen nur die alte
-- ENUM-Spalte `role`. Dadurch bleibt `rolle_id` NULL → has_permission()
-- liefert FALSE → frisch registrierte User sehen eine leere App.
--
-- Fix:
-- 1) Backfill für bestehende User-Roles.
-- 2) handle_new_user setzt jetzt auch rolle_id mit.
-- 3) trg_sync_user_role_enum wird bidirektional: rolle_id aus role
--    ableiten, wenn role gesetzt aber rolle_id NULL ist. Damit greift
--    der Fix auch für jeden Aufrufer der wider Erwarten nur role setzt.
-- =====================================================================

-- 1) Backfill
UPDATE public.user_roles ur
   SET rolle_id = r.id
  FROM public.rollen r
 WHERE r.legacy_enum = ur.role
   AND ur.rolle_id IS NULL;

-- 2) handle_new_user: rolle_id mit setzen
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wvf UUID;
  v_mitarbeiter_rolle_id UUID;
BEGIN
  SELECT id INTO v_wvf FROM public.partien WHERE name = 'Werkvorfertigung' LIMIT 1;
  SELECT id INTO v_mitarbeiter_rolle_id FROM public.rollen WHERE schluessel = 'mitarbeiter' LIMIT 1;

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

  INSERT INTO public.user_roles (user_id, role, rolle_id)
  VALUES (NEW.id, 'mitarbeiter', v_mitarbeiter_rolle_id);

  RETURN NEW;
END;
$$;

-- 3) Sync-Trigger bidirektional: wenn role gesetzt aber rolle_id NULL,
--    aus rollen.legacy_enum nachfüllen. Damit ist der Permission-Lookup
--    immer konsistent, egal welcher Codepfad ge-INSERTet hat.
CREATE OR REPLACE FUNCTION public.fn_sync_user_role_enum()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Richtung 1 (bestehend): rolle_id geändert → role-ENUM aus rollen.legacy_enum
  IF NEW.rolle_id IS NOT NULL THEN
    SELECT COALESCE(r.legacy_enum, 'mitarbeiter') INTO NEW.role
      FROM public.rollen r
     WHERE r.id = NEW.rolle_id;
    RETURN NEW;
  END IF;

  -- Richtung 2 (neu): rolle_id leer, aber role-ENUM gesetzt → rolle_id auffüllen
  IF NEW.rolle_id IS NULL AND NEW.role IS NOT NULL THEN
    SELECT id INTO NEW.rolle_id
      FROM public.rollen
     WHERE legacy_enum = NEW.role
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger ggfs. neu binden (BEFORE INSERT OR UPDATE läuft schon laut Phase 1)
DROP TRIGGER IF EXISTS trg_sync_user_role_enum ON public.user_roles;
CREATE TRIGGER trg_sync_user_role_enum
  BEFORE INSERT OR UPDATE OF rolle_id, role ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_user_role_enum();

NOTIFY pgrst, 'reload schema';
