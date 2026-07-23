-- =====================================================================
-- 11 Tabellen werden im Frontend per supabase.channel(...).on(
-- 'postgres_changes', { table: '...' }) abonniert, standen aber NICHT in
-- der Realtime-Publication. Die Abos feuerten dadurch NIE — Listen
-- aktualisierten sich nur beim manuellen Neuladen, obwohl der Code
-- Live-Updates vortäuscht (z.B. Tages-/Jahresplanung, Konten, Baustellen).
--
-- Alle 11 haben RLS aktiviert (geprüft) — der Realtime-Payload wird also
-- weiterhin pro Nutzer gefiltert, es leakt nichts.
-- =====================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.angebote;
ALTER PUBLICATION supabase_realtime ADD TABLE public.baustellen;
ALTER PUBLICATION supabase_realtime ADD TABLE public.einteilungen;
ALTER PUBLICATION supabase_realtime ADD TABLE public.einteilung_mitarbeiter;
ALTER PUBLICATION supabase_realtime ADD TABLE public.einteilung_fahrzeuge;
ALTER PUBLICATION supabase_realtime ADD TABLE public.evaluierung_unterschriften;
ALTER PUBLICATION supabase_realtime ADD TABLE public.partien;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poliereinsatz_zeitraeume;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.urlaubs_buchungen;
ALTER PUBLICATION supabase_realtime ADD TABLE public.za_buchungen;
