-- Plan-Viewer (Wunsch S. Egger, 18.11.2026): Anmerkungen liegen als eigene
-- Ebene über dem Originalplan. Der Plan selbst (SharePoint/Storage) bleibt
-- unverändert; hier steht nur die Ebene je Person und Plan.
--
-- datei_schluessel: "sp:<sharepoint_dateien.id>" (bleibt beim Abgleich gleich,
-- Upsert über drive_id/item_id) oder "dok:<dokumente.id>".
-- daten: { version, seiten: { "1": [ … Formen … ] }, massstab: { … } }
-- Rein additiv — die laufende App liest die Tabelle nicht.

create table if not exists public.plan_anmerkungen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  baustelle_id uuid references public.baustellen(id) on delete cascade,
  datei_schluessel text not null,
  dateiname text,
  daten jsonb not null default '{}'::jsonb,
  geaendert_am timestamptz not null default now(),
  erstellt_am timestamptz not null default now(),
  unique (user_id, datei_schluessel)
);

create index if not exists plan_anmerkungen_user_idx on public.plan_anmerkungen (user_id);

alter table public.plan_anmerkungen enable row level security;

-- Jeder sieht und ändert nur seine eigene Ebene.
drop policy if exists plan_anmerkungen_eigene_lesen on public.plan_anmerkungen;
create policy plan_anmerkungen_eigene_lesen on public.plan_anmerkungen
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists plan_anmerkungen_eigene_anlegen on public.plan_anmerkungen;
create policy plan_anmerkungen_eigene_anlegen on public.plan_anmerkungen
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists plan_anmerkungen_eigene_aendern on public.plan_anmerkungen;
create policy plan_anmerkungen_eigene_aendern on public.plan_anmerkungen
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists plan_anmerkungen_eigene_loeschen on public.plan_anmerkungen;
create policy plan_anmerkungen_eigene_loeschen on public.plan_anmerkungen
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.plan_anmerkungen to authenticated;
