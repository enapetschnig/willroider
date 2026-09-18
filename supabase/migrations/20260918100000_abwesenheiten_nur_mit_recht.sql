-- Urlaub und Krankenstand nicht mehr für jeden sichtbar.
--
-- Änderungswunsch von Bua Sirnitzer (18.09.): Die Leute auf der Baustelle
-- sollen die Urlaubsplanung und Krankenstände nicht sehen. Niklas Gwenger
-- dazu: den Reiter „Mitarbeiter" in der Jahresplanung ausblenden.
--
-- Den Reiter zu verstecken wäre Kosmetik gewesen: Die Tabelle stunden_tage
-- (Tagesstatus, Urlaub, Krank, Stunden) war für jeden Angemeldeten lesbar,
-- die Regel lautete schlicht „true". Dasselbe bei stunden_taetigkeiten.
-- Deshalb hier die Regel selbst, und dazu ein eigenes Recht.
--
-- Wer sieht künftig fremde Tage?
--   • Verwaltung / Geschäftsführung (is_admin_role)
--   • wer Stunden für andere schreibt, alle bearbeitet oder auswertet
--   • wer das neue Recht „Abwesenheiten sehen" hat (Vorgabe: Büro, GF)
--   • der Partieleiter für seine eigene Partie — sonst plant er jemanden
--     ein, der gar nicht da ist
--   • wer am selben Tag auf derselben Einteilung steht — für den
--     Bautagesbericht und den Tagesplan auf der Baustelle
--   • jeder sich selbst
-- Die Schreibweise (select …) ist Absicht: So wertet die Datenbank die
-- Rechte einmal je Abfrage aus, nicht je Zeile.

insert into public.berechtigungen
  (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order)
values
  ('arbeitsplanung.abwesenheiten', 'arbeitsplanung', 'view', 'abwesenheiten',
   'Abwesenheiten sehen',
   'Urlaub und Krankenstand aller Mitarbeiter in der Jahresplanung (Reiter Mitarbeiter, Block Urlaube)',
   false, 522)
on conflict (schluessel) do nothing;

insert into public.rollen_berechtigungen (rolle_id, berechtigung_id)
select r.id, b.id
  from public.rollen r, public.berechtigungen b
 where r.schluessel in ('geschaeftsfuehrung', 'buero')
   and b.schluessel = 'arbeitsplanung.abwesenheiten'
on conflict do nothing;

drop policy if exists stunden_tage_select_all on public.stunden_tage;
drop policy if exists stunden_tage_select on public.stunden_tage;
create policy stunden_tage_select on public.stunden_tage
  for select to authenticated
  using (
    mitarbeiter_id = (select auth.uid())
    or (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'stunden.create_andere'))
    or (select public.has_permission((select auth.uid()), 'stunden.edit_alle'))
    or (select public.has_permission((select auth.uid()), 'stunden.view_alle'))
    or (select public.has_permission((select auth.uid()), 'arbeitsplanung.abwesenheiten'))
    or mitarbeiter_id in (select public.planung_sichtbare_mitarbeiter((select auth.uid())))
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

-- Die Tätigkeiten hängen am Tag: sichtbar genau dann, wenn der Tag sichtbar ist.
drop policy if exists st_select_all on public.stunden_taetigkeiten;
drop policy if exists st_select on public.stunden_taetigkeiten;
create policy st_select on public.stunden_taetigkeiten
  for select to authenticated
  using (
    exists (select 1 from public.stunden_tage t where t.id = stunden_taetigkeiten.stunden_tag_id)
  );

create index if not exists einteilung_mitarbeiter_ma_idx
  on public.einteilung_mitarbeiter (mitarbeiter_id, einteilung_id);
