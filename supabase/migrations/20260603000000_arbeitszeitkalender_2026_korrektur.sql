-- ─── Arbeitszeitkalender 2026 — Korrektur Lange/Kurze Woche ────────────
-- Migration 20260516 hat das L/K-Muster falsch geseedet (ungerade KW = L,
-- gerade = K). Der offizielle Arbeitszeitkalender (Betriebsvereinbarung
-- 27.02.2026) hat ein anderes Muster — 28 von 34 Saisonwochen waren falsch.
--
-- Diese Migration setzt KW 11–44/2026 auf die echten Werte:
--   Lange Woche  (L) = 42 h  (Mo–Do je 9 h, Fr 6 h)
--   Kurze Woche  (K) = 36 h  (Mo–Do je 9 h, Fr frei)
--   KW 26 = Betriebsversammlung (BV, wie L = 42 h)
--   KW 33 = Betriebsurlaub      (BU, 0 h)
-- Feiertage in der Saison sind im Tages-Soll bereits auf 0 gesetzt
-- (Ostermontag, Staatsfeiertag, Chr. Himmelfahrt, Pfingstmontag,
-- Fronleichnam, Nationalfeiertag).
--
-- KW 1–10 und 45–53 bleiben unverändert.
-- ───────────────────────────────────────────────────────────────────────

INSERT INTO public.arbeitszeitkalender
  (jahr, kw, wochentyp, soll_mo, soll_di, soll_mi, soll_do, soll_fr, soll_sa, soll_so, soll_stunden)
VALUES
  (2026, 11, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 12, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 13, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 14, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 15, 'L',  0, 9, 9, 9, 6, 0, 0, 33),  -- Ostermontag (Mo)
  (2026, 16, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 17, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 18, 'L',  9, 9, 9, 9, 0, 0, 0, 36),  -- Staatsfeiertag (Fr)
  (2026, 19, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 20, 'K',  9, 9, 9, 0, 0, 0, 0, 27),  -- Christi Himmelfahrt (Do)
  (2026, 21, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 22, 'L',  0, 9, 9, 9, 6, 0, 0, 33),  -- Pfingstmontag (Mo)
  (2026, 23, 'K',  9, 9, 9, 0, 0, 0, 0, 27),  -- Fronleichnam (Do)
  (2026, 24, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 25, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 26, 'BV', 9, 9, 9, 9, 6, 0, 0, 42),  -- Betriebsversammlung
  (2026, 27, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 28, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 29, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 30, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 31, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 32, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 33, 'BU', 0, 0, 0, 0, 0, 0, 0,  0),  -- Betriebsurlaub
  (2026, 34, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 35, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 36, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 37, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 38, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 39, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 40, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 41, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 42, 'L',  9, 9, 9, 9, 6, 0, 0, 42),
  (2026, 43, 'K',  9, 9, 9, 9, 0, 0, 0, 36),
  (2026, 44, 'L',  0, 9, 9, 9, 6, 0, 0, 33)   -- Nationalfeiertag (Mo)
ON CONFLICT (jahr, kw) DO UPDATE SET
  wochentyp    = EXCLUDED.wochentyp,
  soll_mo      = EXCLUDED.soll_mo,
  soll_di      = EXCLUDED.soll_di,
  soll_mi      = EXCLUDED.soll_mi,
  soll_do      = EXCLUDED.soll_do,
  soll_fr      = EXCLUDED.soll_fr,
  soll_sa      = EXCLUDED.soll_sa,
  soll_so      = EXCLUDED.soll_so,
  soll_stunden = EXCLUDED.soll_stunden;
