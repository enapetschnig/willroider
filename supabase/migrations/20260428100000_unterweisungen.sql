-- 3 neue Unterweisungs-Typen ergänzen (kurz/lang bleiben aus Kompatibilität)
ALTER TYPE evaluierung_typ ADD VALUE IF NOT EXISTS 'werkstatt';
ALTER TYPE evaluierung_typ ADD VALUE IF NOT EXISTS 'baustelle';
ALTER TYPE evaluierung_typ ADD VALUE IF NOT EXISTS 'fertigteilmontage';
