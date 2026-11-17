-- @live-proof: position('tournament finished; it will not deal again' in pg_get_functiondef('public.fn_ca_table_stall_watch_ingest(text,timestamp with time zone,bigint)'::regprocedure)) > 0
-- 20261117225349_finished_tournament_table_resolves_its_stall.sql
--
-- Version reserved by scripts/new-migration.mjs.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- fn_ca_table_stall_watch_ingest resolves a TableStoppedDealing episode only
-- after it records two new hands on the table. A table whose tournament has
-- finished never deals again, so its episode stays firing for ever and its
-- Reliability Controller incident can never clear. Read 2026-11-17 22:49Z:
-- all 61 firing ca-stall-watch episodes belong to COMPLETED tournaments (the
-- oldest from 2026-11-01); seven were escalated (Satellite Into Nightly 20K
-- 62e75dec, Satellite Into Union Mystery Bounty f058801e, Satellite Into 40
-- Chip Freezeout b4b67135, Midnight Free Buy 87552ec3). Each fired seconds
-- before its tournament ended (62e75dec: 22:15:06 vs ended 22:15:13), and the
-- engine stopped sampling the table within seconds of the finish (newest
-- last_seen 22:15:16), so nothing else would ever resolve it.
--
-- The ingest pass now resolves, before it samples, every firing episode whose
-- table's tournament is COMPLETED or CANCELLED (root_cause_verified false, the
-- same honesty as the dealing-resumed path), and removes those watch rows.
-- The 61 stranded episodes resolve on the first pass after install. No
-- schedule, sweep or watcher is added: this is the existing ingest's own
-- resolution step. Running tournaments and cash tables are unaffected.
--
-- Guarded single-anchor amendment, re-read after rewrite, idempotent.
-- Proved read-only on production in a rolled-back DO block: anchor found once,
-- rewrite landed.

BEGIN;

DO $migration$
DECLARE
  v_fn regprocedure := 'public.fn_ca_table_stall_watch_ingest(text,timestamp with time zone,bigint)'::regprocedure;
  v_anchor text := '  -- The latest completed maintenance break (20261107032642).';
  v_add text := E'  /* A TABLE WHOSE TOURNAMENT FINISHED RESOLVES ITS STALL (2026-11-17).\n     It will never deal again, so the dealing-resumed path above cannot\n     resolve it. */\n  UPDATE public.operational_alert_events e\n     SET status = ''resolved'', last_received_at = p_now,\n         payload = e.payload || jsonb_build_object(''resolved_at'', p_now, ''resolution'', ''the table''''s tournament finished; it will not deal again'', ''root_cause_verified'', false)\n    FROM smarter_private.ca_table_stall_watch w\n    JOIN public.tournaments t ON t.id = w.tournament_id\n   WHERE e.id = w.alert_id AND e.status = ''firing'' AND t.status IN (''COMPLETED'', ''CANCELLED'');\n  DELETE FROM smarter_private.ca_table_stall_watch w\n   USING public.tournaments t\n   WHERE t.id = w.tournament_id AND t.status IN (''COMPLETED'', ''CANCELLED'');\n';
  v_def text;
  v_n int;
BEGIN
  v_def := pg_get_functiondef(v_fn);
  IF position('tournament finished; it will not deal again' in v_def) > 0 THEN
    RAISE NOTICE 'already applied';
  ELSE
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'anchor found % times in fn_ca_table_stall_watch_ingest, expected 1', v_n;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_add || v_anchor);
    IF position('tournament finished; it will not deal again' in pg_get_functiondef(v_fn)) = 0 THEN
      RAISE EXCEPTION 'rewrite of fn_ca_table_stall_watch_ingest did not land';
    END IF;
  END IF;
END
$migration$;

COMMIT;
