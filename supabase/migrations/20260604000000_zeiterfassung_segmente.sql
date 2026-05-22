-- ─── Zeiterfassung: Tag in typisierte Einträge umbauen ─────────────────
-- Bisher hat ein stunden_tage genau einen tag_status. Künftig ist ein Tag
-- eine Liste typisierter Einträge (stunden_taetigkeiten.art) — ein
-- Mitarbeiter kann am selben Tag Baustelle + Firma + Urlaub kombinieren.
--
-- stunden_tage.tag_status + netto_stunden BLEIBEN erhalten, werden aber per
-- Trigger aus den Einträgen abgeleitet — so laufen Stundenauswertung,
-- Monatsabschluss-RPC etc. unverändert weiter.
--
-- vm_pause/mittag_pause bleiben als Spalten bestehen (Default false), werden
-- aber nicht mehr genutzt — vermeidet Bruch während des Deploy-Fensters.
-- ───────────────────────────────────────────────────────────────────────

-- 1) Eintrags-Art — das vorhandene tag_status-Enum wird wiederverwendet.
ALTER TABLE public.stunden_taetigkeiten
  ADD COLUMN IF NOT EXISTS art public.tag_status NOT NULL DEFAULT 'baustelle';

-- 2) Bestehende Tätigkeitszeilen: art aus dem tag_status des Eltern-Tages.
UPDATE public.stunden_taetigkeiten st
  SET art = t.tag_status
  FROM public.stunden_tage t
  WHERE st.stunden_tag_id = t.id;

-- 3) Tage ohne Einträge (Abwesenheit oder Arbeitstag ohne Tätigkeit) bekommen
--    einen Eintrag: art = tag_status, stunden = netto_stunden.
INSERT INTO public.stunden_taetigkeiten (stunden_tag_id, position, art, stunden)
SELECT t.id, 1, t.tag_status, t.netto_stunden
FROM public.stunden_tage t
WHERE NOT EXISTS (
  SELECT 1 FROM public.stunden_taetigkeiten st WHERE st.stunden_tag_id = t.id
);

-- 4) Alte Urlaub-Auto-Trigger auf stunden_tage entfernen — die Logik wandert
--    in den neuen Eintrags-Trigger.
DROP TRIGGER IF EXISTS stunden_tage_urlaub_auto ON public.stunden_tage;
DROP TRIGGER IF EXISTS stunden_tage_urlaub_cleanup ON public.stunden_tage;

-- 5) Recompute-Trigger: hält netto_stunden + tag_status + Urlaubs-Buchung
--    eines Tages aus seinen Einträgen aktuell.
CREATE OR REPLACE FUNCTION public.stunden_tag_recompute()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tag_id    UUID := COALESCE(NEW.stunden_tag_id, OLD.stunden_tag_id);
  v_netto     NUMERIC;
  v_status    TEXT;
  v_urlaub    NUMERIC;
  v_ma        UUID;
  v_datum     DATE;
  v_tagesnorm NUMERIC;
BEGIN
  -- Summe + abgeleiteter Primär-Status (Priorität baustelle > firma >
  -- urlaub > krank > schlechtwetter > feiertag).
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
    -- Zwischenzustand ohne Einträge (delete-all beim Speichern) — nur Summe.
    UPDATE public.stunden_tage SET netto_stunden = COALESCE(v_netto, 0)
      WHERE id = v_tag_id;
  END IF;

  -- Urlaubs-Auto-Buchung anhand der Urlaub-Einträge des Tages.
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
      v_tagesnorm := COALESCE(v_tagesnorm, 8.0);
      INSERT INTO public.urlaubs_buchungen
        (mitarbeiter_id, art, tage, wirksam_am, notiz, erstellt_von)
        VALUES
        (v_ma, 'urlaub_genommen', -ROUND(v_urlaub / v_tagesnorm, 2), v_datum,
         'TAG:' || v_tag_id || ' · ' || v_urlaub || ' h Urlaub (auto)',
         auth.uid());
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS stunden_taetigkeiten_recompute ON public.stunden_taetigkeiten;
CREATE TRIGGER stunden_taetigkeiten_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.stunden_taetigkeiten
  FOR EACH ROW EXECUTE FUNCTION public.stunden_tag_recompute();

-- 6) Wechselzulage aus der Zeiterfassung nehmen.
UPDATE public.zulagen_typen SET is_active = false
  WHERE bezeichnung = 'Wechselzulage';

NOTIFY pgrst, 'reload schema';
