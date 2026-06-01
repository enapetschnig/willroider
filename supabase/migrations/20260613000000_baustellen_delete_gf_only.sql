-- Baustellen löschen darf nur die Geschäftsführung.
-- Bisher: baustellen_modify_admin = FOR ALL, umfasste auch DELETE für
-- Bauleiter und Büro. Wir splitten die Policy: INSERT + UPDATE bleiben für
-- alle Admin-Rollen offen, DELETE wird auf role='geschaeftsfuehrung'
-- eingeschränkt.

DROP POLICY IF EXISTS "baustellen_modify_admin" ON public.baustellen;

CREATE POLICY "baustellen_insert_admin" ON public.baustellen
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_role(auth.uid()));

CREATE POLICY "baustellen_update_admin" ON public.baustellen
  FOR UPDATE TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

CREATE POLICY "baustellen_delete_gf_only" ON public.baustellen
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'geschaeftsfuehrung'
    )
  );

COMMENT ON POLICY "baustellen_delete_gf_only" ON public.baustellen IS
  'Eine Baustelle endgültig zu löschen ist eine zerstörende Aktion (kaskadiert auf Berichte/Stunden/Einteilungen). Daher nur Geschäftsführung.';
