CREATE OR REPLACE FUNCTION public.fn_club_rake_rollup_day(p_club_id uuid, p_day date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start timestamptz := p_day::timestamptz;
  v_end   timestamptz := (p_day + 1)::timestamptz;
  v_rows  integer := 0;
BEGIN
  IF v_end > date_trunc('day', now()) THEN
    RAISE EXCEPTION 'club rake rollup: day % is not complete', p_day;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('club_rake_rollup:' || p_club_id::text || ':' || p_day::text, 42));

  DELETE FROM club_rake_daily_user WHERE club_id = p_club_id AND day = p_day;

  WITH split AS (
    SELECT a.player_id AS user_id, round(a.rake_amount * 100)::bigint AS cents
      FROM rake_attributions a
     WHERE a.club_id = p_club_id
       AND a.created_at >= v_start AND a.created_at < v_end
       AND a.rake_amount > 0
       AND public.fn_ca_launch_accounting_accepts(a.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=a.rake_record_id))
  ), ins AS (
    INSERT INTO club_rake_daily_user (club_id, day, user_id, rake_amount, hands)
    SELECT p_club_id, p_day, s.user_id, SUM(s.cents)::numeric / 100, count(*)
      FROM split s GROUP BY s.user_id
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;

  INSERT INTO club_rake_rollup_complete (club_id, day, rows_written, computed_at)
  VALUES (p_club_id, p_day, v_rows, now())
  ON CONFLICT (club_id, day) DO UPDATE
    SET rows_written = EXCLUDED.rows_written, computed_at = EXCLUDED.computed_at;

  RETURN v_rows;
END $function$

