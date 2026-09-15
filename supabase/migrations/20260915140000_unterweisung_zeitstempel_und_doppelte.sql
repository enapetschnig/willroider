-- Zwei Fehler im Unterweisungs-Ablauf, gefunden beim Durchgehen vor dem
-- Rollout am 1. Oktober 2026.
--
-- 1) `unterschrieben_am` hatte den Vorgabewert now(). Jede zugeteilte Zeile
--    trug damit eine Uhrzeit, obwohl niemand unterschrieben hatte. Für einen
--    Nachweis ist das untragbar: Der Zeitstempel muss die Unterschrift
--    belegen, nicht die Zuteilung.
--
-- 2) Über den Reiter „Unterweisung" ließ sich zur selben Baustelle mehrmals
--    eine Unterweisung anlegen. Am 15.09.2026 ist das passiert: zwei
--    Unterweisungen im Abstand von drei Minuten, dieselben drei Leute mussten
--    zweimal bestätigen, und der Bauleiter hätte doppelt erinnert. Jetzt legt
--    `unterweisung_setzen` nur an, wenn es wirklich nötig ist, und legt die
--    offenen Bestätigungen der abgelösten Unterweisung still.

alter table public.evaluierung_unterschriften
  alter column unterschrieben_am drop default;

update public.evaluierung_unterschriften
   set unterschrieben_am = null
 where status = 'offen'
   and unterschrift_data is null
   and unterschrieben_am is not null;

comment on column public.evaluierung_unterschriften.unterschrieben_am is
  'Zeitpunkt der Unterschrift. Bleibt leer, solange nicht bestätigt wurde — '
  'wird nur von unterweisung_bestaetigen gesetzt.';

-- Unterweisung einer Baustelle setzen, ohne Doppelte.
--   • gleiche Art schon hinterlegt → nichts tun, die vorhandene gilt weiter
--   • andere Art → neue anlegen, verknüpfen, offene Bestätigungen der alten
--     stilllegen (nicht löschen: der Nachweis der bereits Unterschriebenen
--     bleibt unangetastet)
-- Die Zuteilung an die Eingeteilten übernimmt wie bisher der Trigger
-- baustellen_pflicht_unterweisung_changed.
create or replace function public.unterweisung_setzen(
  p_baustelle uuid,
  p_typ       evaluierung_typ
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_alt     uuid;
  v_alt_typ evaluierung_typ;
  v_neu     uuid;
begin
  if not (is_admin_role(auth.uid()) or can_review(auth.uid())) then
    raise exception 'Keine Berechtigung';
  end if;

  select pflicht_evaluierung_id into v_alt from public.baustellen where id = p_baustelle;
  if v_alt is not null then
    select typ into v_alt_typ from public.evaluierungen where id = v_alt;
    if v_alt_typ = p_typ then
      return v_alt;   -- schon vorhanden, keine zweite anlegen
    end if;
  end if;

  insert into public.evaluierungen (baustelle_id, datum, typ, checkliste, abgeschlossen)
  values (p_baustelle, (now() at time zone 'Europe/Vienna')::date, p_typ, '{}'::jsonb, false)
  returning id into v_neu;

  update public.baustellen set pflicht_evaluierung_id = v_neu where id = p_baustelle;

  if v_alt is not null then
    update public.evaluierung_unterschriften
       set status = 'archiviert',
           archiviert_am = now(),
           archiviert_grund = 'durch neue Unterweisung ersetzt',
           faellig_am = null
     where evaluierung_id = v_alt
       and status = 'offen';
  end if;

  return v_neu;
end $$;

comment on function public.unterweisung_setzen(uuid, evaluierung_typ) is
  'Setzt die Pflicht-Unterweisung einer Baustelle. Legt keine zweite an, wenn '
  'dieselbe Art schon hinterlegt ist, und stellt offene Bestätigungen einer '
  'abgelösten Unterweisung still.';
