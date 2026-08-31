-- =====================================================================
-- Weiterleitung der Änderungswünsche ins epower-CRM (app.epowergmbh.at).
--
-- Die App SCHICKT, das CRM sammelt nur ein — es hat keine Supabase-
-- Schlüssel dieser App. Bilder/Sprachnachrichten bleiben in den privaten
-- Buckets; das CRM holt bei Bedarf eine signierte URL über die Edge
-- Function `wunsch-datei` (gleiches Geheimnis).
--
-- Willroider hat sein eigenes, älteres Feedback-Schema (Tabelle
-- `feedback`, Kategorien idee/problem/sonstiges, Status inkl.
-- sofort/besprechung, zwei Buckets). Der Trigger übersetzt auf den
-- CRM-Vertrag; der Bucket steht als Präfix im Pfad, damit `wunsch-datei`
-- weiß, wo die Datei liegt.
--
-- Der Trigger ist INAKTIV, solange cockpit_verbindung leer ist.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Verbindungsdaten: bewusst eigene Tabelle ohne Policies — nur
-- service_role/SECURITY DEFINER kommt ran, der Client nie.
CREATE TABLE IF NOT EXISTS public.cockpit_verbindung (
  einzig    boolean PRIMARY KEY DEFAULT true CHECK (einzig),  -- genau 1 Zeile
  url       text NOT NULL,
  secret    text NOT NULL,
  app_key   text NOT NULL DEFAULT 'willroider'
);
ALTER TABLE public.cockpit_verbindung ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.wunsch_ans_cockpit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v public.cockpit_verbindung%ROWTYPE;
  melder text;
BEGIN
  SELECT * INTO v FROM public.cockpit_verbindung LIMIT 1;
  IF v IS NULL THEN
    RETURN NEW;                     -- Verbindung nicht eingerichtet: still
  END IF;

  SELECT NULLIF(TRIM(CONCAT(p.vorname, ' ', p.nachname)), '')
    INTO melder FROM public.profiles p WHERE p.id = NEW.erstellt_von;

  PERFORM net.http_post(
    url := v.url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-app-key', v.app_key,
      'x-cockpit-secret', v.secret
    ),
    body := jsonb_build_object(
      'id',     NEW.id,
      -- Kategorien aufs CRM-Vokabular übersetzt
      'art',    CASE NEW.kategorie
                  WHEN 'idee' THEN 'wunsch'
                  WHEN 'problem' THEN 'fehler'
                  ELSE 'frage'
                END,
      -- Status 1:1 — das CRM zeigt unbekannte Werte als Rohtext an,
      -- sofort/besprechung sollen dort genau so lesbar sein.
      'status', NEW.status,
      -- Das CRM verlangt einen Text; reine Sprachnachrichten bekommen
      -- einen Platzhalter, bis die Abschrift den Text nachträgt.
      'text',   COALESCE(NULLIF(NEW.text, ''), '(Sprachnachricht)'),
      'antwort', NEW.admin_notiz,
      'seite',   NEW.seiten_kontext,
      -- Bucket als Präfix — wunsch-datei trennt ihn wieder ab. Nur echte
      -- Bilder als bild_pfad, ein PDF-Anhang würde im CRM als <img> brechen.
      'bild_pfad', CASE
                     WHEN NEW.anhang_pfad IS NOT NULL AND NEW.anhang_typ ILIKE 'image/%'
                     THEN 'feedback-dateien/' || NEW.anhang_pfad
                     ELSE NULL
                   END,
      'audio_pfad', CASE
                      WHEN NEW.audio_pfad IS NOT NULL
                      THEN 'feedback-audio/' || NEW.audio_pfad
                      ELSE NULL
                    END,
      'melder',          COALESCE(melder, ''),
      'erstellt_am',     NEW.created_at,
      'aktualisiert_am', NEW.updated_at
    )
  );
  RETURN NEW;
END;
$$;

-- INSERT und die relevanten UPDATEs: text (Abschrift trägt nach),
-- status/admin_notiz (Bearbeitung), Anhänge.
DROP TRIGGER IF EXISTS trg_wunsch_cockpit ON public.feedback;
CREATE TRIGGER trg_wunsch_cockpit
  AFTER INSERT OR UPDATE OF status, admin_notiz, text, anhang_pfad, audio_pfad
  ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.wunsch_ans_cockpit();
