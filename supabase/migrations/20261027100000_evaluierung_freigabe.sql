-- =====================================================================
-- Evaluierung erst unterschreiben, dann an die Baustelle (Wunsch
-- J. Maurer, 27.10.2026: „Vortragender muss ausgefüllt sein und derjenige
-- der die Baustelle anlegt muss die Evaluierung unterschreiben bevor sie
-- zur Baustelle geht").
--
-- • evaluierungen bekommt die Unterschrift „Evaluierung durchgeführt"
--   (durchgefuehrt_unterschrift/_von/_am) und freigegeben_am.
-- • unterweisung_setzen (Baustellenmeldung, Reiter Unterweisung) trägt den
--   Anleger als Vortragenden ein und legt die Unterweisung UNFREIGEGEBEN an.
-- • Solange freigegeben_am leer ist, teilen die Trigger niemandem eine
--   Zeile zu — die Mitarbeiter sehen nichts, die App sperrt nicht.
-- • evaluierung_freigeben(): Vortragender + Unterschrift speichern,
--   freigeben, dann gleich an alle Eingeteilten/Partie verteilen.
-- • Bestehende Unterweisungen gelten als freigegeben (laufen weiter);
--   unterschreiben kann man sie trotzdem nachträglich.
-- • Andere Wege (Evaluierung-Seite, Tagesplanung) legen wie bisher
--   freigegeben an; der Vortragende ist dort per Vorgabe der Anleger.
-- =====================================================================

ALTER TABLE public.evaluierungen
  ADD COLUMN IF NOT EXISTS durchgefuehrt_unterschrift text,
  ADD COLUMN IF NOT EXISTS durchgefuehrt_von uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS durchgefuehrt_am timestamptz,
  ADD COLUMN IF NOT EXISTS freigegeben_am timestamptz DEFAULT now();

UPDATE public.evaluierungen SET freigegeben_am = created_at WHERE freigegeben_am IS NULL;

ALTER TABLE public.evaluierungen ALTER COLUMN vortragender_id SET DEFAULT auth.uid();

-- Fehlende Vortragende nachtragen: wer die Baustelle angelegt hat.
UPDATE public.evaluierungen e
   SET vortragender_id = b.created_by
  FROM public.baustellen b
 WHERE b.id = e.baustelle_id
   AND e.vortragender_id IS NULL
   AND b.created_by IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = b.created_by);

COMMENT ON COLUMN public.evaluierungen.freigegeben_am IS
  'Erst wenn gesetzt, wird die Unterweisung den Mitarbeitern zugeteilt. unterweisung_setzen legt sie leer an; evaluierung_freigeben setzt sie.';

-- ─── Verteilen (aus pflicht_unterweisung_nachholen herausgelöst) ───────
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_verteilen(p_baustelle uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pflicht uuid;
  v_partie uuid;
  r record;
BEGIN
  SELECT b.pflicht_evaluierung_id, b.partie_id INTO v_pflicht, v_partie
    FROM public.baustellen b WHERE b.id = p_baustelle;
  IF v_pflicht IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.evaluierungen
                  WHERE id = v_pflicht AND freigegeben_am IS NOT NULL) THEN
    RETURN;   -- noch nicht unterschrieben/freigegeben
  END IF;

  FOR r IN
    SELECT DISTINCT ma_id FROM (
      SELECT em.mitarbeiter_id AS ma_id
        FROM public.einteilung_mitarbeiter em
        JOIN public.einteilungen e ON e.id = em.einteilung_id
       WHERE e.baustelle_id = p_baustelle
      UNION
      SELECT p.id
        FROM public.profiles p
       WHERE p.partie_id = v_partie
         AND p.is_active
         AND COALESCE(p.in_tagesplanung, TRUE)
      UNION
      SELECT pa.partieleiter_id
        FROM public.partien pa
       WHERE pa.id = v_partie AND pa.partieleiter_id IS NOT NULL
      UNION
      SELECT public.polier_der_baustelle(p_baustelle)
    ) q
    WHERE ma_id IS NOT NULL
  LOOP
    INSERT INTO public.evaluierung_unterschriften (evaluierung_id, mitarbeiter_id, unterschrift_data)
    VALUES (v_pflicht, r.ma_id, NULL)
    ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;
    PERFORM public.unterweisung_faellig_neu(r.ma_id, p_baustelle);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.pflicht_unterweisung_verteilen(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_nachholen()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.pflicht_evaluierung_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.pflicht_evaluierung_id IS NOT DISTINCT FROM NEW.pflicht_evaluierung_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.pflicht_unterweisung_verteilen(NEW.id);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_zuteilen()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  SELECT b.pflicht_evaluierung_id INTO v_pflicht
    FROM public.baustellen b
    JOIN public.evaluierungen ev ON ev.id = b.pflicht_evaluierung_id
   WHERE b.id = v_baustelle
     AND ev.freigegeben_am IS NOT NULL;   -- unfreigegeben: noch niemandem zuteilen
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

-- ─── unterweisung_setzen: Anleger = Vortragender, noch nicht freigegeben ─
CREATE OR REPLACE FUNCTION public.unterweisung_setzen(p_baustelle uuid, p_typ evaluierung_typ)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
declare
  v_alt     uuid;
  v_alt_typ evaluierung_typ;
  v_neu     uuid;
begin
  if not (is_admin_role(auth.uid()) or can_review(auth.uid())) then
    raise exception 'Keine Berechtigung';
  end if;

  select pflicht_evaluierung_id into v_alt from public.baustellen where id = p_baustelle;
  if v_alt is not null then
    select typ into v_alt_typ from public.evaluierungen where id = v_alt;
    if v_alt_typ = p_typ then
      return v_alt;   -- schon vorhanden, keine zweite anlegen
    end if;
  end if;

  insert into public.evaluierungen
    (baustelle_id, datum, typ, checkliste, abgeschlossen, vortragender_id, freigegeben_am)
  values
    (p_baustelle, (now() at time zone 'Europe/Vienna')::date, p_typ, '{}'::jsonb, false, auth.uid(), null)
  returning id into v_neu;

  update public.baustellen set pflicht_evaluierung_id = v_neu where id = p_baustelle;

  if v_alt is not null then
    update public.evaluierung_unterschriften
       set status = 'archiviert',
           archiviert_am = now(),
           archiviert_grund = 'durch neue Unterweisung ersetzt',
           faellig_am = null
     where evaluierung_id = v_alt
       and status = 'offen';
  end if;

  return v_neu;
end $$;

-- ─── Unterschreiben + freigeben ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluierung_freigeben(
  p_id uuid,
  p_unterschrift text,
  p_vortragender uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ev  public.evaluierungen;
  v_b   public.baustellen;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Nicht angemeldet' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ev FROM public.evaluierungen WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluierung nicht gefunden'; END IF;
  SELECT * INTO v_b FROM public.baustellen WHERE id = v_ev.baustelle_id;

  IF NOT (public.is_admin_role(v_uid)
          OR public.has_permission(v_uid, 'evaluierungen.edit')
          OR v_b.bauleiter_id = v_uid
          OR v_b.created_by = v_uid
          OR v_ev.vortragender_id = v_uid) THEN
    RAISE EXCEPTION 'Nicht berechtigt' USING ERRCODE = '42501';
  END IF;
  IF p_unterschrift IS NULL OR length(p_unterschrift) < 100 THEN
    RAISE EXCEPTION 'Unterschrift fehlt';
  END IF;
  IF COALESCE(p_vortragender, v_ev.vortragender_id) IS NULL THEN
    RAISE EXCEPTION 'Vortragender fehlt';
  END IF;

  UPDATE public.evaluierungen
     SET vortragender_id = COALESCE(p_vortragender, vortragender_id),
         durchgefuehrt_unterschrift = p_unterschrift,
         durchgefuehrt_von = v_uid,
         durchgefuehrt_am = now(),
         freigegeben_am = COALESCE(freigegeben_am, now()),
         updated_at = now()
   WHERE id = p_id;

  IF v_b.pflicht_evaluierung_id = p_id THEN
    PERFORM public.pflicht_unterweisung_verteilen(v_b.id);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.evaluierung_freigeben(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluierung_freigeben(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
