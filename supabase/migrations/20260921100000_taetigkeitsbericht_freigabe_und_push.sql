-- Tätigkeitsberichte freigeben + Push-Benachrichtigungen.
--
-- Änderungswunsch Johannes Maurer (21.09.2026): Tätigkeitsberichte der
-- Angestellten müssen wie die Stundenberichte von ihm bzw. seinem
-- Stellvertreter freigegeben werden. Dazu Erinnerungen als Push-Nachricht
-- aus der App, wenn etwas nicht geschrieben oder erledigt ist.
--
-- Teil 1 — Freigabe
--   • Recht stunden.taetigkeitsbericht.freigeben (Vorgabe: Geschäftsführung;
--     ein Stellvertreter bekommt es in der Verwaltung per Häkchen)
--   • taetigkeitsbericht_unterschriften bekommt einen Status:
--     unterschrieben → freigegeben (Freigabe-Unterschrift, wer, wann)
--   • Freigegebene Periode ist für den Angestellten gesperrt (Trigger auf
--     stunden_tage, stunden_taetigkeiten, stunden_fahrt, fahrtenbuch_eintraege).
--     Der Freigeber darf weiter ändern; sauber ist „Wieder öffnen".
-- Teil 2 — Push
--   • push_abos: Web-Push-Abonnements je Gerät
--   • benachrichtigungen_log: was wann an wen ging (verhindert Doppel-Erinnerungen)
--   • Cron „erinnerungen" Mo–Sa 07:00 UTC → Edge Function erinnerungen

-- ── Recht ────────────────────────────────────────────────────────────────
insert into public.berechtigungen
  (schluessel, modul, aktion, subresource, bezeichnung, beschreibung, ist_kritisch, sort_order)
values
  ('stunden.taetigkeitsbericht.freigeben', 'stunden', 'freigeben', 'taetigkeitsbericht',
   'Tätigkeitsberichte freigeben',
   'Unterschriebene Tätigkeitsberichte der Angestellten prüfen und freigeben (Geschäftsführung bzw. Stellvertreter)',
   true, 232)
on conflict (schluessel) do nothing;

insert into public.rollen_berechtigungen (rolle_id, berechtigung_id)
select r.id, b.id
  from public.rollen r, public.berechtigungen b
 where r.schluessel = 'geschaeftsfuehrung'
   and b.schluessel = 'stunden.taetigkeitsbericht.freigeben'
on conflict do nothing;

-- ── Status am Tätigkeitsbericht ──────────────────────────────────────────
alter table public.taetigkeitsbericht_unterschriften
  add column if not exists status text not null default 'unterschrieben',
  add column if not exists freigegeben_von uuid references public.profiles(id) on delete set null,
  add column if not exists freigegeben_am timestamptz,
  add column if not exists freigabe_unterschrift_data text,
  add column if not exists wieder_geoeffnet_von uuid references public.profiles(id) on delete set null,
  add column if not exists wieder_geoeffnet_am timestamptz;

do $$ begin
  alter table public.taetigkeitsbericht_unterschriften
    add constraint tb_status_check check (status in ('unterschrieben', 'freigegeben'));
exception when duplicate_object then null; end $$;

create or replace function public.darf_tb_freigeben(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission(_user_id, 'stunden.taetigkeitsbericht.freigeben');
$$;

-- Lesen darf zusätzlich, wer freigibt.
drop policy if exists tb_unterschrift_select on public.taetigkeitsbericht_unterschriften;
create policy tb_unterschrift_select on public.taetigkeitsbericht_unterschriften
  for select to authenticated
  using (
    mitarbeiter_id = (select auth.uid())
    or (select public.is_admin_role((select auth.uid())))
    or (select public.has_permission((select auth.uid()), 'stunden.taetigkeitsbericht'))
    or (select public.darf_tb_freigeben((select auth.uid())))
  );

-- Der Angestellte kann seinen Status nicht selbst setzen, und eine
-- freigegebene Unterschrift kann er nicht mehr anfassen.
create or replace function public.tb_unterschrift_schutz()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_frei boolean := auth.uid() is null or public.darf_tb_freigeben(auth.uid());
begin
  if tg_op = 'DELETE' then
    if old.status = 'freigegeben' and not v_frei then
      raise exception 'Dieser Tätigkeitsbericht ist freigegeben. Bitte zuerst „Wieder öffnen".';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'freigegeben' and not v_frei then
    raise exception 'Dieser Tätigkeitsbericht ist freigegeben. Bitte zuerst „Wieder öffnen".';
  end if;
  if not v_frei then
    new.status := 'unterschrieben';
    new.freigegeben_von := null;
    new.freigegeben_am := null;
    new.freigabe_unterschrift_data := null;
  end if;
  return new;
end $$;

drop trigger if exists tb_unterschrift_schutz on public.taetigkeitsbericht_unterschriften;
create trigger tb_unterschrift_schutz
  before insert or update or delete on public.taetigkeitsbericht_unterschriften
  for each row execute function public.tb_unterschrift_schutz();

-- Freigeben / wieder öffnen — nur über diese Funktionen.
create or replace function public.taetigkeitsbericht_freigeben(
  p_mitarbeiter uuid, p_jahr integer, p_monat integer, p_unterschrift text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not public.darf_tb_freigeben(auth.uid()) then
    raise exception 'Keine Berechtigung zum Freigeben';
  end if;
  select status into v_status from public.taetigkeitsbericht_unterschriften
   where mitarbeiter_id = p_mitarbeiter and jahr = p_jahr and monat = p_monat;
  if v_status is null then
    raise exception 'Der Mitarbeiter hat diesen Tätigkeitsbericht noch nicht unterschrieben';
  end if;
  update public.taetigkeitsbericht_unterschriften
     set status = 'freigegeben',
         freigegeben_von = auth.uid(),
         freigegeben_am = now(),
         freigabe_unterschrift_data = p_unterschrift
   where mitarbeiter_id = p_mitarbeiter and jahr = p_jahr and monat = p_monat;
end $$;

create or replace function public.taetigkeitsbericht_wieder_oeffnen(
  p_mitarbeiter uuid, p_jahr integer, p_monat integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.darf_tb_freigeben(auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;
  update public.taetigkeitsbericht_unterschriften
     set status = 'unterschrieben',
         freigegeben_von = null,
         freigegeben_am = null,
         freigabe_unterschrift_data = null,
         wieder_geoeffnet_von = auth.uid(),
         wieder_geoeffnet_am = now()
   where mitarbeiter_id = p_mitarbeiter and jahr = p_jahr and monat = p_monat;
end $$;

grant execute on function public.taetigkeitsbericht_freigeben(uuid, integer, integer, text) to authenticated;
grant execute on function public.taetigkeitsbericht_wieder_oeffnen(uuid, integer, integer) to authenticated;

-- ── Sperre der freigegebenen Periode (21. bis 20.) ───────────────────────
create or replace function public.tb_periode_gesperrt(p_mitarbeiter uuid, p_datum date)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  -- Periode „Monat" = 21. des Vormonats bis 20. des Monats.
  v_stich date := case when extract(day from p_datum) <= 20
                       then p_datum
                       else (date_trunc('month', p_datum) + interval '1 month')::date end;
begin
  return exists (
    select 1 from public.taetigkeitsbericht_unterschriften u
     where u.mitarbeiter_id = p_mitarbeiter
       and u.status = 'freigegeben'
       and u.jahr  = extract(year  from v_stich)::int
       and u.monat = extract(month from v_stich)::int
  );
end $$;

create or replace function public.tb_sperre_pruefen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ma uuid;
  v_datum date;
begin
  -- Service-Rolle/Cron und der Freigeber dürfen weiter.
  if auth.uid() is null or public.darf_tb_freigeben(auth.uid()) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'stunden_tage' or tg_table_name = 'fahrtenbuch_eintraege' then
    v_ma := coalesce(new.mitarbeiter_id, old.mitarbeiter_id);
    v_datum := coalesce(new.datum, old.datum);
  else
    select t.mitarbeiter_id, t.datum into v_ma, v_datum
      from public.stunden_tage t
     where t.id = coalesce(new.stunden_tag_id, old.stunden_tag_id);
  end if;
  if v_ma is not null and public.tb_periode_gesperrt(v_ma, v_datum) then
    raise exception 'Der Tätigkeitsbericht dieser Periode ist freigegeben und kann nicht mehr geändert werden.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists tb_sperre_stunden_tage on public.stunden_tage;
create trigger tb_sperre_stunden_tage
  before insert or update or delete on public.stunden_tage
  for each row execute function public.tb_sperre_pruefen();
drop trigger if exists tb_sperre_stunden_taetigkeiten on public.stunden_taetigkeiten;
create trigger tb_sperre_stunden_taetigkeiten
  before insert or update or delete on public.stunden_taetigkeiten
  for each row execute function public.tb_sperre_pruefen();
drop trigger if exists tb_sperre_stunden_fahrt on public.stunden_fahrt;
create trigger tb_sperre_stunden_fahrt
  before insert or update or delete on public.stunden_fahrt
  for each row execute function public.tb_sperre_pruefen();
drop trigger if exists tb_sperre_fahrtenbuch on public.fahrtenbuch_eintraege;
create trigger tb_sperre_fahrtenbuch
  before insert or update or delete on public.fahrtenbuch_eintraege
  for each row execute function public.tb_sperre_pruefen();

-- ── Push-Abonnements ─────────────────────────────────────────────────────
create table if not exists public.push_abos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  geraet        text,
  aktiv         boolean not null default true,
  fehler        integer not null default 0,
  letzter_fehler text,
  erstellt_am   timestamptz not null default now(),
  zuletzt_ok_am timestamptz
);
create index if not exists push_abos_user on public.push_abos (user_id) where aktiv;
alter table public.push_abos enable row level security;

drop policy if exists push_abos_eigene on public.push_abos;
create policy push_abos_eigene on public.push_abos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_abos_admin_select on public.push_abos;
create policy push_abos_admin_select on public.push_abos
  for select to authenticated
  using ((select public.is_admin_role((select auth.uid()))));

-- ── Protokoll der Benachrichtigungen ─────────────────────────────────────
create table if not exists public.benachrichtigungen_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  art         text not null,
  bezug       text,
  kanal       text not null,          -- push | mail | keiner
  titel       text not null,
  text        text,
  gesendet_am timestamptz not null default now()
);
create index if not exists benachrichtigungen_log_user on public.benachrichtigungen_log (user_id, art, gesendet_am desc);
alter table public.benachrichtigungen_log enable row level security;

drop policy if exists benachrichtigungen_log_select on public.benachrichtigungen_log;
create policy benachrichtigungen_log_select on public.benachrichtigungen_log
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin_role((select auth.uid()))));

-- Öffentlicher VAPID-Schlüssel (der private liegt nur in den Function-Secrets).
insert into public.app_settings (key, value)
values ('push_vapid_public', to_jsonb('BDuZKVfMrIISDeiJVzWRfAv7CRyhUYCyNFxMcS5p8L9XNYbk10ZO9cMzFogAv4x-AuN4eMo4fTEgByPtV1ZxQiU'::text))
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Erinnerungen laufen erst ab dem Rollout (Datum änderbar in app_settings).
insert into public.app_settings (key, value)
values ('erinnerungen_ab', to_jsonb('2026-10-01'::text))
on conflict (key) do nothing;

-- ── Erinnerungen: Mo–Sa 07:00 UTC (09:00 Sommer / 08:00 Winter) ──────────
do $$
begin
  perform cron.unschedule('erinnerungen');
exception when others then null;
end $$;

select cron.schedule(
  'erinnerungen',
  '0 7 * * 1-6',
  $job$
    select net.http_post(
      url := 'https://ylqbxnsxksbtsqrcwtuq.supabase.co/functions/v1/erinnerungen',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
  $job$
);

notify pgrst, 'reload schema';
