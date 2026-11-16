-- @live-proof: position('new_cash_by_recorded_time' in pg_get_functiondef('public.fn_settle_accounting_rakeback_pairs(text,uuid,timestamptz,timestamptz)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
  reader regprocedure := 'public.fn_settle_accounting_rakeback_pairs(text,uuid,timestamptz,timestamptz)'::regprocedure;
  original text := pg_get_functiondef(reader);
  first_at integer := strpos(original,'), late_cash_windows AS MATERIALIZED');
  last_at integer := strpos(original,'), w AS MATERIALIZED');
BEGIN
  IF md5(original)<>'8b44aa928247e7fffdacfc5d83dfc2da' OR first_at=0 OR last_at<=first_at THEN
    RAISE EXCEPTION 'weekly_player_cash_window_reader_changed';
  END IF;
  -- Read new postings from the covering (club_id, recorded_at) index.
  -- A posting in another coordinator's book can prompt a window refresh.
  -- The original window reader below still filters the exact financial scope.
  EXECUTE left(original,first_at-1)||$new$), new_cash_by_recorded_time AS MATERIALIZED (
   SELECT s.earned_at,s.recorded_at FROM clubs CROSS JOIN LATERAL (
     SELECT s.earned_at,s.recorded_at FROM public.accounting_cash_rake_sources s
     WHERE s.club_id=clubs.id AND s.recorded_at >= (SELECT min(computed_at) FROM cached)
     ORDER BY s.recorded_at OFFSET 0
   ) s WHERE s.earned_at>=p_period_start AND s.earned_at<p_period_end
 ), late_cash_windows AS MATERIALIZED (
   SELECT DISTINCT c.window_start FROM new_cash_by_recorded_time s JOIN cached c
     ON s.earned_at>=c.window_start AND s.earned_at<c.window_end AND s.recorded_at>=c.computed_at
 $new$||substr(original,last_at);
END
$migration$;
COMMIT;
