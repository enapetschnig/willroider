-- Verzeichnis der Baustellenordner, die es in SharePoint gibt.
--
-- Damit lässt sich in der App nachschlagen, welcher Ordner zu einer
-- Baustelle gehört, ohne dass jemand in SharePoint suchen muss. Das
-- Verzeichnis wird gelesen und neu geschrieben — in SharePoint selbst
-- ändert sich dadurch nichts.

-- Die Teams der Bauleiter, in denen die Baustellen liegen.
create table if not exists public.sharepoint_teams (
  site_id     text primary key,
  site_name   text not null,
  drive_id    text,
  bauleiter_id uuid references public.profiles(id),
  wurzel      text not null default '/General',
  aktiv       boolean not null default true,
  angelegt_am timestamptz not null default now()
);

create table if not exists public.sharepoint_ordner (
  item_id     text primary key,
  site_id     text not null,
  site_name   text not null,
  drive_id    text not null,
  name        text not null,
  pfad        text not null,
  web_url     text,
  variante    text,
  archiv      boolean not null default false,
  kostenstelle text,
  gesehen_am  timestamptz not null default now()
);

create index if not exists sharepoint_ordner_name_idx on public.sharepoint_ordner (lower(name));
create index if not exists sharepoint_ordner_ks_idx on public.sharepoint_ordner (kostenstelle);

alter table public.sharepoint_teams  enable row level security;
alter table public.sharepoint_ordner enable row level security;

drop policy if exists sharepoint_teams_select on public.sharepoint_teams;
create policy sharepoint_teams_select on public.sharepoint_teams
  for select using (is_admin_role(auth.uid()) or can_review(auth.uid()));

drop policy if exists sharepoint_ordner_select on public.sharepoint_ordner;
create policy sharepoint_ordner_select on public.sharepoint_ordner
  for select using (is_admin_role(auth.uid()) or can_review(auth.uid()));

-- Überblick für die Verwaltung: welche Baustelle hat einen Ordner,
-- wie viele Dateien liegen dort, wann war der letzte Abgleich.
create or replace view public.v_sharepoint_status
with (security_invoker = true) as
select
  b.id                      as baustelle_id,
  b.kostenstelle,
  b.bvh_name,
  b.status,
  b.bauleiter_id,
  b.sharepoint_site_name,
  b.sharepoint_pfad,
  b.sharepoint_web_url,
  b.sharepoint_variante,
  b.sharepoint_abgleich_am,
  (b.sharepoint_item_id is not null)              as verknuepft,
  (select count(*) from public.sharepoint_dateien d
     where d.baustelle_id = b.id and d.verschwunden_am is null) as dateien,
  v.pfad                    as vorschlag_pfad,
  v.site_name               as vorschlag_site,
  v.item_id                 as vorschlag_item_id,
  v.drive_id                as vorschlag_drive_id,
  v.site_id                 as vorschlag_site_id,
  v.web_url                 as vorschlag_web_url,
  v.variante                as vorschlag_variante,
  v.grund                   as vorschlag_grund
from public.baustellen b
left join public.sharepoint_vorschlaege v on v.baustelle_id = b.id;
