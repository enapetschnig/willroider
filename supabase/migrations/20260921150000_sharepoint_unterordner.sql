-- SharePoint-Ordner 1:1 in der App (Änderungswunsch Elias Winkler, 21.09.2026).
--
-- Bisher übersetzte die App SharePoint-Ordner über drei feste Schemata in
-- ihre 15 eigenen Ordner; alles Unbekannte landete in „92-Sonstiges" (ein
-- Viertel aller Dateien). Jetzt zeigt die App für verknüpfte Baustellen
-- den echten Ordnerbaum. Die Ordner-Klasse (aus dem Namen, siehe
-- ordnerklasse.ts) bleibt nur für Rechte, Farben und automatische Ablagen.
--
--   sharepoint_unterordner        alle Ordner je Baustelle (auch leere)
--   sharepoint_dateien.subpath    ab jetzt: Pfad UNTER dem obersten Ordner
--   dokumente.sharepoint_ziel_pfad echter Zielordner, wenn in der App in
--                                  einen SharePoint-Ordner hochgeladen wurde

create table if not exists public.sharepoint_unterordner (
  id             uuid primary key default gen_random_uuid(),
  baustelle_id   uuid not null references public.baustellen(id) on delete cascade,
  drive_id       text not null,
  item_id        text not null,
  pfad           text not null,            -- „02-Baustellenmanagement/Unterweisung"
  name           text not null,
  top            text not null,            -- oberster Ordner („02-Baustellenmanagement")
  ordner         text not null,            -- Klasse (1-baustellenmanagement …)
  tiefe          integer not null default 1,
  web_url        text,
  gesehen_am     timestamptz not null default now(),
  verschwunden_am timestamptz,
  unique (drive_id, item_id)
);
create index if not exists sharepoint_unterordner_baustelle on public.sharepoint_unterordner (baustelle_id) where verschwunden_am is null;

alter table public.sharepoint_unterordner enable row level security;

-- Dieselbe Sichtregel wie bei den Dateien: Verwaltung/Prüfer alles, sonst
-- nur Ordner einer Klasse, die die Rolle sehen darf.
drop policy if exists sharepoint_unterordner_select on public.sharepoint_unterordner;
create policy sharepoint_unterordner_select on public.sharepoint_unterordner
  for select to authenticated
  using (
    verschwunden_am is null
    and (
      (select public.ordner_pruefer((select auth.uid())))
      or ordner in (select unnest(public.sichtbare_ordner((select auth.uid()))))
    )
  );

alter table public.dokumente
  add column if not exists sharepoint_ziel_pfad text;

notify pgrst, 'reload schema';
