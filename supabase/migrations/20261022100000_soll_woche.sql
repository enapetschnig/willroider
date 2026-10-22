-- =====================================================================
-- Eigenes Wochen-Soll je Person (Wunsch J. Maurer, 22.10.2026: „Frau
-- Köstenberger ist geringfügig, ihr Bericht hat andere Sollstunden").
--
-- profile_konten_settings.soll_woche (jsonb, optional):
--   {"woche": [Mo,Di,Mi,Do,Fr,Sa,So]}                    jede Woche gleich
--   {"woche": [...], "gerade_kw": [Mo,…,So]}             in geraden KW anders
-- Gesetzt geht es jedem Modell vor und gilt absolut (kein Beschäftigungsgrad).
--
-- tages_soll kennt jetzt auch das Modell 'angestellter' (8,5 Mo–Do, 5 Fr)
-- — bisher fiel es auf den Arbeiter-Kalender, wodurch ein Urlaubstag einer
-- Angestellten im Sommer nur 0,94 Tage abzog.
-- =====================================================================

ALTER TABLE public.profile_konten_settings
  ADD COLUMN IF NOT EXISTS soll_woche jsonb;

COMMENT ON COLUMN public.profile_konten_settings.soll_woche IS
  'Eigenes Wochen-Soll: {"woche":[Mo..So], "gerade_kw":[Mo..So]?} — geht dem Arbeitszeitmodell vor (absolut, ohne Beschäftigungsgrad).';

CREATE OR REPLACE FUNCTION public.tages_soll(p_uid uuid, p_datum date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ROUND(
    CASE
      WHEN jsonb_typeof(s.soll_woche -> 'woche') = 'array' THEN
        COALESCE((
          (CASE
             WHEN jsonb_typeof(s.soll_woche -> 'gerade_kw') = 'array'
              AND EXTRACT(WEEK FROM p_datum)::int % 2 = 0
             THEN s.soll_woche -> 'gerade_kw'
             ELSE s.soll_woche -> 'woche'
           END) ->> (EXTRACT(ISODOW FROM p_datum)::int - 1)
        )::numeric, 0)
      ELSE
        (CASE
           WHEN s.modell = 'fix_40h' THEN
             CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 5 THEN 8.0 ELSE 0 END
           WHEN s.modell = 'individuell' THEN
             CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 5 THEN s.tagesnorm ELSE 0 END
           WHEN s.modell = 'angestellter' THEN
             CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 4 THEN 8.5
                  WHEN EXTRACT(ISODOW FROM p_datum) = 5 THEN 5.0 ELSE 0 END
           ELSE  -- zimmerei_sommer: aus Kalender, sonst Tagesnorm-Fallback
             CASE
               WHEN k.jahr IS NULL THEN
                 CASE WHEN EXTRACT(ISODOW FROM p_datum) BETWEEN 1 AND 5 THEN s.tagesnorm ELSE 0 END
               ELSE COALESCE(
                 CASE EXTRACT(ISODOW FROM p_datum)::int
                   WHEN 1 THEN k.soll_mo WHEN 2 THEN k.soll_di WHEN 3 THEN k.soll_mi
                   WHEN 4 THEN k.soll_do WHEN 5 THEN k.soll_fr WHEN 6 THEN k.soll_sa
                   WHEN 7 THEN k.soll_so END, 0)
             END
         END) * s.beschgrad
    END, 2)
  FROM (
    SELECT COALESCE(tagesnorm_stunden, 8.0) AS tagesnorm,
           COALESCE(beschaeftigungsgrad, 1.0) AS beschgrad,
           COALESCE(arbeitszeitmodell, 'zimmerei_sommer') AS modell,
           soll_woche
      FROM public.profile_konten_settings WHERE profile_id = p_uid
    UNION ALL SELECT 8.0, 1.0, 'zimmerei_sommer', NULL::jsonb
    LIMIT 1
  ) s
  LEFT JOIN public.arbeitszeitkalender k
    ON k.jahr = EXTRACT(ISOYEAR FROM p_datum)::int
   AND k.kw   = EXTRACT(WEEK FROM p_datum)::int;
$$;

-- Wochen-Soll einer Person lesen — auch für Freigeber ohne Admin-Recht,
-- die den Tätigkeitsbericht eines anderen ansehen (die Einstellungen
-- selbst sind per RLS nur für Verwaltung und die Person sichtbar).
CREATE OR REPLACE FUNCTION public.soll_woche_von(p_uid uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT soll_woche FROM public.profile_konten_settings WHERE profile_id = p_uid;
$$;
REVOKE ALL ON FUNCTION public.soll_woche_von(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soll_woche_von(uuid) TO authenticated;

-- Birgit Köstenberger (geringfügig) laut Muster vom 22.10.2026:
-- Mo–Mi 2 h, Do 1 h (ungerade KW) bzw. 1,5 h (gerade KW), Fr frei.
UPDATE public.profile_konten_settings
   SET soll_woche = '{"woche":[2,2,2,1,0,0,0],"gerade_kw":[2,2,2,1.5,0,0,0]}'::jsonb
 WHERE profile_id = 'd8c04eee-5211-4e36-8e08-0fd188b08ee0';

NOTIFY pgrst, 'reload schema';
