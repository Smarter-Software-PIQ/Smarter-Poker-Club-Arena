-- @live-proof: (SELECT count(*) FROM public.tournament_cancellation_receipts h WHERE h.receipt_version=5 AND h.receipt->>'mode'='started_owner_forfeit_to_house') = 15 AND NOT EXISTS (SELECT 1 FROM public.poker_diamond_custody c WHERE c.purpose='tournament_entry' AND c.state<>'released' AND c.target_id IN (SELECT h.tournament_id FROM public.tournament_cancellation_receipts h WHERE h.receipt_version=5)) AND NOT EXISTS (SELECT 1 FROM public.tournaments x WHERE public.fn_poker_diamond_tournament(x.id) AND upper(x.status::text) IN ('RUNNING','BREAK','LATE_REG','COMPLETING'))
-- ============================================================================
-- THE FIFTEEN FROZEN DIAMOND EVENTS CLOSE, AND THEIR DIAMONDS GO TO THE HOUSE
-- (Dan, 2026-11-02 14:53 UTC)
-- ============================================================================
--
-- Dan, verbatim: "MARK THEM ALL AS COMPLETED, AND MOVE THE DIAMONDS INTO THE
-- MINT. I DON'T WANT THESE MARKED AS OUTSTANDING OR STILL RUNNING AGAIN."
-- Earlier the same morning: "MAKE SURE THAT ANY OF THE 15 TOURNAMENTS THAT
-- WERE 'FROZEN' ARE MARKED AS COMPLETED AND DELETED."
--
-- This is the owner's disposition of these fifteen events. It supersedes the
-- equal-share plan (20261101004247): no remaining entrant receives a share.
-- It is not an agent's decision about who should be paid, and it does not turn
-- on who the entrants are. Every Diamond the fifteen events still hold leaves
-- custody for the Diamond house (ca_diamond_house), recorded in the mint
-- register exactly as the house's other Diamond income is.
--
-- READ FROM ROWS (2026-11-02 15:05 UTC). All fifteen are RUNNING and have been
-- stopped since 2026-10-31 03:30:49 UTC (the Diamond Arena closure,
-- 20261031032915 / 20261102052454). 1,436 registrations (704 still playing),
-- 1,436 unreleased tournament_entry custody rows holding 428,212 Diamonds:
--   prize bank 380,070 + bounty bank 22,500 = 402,570  -> the house (forfeit)
--   fee bank                                   25,642  -> the house (fee)
-- 8,990 Diamonds already awarded (bounties and five Midday Free Buy places)
-- are untouched: they are wallet credits that already happened. No unpaid
-- tournament_obligations, no satellite tickets issued or owed by any of the
-- fifteen, no cancellation receipt, no fee settlement, platform not frozen.
--
-- "COMPLETED" IS NOT A STATUS THESE EVENTS CAN HONESTLY TAKE. COMPLETED
-- requires a canonical winner (position 1), a finish claim and a financial
-- certificate (fn_guard_tournament_completed_certificate). None of these
-- events finished, and inventing a winner would fabricate a result. They are
-- closed with the terminal status every operator closure uses, CANCELLED,
-- with an immutable receipt of its own kind (receipt_version 5,
-- 'started_owner_forfeit_to_house'). The lobby lists only REGISTERING,
-- RUNNING and BAGGED events (TournamentService), so nothing here is shown as
-- outstanding or running again. Nothing is DELETED: the custody rows,
-- movements, ledger, register, roster and hands are the audit trail of
-- 428,212 Diamonds and stay.
--
-- WHAT THIS ADDS (one transaction, CLAUDE.md production DDL policy):
-- 1. poker_diamond_tournament_ledger kind 'forfeit': one event-level outflow
--    row (no user, no custody row, no fee part) recording the prize and
--    bounty banks leaving for the house. The Diamond escrow
--    (fn_poker_diamond_tournament_escrow) and the terminal shadow
--    (fn_poker_diamond_tournament_open_shadow) count it out of each bank, so
--    "escrow agrees with custody" holds after the drain.
-- 2. fn_poker_diamond_tournament_drain labels a forfeit honestly in the
--    register (it would otherwise call it a Spin surplus or an entry fee).
-- 3. tournament_cancellation_receipts admits receipt_version 5 under the same
--    zero-refund/zero-reversal arithmetic as version 4, and
--    fn_ca_tournament_cancellation_receipt proves a version 5 receipt with
--    smarter_private.tournament_owner_forfeit_receipt: terminal parent, closed
--    zero escrow, retired roster, closed tables, released seats, zero and fully
--    released custody, and the forfeit, fee and house register rows matching
--    the receipt to the Diamond.
-- No standing function that can forfeit an event is created. The forfeit
-- itself runs once, below, inline, for exactly these fifteen ids.
--
-- HOW EACH EVENT IS CLOSED, all through the platform's own Diamond doors:
--   global settlement lane, then the event's cancellation lane;
--   the banks are asserted equal to the figures above (the run aborts if the
--   board moved);
--   fn_poker_diamond_tournament_drain(prize, then bounty -> 'house'): consumes
--     each row's purchased lots, writes one release movement per row and one
--     player-side burn per row in the register (the wallet does not move: the
--     Diamonds left it when the entry was bought);
--   the house is credited and its mint row written, exactly as
--     fn_poker_diamond_tournament_settle_fee does for the fee;
--   one 'forfeit' ledger row; an already-open terminal shadow (4 events) takes
--     the same outflow through fn_ca_escrow_apply;
--   COMPLETING, then fn_settle_tournament_rake: the fee bank to the house
--     through fn_poker_diamond_tournament_settle_fee, the emptied custody rows
--     released (fn_poker_diamond_tournament_close_custody), any guarantee
--     earmark released;
--   escrow closed at exact zero; roster retired (chips 0, original
--     elimination order and places kept); seats released; CANCELLED; tables
--     closed; the receipt written and proved at commit.
-- Coordination: 01a19a5c held the equal-share settlement for these events.
-- None of its operations had quiesced (7 targets stop_requested, 8 none), so
-- no settlement write of theirs exists to duplicate. Their equal-share door
-- cannot run afterwards: a receipt makes the event's evidence immutable.
-- ============================================================================

BEGIN;
-- Superseded before installation by the November 2 owner direction in
-- chat 01a19ccc: eligible Diamonds go to verified KingFish, with liabilities
-- separated and one financial writer. Preserve the historical source below,
-- but never execute its different house destination or inline disposition.
DO $superseded_owner_destination$
BEGIN
 RAISE EXCEPTION 'owner_house_disposition_superseded_use_verified_kingfish_retirement'
  USING ERRCODE='55000';
END $superseded_owner_destination$;
SET LOCAL lock_timeout = '3s';

-- 1. THE FORFEIT LEG --------------------------------------------------------
DO $ddl$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid='public.poker_diamond_tournament_ledger'::regclass AND conname='poker_diamond_tournament_ledger_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''entry''::text, ''rebuy''::text, ''reentry''::text, ''addon''::text, ''prize''::text, ''bounty''::text, ''fee''::text, ''refund''::text, ''spin_underwrite''::text, ''spin_surplus''::text, ''overlay''::text, ''overlay_return''::text])))' THEN
    RAISE EXCEPTION 'ledger kind check moved: %', v_def;
  END IF;
  ALTER TABLE public.poker_diamond_tournament_ledger DROP CONSTRAINT poker_diamond_tournament_ledger_kind_check;
  ALTER TABLE public.poker_diamond_tournament_ledger ADD CONSTRAINT poker_diamond_tournament_ledger_kind_check
    CHECK (kind IN ('entry','rebuy','reentry','addon','prize','bounty','fee','refund','spin_underwrite','spin_surplus','overlay','overlay_return','forfeit'));

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid='public.poker_diamond_tournament_ledger'::regclass AND conname='poker_diamond_tournament_ledger_outflow';
  IF v_def IS NULL OR left(v_def,6) <> 'CHECK ' OR position('forfeit' IN v_def) > 0 THEN
    RAISE EXCEPTION 'ledger outflow check moved: %', v_def;
  END IF;
  ALTER TABLE public.poker_diamond_tournament_ledger DROP CONSTRAINT poker_diamond_tournament_ledger_outflow;
  EXECUTE format('ALTER TABLE public.poker_diamond_tournament_ledger ADD CONSTRAINT poker_diamond_tournament_ledger_outflow CHECK ((%s) OR ((kind = %L) AND (user_id IS NULL) AND (custody_id IS NULL) AND (fee_part = 0)))',
                 substring(v_def FROM 7), 'forfeit');
END $ddl$;

-- 2. THE ESCROW, THE SHADOW AND THE DRAIN LABEL COUNT IT --------------------
DO $fn$
DECLARE
  v_src text; v_new text;
  c_prize_old constant text := 'FILTER (WHERE kind = ''prize''),0)  AS prize_out';
  c_prize_new constant text := 'FILTER (WHERE kind = ''prize''),0) + COALESCE(sum(prize_part) FILTER (WHERE kind = ''forfeit''),0) AS prize_out';
  c_bounty_old constant text := 'FILTER (WHERE kind = ''bounty''),0) AS bounty_out';
  c_bounty_new constant text := 'FILTER (WHERE kind = ''bounty''),0) + COALESCE(sum(bounty_part) FILTER (WHERE kind = ''forfeit''),0) AS bounty_out';
  c_label_old constant text := 'CASE WHEN p_bank=''prize'' AND p_reason LIKE ''poker-guarantee-overlay-return:%''';
  c_label_new constant text := 'CASE WHEN p_reason LIKE ''poker-tournament-owner-forfeit:%'''
    || E'\n              THEN ''Diamond entry forfeited to the house when the owner closed this event: ''||COALESCE(v_name,''tournament'')'
    || E'\n              WHEN p_bank=''prize'' AND p_reason LIKE ''poker-guarantee-overlay-return:%''';
  f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_poker_diamond_tournament_escrow(uuid)'::regprocedure,
                           'public.fn_poker_diamond_tournament_open_shadow(uuid)'::regprocedure] LOOP
    v_src := pg_get_functiondef(f);
    IF (length(v_src)-length(replace(v_src,c_prize_old,'')))/length(c_prize_old) <> 1
       OR (length(v_src)-length(replace(v_src,c_bounty_old,'')))/length(c_bounty_old) <> 1
       OR position('forfeit' IN v_src) > 0 THEN
      RAISE EXCEPTION '% does not read as expected', f;
    END IF;
    v_new := replace(replace(v_src,c_prize_old,c_prize_new),c_bounty_old,c_bounty_new);
    EXECUTE v_new;
  END LOOP;

  v_src := pg_get_functiondef('public.fn_poker_diamond_tournament_drain(uuid,text,bigint,text,text,uuid)'::regprocedure);
  IF (length(v_src)-length(replace(v_src,c_label_old,'')))/length(c_label_old) <> 1 OR position('owner-forfeit' IN v_src) > 0 THEN
    RAISE EXCEPTION 'the drain label does not read as expected';
  END IF;
  EXECUTE replace(v_src,c_label_old,c_label_new);
END $fn$;

-- 3. THE RECEIPT -------------------------------------------------------------
ALTER TABLE public.tournament_cancellation_receipts DROP CONSTRAINT tournament_cancellation_receipts_receipt_version_check;
ALTER TABLE public.tournament_cancellation_receipts ADD CONSTRAINT tournament_cancellation_receipts_receipt_version_check CHECK (
  (receipt_version = 2)
  OR ((receipt_version = 3) AND (NOT ((receipt ->> 'mode') IS DISTINCT FROM 'started_operator_abort')) AND ((receipt ->> 'operation_id') IS NOT NULL))
  OR ((receipt_version = 4) AND (NOT ((receipt ->> 'mode') IS DISTINCT FROM 'started_operator_equal_share')) AND ((receipt ->> 'operation_id') IS NOT NULL))
  OR ((receipt_version = 5) AND (NOT ((receipt ->> 'mode') IS DISTINCT FROM 'started_owner_forfeit_to_house')) AND ((receipt ->> 'operation_id') IS NOT NULL)));
ALTER TABLE public.tournament_cancellation_receipts DROP CONSTRAINT tournament_cancellation_receipts_check12;
ALTER TABLE public.tournament_cancellation_receipts ADD CONSTRAINT tournament_cancellation_receipts_check12 CHECK (
  ((total_rake_before)::text <> ALL (ARRAY['NaN','Infinity','-Infinity']))
  AND ((total_rake_after)::text <> ALL (ARRAY['NaN','Infinity','-Infinity']))
  AND (total_rake_before >= 0)
  AND (((receipt_version = ANY (ARRAY[2, 3])) AND (total_rake_after = 0) AND (total_rake_before = fees_reversed))
    OR ((receipt_version = ANY (ARRAY[4, 5])) AND (total_rake_after = total_rake_before) AND (fees_reversed = 0)
        AND (total_refunded = 0) AND (total_ticket_returned = 0) AND (refund_line_count = 0)
        AND (ticket_return_count = 0) AND (cardinality(fee_reversal_ids) = 0))));

CREATE OR REPLACE FUNCTION smarter_private.tournament_owner_forfeit_receipt(p_tournament_id uuid, p_observed_actor_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $v5$
DECLARE
  h public.tournament_cancellation_receipts%ROWTYPE; t public.tournaments%ROWTYPE; e public.tournament_escrow%ROWTYPE;
  v_ids uuid[]; v_key text := 'poker-tournament-owner-forfeit:'||p_tournament_id::text;
  v_forfeit numeric; v_fee numeric;
BEGIN
  SELECT * INTO h FROM public.tournament_cancellation_receipts WHERE tournament_id=p_tournament_id;
  IF NOT FOUND OR h.receipt_version<>5 OR h.receipt->>'mode' IS DISTINCT FROM 'started_owner_forfeit_to_house' THEN
    RAISE EXCEPTION 'tournament % has no owner forfeit receipt', p_tournament_id USING ERRCODE='P0404';
  END IF;
  IF p_observed_actor_id IS NOT NULL AND h.actor_id IS DISTINCT FROM p_observed_actor_id THEN
    RAISE EXCEPTION 'cancellation actor disagrees with stored receipt' USING ERRCODE='55000';
  END IF;
  SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id;
  SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id=p_tournament_id;
  IF t.id IS NULL OR upper(COALESCE(t.status::text,''))<>'CANCELLED' OR t.ended_at IS DISTINCT FROM h.settled_at
     OR t.current_players IS DISTINCT FROM 0 OR t.prize_pool IS DISTINCT FROM 0::numeric OR t.bounty_pool IS DISTINCT FROM 0::numeric
     OR t.total_rake IS DISTINCT FROM h.total_rake_after OR t.on_break IS DISTINCT FROM false
     OR t.break_started_at IS NOT NULL OR t.break_ends_at IS NOT NULL
     OR e.tournament_id IS NULL OR e.enforced IS DISTINCT FROM true
     OR e.prize_balance IS DISTINCT FROM 0::numeric OR e.bounty_balance IS DISTINCT FROM 0::numeric OR e.fee_balance IS DISTINCT FROM 0::numeric
     OR e.closed_at IS DISTINCT FROM h.escrow_closed_at OR e.close_note IS DISTINCT FROM h.escrow_close_note THEN
    RAISE EXCEPTION 'owner forfeit receipt lost its terminal parent or escrow state' USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(tp.id ORDER BY tp.id),'{}') INTO v_ids FROM public.tournament_players tp WHERE tp.tournament_id=p_tournament_id;
  IF v_ids IS DISTINCT FROM h.source_player_ids OR v_ids IS DISTINCT FROM h.zero_refund_registration_ids
     OR EXISTS (SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=p_tournament_id
                AND (tp.status::text<>'eliminated' OR COALESCE(tp.chips,0)<>0 OR COALESCE(tp.current_bounty,0)<>0)) THEN
    RAISE EXCEPTION 'owner forfeit receipt lost its retired roster' USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id),'{}') INTO v_ids FROM public.tables tb WHERE tb.tournament_id=p_tournament_id;
  IF v_ids IS DISTINCT FROM h.closed_table_ids OR EXISTS (SELECT 1 FROM public.tables tb WHERE tb.tournament_id=p_tournament_id
       AND (lower(COALESCE(tb.status::text,''))<>'closed' OR lower(COALESCE(tb.lifecycle,''))<>'closed'
            OR tb.current_players IS DISTINCT FROM 0 OR tb.terminal_closed_at IS DISTINCT FROM h.settled_at)) THEN
    RAISE EXCEPTION 'owner forfeit receipt lost its closed tables' USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}') INTO v_ids FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=p_tournament_id;
  IF v_ids IS DISTINCT FROM h.source_seat_ids OR EXISTS (SELECT 1 FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id
       WHERE tb.tournament_id=p_tournament_id AND (s.left_at IS NULL OR s.status IS DISTINCT FROM 'left' OR s.stack IS DISTINCT FROM 0)) THEN
    RAISE EXCEPTION 'owner forfeit receipt lost its released seats' USING ERRCODE='P0404';
  END IF;
  IF public.fn_poker_diamond_tournament_custody(p_tournament_id)<>0
     OR EXISTS (SELECT 1 FROM public.poker_diamond_custody c WHERE c.purpose='tournament_entry' AND c.target_id=p_tournament_id AND c.state<>'released') THEN
    RAISE EXCEPTION 'owner forfeit receipt has Diamonds still in custody' USING ERRCODE='P0404';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO v_forfeit FROM public.poker_diamond_tournament_ledger WHERE tournament_id=p_tournament_id AND kind='forfeit';
  SELECT COALESCE(sum(amount),0) INTO v_fee FROM public.poker_diamond_tournament_ledger WHERE tournament_id=p_tournament_id AND kind='fee';
  IF v_forfeit IS DISTINCT FROM (h.receipt->>'forfeited_to_house')::numeric OR v_fee IS DISTINCT FROM (h.receipt->>'fee_to_house')::numeric
     OR (v_forfeit>0 AND NOT EXISTS (SELECT 1 FROM public.ca_mint_ledger m WHERE m.op_id=v_key AND m.action='mint' AND m.asset='diamonds' AND m.holder_type='house' AND m.amount=v_forfeit))
     OR (v_forfeit=0 AND EXISTS (SELECT 1 FROM public.ca_mint_ledger m WHERE m.op_id=v_key)) THEN
    RAISE EXCEPTION 'owner forfeit receipt disagrees with its Diamond ledger or the house register' USING ERRCODE='P0404';
  END IF;
  RETURN h.receipt;
END $v5$;
REVOKE ALL ON FUNCTION smarter_private.tournament_owner_forfeit_receipt(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.tournament_owner_forfeit_receipt(uuid,uuid) TO service_role;
COMMENT ON FUNCTION smarter_private.tournament_owner_forfeit_receipt(uuid,uuid) IS
  'Proves a receipt_version 5 owner forfeit: terminal parent, zero closed escrow, retired roster, closed tables, released seats, released custody, and the forfeit, fee and house register rows matching the receipt (20261102150315).';

DO $rc$
DECLARE
  v_src text;
  c_anchor constant text := 'IF v_h.receipt_version=4 THEN RETURN smarter_private.tournament_equal_share_receipt(p_tournament_id,p_observed_actor_id);END IF;';
BEGIN
  v_src := pg_get_functiondef('public.fn_ca_tournament_cancellation_receipt(uuid,uuid)'::regprocedure);
  IF (length(v_src)-length(replace(v_src,c_anchor,'')))/length(c_anchor) <> 1 OR position('owner_forfeit' IN v_src) > 0 THEN
    RAISE EXCEPTION 'the cancellation receipt dispatcher does not read as expected';
  END IF;
  EXECUTE replace(v_src, c_anchor, c_anchor || E'\n  IF v_h.receipt_version=5 THEN RETURN smarter_private.tournament_owner_forfeit_receipt(p_tournament_id,p_observed_actor_id);END IF;');
END $rc$;

-- 4. THE FIFTEEN -------------------------------------------------------------
DO $close$
DECLARE
  c_house constant uuid := '00000000-0000-0000-0000-00000000d1a0';
  c_actor constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  c_op constant uuid := uuid_in(md5('owner-forfeit-to-house:diamond-arena-closure:2026-11-02')::cstring);
  c_note constant text := 'Owner closure: the remaining Diamond banks went to the house (Dan, 2026-11-02)';
  c_instruction constant text := 'MARK THEM ALL AS COMPLETED, AND MOVE THE DIAMONDS INTO THE MINT. I DON''T WANT THESE MARKED AS OUTSTANDING OR STILL RUNNING AGAIN.';
  ev record; e record; t public.tournaments; x record;
  v_key text; v_forfeit bigint; v_before numeric; v_after numeric; v_supply numeric; v_burned numeric;
  v_drained jsonb; v_rake jsonb; v_settled timestamptz;
  v_players uuid[]; v_tables uuid[]; v_seats uuid[]; v_released uuid[];
  v_house0 numeric; v_tot_forfeit bigint := 0; v_tot_fee bigint := 0; v_n int := 0;
  v_receipt jsonb;
BEGIN
  IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'the platform is frozen; apply after the break'; END IF;
  PERFORM public.fn_ca_lock_settlement_lane_global();
  INSERT INTO public.ca_diamond_house (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
  SELECT balance INTO v_house0 FROM public.ca_diamond_house WHERE id=1;

  FOR ev IN SELECT * FROM (VALUES
    ('a54bdd4f-26b8-47c5-aa24-2c2b97b14015'::uuid,  30240::bigint,     0::bigint,  3360::bigint),
    ('e287e6b9-630d-4f2e-a205-d21841a490d8',         30000, 12825,  2580),
    ('0fc27b7b-4290-4e73-8680-9791e021f114',         20000,  1350,  2640),
    ('f4c2dd81-58d7-4a11-99de-da923b70d5f7',         30000,     0,  2370),
    ('eb82f8d7-53b9-4e2a-9fd5-c2b76ec73d19',           300,     0,    20),
    ('28fd0051-32fa-408d-950e-3a556c5979b2',         15000,  8325,  2180),
    ('10146b16-aaac-4606-a2aa-7bbc3863b750',         31010,     0,     0),
    ('6429087f-a9d1-49a3-b7cf-85e1ee283ac9',         11200,     0,     0),
    ('37b4adc0-f9f4-484e-a914-3c50749055df',        194460,     0, 12040),
    ('928dc47d-14b8-4721-9990-a5ccfd57a41e',           540,     0,    60),
    ('78d24c32-683a-42fa-8d7a-b5cf6dadf251',          8500,     0,     0),
    ('369d46bd-1eba-44bf-a80f-fb19ec980614',           360,     0,    40),
    ('26ebb662-63bf-4bc5-9ac8-962bc5ad8849',           300,     0,    12),
    ('fe9145bb-acc1-4a51-97d1-e473d3c39c6e',          6000,     0,   100),
    ('0d98f87e-65bb-483c-b34d-0cc6af4a4e29',          2160,     0,   240)
  ) AS v(id, prize, bounty, fee) ORDER BY id
  LOOP
    PERFORM smarter_private.cancellation_lane(ev.id);
    SELECT * INTO t FROM public.tournaments WHERE id=ev.id FOR UPDATE;
    IF t.status IS DISTINCT FROM 'RUNNING' OR NOT public.fn_poker_diamond_tournament(ev.id) THEN
      RAISE EXCEPTION 'event % is %, not a RUNNING Diamond event', ev.id, t.status;
    END IF;
    SELECT * INTO e FROM public.fn_poker_diamond_tournament_escrow(ev.id);
    IF e.prize_balance <> ev.prize OR e.bounty_balance <> ev.bounty OR e.fee_balance <> ev.fee
       OR public.fn_poker_diamond_tournament_custody(ev.id) <> ev.prize + ev.bounty + ev.fee THEN
      RAISE EXCEPTION 'event % banks moved: prize %, bounty %, fee %, custody %', ev.id, e.prize_balance, e.bounty_balance, e.fee_balance,
        public.fn_poker_diamond_tournament_custody(ev.id);
    END IF;
    IF EXISTS (SELECT 1 FROM public.tournament_obligations o WHERE o.tournament_id=ev.id AND o.amount_owed>o.amount_paid)
       OR EXISTS (SELECT 1 FROM public.tournament_cancellation_receipts h WHERE h.tournament_id=ev.id)
       OR EXISTS (SELECT 1 FROM public.tournament_rake_settlements r WHERE r.tournament_id=ev.id) THEN
      RAISE EXCEPTION 'event % has an unpaid obligation, a receipt or a fee settlement already', ev.id;
    END IF;
    PERFORM set_config('app.poker_diamond_staff_cancel', ev.id::text, true);
    PERFORM set_config('app.managed_game_lifecycle', 'on', true);
    -- The terminal shadow opens while the event is still RUNNING, exactly as
    -- the equal-share close opens it, and then takes every outflow below.
    PERFORM public.fn_poker_diamond_tournament_open_shadow(ev.id);

    -- Prize and bounty banks to the house.
    v_key := 'poker-tournament-owner-forfeit:'||ev.id::text;
    v_forfeit := ev.prize + ev.bounty;
    v_burned := 0;
    IF ev.prize > 0 THEN
      v_drained := public.fn_poker_diamond_tournament_drain(ev.id, 'prize', ev.prize, v_key||':prize', 'house', NULL);
      SELECT v_burned + COALESCE(sum(m.amount),0) INTO v_burned FROM public.ca_mint_ledger m
       WHERE m.asset='diamonds' AND m.action='burn' AND m.holder_type='player'
         AND m.op_id IN (SELECT d->>'register_op_id' FROM jsonb_array_elements(v_drained) d);
    END IF;
    IF ev.bounty > 0 THEN
      v_drained := public.fn_poker_diamond_tournament_drain(ev.id, 'bounty', ev.bounty, v_key||':bounty', 'house', NULL);
      SELECT v_burned + COALESCE(sum(m.amount),0) INTO v_burned FROM public.ca_mint_ledger m
       WHERE m.asset='diamonds' AND m.action='burn' AND m.holder_type='player'
         AND m.op_id IN (SELECT d->>'register_op_id' FROM jsonb_array_elements(v_drained) d);
    END IF;
    IF v_burned IS DISTINCT FROM v_forfeit::numeric THEN
      RAISE EXCEPTION 'event % forfeit not retired from the entries (% of %)', ev.id, v_burned, v_forfeit;
    END IF;
    IF v_forfeit > 0 THEN
      SELECT COALESCE(balance,0) INTO v_before FROM public.ca_diamond_house WHERE id=1 FOR UPDATE;
      UPDATE public.ca_diamond_house SET balance=COALESCE(balance,0)+v_forfeit, updated_at=now() WHERE id=1 RETURNING balance INTO v_after;
      SELECT COALESCE(SUM(CASE WHEN action='mint' THEN amount ELSE -amount END),0) INTO v_supply FROM public.ca_mint_ledger WHERE asset='diamonds';
      INSERT INTO public.ca_mint_ledger
        (op_id, action, asset, holder_type, holder_id, holder_label, amount, balance_before, balance_after, supply_after, reason)
      VALUES
        (v_key, 'mint', 'diamonds', 'house', c_house, 'the house', v_forfeit, v_before, v_after, v_supply+v_forfeit,
         'Diamond tournament banks forfeited to the house by owner closure ('||COALESCE(t.name,'tournament')||'), 20261102150315');
      INSERT INTO public.poker_diamond_tournament_ledger(
        tournament_id, arena_id, user_id, custody_id, kind, amount, prize_part, bounty_part, fee_part, idempotency_key, request)
      VALUES (ev.id, t.club_id, NULL, NULL, 'forfeit', v_forfeit, ev.prize, ev.bounty, 0, v_key,
        jsonb_build_object('source','owner_forfeit_to_house','operation_id',c_op,'owner_instruction',c_instruction,'house_balance_after',v_after));
      PERFORM public.fn_ca_escrow_apply(ev.id, 'owner forfeit to the house', p_prize_out => ev.prize::numeric, p_bounty_out => ev.bounty::numeric);
    END IF;
    SELECT * INTO e FROM public.fn_poker_diamond_tournament_escrow(ev.id);
    IF e.prize_balance <> 0 OR e.bounty_balance <> 0 OR e.fee_balance <> ev.fee
       OR public.fn_poker_diamond_tournament_custody(ev.id) <> ev.fee THEN
      RAISE EXCEPTION 'event % banks after the forfeit: prize %, bounty %, fee %', ev.id, e.prize_balance, e.bounty_balance, e.fee_balance;
    END IF;

    -- Fee bank to the house and custody released, through the terminal fee door.
    UPDATE public.tournaments SET status='COMPLETING', current_players=0 WHERE id=ev.id;
    v_rake := public.fn_settle_tournament_rake(ev.id, 'owner_forfeit_to_house');
    IF v_rake->>'ok' IS DISTINCT FROM 'true' OR v_rake->>'attributed' IS DISTINCT FROM 'true'
       OR COALESCE((v_rake->>'amount')::numeric,-1) <> ev.fee OR COALESCE(v_rake->>'custody_still_held','x') <> '0' THEN
      RAISE EXCEPTION 'event % fee settlement incomplete: %', ev.id, v_rake;
    END IF;
    IF EXISTS (SELECT 1 FROM public.poker_diamond_custody c WHERE c.purpose='tournament_entry' AND c.target_id=ev.id AND c.state<>'released') THEN
      RAISE EXCEPTION 'event % custody rows not all released', ev.id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tournament_escrow x WHERE x.tournament_id=ev.id AND x.enforced AND x.closed_at IS NULL
                   AND x.prize_balance=0 AND x.bounty_balance=0 AND x.fee_balance=0) THEN
      RAISE EXCEPTION 'event % escrow is not exact zero: %', ev.id, (SELECT to_jsonb(x) FROM public.tournament_escrow x WHERE x.tournament_id=ev.id);
    END IF;

    -- Terminal state.
    v_settled := clock_timestamp();
    SELECT COALESCE(array_agg(id ORDER BY id),'{}') INTO v_players FROM public.tournament_players WHERE tournament_id=ev.id;
    SELECT COALESCE(array_agg(id ORDER BY id),'{}') INTO v_tables FROM public.tables WHERE tournament_id=ev.id;
    SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}') INTO v_seats FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=ev.id;
    SELECT COALESCE(array_agg(s.id ORDER BY s.id),'{}') INTO v_released FROM public.table_seats s JOIN public.tables tb ON tb.id=s.table_id WHERE tb.tournament_id=ev.id AND s.left_at IS NULL;
    UPDATE public.tournament_escrow SET closed_at=v_settled, close_note=c_note, updated_at=now() WHERE tournament_id=ev.id;
    UPDATE public.tournament_players SET status='eliminated', chips=0, current_bounty=0 WHERE tournament_id=ev.id AND status::text<>'eliminated';
    IF EXISTS (SELECT 1 FROM public.tournament_players WHERE tournament_id=ev.id AND (status::text<>'eliminated' OR chips IS DISTINCT FROM 0 OR current_bounty IS DISTINCT FROM 0)) THEN
      RAISE EXCEPTION 'event % roster retirement incomplete', ev.id;
    END IF;
    UPDATE public.table_seats s SET left_at=COALESCE(s.left_at,v_settled), status='left', stack=0, leave_pending=false, is_sitting_out=false,
           is_away=false, sit_out_at=NULL, scheduled_leave_hands=NULL
      FROM public.tables tb WHERE tb.id=s.table_id AND tb.tournament_id=ev.id;
    UPDATE public.tournaments SET status='CANCELLED', ended_at=v_settled, updated_at=now(), prize_pool=0, bounty_pool=0,
           total_rake=t.total_rake, current_players=0, on_break=false, break_started_at=NULL, break_ends_at=NULL WHERE id=ev.id;
    UPDATE public.tables SET status='closed', lifecycle='closed', current_players=0, terminal_closed_at=v_settled, updated_at=now() WHERE tournament_id=ev.id;

    v_receipt := jsonb_build_object('ok',true,'success',true,'fully_settled',true,'receipt_version',5,'mode','started_owner_forfeit_to_house',
      'operation_id',c_op,'tournament_id',ev.id,'actor_id',c_actor,'status','CANCELLED','owner_instruction',c_instruction,
      'source_player_count',cardinality(v_players),'refunded_count',0,'refund_line_count',0,'ticket_return_count',0,'ticket_returns','[]'::jsonb,
      'total_ticket_returned',0,'total_refunded',0,'fees_reversed',0,'refunds','[]'::jsonb,
      'closed_table_count',cardinality(v_tables),'source_seat_count',cardinality(v_seats),'released_seat_count',cardinality(v_released),
      'settled_at',v_settled,'original_started_at',t.started_at,
      'forfeited_to_house',v_forfeit,'forfeited_prize',ev.prize,'forfeited_bounty',ev.bounty,'fee_to_house',ev.fee,
      'diamonds_to_house',v_forfeit+ev.fee,'fee_receipt',v_rake,
      'prior_awards',(SELECT COALESCE(sum(amount),0) FROM public.poker_diamond_tournament_ledger l WHERE l.tournament_id=ev.id AND l.kind IN ('prize','bounty')));
    INSERT INTO public.tournament_cancellation_receipts(tournament_id,actor_id,receipt_version,source_player_count,source_player_ids,refunded_count,
      refunded_registration_ids,refund_line_count,ticket_return_count,ticket_return_ids,total_ticket_returned,zero_refund_count,zero_refund_registration_ids,
      total_refunded,fees_reversed,total_rake_before,total_rake_after,closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,
      released_seat_count,released_seat_ids,fee_reversal_ids,escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,receipt,settled_at)
    VALUES (ev.id,c_actor,5,cardinality(v_players),v_players,0,'{}',0,0,'{}',0,cardinality(v_players),v_players,
      0,0,COALESCE(t.total_rake,0),COALESCE(t.total_rake,0),cardinality(v_tables),v_tables,cardinality(v_seats),v_seats,
      cardinality(v_released),v_released,'{}',v_settled,c_note,NULL,v_receipt,v_settled);
    PERFORM public.fn_ca_tournament_cancellation_receipt(ev.id, c_actor);

    v_tot_forfeit := v_tot_forfeit + v_forfeit;
    v_tot_fee := v_tot_fee + ev.fee;
    v_n := v_n + 1;
  END LOOP;

  IF v_n <> 15 OR v_tot_forfeit <> 402570 OR v_tot_fee <> 25642 THEN
    RAISE EXCEPTION 'closed % events, forfeit %, fee % (expected 15, 402570, 25642)', v_n, v_tot_forfeit, v_tot_fee;
  END IF;
  IF (SELECT balance FROM public.ca_diamond_house WHERE id=1) - v_house0 <> 428212 THEN
    RAISE EXCEPTION 'the house moved by % (expected 428212)', (SELECT balance FROM public.ca_diamond_house WHERE id=1) - v_house0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.poker_diamond_custody c WHERE c.purpose='tournament_entry' AND c.state<>'released'
             AND c.target_id IN (SELECT h.tournament_id FROM public.tournament_cancellation_receipts h WHERE h.receipt_version=5)) THEN
    RAISE EXCEPTION 'Diamonds remain in custody for a closed event';
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM public.fn_log_admin_action(c_actor, 'diamond.owner_forfeit_to_house', 'tournament', 'fifteen_frozen_diamond_events',
    jsonb_build_object('events',15,'forfeited_to_house',v_tot_forfeit,'fee_to_house',v_tot_fee,'diamonds_to_house',428212,
                       'operation_id',c_op,'migration','20261102150315','owner_instruction',c_instruction));
END $close$;

COMMIT;
