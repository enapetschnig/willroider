-- Leasing Personal (Kundenwunsch 20.10.2026): eigener Reiter in
-- „Mitarbeiter & Partien", einteilbar, Partien zuteilbar, der Polier
-- schreibt Stunden — aber KEIN Zugang zur App.
--
-- Technisch ein normales Profil (profiles hängt an auth.users) mit
-- Platzhalter-Adresse …@willroider.invalid — wie die 26 Bestands-Mitarbeiter
-- ohne Login. Kennzeichen: zeiterfassung_typ = 'leasing'.
--   * kein Baustellenstundenbericht (könnte nie unterschrieben werden)
--   * Stunden prüft das Büro in der Stundenauswertung (Filter Leasing,
--     Summe je Leasing-Firma)
--   * Leasing-Firma optional

alter table public.profiles drop constraint if exists profiles_zeiterfassung_typ_check;
alter table public.profiles add constraint profiles_zeiterfassung_typ_check
  check (zeiterfassung_typ = any (array['bauarbeiter'::text, 'angestellter'::text, 'leasing'::text]));

alter table public.profiles add column if not exists leasing_firma text;
comment on column public.profiles.leasing_firma is 'Verleihfirma bei Leasing Personal (optional)';

CREATE OR REPLACE FUNCTION public.stunden_bericht_erzeugen(p_jahr integer, p_monat integer, p_teil integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von DATE;
  v_bis DATE;
  v_ma_id UUID;
  v_snapshot JSONB;
  v_count INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_role(auth.uid()) THEN
    RAISE EXCEPTION 'nicht berechtigt';
  END IF;
  IF p_teil NOT IN (1, 2) THEN
    RAISE EXCEPTION 'teil muss 1 oder 2 sein';
  END IF;

  v_von := MAKE_DATE(p_jahr, p_monat, CASE p_teil WHEN 1 THEN 1 ELSE 17 END);
  v_bis := CASE p_teil
    WHEN 1 THEN MAKE_DATE(p_jahr, p_monat, 16)
    ELSE (date_trunc('month', MAKE_DATE(p_jahr, p_monat, 1))
          + interval '1 month' - interval '1 day')::date
  END;

  FOR v_ma_id IN
    SELECT DISTINCT st.mitarbeiter_id
    FROM public.stunden_tage st
    JOIN public.profiles p ON p.id = st.mitarbeiter_id AND p.is_active = TRUE
    WHERE st.datum BETWEEN v_von AND v_bis
      -- Leasing Personal (ohne App-Zugang) bekommt keinen Stundenbericht —
      -- es könnte ihn nie unterschreiben (Wunsch 20.10.2026).
      AND COALESCE(p.zeiterfassung_typ, '') NOT IN ('angestellter', 'leasing')
  LOOP
    SELECT COALESCE(jsonb_object_agg(s.datum::text, s.entries), '{}'::jsonb)
      INTO v_snapshot
      FROM (
        SELECT st.datum,
               COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'art', tt.art,
                     'baustelle_id', tt.baustelle_id,
                     'ziel_baustelle_id', tt.ziel_baustelle_id,
                     'ort', tt.ort,
                     'taetigkeit_id', tt.taetigkeit_id,
                     'taetigkeit_freitext', tt.taetigkeit_freitext,
                     'stunden', tt.stunden
                   ) ORDER BY tt.position
                 ) FILTER (WHERE tt.id IS NOT NULL),
                 '[]'::jsonb
               ) AS entries
        FROM public.stunden_tage st
        LEFT JOIN public.stunden_taetigkeiten tt ON tt.stunden_tag_id = st.id
        WHERE st.mitarbeiter_id = v_ma_id
          AND st.datum BETWEEN v_von AND v_bis
        GROUP BY st.datum
      ) s;

    INSERT INTO public.stunden_berichte
      (mitarbeiter_id, jahr, monat, teil, von_datum, bis_datum, status, snapshot)
    VALUES
      (v_ma_id, p_jahr, p_monat, p_teil, v_von, v_bis, 'offen', v_snapshot)
    ON CONFLICT (mitarbeiter_id, jahr, monat, teil) DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $function$
;

-- Registrierungs-Prüfung: Leasing Personal hat keinen Anmeldeweg → „im Büro
-- melden" statt „mit Handynummer/E-Mail anmelden".
create or replace function public.registrierung_pruefen(p_vorname text, p_nachname text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  n text := public.name_norm(p_nachname);
  v text := split_part(public.name_norm(p_vorname), ' ', 1);
  treffer record;
  hat_telefon boolean;
begin
  if n = '' or v = '' then
    return jsonb_build_object('schon_angelegt', false);
  end if;
  select p.id, p.zeiterfassung_typ into treffer
    from public.profiles p
   where p.is_active
     and public.name_norm(p.nachname) = n
     and v = any (string_to_array(public.name_norm(p.vorname), ' '))
   limit 1;
  if treffer.id is null then
    return jsonb_build_object('schon_angelegt', false);
  end if;
  if treffer.zeiterfassung_typ = 'leasing' then
    return jsonb_build_object('schon_angelegt', true, 'anmeldung', 'keine');
  end if;
  select coalesce(u.phone, '') <> '' into hat_telefon from auth.users u where u.id = treffer.id;
  return jsonb_build_object(
    'schon_angelegt', true,
    'anmeldung', case when coalesce(hat_telefon, false) then 'telefon' else 'email' end);
end $$;
