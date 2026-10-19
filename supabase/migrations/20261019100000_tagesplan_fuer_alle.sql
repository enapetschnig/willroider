-- Tagesplan für alle (Wunsch E. Winkler, 19.10.2026): „Jeder Mitarbeiter
-- sollte den kompletten Tagesplan in seiner App sehen, nicht nur die
-- Baustellen, welcher er an diesem Tag zugeteilt ist."
--
-- Regel: Sobald das Büro den Tagesplan eines Tages FREIGEGEBEN hat, sieht
-- ihn jeder angemeldete Mitarbeiter komplett — so wie den Aushang
-- „Arbeitseinteilung Zimmerei". Vor der Freigabe bleibt es bei der
-- bisherigen Sichtbarkeit (Verwaltung, Polier eigene Partie, man selbst).

create or replace function public.tagesplan_freigegeben(_datum date)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.tagesplanung_freigaben f
     where f.datum = _datum and f.freigegeben_am is not null
  );
$$;

create or replace function public.darf_einteilung_sehen(_user uuid, _einteilung uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  SELECT public.is_admin_role(_user)
      OR public.has_permission(_user, 'arbeitsplanung.view')
      OR EXISTS (
           SELECT 1
             FROM public.einteilung_mitarbeiter em
            WHERE em.einteilung_id = _einteilung
              AND em.mitarbeiter_id IN (
                    SELECT public.planung_sichtbare_mitarbeiter(_user)
                  )
         )
      -- Freigegebener Tagesplan: für alle Angemeldeten sichtbar.
      OR (_user IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.einteilungen e
            WHERE e.id = _einteilung
              AND public.tagesplan_freigegeben(e.datum)
         ));
$function$;

drop policy if exists einteilung_ma_select on public.einteilung_mitarbeiter;
create policy einteilung_ma_select on public.einteilung_mitarbeiter
  for select using (
    is_admin_role(auth.uid())
    or has_permission(auth.uid(), 'arbeitsplanung.view'::text)
    or (mitarbeiter_id in (select planung_sichtbare_mitarbeiter(auth.uid())))
    or darf_einteilung_sehen(auth.uid(), einteilung_id)
  );

-- Abwesende des Tages für den Tagesplan (Urlaub, Krank, Schlechtwetter,
-- Berufs-/Polierschule) — dieselben Angaben wie der Aushang, ohne dass
-- Mitarbeiter die Stunden oder Urlaubsanträge der Kollegen lesen dürfen.
-- Nur für freigegebene Tage (oder Verwaltung/Planung).
create or replace function public.tagesplan_abwesende(p_datum date)
returns table (quelle text, mitarbeiter_id uuid, tag_status text, von date, bis date)
language sql
stable security definer
set search_path to 'public'
as $$
  with darf as (
    select public.tagesplan_freigegeben(p_datum)
        or public.is_admin_role(auth.uid())
        or public.has_permission(auth.uid(), 'arbeitsplanung.view') as ok
  )
  select 'tag'::text, st.mitarbeiter_id, st.tag_status::text, null::date, null::date
    from public.stunden_tage st, darf
   where darf.ok
     and st.datum = p_datum
     and st.tag_status in ('urlaub', 'krank', 'schlechtwetter', 'berufsschule', 'polierschule')
  union all
  select 'antrag'::text, ua.mitarbeiter_id, 'urlaub'::text, ua.von, ua.bis
    from public.urlaubsantraege ua, darf
   where darf.ok
     and ua.status = 'genehmigt'
     and p_datum between ua.von and ua.bis;
$$;

grant execute on function public.tagesplan_abwesende(date) to authenticated;
grant execute on function public.tagesplan_freigegeben(date) to authenticated;
