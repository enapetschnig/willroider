-- Regieberichte: mehrere am Tag, Datum änderbar (J. Maurer, 25.11.2026:
-- „Regieberichte müssen auch mehrere am Tag möglich sein weiters braucht es
-- die Möglichkeit das Datum zu ändern“).
--
-- Bisher UNIQUE (baustelle_id, datum, typ) für beide Arten. Der Bautagesbericht
-- bleibt einmal je Baustelle und Tag (MeinTag/„Foto hochladen“ sucht ihn so),
-- Regieberichte dürfen mehrfach vorkommen. Erst den neuen Index, dann den alten
-- Constraint weg — dazwischen gibt es keinen Moment ohne Schutz.

create unique index if not exists berichte_bautagesbericht_je_tag
  on public.berichte (baustelle_id, datum)
  where typ = 'bautagesbericht';

alter table public.berichte
  drop constraint if exists berichte_baustelle_id_datum_typ_key;

comment on table public.berichte is
  'Bautages- + Regieberichte. Bautagesbericht einmal je (Baustelle, Datum) '
  '(Index berichte_bautagesbericht_je_tag), Regieberichte beliebig viele.';

-- Datumsänderung im Verlauf des Berichts festhalten.
create or replace function public.bericht_audit()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.bericht_aenderungen (bericht_id, autor_id, art, details)
    values (new.id, new.erfasst_von, 'erstellt', null);
    return new;
  end if;
  if old.datum is distinct from new.datum then
    insert into public.bericht_aenderungen (bericht_id, autor_id, art, details)
    values (new.id, auth.uid(), 'editiert',
      concat('Datum: ', to_char(old.datum, 'DD.MM.YYYY'), ' → ', to_char(new.datum, 'DD.MM.YYYY')));
  end if;
  if old.status is distinct from new.status then
    insert into public.bericht_aenderungen (bericht_id, autor_id, art, details)
    values (new.id, auth.uid(), new.status::text,
      concat('Status: ', old.status, ' → ', new.status));
    return new;
  end if;
  if old.freitext_besonderheiten is distinct from new.freitext_besonderheiten
     or old.wetter_beschreibung is distinct from new.wetter_beschreibung
     or old.temperatur_min is distinct from new.temperatur_min
     or old.temperatur_max is distinct from new.temperatur_max
     or old.niederschlag_mm is distinct from new.niederschlag_mm then
    insert into public.bericht_aenderungen (bericht_id, autor_id, art, details)
    values (new.id, auth.uid(), 'editiert', 'Bericht-Felder geändert');
  end if;
  return new;
end $$;
