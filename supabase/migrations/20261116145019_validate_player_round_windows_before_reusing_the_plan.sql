-- A previously closed window may precede fee recognition or later certificates.
-- If the cached inputs already disagree, use the original set-based proof of
-- the current earning sources. All existing amount, payer, wallet and ledger
-- checks still run. The installer does not prepare, book or pay any period.
-- @live-proof: position('stale_rakeback_window' in pg_get_functiondef('public.fn_settle_accounting_rakeback_plan_get(text,uuid,timestamptz,timestamptz,uuid[],uuid,uuid,boolean)'::regprocedure))>0 AND position('late_cash_windows' in pg_get_functiondef('public.fn_settle_accounting_rakeback_pairs(text,uuid,timestamptz,timestamptz)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
  target constant regprocedure := 'public.fn_settle_accounting_rakeback_plan_get(text,uuid,timestamptz,timestamptz,uuid[],uuid,uuid,boolean)'::regprocedure;
  original text := pg_get_functiondef(target);
  anchor constant text := 'FROM p WHERE EXISTS(SELECT 1 FROM q)';
BEGIN
  IF md5(original)<>'f4c135f1c425de4f5d257dd7c59eaa38' OR position(anchor in original)=0 THEN
    RAISE EXCEPTION 'round_three_cached_plan_reader_changed';
  END IF;
  EXECUTE replace(original,anchor,anchor||$guard$
   -- stale_rakeback_window: a plan containing a known failed proof is unusable.
   -- Returning NULL selects the original full-week source validation, before
   -- period discovery. It also avoids trusting stale payer or player counts.
   AND NOT EXISTS (
     SELECT FROM jsonb_array_elements(p.value->'alloc') a
     LEFT JOIN q ON q.club_id=(a->>2)::uuid AND q.player_id=(a->>3)::uuid
     WHERE coalesce((a->>8)::boolean,true)
       OR (a->>4)::bigint IS DISTINCT FROM (a->>5)::bigint
       OR (a->>4)::bigint IS DISTINCT FROM q.n
       OR q.d1 IS DISTINCT FROM (a->>9)::numeric
       OR q.d2 IS DISTINCT FROM (a->>10)::numeric
   )$guard$);
END
$migration$;

-- The final certificates can include cash posted after a source window closed.
-- Reuse every current window and re-read only an affected two-hour interval.
-- Its counts and both fingerprints must still agree with the certified plan.
DO $migration$
DECLARE
  original text := pg_get_functiondef('public.fn_settle_accounting_rakeback_pairs(text,uuid,timestamptz,timestamptz)'::regprocedure);
  patched text;
BEGIN
  IF md5(original)<>'03d452df060e96f9a5a2a46d36ad1c5c' THEN
    RAISE EXCEPTION 'round_three_source_window_reader_changed';
  END IF;
  patched := replace(original,'WITH w AS (SELECT p.value','WITH cached AS MATERIALIZED (SELECT p.window_start,p.window_end,p.computed_at,p.value');
  patched := replace(patched,' ok AS (SELECT',$windows$
 clubs AS MATERIALIZED (
   SELECT jsonb_array_elements_text(p.value->'club_ids')::uuid AS id
   FROM public.accounting_close_partials p
   WHERE p.kind='round3_'||p_scope_kind||'_plan' AND p.union_id=p_scope_id
     AND p.period_start=p_period_start AND p.period_end=p_period_end
     AND p.window_start=p_period_start AND p.window_end=p_period_end
 ), late_cash_windows AS MATERIALIZED (
   SELECT DISTINCT c.window_start FROM clubs
   CROSS JOIN LATERAL (
     SELECT s.earned_at,s.recorded_at FROM public.accounting_cash_rake_sources s
     WHERE s.club_id=clubs.id AND s.recorded_at >= (SELECT min(computed_at) FROM cached)
       AND s.earned_at>=p_period_start AND s.earned_at<p_period_end
       AND ((p_scope_kind='union' AND s.coordinator_union_id=p_scope_id)
         OR (p_scope_kind='club' AND s.coordinator_union_id IS NULL AND s.club_id=p_scope_id))
     OFFSET 0
   ) s JOIN cached c ON s.earned_at>=c.window_start AND s.earned_at<c.window_end AND s.recorded_at>=c.computed_at
 ), w AS MATERIALIZED (
   SELECT CASE WHEN l.window_start IS NULL THEN c.value
     ELSE public.fn_settle_accounting_rakeback_window(
       CASE WHEN p_scope_kind='union' THEN p_scope_id END,
       CASE WHEN p_scope_kind='club' THEN p_scope_id END,c.window_start,c.window_end)
     END AS value
   FROM cached c LEFT JOIN late_cash_windows l USING(window_start)
 ), ok AS (SELECT$windows$);
  EXECUTE patched;
END
$migration$;
COMMIT;
