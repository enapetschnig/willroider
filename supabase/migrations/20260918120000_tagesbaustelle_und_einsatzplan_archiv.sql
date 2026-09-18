-- 1) Neuer Unterweisungs-Typ: „Evaluierung Tagesbaustellen“ (Sicherheits- und
--    Gesundheitsschutzdokument lt. §§ 4-5 ASchG, Vorlage Ingenieurbüro Wulz).
--    Inhalt/Felder liegen in src/lib/unterweisungen.ts, Werte in
--    evaluierungen.checkliste (jsonb, flache Schlüssel f.* / g.* / m.* / t.*).
alter type public.evaluierung_typ add value if not exists 'tagesbaustelle';

-- 2) Archiv der Arbeitseinteilung: jede Woche legt die Edge Function
--    „einsatzplan-pdf“ den Aushang als PDF ab (Storage + SharePoint-Ordner
--    „Einsatzplanung PDF 2026“). Änderungswunsch f40a078a (Egger/Maurer).
create table if not exists public.einsatzplan_archiv (
  id                uuid primary key default gen_random_uuid(),
  jahr              integer not null,
  kw                integer not null,
  von_datum         date not null,
  bis_datum         date not null,
  format            text not null default 'a3',
  storage_pfad      text not null,
  dateiname         text not null,
  groesse           integer,
  sharepoint_item_id text,
  sharepoint_web_url text,
  sharepoint_fehler  text,
  automatisch       boolean not null default false,
  erzeugt_von       uuid references public.profiles(id) on delete set null,
  erzeugt_am        timestamptz not null default now()
);
create index if not exists einsatzplan_archiv_woche on public.einsatzplan_archiv (jahr desc, kw desc, erzeugt_am desc);

alter table public.einsatzplan_archiv enable row level security;

drop policy if exists einsatzplan_archiv_select on public.einsatzplan_archiv;
create policy einsatzplan_archiv_select on public.einsatzplan_archiv
  for select to authenticated
  using (
    (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'arbeitsplanung.view'))
  );

drop policy if exists einsatzplan_archiv_delete on public.einsatzplan_archiv;
create policy einsatzplan_archiv_delete on public.einsatzplan_archiv
  for delete to authenticated
  using ((select public.is_admin_role((select auth.uid()))));

-- Bucket (privat). Lesen darf, wer die Arbeitsplanung sehen darf; schreiben
-- nur die Edge Function (Service-Rolle).
insert into storage.buckets (id, name, public)
values ('einsatzplaene', 'einsatzplaene', false)
on conflict (id) do nothing;

drop policy if exists einsatzplaene_select on storage.objects;
create policy einsatzplaene_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'einsatzplaene'
    and (public.is_admin_role(auth.uid()) or public.has_permission(auth.uid(), 'arbeitsplanung.view'))
  );

-- Ziel-Ordner in SharePoint: Team „Personaleinteilung Zimmerei“ →
-- General / Einsatzplanung PDF 2026 (dort liegen schon die KWxx.pdf aus MS Project).
insert into public.app_settings (key, value)
values ('einsatzplan_sharepoint', jsonb_build_object(
  'drive_id', 'b!JeGMB4ewWk-FkZUw9EKJ9Oc_0-dZruxGr6Dn15M4Of5hp_RwSWkaR4-miRMILkCl',
  'item_id',  '012AXSLZKS4NPO7HYUTNFLDKON7SG4MBFX',
  'name',     'Personaleinteilung Zimmerei / General / Einsatzplanung PDF 2026'))
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Jede Woche Mittwoch 07:00 UTC (09:00 Sommer / 08:00 Winter) — so wie die
-- bisherigen MS-Project-Ausdrucke mittwochs vormittags abgelegt wurden.
do $$
begin
  perform cron.unschedule('einsatzplan-woche');
exception when others then null;
end $$;

select cron.schedule(
  'einsatzplan-woche',
  '0 7 * * 3',
  $job$
    select net.http_post(
      url := 'https://ylqbxnsxksbtsqrcwtuq.supabase.co/functions/v1/einsatzplan-pdf',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"modus":"woche"}'::jsonb,
      timeout_milliseconds := 120000)
  $job$
);

notify pgrst, 'reload schema';
