-- Partieleiter darf für Mitarbeiter seiner Partie Stunden anlegen, sehen und ändern
CREATE OR REPLACE FUNCTION public.is_partieleiter_of(_user_id UUID, _target_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles target
    JOIN public.partien p ON p.id = target.partie_id
    WHERE target.id = _target_id
      AND p.partieleiter_id = _user_id
  );
$$;

DROP POLICY IF EXISTS "stunden_select_all" ON public.stundenbuchungen;
CREATE POLICY "stunden_select_all" ON public.stundenbuchungen FOR SELECT TO authenticated
  USING (
    mitarbeiter_id = auth.uid()
    OR public.can_review(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
  );

DROP POLICY IF EXISTS "stunden_insert_self" ON public.stundenbuchungen;
CREATE POLICY "stunden_insert_self" ON public.stundenbuchungen FOR INSERT TO authenticated
  WITH CHECK (
    mitarbeiter_id = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
  );

DROP POLICY IF EXISTS "stunden_update_self_or_admin" ON public.stundenbuchungen;
CREATE POLICY "stunden_update_self_or_admin" ON public.stundenbuchungen FOR UPDATE TO authenticated
  USING (
    mitarbeiter_id = auth.uid()
    OR public.can_review(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
  )
  WITH CHECK (
    mitarbeiter_id = auth.uid()
    OR public.can_review(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
  );
