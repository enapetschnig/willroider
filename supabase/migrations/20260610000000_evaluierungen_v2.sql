-- Evaluierungen v2: Templates, Status-Workflow, Auto-Archivierung
-- ausgeschiedener MA, Reminder-View, Reminder-Tracking.
--
-- Kern-Änderungen:
--  • neue Tabelle `evaluierung_vorlagen` (wiederverwendbare Templates)
--  • `evaluierung_unterschriften`: Status-Spalten + Reminder-Tracking
--  • Trigger: setzt offene Unterschriften ausgeschiedener MA auf archiviert
--  • View `v_offene_unterschriften_mit_alter` für „seit wann offen?"
--  • bestehende View `v_offene_unterschriften` filtert auf status='offen'

-- ===== Phase 1a: Templates =====
CREATE TABLE IF NOT EXISTS public.evaluierung_vorlagen (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  typ               public.evaluierung_typ NOT NULL DEFAULT 'kurz',
  checkliste        JSONB NOT NULL DEFAULT '[]'::jsonb,
  quell_dokument_id UUID REFERENCES public.dokumente(id) ON DELETE SET NULL,
  notizen           TEXT,
  aktiv             BOOLEAN NOT NULL DEFAULT TRUE,
  erstellt_von      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evaluierung_vorlagen_aktiv
  ON public.evaluierung_vorlagen(aktiv);

ALTER TABLE public.evaluierung_vorlagen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ev_vorlagen_select ON public.evaluierung_vorlagen;
CREATE POLICY ev_vorlagen_select ON public.evaluierung_vorlagen
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS ev_vorlagen_write ON public.evaluierung_vorlagen;
CREATE POLICY ev_vorlagen_write ON public.evaluierung_vorlagen
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

-- updated_at-Trigger
CREATE OR REPLACE FUNCTION public.evaluierung_vorlagen_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_ev_vorlagen_updated_at ON public.evaluierung_vorlagen;
CREATE TRIGGER trg_ev_vorlagen_updated_at
  BEFORE UPDATE ON public.evaluierung_vorlagen
  FOR EACH ROW EXECUTE FUNCTION public.evaluierung_vorlagen_set_updated_at();

-- ===== Phase 1b: Status-Spalten auf Unterschriften =====
ALTER TABLE public.evaluierung_unterschriften
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'offen'
    CHECK (status IN ('offen','unterschrieben','archiviert')),
  ADD COLUMN IF NOT EXISTS archiviert_grund TEXT,
  ADD COLUMN IF NOT EXISTS archiviert_am TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_geschickt_am TIMESTAMPTZ;

-- Backfill: bestehende Rows in den richtigen Status setzen
UPDATE public.evaluierung_unterschriften
   SET status = CASE
                  WHEN unterschrift_data IS NOT NULL THEN 'unterschrieben'
                  ELSE 'offen'
                END
 WHERE status = 'offen' AND unterschrift_data IS NOT NULL;

-- ===== Phase 1c: Trigger — MA-Austritt archiviert offene Unterschriften =====
CREATE OR REPLACE FUNCTION public.archiviere_unterschriften_bei_austritt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.is_active = FALSE AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
    UPDATE public.evaluierung_unterschriften
       SET status = 'archiviert',
           archiviert_grund = 'MA inaktiv',
           archiviert_am = NOW()
     WHERE mitarbeiter_id = NEW.id
       AND status = 'offen';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_archiviere_unterschriften ON public.profiles;
CREATE TRIGGER trg_archiviere_unterschriften
  AFTER UPDATE OF is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.archiviere_unterschriften_bei_austritt();

-- ===== Phase 1c-Backfill: aktuell inaktive MA mit offenen Aufforderungen =====
UPDATE public.evaluierung_unterschriften u
   SET status = 'archiviert',
       archiviert_grund = 'MA inaktiv (Backfill)',
       archiviert_am = NOW()
  FROM public.profiles p
 WHERE p.id = u.mitarbeiter_id
   AND p.is_active = FALSE
   AND u.status = 'offen';

-- ===== Phase 1d: Reminder-View „seit wann offen?" =====
CREATE OR REPLACE VIEW public.v_offene_unterschriften_mit_alter AS
SELECT u.id AS unterschrift_id,
       u.evaluierung_id,
       u.mitarbeiter_id,
       u.reminder_geschickt_am,
       e.baustelle_id,
       e.datum AS evaluierung_datum,
       e.notizen AS evaluierung_titel,
       e.typ AS evaluierung_typ,
       (CURRENT_DATE - e.datum)::int AS tage_offen
  FROM public.evaluierung_unterschriften u
  JOIN public.evaluierungen e ON e.id = u.evaluierung_id
 WHERE u.status = 'offen';

-- ===== Phase 1e: View v_offene_unterschriften auf status='offen' umstellen =====
-- (vorher: WHERE unterschrift_data IS NULL — funktional gleich, aber
-- mit dem neuen status-Feld stabiler, weil wir „archiviert" sauber
-- ausschließen).
CREATE OR REPLACE VIEW public.v_offene_unterschriften AS
WITH offene AS (
  SELECT u.id AS unterschrift_id,
         u.evaluierung_id,
         u.mitarbeiter_id,
         e.baustelle_id,
         e.notizen AS evaluierung_titel,
         e.datum AS evaluierung_datum
  FROM public.evaluierung_unterschriften u
  JOIN public.evaluierungen e ON e.id = u.evaluierung_id
  WHERE u.status = 'offen'
),
mit_verantwortlichen AS (
  SELECT o.*,
         b.bvh_name,
         b.bauleiter_id,
         (SELECT partieleiter_id FROM public.partien p
          WHERE p.id = b.partie_id) AS polier_id
  FROM offene o
  JOIN public.baustellen b ON b.id = o.baustelle_id
)
SELECT 'polier'::text AS rolle,
       polier_id AS verantwortlich_id,
       baustelle_id, evaluierung_id, unterschrift_id, mitarbeiter_id,
       bvh_name, evaluierung_titel, evaluierung_datum
FROM mit_verantwortlichen WHERE polier_id IS NOT NULL
UNION ALL
SELECT 'bauleiter',
       bauleiter_id,
       baustelle_id, evaluierung_id, unterschrift_id, mitarbeiter_id,
       bvh_name, evaluierung_titel, evaluierung_datum
FROM mit_verantwortlichen WHERE bauleiter_id IS NOT NULL;

COMMENT ON TABLE public.evaluierung_vorlagen IS
  'Wiederverwendbare Vorlagen für Sicherheits-Unterweisungen. „Aus Vorlage erstellen" kopiert typ + checkliste + notizen in eine neue Evaluierung.';
COMMENT ON COLUMN public.evaluierung_unterschriften.status IS
  'offen | unterschrieben | archiviert. Archiviert wird automatisch beim Austritt eines MA.';
COMMENT ON VIEW public.v_offene_unterschriften_mit_alter IS
  'Offene Unterschriften des angefragten Users — zeigt zusätzlich tage_offen (CURRENT_DATE - evaluierung.datum). Dient dem MA-Dashboard für „Karenzfrist abgelaufen".';
