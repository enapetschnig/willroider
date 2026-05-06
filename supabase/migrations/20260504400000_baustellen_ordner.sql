-- Neue Baustellen-Ordnerstruktur (analog zur internen Aktenstruktur des Betriebs)
-- + Settings-Tabelle für rollenbasierte Sichtbarkeit.

-- 1) Bestehende dokumente.ordner-Werte auf neue Keys mappen
UPDATE public.dokumente SET ordner = '1-baustellenmanagement' WHERE ordner = 'baustellenanlage';
UPDATE public.dokumente SET ordner = '6-abrechnung' WHERE ordner IN ('rechnungen', 'stundenzettel');
UPDATE public.dokumente SET ordner = '7-lieferanten' WHERE ordner = 'lieferscheine';
UPDATE public.dokumente SET ordner = '91-plaene' WHERE ordner = 'plaene';
UPDATE public.dokumente SET ordner = '92-sonstiges' WHERE ordner IN ('sonstige', 'berichte');
-- evaluierung-Ordner bleibt für Unterweisungs-Dokumente; fotos bleibt unverändert

-- 2) App-Settings-Tabelle (key/value JSON) für globale Konfiguration
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_select_all ON public.app_settings;
CREATE POLICY app_settings_select_all ON public.app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS app_settings_modify_admin ON public.app_settings;
CREATE POLICY app_settings_modify_admin ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_admin_role(auth.uid()))
  WITH CHECK (public.is_admin_role(auth.uid()));

DROP TRIGGER IF EXISTS app_settings_set_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_set_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Default-Sichtbarkeit pro Rolle
-- geschaeftsfuehrung + buero: alles
-- bauleiter (Vorarbeiter): operatives ohne Vertrag/Subunternehmer/Abrechnung/Kalkulation
-- mitarbeiter: nur Fotos + Pläne + Sonstiges
INSERT INTO public.app_settings (key, value)
VALUES (
  'ordner_visibility',
  jsonb_build_object(
    'geschaeftsfuehrung', jsonb_build_array(
      '1-baustellenmanagement','2-schriftverkehr','3-aktenvermerke','4-vertrag',
      '5-subunternehmer','6-abrechnung','7-lieferanten','8-kalkulation',
      '91-plaene','92-sonstiges','93-dhp','94-statik','fotos','evaluierung'
    ),
    'buero', jsonb_build_array(
      '1-baustellenmanagement','2-schriftverkehr','3-aktenvermerke','4-vertrag',
      '5-subunternehmer','6-abrechnung','7-lieferanten','8-kalkulation',
      '91-plaene','92-sonstiges','93-dhp','94-statik','fotos','evaluierung'
    ),
    'bauleiter', jsonb_build_array(
      '1-baustellenmanagement','2-schriftverkehr','3-aktenvermerke',
      '5-subunternehmer','7-lieferanten',
      '91-plaene','92-sonstiges','93-dhp','94-statik','fotos','evaluierung'
    ),
    'mitarbeiter', jsonb_build_array(
      'fotos','91-plaene','92-sonstiges','evaluierung'
    ),
    'zimmermeister', jsonb_build_array(
      '1-baustellenmanagement','2-schriftverkehr','3-aktenvermerke',
      '5-subunternehmer','7-lieferanten',
      '91-plaene','92-sonstiges','93-dhp','94-statik','fotos','evaluierung'
    )
  )
)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_settings IS
  'Globale App-Konfiguration als JSON-Werte. Aktuell: ordner_visibility (welche Rolle sieht welche Baustellen-Ordner).';
