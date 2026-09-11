-- =====================================================================
-- Rechte je Person (Ausnahmen zur Rolle), Ordner-Sichtbarkeit serverseitig,
-- OneDrive-Link je Baustelle. Rollout 1. Oktober, Punkte 2 + 3.
-- =====================================================================

-- ─── Ausnahmen je Person ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_berechtigungen (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  berechtigung_id uuid NOT NULL REFERENCES public.berechtigungen(id) ON DELETE CASCADE,
  erlaubt boolean NOT NULL,                 -- true = zusätzlich erlaubt, false = trotz Rolle verboten
  geaendert_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  geaendert_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, berechtigung_id)
);
ALTER TABLE public.user_berechtigungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_berechtigungen FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_berechtigungen TO authenticated;
DROP POLICY IF EXISTS ub_select ON public.user_berechtigungen;
CREATE POLICY ub_select ON public.user_berechtigungen FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin_role(auth.uid()));
DROP POLICY IF EXISTS ub_write ON public.user_berechtigungen;
CREATE POLICY ub_write ON public.user_berechtigungen FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'system.manage_permissions'))
  WITH CHECK (public.has_permission(auth.uid(), 'system.manage_permissions'));

-- Ausnahme schlägt Rolle: ausdrücklich erlaubt/verboten gewinnt.
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _schluessel text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT ub.erlaubt
       FROM public.user_berechtigungen ub
       JOIN public.berechtigungen b ON b.id = ub.berechtigung_id
      WHERE ub.user_id = _user_id AND b.schluessel = _schluessel),
    EXISTS (
      SELECT 1
        FROM public.user_roles ur
        JOIN public.rollen_berechtigungen rb ON rb.rolle_id = ur.rolle_id
        JOIN public.berechtigungen b ON b.id = rb.berechtigung_id
       WHERE ur.user_id = _user_id AND b.schluessel = _schluessel
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT b.schluessel
    FROM public.berechtigungen b
   WHERE COALESCE(
     (SELECT ub.erlaubt FROM public.user_berechtigungen ub
       WHERE ub.user_id = auth.uid() AND ub.berechtigung_id = b.id),
     EXISTS (SELECT 1 FROM public.user_roles ur
              JOIN public.rollen_berechtigungen rb ON rb.rolle_id = ur.rolle_id
             WHERE ur.user_id = auth.uid() AND rb.berechtigung_id = b.id)
   );
$$;

-- ─── Ordner-Sichtbarkeit: je Person überschreibbar, serverseitig geprüft ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ordner_sichtbar text[];
COMMENT ON COLUMN public.profiles.ordner_sichtbar IS
  'Ausnahme zur Rolle: welche Baustellen-Ordner diese Person sieht. NULL = Standard der Rolle (app_settings.ordner_visibility).';

-- Mitarbeiter-Standard: Pläne, Berichte (Unterordner in 2-schriftverkehr),
-- Unterweisung, Leistungsverzeichnis, Fotos — laut Rollout-Anforderung.
UPDATE public.app_settings
   SET value = jsonb_set(value::jsonb, '{mitarbeiter}',
        '["91-plaene","2-schriftverkehr","evaluierung","95-leistungsverzeichnis","fotos"]'::jsonb)::json
 WHERE key = 'ordner_visibility';

CREATE OR REPLACE FUNCTION public.darf_ordner_sehen(_user uuid, _ordner text, _subpath text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_liste text[];
  v_rolle text;
BEGIN
  IF _user IS NULL OR _ordner IS NULL THEN RETURN false; END IF;
  IF public.can_review(_user) THEN RETURN true; END IF;

  -- Ausnahme je Person, sonst Standard der Rolle aus app_settings
  SELECT p.ordner_sichtbar INTO v_liste FROM public.profiles p WHERE p.id = _user;
  IF v_liste IS NULL THEN
    SELECT r.schluessel INTO v_rolle
      FROM public.user_roles ur JOIN public.rollen r ON r.id = ur.rolle_id
     WHERE ur.user_id = _user LIMIT 1;
    SELECT ARRAY(SELECT jsonb_array_elements_text((s.value::jsonb)->COALESCE(v_rolle, 'mitarbeiter')))
      INTO v_liste
      FROM public.app_settings s WHERE s.key = 'ordner_visibility';
    IF v_liste IS NULL OR array_length(v_liste, 1) IS NULL THEN
      v_liste := ARRAY['91-plaene','2-schriftverkehr','evaluierung','95-leistungsverzeichnis','fotos'];
    END IF;
  END IF;
  IF NOT (_ordner = ANY (v_liste)) THEN RETURN false; END IF;

  -- „Berichte" für Nicht-Prüfer: im Schriftverkehr nur die Berichts-PDFs
  IF _ordner = '2-schriftverkehr' THEN
    RETURN _subpath IS NOT NULL
       AND (_subpath = 'tagesberichte' OR _subpath LIKE 'tagesberichte/%'
            OR _subpath = 'regieberichte' OR _subpath LIKE 'regieberichte/%');
  END IF;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.darf_ordner_sehen(uuid, text, text) FROM anon;

-- Tabelle dokumente: Lesen/Anlegen nur, was der Ordner hergibt
DROP POLICY IF EXISTS dokumente_select ON public.dokumente;
CREATE POLICY dokumente_select ON public.dokumente FOR SELECT TO authenticated
  USING (
    public.can_review(auth.uid())
    OR mitarbeiter_id = auth.uid()
    OR (baustelle_id IS NOT NULL AND public.darf_ordner_sehen(auth.uid(), ordner, subpath))
  );
DROP POLICY IF EXISTS dokumente_insert ON public.dokumente;
CREATE POLICY dokumente_insert ON public.dokumente FOR INSERT TO authenticated
  WITH CHECK (
    public.can_review(auth.uid())
    OR (baustelle_id IS NOT NULL AND public.darf_ordner_sehen(auth.uid(), ordner, subpath))
    OR (baustelle_id IS NULL AND mitarbeiter_id = auth.uid())
  );

-- Speicher: Bucket baustellen nach Ordner (Pfad = <baustelle>/<ordner>/<unterordner…>/datei)
DROP POLICY IF EXISTS dokumente_select ON storage.objects;
CREATE POLICY dokumente_select ON storage.objects FOR SELECT TO authenticated
  USING (
    (bucket_id = 'baustellen' AND public.darf_ordner_sehen(
        auth.uid(), (storage.foldername(name))[2],
        NULLIF(array_to_string((storage.foldername(name))[3:], '/'), '')))
    OR (bucket_id IN ('dokumente', 'unterschriften') AND public.can_review(auth.uid()))
  );
DROP POLICY IF EXISTS dokumente_insert ON storage.objects;
CREATE POLICY dokumente_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    (bucket_id = 'baustellen' AND public.darf_ordner_sehen(
        auth.uid(), (storage.foldername(name))[2],
        NULLIF(array_to_string((storage.foldername(name))[3:], '/'), '')))
    OR (bucket_id IN ('dokumente', 'unterschriften') AND public.can_review(auth.uid()))
  );

-- ─── OneDrive-Link je Baustelle ───────────────────────────────────────
ALTER TABLE public.baustellen ADD COLUMN IF NOT EXISTS onedrive_url text;
