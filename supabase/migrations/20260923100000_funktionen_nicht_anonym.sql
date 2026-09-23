-- Datenbankfunktionen, die „kein angemeldeter Benutzer“ absichtlich
-- durchlassen (für den Nachtlauf), dürfen nicht über die öffentliche
-- Schnittstelle ohne Anmeldung aufrufbar sein.
--
-- Gefunden bei der Durchsicht am 23.09.2026 (Supabase-Sicherheitsprüfung):
--   stunden_bericht_erzeugen  prüft nur, WENN jemand angemeldet ist —
--                             anonym (auth.uid() = null) lief sie durch und
--                             legte Stundenberichte für beliebige Perioden an
--   stunden_bericht_cron      ohne jede Prüfung
--   sharepoint_dateien_verknuepfen  ohne Prüfung (harmlos, aber nur für Server)
--
-- Der Zeitplan (pg_cron läuft als Eigentümer) und die Edge Functions
-- (Service-Rolle) sind davon nicht betroffen. Der Test-Knopf „Berichte
-- erzeugen“ in der App ruft als angemeldeter Admin auf und bleibt erlaubt.

revoke execute on function public.stunden_bericht_erzeugen(integer, integer, integer) from public, anon;
grant  execute on function public.stunden_bericht_erzeugen(integer, integer, integer) to authenticated, service_role;

revoke execute on function public.stunden_bericht_cron() from public, anon, authenticated;
grant  execute on function public.stunden_bericht_cron() to service_role;

revoke execute on function public.sharepoint_dateien_verknuepfen() from public, anon, authenticated;
grant  execute on function public.sharepoint_dateien_verknuepfen() to service_role;
