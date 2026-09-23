-- Korrekturen aus der Durchsicht vom 23.09.2026.
--
-- 1. Periodensperre (Tätigkeitsbericht) prüft beim Ändern ALT und NEU:
--    vorher ließ sich eine Fahrt/ein Tag aus einer freigegebenen Periode
--    heraus auf ein offenes Datum verschieben — die km verschwanden dann
--    aus dem freigegebenen Bericht.
-- 2. Die Sperre gilt dem Angestellten selbst. Sie greift nicht mehr bei
--    kaskadierenden Löschungen (Person wird gelöscht) und nicht für Leute
--    mit „stunden.edit_alle", wenn sie FREMDE Tage korrigieren (Büro trägt
--    z. B. eine Krankmeldung über eine freigegebene Periode ein).
-- 3. Wer Tätigkeitsberichte freigibt, darf die Tage und das Fahrtenbuch
--    aller lesen — sonst wäre der Bericht beim Freigeben leer.
-- 4. Archiv: Wird ein Bericht wieder geöffnet, gilt das abgelegte PDF als
--    überholt (bericht_archiv.ueberholt_am) und wird nicht mehr zum
--    Versand angeboten.
-- 5. Neu verknüpfte Baustelle: Abgleich-Zeitpunkt zurücksetzen, damit das
--    Hochladen wartet, bis die echten Ordner gespiegelt sind (sonst landeten
--    App-Dateien im obersten Baustellenordner).
-- 6. Push: ein Gerät kann von einer anderen Person übernommen werden
--    (geteiltes Tablet) — über eine Funktion, weil die Zeilenregel das
--    Überschreiben fremder Zeilen zu Recht verbietet.

-- ── 1 + 2: Periodensperre ────────────────────────────────────────────────
create or replace function public.tb_sperre_pruefen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_ma uuid;
  v_datum date;
begin
  -- Service-Rolle/Zeitpläne, kaskadierende Löschungen, Freigeber: frei.
  if v_uid is null or pg_trigger_depth() > 1 or public.darf_tb_freigeben(v_uid) then
    return coalesce(new, old);
  end if;

  -- Alte UND neue Zeile prüfen (Verschieben aus der Periode heraus).
  for r in
    select 'alt' as seite where tg_op in ('UPDATE', 'DELETE')
    union all
    select 'neu' where tg_op in ('INSERT', 'UPDATE')
  loop
    if tg_table_name in ('stunden_tage', 'fahrtenbuch_eintraege') then
      if r.seite = 'alt' then v_ma := old.mitarbeiter_id; v_datum := old.datum;
      else v_ma := new.mitarbeiter_id; v_datum := new.datum; end if;
    else
      select t.mitarbeiter_id, t.datum into v_ma, v_datum
        from public.stunden_tage t
       where t.id = case when r.seite = 'alt' then old.stunden_tag_id else new.stunden_tag_id end;
    end if;
    continue when v_ma is null;
    -- Büro korrigiert fremde Tage: erlaubt. Eigene: nie.
    continue when v_ma <> v_uid and public.has_permission(v_uid, 'stunden.edit_alle');
    if public.tb_periode_gesperrt(v_ma, v_datum) then
      raise exception 'Der Tätigkeitsbericht dieser Periode ist freigegeben und kann nicht mehr geändert werden.';
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create or replace function public.tb_unterschrift_schutz()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_frei boolean := auth.uid() is null or pg_trigger_depth() > 1 or public.darf_tb_freigeben(auth.uid());
begin
  if tg_op = 'DELETE' then
    if old.status = 'freigegeben' and not v_frei then
      raise exception 'Dieser Tätigkeitsbericht ist freigegeben. Bitte zuerst „Wieder öffnen".';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'freigegeben' and not v_frei then
    raise exception 'Dieser Tätigkeitsbericht ist freigegeben. Bitte zuerst „Wieder öffnen".';
  end if;
  if not v_frei then
    new.status := 'unterschrieben';
    new.freigegeben_von := null;
    new.freigegeben_am := null;
    new.freigabe_unterschrift_data := null;
  end if;
  return new;
end $$;

-- ── 3: Freigeber lesen Tage und Fahrtenbuch ──────────────────────────────
drop policy if exists stunden_tage_select on public.stunden_tage;
create policy stunden_tage_select on public.stunden_tage for select to authenticated using (
  mitarbeiter_id = (select auth.uid())
  or (select public.is_admin_role((select auth.uid())))
  or (select public.has_permission((select auth.uid()), 'stunden.edit_alle'))
  or (select public.has_permission((select auth.uid()), 'stunden.view_alle'))
  or (select public.has_permission((select auth.uid()), 'arbeitsplanung.abwesenheiten'))
  or (select public.darf_tb_freigeben((select auth.uid())))
  or mitarbeiter_id in (select p.id from public.profiles p where p.partie_id in (
        select pa.id from public.partien pa where pa.partieleiter_id = (select auth.uid())
        union select me.partie_id from public.profiles me where me.id = (select auth.uid()) and me.partie_id is not null
          and (select public.has_permission((select auth.uid()), 'stunden.view_partie'))))
  or public.gemeinsame_einteilung((select auth.uid()), mitarbeiter_id, datum));

drop policy if exists fahrtenbuch_select on public.fahrtenbuch_eintraege;
create policy fahrtenbuch_select on public.fahrtenbuch_eintraege for select to authenticated using (
  mitarbeiter_id = (select auth.uid())
  or (select public.is_admin_role((select auth.uid())))
  or (select public.has_permission((select auth.uid()), 'stunden.taetigkeitsbericht'))
  or (select public.darf_tb_freigeben((select auth.uid()))));

-- ── 4: überholte Archiv-PDFs ─────────────────────────────────────────────
alter table public.bericht_archiv add column if not exists ueberholt_am timestamptz;

create or replace function public.archiv_ueberholt_tb()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'freigegeben' and new.status <> 'freigegeben' then
    update public.bericht_archiv
       set ueberholt_am = now()
     where art = 'taetigkeitsbericht' and mitarbeiter_id = new.mitarbeiter_id
       and jahr = new.jahr and monat = new.monat and ueberholt_am is null;
  end if;
  return new;
end $$;
drop trigger if exists archiv_ueberholt_tb on public.taetigkeitsbericht_unterschriften;
create trigger archiv_ueberholt_tb after update of status on public.taetigkeitsbericht_unterschriften
  for each row execute function public.archiv_ueberholt_tb();

create or replace function public.archiv_ueberholt_bsb()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('bestaetigt', 'versendet') and new.status not in ('bestaetigt', 'versendet') then
    update public.bericht_archiv
       set ueberholt_am = now()
     where art = 'stundenbericht' and bericht_id = new.id and ueberholt_am is null;
  end if;
  return new;
end $$;
drop trigger if exists archiv_ueberholt_bsb on public.stunden_berichte;
create trigger archiv_ueberholt_bsb after update of status on public.stunden_berichte
  for each row execute function public.archiv_ueberholt_bsb();

-- ── 5: neue Verknüpfung → erst spiegeln, dann hochladen ──────────────────
create or replace function public.sharepoint_zuordnung_setzen(
  p_baustelle uuid, p_site_id text, p_site_name text, p_drive_id text, p_item_id text,
  p_pfad text, p_web_url text, p_variante text)
returns void language plpgsql security definer set search_path = public as $$
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
    sharepoint_variante = p_variante,
    -- Ordner wechselt → alter Spiegel gilt nicht mehr; Hochladen wartet
    -- auf den nächsten Abgleich.
    sharepoint_abgleich_am = case when sharepoint_item_id is distinct from p_item_id then null else sharepoint_abgleich_am end
  where id = p_baustelle;
  delete from public.sharepoint_vorschlaege where baustelle_id = p_baustelle;
end $$;

-- ── 6: Push-Gerät übernehmen / lösen ─────────────────────────────────────
create or replace function public.push_abo_registrieren(p_endpoint text, p_p256dh text, p_auth text, p_geraet text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into public.push_abos (user_id, endpoint, p256dh, auth, geraet, aktiv, fehler, letzter_fehler)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_geraet, 160), true, 0, null)
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        geraet = excluded.geraet, aktiv = true, fehler = 0, letzter_fehler = null;
end $$;
revoke execute on function public.push_abo_registrieren(text, text, text, text) from public, anon;
grant execute on function public.push_abo_registrieren(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

-- ── 7: Bauleiter mit SharePoint-Team ließ sich nicht löschen ─────────────
-- (einziger Fremdschlüssel auf profiles ohne ON DELETE; angelegt 14.09.)
alter table public.sharepoint_teams drop constraint if exists sharepoint_teams_bauleiter_id_fkey;
alter table public.sharepoint_teams
  add constraint sharepoint_teams_bauleiter_id_fkey
  foreign key (bauleiter_id) references public.profiles(id) on delete set null;
