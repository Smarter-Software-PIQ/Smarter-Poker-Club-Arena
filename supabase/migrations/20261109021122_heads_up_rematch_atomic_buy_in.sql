-- 20261109021122_heads_up_rematch_atomic_buy_in.sql
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
-- The owner's acceptance rules for the buy-back-in (2026-11-08):
--   1. both players accept before either is charged;
--   2. each is charged exactly once, through the normal buy-in path;
--   3. both reach the same fresh table;
--   4. a decline, a timeout, insufficient funds, a repeat tap or two
--      simultaneous accepts leaves no partial charge and no duplicate game.
--
-- WHAT THIS CHANGES:
--
--   1. public.ca_heads_up_rematches: one row per finished heads-up game whose
--      players were offered a rematch. Private by RLS (a participant reads its
--      own row; nobody writes it directly). NO FOREIGN KEY to tournaments or
--      tables (CLAUDE.md section 2 rule 7).
--
--   2. THE BUY-BACK-IN IS ONE TRANSACTION. The acceptance that makes it two
--      (a player's tap, or the poll on which a horse opponent answers) buys
--      BOTH seats in the same transaction, inside one subtransaction: if
--      either purchase is refused or raises, both are undone together and
--      nobody is charged. Repeat taps and simultaneous accepts serialize on
--      the rematch row (FOR UPDATE); the purchase runs only on the one
--      transition from "both accepted, no outcome" to an outcome, so it can
--      happen at most once per finished game.
--
--   3. THE NORMAL BUY-IN PATH, FOR A NAMED PAYER. A person's seat purchase
--      (fn_take_seat_and_buy_in and the seven layers under it) takes its payer
--      from auth.uid(), so one transaction could only ever charge the caller.
--      This migration reads those eight production bodies, checks each
--      against the md5 it was reviewed at, and installs a copy of each under a
--      fn_ca_rematch_* name whose ONLY differences are: the payer is a
--      parameter instead of auth.uid(), each layer calls the next layer's
--      copy, and the two "is this browser session live" checks are dropped
--      (see 4). Every charge, ledger row, fee split, paying-club choice, lock,
--      freeze check, daily window and seat rule is the production text, byte
--      for byte. The copies are executable by NO browser or service role;
--      only the rematch core (SECURITY DEFINER, owner postgres) reaches them.
--      A horse opponent is charged through its own existing door,
--      fn_seat_horse_in_seat_first_game, exactly as in its first game (10.5).
--
--   4. A DEAD SESSION MOVES NO MONEY (Dan 2026-09-03). Both browser doors
--      refuse a signed-out session. A person is charged only after accepting
--      through that door with a live session inside the 60 s answer window.
--
--   5. NO DRIFT. ca_heads_up_rematch_sources records the md5 of each source
--      body. If any source changes after this installs, the rematch refuses
--      with 'unavailable' before any purchase (nobody is charged), until a
--      migration re-derives the copies from the new bodies.
--
-- HORSES (CLAUDE.md 10.5). A horse opponent answers the way a person would:
-- it says yes. It may ask first (4-20 s after the match ended); if the person
-- asked first it answers 2-8 s later. Nothing returned to a browser says
-- whether the opponent is a horse. is_horse is read only as the horse's input
-- device. The horse is seated by its own seat door in the same transaction, so
-- the same horse is the opponent and no engine change is needed.
--
-- NOT A SWEEPER (10.11, 10.12). No cron, no repair, no back-fill. Deadlines are
-- evaluated on read: a lapsed answer window reads 'expired' and nobody was
-- charged.
--
-- DEADLINES AND THE FREEZE (section 13 invariant 4). Nothing is matched while
-- entries are frozen or while the daily window closes Sit & Gos (03:00-06:00
-- Chicago, containing the 04:00-04:05 freeze), so no rematch deadline can be
-- eaten by the freeze and there is nothing for fn_thaw_platform to thaw.
--
-- @live-proof: (to_regclass('public.ca_heads_up_rematches') IS NOT NULL AND to_regprocedure('public.ca_heads_up_rematch_respond(uuid,boolean)') IS NOT NULL AND to_regprocedure('public.fn_ca_rematch_take_seat_for_payer(uuid,integer,uuid)') IS NOT NULL AND NOT has_function_privilege('authenticated', 'public.fn_ca_rematch_take_seat_for_payer(uuid,integer,uuid)', 'EXECUTE') AND NOT EXISTS (SELECT 1 FROM public.ca_heads_up_rematch_sources s WHERE md5(pg_get_functiondef(s.source::regprocedure)) IS DISTINCT FROM s.source_md5))

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- ── 1. The agreement rows ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ca_heads_up_rematches (
  source_tournament_id uuid PRIMARY KEY,
  player_ids uuid[] NOT NULL CHECK (cardinality(player_ids) = 2),
  accepted_by uuid[] NOT NULL DEFAULT '{}'::uuid[],
  accepted_at jsonb NOT NULL DEFAULT '{}'::jsonb,
  declined_by uuid,
  respond_by timestamptz NOT NULL,
  outcome text CHECK (outcome IN ('matched', 'no_open_game', 'buy_in_refused', 'unavailable')),
  no_game_since timestamptz,
  target_tournament_id uuid,
  target_table_id uuid,
  seats jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipts jsonb NOT NULL DEFAULT '[]'::jsonb,
  refused_by uuid,
  refused_reason text,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ca_heads_up_rematches IS
  'Heads-up rematch offers (Dan 2026-11-08). No FK to hot tables by design (CLAUDE.md section 2 rule 7). Written only by fn_ca_heads_up_rematch_core; both buy-ins commit together or not at all; deadlines are evaluated on read, never swept.';

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

-- ── 2. The reviewed source bodies (the drift interlock reads these) ───────
CREATE TABLE IF NOT EXISTS public.ca_heads_up_rematch_sources (
  source text PRIMARY KEY,
  source_md5 text NOT NULL,
  derived text NOT NULL
);
COMMENT ON TABLE public.ca_heads_up_rematch_sources IS
  'The production buy-in layers the heads-up rematch copies for a named payer, and the md5 each was copied from. A source whose body no longer matches makes the rematch answer unavailable before any purchase.';
ALTER TABLE public.ca_heads_up_rematch_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_heads_up_rematch_sources FROM PUBLIC, anon, authenticated;

DELETE FROM public.ca_heads_up_rematch_sources;
INSERT INTO public.ca_heads_up_rematch_sources (source, source_md5, derived) VALUES
  ('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)', 'fd5e622d7edfbcb3e61938d57b8eb0c2', 'public.fn_ca_rematch_register_core_for_payer(uuid,boolean,uuid)'),
  ('public.fn_register_for_tournament_before_atomic_lifecycle_gate(uuid,boolean)',   '1f5b646bfa52cafa0c3a678324cf3e56', 'public.fn_ca_rematch_register_lifecycle_for_payer(uuid,boolean,uuid)'),
  ('public.fn_register_for_tournament_before_maintenance_announcement_gate(uuid,boolean)', '8f5f2fb6976198a19f0a79fbcde4559b', 'public.fn_ca_rematch_register_maint_for_payer(uuid,boolean,uuid)'),
  ('public.fn_register_for_tournament_before_terminal_seat_gate(uuid,boolean)',      'e65fe889128c1ce4306b1236cb44484a', 'public.fn_ca_rematch_register_terminal_for_payer(uuid,boolean,uuid)'),
  ('public.fn_register_for_tournament(uuid,boolean)',                                '88dc44b7cb63b2bd845f89d672335b97', 'public.fn_ca_rematch_register_for_payer(uuid,boolean,uuid)'),
  ('public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(uuid,integer)', '67a6b85f00a785e22c4d89c6168253d3', 'public.fn_ca_rematch_seat_maint_for_payer(uuid,integer,uuid)'),
  ('public.fn_take_seat_and_buy_in_before_terminal_seat_gate(uuid,integer)',         'b22f559c1e388ed3564b8cad6fd801d6', 'public.fn_ca_rematch_seat_terminal_for_payer(uuid,integer,uuid)'),
  ('public.fn_take_seat_and_buy_in(uuid,integer)',                                   'a965493d4837187d433b3cdd40c5da81', 'public.fn_ca_rematch_take_seat_for_payer(uuid,integer,uuid)');

-- ── 3. The named-payer copies, derived from the production text ──────────
-- A patch helper for this transaction only: replace an anchor that must occur
-- exactly p_count times, or refuse the whole migration.
CREATE FUNCTION pg_temp.ca_rematch_swap(p_src text, p_anchor text, p_new text, p_count integer, p_label text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n integer;
BEGIN
  n := (length(p_src) - length(replace(p_src, p_anchor, ''))) / greatest(length(p_anchor), 1);
  IF n <> p_count THEN
    RAISE EXCEPTION 'heads_up_rematch_anchor_%: found % times, expected %', p_label, n, p_count
      USING ERRCODE = '55000';
  END IF;
  RETURN replace(p_src, p_anchor, p_new);
END $f$;

-- Reads one source, refuses unless it is the reviewed body.
CREATE FUNCTION pg_temp.ca_rematch_source(p_source text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v_def text; v_pin text;
BEGIN
  SELECT s.source_md5 INTO v_pin FROM public.ca_heads_up_rematch_sources s WHERE s.source = p_source;
  v_def := pg_get_functiondef(p_source::regprocedure);
  IF v_pin IS NULL OR md5(v_def) IS DISTINCT FROM v_pin THEN
    RAISE EXCEPTION 'heads_up_rematch_source_changed: % is not the body this migration was reviewed against', p_source
      USING ERRCODE = '55000';
  END IF;
  RETURN v_def;
END $f$;

-- Installs one copy: never a body that still reads auth.uid() or a live
-- session, and never one any browser or service role can execute.
CREATE FUNCTION pg_temp.ca_rematch_install(p_def text, p_signature text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF position('auth.uid()' IN p_def) > 0 THEN
    RAISE EXCEPTION 'heads_up_rematch_copy_reads_auth_uid: %', p_signature USING ERRCODE = '55000';
  END IF;
  -- The call, not the name: a source comment explains the check by name.
  IF position('public.fn_caller_session_is_live()' IN p_def) > 0 THEN
    RAISE EXCEPTION 'heads_up_rematch_copy_reads_the_caller_session: %', p_signature USING ERRCODE = '55000';
  END IF;
  EXECUTE p_def;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', p_signature);
END $f$;

DO $derive$
DECLARE d text;
BEGIN
  -- 3a. The registration core: the payer is a parameter.
  d := pg_temp.ca_rematch_source('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_atomic_capacity_20260907(p_tournament_id uuid, p_seat_first_internal boolean DEFAULT false)',
    'FUNCTION public.fn_ca_rematch_register_core_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'core_header');
  d := pg_temp.ca_rematch_swap(d,
    'v_uid uuid := auth.uid();',
    'v_uid uuid := p_payer; -- HEADS UP REMATCH: the consenting payer, not the caller',
    1, 'core_payer');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_register_core_for_payer(uuid,boolean,uuid)');

  -- 3b. The late-registration retry layer.
  d := pg_temp.ca_rematch_source('public.fn_register_for_tournament_before_atomic_lifecycle_gate(uuid,boolean)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_atomic_lifecycle_gate(p_tournament_id uuid, p_seat_first_internal boolean DEFAULT false)',
    'FUNCTION public.fn_ca_rematch_register_lifecycle_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'lifecycle_header');
  d := pg_temp.ca_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_atomic_capacity_20260907(
      p_tournament_id,p_seat_first_internal)$a$,
    $b$public.fn_ca_rematch_register_core_for_payer(
      p_tournament_id,p_seat_first_internal,p_payer)$b$,
    2, 'lifecycle_calls');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_register_lifecycle_for_payer(uuid,boolean,uuid)');

  -- 3c. The registration status gate.
  d := pg_temp.ca_rematch_source('public.fn_register_for_tournament_before_maintenance_announcement_gate(uuid,boolean)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_maintenance_announcement_gate(p_tournament_id uuid, p_seat_first_internal boolean)',
    'FUNCTION public.fn_ca_rematch_register_maint_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'maint_header');
  d := pg_temp.ca_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_atomic_lifecycle_gate(
    p_tournament_id,COALESCE(p_seat_first_internal,false))$a$,
    $b$public.fn_ca_rematch_register_lifecycle_for_payer(
    p_tournament_id,COALESCE(p_seat_first_internal,false),p_payer)$b$,
    1, 'maint_call');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_register_maint_for_payer(uuid,boolean,uuid)');

  -- 3d. The registration freeze gate.
  d := pg_temp.ca_rematch_source('public.fn_register_for_tournament_before_terminal_seat_gate(uuid,boolean)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament_before_terminal_seat_gate(p_tournament_id uuid, p_seat_first_internal boolean)',
    'FUNCTION public.fn_ca_rematch_register_terminal_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'terminal_header');
  d := pg_temp.ca_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_maintenance_announcement_gate(
    p_tournament_id, p_seat_first_internal
  )$a$,
    $b$public.fn_ca_rematch_register_maint_for_payer(
    p_tournament_id, p_seat_first_internal, p_payer
  )$b$,
    1, 'terminal_call');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_register_terminal_for_payer(uuid,boolean,uuid)');

  -- 3e. The registration door: the payer's own seat lock and paying club.
  d := pg_temp.ca_rematch_source('public.fn_register_for_tournament(uuid,boolean)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_register_for_tournament(p_tournament_id uuid, p_seat_first_internal boolean)',
    'FUNCTION public.fn_ca_rematch_register_for_payer(p_tournament_id uuid, p_seat_first_internal boolean, p_payer uuid)',
    1, 'register_header');
  d := pg_temp.ca_rematch_swap(d,
    $a$  IF public.fn_caller_session_is_live() IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE='28000';
  END IF;
$a$,
    $b$  -- HEADS UP REMATCH: the payer accepted through a live-session door.
$b$,
    1, 'register_session');
  d := pg_temp.ca_rematch_swap(d, 'auth.uid()', 'p_payer', 3, 'register_payer');
  d := pg_temp.ca_rematch_swap(d,
    $a$public.fn_register_for_tournament_before_terminal_seat_gate(
    p_tournament_id,p_seat_first_internal)$a$,
    $b$public.fn_ca_rematch_register_terminal_for_payer(
    p_tournament_id,p_seat_first_internal,p_payer)$b$,
    1, 'register_call');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_register_for_payer(uuid,boolean,uuid)');

  -- 3f. The seat purchase itself.
  d := pg_temp.ca_rematch_source('public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(uuid,integer)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(p_table_id uuid, p_seat_number integer)',
    'FUNCTION public.fn_ca_rematch_seat_maint_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)',
    1, 'seat_header');
  d := pg_temp.ca_rematch_swap(d,
    'v_uid        uuid := auth.uid();',
    'v_uid        uuid := p_payer; -- HEADS UP REMATCH: the consenting payer',
    1, 'seat_payer');
  d := pg_temp.ca_rematch_swap(d,
    $a$  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
$a$,
    $b$  -- HEADS UP REMATCH: the payer accepted through a live-session door.
$b$,
    1, 'seat_session');
  d := pg_temp.ca_rematch_swap(d,
    'public.fn_register_for_tournament(v_t.id, true)',
    'public.fn_ca_rematch_register_for_payer(v_t.id, true, v_uid)',
    1, 'seat_register');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_seat_maint_for_payer(uuid,integer,uuid)');

  -- 3g. The seat freeze gate.
  d := pg_temp.ca_rematch_source('public.fn_take_seat_and_buy_in_before_terminal_seat_gate(uuid,integer)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_take_seat_and_buy_in_before_terminal_seat_gate(p_table_id uuid, p_seat_number integer)',
    'FUNCTION public.fn_ca_rematch_seat_terminal_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)',
    1, 'seat_terminal_header');
  d := pg_temp.ca_rematch_swap(d,
    $a$public.fn_take_seat_and_buy_in_before_maintenance_announcement_gate(
    p_table_id, p_seat_number
  )$a$,
    $b$public.fn_ca_rematch_seat_maint_for_payer(
    p_table_id, p_seat_number, p_payer
  )$b$,
    1, 'seat_terminal_call');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_seat_terminal_for_payer(uuid,integer,uuid)');

  -- 3h. The seat door: the payer's own seat-acquisition lock.
  d := pg_temp.ca_rematch_source('public.fn_take_seat_and_buy_in(uuid,integer)');
  d := pg_temp.ca_rematch_swap(d,
    'FUNCTION public.fn_take_seat_and_buy_in(p_table_id uuid, p_seat_number integer)',
    'FUNCTION public.fn_ca_rematch_take_seat_for_payer(p_table_id uuid, p_seat_number integer, p_payer uuid)',
    1, 'door_header');
  d := pg_temp.ca_rematch_swap(d, 'NULL,p_table_id,auth.uid());', 'NULL,p_table_id,p_payer);', 1, 'door_payer');
  d := pg_temp.ca_rematch_swap(d,
    $a$public.fn_take_seat_and_buy_in_before_terminal_seat_gate(
    p_table_id,p_seat_number)$a$,
    $b$public.fn_ca_rematch_seat_terminal_for_payer(
    p_table_id,p_seat_number,p_payer)$b$,
    1, 'door_call');
  PERFORM pg_temp.ca_rematch_install(d, 'public.fn_ca_rematch_take_seat_for_payer(uuid,integer,uuid)');
END
$derive$;

-- ── 4. The core: the only writer of the agreement rows ───────────────────
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
  v_candidates uuid[];
  v_target     uuid;
  v_table      uuid;
  v_status     text;
  v_seat       integer;
  v_last_call  timestamptz;
  v_order      uuid[];
  v_payer      uuid;
  v_payer_is_horse boolean;
  v_res        jsonb;
  v_receipts   jsonb;
  v_fail       jsonb;
  v_reason     text;
  v_mine       jsonb;
  -- A refusal that belongs to the chosen game, not to a payer: another
  -- player reached it first. The next empty game is tried instead.
  c_race CONSTANT text[] := ARRAY['seat_taken','game_already_started','table_full',
    'tournament_full','registration_closed','table_closed','already_seated',
    'invalid_seat','no_table','game_not_found','tournament_not_found','table_not_found'];
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
     this answers for it the way a person would: it says yes. It may be the
     first to ask, at a moment fixed per game 4 to 20 seconds after the match
     ended; when the person asked first, it answers 2 to 8 seconds later.
     Nothing returned says which kind of player answered. */
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

    -- ── Both said yes: buy both seats in one transaction, or neither ─────
    IF v_row.declined_by IS NULL AND cardinality(v_row.accepted_by) = 2 THEN
      v_refusal := CASE WHEN public.fn_entry_purchases_frozen() THEN 'platform_frozen'
                        ELSE public.fn_daily_window_entry_refusal(p_source_tournament_id) END;
      IF v_refusal IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.ca_heads_up_rematch_sources s
                    WHERE md5(pg_get_functiondef(s.source::regprocedure)) IS DISTINCT FROM s.source_md5)
           OR NOT EXISTS (SELECT 1 FROM public.ca_heads_up_rematch_sources) THEN
          -- A buy-in layer changed after the copies were made: refuse before
          -- any purchase rather than charge by an outdated rule.
          v_row.outcome := 'unavailable';
        ELSE
          -- Two rematches never race for the same game: one chooser at a time.
          -- The game itself is locked by the ordinary seat purchase, in its
          -- own order, so a stranger buying the same game cannot deadlock it.
          PERFORM pg_advisory_xact_lock(hashtext('ca_heads_up_rematch_target'));
          SELECT array_agg(c.id ORDER BY c.upcoming DESC, c.created_at ASC)
            INTO v_candidates
            FROM (
              SELECT t.id, (t.start_time > v_now) AS upcoming, t.created_at
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
               ORDER BY (t.start_time > v_now) DESC NULLS LAST, t.created_at ASC
               LIMIT 3
            ) c;

          -- People first, each at the seat the result earned (the winner seat
          -- 1); a horse last, through its own door, which takes the free seat.
          SELECT array_agg(p.id ORDER BY COALESCE(p.is_horse, false), array_position(v_row.player_ids, p.id))
            INTO v_order
            FROM public.profiles p
           WHERE p.id = ANY (v_row.player_ids);

          FOREACH v_target IN ARRAY COALESCE(v_candidates, '{}'::uuid[]) LOOP
            v_table := public.fn_tournament_primary_table(v_target);
            CONTINUE WHEN v_table IS NULL;
            v_receipts := '[]'::jsonb;
            v_fail := NULL;
            BEGIN
              FOREACH v_payer IN ARRAY v_order LOOP
                SELECT COALESCE(p.is_horse, false) INTO v_payer_is_horse
                  FROM public.profiles p WHERE p.id = v_payer;
                IF v_payer_is_horse THEN
                  v_res := public.fn_seat_horse_in_seat_first_game(v_target, v_payer);
                ELSE
                  v_res := public.fn_ca_rematch_take_seat_for_payer(
                    v_table, array_position(v_row.player_ids, v_payer), v_payer);
                END IF;
                IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE
                   OR COALESCE((v_res->>'already_seated')::boolean, false) THEN
                  RAISE EXCEPTION USING ERRCODE = 'P0R01',
                    MESSAGE = jsonb_build_object('payer', v_payer,
                      'reason', COALESCE(NULLIF(v_res->>'reason', ''),
                        CASE WHEN COALESCE((v_res->>'already_seated')::boolean, false)
                             THEN 'already_seated' ELSE 'buy_in_failed' END))::text;
                END IF;
                v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
                  'player', v_payer,
                  'seat_number', (v_res->>'seat_number')::integer,
                  'cost', v_res->'cost',
                  'asset', v_res->'asset',
                  'diamonds_after', v_res->'diamonds_after'));
              END LOOP;
            EXCEPTION
              WHEN SQLSTATE 'P0R01' THEN
                v_fail := SQLERRM::jsonb;
              WHEN deadlock_detected OR serialization_failure OR lock_not_available THEN
                v_fail := jsonb_build_object('payer', NULL, 'reason', 'busy');
              WHEN OTHERS THEN
                v_fail := jsonb_build_object('payer', NULL, 'reason', 'error_' || SQLSTATE);
            END;

            IF v_fail IS NULL THEN
              v_row.outcome := 'matched';
              v_row.target_tournament_id := v_target;
              v_row.target_table_id := v_table;
              v_row.receipts := v_receipts;
              SELECT COALESCE(jsonb_object_agg(r->>'player', (r->>'seat_number')::integer), '{}'::jsonb)
                INTO v_row.seats FROM jsonb_array_elements(v_receipts) r;
              v_row.matched_at := v_now;
              EXIT;
            END IF;
            v_reason := v_fail->>'reason';
            IF v_reason = 'busy' THEN
              -- Contention, not a refusal: nothing was bought; the next read
              -- tries again.
              EXIT;
            END IF;
            IF NOT (v_reason = ANY (c_race)) THEN
              -- A refusal that would follow this payer to any game (not enough
              -- chips, the daily window, a table limit): nobody is charged and
              -- the rematch ends.
              v_row.outcome := 'buy_in_refused';
              v_row.refused_by := NULLIF(v_fail->>'payer', '')::uuid;
              v_row.refused_reason := v_reason;
              EXIT;
            END IF;
            -- The game was taken: try the next one.
          END LOOP;

          IF v_row.outcome IS NULL AND COALESCE(v_reason, '') <> 'busy' THEN
            -- No empty game to buy into right now. The recycler replaces games
            -- continuously; look again for a few seconds before giving up.
            v_row.no_game_since := COALESCE(v_row.no_game_since, v_now);
            IF v_now >= v_row.no_game_since + interval '8 seconds' THEN
              v_row.outcome := 'no_open_game';
            END IF;
          END IF;
        END IF;
      END IF;
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
         receipts = v_row.receipts,
         refused_by = v_row.refused_by,
         refused_reason = v_row.refused_reason,
         matched_at = v_row.matched_at
   WHERE r.source_tournament_id = p_source_tournament_id
     AND (r.accepted_by, r.accepted_at, r.declined_by, r.outcome, r.no_game_since,
          r.target_tournament_id, r.target_table_id, r.seats, r.receipts,
          r.refused_by, r.refused_reason, r.matched_at)
         IS DISTINCT FROM
         (v_row.accepted_by, v_row.accepted_at, v_row.declined_by, v_row.outcome, v_row.no_game_since,
          v_row.target_tournament_id, v_row.target_table_id, v_row.seats, v_row.receipts,
          v_row.refused_by, v_row.refused_reason, v_row.matched_at);

  -- ── What this caller sees ────────────────────────────────────────────
  IF v_row.outcome = 'matched' THEN
    -- Final. A tap after this never buys again; leaving the table afterwards
    -- is the ordinary unregister path, like any seated player.
    v_seat := (v_row.seats ->> p_uid::text)::integer;
    SELECT r INTO v_mine FROM jsonb_array_elements(v_row.receipts) r
     WHERE r->>'player' = p_uid::text LIMIT 1;
    RETURN jsonb_build_object(
      'status', 'matched',
      'table_id', v_row.target_table_id,
      'seat_number', v_seat,
      'cost', v_mine->'cost',
      'asset', v_mine->'asset',
      'diamonds_after', v_mine->'diamonds_after');
  END IF;
  IF v_row.declined_by = p_uid THEN
    RETURN jsonb_build_object('status', 'you_declined');
  END IF;
  IF v_row.outcome = 'buy_in_refused' THEN
    -- The refusal's reason goes only to the player it belongs to.
    RETURN jsonb_build_object('status', 'buy_in_refused')
      || CASE WHEN v_row.refused_by = p_uid
              THEN jsonb_build_object('reason', v_row.refused_reason) ELSE '{}'::jsonb END;
  END IF;
  IF v_row.outcome = 'unavailable' THEN
    RETURN jsonb_build_object('status', 'buy_in_refused', 'reason', 'rematch_unavailable');
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
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 5. The two browser doors (both refuse a signed-out session) ───────────
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
  -- A read can complete the match (a horse opponent answers on it), and the
  -- match buys both seats, so a signed-out session is refused here too.
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
  RETURN public.fn_ca_heads_up_rematch_core(p_source_tournament_id, auth.uid(), 'read');
END;
$function$;

REVOKE ALL ON FUNCTION public.ca_heads_up_rematch_respond(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ca_heads_up_rematch_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_heads_up_rematch_respond(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ca_heads_up_rematch_state(uuid) TO authenticated;

-- ── 6. Install-time assertions ──────────────────────────────────────────
DO $assert$
DECLARE r record;
BEGIN
  FOR r IN SELECT s.derived FROM public.ca_heads_up_rematch_sources s LOOP
    IF to_regprocedure(r.derived) IS NULL THEN
      RAISE EXCEPTION 'heads_up_rematch: % was not installed', r.derived;
    END IF;
    IF has_function_privilege('authenticated', r.derived, 'EXECUTE')
       OR has_function_privilege('anon', r.derived, 'EXECUTE')
       OR has_function_privilege('service_role', r.derived, 'EXECUTE') THEN
      RAISE EXCEPTION 'heads_up_rematch: % is executable by a browser or service role', r.derived;
    END IF;
    IF position('auth.uid()' IN pg_get_functiondef(r.derived::regprocedure)) > 0 THEN
      RAISE EXCEPTION 'heads_up_rematch: % still reads auth.uid()', r.derived;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.ca_heads_up_rematch_sources) <> 8 THEN
    RAISE EXCEPTION 'heads_up_rematch: expected 8 source layers';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_ca_heads_up_rematch_core(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'heads_up_rematch: the core is executable by a browser';
  END IF;
END
$assert$;

COMMIT;
