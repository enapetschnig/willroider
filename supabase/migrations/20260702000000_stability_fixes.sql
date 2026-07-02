-- =====================================================================
-- Stability-Fixes aus dem Komplett-Audit vom 2026-07-02.
-- 54 bestätigte Funde; hier die DB-seitigen Criticals/Highs:
--
--  1. st_write/sz_write/sf_write: Kind-Tabellen-RLS prüfte weder Status
--     noch Monatssperre → MA konnte freigegebene/exportierte Tage über
--     stunden_taetigkeiten still ändern (SECURITY-DEFINER-Trigger schrieb
--     netto_stunden ungehindert auf den gesperrten Parent durch).
--  2. storage.objects dokumente_delete: JEDER authentifizierte User
--     durfte beliebige Dateien in dokumente/baustellen/unterschriften
--     löschen — Storage weg, DB-Zeile blieb (RLS-Asymmetrie).
--  3. month_locked lief ohne SECURITY DEFINER → Polier-Zweig (erfasst_von)
--     sah die monatsabschluss-Zeilen des MA nicht → Sperre wirkungslos.
--  4. mitarbeiter_zulagen: Poliere konnten die erlaubten Zulagen ihrer
--     Partie-MA nicht lesen → Zulagen gingen bei Sammelerfassung verloren.
--  5. v_urlaubs_saldo/v_za_saldo: Views ohne security_invoker + Grants
--     für anon → Salden ALLER MA für jeden (auch anonym) lesbar.
--  6. stunden_bericht_versenden hatte 2 Overloads → PGRST203-Ambiguität
--     bei 2-Argument-Aufrufen (useStundenBericht.ts einzelversand).
--  7. stunden_bericht_wieder_oeffnen ohne Status-Guard → offene Berichte
--     konnten auf 'unterschrieben' gesetzt werden (ohne Unterschrift).
--  8. krankmeldung_to_stunden_tage: SECURITY DEFINER ohne search_path.
--  9. stunden_tag_recompute: Division durch 0 bei tagesnorm_stunden=0.
-- 10. fn_sync_user_role_enum: reine role-Updates waren stille No-Ops.
-- =====================================================================

-- ─── 1. Kind-Tabellen-RLS: Status + Monatssperre wie beim Parent ──────
-- Spiegel der stunden_tage_update-Logik: Admin / Permission-Träger dürfen
-- immer, normale MA/Poliere nur bei nicht-freigegebenen, nicht gesperrten
-- Tagen.

DROP POLICY IF EXISTS st_write ON public.stunden_taetigkeiten;
CREATE POLICY st_write ON public.stunden_taetigkeiten FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stunden_tage t
     WHERE t.id = stunden_taetigkeiten.stunden_tag_id
       AND (
         public.is_admin_role(auth.uid())
         OR public.has_permission(auth.uid(), 'stunden.create_andere')
         OR public.has_permission(auth.uid(), 'stunden.edit_alle')
         OR (
           (t.mitarbeiter_id = auth.uid()
            OR t.erfasst_von = auth.uid()
            OR public.is_partieleiter_of(auth.uid(), t.mitarbeiter_id))
           AND t.status IN ('erfasst', 'ma_bestaetigt')
           AND NOT public.month_locked(t.mitarbeiter_id, t.datum)
         )
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.stunden_tage t
     WHERE t.id = stunden_taetigkeiten.stunden_tag_id
       AND (
         public.is_admin_role(auth.uid())
         OR public.has_permission(auth.uid(), 'stunden.create_andere')
         OR public.has_permission(auth.uid(), 'stunden.edit_alle')
         OR (
           (t.mitarbeiter_id = auth.uid()
            OR t.erfasst_von = auth.uid()
            OR public.is_partieleiter_of(auth.uid(), t.mitarbeiter_id))
           AND t.status IN ('erfasst', 'ma_bestaetigt')
           AND NOT public.month_locked(t.mitarbeiter_id, t.datum)
         )
       )
  ));

DROP POLICY IF EXISTS sz_write ON public.stunden_zulagen;
CREATE POLICY sz_write ON public.stunden_zulagen FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stunden_tage t
     WHERE t.id = stunden_zulagen.stunden_tag_id
       AND (
         public.is_admin_role(auth.uid())
         OR public.has_permission(auth.uid(), 'stunden.create_andere')
         OR public.has_permission(auth.uid(), 'stunden.edit_alle')
         OR (
           (t.mitarbeiter_id = auth.uid()
            OR t.erfasst_von = auth.uid()
            OR public.is_partieleiter_of(auth.uid(), t.mitarbeiter_id))
           AND t.status IN ('erfasst', 'ma_bestaetigt')
           AND NOT public.month_locked(t.mitarbeiter_id, t.datum)
         )
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.stunden_tage t
     WHERE t.id = stunden_zulagen.stunden_tag_id
       AND (
         public.is_admin_role(auth.uid())
         OR public.has_permission(auth.uid(), 'stunden.create_andere')
         OR public.has_permission(auth.uid(), 'stunden.edit_alle')
         OR (
           (t.mitarbeiter_id = auth.uid()
            OR t.erfasst_von = auth.uid()
            OR public.is_partieleiter_of(auth.uid(), t.mitarbeiter_id))
           AND t.status IN ('erfasst', 'ma_bestaetigt')
           AND NOT public.month_locked(t.mitarbeiter_id, t.datum)
         )
       )
  ));

DROP POLICY IF EXISTS sf_write ON public.stunden_fahrt;
CREATE POLICY sf_write ON public.stunden_fahrt FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stunden_tage t
     WHERE t.id = stunden_fahrt.stunden_tag_id
       AND (
         public.is_admin_role(auth.uid())
         OR public.has_permission(auth.uid(), 'stunden.create_andere')
         OR public.has_permission(auth.uid(), 'stunden.edit_alle')
         OR (
           (t.mitarbeiter_id = auth.uid()
            OR t.erfasst_von = auth.uid()
            OR public.is_partieleiter_of(auth.uid(), t.mitarbeiter_id))
           AND t.status IN ('erfasst', 'ma_bestaetigt')
           AND NOT public.month_locked(t.mitarbeiter_id, t.datum)
         )
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.stunden_tage t
     WHERE t.id = stunden_fahrt.stunden_tag_id
       AND (
         public.is_admin_role(auth.uid())
         OR public.has_permission(auth.uid(), 'stunden.create_andere')
         OR public.has_permission(auth.uid(), 'stunden.edit_alle')
         OR (
           (t.mitarbeiter_id = auth.uid()
            OR t.erfasst_von = auth.uid()
            OR public.is_partieleiter_of(auth.uid(), t.mitarbeiter_id))
           AND t.status IN ('erfasst', 'ma_bestaetigt')
           AND NOT public.month_locked(t.mitarbeiter_id, t.datum)
         )
       )
  ));

-- ─── 2. Storage-Delete/-Update nur für Uploader oder Admin ────────────
DROP POLICY IF EXISTS dokumente_delete ON storage.objects;
CREATE POLICY dokumente_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('dokumente', 'baustellen', 'unterschriften')
    AND (public.is_admin_role(auth.uid()) OR owner_id = auth.uid()::text)
  );

DROP POLICY IF EXISTS dokumente_update ON storage.objects;
CREATE POLICY dokumente_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('dokumente', 'baustellen', 'unterschriften')
    AND (public.is_admin_role(auth.uid()) OR owner_id = auth.uid()::text)
  )
  WITH CHECK (
    bucket_id IN ('dokumente', 'baustellen', 'unterschriften')
  );

-- ─── 3. month_locked: SECURITY DEFINER ────────────────────────────────
-- Poliere sehen die monatsabschluss-Zeilen ihrer MA per RLS nicht — die
-- Sperr-Prüfung muss deshalb mit Definer-Rechten laufen.
CREATE OR REPLACE FUNCTION public.month_locked(p_uid uuid, p_datum date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.monatsabschluss
    WHERE mitarbeiter_id = p_uid
      AND p_datum BETWEEN von_datum AND bis_datum
  );
$$;

-- ─── 4. mitarbeiter_zulagen: Poliere dürfen Zulagen ihrer Partie lesen ─
DROP POLICY IF EXISTS mz_read_own_or_admin ON public.mitarbeiter_zulagen;
CREATE POLICY mz_read_own_or_admin ON public.mitarbeiter_zulagen FOR SELECT TO authenticated
  USING (
    mitarbeiter_id = auth.uid()
    OR public.is_admin_role(auth.uid())
    OR public.is_partieleiter_of(auth.uid(), mitarbeiter_id)
    OR public.has_permission(auth.uid(), 'stunden.create_andere')
  );

-- ─── 5. Saldo-Views: security_invoker + anon aussperren ───────────────
ALTER VIEW public.v_urlaubs_saldo SET (security_invoker = true);
ALTER VIEW public.v_za_saldo SET (security_invoker = true);
REVOKE ALL ON public.v_urlaubs_saldo FROM anon;
REVOKE ALL ON public.v_za_saldo FROM anon;

-- ─── 6. Overload-Ambiguität beseitigen ────────────────────────────────
-- PostgREST wirft PGRST203 wenn zwei Overloads matchen können. Die
-- 3-Argument-Version (mit p_unterschrift) ist die einzige die gebraucht
-- wird — 2-arg-Aufrufe laufen über DEFAULT.
DROP FUNCTION IF EXISTS public.stunden_bericht_versenden(uuid, text);

-- ─── 7. wieder_oeffnen: Status-Guard ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.stunden_bericht_wieder_oeffnen(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.stunden_berichte;
BEGIN
  IF NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  SELECT * INTO r FROM public.stunden_berichte WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bericht nicht gefunden';
  END IF;
  IF r.status NOT IN ('bestaetigt', 'versendet') THEN
    RAISE EXCEPTION 'Nur bestätigte oder versendete Berichte können wieder geöffnet werden (aktuell: %)', r.status;
  END IF;

  PERFORM public.monatsabschluss_oeffnen(r.von_datum, r.bis_datum, r.mitarbeiter_id);

  UPDATE public.stunden_berichte
    SET status = 'unterschrieben',
        bestaetigt_von = NULL,
        bestaetigt_am = NULL
    WHERE id = p_id;
END;
$$;

-- ─── 8. search_path für krankmeldung_to_stunden_tage ──────────────────
ALTER FUNCTION public.krankmeldung_to_stunden_tage() SET search_path = public;

-- ─── 9. recompute: Division-durch-0-Guard bei tagesnorm 0 ─────────────
CREATE OR REPLACE FUNCTION public.stunden_tag_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tag_id    UUID := COALESCE(NEW.stunden_tag_id, OLD.stunden_tag_id);
  v_netto     NUMERIC;
  v_status    TEXT;
  v_urlaub    NUMERIC;
  v_ma        UUID;
  v_datum     DATE;
  v_tagesnorm NUMERIC;
BEGIN
  SELECT COALESCE(SUM(stunden), 0),
         CASE
           WHEN bool_or(art = 'baustelle') THEN 'baustelle'
           WHEN bool_or(art = 'firma') THEN 'firma'
           WHEN bool_or(art = 'urlaub') THEN 'urlaub'
           WHEN bool_or(art = 'krank') THEN 'krank'
           WHEN bool_or(art = 'schlechtwetter') THEN 'schlechtwetter'
           WHEN bool_or(art = 'feiertag') THEN 'feiertag'
           ELSE NULL
         END
    INTO v_netto, v_status
    FROM public.stunden_taetigkeiten WHERE stunden_tag_id = v_tag_id;

  IF v_status IS NOT NULL THEN
    UPDATE public.stunden_tage
      SET netto_stunden = v_netto, tag_status = v_status::public.tag_status
      WHERE id = v_tag_id;
  ELSE
    UPDATE public.stunden_tage SET netto_stunden = COALESCE(v_netto, 0)
      WHERE id = v_tag_id;
  END IF;

  SELECT COALESCE(SUM(stunden), 0) INTO v_urlaub
    FROM public.stunden_taetigkeiten
    WHERE stunden_tag_id = v_tag_id AND art = 'urlaub';
  DELETE FROM public.urlaubs_buchungen
    WHERE art = 'urlaub_genommen' AND notiz LIKE 'TAG:' || v_tag_id || '%';
  IF v_urlaub > 0 THEN
    SELECT mitarbeiter_id, datum INTO v_ma, v_datum
      FROM public.stunden_tage WHERE id = v_tag_id;
    IF v_ma IS NOT NULL THEN
      SELECT COALESCE(tagesnorm_stunden, 8.0) INTO v_tagesnorm
        FROM public.profile_konten_settings WHERE profile_id = v_ma;
      -- Guard: tagesnorm 0 oder NULL → 8.0 statt Division durch 0
      v_tagesnorm := COALESCE(NULLIF(v_tagesnorm, 0), 8.0);
      INSERT INTO public.urlaubs_buchungen
        (mitarbeiter_id, art, tage, wirksam_am, notiz, erstellt_von)
        VALUES
        (v_ma, 'urlaub_genommen', -ROUND(v_urlaub / v_tagesnorm, 2), v_datum,
         'TAG:' || v_tag_id || ' · ' || v_urlaub || ' h Urlaub (auto)',
         auth.uid());
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- ─── 10. Sync-Trigger: reine role-Updates ziehen rolle_id nach ────────
CREATE OR REPLACE FUNCTION public.fn_sync_user_role_enum()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Reiner role-ENUM-Update (rolle_id unangetastet): rolle_id aus
  -- legacy_enum nachziehen — vorher wurde role sofort wieder aus der
  -- alten rolle_id überschrieben (stiller No-Op).
  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NEW.rolle_id IS NOT DISTINCT FROM OLD.rolle_id THEN
    SELECT id INTO NEW.rolle_id
      FROM public.rollen
     WHERE legacy_enum = NEW.role
     LIMIT 1;
    RETURN NEW;
  END IF;

  -- Richtung 1: rolle_id gesetzt → role-ENUM aus rollen.legacy_enum
  IF NEW.rolle_id IS NOT NULL THEN
    SELECT COALESCE(r.legacy_enum, 'mitarbeiter') INTO NEW.role
      FROM public.rollen r
     WHERE r.id = NEW.rolle_id;
    RETURN NEW;
  END IF;

  -- Richtung 2: rolle_id leer, role gesetzt → rolle_id auffüllen
  IF NEW.rolle_id IS NULL AND NEW.role IS NOT NULL THEN
    SELECT id INTO NEW.rolle_id
      FROM public.rollen
     WHERE legacy_enum = NEW.role
     LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
