-- =====================================================================
-- Polier darf für alle Mitarbeiter Stunden schreiben, nicht nur für die
-- eigene Partie.
--
-- Änderungswunsch B. Sirnitzer 07.10.: „Hier muss der Polier alle
-- Mitarbeiter auswählen können. Wenn jemand krank ist und/oder bei einem
-- anderen Polier ist, sollte der Polier diesen auswählen können und nicht
-- wir im Büro die ganze Partie-Einteilung ändern müssen."
--
-- Schreiben durfte er schon (Recht „stunden.create_andere"). Es fehlte:
--   1) Tage, die er selbst für jemanden erfasst hat, wieder lesen —
--      sonst scheitert schon das Speichern (insert … returning) und er
--      sieht danach nicht, was er gebucht hat.
--   2) Erkennen, ob jemand außerhalb seiner Sicht für den Tag schon
--      Stunden hat — ohne preiszugeben, was dort steht (Urlaub/Krank
--      bleiben seit 18.09. verborgen). Dafür nur Ja/Nein je Person.
-- =====================================================================

-- 1) Lesen: zusätzlich „von mir erfasst"
drop policy if exists stunden_tage_select on public.stunden_tage;
create policy stunden_tage_select on public.stunden_tage
  for select to authenticated
  using (
    mitarbeiter_id = (select auth.uid())
    or erfasst_von = (select auth.uid())
    or (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'stunden.edit_alle'))
    or (select public.has_permission((select auth.uid()), 'stunden.view_alle'))
    or (select public.has_permission((select auth.uid()), 'arbeitsplanung.abwesenheiten'))
    or (select public.darf_tb_freigeben((select auth.uid())))
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

-- 2) Wer von diesen Personen hat an dem Tag schon einen Eintrag?
--    Nur für Leute, die für andere Stunden schreiben dürfen. Liefert nur
--    die IDs — keine Stunden, keine Art (Urlaub/Krank).
create or replace function public.stunden_tag_vorhanden(_datum date, _ids uuid[])
returns setof uuid
language sql
stable security definer
set search_path = public
as $$
  select t.mitarbeiter_id
    from public.stunden_tage t
   where t.datum = _datum
     and t.mitarbeiter_id = any(_ids)
     and (
       public.is_admin_role(auth.uid())
       or public.has_permission(auth.uid(), 'stunden.create_andere')
       or exists (select 1 from public.partien pa where pa.partieleiter_id = auth.uid())
     );
$$;

revoke all on function public.stunden_tag_vorhanden(date, uuid[]) from public, anon;
grant execute on function public.stunden_tag_vorhanden(date, uuid[]) to authenticated;
