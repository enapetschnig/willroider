-- Doppelte Selbst-Registrierungen verhindern (Wunsch J. Maurer, 19.10.2026:
-- „wenn sich einer falsch anmeldet, legt sich ein Mitarbeiter an — das
-- müssen wir ausschalten bzw. so machen, dass kein Problem entsteht").
--
-- Vorfall: Matthias Fischer ist seit Juni als „Matthias Franz Fischer"
-- angelegt (Anmeldung per Handynummer). Am 16.10. registrierte er sich mit
-- seiner E-Mail-Adresse neu → zweites, inaktives Konto.
--
-- Eine falsche ANMELDUNG legt nie ein Konto an (SMS: shouldCreateUser=false,
-- Passwort: schlägt einfach fehl). Neu entsteht nur etwas über
-- „Registrieren". Deshalb:
--   1. registrierung_pruefen(): das Formular fragt VOR dem Registrieren, ob
--      es die Person schon gibt — dann wird nicht registriert, sondern zur
--      Anmeldung mit Handynummer bzw. E-Mail geschickt.
--   2. doppelte_anmeldung_entfernen(): Admins (Recht „Mitarbeiter
--      bearbeiten") können eine doppelte, NIE freigeschaltete Anmeldung ohne
--      Daten mit einem Klick entfernen.

create or replace function public.name_norm(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           replace(replace(replace(replace(lower(trim(coalesce(t, ''))), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
           '\s+', ' ', 'g');
$$;

-- Gibt es schon einen aktiven Mitarbeiter mit diesem Namen?
-- Liefert bewusst nur ja/nein und die Art der Anmeldung — keine Namen,
-- Nummern oder Adressen (die Funktion ist ohne Anmeldung aufrufbar).
create or replace function public.registrierung_pruefen(p_vorname text, p_nachname text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  n text := public.name_norm(p_nachname);
  v text := split_part(public.name_norm(p_vorname), ' ', 1);
  treffer uuid;
  hat_telefon boolean;
begin
  if n = '' or v = '' then
    return jsonb_build_object('schon_angelegt', false);
  end if;
  select p.id into treffer
    from public.profiles p
   where p.is_active
     and public.name_norm(p.nachname) = n
     and v = any (string_to_array(public.name_norm(p.vorname), ' '))
   limit 1;
  if treffer is null then
    return jsonb_build_object('schon_angelegt', false);
  end if;
  select coalesce(u.phone, '') <> '' into hat_telefon from auth.users u where u.id = treffer;
  return jsonb_build_object(
    'schon_angelegt', true,
    'anmeldung', case when coalesce(hat_telefon, false) then 'telefon' else 'email' end);
end $$;

grant execute on function public.registrierung_pruefen(text, text) to anon, authenticated;

-- Doppelte Anmeldung entfernen — nur wenn sie NIE freigeschaltet war und
-- keinerlei Daten hat. Alles andere bleibt dem normalen Löschen vorbehalten.
create or replace function public.doppelte_anmeldung_entfernen(_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p record;
begin
  if not public.has_permission(auth.uid(), 'mitarbeiter.edit') then
    raise exception 'Nur Administratoren (Recht „Mitarbeiter bearbeiten").' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = _user_id;
  if p.id is null then
    raise exception 'Anmeldung nicht gefunden.';
  end if;
  if p.is_active or p.je_freigeschaltet then
    raise exception 'Diese Person war schon freigeschaltet — bitte über „Löschen" mit Bestätigung entfernen.';
  end if;
  if exists (select 1 from public.stunden_tage where mitarbeiter_id = _user_id)
     or exists (select 1 from public.dokumente where mitarbeiter_id = _user_id or hochgeladen_von = _user_id)
     or exists (select 1 from public.evaluierung_unterschriften where mitarbeiter_id = _user_id) then
    raise exception 'Zu dieser Anmeldung gibt es schon Daten — bitte im Büro klären.';
  end if;
  delete from auth.users where id = _user_id;
end $$;

grant execute on function public.doppelte_anmeldung_entfernen(uuid) to authenticated;
