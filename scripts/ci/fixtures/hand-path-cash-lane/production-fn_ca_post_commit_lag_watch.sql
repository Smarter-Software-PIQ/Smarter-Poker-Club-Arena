CREATE OR REPLACE FUNCTION public.fn_ca_post_commit_lag_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '20s'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  c_source  constant text    := 'fn_ca_post_commit_lag_watch';
  c_warn_s  constant numeric := 2;    -- the owner's hand-gap limit (2026-11-17 22:22 CT)
  c_clear_s constant numeric := 1.5;  -- resolve below this: no flapping at the line
  c_crit_s  constant numeric := 15;
  c_warn_n  constant int     := 5;
  c_crit_n  constant int     := 3;
  c_max_new constant int     := 10;
  v_judged  jsonb;
  v_lagging int;
  v_new int := 0; v_escalated int := 0; v_resolved int := 0;
  r record;
BEGIN
  WITH recent AS (
    SELECT h.table_id, h.post_commit_completed_at IS NULL AS pending,
           extract(epoch FROM COALESCE(h.post_commit_completed_at, now()) - h.committed_at) AS lag_s
      FROM hand_atomic_commits h
     WHERE h.committed_at >= now() - interval '5 minutes'
       AND h.post_commit_payload IS NOT NULL
    UNION ALL
    SELECT h.table_id, true, extract(epoch FROM now() - h.committed_at)
      FROM hand_atomic_commits h
     WHERE h.post_commit_payload IS NOT NULL AND h.post_commit_completed_at IS NULL
       AND h.committed_at < now() - interval '5 minutes'
  ), per AS (
    SELECT table_id, count(*) AS hands, count(*) FILTER (WHERE pending) AS pending,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY lag_s) AS p95_s,
           max(lag_s) AS max_s, COALESCE(max(lag_s) FILTER (WHERE pending), 0) AS oldest_pending_s
      FROM recent GROUP BY table_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'table_id', p.table_id, 'hands', p.hands, 'pending', p.pending,
           'p95_s', round(p.p95_s::numeric, 3), 'max_s', round(p.max_s::numeric, 3),
           'oldest_pending_s', round(p.oldest_pending_s::numeric, 3),
           'severity', CASE WHEN (p.hands >= c_crit_n AND p.p95_s > c_crit_s) OR p.oldest_pending_s > c_crit_s
                            THEN 'critical'
                            WHEN p.hands >= c_warn_n AND p.p95_s > c_warn_s THEN 'warning' END,
           'clear', p.p95_s <= c_clear_s AND p.oldest_pending_s <= c_clear_s)), '[]'::jsonb)
    INTO v_judged
    FROM per p;

  SELECT count(*) INTO v_lagging FROM jsonb_array_elements(v_judged) j WHERE j->>'severity' IS NOT NULL;

  -- Resolve: an open alert whose table has no hands now, or is back under the clear line.
  WITH done AS (
    UPDATE financial_alerts fa
       SET resolved = true, resolved_at = now(),
           resolution = 'post-commit p95 back under ' || c_clear_s || ' s on this table'
     WHERE fa.source = c_source AND NOT fa.resolved
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_judged) j
                        WHERE j->>'table_id' = fa.context->>'table_id' AND NOT (j->>'clear')::boolean)
    RETURNING 1)
  SELECT count(*) INTO v_resolved FROM done;

  FOR r IN
    SELECT j, (j->>'table_id')::uuid AS table_id, j->>'severity' AS severity,
           (SELECT fa.severity FROM financial_alerts fa
             WHERE fa.source = c_source AND NOT fa.resolved AND fa.context->>'table_id' = j->>'table_id'
             ORDER BY fa.created_at DESC LIMIT 1) AS open_severity
      FROM jsonb_array_elements(v_judged) j
     WHERE j->>'severity' IS NOT NULL
     ORDER BY (j->>'severity' = 'critical') DESC, (j->>'p95_s')::numeric DESC, j->>'table_id'
  LOOP
    CONTINUE WHEN r.open_severity = 'critical'
               OR (r.open_severity = 'warning' AND r.severity = 'warning');
    IF r.open_severity = 'warning' THEN
      UPDATE financial_alerts fa
         SET resolved = true, resolved_at = now(), resolution = 'escalated to critical'
       WHERE fa.source = c_source AND NOT fa.resolved AND fa.context->>'table_id' = r.table_id::text;
      v_escalated := v_escalated + 1;
    ELSE
      CONTINUE WHEN v_new >= c_max_new;
      v_new := v_new + 1;
    END IF;
    INSERT INTO financial_alerts (severity, source, message, context)
    SELECT r.severity, c_source,
           CASE r.severity
             WHEN 'critical' THEN 'Hands are waiting on their post-commit work: on this table the p95 from commit to post-commit completion over the last 5 minutes is above 15 s, or a hand has been pending longer than 15 s. The hand gap is far over the 2 s limit; find the lock the post-commit envelope is waiting on.'
             ELSE 'Post-commit work is slowing hands down: on this table the p95 from commit to post-commit completion over the last 5 minutes is above the 2 s hand-gap limit.'
           END,
           r.j || jsonb_build_object(
             'table_name', t.name, 'club_id', t.club_id, 'union_id', t.union_id,
             'window', '5 minutes', 'warn_p95_s', c_warn_s, 'critical_p95_s', c_crit_s,
             'lagging_tables', v_lagging)
      FROM (SELECT 1) one
      LEFT JOIN tables t ON t.id = r.table_id;
  END LOOP;

  RETURN jsonb_build_object('lagging_tables', v_lagging, 'opened', v_new, 'escalated', v_escalated,
                            'resolved', v_resolved, 'checked_at', now());
END
$function$
