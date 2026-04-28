-- Admin-only RPC: User komplett löschen.
-- Cascade über auth.users → profiles → user_roles → stundenbuchungen → einteilungen etc.
-- (alle FKs zu profiles haben ON DELETE CASCADE)

CREATE OR REPLACE FUNCTION public.admin_delete_user(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nur Admin (Geschäftsführung) darf
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  -- Niemals sich selbst löschen
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot delete own account' USING ERRCODE = '22023';
  END IF;

  -- Auth-User entfernen → kaskadiert auf profiles, user_roles und alle abhängigen Daten
  DELETE FROM auth.users WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_user(UUID) IS
  'Löscht einen User komplett (auth + profile + alle abhängigen Buchungen). Nur Admin.';
