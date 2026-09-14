-- Rechte auf die gespiegelten SharePoint-Dateien: gleiche Regel, aber
-- einmal statt je Datei ausgewertet.
--
-- Vorher rief die Regel `darf_ordner_sehen` für jede einzelne Zeile auf.
-- Bei einer Baustelle mit 4.000 Dateien dauerte das rund zwölf Sekunden.
-- Jetzt liefert `sichtbare_ordner` die erlaubten Ordner einmal je Person;
-- der Vergleich je Zeile ist dann nur noch ein Test auf Zugehörigkeit.
-- Die Klammer-Schreibweise `(select …)` ist dabei wesentlich: nur so wertet
-- die Datenbank den Aufruf einmal aus und nicht je Zeile.
--
-- Inhaltlich gilt weiterhin genau dasselbe wie in `darf_ordner_sehen`:
-- Ausnahme je Person schlägt den Rollenstandard, Prüfer sehen alles, und
-- im Schriftverkehr sehen Nicht-Prüfer nur Tages- und Regieberichte.

create or replace function public.sichtbare_ordner(_user uuid)
returns text[]
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_liste text[];
  v_rolle text;
begin
  if _user is null then return array[]::text[]; end if;
  select p.ordner_sichtbar into v_liste from public.profiles p where p.id = _user;
  if v_liste is not null then return v_liste; end if;

  select r.schluessel into v_rolle
    from public.user_roles ur join public.rollen r on r.id = ur.rolle_id
   where ur.user_id = _user limit 1;
  select array(select jsonb_array_elements_text((s.value::jsonb)->coalesce(v_rolle, 'mitarbeiter')))
    into v_liste
    from public.app_settings s where s.key = 'ordner_visibility';
  if v_liste is null or array_length(v_liste, 1) is null then
    v_liste := array['91-plaene','2-schriftverkehr','evaluierung','95-leistungsverzeichnis','fotos'];
  end if;
  return v_liste;
end $$;

comment on function public.sichtbare_ordner(uuid) is
  'Erlaubte Baustellen-Ordner einer Person (Ausnahme je Person vor Rollenstandard). '
  'Für Regeln gedacht, die sonst je Zeile prüfen müssten.';

-- Prüfer im Sinne der Ordnerregel: Verwaltung oder freigabeberechtigt,
-- aber nur solange für die Person keine eigene Ordnerliste hinterlegt ist.
create or replace function public.ordner_pruefer(_user uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.is_admin_role(_user)
      or (public.can_review(_user)
          and (select p.ordner_sichtbar from public.profiles p where p.id = _user) is null);
$$;

drop policy if exists sharepoint_dateien_select on public.sharepoint_dateien;
create policy sharepoint_dateien_select on public.sharepoint_dateien
  for select using (
    (select auth.uid()) is not null
    and verschwunden_am is null
    and (
      (select public.ordner_pruefer((select auth.uid())))
      or (
        ordner in (select unnest(public.sichtbare_ordner((select auth.uid()))))
        and (
          ordner <> '2-schriftverkehr'
          or coalesce(subpath, '') ~ '^(tagesberichte|regieberichte)(/|$)'
        )
      )
    )
  );
