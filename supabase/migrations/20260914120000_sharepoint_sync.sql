-- SharePoint-/OneDrive-Abgleich, Stufe 1: nur lesen.
--
-- Grundregel, die im ganzen System gilt: In SharePoint wird NIE etwas
-- gelöscht und (in dieser Stufe) auch nichts angelegt. Die App spiegelt
-- lediglich, was dort liegt. Verschwindet eine Datei in SharePoint, wird
-- die Spiegelzeile als „verschwunden" markiert und ausgeblendet — gelöscht
-- wird nur hier, nie dort.
--
-- Die Baustellenordner liegen nicht im persönlichen OneDrive, sondern in
-- den Teams der Bauleiter (SharePoint-Websites, Bibliothek „Dokumente",
-- Kanalordner „General").

-- ── Zuordnung Baustelle ↔ SharePoint-Ordner ───────────────────────────
alter table public.baustellen
  add column if not exists sharepoint_site_id   text,
  add column if not exists sharepoint_site_name text,
  add column if not exists sharepoint_drive_id  text,
  add column if not exists sharepoint_item_id   text,
  add column if not exists sharepoint_pfad      text,
  add column if not exists sharepoint_web_url   text,
  add column if not exists sharepoint_variante  text,
  add column if not exists sharepoint_abgleich_am timestamptz;

comment on column public.baustellen.sharepoint_item_id is
  'Ordner-ID des Baustellenordners in SharePoint. Gesetzt = wird gespiegelt.';

create index if not exists baustellen_sharepoint_item_idx
  on public.baustellen (sharepoint_item_id) where sharepoint_item_id is not null;

-- ── Vorschläge, die noch jemand bestätigen muss ────────────────────────
create table if not exists public.sharepoint_vorschlaege (
  baustelle_id uuid primary key references public.baustellen(id) on delete cascade,
  site_id      text not null,
  site_name    text not null,
  drive_id     text not null,
  item_id      text not null,
  pfad         text not null,
  web_url      text,
  variante     text,
  score        integer,
  grund        text,
  erstellt_am  timestamptz not null default now()
);

-- ── Ordner-Übersetzung: SharePoint-Ordnername → App-Ordner ────────────
-- Drei Varianten, je nachdem wer den Ordner seinerzeit angelegt hat:
--   A = wie in der App (Maurer, Gwenger)
--   B = ältere Vorlage (Winkler, Egger Sebastian, Pließnig)
--   C = Vorlage Eckart Egger
create table if not exists public.sharepoint_ordner_mapping (
  id             uuid primary key default gen_random_uuid(),
  variante       text not null,
  sp_ordner      text not null,
  app_ordner     text not null,
  subpath_prefix text,
  unique (variante, sp_ordner)
);

insert into public.sharepoint_ordner_mapping (variante, sp_ordner, app_ordner, subpath_prefix) values
  ('A','1-Baustellenmanagement','1-baustellenmanagement',null),
  ('A','2-Schriftverkehr','2-schriftverkehr',null),
  ('A','3-Aktenvermerke','3-aktenvermerke',null),
  ('A','4-Vertrag','4-vertrag',null),
  ('A','5-Subunternehmer-Professionisten','5-subunternehmer-professionisten',null),
  ('A','6-Abrechnung','6-abrechnung',null),
  ('A','7-Lieferanten','7-lieferanten',null),
  ('A','8-Kalkulation','8-kalkulation',null),
  ('A','91-Pläne','91-plaene',null),
  ('A','92-Sonstiges','92-sonstiges',null),
  ('A','93-DHP','93-dhp',null),
  ('A','94-Statik','94-statik',null),
  ('B','1-Baustellenmanagement','1-baustellenmanagement',null),
  ('B','2-Vertrag, Schriftverkehr','2-schriftverkehr',null),
  ('B','3-Aktenvermerke','3-aktenvermerke',null),
  ('B','4-Kalkulation','8-kalkulation',null),
  ('B','5-Subunternehmer-Professionisten','5-subunternehmer-professionisten',null),
  ('B','6-Lieferanten','7-lieferanten',null),
  ('B','7-Abrechnung','6-abrechnung',null),
  ('B','8-Ausarbeitung','91-plaene','Ausarbeitung'),
  ('B','9-Pläne','91-plaene',null),
  ('B','92-Sonstiges','92-sonstiges',null),
  ('B','93-DHP','93-dhp',null),
  ('B','94-Statik','94-statik',null),
  ('C','1-Baustellenmanagement','1-baustellenmanagement',null),
  ('C','2-Vertrag-Schriftverkehr','2-schriftverkehr',null),
  ('C','3-Aktenvermerke','3-aktenvermerke',null),
  ('C','4-Kalkulation','8-kalkulation',null),
  ('C','5-Subunternehmer','5-subunternehmer-professionisten',null),
  ('C','6-Lieferanten','7-lieferanten',null),
  ('C','7-Abrechnung','6-abrechnung',null),
  ('C','8-DHP','93-dhp',null),
  ('C','9-Pläne','91-plaene',null),
  ('C','92-Sonstiges','92-sonstiges',null)
on conflict (variante, sp_ordner) do nothing;

-- ── Gespiegelte Dateien (nur Metadaten, kein Inhalt) ──────────────────
create table if not exists public.sharepoint_dateien (
  id             uuid primary key default gen_random_uuid(),
  baustelle_id   uuid not null references public.baustellen(id) on delete cascade,
  drive_id       text not null,
  item_id        text not null,
  ordner         text,
  subpath        text,
  sp_pfad        text not null,
  dateiname      text not null,
  groesse        bigint,
  mimetype       text,
  web_url        text,
  geaendert_am   timestamptz,
  geaendert_von  text,
  etag           text,
  gesehen_am     timestamptz not null default now(),
  verschwunden_am timestamptz,
  unique (drive_id, item_id)
);

comment on table public.sharepoint_dateien is
  'Spiegel der Dateien aus dem SharePoint-Ordner der Baustelle. Nur Metadaten; '
  'der Inhalt bleibt in SharePoint und wird bei Bedarf über die Edge Function geholt. '
  'verschwunden_am = in SharePoint nicht mehr gefunden — dort wird nie gelöscht.';

create index if not exists sharepoint_dateien_baustelle_idx
  on public.sharepoint_dateien (baustelle_id, ordner, subpath)
  where verschwunden_am is null;

-- ── Lauf-Protokoll ────────────────────────────────────────────────────
create table if not exists public.sharepoint_laeufe (
  id            uuid primary key default gen_random_uuid(),
  modus         text not null,
  gestartet_am  timestamptz not null default now(),
  beendet_am    timestamptz,
  baustellen    integer default 0,
  dateien_neu   integer default 0,
  dateien_geaendert integer default 0,
  dateien_weg   integer default 0,
  fehler        text,
  details       jsonb
);

create index if not exists sharepoint_laeufe_zeit_idx
  on public.sharepoint_laeufe (gestartet_am desc);

-- ── Rechte ────────────────────────────────────────────────────────────
alter table public.sharepoint_dateien     enable row level security;
alter table public.sharepoint_vorschlaege enable row level security;
alter table public.sharepoint_ordner_mapping enable row level security;
alter table public.sharepoint_laeufe      enable row level security;

-- Sichtbar nach denselben Regeln wie die eigenen Dokumente.
drop policy if exists sharepoint_dateien_select on public.sharepoint_dateien;
create policy sharepoint_dateien_select on public.sharepoint_dateien
  for select using (
    verschwunden_am is null
    and (can_review(auth.uid()) or darf_ordner_sehen(auth.uid(), ordner, subpath))
  );

-- Geschrieben wird ausschließlich von der Edge Function (service_role).
drop policy if exists sharepoint_vorschlaege_select on public.sharepoint_vorschlaege;
create policy sharepoint_vorschlaege_select on public.sharepoint_vorschlaege
  for select using (is_admin_role(auth.uid()));

drop policy if exists sharepoint_mapping_select on public.sharepoint_ordner_mapping;
create policy sharepoint_mapping_select on public.sharepoint_ordner_mapping
  for select using (auth.uid() is not null);

drop policy if exists sharepoint_laeufe_select on public.sharepoint_laeufe;
create policy sharepoint_laeufe_select on public.sharepoint_laeufe
  for select using (is_admin_role(auth.uid()));

-- ── Zuordnung bestätigen / lösen (nur Verwaltung) ─────────────────────
create or replace function public.sharepoint_zuordnung_setzen(
  p_baustelle uuid,
  p_site_id   text,
  p_site_name text,
  p_drive_id  text,
  p_item_id   text,
  p_pfad      text,
  p_web_url   text,
  p_variante  text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_role(auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;
  update public.baustellen set
    sharepoint_site_id = p_site_id,
    sharepoint_site_name = p_site_name,
    sharepoint_drive_id = p_drive_id,
    sharepoint_item_id = p_item_id,
    sharepoint_pfad = p_pfad,
    sharepoint_web_url = p_web_url,
    sharepoint_variante = p_variante
  where id = p_baustelle;
  delete from public.sharepoint_vorschlaege where baustelle_id = p_baustelle;
end $$;

-- Löst nur die Verknüpfung in der App. In SharePoint passiert nichts.
create or replace function public.sharepoint_zuordnung_loesen(p_baustelle uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin_role(auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;
  update public.baustellen set
    sharepoint_site_id = null, sharepoint_site_name = null, sharepoint_drive_id = null,
    sharepoint_item_id = null, sharepoint_pfad = null, sharepoint_web_url = null,
    sharepoint_variante = null, sharepoint_abgleich_am = null
  where id = p_baustelle;
  delete from public.sharepoint_dateien where baustelle_id = p_baustelle;
end $$;
