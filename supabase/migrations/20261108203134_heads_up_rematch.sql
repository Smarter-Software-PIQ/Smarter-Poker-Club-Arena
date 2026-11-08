-- 20261108203134_heads_up_rematch.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- HEADS UP REMATCH (Dan, 2026-11-08, verbatim): "WHEN PLAYERS ARE PLAYING
-- 'HEADS UP' WHEN THE MATCH IS OVER, THEY SHOULD BOTH RECEIVE A 'PLAY AGAIN'
-- POP UP, AND IF BOTH PLAYERS AGREE, THE MATCH STARTS AGAIN. THEY BOTH 'BUY
-- BACK IN' RAKE IS TAKEN AND THE MATCH STARTS BACK OVER AT THE START OF THE
-- HEADS UP."
--
-- WHAT THIS CHANGES:
--
--   1. public.ca_heads_up_rematches - one row per finished heads-up game whose
--      players were offered a rematch. Private by RLS (a participant may read
--      its own row, nobody writes directly). NO FOREIGN KEY to tournaments or
--      tables (CLAUDE.md section 2 rule 7): an orphan row here is harmless, a
--      SHARE ROW EXCLUSIVE on a hot table is not.
--
--   2. ca_heads_up_rematch_respond(source, accept) and
--      ca_heads_up_rematch_state(source) - the two doors the result card uses.
--      Both delegate to fn_ca_heads_up_rematch_core, which no browser role can
--      execute. When both players have accepted, the core picks an EMPTY
--      REGISTERING sibling game (same club, union, buy-in, fee, game type,
--      variant, format, satellite target, two seats, no live seat, no
--      registrant, not reserved by another rematch) and reserves its table for
--      the two of them for 60 seconds.
--
--   3. NO MONEY MOVES HERE. The rematch never registers, charges or seats
--      anybody. Each player buys back in through the existing seat-first
--      purchase, fn_take_seat_and_buy_in, which charges buy-in + fee (the rake)
--      exactly as the first game did (CLAUDE.md 10.9 rule 2). A horse opponent
--      buys back in through its existing door, fn_seat_horse_in_seat_first_game,
--      on the same terms (10.5).
--
--   4. THE RESERVATION. The two seat doors - fn_take_seat_and_buy_in (people)
--      and fn_seat_horse_in_seat_first_game (horses) - are re-declared with
--      their bodies byte-for-byte as production holds them today and ONE
--      read-only check first: while a rematch reservation on that table (or
--      tournament) is unexpired, only the two reserved players may take a seat;
--      anyone else is answered {ok:false, reason:'seat_reserved'}. The check
--      takes no lock and changes nothing after the reservation lapses.
--
-- HORSES (CLAUDE.md 10.5). A horse opponent answers a rematch the way a person
-- would: it says yes. It may ask first (4-20 s after the match ended), so the
-- person sees "Your Opponent Wants To Play Again" from a horse as from anyone;
-- if the person asked first it answers 2-8 s later. Both moments are fixed per
-- game from its id, so every read agrees. Nothing returned to a browser says
-- whether the opponent is a horse. is_horse is read only as the horse's input
-- device - the one legitimate horse branch.
--
-- NOT A SWEEPER (10.11, 10.12). No cron, no repair, no back-fill. Every
-- deadline here is evaluated on read: a lapsed answer window reads 'expired'
-- and a lapsed reservation simply stops refusing other players.
--
-- DEADLINES AND THE FREEZE (section 13 invariant 4). The answer window (60 s)
-- and the reservation (60 s) cannot be eaten by the daily 04:00 freeze: no
-- rematch is matched while entries are frozen or while the daily window closes
-- Spins and Sit & Gos (fn_daily_window_entry_refusal answers from 03:00 to
-- 06:00 Chicago, which contains the 04:00-04:05 freeze), so there is no live
-- rematch deadline for fn_thaw_platform to thaw.

BEGIN;

SET LOCAL lock_timeout = '1s';

CREATE TABLE IF NOT EXISTS public.ca_heads_up_rematches (
  source_tournament_id uuid PRIMARY KEY,
  player_ids uuid[] NOT NULL CHECK (cardinality(player_ids) = 2),
  accepted_by uuid[] NOT NULL DEFAULT '{}'::uuid[],
  accepted_at jsonb NOT NULL DEFAULT '{}'::jsonb,
  declined_by uuid,
  respond_by timestamptz NOT NULL,
  outcome text CHECK (outcome IN ('matched', 'no_open_game')),
  no_game_since timestamptz,
  target_tournament_id uuid,
  target_table_id uuid,
  seats jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_at timestamptz,
  reserved_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ca_heads_up_rematches IS
  'Heads-up rematch offers (Dan 2026-11-08). No FK to hot tables by design (CLAUDE.md section 2 rule 7). Written only by fn_ca_heads_up_rematch_core; deadlines are evaluated on read, never swept.';

CREATE INDEX IF NOT EXISTS idx_ca_heads_up_rematches_target_table
  ON public.ca_heads_up_rematches (target_table_id)
  WHERE target_table_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ca_heads_up_rematches_target_tournament
  ON public.ca_heads_up_rematches (target_tournament_id)
  WHERE target_tournament_id IS NOT NULL;

ALTER TABLE public.ca_heads_up_rematches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ca_heads_up_rematches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ca_heads_up_rematches TO authenticated;

DROP POLICY IF EXISTS ca_heads_up_rematches_participant_reads ON public.ca_heads_up_rematches;
CREATE POLICY ca_heads_up_rematches_participant_reads
  ON public.ca_heads_up_rematches
  FOR SELECT TO authenticated
  USING (auth.uid() = ANY (player_ids));

-- ── The core: the only writer of the table ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ca_heads_up_rematch_core(
  p_source_tournament_id uuid,
  p_uid uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '10s'
AS $function$
DECLARE
  v_now        timestamptz := clock_timestamp();
  v_src        record;
  v_players    uuid[];
  v_distinct   integer;
  v_row        public.ca_heads_up_rematches%ROWTYPE;
  v_first      timestamptz;
  v_horse      uuid;
  v_horse_asks_at timestamptz;
  v_jitter     interval;
  v_refusal    text;
  v_target     uuid;
  v_table      uuid;
  v_status     text;
  v_seat       integer;
  v_last_call  timestamptz;
BEGIN
  IF p_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_eligible', 'reason', 'not_signed_in');
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'read') THEN
    RAISE EXCEPTION 'fn_ca_heads_up_rematch_core: unknown action %', p_action
      USING ERRCODE = '22023';
  END IF;

  -- The game that just finished: a completed two-seat Sit & Go (heads-up).
  SELECT t.id, t.status, t.ended_at, t.club_id, t.union_id, t.buy_in_amount,
         t.buy_in_fee, t.game_type, t.variant, t.format_contract, t.max_players,
         t.satellite_target_id, t.satellite_target, t.free_buy
    INTO v_src
    FROM public.tournaments t
   WHERE t.id = p_source_tournament_id;
  IF NOT FOUND
     OR upper(COALESCE(v_src.status, '')) <> 'COMPLETED'
     OR v_src.format_contract IS DISTINCT FROM 'sng-v1'
     OR v_src.max_players IS DISTINCT FROM 2
     OR v_src.ended_at IS NULL THEN
    RETURN jsonb_build_object('status', 'not_eligible');
  END IF;

  -- Exactly two entrants, and the caller is one of them. The winner is seat 1.
  SELECT array_agg(tp.user_id ORDER BY tp.position NULLS LAST, tp.user_id),
         count(DISTINCT tp.user_id)
    INTO v_players, v_distinct
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_source_tournament_id
     AND tp.user_id IS NOT NULL;
  IF v_distinct IS DISTINCT FROM 2 OR cardinality(v_players) IS DISTINCT FROM 2
     OR NOT (p_uid = ANY (v_players)) THEN
    RETURN jsonb_build_object('status', 'not_eligible');
  END IF;

  v_last_call := v_src.ended_at + interval '3 minutes';

  /* THE HORSE'S INPUT DEVICE (CLAUDE.md 10.5). A horse has no card to tap, so
     this answers for it, the way a person would: it says yes. It may be the
     first to ask - a person is asked by a horse exactly as often and as
     soon as by anyone - at a moment fixed per game, 4 to 20 seconds after
     the match ended; and when the person asked first, it answers 2 to 8
     seconds later, never on the same instant. Nothing returned says which
     kind of player answered. */
  SELECT h.id INTO v_horse
    FROM public.profiles h
   WHERE h.id = ANY (v_players) AND h.id <> p_uid AND h.is_horse IS TRUE;
  v_horse_asks_at := v_src.ended_at
    + make_interval(secs => 4 + abs(hashtext(p_source_tournament_id::text || ':rematch-ask')) % 17);
  v_jitter := make_interval(secs => 2 + abs(hashtext(p_source_tournament_id::text || ':rematch-answer')) % 7);

  SELECT * INTO v_row
    FROM public.ca_heads_up_rematches r
   WHERE r.source_tournament_id = p_source_tournament_id
   FOR UPDATE;

  IF NOT FOUND THEN
    IF v_now >= v_last_call THEN
      RETURN jsonb_build_object('status', 'expired', 'respond_by', v_last_call);
    END IF;
    IF p_action = 'read' AND (v_horse IS NULL OR v_now < v_horse_asks_at) THEN
      -- Nobody has asked yet.
      RETURN jsonb_build_object('status', 'none', 'respond_by', v_last_call,
        'seconds_left', GREATEST(0, ceil(extract(epoch FROM v_last_call - v_now)))::integer);
    END IF;
    INSERT INTO public.ca_heads_up_rematches (source_tournament_id, player_ids, respond_by)
    VALUES (p_source_tournament_id, v_players, LEAST(v_last_call, v_now + interval '60 seconds'))
    ON CONFLICT (source_tournament_id) DO NOTHING;
    SELECT * INTO v_row
      FROM public.ca_heads_up_rematches r
     WHERE r.source_tournament_id = p_source_tournament_id
     FOR UPDATE;
  END IF;

  -- ── Record this answer, and the horse's ──────────────────────────────
  IF v_row.outcome IS NULL AND v_row.declined_by IS NULL AND v_now < v_row.respond_by THEN
    IF p_action = 'accept' AND NOT (p_uid = ANY (v_row.accepted_by)) THEN
      v_row.accepted_by := array_append(v_row.accepted_by, p_uid);
      v_row.accepted_at := v_row.accepted_at || jsonb_build_object(p_uid::text, v_now);
    ELSIF p_action = 'decline' THEN
      v_row.declined_by := p_uid;
    END IF;

    IF v_row.declined_by IS NULL AND v_horse IS NOT NULL
       AND v_horse = ANY (v_row.player_ids)
       AND NOT (v_horse = ANY (v_row.accepted_by)) THEN
      SELECT min((value #>> '{}')::timestamptz) INTO v_first
        FROM jsonb_each(v_row.accepted_at);
      IF (v_first IS NULL AND v_now >= v_horse_asks_at)
         OR (v_first IS NOT NULL AND v_now >= v_first + v_jitter) THEN
        v_row.accepted_by := array_append(v_row.accepted_by, v_horse);
        v_row.accepted_at := v_row.accepted_at || jsonb_build_object(v_horse::text, v_now);
      END IF;
    END IF;

    -- ── Both said yes: find the empty game and hold its table ───────────
    IF v_row.declined_by IS NULL AND cardinality(v_row.accepted_by) = 2 THEN
      v_refusal := CASE WHEN public.fn_entry_purchases_frozen() THEN 'platform_frozen'
                        ELSE public.fn_daily_window_entry_refusal(p_source_tournament_id) END;
      IF v_refusal IS NULL THEN
        -- Two rematches never hold the same game: one chooser at a time
        -- (milliseconds), and a game mid-purchase is skipped, never waited on.
        PERFORM pg_advisory_xact_lock(hashtext('ca_heads_up_rematch_target'));
        SELECT t.id INTO v_target
          FROM public.tournaments t
         WHERE t.status = 'REGISTERING'
           AND t.id <> p_source_tournament_id
           AND t.format_contract = 'sng-v1'
           AND t.max_players = 2
           AND t.club_id IS NOT DISTINCT FROM v_src.club_id
           AND t.union_id IS NOT DISTINCT FROM v_src.union_id
           AND t.buy_in_amount IS NOT DISTINCT FROM v_src.buy_in_amount
           AND t.buy_in_fee IS NOT DISTINCT FROM v_src.buy_in_fee
           AND t.game_type IS NOT DISTINCT FROM v_src.game_type
           AND t.variant IS NOT DISTINCT FROM v_src.variant
           AND t.satellite_target_id IS NOT DISTINCT FROM v_src.satellite_target_id
           AND t.satellite_target IS NOT DISTINCT FROM v_src.satellite_target
           AND t.free_buy IS NOT DISTINCT FROM v_src.free_buy
           AND COALESCE(t.prize_pool_finalized, false) = false
           AND EXISTS (SELECT 1 FROM public.tables tb
                        WHERE tb.tournament_id = t.id
                          AND lower(COALESCE(tb.status, '')) <> 'closed')
           AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                             JOIN public.tables tb ON tb.id = s.table_id
                            WHERE tb.tournament_id = t.id AND s.left_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM public.tournament_players tp
                            WHERE tp.tournament_id = t.id
                              AND tp.status IN ('registered', 'playing'))
           AND NOT EXISTS (SELECT 1 FROM public.ca_heads_up_rematches o
                            WHERE o.target_tournament_id = t.id
                              AND o.reserved_until > v_now)
         ORDER BY (t.start_time > v_now) DESC NULLS LAST, t.created_at ASC
         LIMIT 1
         FOR UPDATE OF t SKIP LOCKED;

        IF v_target IS NOT NULL THEN
          v_table := public.fn_tournament_primary_table(v_target);
        END IF;

        IF v_target IS NOT NULL AND v_table IS NOT NULL THEN
          v_row.outcome := 'matched';
          v_row.target_tournament_id := v_target;
          v_row.target_table_id := v_table;
          v_row.seats := jsonb_build_object(v_row.player_ids[1]::text, 1,
                                            v_row.player_ids[2]::text, 2);
          v_row.matched_at := v_now;
          v_row.reserved_until := v_now + interval '60 seconds';
        ELSE
          -- The recycler replaces games continuously; look again for a few
          -- seconds before saying there is none.
          v_row.no_game_since := COALESCE(v_row.no_game_since, v_now);
          IF v_now >= v_row.no_game_since + interval '8 seconds' THEN
            v_row.outcome := 'no_open_game';
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF p_action = 'decline' AND v_row.declined_by IS NULL THEN
    -- Matched or lapsed: the caller is leaving. The opponent keeps the table
    -- it was given, but the hold ends now - a seat nobody will take back must
    -- not be kept from everybody else for the rest of the minute.
    v_row.declined_by := p_uid;
    IF v_row.reserved_until > v_now THEN
      v_row.reserved_until := v_now;
    END IF;
  END IF;

  UPDATE public.ca_heads_up_rematches r
     SET accepted_by = v_row.accepted_by,
         accepted_at = v_row.accepted_at,
         declined_by = v_row.declined_by,
         outcome = v_row.outcome,
         no_game_since = v_row.no_game_since,
         target_tournament_id = v_row.target_tournament_id,
         target_table_id = v_row.target_table_id,
         seats = v_row.seats,
         matched_at = v_row.matched_at,
         reserved_until = v_row.reserved_until
   WHERE r.source_tournament_id = p_source_tournament_id
     AND (r.accepted_by, r.accepted_at, r.declined_by, r.outcome, r.no_game_since,
          r.target_tournament_id, r.target_table_id, r.seats, r.matched_at, r.reserved_until)
         IS DISTINCT FROM
         (v_row.accepted_by, v_row.accepted_at, v_row.declined_by, v_row.outcome, v_row.no_game_since,
          v_row.target_tournament_id, v_row.target_table_id, v_row.seats, v_row.matched_at, v_row.reserved_until);

  -- ── What this caller sees ────────────────────────────────────────────
  IF v_row.declined_by = p_uid THEN
    RETURN jsonb_build_object('status', 'you_declined');
  END IF;
  IF v_row.outcome = 'matched' THEN
    v_seat := (v_row.seats ->> p_uid::text)::integer;
    RETURN jsonb_build_object(
      'status', 'matched',
      'table_id', v_row.target_table_id,
      'seat_number', v_seat,
      'reserved_until', v_row.reserved_until);
  END IF;
  IF v_row.outcome = 'no_open_game' THEN
    RETURN jsonb_build_object('status', 'no_open_game');
  END IF;
  IF v_row.declined_by IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'opponent_declined');
  END IF;
  IF v_now >= v_row.respond_by THEN
    RETURN jsonb_build_object('status', 'expired', 'respond_by', v_row.respond_by);
  END IF;
  IF cardinality(v_row.accepted_by) = 2 THEN
    IF v_refusal IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'entries_closed', 'reason', v_refusal);
    END IF;
    v_status := 'finding_table';
  ELSIF p_uid = ANY (v_row.accepted_by) THEN
    v_status := 'waiting_for_opponent';
  ELSIF cardinality(v_row.accepted_by) > 0 THEN
    v_status := 'waiting_for_you';
  ELSE
    v_status := 'none';
  END IF;
  -- The countdown is the server's, so a device clock cannot shorten it.
  RETURN jsonb_build_object('status', v_status, 'respond_by', v_row.respond_by,
    'seconds_left', GREATEST(0, ceil(extract(epoch FROM v_row.respond_by - v_now)))::integer);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_heads_up_rematch_core(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── The two browser doors ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ca_heads_up_rematch_respond(
  p_source_tournament_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ca_heads_up_rematch_respond requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
  RETURN public.fn_ca_heads_up_rematch_core(
    p_source_tournament_id, auth.uid(),
    CASE WHEN p_accept IS TRUE THEN 'accept' ELSE 'decline' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ca_heads_up_rematch_state(p_source_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
SET statement_timeout TO '10s'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ca_heads_up_rematch_state requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;
  -- A read that may complete a pending match (the opponent's answer or the
  -- table search lands here); it never charges, registers or seats anyone.
  RETURN public.fn_ca_heads_up_rematch_core(p_source_tournament_id, auth.uid(), 'read');
END;
$function$;

REVOKE ALL ON FUNCTION public.ca_heads_up_rematch_respond(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ca_heads_up_rematch_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_heads_up_rematch_respond(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ca_heads_up_rematch_state(uuid) TO authenticated;

-- ── The person's seat door: the reservation check, then the body unchanged ─
CREATE OR REPLACE FUNCTION public.fn_take_seat_and_buy_in(p_table_id uuid, p_seat_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_gate jsonb;
BEGIN
  -- HEADS UP REMATCH (20261108203134): a table held for a rematch seats only
  -- its two players until the hold lapses. Read-only, no lock.
  IF EXISTS (
    SELECT 1 FROM public.ca_heads_up_rematches r
     WHERE r.target_table_id = p_table_id
       AND r.reserved_until > clock_timestamp()
       AND NOT (r.seats ? COALESCE(auth.uid()::text, ''))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'seat_reserved');
  END IF;
  v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
    NULL,p_table_id,auth.uid());
  IF COALESCE((v_gate->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN v_gate;
  END IF;
  RETURN public.fn_take_seat_and_buy_in_before_terminal_seat_gate(
    p_table_id,p_seat_number);
END;
$function$;

-- Production's grants for the person's door (read 2026-11-08), restated.
REVOKE ALL ON FUNCTION public.fn_take_seat_and_buy_in(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_take_seat_and_buy_in(uuid, integer) TO authenticated, service_role;

-- ── The horse's seat door: the same check, then the body unchanged ────────
CREATE OR REPLACE FUNCTION public.fn_seat_horse_in_seat_first_game(p_tournament_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_gate jsonb;
  v_status text;
  v_finalized boolean;
BEGIN
  -- HEADS UP REMATCH (20261108203134): identical to the person's door (10.5).
  IF EXISTS (
    SELECT 1 FROM public.ca_heads_up_rematches r
     WHERE r.target_tournament_id = p_tournament_id
       AND r.reserved_until > clock_timestamp()
       AND NOT (r.seats ? COALESCE(p_user_id::text, ''))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'seat_reserved');
  END IF;
  v_gate:=public.fn_ca_lock_tournament_seat_acquisition(
    p_tournament_id,NULL,p_user_id);
  IF COALESCE((v_gate->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN v_gate;
  END IF;


  -- A horse's purchase choice, not a human/platform capacity rule. Four
  -- unresolved tournament promises are enough when their duration is unknown.
  -- Paid target entries/chairs are honoured without making another purchase.
  IF EXISTS (SELECT 1 FROM public.profiles h WHERE h.id=p_user_id AND h.is_horse IS TRUE)
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_players paid
        WHERE paid.user_id=p_user_id AND paid.tournament_id=p_tournament_id
          AND paid.status IN ('registered','playing')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.table_seats paid_seat
         JOIN public.tables paid_table ON paid_table.id=paid_seat.table_id
        WHERE paid_seat.user_id=p_user_id AND paid_seat.left_at IS NULL
          AND paid_table.tournament_id=p_tournament_id
          AND paid_table.status <> 'closed'
          AND paid_seat.table_id=public.fn_tournament_primary_table(p_tournament_id)
     )
     AND (SELECT count(DISTINCT promise.tournament_id)
            FROM public.tournament_players promise
            JOIN public.tournaments promised ON promised.id=promise.tournament_id
           WHERE promise.user_id=p_user_id
             AND promise.status IN ('registered','playing')
             AND upper(COALESCE(promised.status,'')) NOT IN ('COMPLETING','COMPLETED','CANCELLED')) >= 4 THEN
    RETURN jsonb_build_object('ok',false,'reason','horse_tournament_reservation_budget');
  END IF;

  -- The canonical parent lock serializes this decision with launch/finalization.
  -- Existing live-chair replay still reaches the original read-only delegate.
  -- Like the human door, only ANNOUNCED/REGISTERING may acquire a fresh chair;
  -- launch need not have finalized the entry pool. NULL/unknown status refuses.
  SELECT t.status,t.prize_pool_finalized INTO v_status,v_finalized
    FROM public.tournaments t WHERE t.id=p_tournament_id;
  IF NOT EXISTS (
       SELECT 1 FROM public.table_seats s
        WHERE s.table_id=public.fn_tournament_primary_table(p_tournament_id)
          AND s.user_id=p_user_id AND s.left_at IS NULL
     ) THEN
    IF (v_status IN ('ANNOUNCED','REGISTERING')) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok',false,'reason','game_already_started');
    END IF;
    IF v_finalized IS TRUE THEN
      RETURN jsonb_build_object('ok',false,'reason','registration_closed');
    END IF;
  END IF;

  RETURN public.fn_seat_horse_in_seat_first_game_before_terminal_seat_gate(
    p_tournament_id,p_user_id);
END;
$function$;

-- The grants production already holds for the horse door (postgres and
-- service_role only, read 2026-11-08), stated so the re-declaration cannot
-- reopen it. CREATE OR REPLACE keeps existing grants; this only says so.
REVOKE ALL ON FUNCTION public.fn_seat_horse_in_seat_first_game(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seat_horse_in_seat_first_game(uuid, uuid) TO service_role;

COMMIT;
