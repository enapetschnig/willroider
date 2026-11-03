-- Nachtschicht 03.11.2026 — zwei Fehler aus den Supabase-Protokollen.
--
-- 1) Tagesplan: „canceling statement due to statement timeout" / 500 auf
--    /rest/v1/einteilung_mitarbeiter. Die SELECT-Policy rief für JEDE Zeile
--    (≈2.250) darf_einteilung_sehen() → is_admin_role() → has_permission()
--    → planung_sichtbare_mitarbeiter() neu auf. Bei einem normalen
--    Mitarbeiter dauerte die Tagesabfrage ≈10 s (Grenze 8 s).
--    Neu: Die sichtbaren Einteilungen werden EINMAL je Abfrage als Menge
--    berechnet (sichtbare_einteilungen), Rechte-Prüfungen stehen in
--    (select …) und werden damit nur einmal ausgewertet. Sichtbarkeit
--    bleibt exakt gleich wie in 20261019100000_tagesplan_fuer_alle.sql.
--
-- 2) Bautages-/Regiebericht: „new row violates row-level security policy
--    for table berichte" beim Einreichen. berichte_update hatte kein
--    WITH CHECK, also galt USING auch für die neue Zeile (status='entwurf')
--    — ein Polier konnte seinen eigenen Entwurf nie auf 'eingereicht'
--    stellen. Neu: WITH CHECK erlaubt dem Ersteller 'entwurf' und
--    'eingereicht'; Freigeben/Archivieren bleibt Verwaltung.

create or replace function public.sichtbare_einteilungen(_user uuid)
returns setof uuid
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if _user is null then
    return;
  end if;
  if public.is_admin_role(_user)
     or public.has_permission(_user, 'arbeitsplanung.view') then
    return query select e.id from public.einteilungen e;
    return;
  end if;
  return query
    select em.einteilung_id
      from public.einteilung_mitarbeiter em
     where em.mitarbeiter_id in (select public.planung_sichtbare_mitarbeiter(_user))
    union
    select e.id
      from public.einteilungen e
      join public.tagesplanung_freigaben f
        on f.datum = e.datum and f.freigegeben_am is not null;
end;
$$;

revoke all on function public.sichtbare_einteilungen(uuid) from public, anon;
grant execute on function public.sichtbare_einteilungen(uuid) to authenticated;

drop policy if exists einteilung_ma_select on public.einteilung_mitarbeiter;
create policy einteilung_ma_select on public.einteilung_mitarbeiter
  for select using (
    (select public.is_admin_role(auth.uid()))
    or (select public.has_permission(auth.uid(), 'arbeitsplanung.view'::text))
    or mitarbeiter_id in (select public.planung_sichtbare_mitarbeiter(auth.uid()))
    or einteilung_id in (select public.sichtbare_einteilungen(auth.uid()))
  );

drop policy if exists einteilung_ma_modify_admin on public.einteilung_mitarbeiter;
create policy einteilung_ma_modify_admin on public.einteilung_mitarbeiter
  for all to authenticated
  using ((select public.is_admin_role(auth.uid())))
  with check ((select public.is_admin_role(auth.uid())));

drop policy if exists einteilungen_select on public.einteilungen;
create policy einteilungen_select on public.einteilungen
  for select using (
    id in (select public.sichtbare_einteilungen(auth.uid()))
  );

drop policy if exists einteilungen_modify_admin on public.einteilungen;
create policy einteilungen_modify_admin on public.einteilungen
  for all to authenticated
  using ((select public.is_admin_role(auth.uid())))
  with check ((select public.is_admin_role(auth.uid())));

drop policy if exists berichte_update on public.berichte;
create policy berichte_update on public.berichte
  for update to authenticated
  using (
    public.is_admin_role(auth.uid())
    or (status = 'entwurf' and erfasst_von = auth.uid())
  )
  with check (
    public.is_admin_role(auth.uid())
    or (status in ('entwurf', 'eingereicht') and erfasst_von = auth.uid())
  );
