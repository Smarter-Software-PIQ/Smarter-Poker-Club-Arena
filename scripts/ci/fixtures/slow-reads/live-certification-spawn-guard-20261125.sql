CREATE OR REPLACE FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.fn_ca_certification_schedule_past_its_run(NEW.schedule_id) THEN
    -- 23505 is the spawner's "occurrence already decided, stand down" answer
    -- (ScheduledTournamentService.claimSpawn), so it creates nothing and
    -- reports nothing. The message states the real reason.
    RAISE EXCEPTION
      'CERT_FIXTURE_PAST_ITS_RUN: schedule % belongs to a certification fixture club older than the 162-minute certification floor; occurrence % is not materialized',
      NEW.schedule_id, NEW.spawn_key
      USING ERRCODE = '23505',
            HINT = 'A certification fixture is retired by its run cleanup or the guarded residue sweep (cert-residue-sweep.yml); it never spawns boards after its run.';
  END IF;
  RETURN NEW;
END
$function$
