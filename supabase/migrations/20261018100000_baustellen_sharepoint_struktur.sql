-- Welche SharePoint-Ordnerstruktur hat die Baustelle? (Wunsch S. Egger,
-- Mail 16.10.2026). 'bvh-neu' = von der App nach der neuen Vorlage angelegt
-- (00-Baustelle, 01-Baustellenmanagement …). NULL = bisheriger Ordner.
--
-- Davon hängt ab, wohin die App ihre PDFs ablegt: bei 'bvh-neu' kommen
-- Bautages-/Regieberichte und unterschriebene Evaluierungen direkt in
-- „00-Baustelle", die Baustellenanlage als PDF direkt in
-- „01-Baustellenmanagement" — jeweils als „<Kostenstelle> <Art> <Datum>.pdf".
-- Bestehende Baustellen bleiben, wie sie waren.
alter table public.baustellen add column if not exists sharepoint_struktur text;

comment on column public.baustellen.sharepoint_struktur is
  'SharePoint-Ordnerstruktur: bvh-neu = nach neuer Vorlage angelegt (ab 10/2026), NULL = bisheriger Ordner';
