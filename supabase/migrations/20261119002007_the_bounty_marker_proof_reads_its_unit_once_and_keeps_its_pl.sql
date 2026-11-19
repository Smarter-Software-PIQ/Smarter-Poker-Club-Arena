-- 20261119002007_the_bounty_marker_proof_reads_its_unit_once_and_keeps_its_pl.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE SWEEP GATE PROVES ITS FRESH MARKERS IN ONE QUERY (2026-11-18 lag incident, lane B5)
--
-- CLAUDE.md 10.9: what was wrong, what this changes, what was measured.
--
-- WHAT WAS WRONG
-- fn_tournament_has_pending_bounty_work (20261106034328) is the read the
-- engine makes before it records a bust in a bounty event
-- (TournamentManagerEliminations). Its third question calls
-- fn_bounty_obligation_has_complete_marker(o.id) once for every obligation
-- settled in the last ten minutes. One marker call is one or two indexed rows,
-- yet it cost 329 shared buffer hits and 5.9 ms, because the marker is a
-- SQL-language function with a SET clause: it cannot be inlined, so every call
-- plans its own query again (1.2 ms), and inside it every one of its call
-- sites of fn_ca_tournament_unit_cents and fn_ca_unit_floor_cents is initialised and planned again too. The index
-- uq_tourney_bounty_ko_generation IS used; the reads were never the cost.
--
-- Measured on production, read-only, 2026-11-18/19 UTC, PKO event eb0c2d80
-- (963 settled obligations), the 140 most recently settled obligations (the
-- size of the ten-minute window at its peak):
--   - the gate's third question as installed: 839.7 ms, 47,290 buffer hits;
--   - pg_stat_statements for the engine's call: 96,683 calls, 107.9 ms mean,
--     10,430 s total.
--
-- WHAT THIS CHANGES
-- Only fn_tournament_has_pending_bounty_work. The marker's own proof (its
-- reviewed CASE, taken from pg_proc at installation, never retyped here) is
-- compiled into the gate as ONE query scoped to the same rows: this event,
-- settled, in the last ten minutes. The event's money unit is read once per
-- obligation instead of at every reference. The gate becomes plpgsql so its
-- plan is kept by the session. Same three questions, same rows, same verdict.
--   - the same 140 obligations: 27.4 ms, 3,516 buffer hits (30 times less time).
--
-- fn_bounty_obligation_has_complete_marker is NOT touched:
-- fn_tournament_has_unsettled_bounties refuses to run when the marker's
-- source hash moves (scoped_bounty_marker_source_changed, 20261116231027),
-- so every finish depends on it staying byte for byte what it is.
--
-- A STALE COPY NEVER ANSWERS. The gate compares the marker's source hash with
-- the one it was compiled from on every call. If the marker has been replaced
-- since, the gate asks the marker function itself, exactly as it did before
-- this migration: slower, never wrong, never an error.
--
-- PROOF OF EQUAL RESULTS
--   - production, read-only: the compiled proof against the marker function,
--     obligation by obligation, for every obligation of the last three days
--     (9,558) and then for every obligation the table holds:
--     128,588 (61,239 PKO, 51,036 regular, 2,818 mystery; 30,864 at the
--     Diamond unit of 100).
--     Zero rows differ.
--   - production, read-only: the gate's third question, old against new, for
--     each of the 49 events that settled a bounty in the last three days
--     (9,598 obligations, window widened from ten minutes to three days):
--     zero differ.
--   - a private PostgreSQL 17 holding production's exact function definitions
--     and 2,256 exported obligations (PKO, regular, mystery, shared, Diamond):
--     this file installs, refuses a replay, and old and new gates agree on
--     2,362 events under each of: a KO amount a cent off, a PKO half a cent
--     off, a missing KO row, a collector who is not a claimant, an unpaid and
--     a mis-paid mystery recipient, an open award, a pending obligation, drift
--     older than ten minutes, and the marker replaced after installation.
--   - the installation below refuses unless the gate is the reviewed preimage
--     and the compiled text turns back into the marker's proof exactly.
--
-- @live-proof: position('Compiled fresh marker proof' in pg_get_functiondef('public.fn_tournament_has_pending_bounty_work(uuid)'::regprocedure))>0 AND NOT has_function_privilege('authenticated','public.fn_tournament_has_pending_bounty_work(uuid)','execute') AND has_function_privilege('service_role','public.fn_tournament_has_pending_bounty_work(uuid)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';

DO $compile$
DECLARE
  target regprocedure := 'public.fn_tournament_has_pending_bounty_work(uuid)'::regprocedure;
  marker regprocedure := 'public.fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure;
  -- md5(pg_get_functiondef) of the gate installed by 20261106034328.
  old_target constant text := '185a6e57113758aa5034698c9a05d003';
  marker_hash text;
  before_meta jsonb;
  after_meta jsonb;
  proof text;
  scoped text;
  replacement text;
  unit_call constant text := 'public.fn_ca_tournament_unit_cents(o.tournament_id)';
  row_scope constant text := E'FROM public.tournament_bounty_obligations o\n     WHERE o.id=p_obligation_id';
BEGIN
  IF md5(pg_get_functiondef(target)) IS DISTINCT FROM old_target THEN
    RAISE EXCEPTION 'pending_bounty_gate_preimage_changed' USING ERRCODE='55000';
  END IF;
  SELECT to_jsonb(p)-'prosrc'-'prolang' INTO before_meta FROM pg_proc p WHERE oid=target;
  IF before_meta->>'prosecdef' IS DISTINCT FROM 'true'
     OR pg_get_userbyid((before_meta->>'proowner')::oid) IS DISTINCT FROM 'postgres'
     OR before_meta->'proacl' IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb
     OR before_meta->'proconfig' IS DISTINCT FROM '["search_path=public, pg_temp"]'::jsonb
     OR before_meta->>'provolatile' IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'pending_bounty_gate_authority_changed' USING ERRCODE='55000';
  END IF;

  -- The marker's proof is read from the installed function, never retyped.
  marker_hash := md5(pg_get_functiondef(marker));
  SELECT prosrc INTO proof FROM pg_proc WHERE oid=marker;
  IF (length(proof)-length(replace(proof,'SELECT COALESCE((','')))/length('SELECT COALESCE((')<>1
     OR (length(proof)-length(replace(proof,row_scope,'')))/length(row_scope)<>1
     OR (length(proof)-length(replace(proof,'p_obligation_id','')))/length('p_obligation_id')<>1
     OR (length(proof)-length(replace(proof,unit_call,'')))/length(unit_call)<>3
     OR (length(proof)-length(replace(proof,'fn_ca_tournament_unit_cents','')))/length('fn_ca_tournament_unit_cents')<>4
     OR right(btrim(proof,E' \n\r\t'),length('),false);'))<>'),false);'
     OR strpos(proof,'$')>0
     OR strpos(proof,' tu.')>0 OR strpos(proof,'(tu.')>0 THEN
    RAISE EXCEPTION 'pending_bounty_gate_marker_shape_changed' USING ERRCODE='55000';
  END IF;
  proof := substr(proof,strpos(proof,'SELECT COALESCE((')+length('SELECT COALESCE(('));
  proof := left(btrim(proof,E' \n\r\t'),length(btrim(proof,E' \n\r\t'))-length('),false);'));
  -- The fourth mention of the unit function is the header comment, cut off above.
  IF strpos(proof,'--')>0
     OR (length(proof)-length(replace(proof,unit_call,'')))/length(unit_call)<>3 THEN
    RAISE EXCEPTION 'pending_bounty_gate_marker_shape_changed' USING ERRCODE='55000';
  END IF;

  -- The same proof for the gate's rows: this event, settled, last ten minutes;
  -- the money unit read once per obligation (OFFSET 0 keeps it one call).
  scoped := replace(proof, unit_call, 'tu.unit');
  scoped := replace(scoped, row_scope,
    E'FROM public.tournament_bounty_obligations o\n'
    || E'     CROSS JOIN LATERAL (\n'
    || E'       SELECT ' || unit_call || E' AS unit OFFSET 0\n'
    || E'     ) tu\n'
    || E'     WHERE o.tournament_id = p_tournament_id AND o.state = ''settled''\n'
    || E'       AND o.settled_at > clock_timestamp() - interval ''10 minutes''');
  IF strpos(scoped,'p_obligation_id')>0
     OR (length(scoped)-length(replace(scoped,'tu.unit','')))/length('tu.unit')<>3
     OR (length(scoped)-length(replace(scoped,unit_call,'')))/length(unit_call)<>1
     OR replace(replace(scoped,'tu.unit',unit_call),
                E'\n     CROSS JOIN LATERAL (\n       SELECT ' || unit_call || E' AS unit OFFSET 0\n     ) tu\n'
                || E'     WHERE o.tournament_id = p_tournament_id AND o.state = ''settled''\n'
                || E'       AND o.settled_at > clock_timestamp() - interval ''10 minutes''',
                E'\n     WHERE o.id=p_obligation_id') IS DISTINCT FROM proof THEN
    RAISE EXCEPTION 'pending_bounty_gate_compile_failed' USING ERRCODE='55000';
  END IF;

  replacement := $definition$CREATE OR REPLACE FUNCTION public.fn_tournament_has_pending_bounty_work(p_tournament_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Compiled fresh marker proof (lag incident 2026-11-18). The third question
  -- holds the proof of fn_bounty_obligation_has_complete_marker as one query.
  -- A stale copy never answers: when the marker's source is no longer the one
  -- this was compiled from, the marker function itself is asked instead.
  IF md5(pg_get_functiondef('public.fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure))
     IS DISTINCT FROM '$definition$ || marker_hash || $definition$' THEN
    RETURN (
      EXISTS (
        SELECT 1 FROM public.tournament_bounty_obligations o
         WHERE o.tournament_id = p_tournament_id AND o.state = 'pending'
      )
      OR EXISTS (
        SELECT 1 FROM public.tournament_bounty_awards a
         WHERE a.tournament_id = p_tournament_id
           AND a.status IN ('reserved', 'revealed', 'paid')
      )
      OR EXISTS (
        SELECT 1 FROM public.tournament_bounty_obligations o
         WHERE o.tournament_id = p_tournament_id AND o.state = 'settled'
           AND o.settled_at > clock_timestamp() - interval '10 minutes'
           AND NOT public.fn_bounty_obligation_has_complete_marker(o.id)
      )
    );
  END IF;
  RETURN (
    EXISTS (
      SELECT 1 FROM public.tournament_bounty_obligations o
       WHERE o.tournament_id = p_tournament_id AND o.state = 'pending'
    )
    OR EXISTS (
      SELECT 1 FROM public.tournament_bounty_awards a
       WHERE a.tournament_id = p_tournament_id
         AND a.status IN ('reserved', 'revealed', 'paid')
    )
    OR EXISTS (
      -- Fresh drift only: a settled cache whose marker is already incomplete.
      -- Older drift is refused at every finish by the full re-proof.
      SELECT 1 FROM ($definition$ || scoped || $definition$) complete(marker_complete)
       WHERE NOT COALESCE(marker_complete, false)
    )
  );
END;
$function$;$definition$;
  EXECUTE replacement;

  IF strpos(pg_get_functiondef(target), scoped)=0
     OR strpos(pg_get_functiondef(target), marker_hash)=0 THEN
    RAISE EXCEPTION 'pending_bounty_gate_postimage_changed' USING ERRCODE='55000';
  END IF;
  SELECT to_jsonb(p)-'prosrc'-'prolang' INTO after_meta FROM pg_proc p WHERE oid=target;
  IF after_meta IS DISTINCT FROM before_meta THEN
    RAISE EXCEPTION 'pending_bounty_gate_authority_moved' USING ERRCODE='55000';
  END IF;
  IF has_function_privilege('anon', target, 'execute')
     OR has_function_privilege('authenticated', target, 'execute')
     OR NOT has_function_privilege('service_role', target, 'execute') THEN
    RAISE EXCEPTION 'pending_bounty_gate_grants_moved' USING ERRCODE='55000';
  END IF;
END $compile$;

-- The grants are unchanged by CREATE OR REPLACE (checked above); they are
-- restated so the file says who may call a SECURITY DEFINER function.
REVOKE ALL ON FUNCTION public.fn_tournament_has_pending_bounty_work(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_has_pending_bounty_work(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_tournament_has_pending_bounty_work(uuid) IS
 'The elimination sweep gate (2026-11-06; one-query marker proof 2026-11-18): true while a bounty obligation is pending, a mystery award is open, or an obligation settled in the last ten minutes lacks its complete marker. The marker proof is compiled from fn_bounty_obligation_has_complete_marker at installation and checked against its source hash on every call; the full re-proof stays at every finish (fn_tournament_has_unsettled_bounties).';

COMMIT;
