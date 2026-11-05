-- 20261105210545_owner_closes_the_midnight_free_buy_outside_quiet_hours
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 21:05:45 UTC.
--
-- @live-proof: position('OWNER CLOSES THE MIDNIGHT FREE BUY OUTSIDE QUIET HOURS' in pg_get_functiondef('smarter_private.bulk_closure_admission(text,uuid[])'::regprocedure)) > 0
--
-- OWNER CLOSES THE MIDNIGHT FREE BUY OUTSIDE QUIET HOURS (Dan, 2026-11-05
-- 15:04 America/Chicago, verbatim: "OVERRIDE THE 4 AM RULE FOR THE MIDNIGHT
-- FREE BUY AND RETIRE DIAMOND ARENA NOW")
--
-- Diamond Arena's last unfinished event, Midnight Free Buy (NLH)
-- 6429087f-a9d1-49a3-b7cf-85e1ee283ac9 (started 2026-10-29 05:30 UTC, last
-- hand 2026-10-29 10:23 UTC), is owner-recorded for retirement
-- (owner_tournament_deletion_intents, owner chat
-- 01a19ccc-894e-75e2-a9e7-fe0d2df6c326, destination 47965354) and already
-- quiesced. It carries 170 entrant rows, so bulk_closure_admission refuses
-- fn_ca_owner_retire_tournament with large_outside_quiet_hours until 04:00
-- Chicago. The owner was told the risk (a brief stall for live tables while
-- the closure holds the cancellation lane) and directed it now.
--
-- WHAT THIS CHANGES
--
-- Exactly one refusal reason, large_outside_quiet_hours, is waived for exactly
-- one call shape: kind 'owner_retire' for that one event id, until
-- 2026-11-06 10:00 UTC (04:00 Chicago, when the ordinary window opens). The
-- break window, maintenance, resume-settling and the 8 s statement ceiling
-- still refuse it; every other event and every other kind is unchanged. The
-- admission row is still written. The waiver expires by itself; no code needs
-- to remove it.
--
-- No money moves in this migration.

BEGIN;

SET LOCAL lock_timeout = '1s';

DO $migration$
DECLARE
  v_marker constant text := 'OWNER CLOSES THE MIDNIGHT FREE BUY OUTSIDE QUIET HOURS';
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
    || E' /* OWNER CLOSES THE MIDNIGHT FREE BUY OUTSIDE QUIET HOURS (Dan, 2026-11-05):\n'
    || E'    one owner-directed retirement of one event, until 04:00 Chicago 2026-11-06. */\n'
    || E' IF v_refusal = ''large_outside_quiet_hours'' AND p_kind = ''owner_retire''\n'
    || E'    AND p_tournament_ids = ARRAY[''6429087f-a9d1-49a3-b7cf-85e1ee283ac9''::uuid]\n'
    || E'    AND v_at < ''2026-11-06 10:00:00+00''::timestamptz THEN\n'
    || E'   v_refusal := NULL;\n'
    || E' END IF;\n');
END
$migration$;

COMMIT;
