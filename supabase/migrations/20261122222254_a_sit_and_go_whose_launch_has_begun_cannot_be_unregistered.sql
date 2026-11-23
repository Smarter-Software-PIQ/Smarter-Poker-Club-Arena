-- 20261122222254_a_sit_and_go_whose_launch_has_begun_cannot_be_unregistered.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A SIT AND GO WHOSE LAUNCH HAS BEGUN CANNOT BE UNREGISTERED
--
-- Owner rule (Dan, 2026-11-22): "PLAYERS NEED TO BE ABLE TO 'UNREGISTER' FROM
-- A SIT N GO, HEADS UP OR SPIN IF IT HASN'T STARTED YET." Two lanes built it
-- the same afternoon. 20261122185915 installed first: a six or nine seat Sit
-- and Go takes the authority 'sng_actual_start' and is judged by status,
-- started_at, a persisted hand and a COMPLETED launch receipt, never by the
-- fill-window clock. 20261122192807 (the other lane's) became verify-only.
--
-- THE GAP, READ FROM PRODUCTION
--
-- fn_begin_tournament_launch_before_lease_generation is the launch's first
-- step. It inserts the tournament_launch_receipts row, with the cohort it will
-- seat frozen in launch_player_ids, and leaves tournaments.status at
-- 'REGISTERING'. Seating and funding come after it, in later steps, and only
-- then is the receipt completed. Between the two, an 'sng_actual_start'
-- unregistration passes every check 20261122185915 makes, so a player in the
-- frozen cohort could be unregistered and refunded while the launch seats them.
--
-- THE RULE NOW
--
--   1. An 'sng_actual_start' unregistration is refused once ANY launch receipt
--      exists for the event: a launch that has begun owns its roster. Chip
--      core and Diamond door alike. The chip core proves it again after the
--      refund work and before the immutable receipt, or rolls everything back.
--      The receipt is written under the same tournaments row lock this
--      function holds, so a launch and an unregistration are serialised.
--   2. The launch's own release of a registrant it cannot seat
--      (app.ca_launch_release_launch_id, fn_ca_release_unseatable_registrant_at_launch)
--      keeps the 'launch_release' authority for a Sit and Go, as it already
--      does for a scheduled event, so rule 1 never refuses the launch itself.
--
-- Unchanged: the receipt reader and the receipt check (they already accept
-- 'sng_actual_start'), scheduled events, Spins, Heads-Up, the refund path.
-- Nothing here moves or prices money and nothing reads is_horse. Measured on
-- production before this file: 17 incomplete launch receipts, every one on a
-- CANCELLED scheduled event, so no live Sit and Go is closed by rule 1.
--
-- Proof: scripts/dev/prove-a-begun-sit-and-go-launch-closes-unregistration.sh
-- Law: tests/a-sit-and-go-whose-launch-has-begun-cannot-be-unregistered.law.test.ts
-- Changelog: docs/changelog/2026-11-22-a-sit-and-go-whose-launch-has-begun-cannot-be-unregistered.md
--
-- HOW. Anchored edits of the live definitions: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
-- @live-proof: (SELECT pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure) LIKE '%sit and go launch began before unregistration could commit%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure) LIKE '%v_authority IN (''scheduled_clock'',''sng_actual_start'')%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. The chip unregistration core.
DO $sit_and_go_core$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure);
  v_edit record;
BEGIN
  IF position($p$v_start_authority:='sng_actual_start'$p$ IN v_def)=0 THEN
    RAISE EXCEPTION 'fn_ca_unregister_tournament_player_exact has no sng_actual_start authority: 20261122185915 must be installed first';
  END IF;
  IF position('sit and go launch began before unregistration could commit' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_ca_unregister_tournament_player_exact already refuses a begun Sit and Go launch: re-read before editing';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('launch_release',
$o$  IF v_start_authority='scheduled_clock' AND EXISTS ($o$,
$r$  IF v_start_authority IN ('scheduled_clock','sng_actual_start') AND EXISTS ($r$),
    ('refusal',
$o$    IF v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  END IF;$o$,
$r$    IF v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  END IF;
  /* A SIT AND GO STARTS WHEN ITS LAUNCH BEGINS (20261122222254). The launch
     commits its receipt as its first step and seats and funds the field
     after it, so the launch owns the roster from that first write, not from
     its completion. That write is made under the tournaments row lock held
     above. */
  IF v_start_authority='sng_actual_start' AND EXISTS (
       SELECT 1 FROM public.tournament_launch_receipts r
        WHERE r.tournament_id=p_tournament_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;$r$),
    ('reproof',
$o$        'seat-first tournament started before unregistration could commit'
        USING ERRCODE='55000';
    END IF;
  END IF;$o$,
$r$        'seat-first tournament started before unregistration could commit'
        USING ERRCODE='55000';
    END IF;
  END IF;
  IF v_start_authority='sng_actual_start' AND EXISTS (
       SELECT 1 FROM public.tournament_launch_receipts r
        WHERE r.tournament_id=p_tournament_id) THEN
    RAISE EXCEPTION
      'sit and go launch began before unregistration could commit'
      USING ERRCODE='55000';
  END IF;$r$)
  ) AS e(label,old_text,new_text) LOOP
    IF (length(v_def)-length(replace(v_def,v_edit.old_text,'')))/length(v_edit.old_text)<>1 THEN
      RAISE EXCEPTION 'fn_ca_unregister_tournament_player_exact anchor % was expected exactly once',v_edit.label;
    END IF;
    v_def:=replace(v_def,v_edit.old_text,v_edit.new_text);
  END LOOP;
  EXECUTE v_def;
END
$sit_and_go_core$;

-- @probe-for: public.fn_ca_unregister_tournament_player_exact
DO $probe$
BEGIN
  PERFORM public.fn_ca_unregister_tournament_player_exact(
    gen_random_uuid(),gen_random_uuid(),NULL,NULL,NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- 2. The Diamond door keeps the chip authority's start rule, word for word.
DO $sit_and_go_diamond$
DECLARE
  v_def text := pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure);
  v_edit record;
BEGIN
  IF position($p$v_authority := 'sng_actual_start'$p$ IN v_def)=0 THEN
    RAISE EXCEPTION 'fn_poker_diamond_tournament_unregister has no sng_actual_start authority: 20261122185915 must be installed first';
  END IF;
  IF position($p$v_authority IN ('scheduled_clock','sng_actual_start')$p$ IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_poker_diamond_tournament_unregister already refuses a begun Sit and Go launch: re-read before editing';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('launch_release',
$o$  IF v_authority='scheduled_clock' AND EXISTS ($o$,
$r$  IF v_authority IN ('scheduled_clock','sng_actual_start') AND EXISTS ($r$),
    ('refusal',
$o$  ELSIF EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;$o$,
$r$  ELSIF EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;
  -- A Sit and Go starts when its launch begins (20261122222254, the chip
  -- authority's rule): any launch receipt closes it.
  IF v_authority='sng_actual_start' AND EXISTS (
       SELECT 1 FROM public.tournament_launch_receipts r
        WHERE r.tournament_id=p_tournament_id) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;$r$)
  ) AS e(label,old_text,new_text) LOOP
    IF (length(v_def)-length(replace(v_def,v_edit.old_text,'')))/length(v_edit.old_text)<>1 THEN
      RAISE EXCEPTION 'fn_poker_diamond_tournament_unregister anchor % was expected exactly once',v_edit.label;
    END IF;
    v_def:=replace(v_def,v_edit.old_text,v_edit.new_text);
  END LOOP;
  EXECUTE v_def;
END
$sit_and_go_diamond$;

-- @probe-for: public.fn_poker_diamond_tournament_unregister
DO $probe$
BEGIN
  PERFORM public.fn_poker_diamond_tournament_unregister(
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- 3. The file installed what it says, or nothing.
DO $verify_sit_and_go$
BEGIN
  IF position($p$IF v_start_authority IN ('scheduled_clock','sng_actual_start') AND EXISTS ($p$ IN pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure))=0
     OR position($p$IF v_start_authority='sng_actual_start' AND EXISTS ($p$ IN pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure))=0
     OR position('sit and go launch began before unregistration could commit' IN pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure))=0
     OR position($p$IF v_authority IN ('scheduled_clock','sng_actual_start') AND EXISTS ($p$ IN pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure))=0
     OR position($p$IF v_authority='sng_actual_start' AND EXISTS ($p$ IN pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'sit and go launch-begun unregistration refusal did not install exactly';
  END IF;
END
$verify_sit_and_go$;

COMMIT;
