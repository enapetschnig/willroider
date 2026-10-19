-- SharePoint-Ordner für neue Baustellen IMMER anlegen — auch wenn der
-- Browser beim Speichern abbricht oder SharePoint kurz nicht antwortet
-- (Christoph, 19.10.2026: „ich will, dass das immer funktioniert").
--
-- Bisher stieß nur das Formular das Anlegen an (einmal, ohne Wiederholung).
-- Jetzt trägt die Datenbank beim Anlegen einer Baustelle einen Auftrag ein;
-- der Zeitplan „sharepoint-auftraege" arbeitet offene Aufträge alle 5
-- Minuten ab (sharepoint-schreiben, modus „auftraege", bis zu 6 Versuche,
-- danach Status „fehler" → Hinweis im Dashboard).
--
-- Nur für Bauleiter mit neuer Ordnerstruktur
-- (app_settings.sharepoint_neue_struktur) und nur für Baustellen ab
-- „ab" (Standard 15.10.2026) — bestehende Baustellen bleiben, wie sie sind.

create or replace function public.sharepoint_ordner_auftrag_anlegen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if coalesce(new.art, 'ausfuehrung') <> 'ausfuehrung'
     or new.sharepoint_item_id is not null
     or new.bauleiter_id is null then
    return new;
  end if;

  select s.value into v from public.app_settings s where s.key = 'sharepoint_neue_struktur';
  if v is null then return new; end if;
  if not (coalesce((v->>'alle')::boolean, false) or coalesce(v->'bauleiter_ids', '[]'::jsonb) ? new.bauleiter_id::text) then
    return new;
  end if;
  if new.created_at::date < coalesce((v->>'ab')::date, date '2026-10-15') then
    return new;
  end if;

  if not exists (
    select 1 from public.sharepoint_auftraege a
     where a.baustelle_id = new.id and a.status = 'offen'
  ) then
    insert into public.sharepoint_auftraege (baustelle_id, art) values (new.id, 'ordner_anlegen');
  end if;
  return new;
end $$;

drop trigger if exists baustellen_sharepoint_auftrag on public.baustellen;
create trigger baustellen_sharepoint_auftrag
  after insert or update of bauleiter_id on public.baustellen
  for each row execute function public.sharepoint_ordner_auftrag_anlegen();

-- Zeitplan: alle 5 Minuten, versetzt zu Abgleich (:00/:10) und Hochladen (:03/:13).
select cron.schedule(
  'sharepoint-auftraege',
  '1-59/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://ylqbxnsxksbtsqrcwtuq.supabase.co/functions/v1/sharepoint-schreiben',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"modus":"auftraege"}'::jsonb,
      timeout_milliseconds := 150000)
  $cron$
);
