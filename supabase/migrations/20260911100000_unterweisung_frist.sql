-- =====================================================================
-- Unterweisungen: Fälligkeit, Gerät, Erfasser — und die Bestätigung
-- läuft über eine Datenbank-Funktion mit serverseitigem Zeitstempel.
--
-- Fristregeln (Absprache mit Johannes Maurer, 11.09.2026):
--   A  Vortags-Planung / Baustellenbeginn → Einsatztag 08:00 (Wien)
--   B  kommt nach 08:00 dazu              → 30 Minuten ab Zuteilung
--   C  Situation ändert sich untertags    → neue Unterweisung, 30 Minuten
--   D  eingeteilt, aber abwesend          → nicht fällig (faellig_am NULL),
--                                           wird beim nächsten Einsatz fällig
-- =====================================================================

ALTER TABLE public.evaluierung_unterschriften
  ADD COLUMN IF NOT EXISTS faellig_am timestamptz,
  ADD COLUMN IF NOT EXISTS bestaetigt_ueber text
    CHECK (bestaetigt_ueber IN ('eigenes_geraet', 'tablet')),
  ADD COLUMN IF NOT EXISTS erfasst_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gelesen_bestaetigt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.evaluierung_unterschriften.faellig_am IS
  'Bis wann bestätigt sein muss. NULL = zugeteilt, aber derzeit nicht fällig (kein Einsatz geplant).';
COMMENT ON COLUMN public.evaluierung_unterschriften.bestaetigt_ueber IS
  'eigenes_geraet = am eigenen Handy · tablet = am Tablet des Poliers/Bauleiters (erfasst_von)';

CREATE INDEX IF NOT EXISTS evaluierung_unterschriften_faellig_idx
  ON public.evaluierung_unterschriften (faellig_am)
  WHERE status = 'offen';

-- ─── Fälligkeit aus dem Einsatztag ableiten ───────────────────────────
CREATE OR REPLACE FUNCTION public.unterweisung_faelligkeit(p_einsatztag date)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    -- Einsatz liegt zurück: nicht fällig — beim nächsten Einsatz wieder
    WHEN p_einsatztag < (now() AT TIME ZONE 'Europe/Vienna')::date THEN NULL
    -- Regel A: vor 08:00 des Einsatztags zugeteilt → Einsatztag 08:00
    WHEN now() < ((p_einsatztag::text || ' 08:00')::timestamp AT TIME ZONE 'Europe/Vienna')
      THEN (p_einsatztag::text || ' 08:00')::timestamp AT TIME ZONE 'Europe/Vienna'
    -- Regel B/C: am oder nach 08:00 → 30 Minuten ab jetzt
    ELSE now() + interval '30 minutes'
  END
$$;

-- ─── Fälligkeit einer offenen Unterschrift neu bestimmen ─────────────
-- Früheste anwesende Einteilung des Mitarbeiters auf dieser Baustelle ab
-- heute. Keine → NULL (Regel D). Bestehende Fälligkeit wird nur
-- vorgezogen, nie nach hinten geschoben.
CREATE OR REPLACE FUNCTION public.unterweisung_faellig_neu(p_mitarbeiter uuid, p_baustelle uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pflicht uuid;
  v_datum date;
  v_neu timestamptz;
BEGIN
  SELECT pflicht_evaluierung_id INTO v_pflicht FROM public.baustellen WHERE id = p_baustelle;
  IF v_pflicht IS NULL THEN RETURN; END IF;

  SELECT MIN(e.datum) INTO v_datum
    FROM public.einteilungen e
    JOIN public.einteilung_mitarbeiter em ON em.einteilung_id = e.id
   WHERE e.baustelle_id = p_baustelle
     AND em.mitarbeiter_id = p_mitarbeiter
     AND NOT COALESCE(em.abwesend, false)
     AND e.datum >= (now() AT TIME ZONE 'Europe/Vienna')::date;

  v_neu := CASE WHEN v_datum IS NULL THEN NULL ELSE public.unterweisung_faelligkeit(v_datum) END;

  UPDATE public.evaluierung_unterschriften
     SET faellig_am = CASE
           WHEN v_neu IS NULL THEN NULL
           WHEN faellig_am IS NULL THEN v_neu
           ELSE LEAST(faellig_am, v_neu)
         END
   WHERE evaluierung_id = v_pflicht
     AND mitarbeiter_id = p_mitarbeiter
     AND status = 'offen';
END $$;

-- ─── Zuteilung bei Einteilung (Regel A/B/D) ───────────────────────────
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_zuteilen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_baustelle uuid;
  v_pflicht uuid;
  v_polier uuid;
  v_ma uuid;
BEGIN
  v_ma := COALESCE(NEW.mitarbeiter_id, OLD.mitarbeiter_id);
  SELECT e.baustelle_id INTO v_baustelle
    FROM public.einteilungen e
   WHERE e.id = COALESCE(NEW.einteilung_id, OLD.einteilung_id);
  IF v_baustelle IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT pflicht_evaluierung_id INTO v_pflicht FROM public.baustellen WHERE id = v_baustelle;
  IF v_pflicht IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- Zeile anlegen (idempotent). Abwesende bekommen sie auch — nur nicht fällig.
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO public.evaluierung_unterschriften (evaluierung_id, mitarbeiter_id, unterschrift_data)
    VALUES (v_pflicht, v_ma, NULL)
    ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;
  END IF;
  PERFORM public.unterweisung_faellig_neu(v_ma, v_baustelle);

  -- Der Polier der Baustelle gehört dazu, auch wenn er nicht eingeteilt ist.
  v_polier := public.polier_der_baustelle(v_baustelle);
  IF v_polier IS NOT NULL AND TG_OP <> 'DELETE' THEN
    INSERT INTO public.evaluierung_unterschriften (evaluierung_id, mitarbeiter_id, unterschrift_data)
    VALUES (v_pflicht, v_polier, NULL)
    ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;
    PERFORM public.unterweisung_faellig_neu(v_polier, v_baustelle);
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS einteilung_mitarbeiter_pflicht_unterweisung ON public.einteilung_mitarbeiter;
CREATE TRIGGER einteilung_mitarbeiter_pflicht_unterweisung
  AFTER INSERT OR DELETE OR UPDATE OF abwesend, mitarbeiter_id
  ON public.einteilung_mitarbeiter
  FOR EACH ROW EXECUTE FUNCTION public.pflicht_unterweisung_zuteilen();

-- ─── Neue/geänderte Pflicht-Unterweisung an der Baustelle (Regel C) ──
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_nachholen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.pflicht_evaluierung_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.pflicht_evaluierung_id IS NOT DISTINCT FROM NEW.pflicht_evaluierung_id THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT DISTINCT ma_id FROM (
      -- Wer auf dieser Baustelle eingeteilt ist (heute oder künftig zählt
      -- für die Fälligkeit; Vergangenes bekommt die Zeile, ist aber nicht fällig)
      SELECT em.mitarbeiter_id AS ma_id
        FROM public.einteilung_mitarbeiter em
        JOIN public.einteilungen e ON e.id = em.einteilung_id
       WHERE e.baustelle_id = NEW.id
      UNION
      SELECT p.id
        FROM public.profiles p
       WHERE p.partie_id = NEW.partie_id
         AND p.is_active
         AND COALESCE(p.in_tagesplanung, TRUE)
      UNION
      SELECT pa.partieleiter_id
        FROM public.partien pa
       WHERE pa.id = NEW.partie_id AND pa.partieleiter_id IS NOT NULL
    ) q
    WHERE ma_id IS NOT NULL
  LOOP
    INSERT INTO public.evaluierung_unterschriften (evaluierung_id, mitarbeiter_id, unterschrift_data)
    VALUES (NEW.pflicht_evaluierung_id, r.ma_id, NULL)
    ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;
    PERFORM public.unterweisung_faellig_neu(r.ma_id, NEW.id);
  END LOOP;

  RETURN NEW;
END $$;

-- ─── Bestätigen: eigener Weg oder am Tablet — Zeitstempel vom Server ──
CREATE OR REPLACE FUNCTION public.unterweisung_bestaetigen(
  p_unterschrift_id uuid,
  p_unterschrift_data text,
  p_ueber text DEFAULT 'eigenes_geraet'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_darf boolean := false;
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet' USING ERRCODE = '42501';
  END IF;
  IF p_ueber NOT IN ('eigenes_geraet', 'tablet') THEN
    RAISE EXCEPTION 'Ungültiger Bestätigungsweg';
  END IF;
  IF p_unterschrift_data IS NULL OR length(p_unterschrift_data) < 100 THEN
    RAISE EXCEPTION 'Unterschrift fehlt';
  END IF;

  SELECT u.id, u.mitarbeiter_id, u.status, e.baustelle_id
    INTO v_row
    FROM public.evaluierung_unterschriften u
    JOIN public.evaluierungen e ON e.id = u.evaluierung_id
   WHERE u.id = p_unterschrift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unterschrift nicht gefunden'; END IF;
  IF v_row.status <> 'offen' THEN RAISE EXCEPTION 'Bereits bestätigt'; END IF;

  IF p_ueber = 'eigenes_geraet' THEN
    v_darf := (v_row.mitarbeiter_id = v_uid);
  ELSE
    -- Tablet: Bauleiter der Baustelle, Polier der Baustelle, ein heute dort
    -- eingeteilter Partieleiter, oder wer Unterweisungen verwalten darf.
    v_darf := public.is_admin_role(v_uid)
      OR public.has_permission(v_uid, 'evaluierungen.edit')
      OR EXISTS (SELECT 1 FROM public.baustellen b
                  WHERE b.id = v_row.baustelle_id AND b.bauleiter_id = v_uid)
      OR public.polier_der_baustelle(v_row.baustelle_id) = v_uid
      OR EXISTS (SELECT 1
                   FROM public.einteilungen e
                   JOIN public.einteilung_mitarbeiter em ON em.einteilung_id = e.id
                   JOIN public.profiles p ON p.id = em.mitarbeiter_id
                  WHERE e.baustelle_id = v_row.baustelle_id
                    AND e.datum = v_heute
                    AND em.mitarbeiter_id = v_uid
                    AND COALESCE(p.is_partieleiter, false));
  END IF;
  IF NOT COALESCE(v_darf, false) THEN
    RAISE EXCEPTION 'Nicht berechtigt — nur der Mitarbeiter selbst oder Polier/Bauleiter dieser Baustelle am Tablet'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.evaluierung_unterschriften
     SET status = 'unterschrieben',
         unterschrift_data = p_unterschrift_data,
         unterschrieben_am = now(),
         gelesen_bestaetigt = true,
         bestaetigt_ueber = p_ueber,
         erfasst_von = v_uid
   WHERE id = p_unterschrift_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.unterweisung_bestaetigen(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unterweisung_bestaetigen(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.unterweisung_faellig_neu(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─── RLS: der Mitarbeiter bestätigt nur noch über die Funktion ─────────
-- Vorher durfte er seine eigene Zeile direkt ändern oder löschen (auch auf
-- „unterschrieben" ohne Unterschrift). Lesen bleibt für alle, Schreiben nur
-- Verwaltung/Polier — für das Anlegen und Archivieren in der Verwaltung.
DROP POLICY IF EXISTS evaluierung_unt_modify ON public.evaluierung_unterschriften;
CREATE POLICY evaluierung_unt_modify ON public.evaluierung_unterschriften
  FOR ALL TO authenticated
  USING (public.can_review(auth.uid()) OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id))
  WITH CHECK (public.can_review(auth.uid()) OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id));

-- ─── Sicht für Erinnerung und Nachweis ────────────────────────────────
CREATE OR REPLACE VIEW public.v_unterweisung_faellig
WITH (security_invoker = true) AS
SELECT u.id AS unterschrift_id,
       u.evaluierung_id,
       u.mitarbeiter_id,
       u.faellig_am,
       u.reminder_geschickt_am,
       e.baustelle_id,
       e.typ AS evaluierung_typ,
       e.notizen AS evaluierung_titel,
       b.bvh_name,
       b.bauleiter_id,
       public.polier_der_baustelle(b.id) AS polier_id,
       p.vorname,
       p.nachname
  FROM public.evaluierung_unterschriften u
  JOIN public.evaluierungen e ON e.id = u.evaluierung_id
  JOIN public.baustellen b ON b.id = e.baustelle_id
  JOIN public.profiles p ON p.id = u.mitarbeiter_id
 WHERE u.status = 'offen'
   AND u.faellig_am IS NOT NULL;

-- Alte Sichten laufen mit Rechten des Eigentümers (RLS umgangen) —
-- auf Aufrufer-Rechte umstellen; Nachfolger ist v_unterweisung_faellig.
ALTER VIEW public.v_offene_unterschriften SET (security_invoker = true);
ALTER VIEW public.v_offene_unterschriften_mit_alter SET (security_invoker = true);
