-- 20261105222134_an_operator_closure_hold_survives_an_engine_restart.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- AN OPERATOR CLOSURE HOLD SURVIVES AN ENGINE RESTART (2026-11-05)
--
-- PR #9536 taught the engine the "closure hold": when an operator's
-- equal-share closure meets a playing manager that cannot present its
-- original graph (original_graph_not_ready, physical_writer_not_drained,
-- original_table_coverage_incomplete), the engine retires that playing
-- generation and adopts its successor as a hold that builds no dealer and
-- closes the event from database-certified absence. The hold was armed in a
-- process-local Map only. After the daily 04:00 Chicago restart the Map is
-- empty, so the first closure request after boot resumed a PLAYING copy,
-- which had to fail again with one of those reasons before the hold was
-- re-armed: every restart cost an extra playing generation and retire cycle
-- per held event, inside the one window (04:00-06:00 Chicago,
-- smarter_private.bulk_closure_admission) these closures are allowed to run.
--
-- This migration records the hold on the event's existing abort target row
-- so the next adoption, in any process, reads it back:
--
--   * smarter_private.tournament_abort_targets gains three nullable columns:
--     closure_hold_operation_id uuid, closure_hold_at timestamptz,
--     closure_hold_reason text. A hold is only meaningful while the target is
--     stop_requested or quiesced and names the same operation; the reader
--     below applies both rules, so a settled or withdrawn target never
--     presents a hold even if the columns are still set.
--   * public.fn_ca_record_tournament_closure_hold(p_operation_id,
--     p_tournament_id, p_reason, p_generation) sets the hold on the target
--     row only when its operation_id matches and its state is stop_requested
--     or quiesced; otherwise it answers ok=false with a reason and writes
--     nothing. service_role only. p_generation is the retired playing lease
--     generation, kept in the reason record for the operator's audit.
--   * public.fn_ca_clear_tournament_closure_hold(p_operation_id,
--     p_tournament_id) clears the hold for that operation. service_role only.
--     The engine calls it on the same paths that drop its in-memory hold.
--   * public.fn_ca_read_tournament_closure_hold(p_tournament_id) is the
--     adoption-time read, keyed by tournament alone because a freshly booted
--     engine does not yet know the operation. Read-only, service_role only.
--   * public.fn_ca_tournament_abort_stop_state gains a 'closure_hold' key:
--     null, or {operation_id, at, reason} while the target is stop_requested
--     or quiesced and the hold names the target's own operation. Patched by
--     exact-text replacement of its installed definition inside a DO block
--     that refuses unless the anchor matches exactly once, so the rest of the
--     function (money hash, boundary validity, the table roster) is
--     untouched.
--
-- No wallet, chip, player, seat, hand or tournament row is changed by this
-- migration or by either new function. tournament_abort_targets is a small
-- private table with no live-play writer holding it (its rows are written
-- only by the operator closure doors), so this file does not need the daily
-- maintenance window; it takes its lock once with a 1 s lock_timeout and
-- rolls back if refused.
--
-- @live-proof: (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='smarter_private' AND table_name='tournament_abort_targets' AND column_name IN ('closure_hold_operation_id','closure_hold_at','closure_hold_reason')) AND position('''closure_hold'',CASE WHEN a.state IN(''stop_requested'',''quiesced'')' IN pg_get_functiondef('public.fn_ca_tournament_abort_stop_state(uuid,uuid)'::regprocedure))>0 AND has_function_privilege('service_role','public.fn_ca_record_tournament_closure_hold(uuid,uuid,text,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_record_tournament_closure_hold(uuid,uuid,text,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_record_tournament_closure_hold(uuid,uuid,text,uuid)','EXECUTE') AND has_function_privilege('service_role','public.fn_ca_read_tournament_closure_hold(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_read_tournament_closure_hold(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_read_tournament_closure_hold(uuid)','EXECUTE') AND has_function_privilege('service_role','public.fn_ca_clear_tournament_closure_hold(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_clear_tournament_closure_hold(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_clear_tournament_closure_hold(uuid,uuid)','EXECUTE')
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;

SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

ALTER TABLE smarter_private.tournament_abort_targets
 ADD COLUMN IF NOT EXISTS closure_hold_operation_id uuid,
 ADD COLUMN IF NOT EXISTS closure_hold_at timestamptz,
 ADD COLUMN IF NOT EXISTS closure_hold_reason text;

-- The engine's record of a closure hold. Refuses, writing nothing, unless the
-- target row belongs to this operation and is still open (stop_requested or
-- quiesced). Re-recording the same operation's hold is idempotent: the
-- timestamp and reason follow the latest handoff, the operation never changes.
CREATE FUNCTION public.fn_ca_record_tournament_closure_hold(p_operation_id uuid,p_tournament_id uuid,p_reason text,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE a smarter_private.tournament_abort_targets;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF p_operation_id IS NULL OR p_tournament_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'reason','closure_hold_identity_missing');END IF;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','closure_hold_target_missing');END IF;
 IF a.operation_id IS DISTINCT FROM p_operation_id THEN
  RETURN jsonb_build_object('ok',false,'reason','closure_hold_operation_mismatch','target_operation_id',a.operation_id);END IF;
 IF a.state NOT IN ('stop_requested','quiesced') THEN
  RETURN jsonb_build_object('ok',false,'reason','closure_hold_target_not_open','state',a.state);END IF;
 IF EXISTS(SELECT 1 FROM smarter_private.tournament_abort_recoveries r WHERE r.tournament_id=p_tournament_id AND r.operation_id=p_operation_id) THEN
  RETURN jsonb_build_object('ok',false,'reason','closure_hold_target_withdrawn');END IF;
 UPDATE smarter_private.tournament_abort_targets
 SET closure_hold_operation_id=p_operation_id,
     closure_hold_at=clock_timestamp(),
     closure_hold_reason=left(coalesce(nullif(btrim(p_reason),''),'unspecified'),200)
      ||CASE WHEN p_generation IS NULL THEN '' ELSE ' retired_generation='||p_generation::text END
 WHERE tournament_id=p_tournament_id;
 RETURN jsonb_build_object('ok',true,'operation_id',p_operation_id,'tournament_id',p_tournament_id,'state',a.state);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_record_tournament_closure_hold(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_record_tournament_closure_hold(uuid,uuid,text,uuid) TO service_role;

-- The engine's release of a closure hold, on the same paths that drop its
-- in-memory hold (closure settled, closure withdrawn). Clears only a hold
-- that names this operation; a hold recorded for another operation is not
-- this caller's to clear. Answers ok=true with cleared=false when there was
-- nothing to clear, so a repeated call is harmless.
CREATE FUNCTION public.fn_ca_clear_tournament_closure_hold(p_operation_id uuid,p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE n integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF p_operation_id IS NULL OR p_tournament_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'reason','closure_hold_identity_missing');END IF;
 UPDATE smarter_private.tournament_abort_targets
 SET closure_hold_operation_id=NULL,closure_hold_at=NULL,closure_hold_reason=NULL
 WHERE tournament_id=p_tournament_id AND closure_hold_operation_id=p_operation_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'cleared',n>0,'operation_id',p_operation_id,'tournament_id',p_tournament_id);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_clear_tournament_closure_hold(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_clear_tournament_closure_hold(uuid,uuid) TO service_role;

-- The adoption-time read. A freshly booted engine knows the tournament it is
-- adopting and nothing else, so this is keyed by tournament alone and answers
-- the open hold, if any, with the operation it belongs to. Read-only. The
-- same two rules as the stop-state key: the target must be stop_requested or
-- quiesced, not withdrawn into recovery, and the hold must name the target's
-- own operation; otherwise closure_hold is null.
CREATE FUNCTION public.fn_ca_read_tournament_closure_hold(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,smarter_private AS $fn$
DECLARE a smarter_private.tournament_abort_targets;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;
 IF p_tournament_id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','closure_hold_identity_missing');END IF;
 SELECT * INTO a FROM smarter_private.tournament_abort_targets WHERE tournament_id=p_tournament_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'tournament_id',p_tournament_id,'state',NULL,'closure_hold',NULL);END IF;
 RETURN jsonb_build_object('ok',true,'tournament_id',p_tournament_id,'operation_id',a.operation_id,'state',a.state,
  'closure_hold',CASE WHEN a.state IN('stop_requested','quiesced') AND a.closure_hold_operation_id IS NOT NULL AND a.closure_hold_operation_id=a.operation_id
   AND NOT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_recoveries r WHERE r.tournament_id=a.tournament_id AND r.operation_id=a.operation_id)
   THEN jsonb_build_object('operation_id',a.closure_hold_operation_id,'at',a.closure_hold_at,'reason',a.closure_hold_reason) ELSE NULL END);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_read_tournament_closure_hold(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_read_tournament_closure_hold(uuid) TO service_role;

-- fn_ca_tournament_abort_stop_state learns the hold. Exact-text patch of the
-- installed definition: the anchor is the 'receipt' key of its result, which
-- appears exactly once; anything else refuses and rolls the file back.
DO $migration$
DECLARE
 definition text;
 anchor constant text := '''receipt'',a.receipt,''tournament_status''';
 patched constant text := '''closure_hold'',CASE WHEN a.state IN(''stop_requested'',''quiesced'') AND a.closure_hold_operation_id IS NOT NULL AND a.closure_hold_operation_id=a.operation_id THEN jsonb_build_object(''operation_id'',a.closure_hold_operation_id,''at'',a.closure_hold_at,''reason'',a.closure_hold_reason) ELSE NULL END,''receipt'',a.receipt,''tournament_status''';
BEGIN
 definition:=pg_get_functiondef('public.fn_ca_tournament_abort_stop_state(uuid,uuid)'::regprocedure);
 IF position(patched IN definition)>0 THEN RETURN;END IF; -- already applied
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
  RAISE EXCEPTION 'fn_ca_tournament_abort_stop_state: expected exactly one receipt anchor to extend with closure_hold';
 END IF;
 EXECUTE replace(definition,anchor,patched);
 definition:=pg_get_functiondef('public.fn_ca_tournament_abort_stop_state(uuid,uuid)'::regprocedure);
 IF position(patched IN definition)=0 THEN RAISE EXCEPTION 'fn_ca_tournament_abort_stop_state: closure_hold patch did not install';END IF;
END $migration$;

COMMIT;
