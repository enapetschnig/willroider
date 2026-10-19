-- Benutzer freischalten / archivieren nur mit „Mitarbeiter bearbeiten"
-- (Wunsch E. Winkler, 19.10.2026: „nur die Admins (Maurer und Pließnig)
-- sollen Benutzer freigeben können").
--
-- Die Update-Regel auf profiles erlaubt is_admin_role — das hat auch das
-- Büro. Deshalb prüft ein Trigger genau die zwei Spalten, um die es geht.
-- Aufrufe ohne angemeldeten Benutzer (Edge Functions mit Dienstschlüssel,
-- z. B. admin-create-employee) bleiben erlaubt.

create or replace function public.profiles_freischalten_pruefen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.is_active is distinct from old.is_active
      or new.je_freigeschaltet is distinct from old.je_freigeschaltet)
     and auth.uid() is not null
     and not public.has_permission(auth.uid(), 'mitarbeiter.edit') then
    raise exception 'Freischalten und Archivieren dürfen nur Administratoren (Recht „Mitarbeiter bearbeiten").';
  end if;
  return new;
end $$;

drop trigger if exists profiles_freischalten_pruefen on public.profiles;
create trigger profiles_freischalten_pruefen
  before update of is_active, je_freigeschaltet on public.profiles
  for each row execute function public.profiles_freischalten_pruefen();
