-- ============================================================================
-- „Werkvorfertigung" wird die Standard-Partie. Mitarbeiter ohne Partie landen
-- dort; das „Lager"-Konzept (partie_id IS NULL) entfaellt. Idempotent.
-- ============================================================================

-- 1) Bestehende Partie auf den gewuenschten Namen vereinheitlichen
UPDATE public.partien SET name = 'Werkvorfertigung'
WHERE name IN ('Werk/Vorfertigung', 'Werkvorfertigung');

-- 2) Falls keine existiert: anlegen
INSERT INTO public.partien (name, farbcode)
SELECT 'Werkvorfertigung', '#8b5cf6'
WHERE NOT EXISTS (SELECT 1 FROM public.partien WHERE name = 'Werkvorfertigung');

-- 3) Alle aktiven MA ohne Partie → Werkvorfertigung
UPDATE public.profiles
SET partie_id = (SELECT id FROM public.partien WHERE name = 'Werkvorfertigung' LIMIT 1)
WHERE partie_id IS NULL AND is_active = true;

-- 4) handle_new_user: neue MA bekommen Werkvorfertigung als Standard-Partie
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_wvf UUID;
BEGIN
  SELECT id INTO v_wvf FROM public.partien WHERE name = 'Werkvorfertigung' LIMIT 1;
  INSERT INTO public.profiles (id, vorname, nachname, email, is_active, partie_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'vorname', ''),
    COALESCE(NEW.raw_user_meta_data->>'nachname', ''),
    NEW.email,
    FALSE,
    v_wvf
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'mitarbeiter');
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
