-- Dieselbe Datei nicht doppelt zeigen: Eine App-Datei, die nach SharePoint
-- hochgeladen wurde, kommt beim nächsten Abgleich als gespiegelte Zeile
-- zurück. Die Zeile wird dem App-Dokument zugeordnet und in der Anzeige
-- übersprungen.
create or replace function public.sharepoint_dateien_verknuepfen()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_anzahl integer;
begin
  update public.sharepoint_dateien d
     set dokument_id = dk.id
    from public.dokumente dk
   where dk.sharepoint_item_id = d.item_id
     and d.dokument_id is distinct from dk.id;
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end $$;

-- Zeitplan: offene Aufträge (neue Baustellen) alle zwei Minuten,
-- App-Dateien nach SharePoint alle zehn Minuten.
select cron.schedule(
  'sharepoint-auftraege',
  '*/2 * * * *',
  $job$
    select net.http_post(
      url := 'https://ylqbxnsxksbtsqrcwtuq.supabase.co/functions/v1/sharepoint-schreiben',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"modus":"auftraege"}'::jsonb,
      timeout_milliseconds := 110000)
  $job$
);

select cron.schedule(
  'sharepoint-hochladen',
  '3,13,23,33,43,53 * * * *',
  $job$
    select net.http_post(
      url := 'https://ylqbxnsxksbtsqrcwtuq.supabase.co/functions/v1/sharepoint-schreiben',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
      body := '{"modus":"hochladen"}'::jsonb,
      timeout_milliseconds := 110000)
  $job$
);
