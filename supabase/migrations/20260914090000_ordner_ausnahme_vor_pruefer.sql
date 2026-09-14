-- darf_ordner_sehen: Die Ausnahme je Person gilt VOR der Prüfer-Abkürzung.
-- can_review umfasst Bauleiter — vorher konnte man einem Bauleiter zwar in
-- der Oberfläche Ordner wegnehmen, die Datenbank gab sie trotzdem her.
-- Büro/Geschäftsführung (is_admin_role) sehen immer alles.
CREATE OR REPLACE FUNCTION public.darf_ordner_sehen(_user uuid, _ordner text, _subpath text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_liste text[];
  v_rolle text;
  v_pruefer boolean := false;
BEGIN
  IF _user IS NULL OR _ordner IS NULL THEN RETURN false; END IF;
  IF public.is_admin_role(_user) THEN RETURN true; END IF;

  SELECT p.ordner_sichtbar INTO v_liste FROM public.profiles p WHERE p.id = _user;
  IF v_liste IS NULL THEN
    -- keine Ausnahme: Prüfer (Bauleiter, Zimmermeister …) sehen alles,
    -- sonst der Rollenstandard aus app_settings
    IF public.can_review(_user) THEN RETURN true; END IF;
    SELECT r.schluessel INTO v_rolle
      FROM public.user_roles ur JOIN public.rollen r ON r.id = ur.rolle_id
     WHERE ur.user_id = _user LIMIT 1;
    SELECT ARRAY(SELECT jsonb_array_elements_text((s.value::jsonb)->COALESCE(v_rolle, 'mitarbeiter')))
      INTO v_liste
      FROM public.app_settings s WHERE s.key = 'ordner_visibility';
    IF v_liste IS NULL OR array_length(v_liste, 1) IS NULL THEN
      v_liste := ARRAY['91-plaene','2-schriftverkehr','evaluierung','95-leistungsverzeichnis','fotos'];
    END IF;
  ELSE
    v_pruefer := public.can_review(_user);
  END IF;
  IF NOT (_ordner = ANY (v_liste)) THEN RETURN false; END IF;

  -- „Berichte" für Nicht-Prüfer: im Schriftverkehr nur die Berichts-PDFs
  IF _ordner = '2-schriftverkehr' AND NOT v_pruefer THEN
    RETURN _subpath IS NOT NULL
       AND (_subpath = 'tagesberichte' OR _subpath LIKE 'tagesberichte/%'
            OR _subpath = 'regieberichte' OR _subpath LIKE 'regieberichte/%');
  END IF;
  RETURN true;
END $$;
