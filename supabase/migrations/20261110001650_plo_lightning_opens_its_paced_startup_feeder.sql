-- 20261110001650_plo_lightning_opens_its_paced_startup_feeder.sql
-- Reserved through scripts/new-migration.mjs; protected installation only.
-- A live funded startup reached six but the shared two-buyer forecast kept
-- its only feeder closed. The general randomized table cap can also be one.
-- Scope the later ON10 requirement to this exact enabled 1/2 PLO game:
-- prepare its ordinary second-table capacity when the floor is full and six
-- through nine eligible participants include its paid human starter.
-- This opens no seat and invents no buyer. Existing financially eligible
-- candidate allocation, no-lone-seat guard, durable one-at-a-time admission,
-- six-minute empty abandonment, concurrency, maintenance and safe departures
-- retain their original owners. Other games keep their original OPEN rule.
-- No historical rows, financial state or engine process are changed here.
-- @live-proof: md5(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) = '55a0d08c68a0dd5afe3fedd4f1d58e12'
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $patch$
DECLARE
  s text := pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure);
  n text;
  before_meta jsonb;
BEGIN
  IF md5(s) = '55a0d08c68a0dd5afe3fedd4f1d58e12' THEN RETURN; END IF;
  IF md5(s) <> 'fff26b7cf7312d582e26a0d5c6f6b73a' THEN
    RAISE EXCEPTION 'PLO startup feeder predecessor changed';
  END IF;
  SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,
    'definer',prosecdef,'volatility',provolatile,'parallel',proparallel)
    INTO before_meta FROM pg_proc
   WHERE oid='public.fn_cash_cluster_tick(uuid,integer)'::regprocedure;
  n := s;
  n := replace(n, $old0$  v_table_cap integer;$old0$, $new0$  v_table_cap integer;
  v_plo_lifecycle boolean := false;
  v_plo_startup boolean := false;$new0$);
  n := replace(n, $old1$  -- (a CASE ... THEN inside an IF condition ends the condition early in$old1$, $new1$  -- The assigned ON10 startup needs a destination beyond its six-seat Main.
  -- Forecast allocation never substitutes for actual funded participant state.
  v_plo_lifecycle := g.id = 'c79d8ec2-2281-411d-b4e1-42b5610849e2'::uuid
    AND g.enabled AND g.lightning_enabled AND g.variant = 'plo4'
    AND g.sb = 1 AND g.bb = 2 AND g.handedness = 6
    AND g.ruleset_snapshot#>>'{lightning,on_threshold}' = '10'
    AND g.ruleset_snapshot#>>'{lightning,always_on}' = 'false';
  IF v_plo_lifecycle THEN
    v_plo_startup := public.fn_cash_cluster_live_eligible(g.id) BETWEEN 6 AND 9
      AND EXISTS (
        SELECT 1 FROM public.table_seats s
        JOIN public.tables tb ON tb.id = s.table_id
        JOIN public.profiles p ON p.id = s.user_id
        WHERE tb.cluster_id = g.id AND coalesce(tb.is_deleted, false) = false
          AND coalesce(tb.lifecycle, '') <> 'closed' AND s.left_at IS NULL
          AND s.stack > 0 AND coalesce(s.is_sitting_out, false) = false
          AND coalesce(s.leave_pending, false) = false AND p.is_horse IS NOT TRUE
      );
  END IF;
  -- (a CASE ... THEN inside an IF condition ends the condition early in$new1$);
  n := replace(n, $old2$    v_table_cap := 2;
  END IF;

  IF g.enabled AND v_open_unreserved$old2$, $new2$    v_table_cap := 2;
  END IF;
  IF v_plo_lifecycle THEN v_table_cap := greatest(v_table_cap, 2); END IF;

  IF g.enabled AND v_open_unreserved$new2$);
  n := replace(n, $old3$    ELSIF v_buyers >= 2 THEN$old3$, $new3$    ELSIF v_buyers >= 2 OR v_plo_startup THEN$new3$);
  IF md5(n) <> '55a0d08c68a0dd5afe3fedd4f1d58e12' THEN RAISE EXCEPTION 'PLO startup feeder patch differs'; END IF;
  EXECUTE n;
  IF md5(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) <> '55a0d08c68a0dd5afe3fedd4f1d58e12'
    OR before_meta IS DISTINCT FROM (
      SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,
        'definer',prosecdef,'volatility',provolatile,'parallel',proparallel)
      FROM pg_proc WHERE oid='public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)
  THEN RAISE EXCEPTION 'PLO startup feeder metadata or definition differs'; END IF;
END $patch$;
COMMIT;
