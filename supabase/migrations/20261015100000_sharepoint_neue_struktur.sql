-- Neue Ordnerstruktur für neue Baustellen (Wunsch S. Egger, 14./15.10.2026).
-- Eingespielt am 15.10.2026 über die Verwaltungsschnittstelle; diese Datei
-- hält den Stand fest und ist wiederholbar.
--
-- 1. Privater Speicher „vorlagen" — nur der Server (Dienstschlüssel) liest
--    ihn. Inhalt: bvh-neu/struktur.json (Ordnerliste + feste Dateien),
--    bvh-neu/dateien/*, bvh-neu/materialliste.xlsx.
insert into storage.buckets (id, name, public)
values ('vorlagen', 'vorlagen', false)
on conflict (id) do nothing;

-- 2. Für welche Bauleiter legt die App den Ordner selbst an
--    ({ "bauleiter_ids": [...] } oder { "alle": true }). Start: nur
--    Sebastian Egger.
insert into public.app_settings (key, value)
select 'sharepoint_neue_struktur', jsonb_build_object('bauleiter_ids', jsonb_build_array(p.id))
  from public.profiles p
 where p.vorname = 'Sebastian' and p.nachname = 'Egger'
on conflict (key) do nothing;

-- 3. Ordnerart „00-baustelle" (Polier-Ordner) für Vorarbeiter,
--    Zimmermeister, Büro und Geschäftsführung sichtbar.
update public.app_settings
   set value = (
     select jsonb_object_agg(
              k,
              case when k in ('buero', 'bauleiter', 'zimmermeister', 'geschaeftsfuehrung')
                        and not (v ? '00-baustelle')
                   then jsonb_build_array('00-baustelle') || v
                   else v end)
       from jsonb_each(value::jsonb) as e(k, v))
 where key = 'ordner_visibility';
