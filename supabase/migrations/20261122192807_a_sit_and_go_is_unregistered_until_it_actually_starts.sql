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
-- exactly as it was. Every other 'sng-v1' event takes the new authority
-- 'sit_and_go_actual_start': unregistration is refused once the event status
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
-- HOW. Anchored edits of the live definitions: each needle must occur exactly
-- once or the whole file aborts and nothing changes. The receipt check
-- constraint is widened by exactly one value, rebuilt from its live
-- definition so values added by other files survive.
-- tournament_unregistration_receipts is written only by an unregistration; it
-- is not one of the hot relations (clubs, tables, hand_history).
--
-- Changelog: docs/changelog/2026-11-22-a-sit-and-go-is-unregistered-until-it-actually-starts.md
-- Law: docs/laws.d/a-sit-and-go-is-unregistered-until-it-actually-starts.md
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure) LIKE '%sit_and_go_actual_start%')
-- @live-proof: (SELECT pg_get_constraintdef(c.oid) LIKE '%sit_and_go_actual_start%' FROM pg_constraint c WHERE c.conrelid = 'public.tournament_unregistration_receipts'::regclass AND c.conname = 'tournament_unregistration_actual_start_check')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. The immutable receipt may name the new start authority.
DO $widen_receipt_authority$
DECLARE
  v_def text;
  v_needle constant text := $n$'heads_up_sng_actual_start'::text$n$;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid='public.tournament_unregistration_receipts'::regclass
     AND c.conname='tournament_unregistration_actual_start_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'tournament_unregistration_actual_start_check is not installed';
  END IF;
  IF position('sit_and_go_actual_start' IN v_def)=0 THEN
    IF (length(v_def)-length(replace(v_def,v_needle,'')))/length(v_needle)<>1 THEN
      RAISE EXCEPTION 'the start authority list of tournament_unregistration_actual_start_check was expected exactly once';
    END IF;
    ALTER TABLE public.tournament_unregistration_receipts
      DROP CONSTRAINT tournament_unregistration_actual_start_check;
    EXECUTE 'ALTER TABLE public.tournament_unregistration_receipts '
      ||'ADD CONSTRAINT tournament_unregistration_actual_start_check '
      ||replace(v_def,v_needle,v_needle||$n$, 'sit_and_go_actual_start'::text$n$);
  END IF;
END
$widen_receipt_authority$;

-- 2. The chip unregistration core.
DO $sit_and_go_core$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure);
  v_edit record;
BEGIN
  IF position('sit_and_go_actual_start' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_ca_unregister_tournament_player_exact already names sit_and_go_actual_start: re-read before editing';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('authority',
$o$  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_start_authority:='heads_up_sng_actual_start';
  END IF;$o$,
$r$  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_start_authority:='heads_up_sng_actual_start';
  ELSIF v_t.format_contract='sng-v1' THEN
    /* A SIT AND GO STARTS WHEN ITS LAUNCH BEGINS (20261122192807). A six or
       nine seat Sit and Go is filled, not scheduled: the fixed satellite's
       start_time only opens its fill window. Its unregistration is governed
       by status, started_at, persisted hands and the launch receipt, never
       by the clock passing start_time. */
    v_start_authority:='sit_and_go_actual_start';
  END IF;$r$),
    ('launch_release',
$o$  IF v_start_authority='scheduled_clock' AND EXISTS ($o$,
$r$  IF v_start_authority IN ('scheduled_clock','sit_and_go_actual_start') AND EXISTS ($r$),
    ('refusal',
$o$    IF v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  END IF;$o$,
$r$    IF v_t.started_at IS NOT NULL OR v_launch_completed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok',false,'reason','tournament_started');
    END IF;
  END IF;
  /* A lobby-registered Sit and Go is seated and funded by its launch, so the
     launch owns the roster from its first write. That write (the launch
     receipt) is made under the tournaments row lock held above. */
  IF v_start_authority='sit_and_go_actual_start' AND EXISTS (
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
  IF v_start_authority='sit_and_go_actual_start' AND EXISTS (
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

-- 3. The receipt reader proves the new authority the way it proves the others.
DO $sit_and_go_receipt$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)'::regprocedure);
  v_edit record;
BEGIN
  IF position('sit_and_go_actual_start' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_ca_tournament_unregistration_receipt already names sit_and_go_actual_start: re-read before editing';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('completed_launch',
$o$     OR (v_r.start_authority IN (
           'spin_actual_start','heads_up_sng_actual_start','launch_release')
       AND EXISTS ($o$,
$r$     OR (v_r.start_authority IN (
           'spin_actual_start','heads_up_sng_actual_start','launch_release',
           'sit_and_go_actual_start')
       AND EXISTS ($r$),
    ('whitelist',
$o$     OR v_r.start_authority NOT IN (
          'scheduled_clock','spin_actual_start','heads_up_sng_actual_start',
          'launch_release')$o$,
$r$     OR (v_r.start_authority='sit_and_go_actual_start'
       AND NOT EXISTS (
         SELECT 1 FROM public.tournaments t
          WHERE t.id=v_r.tournament_id
            AND t.format_contract='sng-v1'
            AND COALESCE(t.max_players,0)<>2))
     OR v_r.start_authority NOT IN (
          'scheduled_clock','spin_actual_start','heads_up_sng_actual_start',
          'launch_release','sit_and_go_actual_start')$r$)
  ) AS e(label,old_text,new_text) LOOP
    IF (length(v_def)-length(replace(v_def,v_edit.old_text,'')))/length(v_edit.old_text)<>1 THEN
      RAISE EXCEPTION 'fn_ca_tournament_unregistration_receipt anchor % was expected exactly once',v_edit.label;
    END IF;
    v_def:=replace(v_def,v_edit.old_text,v_edit.new_text);
  END LOOP;
  EXECUTE v_def;
END
$sit_and_go_receipt$;

-- @probe-for: public.fn_ca_tournament_unregistration_receipt
DO $probe$
BEGIN
  PERFORM public.fn_ca_tournament_unregistration_receipt(
    gen_random_uuid(),gen_random_uuid(),NULL,NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- 4. The Diamond door keeps the chip authority's start rule, word for word.
DO $sit_and_go_diamond$
DECLARE
  v_def text := pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure);
  v_edit record;
BEGIN
  IF position('sit_and_go_actual_start' IN v_def)>0 THEN
    RAISE EXCEPTION 'fn_poker_diamond_tournament_unregister already names sit_and_go_actual_start: re-read before editing';
  END IF;
  FOR v_edit IN SELECT * FROM (VALUES
    ('authority',
$o$  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_authority := 'heads_up_sng_actual_start';
  END IF;$o$,
$r$  ELSIF v_t.format_contract='sng-v1'
     AND COALESCE(v_t.max_players,0)=2 THEN
    v_authority := 'heads_up_sng_actual_start';
  ELSIF v_t.format_contract='sng-v1' THEN
    -- A Sit and Go starts when its launch begins, never when a clock passes
    -- (20261122192807, the chip authority's rule).
    v_authority := 'sit_and_go_actual_start';
  END IF;$r$),
    ('launch_release',
$o$  IF v_authority='scheduled_clock' AND EXISTS ($o$,
$r$  IF v_authority IN ('scheduled_clock','sit_and_go_actual_start') AND EXISTS ($r$),
    ('refusal',
$o$  ELSIF EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;$o$,
$r$  ELSIF EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_started');
  END IF;
  IF v_authority='sit_and_go_actual_start' AND EXISTS (
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

-- 5. The file installed what it says, or nothing.
DO $verify_sit_and_go$
BEGIN
  IF position($p$v_start_authority:='sit_and_go_actual_start'$p$ IN pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure))=0
     OR position('sit and go launch began before unregistration could commit' IN pg_get_functiondef('public.fn_ca_unregister_tournament_player_exact(uuid,uuid,uuid,text,uuid)'::regprocedure))=0
     OR position($p$v_r.start_authority='sit_and_go_actual_start'$p$ IN pg_get_functiondef('public.fn_ca_tournament_unregistration_receipt(uuid,uuid,uuid,uuid)'::regprocedure))=0
     OR position($p$v_authority := 'sit_and_go_actual_start'$p$ IN pg_get_functiondef('public.fn_poker_diamond_tournament_unregister(uuid,uuid,uuid)'::regprocedure))=0
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid='public.tournament_unregistration_receipts'::regclass
          AND c.conname='tournament_unregistration_actual_start_check'
          AND c.convalidated
          AND position('sit_and_go_actual_start' IN pg_get_constraintdef(c.oid))>0) THEN
    RAISE EXCEPTION 'sit and go actual-start unregistration did not install exactly';
  END IF;
END
$verify_sit_and_go$;

COMMIT;
