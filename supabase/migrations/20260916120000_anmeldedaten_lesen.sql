-- Womit meldet sich eine Person an? Die Anmeldedaten liegen in auth.users,
-- das Personalblatt zeigt aber nur profiles. Deshalb wusste der Dialog nie,
-- ob die eingetragene Nummer auch die Anmeldenummer ist — das Häkchen war
-- nach jedem Öffnen leer, und Johannes hielt es für verschwunden (16.09.).
--
-- Nur für die Verwaltung und die Bauleitung, nur lesend, nur die beiden
-- Felder. Passwörter oder Tokens kommen hier nicht heraus.
create or replace function public.anmeldedaten(p_profile uuid)
returns table (login_telefon text, login_email text)
language sql
stable security definer
set search_path = public, auth
as $$
  select u.phone::text, u.email::text
    from auth.users u
   where u.id = p_profile
     and (is_admin_role(auth.uid()) or can_review(auth.uid()));
$$;

revoke all on function public.anmeldedaten(uuid) from public;
grant execute on function public.anmeldedaten(uuid) to authenticated;

comment on function public.anmeldedaten(uuid) is
  'Anmeldenummer und Anmelde-Adresse einer Person aus auth.users — für das '
  'Personalblatt, damit es den echten Stand zeigt. Nur Verwaltung/Bauleitung.';
