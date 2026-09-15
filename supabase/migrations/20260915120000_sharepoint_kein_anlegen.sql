-- Beim Anlegen einer Baustelle entsteht in SharePoint kein Ordner mehr.
-- Der Ordner wird dort wie gewohnt von Hand erstellt und in der App
-- verknüpft. Hochladen und Anzeigen laufen unverändert weiter.
insert into public.app_settings (key, value)
values ('sharepoint_ordner_anlegen', 'false'::jsonb)
on conflict (key) do update set value = 'false'::jsonb;
