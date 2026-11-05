-- 20261105220946_owner_closes_the_midnight_free_buy_after_the_hold_bound_rewrite
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 22:09:46 UTC.
--
-- @live-proof: position('OWNER CLOSES THE MIDNIGHT FREE BUY AFTER THE HOLD BOUND' in pg_get_functiondef('smarter_private.bulk_closure_admission(text,uuid[])'::regprocedure)) > 0
--
-- OWNER CLOSES THE MIDNIGHT FREE BUY AFTER THE HOLD BOUND (Dan, 2026-11-05
-- 15:04 America/Chicago, verbatim: "OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT
-- FREE BUY AND RETIRE DIAMOND ARENA NOW")
--
-- WHAT WENT WRONG
--
-- 20261105210545 installed the owner's one-event waiver into
-- smarter_private.bulk_closure_admission at 22:04 UTC. Seconds later
-- 20261105200238 (another session's, merged earlier) was applied and replaced
-- that function with CREATE OR REPLACE, which removed the waiver. Measured at
-- 22:08:34 UTC: schema_migrations holds 20261105210545, the function body no
-- longer carries its marker, and a rolled-back probe of
-- fn_ca_owner_retire_tournament still raised
-- bulk_closure_large_outside_quiet_hours. Dispatching 20261105210545 again
-- would answer ALREADY-APPLIED, so the waiver needs this new version.
--
-- WHAT THIS CHANGES
--
-- Same single event (Midnight Free Buy (NLH)
-- 6429087f-a9d1-49a3-b7cf-85e1ee283ac9), same kind ('owner_retire'), same
-- expiry (2026-11-06 10:00 UTC = 04:00 Chicago) as 20261105210545.
--
-- STATUS: DRAFT, AWAITING THE OWNER. Do not merge or install until Dan sends
-- "APPROVE A 6 SECOND PAUSE TO CLOSE THE MIDNIGHT FREE BUY NOW". If he
-- chooses the 04:00 Chicago quiet window instead, this file is not needed
-- (the size rule and the 2 s rule do not apply in that window) and the
-- branch is closed unmerged.
--
-- WHY 2 s IS NOT ENOUGH FOR THIS EVENT (measured 2026-11-05 ~22:15 UTC,
-- read-only, rolled back): fn_ca_owner_retire_tournament md5s the event's
-- hand_history twice (before_history / after_history) inside the lane. This
-- event has 1,744 hands (10 MB); one hash took 2,096 ms and 2,072 ms on two
-- consecutive runs. The closure therefore needs about 4.3 s and is always
-- cancelled under the 2 s live ceiling.
--
-- WHAT THIS CHANGES (only if approved)
--
-- bulk_closure_refusal returns large_outside_quiet_hours BEFORE it checks
-- unbounded_caller, hold_exceeds_live_bound and cooldown, so clearing it
-- outright would skip those. Instead, when the waiver applies:
--   1. the refusal is recomputed with the entrant count capped at the
--      50-entrant threshold, so break window, maintenance, resume settling,
--      unbounded caller and cooldown all still apply;
--   2. if the only remaining refusal is hold_exceeds_live_bound and the
--      caller's ceiling is between 1 and 6000 ms, it is recomputed once more
--      as if the ceiling were 2000 ms, so cooldown is still checked.
-- The closure then holds the hand barrier for at most 6 s. A waiting hand's
-- own ceiling is 8 s, so it commits late and never fails; if the closure
-- overruns 6 s Postgres cancels it, it rolls back atomically, and nothing is
-- written. Every other event keeps the 2 s rule.
--
-- The anchor appears exactly once in the live function (checked read-only at
-- 22:08 UTC); the migration refuses to patch otherwise. No money moves here.

BEGIN;

SET LOCAL lock_timeout = '1s';

DO $migration$
DECLARE
  v_marker constant text := 'OWNER CLOSES THE MIDNIGHT FREE BUY AFTER THE HOLD BOUND';
  v_anchor constant text :=
    E' v_refusal := smarter_private.bulk_closure_refusal(p_kind, v_entrants, v_at, v_timeout);\n';
  v_def text;
BEGIN
  v_def := pg_get_functiondef('smarter_private.bulk_closure_admission(text,uuid[])'::regprocedure);
  IF position(v_marker IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'bulk_closure_admission anchor not found exactly once; refusing to patch';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_anchor
    || E' /* OWNER CLOSES THE MIDNIGHT FREE BUY AFTER THE HOLD BOUND (Dan, 2026-11-05):\n'
    || E'    one owner-directed retirement of one event, until 04:00 Chicago 2026-11-06.\n'
    || E'    Size waived; live hold up to 6 s; every other rule re-checked. */\n'
    || E' IF v_refusal = ''large_outside_quiet_hours'' AND p_kind = ''owner_retire''\n'
    || E'    AND p_tournament_ids = ARRAY[''6429087f-a9d1-49a3-b7cf-85e1ee283ac9''::uuid]\n'
    || E'    AND v_at < ''2026-11-06 10:00:00+00''::timestamptz THEN\n'
    || E'   v_refusal := smarter_private.bulk_closure_refusal(p_kind, LEAST(v_entrants, 50), v_at, v_timeout);\n'
    || E'   IF v_refusal = ''hold_exceeds_live_bound'' AND v_timeout > 0 AND v_timeout <= 6000 THEN\n'
    || E'     v_refusal := smarter_private.bulk_closure_refusal(p_kind, LEAST(v_entrants, 50), v_at, 2000);\n'
    || E'   END IF;\n'
    || E' END IF;\n');
  IF has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'BULK_CLOSURE_PRIVATE_EXPOSED';
  END IF;
END
$migration$;

COMMIT;
