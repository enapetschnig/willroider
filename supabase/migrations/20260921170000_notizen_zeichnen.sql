-- Notizen: Zeichenfläche wie in GoodNotes (Wunsch 21.09.2026).
-- Die Skizze liegt als Excalidraw-Szene (Elemente, Bilder) in der Notiz;
-- ein PNG-Vorschaubild im Bucket notizen-anhaenge (<notiz>/skizze.png).
alter table public.notizen
  add column if not exists skizze jsonb,
  add column if not exists skizze_vorschau text,
  add column if not exists skizze_am timestamptz;

notify pgrst, 'reload schema';
