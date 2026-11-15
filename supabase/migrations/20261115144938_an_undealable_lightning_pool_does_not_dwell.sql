-- KingFish hand 59473127 settled 2026-11-15 07:27:44Z. The pool fell to three,
-- below the four-player formation floor, but the automatic OFF dwell held it
-- until 07:29:17Z and reversion committed at 07:29:23Z. No hand could form.
-- Keep hysteresis at playable populations; an undealable population must use
-- the existing pending-off/drain/custody transition without its population dwell.
-- No new scheduler, seat repair, financial write or engine replacement.
-- @live-proof: (position('v_floor_until IS NOT NULL AND v_live >= 4' in pg_get_functiondef('public.fn_cash_cluster_lightning_drive(uuid)'::regprocedure)) > 0 AND position('live_eligible' in pg_get_functiondef('public.fn_cash_cluster_begin_pending_off(uuid,uuid,text)'::regprocedure)) > 0 AND position('::integer, 0) >= 4 THEN' in pg_get_functiondef('public.fn_cash_cluster_begin_pending_off(uuid,uuid,text)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $migration$
DECLARE s text; n text;
BEGIN
 s:=pg_get_functiondef('public.fn_cash_cluster_lightning_drive(uuid)'::regprocedure);
 n:=replace(s,
   'IF v_off_ok AND v_live_ok AND v_floor_until IS NOT NULL THEN',
   'IF v_off_ok AND v_live_ok AND v_floor_until IS NOT NULL AND v_live >= 4 THEN');
 IF n=s THEN RAISE EXCEPTION 'lightning drive dwell preimage changed'; END IF;
 EXECUTE n;
 s:=pg_get_functiondef('public.fn_cash_cluster_begin_pending_off(uuid,uuid,text)'::regprocedure);
 n:=replace(s,
   'IF v_why = ''population_at_or_below_off_threshold'' THEN',
   'IF v_why = ''population_at_or_below_off_threshold'' AND coalesce((v_state -> ''verdict'' ->> ''live_eligible'')::integer, 0) >= 4 THEN');
 IF n=s THEN RAISE EXCEPTION 'lightning OFF dwell preimage changed'; END IF;
 EXECUTE n;
END $migration$;
COMMIT;
