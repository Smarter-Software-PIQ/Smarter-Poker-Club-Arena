CREATE OR REPLACE FUNCTION public.fn_bbj_contributions_total_advance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key    text := 'bbj_contributions_inflow';
  v_as_of  timestamptz;
  v_total  numeric;
  v_rows   bigint;
  v_target timestamptz := now() - interval '1 hour';
  d_total  numeric;
  d_rows   bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('money_flow_cp:' || v_key, 42));

  SELECT c.as_of, c.total, c.rows_seen INTO v_as_of, v_total, v_rows
    FROM money_flow_checkpoint c WHERE c.metric_key = v_key;
  IF NOT FOUND THEN
    v_as_of := '-infinity'::timestamptz; v_total := 0; v_rows := 0;
  END IF;

  IF v_target <= v_as_of THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(b.amount), 0), COUNT(*)
    INTO d_total, d_rows
    FROM bbj_contributions b
   WHERE b.created_at >= v_as_of AND b.created_at < v_target;

  INSERT INTO money_flow_checkpoint
        (metric_key, as_of, total, rows_seen, last_verified_at, updated_at)
  VALUES (v_key, v_target, v_total + d_total, v_rows + d_rows, now(), now())
  ON CONFLICT (metric_key) DO UPDATE
    SET as_of      = EXCLUDED.as_of,
        total      = EXCLUDED.total,
        rows_seen  = EXCLUDED.rows_seen,
        updated_at = now();
END;
$function$
