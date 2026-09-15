-- Verknüpfen darf auch, wer Baustellen betreut (Bauleiter, Polier-Prüfer),
-- nicht nur die Verwaltung. Es ist eine tägliche Handgriff-Sache und
-- ändert in SharePoint nichts.
create or replace function public.sharepoint_zuordnung_setzen(
  p_baustelle uuid,
  p_site_id   text,
  p_site_name text,
  p_drive_id  text,
  p_item_id   text,
  p_pfad      text,
  p_web_url   text,
  p_variante  text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin_role(auth.uid()) or can_review(auth.uid())) then
    raise exception 'Keine Berechtigung';
  end if;
  update public.baustellen set
    sharepoint_site_id = p_site_id,
    sharepoint_site_name = p_site_name,
    sharepoint_drive_id = p_drive_id,
    sharepoint_item_id = p_item_id,
    sharepoint_pfad = p_pfad,
    sharepoint_web_url = p_web_url,
    sharepoint_variante = p_variante
  where id = p_baustelle;
  delete from public.sharepoint_vorschlaege where baustelle_id = p_baustelle;
end $$;

create or replace function public.sharepoint_zuordnung_loesen(p_baustelle uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin_role(auth.uid()) or can_review(auth.uid())) then
    raise exception 'Keine Berechtigung';
  end if;
  update public.baustellen set
    sharepoint_site_id = null, sharepoint_site_name = null, sharepoint_drive_id = null,
    sharepoint_item_id = null, sharepoint_pfad = null, sharepoint_web_url = null,
    sharepoint_variante = null, sharepoint_abgleich_am = null
  where id = p_baustelle;
  delete from public.sharepoint_dateien where baustelle_id = p_baustelle;
end $$;
