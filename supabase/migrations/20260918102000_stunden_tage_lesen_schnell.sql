-- Dieselbe Regel, nur schnell: Die Prüfung „steht am selben Tag auf
-- derselben Einteilung" lief als Unterabfrage je Zeile durch die
-- Rechteregeln von einteilungen und einteilung_mitarbeiter — für einen
-- Mitarbeiter über eine Sekunde. Als SECURITY-DEFINER-Funktion sind es zwei
-- Index-Zugriffe. Sie verrät nichts: nur ja oder nein zu einem Tag.
create or replace function public.gemeinsame_einteilung(_user uuid, _mitarbeiter uuid, _datum date)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.einteilung_mitarbeiter em_ich
      join public.einteilungen e on e.id = em_ich.einteilung_id
      join public.einteilung_mitarbeiter em_er on em_er.einteilung_id = e.id
     where em_ich.mitarbeiter_id = _user
       and em_er.mitarbeiter_id = _mitarbeiter
       and e.datum = _datum
  );
$$;

revoke all on function public.gemeinsame_einteilung(uuid, uuid, date) from public;
grant execute on function public.gemeinsame_einteilung(uuid, uuid, date) to authenticated;

drop policy if exists stunden_tage_select on public.stunden_tage;
create policy stunden_tage_select on public.stunden_tage
  for select to authenticated
  using (
    mitarbeiter_id = (select auth.uid())
    or (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'stunden.edit_alle'))
    or (select public.has_permission((select auth.uid()), 'stunden.view_alle'))
    or (select public.has_permission((select auth.uid()), 'arbeitsplanung.abwesenheiten'))
    or mitarbeiter_id in (
         select p.id
           from public.profiles p
          where p.partie_id in (
                  select pa.id from public.partien pa where pa.partieleiter_id = (select auth.uid())
                  union
                  select me.partie_id from public.profiles me
                   where me.id = (select auth.uid())
                     and me.partie_id is not null
                     and (select public.has_permission((select auth.uid()), 'stunden.view_partie'))
                )
       )
    or public.gemeinsame_einteilung((select auth.uid()), mitarbeiter_id, datum)
  );

-- Tätigkeiten: erst die schnellen Antworten, dann der Blick auf den Tag.
drop policy if exists st_select on public.stunden_taetigkeiten;
create policy st_select on public.stunden_taetigkeiten
  for select to authenticated
  using (
    (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'stunden.view_alle'))
    or exists (select 1 from public.stunden_tage t where t.id = stunden_taetigkeiten.stunden_tag_id)
  );

create index if not exists einteilungen_datum_idx on public.einteilungen (datum);
