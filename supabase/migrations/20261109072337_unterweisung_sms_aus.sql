-- 09.11.2026, Christoph: Die Unterweisungs-Erinnerung per SMS (08/10/12 Uhr an Bauleiter, Polier, Partieleiter)
-- vorerst abschalten – zu viele SMS. Nur pausiert, die Function evaluierung-reminder bleibt bestehen.
-- Wieder einschalten: select cron.alter_job(jobid, active := true) from cron.job where jobname = 'unterweisung-erinnerung';
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'unterweisung-erinnerung';
