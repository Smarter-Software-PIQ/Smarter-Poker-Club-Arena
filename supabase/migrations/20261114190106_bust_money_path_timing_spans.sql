-- 20261114190106_bust_money_path_timing_spans
--
-- TIMING-ONLY INSTRUMENTATION OF THE PKO BUST MONEY PATH (incident #3, 2026-11-14).
--
-- What was wrong: on Midnight Free Buy PKO b6d94533 (496 entries) busts were
-- recorded about 13.5 a minute against 20-34 arriving. After the engine change
-- (#10833, 7f877ca5) only the knockout door and the payer are serial per bust,
-- and they are the ceiling: Supabase edge logs give the door a server-side
-- origin time of p10 685 / p50 802 ms in the 07:00 UTC hour (p10 862 at 08:00)
-- against ~130 / ~150 ms in every other hour of the day, and the payer 859-966
-- ms against ~200 ms. Ordinary reads moved only 96 -> 118 ms, so it is not the
-- gateway or the pool. pg_stat_statements is top-level only and track_functions
-- is off, so nothing shows WHERE inside these transactions the time goes:
-- waiting for the tournament's settlement lane (every table's hand step holds it
-- shared; the door and payer take it exclusive), the tournaments row lock, the
-- door's checks, the knockout core and its ~30 tournament_players row triggers,
-- or the payer's core. Postgres logged 300-460 lane waits a minute over 1 s
-- before rebuys closed at 07:30 UTC and almost none after, but waits under the
-- 1 s log threshold are invisible, and the 08:00 UTC hour (few, fast hand
-- steps) was the slowest of all, so the cause is not proven.
--
-- What this changes: nothing a caller can observe. fn_claim_tournament_bounty_
-- elimination and fn_collect_bounty are re-created from the exact bodies now on
-- main and in production (prosrc md5 4ec5bce3b65e7b1f18af615a5bdb1a96 and
-- bc621ffbddfd931897706f6d1f099109), with lines marked `-- @bust-money-span`
-- inserted and nothing else: one DECLARE of a start timestamp and calls to
-- smarter_private.fn_ca_bust_money_span(fn, mark, tournament, start) at
--   door:  lane, tournament_row, checks, core, end (success path)
--   payer: lane, tournament_row, pre_core, core, end (success path)
-- Each records milliseconds since function entry. Every call sits where it
-- cannot change FOUND or ROW_COUNT that a following statement reads, takes no
-- lock on any hot relation and runs after the lock it times, so the lock order
-- is unchanged. The helper swallows every error inside its own subtransaction,
-- so no error path changes. Deleting the marked lines restores the original
-- bodies byte for byte (tests/a-bust-money-span-changes-nothing.law.test.ts).
--
-- Bounded: it writes only while ca_bust_money_span_control.enabled_until is in
-- the future (48 hours from installation) and below row_cap rows. After that
-- each call is one indexed read and returns. The log table has no foreign key
-- to any hot table (CLAUDE.md DDL rule 7) and nothing reads it but the
-- incident analysis. No money is written; fn_collect_bounty is already
-- registered in ca_money_rpc_registry and stays so.
--
-- Install: ordinary (no hot-table lock): CREATE TABLE in smarter_private and
-- CREATE OR REPLACE FUNCTION, in one transaction with a short lock_timeout.

BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS smarter_private.ca_bust_money_span_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_until timestamptz NOT NULL,
  row_cap integer NOT NULL CHECK (row_cap > 0)
);
INSERT INTO smarter_private.ca_bust_money_span_control (singleton, enabled_until, row_cap)
VALUES (true, now() + interval '48 hours', 500000)
ON CONFLICT (singleton) DO NOTHING;

-- Append-only span log. No foreign keys (CLAUDE.md DDL rule 7).
CREATE TABLE IF NOT EXISTS smarter_private.ca_bust_money_spans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  txid bigint,
  fn text NOT NULL,
  mark text NOT NULL,
  tournament_id uuid,
  ms numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS ca_bust_money_spans_tournament_at
  ON smarter_private.ca_bust_money_spans (tournament_id, recorded_at);
REVOKE ALL ON smarter_private.ca_bust_money_span_control FROM PUBLIC;
REVOKE ALL ON smarter_private.ca_bust_money_spans FROM PUBLIC;

CREATE OR REPLACE FUNCTION smarter_private.fn_ca_bust_money_span(
  p_fn text, p_mark text, p_tournament_id uuid, p_since timestamptz)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $span$
BEGIN
  BEGIN
    IF EXISTS (
         SELECT 1 FROM smarter_private.ca_bust_money_span_control c
          WHERE c.enabled_until > clock_timestamp()
            AND COALESCE((SELECT max(s.id) FROM smarter_private.ca_bust_money_spans s), 0)
                < c.row_cap) THEN
      INSERT INTO smarter_private.ca_bust_money_spans (txid, fn, mark, tournament_id, ms)
      VALUES (txid_current_if_assigned(), p_fn, p_mark, p_tournament_id,
              round((extract(epoch FROM clock_timestamp() - p_since) * 1000)::numeric, 3));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- observation only: never changes the caller's result or error path
  END;
END;
$span$;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_bust_money_span(text, text, uuid, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_claim_tournament_bounty_elimination(p_tournament_id uuid, p_eliminated_user_id uuid, p_position integer, p_prize numeric, p_table_id uuid, p_hand_id uuid, p_hand_number bigint, p_seat_joined_at timestamp with time zone, p_knocker_user_id uuid, p_claimants jsonb, p_bubble_refund numeric DEFAULT 0, p_allow_existing_eliminated boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_player public.tournament_players%ROWTYPE;
  v_candidate public.tournament_knockout_candidates%ROWTYPE;
  v_resolved_candidate_id uuid;
  v_atomic public.hand_atomic_commits%ROWTYPE;
  v_live public.table_seats%ROWTYPE;
  v_evidence_stack numeric;
  v_settlement_hand_text text;
  v_settlement_hand_id uuid;
  v_live_count integer;
  v_changed integer;
  v_result jsonb;
  v_rebought_generations uuid[] := ARRAY[]::uuid[];
  v_span_t0 timestamptz := clock_timestamp(); -- @bust-money-span
BEGIN
  -- Exact replay is permitted after the player, seat and tournament have moved
  -- on. The immutable obligation itself is the receipt, and the private core
  -- verifies every caller-supplied field against it.
  IF p_tournament_id IS NULL OR p_eliminated_user_id IS NULL
     OR p_hand_number IS NULL THEN
    RETURN public.fn_claim_bounty_legacy_candidate_20260907(
      p_tournament_id,p_eliminated_user_id,p_position,p_prize,p_table_id,
      p_hand_id,p_hand_number,p_seat_joined_at,p_knocker_user_id,p_claimants,
      p_bubble_refund,p_allow_existing_eliminated);
  END IF;

  /* A BOUNTY BUST WAITS FOR ITS TOURNAMENT LANE (2026-10-22). The
     tournament_players write below is checked by f06_source_guard, which
     only TRIES the tournament's exclusive lane and refuses on contention
     (F06_RETRY_CANONICAL_LANE). Every table of the event takes that lane
     shared for each hand commit, so on a large field the try nearly always
     lost: Midnight Bounty 77c43fe1 and c97ae5a1 recorded no bust from
     06:19 UTC and left 130 busted players listed as playing. Take the lane
     here, before any row lock, waiting at most 4 s; the guard's try then
     finds it already held by this transaction. */
  DECLARE v_prior_lock_timeout text := current_setting('lock_timeout');
  BEGIN
    PERFORM set_config('lock_timeout', '4s', true);
    PERFORM pg_advisory_xact_lock_shared(
      hashtextextended('ca:tournament-terminal-settlement:v1', 0));
    PERFORM pg_advisory_xact_lock(
      hashtextextended('ca:tournament-terminal-settlement:v1:' || p_tournament_id::text, 0));
    PERFORM set_config('lock_timeout', v_prior_lock_timeout, true);
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'F06_RETRY_CANONICAL_LANE' USING ERRCODE = '55P03';
  END;
  PERFORM smarter_private.fn_ca_bust_money_span('door','lane',p_tournament_id,v_span_t0); -- @bust-money-span

  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;
  PERFORM smarter_private.fn_ca_bust_money_span('door','tournament_row',p_tournament_id,v_span_t0); -- @bust-money-span
  IF EXISTS (
    SELECT 1 FROM public.tournament_bounty_obligations o
     WHERE o.tournament_id=p_tournament_id
       AND o.table_id=p_table_id
       AND o.hand_id=p_hand_id
       AND o.hand_number=p_hand_number
       AND o.eliminated_user_id=p_eliminated_user_id
  ) THEN
    RETURN public.fn_claim_bounty_legacy_candidate_20260907(
      p_tournament_id,p_eliminated_user_id,p_position,p_prize,p_table_id,
      p_hand_id,p_hand_number,p_seat_joined_at,p_knocker_user_id,p_claimants,
      p_bubble_refund,p_allow_existing_eliminated);
  END IF;

  SELECT * INTO v_player FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
     AND tp.user_id=p_eliminated_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','player_not_found');
  END IF;

  PERFORM 1
    FROM public.tournament_knockout_candidates c
   WHERE c.tournament_id=p_tournament_id
     AND c.eliminated_user_id=p_eliminated_user_id
   ORDER BY c.hand_number,c.id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','knockout_candidate_required');
  END IF;

  v_resolved_candidate_id:=public.fn_ca_latest_committed_knockout_candidate(
    p_tournament_id,p_eliminated_user_id);
  SELECT c.* INTO v_candidate
    FROM public.tournament_knockout_candidates c
   WHERE c.id=v_resolved_candidate_id;
  IF NOT FOUND
     OR v_candidate.table_id IS DISTINCT FROM p_table_id
     OR v_candidate.hand_id IS DISTINCT FROM p_hand_id
     OR v_candidate.hand_number IS DISTINCT FROM p_hand_number
     OR v_candidate.seat_joined_at IS DISTINCT FROM p_seat_joined_at THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','bounty_claim_is_not_latest_knockout_hand');
  END IF;

  SELECT a.* INTO v_atomic
    FROM public.hand_atomic_commits a
   WHERE a.table_id=v_candidate.table_id
     AND a.hand_number=v_candidate.hand_number
     AND a.hand_id=v_candidate.hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','atomic_knockout_candidate_missing');
  END IF;
  v_settlement_hand_text:=v_atomic.stack_result->>'hand_id';
  IF coalesce(v_settlement_hand_text,'')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_atomic.stack_result->>'table_id'<>v_candidate.table_id::text
     OR coalesce(v_atomic.stack_result->>'hand_number','')
          !~ '^[0-9]+$'
     OR (v_atomic.stack_result->>'hand_number')::bigint<>
          v_candidate.hand_number
     OR coalesce(v_atomic.stack_result->'written'
                   ->>p_eliminated_user_id::text,'')
          !~ '^-?[0-9]+([.][0-9]+)?$'
     OR (v_atomic.stack_result->'written'
           ->>p_eliminated_user_id::text)::numeric<>0 THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','atomic_knockout_candidate_identity_conflict');
  END IF;
  v_settlement_hand_id:=v_settlement_hand_text::uuid;

  SELECT (k.result->'written'
            ->>p_eliminated_user_id::text)::numeric
    INTO v_evidence_stack
    FROM public.settlement_idempotency_keys k
   WHERE k.table_id=v_candidate.table_id
     AND k.hand_id=v_settlement_hand_id
     AND k.status='succeeded'
     AND k.completed_at IS NOT NULL
     AND k.result->>'table_id'=v_candidate.table_id::text
     AND coalesce(k.result->>'hand_number','') ~ '^[0-9]+$'
     AND (k.result->>'hand_number')::bigint=v_candidate.hand_number
     AND coalesce(k.result->'written'
                   ->>p_eliminated_user_id::text,'')
           ~ '^-?[0-9]+([.][0-9]+)?$';
  IF NOT FOUND OR v_evidence_stack<>0 THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','exact_knockout_settlement_receipt_missing');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tournament_knockout_candidates c
     WHERE c.tournament_id=p_tournament_id
       AND c.eliminated_user_id=p_eliminated_user_id
       AND c.hand_number>v_candidate.hand_number
  ) THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','latest_knockout_evidence_chain_conflict');
  END IF;
  /* A GENERATION A REBUY PAID FOR IS NOT A LIVE BUST (2026-09-11).
     The 2026-09-08/09 rebuy chain bought players back in without marking the
     busted generation 'rebought', so each left an older 'pending' row, and
     this check then refused every later, real bust of the same player for
     ever. The non-bounty door's rule applies here too: a pending generation
     is proven bought back when a posted 'rebuy' leg moved this player's own
     wallet into this event's prize liability AFTER that generation was
     captured and BEFORE the player's next generation was. A bounty adds one
     condition: the older generation's head must already be COLLECTED. A
     bounty rebuy settles the replaced generation's head before the purchase
     completes (fn_ca_settle_bounty_rebuy_generation_v1), so a proven
     generation is resolved only when its own bounty obligation exists and
     every obligation that names its hand or its chair is settled with its
     complete marker. A generation no obligation names never had its head
     collected: that head is still owed to whoever took the stack in that
     hand, and a rebuy adds the new head on top of it, so resolving it here
     would hand both heads to the player's next knocker. An obligation still
     owed would be collected against a player this claim is about to record
     under a newer head. Both stay refused, and the refusal raises an alert
     for a ruling. Only proven rows are resolved, only in the transaction
     that records the newer bust; anything unproven is refused exactly as
     before. */
  SELECT COALESCE(array_agg(c.id ORDER BY c.hand_number,c.id),ARRAY[]::uuid[])
    INTO v_rebought_generations
    FROM public.tournament_knockout_candidates c
   WHERE c.tournament_id=p_tournament_id
     AND c.eliminated_user_id=p_eliminated_user_id
     AND c.hand_number<v_candidate.hand_number
     AND c.state='pending'
     AND (
       -- DIAMOND PHASE 8: a Diamond rebuy or re-entry is a Diamond ledger
       -- row, not a chip leg; it proves the generation the same way.
       EXISTS (
       SELECT 1 FROM public.poker_diamond_tournament_ledger d
        WHERE d.user_id=p_eliminated_user_id
          AND d.tournament_id=p_tournament_id
          AND d.kind IN ('rebuy','reentry')
          AND d.amount>0
          AND d.created_at>c.created_at
          AND d.created_at<(
            SELECT n.created_at
              FROM public.tournament_knockout_candidates n
             WHERE n.tournament_id=p_tournament_id
               AND n.eliminated_user_id=p_eliminated_user_id
               AND n.hand_number>c.hand_number
             ORDER BY n.hand_number,n.id
             LIMIT 1))
       OR EXISTS (
       SELECT 1 FROM public.chip_ledger l
        WHERE l.from_entity_id=p_eliminated_user_id
          AND l.tournament_id=p_tournament_id
          AND l.category='rebuy'
          AND l.from_type='player_wallet'
          AND l.to_type='prize_liability'
          AND l.status='posted'
          AND l.amount>0
          AND l.created_at>c.created_at
          AND l.created_at<(
            SELECT n.created_at
              FROM public.tournament_knockout_candidates n
             WHERE n.tournament_id=p_tournament_id
               AND n.eliminated_user_id=p_eliminated_user_id
               AND n.hand_number>c.hand_number
             ORDER BY n.hand_number,n.id
             LIMIT 1)))
     AND EXISTS (
       SELECT 1 FROM public.tournament_bounty_obligations o
        WHERE o.tournament_id=p_tournament_id
          AND o.eliminated_user_id=p_eliminated_user_id
          AND o.table_id=c.table_id
          AND o.hand_id=c.hand_id
          AND o.hand_number=c.hand_number)
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_bounty_obligations o
        WHERE o.tournament_id=p_tournament_id
          AND o.eliminated_user_id=p_eliminated_user_id
          AND (o.hand_number=c.hand_number
               OR o.seat_joined_at=c.seat_joined_at)
          AND NOT (o.state='settled'
                   AND public.fn_bounty_obligation_has_complete_marker(o.id)));
  IF EXISTS (
    SELECT 1 FROM public.tournament_knockout_candidates c
     WHERE c.tournament_id=p_tournament_id
       AND c.eliminated_user_id=p_eliminated_user_id
       AND c.hand_number<v_candidate.hand_number
       AND c.state<>'rebought'
       AND c.id<>ALL(v_rebought_generations)
  ) THEN
    /* This refusal cannot clear by itself - no newer generation will make
       the older one proven - so it would hold the event open for ever
       without a word. It is written where the money board reads - once: one
       open alert per player. */
    INSERT INTO public.financial_alerts(severity,source,message,context)
    SELECT 'critical','knockout_door.payout_blocked_by_unrecordable_bust',
      'A busted player cannot be recorded, so the tournament cannot finish: '
        ||'an older knockout generation of theirs is neither rebought nor '
        ||'proven bought back (a posted rebuy leg after it and, in a bounty '
        ||'event, its head collected). That generation needs a ruling.',
      jsonb_build_object('tournament_id',p_tournament_id,'user_id',p_eliminated_user_id,
        'reason','unresolved_knockout_generation_chain',
        'hand_number',v_candidate.hand_number)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.financial_alerts fa
        WHERE fa.source='knockout_door.payout_blocked_by_unrecordable_bust'
          AND NOT fa.resolved
          AND fa.context->>'tournament_id'=p_tournament_id::text
          AND fa.context->>'user_id'=p_eliminated_user_id::text);
    RETURN jsonb_build_object(
      'ok',false,'reason','unresolved_knockout_generation_chain');
  END IF;
  IF v_candidate.state<>'pending' THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','knockout_generation_state_mismatch',
      'player_state',v_player.status,'candidate_state',v_candidate.state);
  END IF;
  IF v_candidate.rebuy_prompt_until IS NOT NULL
     AND v_candidate.rebuy_prompt_until>clock_timestamp() THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','rebuy_decision_open',
      'rebuy_prompt_until',v_candidate.rebuy_prompt_until);
  END IF;

  PERFORM 1
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id
     AND s.user_id=p_eliminated_user_id AND s.left_at IS NULL
   ORDER BY s.id FOR UPDATE OF s;
  SELECT count(*) INTO v_live_count
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id
     AND s.user_id=p_eliminated_user_id AND s.left_at IS NULL;
  IF v_live_count>1 THEN
    RETURN jsonb_build_object(
      'ok',false,'reason','knockout_generation_has_multiple_live_seats');
  END IF;
  IF v_live_count=1 THEN
    SELECT s.* INTO v_live
      FROM public.table_seats s
      JOIN public.tables tb ON tb.id=s.table_id
     WHERE tb.tournament_id=p_tournament_id
       AND s.user_id=p_eliminated_user_id AND s.left_at IS NULL;
    IF v_live.stack IS DISTINCT FROM 0
       OR v_live.table_id IS DISTINCT FROM v_candidate.table_id
       OR v_live.id IS DISTINCT FROM v_candidate.seat_id
       OR v_live.joined_at IS DISTINCT FROM v_candidate.seat_joined_at THEN
      RETURN jsonb_build_object(
        'ok',false,'reason','knockout_generation_has_new_live_seat');
    END IF;
  END IF;

  PERFORM smarter_private.fn_ca_bust_money_span('door','checks',p_tournament_id,v_span_t0); -- @bust-money-span
  v_result:=public.fn_claim_bounty_legacy_candidate_20260907(
    p_tournament_id,p_eliminated_user_id,p_position,p_prize,p_table_id,
    p_hand_id,p_hand_number,p_seat_joined_at,p_knocker_user_id,p_claimants,
    p_bubble_refund,p_allow_existing_eliminated);
  PERFORM smarter_private.fn_ca_bust_money_span('door','core',p_tournament_id,v_span_t0); -- @bust-money-span
  IF coalesce((v_result->>'ok')::boolean,false)
     AND coalesce((v_result->>'claimed')::boolean,false)
  THEN
    UPDATE public.tournament_knockout_candidates c
       SET state='eliminated',
           resolved_at=coalesce(c.resolved_at,clock_timestamp())
     WHERE c.id=v_candidate.id AND c.state='pending';
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>1 THEN
      RAISE EXCEPTION
        'bounty knockout generation changed while claim committed'
        USING ERRCODE='55000';
    END IF;
  END IF;
  -- The proven older generations close with the bust that proved them.
  IF coalesce((v_result->>'ok')::boolean,false)
     AND coalesce((v_result->>'claimed')::boolean,false)
     AND cardinality(v_rebought_generations)>0 THEN
    UPDATE public.tournament_knockout_candidates c
       SET state='rebought',resolved_at=clock_timestamp()
     WHERE c.id=ANY(v_rebought_generations)
       AND c.tournament_id=p_tournament_id
       AND c.eliminated_user_id=p_eliminated_user_id
       AND c.state='pending';
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>cardinality(v_rebought_generations) THEN
      RAISE EXCEPTION
        'a bought-back knockout generation changed while the bounty claim committed'
        USING ERRCODE='55000';
    END IF;
    v_result:=v_result||jsonb_build_object(
      'rebought_generations',to_jsonb(v_rebought_generations));
  END IF;
  PERFORM smarter_private.fn_ca_bust_money_span('door','end',p_tournament_id,v_span_t0); -- @bust-money-span
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_collect_bounty(p_tournament_id uuid, p_eliminated_user_id uuid, p_collector_user_id uuid, p_claimants jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.tournament_bounty_obligations%ROWTYPE;
  v_result jsonb;
  v_shares jsonb;
  v_paid_cash numeric;
  v_added_to_head numeric;
  v_context text := current_setting('app.bounty_obligation_id',true);
  v_prior_context text;
  v_obligation_count integer;
  v_pko_watermark bigint;
  v_predecessors jsonb;
  v_t record;
  v_elim record;
  v_head numeric;
  v_available numeric;
  v_payable numeric;
  v_cash numeric;
  v_to_head numeric;
  v_cents integer;
  v_cash_cents integer;
  v_mode text;
  v_funded boolean;
  v_claimants jsonb;
  v_n integer;
  v_total_weight numeric;
  v_paid_total numeric := 0;
  v_head_total numeric := 0;
  c record;
  v_share_cents integer;
  v_assigned_cents integer := 0;
  v_i integer := 0;
  v_prior numeric;
  v_settle jsonb;
  v_desc text;
  v_core_collector_user_id uuid;
  v_core_claimants jsonb;
  v_span_t0 timestamptz := clock_timestamp(); -- @bust-money-span
BEGIN
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  PERFORM smarter_private.fn_ca_bust_money_span('payer','lane',p_tournament_id,v_span_t0); -- @bust-money-span
  PERFORM 1 FROM public.tournaments t WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','tournament_not_found'); END IF;
  PERFORM smarter_private.fn_ca_bust_money_span('payer','tournament_row',p_tournament_id,v_span_t0); -- @bust-money-span

  IF COALESCE(v_context,'')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT * INTO o FROM public.tournament_bounty_obligations bo
     WHERE bo.id=v_context::uuid AND bo.tournament_id=p_tournament_id
       AND bo.eliminated_user_id=p_eliminated_user_id
       AND bo.mode<>'mystery_chest'
     FOR UPDATE;
  ELSE
    SELECT count(*) INTO v_obligation_count
      FROM public.tournament_bounty_obligations bo
     WHERE bo.tournament_id=p_tournament_id
       AND bo.eliminated_user_id=p_eliminated_user_id
       AND bo.mode<>'mystery_chest';
    IF v_obligation_count>1 THEN
      RETURN jsonb_build_object('ok',false,'reason','bounty_generation_identity_required');
    END IF;
    SELECT * INTO o FROM public.tournament_bounty_obligations bo
     WHERE bo.tournament_id=p_tournament_id
       AND bo.eliminated_user_id=p_eliminated_user_id
       AND bo.mode<>'mystery_chest'
     FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','bounty_obligation_not_ready');
  END IF;
  IF o.state='settled' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'user_id',b.collector_player_id,
             'cash',GREATEST(0,b.bounty_amount-COALESCE(b.added_to_collector_bounty,0)),
             'to_head',COALESCE(b.added_to_collector_bounty,0))
             ORDER BY b.collector_player_id),'[]'::jsonb),
           COALESCE(sum(GREATEST(0,b.bounty_amount-COALESCE(b.added_to_collector_bounty,0))),0),
           COALESCE(sum(b.added_to_collector_bounty),0)
      INTO v_shares,v_paid_cash,v_added_to_head
      FROM public.tournament_bounties b
     WHERE b.bounty_obligation_id=o.id;
    IF NOT public.fn_bounty_obligation_has_complete_marker(o.id) THEN
      RETURN jsonb_build_object('ok',false,'reason','settled_marker_incomplete',
                                'obligation_id',o.id);
    END IF;
    IF o.mode='pko' THEN
      INSERT INTO public.tournament_pko_settlement_watermarks
        (tournament_id,last_settled_hand_number,last_obligation_id)
      VALUES (o.tournament_id,o.hand_number,o.id)
      ON CONFLICT (tournament_id) DO UPDATE
        SET last_settled_hand_number=GREATEST(
              public.tournament_pko_settlement_watermarks.last_settled_hand_number,
              EXCLUDED.last_settled_hand_number),
            last_obligation_id=CASE
              WHEN EXCLUDED.last_settled_hand_number>=
                   public.tournament_pko_settlement_watermarks.last_settled_hand_number
              THEN EXCLUDED.last_obligation_id
              ELSE public.tournament_pko_settlement_watermarks.last_obligation_id END,
            updated_at=now();
    END IF;
    RETURN jsonb_build_object('ok',true,'already',true,'obligation_id',o.id,
      'marker_verified',true,'mode',o.mode,'head',o.head_amount,
      'paid_cash',v_paid_cash,'added_to_head',v_added_to_head,
      'split',jsonb_array_length(v_shares)>1,'shares',v_shares);
  END IF;

  IF o.mode='pko' THEN
    v_predecessors:=public.fn_pko_claim_predecessor_status_v1(
      o.tournament_id,o.eliminated_user_id,o.table_id,o.hand_id,
      o.hand_number,o.seat_joined_at);
    IF v_predecessors->>'ok' IS DISTINCT FROM 'true' THEN
      RETURN jsonb_build_object('ok',false,'reason','pko_predecessor_not_ready',
                               'predecessor_proof',v_predecessors);
    END IF;
  END IF;

  IF o.mode='pko' THEN
    SELECT w.last_settled_hand_number INTO v_pko_watermark
      FROM public.tournament_pko_settlement_watermarks w
     WHERE w.tournament_id=o.tournament_id FOR UPDATE;
    IF v_pko_watermark IS NOT NULL AND o.hand_number<v_pko_watermark THEN
      v_predecessors:=public.fn_pko_watermark_admission_status_v1(
        o.tournament_id,o.eliminated_user_id,o.table_id,o.hand_id,
        o.hand_number,o.seat_joined_at,o.claimants);
      IF v_predecessors->>'ok' IS DISTINCT FROM 'true' THEN
        RETURN jsonb_build_object('ok',false,'reason','pko_order_unproven',
          'watermark_proof',v_predecessors);
      END IF;
    END IF;
    -- The accepted-candidate guard above proves every actual incoming head
    -- dependency, including larger reserved hand numbers. Unrelated pending
    -- heads do not change this captured head and must not serialize its payout.
  END IF;

  -- Ignore caller ordering/weights. The exact pot-derived, roster-validated
  -- snapshot stored by the atomic claim is the only payout authority. The
  -- audited payer is inlined here so this root survives retirement of the
  -- temporary rolling-deployment body.
  v_core_collector_user_id := o.knocker_user_id;
  v_core_claimants := o.claimants;
  v_prior_context := current_setting('app.bounty_obligation_id',true);
  PERFORM set_config('app.bounty_obligation_id',o.id::text,true);

  PERFORM smarter_private.fn_ca_bust_money_span('payer','pre_core',p_tournament_id,v_span_t0); -- @bust-money-span
  <<collect_core>>
  BEGIN
    IF v_core_collector_user_id IS NULL OR p_eliminated_user_id IS NULL THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'missing_party');
      EXIT collect_core;
    END IF;

    SELECT id, is_bounty, is_pko, is_mystery_bounty, bounty_amount,
           bounty_pool, bounty_pool_paid, mystery_bounty_stage
      INTO v_t FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF NOT FOUND THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
      EXIT collect_core;
    END IF;
    IF NOT (COALESCE(v_t.is_bounty,false) OR COALESCE(v_t.is_pko,false)
            OR COALESCE(v_t.is_mystery_bounty,false)) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'not_a_bounty_tournament');
      EXIT collect_core;
    END IF;

    IF COALESCE(v_t.is_pko, false) AND COALESCE(v_t.is_mystery_bounty, false) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'undefined_pko_mystery_hybrid',
        'detail', 'PKO heads claim against bounty_pool; mystery chests are a sealed '
               || 'inventory. No split satisfies both. This event should not exist.');
      EXIT collect_core;
    END IF;

    /* A BUST BELONGS TO THE PHASE ITS HAND WAS PLAYED IN (2026-09-11). A
       persisted mystery_pre obligation is a head earned before activation;
       the seed keeps it outside the chest pool, so it is paid from the
       regular half after the chests open. Refusing it only strands it. */
    IF COALESCE(v_t.is_mystery_bounty, false)
       AND v_t.mystery_bounty_stage = 'active'
       AND o.mode IS DISTINCT FROM 'mystery_pre' THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'mystery_phase_active');
      EXIT collect_core;
    END IF;

    IF EXISTS (
      SELECT 1 FROM tournament_bounties b
       WHERE b.tournament_id = p_tournament_id
         AND b.eliminated_player_id = p_eliminated_user_id
         AND (
           b.bounty_obligation_id = (SELECT pending.id
             FROM tournament_bounty_obligations pending
            WHERE pending.tournament_id=p_tournament_id
              AND pending.eliminated_user_id=p_eliminated_user_id
              AND pending.mode <> 'mystery_chest' AND pending.state='pending'
            ORDER BY pending.hand_number, pending.created_at LIMIT 1)
           OR (b.bounty_obligation_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM tournament_bounty_obligations pending
              WHERE pending.tournament_id=p_tournament_id
                AND pending.eliminated_user_id=p_eliminated_user_id
                AND pending.mode <> 'mystery_chest' AND pending.state='pending'))
         )
    ) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'already_collected');
      EXIT collect_core;
    END IF;

    SELECT current_bounty INTO v_elim
      FROM tournament_players
     WHERE tournament_id = p_tournament_id AND user_id = p_eliminated_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
      v_result := jsonb_build_object(
        'ok', false, 'reason', 'eliminated_player_not_in_tournament');
      EXIT collect_core;
    END IF;

    v_mode := CASE WHEN COALESCE(v_t.is_pko,false) THEN 'pko'
                   WHEN COALESCE(v_t.is_mystery_bounty,false) THEN 'mystery_pre'
                   ELSE 'regular' END;

    v_head := COALESCE(NULLIF(v_elim.current_bounty, 0), v_t.bounty_amount, 0);
    IF v_head <= 0 THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'no_head_value');
      EXIT collect_core;
    END IF;
    IF EXISTS (
      SELECT 1 FROM tournament_bounty_obligations pending
       WHERE pending.tournament_id=p_tournament_id
         AND pending.eliminated_user_id=p_eliminated_user_id
         AND pending.mode <> 'mystery_chest' AND pending.state='pending'
         AND pending.head_amount IS DISTINCT FROM round(v_head,2)
    ) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'head_snapshot_changed');
      EXIT collect_core;
    END IF;

    v_funded := COALESCE(v_t.bounty_pool, 0) > 0;
    SELECT round(COALESCE(v_t.bounty_pool,0) - COALESCE(SUM(
             CASE WHEN lower(wt.type) = 'debit' THEN -abs(wt.amount)
                  ELSE wt.amount END), 0), 2)
      INTO v_available
      FROM wallet_transactions wt
     WHERE wt.related_entity_id = p_tournament_id
       AND wt.category = 'bounty';
    -- DIAMOND PHASE 9: a Diamond bounty is a ledger row, not a wallet row;
    -- the bank is what the entries put in less what it already paid.
    IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
      SELECT e.bounty_balance INTO v_available
        FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id) e;
    END IF;

    IF v_funded THEN
      IF v_available <= 0 THEN
        v_result := jsonb_build_object('ok', false, 'reason', 'bounty_pool_exhausted',
                                      'head', v_head, 'available', v_available);
        EXIT collect_core;
      END IF;
      IF v_available < v_head THEN
        v_result := jsonb_build_object('ok', false, 'reason', 'bounty_pool_underfunded',
                                      'head', v_head, 'available', v_available);
        EXIT collect_core;
      END IF;
      v_payable := v_head;
    ELSE
      v_payable := v_head;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'user_id', x.uid, 'weight', x.w)), '[]'::jsonb)
      INTO v_claimants
      FROM (
        SELECT (e->>'user_id')::uuid AS uid, (e->>'weight')::numeric AS w
          FROM jsonb_array_elements(COALESCE(v_core_claimants, '[]'::jsonb)) e
         WHERE (e->>'user_id') IS NOT NULL
           AND COALESCE((e->>'weight')::numeric, 0) > 0
           AND EXISTS (
             SELECT 1 FROM tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.user_id = (e->>'user_id')::uuid)
      ) x;
    v_n := jsonb_array_length(v_claimants);
    IF v_n <= 1 THEN
      v_claimants := jsonb_build_array(jsonb_build_object(
        'user_id', v_core_collector_user_id, 'weight', 1));
      v_n := 1;
    END IF;
    SELECT sum((e->>'weight')::numeric) INTO v_total_weight
      FROM jsonb_array_elements(v_claimants) e;

    v_cents := round(v_payable * 100)::integer;
    v_desc := CASE v_mode
      WHEN 'pko' THEN 'PKO bounty (cash half) from eliminated player'
      WHEN 'mystery_pre' THEN 'Bounty collected before the mystery phase opened'
      ELSE 'Bounty collected from eliminated player' END
      || CASE WHEN v_n > 1 THEN ' (split pot, ' || v_n || ' winners)' ELSE '' END;
    v_shares := '[]'::jsonb;

    FOR c IN
      SELECT (e->>'user_id')::uuid AS uid, (e->>'weight')::numeric AS w
        FROM jsonb_array_elements(v_claimants) e
       ORDER BY (e->>'weight')::numeric ASC, (e->>'user_id')
    LOOP
      v_i := v_i + 1;
      IF v_i < v_n THEN
        v_share_cents := floor(v_cents * c.w / v_total_weight)::integer;
        IF v_share_cents > 0 THEN
          v_share_cents := public.fn_ca_unit_floor_cents(
            v_share_cents::bigint,
            public.fn_ca_tournament_unit_cents(p_tournament_id))::integer;
        END IF;
      ELSE
        v_share_cents := v_cents - v_assigned_cents;
      END IF;
      v_assigned_cents := v_assigned_cents + v_share_cents;
      CONTINUE WHEN v_share_cents <= 0;

      IF v_mode = 'pko' THEN
        v_cash_cents := public.fn_ca_unit_floor_cents(
          (v_share_cents / 2)::bigint,
          public.fn_ca_tournament_unit_cents(p_tournament_id))::integer;
        v_cash := v_cash_cents / 100.0;
        v_to_head := (v_share_cents - v_cash_cents) / 100.0;
      ELSE
        v_cash := v_share_cents / 100.0;
        v_to_head := 0;
      END IF;

      IF v_cash > 0 THEN
        v_prior := COALESCE((
          SELECT debt.amount_paid FROM public.tournament_obligations debt
           WHERE debt.tournament_id = p_tournament_id
             AND debt.kind = 'bounty'
             AND debt.place IS NULL
             AND debt.user_id = c.uid), 0);
        v_settle := public.fn_settle_tournament_obligation(
          p_tournament_id, 'bounty', NULL, c.uid, round(v_prior + v_cash, 2),
          'fn_collect_bounty', v_desc);
        IF NOT COALESCE((v_settle->>'ok')::boolean, false) THEN
          RAISE EXCEPTION
            'fn_collect_bounty: bounty of % to % in tournament % refused (%); nothing recorded',
            v_cash, c.uid, p_tournament_id,
            COALESCE(v_settle->>'refused_reason', 'unknown');
        END IF;
        IF round(COALESCE((v_settle->>'paid')::numeric, 0), 2)
             <> round(v_cash, 2) THEN
          RAISE EXCEPTION
            'fn_collect_bounty: obligation paid % but the share is % for % in tournament %; nothing recorded',
            v_settle->>'paid', v_cash, c.uid, p_tournament_id;
        END IF;
      END IF;

      UPDATE tournament_players
         SET bounties_collected = COALESCE(bounties_collected,0) + 1,
             bounty_winnings = round(COALESCE(bounty_winnings,0) + v_cash, 2),
             current_bounty = round(COALESCE(current_bounty,0) + v_to_head, 2)
       WHERE tournament_id = p_tournament_id AND user_id = c.uid;

      INSERT INTO tournament_bounties
        (tournament_id, eliminated_player_id, collector_player_id, bounty_amount,
         added_to_collector_bounty, is_mystery_revealed)
      VALUES
        (p_tournament_id, p_eliminated_user_id, c.uid,
         round(v_share_cents / 100.0, 2),
         CASE WHEN v_to_head > 0 THEN v_to_head ELSE NULL END, false);

      v_paid_total := v_paid_total + v_cash;
      v_head_total := v_head_total + v_to_head;
      v_shares := v_shares || jsonb_build_object(
        'user_id', c.uid, 'cash', v_cash, 'to_head', v_to_head);
    END LOOP;

    UPDATE tournament_players SET current_bounty = 0
     WHERE tournament_id = p_tournament_id AND user_id = p_eliminated_user_id;

    IF v_funded THEN
      UPDATE tournaments
         SET bounty_pool_paid = round(COALESCE(bounty_pool_paid,0) + v_paid_total, 2)
       WHERE id = p_tournament_id;
    END IF;

    v_result := jsonb_build_object(
      'ok', true, 'mode', v_mode, 'funded', v_funded,
      'head', v_head, 'paid_cash', round(v_paid_total, 2),
      'added_to_head', round(v_head_total, 2),
      'split', v_n > 1, 'shares', v_shares,
      'capped', v_funded AND v_payable < v_head,
      'pool_remaining', CASE WHEN v_funded
                             THEN round(v_available - v_paid_total, 2) END);
  END collect_core;
  PERFORM smarter_private.fn_ca_bust_money_span('payer','core',p_tournament_id,v_span_t0); -- @bust-money-span

  PERFORM set_config('app.bounty_obligation_id',COALESCE(v_prior_context,''),true);

  IF NOT COALESCE((v_result->>'ok')::boolean,false) THEN
    -- A semantic pre-write refusal is safe to commit and stays pending. Any
    -- accepted payer result below must satisfy the exact marker postcondition
    -- or raise so its wallet/head/counter mutations roll back atomically.
    RETURN v_result || jsonb_build_object('obligation_id',o.id);
  END IF;

  UPDATE public.tournament_bounty_obligations bo
     SET state='settled',settled_at=COALESCE(settled_at,now()),last_error=NULL
   WHERE bo.id=o.id AND bo.state='pending'
     AND public.fn_bounty_obligation_has_complete_marker(bo.id);
  IF NOT public.fn_bounty_obligation_has_complete_marker(o.id)
     OR NOT EXISTS (SELECT 1 FROM public.tournament_bounty_obligations bo
                     WHERE bo.id=o.id AND bo.state='settled') THEN
    RAISE EXCEPTION 'accepted bounty payout did not produce the exact settled marker for %',o.id
      USING ERRCODE='check_violation';
  END IF;
  IF o.mode='pko' THEN
    INSERT INTO public.tournament_pko_settlement_watermarks
      (tournament_id,last_settled_hand_number,last_obligation_id)
    VALUES (o.tournament_id,o.hand_number,o.id)
    ON CONFLICT (tournament_id) DO UPDATE
      SET last_settled_hand_number=GREATEST(
            public.tournament_pko_settlement_watermarks.last_settled_hand_number,
            EXCLUDED.last_settled_hand_number),
          last_obligation_id=CASE
            WHEN EXCLUDED.last_settled_hand_number>=
                 public.tournament_pko_settlement_watermarks.last_settled_hand_number
            THEN EXCLUDED.last_obligation_id
            ELSE public.tournament_pko_settlement_watermarks.last_obligation_id END,
          updated_at=now();
  END IF;
  PERFORM smarter_private.fn_ca_bust_money_span('payer','end',p_tournament_id,v_span_t0); -- @bust-money-span
  RETURN v_result || jsonb_build_object('obligation_id',o.id,'marker_verified',true);
END;
$function$;

COMMIT;
