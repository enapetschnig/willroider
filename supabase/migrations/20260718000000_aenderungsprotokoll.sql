-- =====================================================================
-- Änderungsprotokoll für kritische Stammdaten-Felder.
-- Anlass: Ein Mitarbeiter (Fischer) war unbemerkt in eine andere Partie
-- verschoben worden — nicht nachvollziehbar, wer/wann. Ab jetzt wird
-- jede Änderung an Partie/Rolle/Aktiv-Status/Planungs-Flags protokolliert.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.aenderungsprotokoll (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabelle       TEXT NOT NULL,
  datensatz_id  UUID NOT NULL,
  feld          TEXT NOT NULL,
  alt           TEXT,
  neu           TEXT,
  geaendert_von UUID,
  geaendert_am  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aenderungsprotokoll_zeit_idx
  ON public.aenderungsprotokoll (geaendert_am DESC);

ALTER TABLE public.aenderungsprotokoll ENABLE ROW LEVEL SECURITY;

-- Lesen: nur Verwaltung. Schreiben: ausschließlich über die Trigger
-- (SECURITY DEFINER) — kein direkter Insert durch Clients.
DROP POLICY IF EXISTS protokoll_select ON public.aenderungsprotokoll;
CREATE POLICY protokoll_select ON public.aenderungsprotokoll
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'admin.view'));

-- ── Trigger: profiles (Partie, Aktiv, Partieleiter, Tagesplanung) ────
CREATE OR REPLACE FUNCTION public.log_profiles_aenderung()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.partie_id IS DISTINCT FROM OLD.partie_id THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'partie_id', OLD.partie_id::text, NEW.partie_id::text, auth.uid());
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'is_active', OLD.is_active::text, NEW.is_active::text, auth.uid());
  END IF;
  IF NEW.is_partieleiter IS DISTINCT FROM OLD.is_partieleiter THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'is_partieleiter', OLD.is_partieleiter::text, NEW.is_partieleiter::text, auth.uid());
  END IF;
  IF NEW.in_tagesplanung IS DISTINCT FROM OLD.in_tagesplanung THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('profiles', NEW.id, 'in_tagesplanung', OLD.in_tagesplanung::text, NEW.in_tagesplanung::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_profiles ON public.profiles;
CREATE TRIGGER trg_log_profiles
  AFTER UPDATE OF partie_id, is_active, is_partieleiter, in_tagesplanung
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_profiles_aenderung();

-- ── Trigger: user_roles (Rollen-Wechsel) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.log_user_roles_aenderung()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.rolle_id IS DISTINCT FROM OLD.rolle_id THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('user_roles', NEW.user_id, 'rolle_id', OLD.rolle_id::text, NEW.rolle_id::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_user_roles ON public.user_roles;
CREATE TRIGGER trg_log_user_roles
  AFTER UPDATE OF rolle_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_user_roles_aenderung();

-- ── Trigger: partien (Partieleiter-Wechsel) ──────────────────────────
CREATE OR REPLACE FUNCTION public.log_partien_aenderung()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.partieleiter_id IS DISTINCT FROM OLD.partieleiter_id THEN
    INSERT INTO aenderungsprotokoll (tabelle, datensatz_id, feld, alt, neu, geaendert_von)
    VALUES ('partien', NEW.id, 'partieleiter_id', OLD.partieleiter_id::text, NEW.partieleiter_id::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_partien ON public.partien;
CREATE TRIGGER trg_log_partien
  AFTER UPDATE OF partieleiter_id ON public.partien
  FOR EACH ROW EXECUTE FUNCTION public.log_partien_aenderung();

NOTIFY pgrst, 'reload schema';
