-- 20261122192807_a_sit_and_go_is_unregistered_until_it_actually_starts.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A SIT AND GO IS UNREGISTERED UNTIL IT ACTUALLY STARTS
--
-- Owner report (Dan, 2026-11-22): "PLAYERS NEED TO BE ABLE TO 'UNREGISTER' FROM
-- A SIT N GO, HEADS UP OR SPIN IF IT HASN'T STARTED YET." His phone showed
-- "Satellite Into Nightly 20K", REGISTERING, Starts When Full, 1 registered of
-- 9, buy-in 10 (9 + 1), and the toast "Unregister Failed: This Tournament Has
-- Started. You Can Only Unregister Before It Starts."
--
-- THE CAUSE, BY LINE
--
-- public.fn_ca_unregister_tournament_player_exact (latest body: migration
-- 20261102154336) chooses what "started" means from the recorded format:
--
--     IF v_t.format_contract='spin-v1' THEN
--       v_start_authority:='spin_actual_start';
--     ELSIF v_t.format_contract='sng-v1'
--        AND COALESCE(v_t.max_players,0)=2 THEN
--       v_start_authority:='heads_up_sng_actual_start';
--     END IF;
--
-- Every other event keeps the default 'scheduled_clock' and is refused by
--
--     IF clock_timestamp()>=v_t.start_time THEN
--       RETURN jsonb_build_object('ok',false,'reason','tournament_started');
--
-- That was written on 2026-09-09 (20260909183657), when every live Sit and Go
-- was heads-up. On 2026-10-28 fn_ensure_fixed_sng_satellite (20261028163610)
-- began creating six and nine seat Sit and Go satellites with format 'sng-v1'
-- and start_time = clock_timestamp() + interval '2 minutes'. For them
-- start_time opens the fill window; the engine starts the event only when the
-- last seat is paid (min_players = max_players). So two minutes after such a
-- board opens, and for as long as it waits for its field, the clock branch
-- answered 'tournament_started' for an event that had not begun. The Diamond
-- door (fn_poker_diamond_tournament_unregister, 20260930235000) carries the
-- same branch.
--
-- THE RULE NOW
--
-- A Sit and Go of any size (format 'sng-v1') starts when its launch begins,
-- never when a clock passes. Heads-Up keeps 'heads_up_sng_actual_start'
-- exactly as it was. Every other 'sng-v1' Sit and Go takes the authority
-- 'sng_actual_start' (the name 20261122185915 installed; see REPAIRED IN PLACE
-- below): unregistration is refused once the event status
-- has left ANNOUNCED / REGISTERING, started_at is set, a hand is persisted, or
-- ANY launch receipt exists. The launch receipt is the launch's first write
-- and it is inserted under the same tournaments row lock this function holds,
-- so an unregistration and a launch are serialised: the player is either
-- unregistered and refunded before the launch claims the event, or refused
-- with 'tournament_started' after it. Never both. A release performed by the
-- launch itself (app.ca_launch_release_launch_id) keeps its 'launch_release'
-- authority, as before.
--
-- Scheduled events (mtt-v1, mtt-v2) and the seat-first satellite, whose start
-- is advertised, keep the scheduled clock unchanged. Spins keep
-- 'spin_actual_start' unchanged.
--
-- MONEY. Nothing here moves or prices anything. The refund still leaves
-- through the one exact path the function already owns
-- (fn_settle_tournament_refund_exact, the refund entitlements, the fee
-- reversal, the immutable unregistration receipt). Nothing reads is_horse.
--
-- REPAIRED IN PLACE (2026-11-22, before it ever installed). Another lane's
-- 20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id, merged
-- the same afternoon and installed first at 22:10 UTC, replaced
-- fn_ca_unregister_tournament_player_exact, fn_ca_tournament_unregistration_receipt
-- and fn_poker_diamond_tournament_unregister wholesale with this same owner
-- rule under the authority name 'sng_actual_start', and widened the receipt
-- check for it. This file's anchors were written against the bodies before
-- that, so the applier refused it ("anchor authority was expected exactly
-- once"), and because migrations install oldest first, every migration merged
-- after it was held back with it.
--
-- One part of this file is not in 20261122185915, and it is the part that
-- keeps chips safe: 20261122185915 refuses an unregistration only once the
-- launch receipt is COMPLETED. A six or nine seat Sit and Go launch is not one
-- transaction: fn_begin_tournament_launch_before_lease_generation commits the
-- receipt as its first step and seats and funds the field after it. Between
-- those steps a player could be unregistered and refunded while the launch
-- is seating them. So this file now adds exactly that, on the installed
-- bodies and under the installed name:
--
--   1. an 'sng_actual_start' unregistration is refused once ANY launch
--      receipt exists for the event (chip core and Diamond door), and the
--      chip core proves it again after the refund work, before the receipt,
--      or rolls everything back;
--   2. the launch's own release of a registrant it cannot seat keeps the
--      'launch_release' authority for a Sit and Go, as it already does for a
--      scheduled event, so rule 1 never refuses the launch itself.
--
-- The receipt reader and the receipt check already accept 'sng_actual_start'
-- (20261122185915) and are not changed. Measured on production before this
-- repair: 17 incomplete launch receipts exist and every one belongs to a
-- CANCELLED scheduled event, so no live Sit and Go is closed by rule 1.
--
-- HOW. Anchored edits of the live definitions: each needle must occur exactly
-- once or the whole file aborts and nothing changes.
--
-- Changelog: docs/changelog/2026-11-22-a-sit-and-go-is-unregistered-until-it-actually-starts.md
-- Law: docs/laws.d/a-sit-and-go-is-unregistered-until-it-actually-starts.md
--
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
  /* A SIT AND GO STARTS WHEN ITS LAUNCH BEGINS (20261122192807). The launch
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
  -- A Sit and Go starts when its launch begins (20261122192807, the chip
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
