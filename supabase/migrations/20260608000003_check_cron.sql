-- Diagnose: zeigt den Status des pg_cron-Jobs „bsb-abend" als RAISE NOTICE.
-- Macht keine Datenänderungen.

DO $$
DECLARE
  v_ext_present boolean;
  v_job record;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_ext_present;
  RAISE NOTICE 'pg_cron Extension installiert: %', v_ext_present;

  IF v_ext_present THEN
    FOR v_job IN
      SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'bsb-abend'
    LOOP
      RAISE NOTICE 'Cron-Job: % | schedule: % | active: % | command: %',
        v_job.jobname, v_job.schedule, v_job.active, v_job.command;
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bsb-abend') THEN
      RAISE NOTICE 'Cron-Job bsb-abend NICHT vorhanden';
    END IF;
  END IF;
END $$;
