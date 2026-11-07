-- A human who registered before a target changed can still play for a reusable
-- value ticket. Keep the same random daily horse slots and first-paid claims.
-- @live-proof: (SELECT md5(prosrc)='bee02b3a32030d531e28fd1e95f123ac' FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE definition text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure) IS DISTINCT FROM 'e6845df54f7f1970019ead5d507ed181' THEN
    RAISE EXCEPTION 'SATELLITE_SCHEDULE_PREIMAGE_DRIFT';
  END IF;
  definition:=pg_get_functiondef('smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure);
  definition:=replace(definition,$old$       AND upper(coalesce(target_row.status,'')) IN('ANNOUNCED','REGISTERING')
       AND target_row.start_time IS NOT NULL AND isfinite(target_row.start_time)
       AND target_row.start_time>now_at$old$,$new$       AND ((upper(coalesce(target_row.status,'')) IN('ANNOUNCED','REGISTERING')
             AND target_row.start_time IS NOT NULL AND isfinite(target_row.start_time)
             AND target_row.start_time>now_at)
         OR EXISTS (SELECT 1 FROM public.tournament_players paid
              JOIN public.profiles human ON human.id=paid.user_id AND human.is_horse IS FALSE
              WHERE paid.tournament_id=t.id AND lower(paid.status::text)='registered'))$new$);
  definition:=replace(definition,$old$       AND upper(coalesce(target_row.status,'')) IN('ANNOUNCED','REGISTERING')
       AND target_row.start_time IS NOT NULL AND isfinite(target_row.start_time) AND target_row.start_time>now_at$old$,$new$       AND ((upper(coalesce(target_row.status,'')) IN('ANNOUNCED','REGISTERING')
             AND target_row.start_time IS NOT NULL AND isfinite(target_row.start_time)
             AND target_row.start_time>now_at)
         OR EXISTS (SELECT 1 FROM public.tournament_players paid
              JOIN public.profiles human ON human.id=paid.user_id AND human.is_horse IS FALSE
              WHERE paid.tournament_id=candidate.id AND lower(paid.status::text)='registered'))$new$);
  EXECUTE definition;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='smarter_private.sng_horse_plan(uuid,boolean)'::regprocedure) IS DISTINCT FROM 'bee02b3a32030d531e28fd1e95f123ac' THEN
    RAISE EXCEPTION 'SATELLITE_SCHEDULE_POSTIMAGE_DRIFT';
  END IF;
END;
$migration$;
COMMIT;
