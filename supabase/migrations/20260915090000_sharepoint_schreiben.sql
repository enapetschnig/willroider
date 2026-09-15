-- Stufe 2: Die App darf in SharePoint anlegen und hochladen.
--
-- Was weiterhin ausgeschlossen bleibt: löschen, überschreiben, umbenennen,
-- verschieben. Gerät eine Datei mit gleichem Namen ins Ziel, wird die
-- vorhandene nie ersetzt — entweder ist es dieselbe Datei (dann wird nur
-- verknüpft) oder die neue landet mit angehängter Nummer daneben.
--
-- Neue Ordner entstehen als Kopie der Vorlage des jeweiligen Teams, genau
-- so wie die Bauleiter es von Hand machen. Vorher wird geprüft, ob es den
-- Ordner schon gibt oder gerade erst angelegt wurde.

-- ── Teams: wie neue Ordner heißen und wo sie hinkommen ────────────────
alter table public.sharepoint_teams
  add column if not exists neu_pfad        text not null default '/General',
  add column if not exists namens_muster   text not null default '{ks} {name}',
  add column if not exists variante        text,
  add column if not exists vorlage_item_id text,
  add column if not exists vorlage_pfad    text;

comment on column public.sharepoint_teams.namens_muster is
  'Wie der Ordner heißen soll. {ks} = Kostenstelle, {ks_lz} = Kostenstelle mit '
  'Leerzeichen nach 140, {name} = Bauvorhaben.';

-- ── Wohin eine App-Datei in SharePoint gehört ─────────────────────────
create table if not exists public.sharepoint_upload_ziel (
  variante   text not null,
  app_ordner text not null,
  sp_pfad    text not null,
  primary key (variante, app_ordner)
);

insert into public.sharepoint_upload_ziel (variante, app_ordner, sp_pfad) values
  ('A','1-baustellenmanagement','1-Baustellenmanagement'),
  ('A','2-schriftverkehr','2-Schriftverkehr'),
  ('A','3-aktenvermerke','3-Aktenvermerke'),
  ('A','4-vertrag','4-Vertrag'),
  ('A','5-subunternehmer-professionisten','5-Subunternehmer-Professionisten'),
  ('A','6-abrechnung','6-Abrechnung'),
  ('A','7-lieferanten','7-Lieferanten'),
  ('A','8-kalkulation','8-Kalkulation'),
  ('A','91-plaene','91-Pläne'),
  ('A','92-sonstiges','92-Sonstiges'),
  ('A','93-dhp','93-DHP'),
  ('A','94-statik','94-Statik'),
  ('A','95-leistungsverzeichnis','8-Kalkulation/Leistungsverzeichnis'),
  ('A','fotos','92-Sonstiges/Fotos'),
  ('A','evaluierung','1-Baustellenmanagement/Unterweisung'),
  ('B','1-baustellenmanagement','1-Baustellenmanagement'),
  ('B','2-schriftverkehr','2-Vertrag, Schriftverkehr'),
  ('B','3-aktenvermerke','3-Aktenvermerke'),
  ('B','4-vertrag','2-Vertrag, Schriftverkehr'),
  ('B','5-subunternehmer-professionisten','5-Subunternehmer-Professionisten'),
  ('B','6-abrechnung','7-Abrechnung'),
  ('B','7-lieferanten','6-Lieferanten'),
  ('B','8-kalkulation','4-Kalkulation'),
  ('B','91-plaene','9-Pläne'),
  ('B','92-sonstiges','92-Sonstiges'),
  ('B','93-dhp','93-DHP'),
  ('B','94-statik','94-Statik'),
  ('B','95-leistungsverzeichnis','4-Kalkulation/Leistungsverzeichnis'),
  ('B','fotos','92-Sonstiges/Fotos'),
  ('B','evaluierung','1-Baustellenmanagement/Unterweisung'),
  ('C','1-baustellenmanagement','1-Baustellenmanagement'),
  ('C','2-schriftverkehr','2-Vertrag-Schriftverkehr'),
  ('C','3-aktenvermerke','3-Aktenvermerke'),
  ('C','4-vertrag','2-Vertrag-Schriftverkehr'),
  ('C','5-subunternehmer-professionisten','5-Subunternehmer'),
  ('C','6-abrechnung','7-Abrechnung'),
  ('C','7-lieferanten','6-Lieferanten'),
  ('C','8-kalkulation','4-Kalkulation'),
  ('C','91-plaene','9-Pläne'),
  ('C','92-sonstiges','92-Sonstiges'),
  ('C','93-dhp','8-DHP'),
  ('C','94-statik','94-Statik'),
  ('C','95-leistungsverzeichnis','4-Kalkulation/Leistungsverzeichnis'),
  ('C','fotos','9-Pläne/Fotos'),
  ('C','evaluierung','1-Baustellenmanagement/Unterweisung')
on conflict (variante, app_ordner) do nothing;

alter table public.sharepoint_upload_ziel enable row level security;
drop policy if exists sharepoint_upload_ziel_select on public.sharepoint_upload_ziel;
create policy sharepoint_upload_ziel_select on public.sharepoint_upload_ziel
  for select using (auth.uid() is not null);

-- ── Welche App-Datei liegt schon in SharePoint ────────────────────────
alter table public.dokumente
  add column if not exists sharepoint_item_id text,
  add column if not exists sharepoint_am      timestamptz,
  add column if not exists sharepoint_fehler  text;

create index if not exists dokumente_sharepoint_offen_idx
  on public.dokumente (baustelle_id)
  where sharepoint_item_id is null and baustelle_id is not null;

-- Gegenstück: gespiegelte Zeile kennt das App-Dokument, damit dieselbe
-- Datei in der App nicht doppelt erscheint.
alter table public.sharepoint_dateien
  add column if not exists dokument_id uuid references public.dokumente(id) on delete set null;

-- ── Hauptschalter ─────────────────────────────────────────────────────
insert into public.app_settings (key, value)
values ('sharepoint_schreiben', 'true'::jsonb)
on conflict (key) do nothing;

-- ── Auftragsliste für das Anlegen neuer Ordner ────────────────────────
-- Wird beim Anlegen einer Baustelle gefüllt und vom Zeitplan abgearbeitet,
-- damit das Anlegen nicht am Browser hängt.
create table if not exists public.sharepoint_auftraege (
  id           uuid primary key default gen_random_uuid(),
  baustelle_id uuid not null references public.baustellen(id) on delete cascade,
  art          text not null default 'ordner_anlegen',
  status       text not null default 'offen',
  versuche     integer not null default 0,
  meldung      text,
  erstellt_am  timestamptz not null default now(),
  erledigt_am  timestamptz
);

create index if not exists sharepoint_auftraege_offen_idx
  on public.sharepoint_auftraege (status, erstellt_am) where status = 'offen';

alter table public.sharepoint_auftraege enable row level security;
drop policy if exists sharepoint_auftraege_select on public.sharepoint_auftraege;
create policy sharepoint_auftraege_select on public.sharepoint_auftraege
  for select using (is_admin_role(auth.uid()) or can_review(auth.uid()));

-- Auftrag anlegen darf, wer die Baustelle anlegen darf.
create or replace function public.sharepoint_ordner_anfordern(p_baustelle uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (is_admin_role(auth.uid()) or can_review(auth.uid())) then
    raise exception 'Keine Berechtigung';
  end if;
  if exists (select 1 from public.baustellen b
              where b.id = p_baustelle and b.sharepoint_item_id is not null) then
    return null;  -- hat schon einen Ordner
  end if;
  select id into v_id from public.sharepoint_auftraege
   where baustelle_id = p_baustelle and status = 'offen' limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.sharepoint_auftraege (baustelle_id) values (p_baustelle) returning id into v_id;
  return v_id;
end $$;
