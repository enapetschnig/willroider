-- Berichte-Archiv: fertige Tätigkeitsberichte (nach Freigabe) und
-- Stundenberichte (nach Bestätigung) als PDF in der App aufheben und als
-- Kopie nach SharePoint legen. Abgestimmt mit Johannes Maurer (21.09.2026):
-- beides, Ablage erst wenn fertig, in SharePoint Unterordner je Jahr,
-- Mailversand ans Lohnbüro gesammelt.
--
--   bericht_archiv     eine Zeile je abgelegtem PDF
--   Bucket             berichte-archiv (privat)
--   app_settings       bericht_ablage → SharePoint-Ziele je Art
--   Cron               bericht-ablage-nachholen (alle 10 Min): fehlende SharePoint-Kopien

create table if not exists public.bericht_archiv (
  id                 uuid primary key default gen_random_uuid(),
  art                text not null check (art in ('taetigkeitsbericht', 'stundenbericht')),
  mitarbeiter_id     uuid not null references public.profiles(id) on delete cascade,
  jahr               integer not null,
  monat              integer not null,
  teil               integer,                 -- Stundenbericht: 1 | 2, Tätigkeitsbericht: null
  periode_label      text not null,           -- „August - September 2026" / „September 2026 · Teil I"
  storage_pfad       text not null,
  dateiname          text not null,
  groesse            integer,
  sharepoint_item_id text,
  sharepoint_web_url text,
  sharepoint_fehler  text,
  sharepoint_am      timestamptz,
  bericht_id         uuid,                    -- stunden_berichte.id (nur Stundenbericht)
  versendet_am       timestamptz,
  versendet_an       text,
  erstellt_von       uuid references public.profiles(id) on delete set null,
  erstellt_am        timestamptz not null default now()
);
create index if not exists bericht_archiv_periode on public.bericht_archiv (art, jahr desc, monat desc, teil);
create index if not exists bericht_archiv_ma on public.bericht_archiv (mitarbeiter_id, art);

alter table public.bericht_archiv enable row level security;

-- Lesen: sich selbst, Verwaltung, wer freigibt/bestätigt, wer fremde Tätigkeitsberichte sieht.
drop policy if exists bericht_archiv_select on public.bericht_archiv;
create policy bericht_archiv_select on public.bericht_archiv
  for select to authenticated
  using (
    mitarbeiter_id = (select auth.uid())
    or (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'stunden.taetigkeitsbericht.freigeben'))
    or (select public.has_permission((select auth.uid()), 'stunden.bsb.bestaetigen'))
    or (art = 'taetigkeitsbericht' and (select public.has_permission((select auth.uid()), 'stunden.taetigkeitsbericht')))
  );

-- Anlegen: wer freigibt (Tätigkeitsbericht) bzw. bestätigt (Stundenbericht) — oder Verwaltung.
drop policy if exists bericht_archiv_insert on public.bericht_archiv;
create policy bericht_archiv_insert on public.bericht_archiv
  for insert to authenticated
  with check (
    (select public.is_admin_role((select auth.uid())))
    or (art = 'taetigkeitsbericht' and (select public.has_permission((select auth.uid()), 'stunden.taetigkeitsbericht.freigeben')))
    or (art = 'stundenbericht' and (select public.has_permission((select auth.uid()), 'stunden.bsb.bestaetigen')))
  );

drop policy if exists bericht_archiv_delete on public.bericht_archiv;
create policy bericht_archiv_delete on public.bericht_archiv
  for delete to authenticated
  using ((select public.is_admin_role((select auth.uid()))));

-- Bucket
insert into storage.buckets (id, name, public)
values ('berichte-archiv', 'berichte-archiv', false)
on conflict (id) do nothing;

drop policy if exists berichte_archiv_select on storage.objects;
create policy berichte_archiv_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'berichte-archiv'
    and (
      public.is_admin_role(auth.uid())
      or public.has_permission(auth.uid(), 'stunden.taetigkeitsbericht.freigeben')
      or public.has_permission(auth.uid(), 'stunden.bsb.bestaetigen')
      or public.has_permission(auth.uid(), 'stunden.taetigkeitsbericht')
      -- eigene Datei: Pfad <art>/<jahr>/<mitarbeiter_id>/…
      or split_part(name, '/', 3) = auth.uid()::text
    )
  );

drop policy if exists berichte_archiv_insert on storage.objects;
create policy berichte_archiv_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'berichte-archiv'
    and (
      public.is_admin_role(auth.uid())
      or public.has_permission(auth.uid(), 'stunden.taetigkeitsbericht.freigeben')
      or public.has_permission(auth.uid(), 'stunden.bsb.bestaetigen')
    )
  );

-- Cron: fehlende SharePoint-Kopien nachholen (z. B. wenn Graph kurz nicht erreichbar war).
do $$
begin
  perform cron.unschedule('bericht-ablage-nachholen');
exception when others then null;
end $$;

select cron.schedule(
  'bericht-ablage-nachholen',
  '7,17,27,37,47,57 * * * *',
  $job$
    select net.http_post(
      url := 'https://ylqbxnsxksbtsqrcwtuq.supabase.co/functions/v1/bericht-ablegen',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"modus":"nachholen"}'::jsonb,
      timeout_milliseconds := 120000)
  $job$
);

notify pgrst, 'reload schema';
