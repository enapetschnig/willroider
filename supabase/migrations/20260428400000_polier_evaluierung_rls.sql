-- Polier (Partieleiter) darf Evaluierungen für eigene Partie-Baustellen erstellen/bearbeiten
CREATE OR REPLACE FUNCTION public.is_partieleiter_of_baustelle(_user_id UUID, _baustelle_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.baustellen b
    JOIN public.partien p ON p.id = b.partie_id
    WHERE b.id = _baustelle_id AND p.partieleiter_id = _user_id
  );
$$;

DROP POLICY IF EXISTS "evaluierungen_modify" ON public.evaluierungen;
CREATE POLICY "evaluierungen_modify" ON public.evaluierungen FOR ALL TO authenticated
  USING (
    public.can_review(auth.uid())
    OR public.is_partieleiter_of_baustelle(auth.uid(), baustelle_id)
  )
  WITH CHECK (
    public.can_review(auth.uid())
    OR public.is_partieleiter_of_baustelle(auth.uid(), baustelle_id)
  );

DROP POLICY IF EXISTS "evaluierung_unt_modify" ON public.evaluierung_unterschriften;
CREATE POLICY "evaluierung_unt_modify" ON public.evaluierung_unterschriften FOR ALL TO authenticated
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
