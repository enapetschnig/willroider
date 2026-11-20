-- stunden_bericht_snapshot ist SECURITY DEFINER und liest Stunden beliebiger Personen → nur intern
-- (aufgerufen aus stunden_bericht_erzeugen / stunden_bericht_unterschreiben, die als Eigentümer laufen).
REVOKE EXECUTE ON FUNCTION public.stunden_bericht_snapshot(UUID, DATE, DATE) FROM authenticated, anon, PUBLIC;
