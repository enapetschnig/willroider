-- Konsistenter Ordner-Key für „5-Subunternehmer-Professionisten".
-- Das UI-Label ist seit langem korrekt; der DB-Key war noch der alte
-- (kürzere) Wert „5-subunternehmer". Diese Migration etikettiert
-- existierende Dokumente und ordner_visibility-Settings um. Storage-
-- Pfade bleiben absichtlich unverändert (Frontend liest nur die
-- ordner-Spalte; alte Files bleiben unter ihrem alten Pfad erreichbar).
--
-- Idempotent: nach dem ersten Lauf gibt es keinen Treffer mehr.

-- 1) Dokumente
UPDATE public.dokumente
   SET ordner = '5-subunternehmer-professionisten'
 WHERE ordner = '5-subunternehmer';

-- 2) Leere-Unterordner-Marker
UPDATE public.dokument_ordner
   SET ordner = '5-subunternehmer-professionisten'
 WHERE ordner = '5-subunternehmer';

-- 3) Rollen-Sichtbarkeit (JSONB pro Rolle → Array<OrdnerKey>).
--    Wir laufen über jede Rolle und ersetzen im Array den alten Key.
UPDATE public.app_settings
   SET value = COALESCE((
         SELECT jsonb_object_agg(rolle,
           CASE
             WHEN keys ? '5-subunternehmer' THEN (
               SELECT jsonb_agg(
                 CASE WHEN k = '5-subunternehmer'
                      THEN '5-subunternehmer-professionisten'
                      ELSE k END
               )
               FROM jsonb_array_elements_text(keys) AS k
             )
             ELSE keys
           END
         )
         FROM jsonb_each(value) AS j(rolle, keys)
       ), value)
 WHERE key = 'ordner_visibility';
