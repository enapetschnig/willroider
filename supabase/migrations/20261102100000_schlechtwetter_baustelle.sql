-- Schlechtwetter gehört zur Baustelle (J. Maurer 02.11.2026: „SW muss der
-- Baustelle zugewiesen sein mit Adresse“). Ab jetzt wählt man die Baustelle
-- beim Erfassen (App). Hier: bestehende SW-Einträge ohne Baustelle bekommen
-- die Baustelle desselben Tages, wenn sie eindeutig ist. Die Schnappschüsse
-- der Stundenberichte werden mitgezogen, damit der Tag nicht als „geändert“
-- (gelb) erscheint.

-- Sicherung (zum Zurückholen): alle SW-Einträge + betroffene Schnappschüsse
create table if not exists public.sicherung_20261102_sw_taetigkeiten as
  select * from public.stunden_taetigkeiten where art = 'schlechtwetter';
create table if not exists public.sicherung_20261102_sw_berichte as
  select sb.id, sb.snapshot from public.stunden_berichte sb
  where exists (
    select 1 from public.stunden_taetigkeiten e
    join public.stunden_tage t on t.id = e.stunden_tag_id
    where e.art = 'schlechtwetter'
      and t.mitarbeiter_id = sb.mitarbeiter_id
      and t.datum between sb.von_datum and sb.bis_datum
  );
alter table public.sicherung_20261102_sw_taetigkeiten enable row level security;
alter table public.sicherung_20261102_sw_berichte enable row level security;

-- Zuordnung: einzige Baustelle (auf der Baustelle gearbeitet) desselben Tages
create temp table _sw_zuordnung on commit drop as
  select e.id, t.mitarbeiter_id, t.datum, min(x.bs::text)::uuid as baustelle_id
  from public.stunden_taetigkeiten e
  join public.stunden_tage t on t.id = e.stunden_tag_id
  join lateral (
    select coalesce(y.ziel_baustelle_id, y.baustelle_id) as bs
    from public.stunden_taetigkeiten y
    where y.stunden_tag_id = t.id and y.art = 'baustelle'
      and coalesce(y.ort, 'baustelle') <> 'firma'
      and coalesce(y.ziel_baustelle_id, y.baustelle_id) is not null
  ) x on true
  where e.art = 'schlechtwetter' and e.baustelle_id is null
  group by e.id, t.mitarbeiter_id, t.datum
  having count(distinct x.bs) = 1;

update public.stunden_taetigkeiten e
   set baustelle_id = z.baustelle_id
  from _sw_zuordnung z
 where z.id = e.id;

-- Schnappschüsse: SW-Eintrag des Tages bekommt dieselbe Baustelle
update public.stunden_berichte sb
   set snapshot = (
     select jsonb_object_agg(
       k,
       case when z.baustelle_id is null then v
       else coalesce((
         select jsonb_agg(
           case when el->>'art' = 'schlechtwetter' and (el->>'baustelle_id') is null
                then jsonb_set(el, '{baustelle_id}', to_jsonb(z.baustelle_id::text))
                else el end
         )
         from jsonb_array_elements(v) el
       ), v) end
     )
     from jsonb_each(sb.snapshot) as s(k, v)
     left join _sw_zuordnung z
       on z.mitarbeiter_id = sb.mitarbeiter_id and z.datum::text = s.k
   )
 where sb.snapshot is not null
   and jsonb_typeof(sb.snapshot) = 'object'
   and sb.snapshot <> '{}'::jsonb
   and exists (
     select 1 from _sw_zuordnung z
      where z.mitarbeiter_id = sb.mitarbeiter_id
        and z.datum between sb.von_datum and sb.bis_datum
   );
