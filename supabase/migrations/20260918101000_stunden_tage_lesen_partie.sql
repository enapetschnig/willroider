-- Nachschärfung zur vorigen Regel: „Stunden für andere erfassen" (Vorarbeiter)
-- machte über planung_sichtbare_mitarbeiter alle 47 Personen lesbar — damit
-- hätte Bua weiterhin alle Urlaube gesehen. Lesen fremder Tage jetzt nur:
--   • Verwaltung, Auswertung, Bearbeiten-alle, Abwesenheiten-Recht → alle
--   • eigene Partie: als Partieleiter oder mit „Stunden der Partie sehen"
--   • wer am selben Tag auf derselben Einteilung steht
--   • sich selbst
-- Schreiben für andere bleibt wie bisher; im Alltag betrifft das die eigene
-- Partie und die Leute auf der eigenen Einteilung — beides bleibt lesbar.

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
         -- eigene Partie: geführt oder zugehörig (mit Partie-Recht)
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
    or exists (
         select 1
           from public.einteilung_mitarbeiter em_ich
           join public.einteilungen e on e.id = em_ich.einteilung_id
           join public.einteilung_mitarbeiter em_er on em_er.einteilung_id = e.id
          where em_ich.mitarbeiter_id = (select auth.uid())
            and em_er.mitarbeiter_id = stunden_tage.mitarbeiter_id
            and e.datum = stunden_tage.datum
       )
  );
