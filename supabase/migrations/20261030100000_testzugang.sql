-- Testzugang (Christoph, 30.10.2026: „mich sollte man auch in der app nicht
-- sehen ich will nur testen“).
--
-- Ein archiviertes Konto (is_active = false) taucht nirgends mehr auf: keine
-- Mitarbeiterliste, keine Planung, keine Erinnerung. Steht es hier, darf es
-- sich trotzdem anmelden (Auth.tsx, ProtectedRoute) — mit seinen normalen
-- Rechten, has_permission prüft is_active nicht.
--
-- Eintragen nur per SQL: keine Policies, also aus der App weder lesbar noch
-- änderbar. Archivieren im Büro sperrt damit alle aus, nur diese Konten nicht.

create table if not exists public.testzugaenge (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notiz text,
  angelegt_am timestamptz not null default now()
);

alter table public.testzugaenge enable row level security;
revoke all on public.testzugaenge from anon, authenticated;

-- Nur für das eigene Konto abfragbar.
create or replace function public.hat_testzugang()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.testzugaenge where user_id = auth.uid());
$$;

revoke all on function public.hat_testzugang() from public, anon;
grant execute on function public.hat_testzugang() to authenticated;
