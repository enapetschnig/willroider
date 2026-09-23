-- Planung und Ausführung (Wunsch Johannes Maurer, 23.09.2026).
--
-- Beim Anlegen wird gewählt: Planung oder Ausführung.
--   • Planung: Kostenstelle 1404895-<JJ><NN> (Jahr + laufende Nummer, wie
--     1404020-2601). Eigener Reiter „Planung“ bei den Baustellen.
--   • Ausführung: wie bisher; beim Anlegen sind alle Felder und die
--     Evaluierung Pflicht (Prüfung in der App).
--   • „In Ausführung übernehmen“ legt eine NEUE Baustelle mit der neuen
--     Kostenstelle an. Stunden und Kosten bleiben auf der Planung (1404895),
--     die Ausführung beginnt bei 0. Mit wandern: Dokumente, Ordner,
--     OneDrive-Verknüpfung, Notizen, Angebote, Termine.

alter table public.baustellen
  add column if not exists art text not null default 'ausfuehrung',
  add column if not exists aus_planung_id uuid references public.baustellen(id) on delete set null,
  add column if not exists in_ausfuehrung_id uuid references public.baustellen(id) on delete set null,
  add column if not exists in_ausfuehrung_am timestamptz;

do $$ begin
  alter table public.baustellen add constraint baustellen_art_check check (art in ('ausfuehrung', 'planung'));
exception when duplicate_object then null; end $$;

create index if not exists baustellen_art on public.baustellen (art);

-- Planung → Ausführung: die neue Baustelle ist schon angelegt (über das
-- normale Formular, damit dieselben Pflichtfelder und die Baustellenmeldung
-- gelten). Hier wandert alles außer Stunden und Kosten hinüber.
create or replace function public.planung_uebernehmen(p_planung uuid, p_ausfuehrung uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.baustellen;
  a public.baustellen;
begin
  if not public.is_admin_role(auth.uid()) then
    raise exception 'Keine Berechtigung';
  end if;
  select * into p from public.baustellen where id = p_planung;
  select * into a from public.baustellen where id = p_ausfuehrung;
  if p.id is null or a.id is null then raise exception 'Baustelle nicht gefunden'; end if;
  if p.art <> 'planung' then raise exception 'Das ist keine Planung'; end if;
  if a.art <> 'ausfuehrung' then raise exception 'Ziel ist keine Ausführung'; end if;
  if p.in_ausfuehrung_id is not null then raise exception 'Diese Planung wurde schon übernommen'; end if;

  -- Unterlagen und Verknüpfungen wandern mit
  update public.dokumente set baustelle_id = a.id where baustelle_id = p.id;
  update public.dokument_ordner set baustelle_id = a.id where baustelle_id = p.id;
  update public.notizen set baustelle_id = a.id where baustelle_id = p.id;
  update public.angebote set baustelle_id = a.id where baustelle_id = p.id;
  update public.baustellen_termine set baustelle_id = a.id where baustelle_id = p.id;

  -- OneDrive: Verknüpfung und Spiegel gehen an die Ausführung, damit es
  -- nicht zwei Baustellen auf demselben Ordner gibt.
  if p.sharepoint_item_id is not null and a.sharepoint_item_id is null then
    update public.baustellen set
      sharepoint_site_id = p.sharepoint_site_id, sharepoint_site_name = p.sharepoint_site_name,
      sharepoint_drive_id = p.sharepoint_drive_id, sharepoint_item_id = p.sharepoint_item_id,
      sharepoint_pfad = p.sharepoint_pfad, sharepoint_web_url = p.sharepoint_web_url,
      sharepoint_variante = p.sharepoint_variante, sharepoint_abgleich_am = p.sharepoint_abgleich_am
    where id = a.id;
    update public.sharepoint_dateien set baustelle_id = a.id where baustelle_id = p.id;
    update public.sharepoint_unterordner set baustelle_id = a.id where baustelle_id = p.id;
    update public.sharepoint_vorschlaege set baustelle_id = a.id where baustelle_id = p.id;
    update public.sharepoint_auftraege set baustelle_id = a.id where baustelle_id = p.id;
    update public.baustellen set
      sharepoint_site_id = null, sharepoint_site_name = null, sharepoint_drive_id = null,
      sharepoint_item_id = null, sharepoint_pfad = null, sharepoint_web_url = null,
      sharepoint_variante = null, sharepoint_abgleich_am = null
    where id = p.id;
  end if;

  -- Stunden, Kosten, Berichte bleiben auf der Planung.
  update public.baustellen set aus_planung_id = p.id where id = a.id;
  update public.baustellen set
    in_ausfuehrung_id = a.id, in_ausfuehrung_am = now(), status = 'abgeschlossen'
  where id = p.id;
end $$;

revoke execute on function public.planung_uebernehmen(uuid, uuid) from public, anon;
grant execute on function public.planung_uebernehmen(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
