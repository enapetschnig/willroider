-- =====================================================================
-- Unterweisung: Polier-Lücke schließen, Karenzfrist einstellbar machen.
--
-- Gemeldet: „Polier + Mitarbeiter muss die Unterweisung sehen und
-- unterschreiben. Am ersten Tag auf einer neuen Baustelle muss die
-- Unterweisung erfolgen und unterschrieben werden."
--
-- BEFUND: fast alles ist schon gebaut — Datenmodell, automatische
-- Zuteilung bei der Einteilung, sogar eine Vollbild-Sperre über der
-- ganzen App (EvaluierungSignatureGate). Es läuft nur nichts, weil
--   • KEINE der 92 Baustellen eine Pflicht-Unterweisung hinterlegt hat,
--   • und die Sperre erst nach 3 Werktagen Karenz greift.
--
-- Zwei echte Lücken, die diese Migration schließt:
--
-- 1. DER POLIER GEHT LEER AUS. Die Zuteilung hängt an
--    `einteilung_mitarbeiter`. Der Partieleiter steht dort oft nicht
--    selbst drin — er teilt ein, wird aber nicht eingeteilt. Damit bekam
--    er nie eine Unterschriftsaufforderung, obwohl der Wunsch
--    ausdrücklich „Polier UND Mitarbeiter" lautet.
--
-- 2. KARENZ FEST VERDRAHTET. Die 3 Werktage stehen im Frontend als
--    Konstante. „Ab dem ersten Tag" wäre damit ein Programmiereinsatz.
--    Jetzt ein Feld je Unterweisung — das Umlegen ist danach eine Zahl.
--
-- Die Sperre selbst bleibt AUS, wie besprochen: erst der Hinweis, damit
-- die Unterweisungen in Ruhe hinterlegt werden können.
-- =====================================================================


-- ─── 1. Karenzfrist je Unterweisung ──────────────────────────────────
ALTER TABLE public.evaluierungen
  ADD COLUMN IF NOT EXISTS karenz_werktage INT NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.evaluierungen.karenz_werktage IS
  'Wie viele Werktage nach dem Unterweisungs-Datum darf jemand die App '
  'noch ohne Unterschrift benutzen. 0 = ab dem ersten Tag gesperrt.';


-- ─── 2. Zuteilung: den Polier der Baustellen-Partie mitnehmen ────────
--
-- Beide Auslöser bekommen dieselbe Ergänzung, damit sie nicht
-- auseinanderlaufen: ein Helfer, der zu einer Baustelle die Person
-- liefert, die dort führt.
CREATE OR REPLACE FUNCTION public.polier_der_baustelle(_baustelle UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pa.partieleiter_id
    FROM public.baustellen b
    JOIN public.partien pa ON pa.id = b.partie_id
   WHERE b.id = _baustelle;
$$;

COMMENT ON FUNCTION public.polier_der_baustelle(UUID) IS
  'Partieleiter der Partie, die auf dieser Baustelle arbeitet. Er teilt '
  'ein, steht aber oft nicht selbst in der Einteilung — für die '
  'Pflicht-Unterweisung muss er trotzdem unterschreiben.';


-- Auslöser 1: Mitarbeiter wird eingeteilt → Aufforderung für ihn UND
-- für den Polier der Baustelle.
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_zuteilen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_baustelle_id UUID;
  v_pflicht_id UUID;
  v_polier UUID;
BEGIN
  SELECT baustelle_id INTO v_baustelle_id
    FROM public.einteilungen WHERE id = NEW.einteilung_id;
  IF v_baustelle_id IS NULL THEN RETURN NEW; END IF;

  SELECT pflicht_evaluierung_id INTO v_pflicht_id
    FROM public.baustellen WHERE id = v_baustelle_id;
  IF v_pflicht_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.evaluierung_unterschriften
    (evaluierung_id, mitarbeiter_id, unterschrift_data)
  VALUES (v_pflicht_id, NEW.mitarbeiter_id, NULL)
  ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;

  -- Der Polier gehört dazu, auch wenn er nicht eingeteilt ist.
  v_polier := public.polier_der_baustelle(v_baustelle_id);
  IF v_polier IS NOT NULL THEN
    INSERT INTO public.evaluierung_unterschriften
      (evaluierung_id, mitarbeiter_id, unterschrift_data)
    VALUES (v_pflicht_id, v_polier, NULL)
    ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;


-- Auslöser 2: Baustelle bekommt eine Pflicht-Unterweisung → rückwirkend
-- für alle Eingeteilten, für ALLE aktiven Mitglieder der Partie und für
-- den Polier.
CREATE OR REPLACE FUNCTION public.pflicht_unterweisung_nachholen()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.pflicht_evaluierung_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.pflicht_evaluierung_id IS NOT DISTINCT FROM NEW.pflicht_evaluierung_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.evaluierung_unterschriften
    (evaluierung_id, mitarbeiter_id, unterschrift_data)
  SELECT NEW.pflicht_evaluierung_id, ma_id, NULL
    FROM (
      -- Wer auf dieser Baustelle eingeteilt ist
      SELECT em.mitarbeiter_id AS ma_id
        FROM public.einteilung_mitarbeiter em
        JOIN public.einteilungen e ON e.id = em.einteilung_id
       WHERE e.baustelle_id = NEW.id
      UNION
      -- Die Partie der Baustelle, inklusive ihres Leiters
      SELECT p.id
        FROM public.profiles p
       WHERE p.partie_id = NEW.partie_id
         AND p.is_active
         AND COALESCE(p.in_tagesplanung, TRUE)
      UNION
      SELECT pa.partieleiter_id
        FROM public.partien pa
       WHERE pa.id = NEW.partie_id AND pa.partieleiter_id IS NOT NULL
    ) q
   WHERE ma_id IS NOT NULL
  ON CONFLICT (evaluierung_id, mitarbeiter_id) DO NOTHING;

  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
