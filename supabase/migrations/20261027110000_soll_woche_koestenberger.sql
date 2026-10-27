-- Birgit Köstenberger: jede Woche gleich 7,5 h — Mo–Mi 2 h, Do 1,5 h
-- (Wunsch J. Maurer 27.10.2026; ersetzt das Wechselmuster vom 22.10.).
UPDATE public.profile_konten_settings
   SET soll_woche = '{"woche":[2,2,2,1.5,0,0,0]}'::jsonb
 WHERE profile_id = 'd8c04eee-5211-4e36-8e08-0fd188b08ee0';
