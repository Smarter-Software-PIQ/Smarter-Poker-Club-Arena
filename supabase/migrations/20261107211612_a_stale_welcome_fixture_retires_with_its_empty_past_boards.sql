-- 20261107211612_a_stale_welcome_fixture_retires_with_its_empty_past_boards
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 21:16:12 UTC.
--
-- A WELCOME BOARD THAT THE 3 AM CLOSE RECYCLED IS STILL AN UNUSED BOARD
--
-- WHAT WAS WRONG (read from production 2026-11-07 20:07-21:15 UTC)
--
-- Every Club Create Certification run since 2026-11-03 has ended
-- "Stale recovery left 11 of 11 stale account(s) unrecovered" (run
-- 42409273134: WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED x3, then
-- cleanup_reserved_certification_account 500
-- CERTIFICATION_RETIREMENT_HAS_AUTHORITY_OR_CUSTODY). Three welcome fixtures
-- whose certification runs died on 2026-11-01/02 are still active:
-- Crest Cert Template 6dc7e348 (96bd011b), fba91d7b (b3ec63d3) and
-- 32085314 (a15f7d9e). Nobody ever sat in them. But
-- fn_daily_window_close_seat_first_lobbies cancels every open seat-first
-- lobby at 3 AM Chicago, and the welcome board is re-materialized afterwards,
-- so each club now holds 12 REGISTERING boards plus 58-59 CANCELLED earlier
-- generations of the same 12 names. Every one of those cancellations has an
-- immutable receipt with zero players, seats, refunds, tickets, fees and rake.
-- A platform rollout at 2026-11-03 15:04:11 UTC also gave each club six
-- non-package Classic FLH/FLO8 cash games, each with one empty open table and
-- no hand.
--
-- Two doors could not retire such a club:
--   * the certification door (fn_ca_retire_welcome_certification_club)
--     deletes the club, which it can never do while immutable cancellation
--     receipts reference its tournaments, and refuses any tournament outside
--     the 12 current boards (WELCOME_CERTIFICATION_BOARD_LINEAGE_REFUSED);
--   * the owner's own Retire Club door (fn_retire_settled_club) runs
--     fn_unwind_unused_first_club_welcome_package, which raised
--     WELCOME_PACKAGE_BOARD_LINEAGE_AMBIGUOUS whenever a board name appears
--     twice, including a cancelled earlier generation. That also blocks a real
--     owner whose unused welcome board was recycled once.
--
-- WHAT THIS CHANGES
--
-- 1. fn_unwind_unused_first_club_welcome_package: the ambiguity check no
--    longer counts an earlier generation that is CANCELLED, never started,
--    has no current player and has a cancellation receipt that moved nothing
--    (every count, amount and id list zero). Everything else is unchanged:
--    such a generation is still inside the set the unwind inspects, so any
--    tournament_players, hand_history, seat or play history on it still
--    refuses (WELCOME_PACKAGE_HAS_PLAY_OR_REGISTRATION_HISTORY); a generation
--    with any refund, ticket, fee or rake still counts and still refuses as
--    ambiguous; the unwind cancels only non-terminal boards, through the same
--    receipted door. Patched in place from its exact installed definition
--    (md5 gate, single anchor), as 20261101135349 does.
-- 2. public.fn_ca_retire_stale_welcome_fixture_with_history(club, reason),
--    service_role only. For a reserved certification fixture (same identity
--    rules as fn_ca_prepare_unused_welcome_certification_board_games) that
--    already holds settled history and never had play, it closes the fixture's
--    own open non-package cash tables through the owner's
--    fn_close_managed_game, then retires the club through the owner's
--    fn_retire_settled_club as the fixture's owner identity carried as
--    platform operations (the shape 20261105224533 uses). That door unwinds
--    the welcome package, re-reads every balance and obligation, flips the
--    club to 'retired' and keeps every record. The identity stays as owner of
--    record, which the stale sweep already accepts
--    (disposition retained_terminal_fixture_owner). It refuses, changing
--    nothing, on any member other than the zero-balance owner, any agent, any
--    seat, entrant or hand ever, any cancellation that moved anything, any
--    tournament that is neither such a cancelled generation nor an untouched
--    open board, or a fixture with no history (the existing pristine door
--    owns that case).
--
-- WHAT THIS DOES NOT CHANGE
--
-- fn_ca_prepare_unused_welcome_certification_board_games and the deleting
-- certification door are unchanged. Accepting the earlier generations there
-- would not retire anything: that door goes on to fn_ca_retire_certification_club,
-- which deletes the club and refuses any club that still has a tournament
-- ("this club has played"), and the cancelled generations can never be
-- deleted because their receipts are immutable (RESTRICT). A fixture with
-- history is finished by retiring it with its records, never by deleting it.
--
-- MEASURED
--
-- A rolled-back probe on production (DO block ending in RAISE) with
-- exactly this unwind patch and this sequence on 96bd011b: 6 tables closed,
-- welcome unwind ok, fn_retire_settled_club success, lifecycle 'retired',
-- 71 tournaments all CANCELLED with receipts kept. Without the patch the same
-- door answered WELCOME_PACKAGE_BOARD_LINEAGE_AMBIGUOUS.
--
-- @live-proof: position('r.total_rake_after=0' IN pg_get_functiondef('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)'::regprocedure)) > 0 AND to_regprocedure('public.fn_ca_retire_stale_welcome_fixture_with_history(uuid,text)') IS NOT NULL

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  v_def text := pg_get_functiondef('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)'::regprocedure);
  v_old text := $anchor$       AND t.satellite_target IS NULL
  ) SELECT count(*)=count(DISTINCT name) FROM candidates) THEN$anchor$;
  v_new text := $replacement$       AND t.satellite_target IS NULL
       -- An earlier generation the 3 AM close cancelled with a receipt that
       -- moved nothing is history, not a second board (2026-11-07).
       AND NOT (
         upper(COALESCE(t.status::text,''))='CANCELLED'
         AND COALESCE(t.current_players,0)=0 AND t.started_at IS NULL
         AND EXISTS(SELECT 1 FROM public.tournament_cancellation_receipts r
           WHERE r.tournament_id=t.id
             AND r.source_player_count=0 AND r.source_seat_count=0
             AND r.refunded_count=0 AND r.refund_line_count=0
             AND r.ticket_return_count=0 AND r.zero_refund_count=0
             AND r.total_refunded=0 AND r.total_ticket_returned=0
             AND r.fees_reversed=0 AND r.total_rake_before=0 AND r.total_rake_after=0
             AND r.released_seat_count=0
             AND cardinality(r.source_player_ids)=0 AND cardinality(r.source_seat_ids)=0
             AND cardinality(r.refunded_registration_ids)=0
             AND cardinality(r.ticket_return_ids)=0
             AND cardinality(r.zero_refund_registration_ids)=0
             AND cardinality(r.fee_reversal_ids)=0)
       )
  ) SELECT count(*)=count(DISTINCT name) FROM candidates) THEN$replacement$;
BEGIN
  IF position('r.total_rake_after=0' IN v_def) > 0 THEN
    RETURN; -- already installed
  END IF;
  IF md5(v_def) IS DISTINCT FROM 'b56b2a0f35e0fd3aa178dbd12f72fa25' THEN
    RAISE EXCEPTION 'WELCOME_UNWIND_ORIGINAL_AUTHORITY_CHANGED';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'WELCOME_UNWIND_AMBIGUITY_ANCHOR_NOT_UNIQUE';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;

CREATE OR REPLACE FUNCTION public.fn_ca_retire_stale_welcome_fixture_with_history(
  p_club_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club public.clubs%ROWTYPE;
  v_owner_email text;
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'stale-cert-recovery');
  v_tables uuid[] := '{}';
  v_table uuid;
  v_close jsonb;
  v_result jsonb;
  v_history integer := 0;
  v_prior_claims text := current_setting('request.jwt.claims', true);
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501';
  END IF;
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_CLUB_REQUIRED' USING ERRCODE='22004';
  END IF;

  SELECT * INTO v_club FROM public.clubs WHERE id=p_club_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','club_not_found','club_id',p_club_id);
  END IF;
  SELECT u.email INTO v_owner_email FROM auth.users u WHERE u.id=v_club.owner_id;
  IF p_club_id=ANY(ARRAY[
       'a0000000-0000-0000-0000-000000000001'::uuid,
       'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,
       '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid,
       'fade0000-0000-0000-0000-000000000001'::uuid
     ])
     OR (v_club.name NOT LIKE 'Crest Cert %' AND v_club.name NOT LIKE 'Preset Crest Cert %')
     OR NOT (
       COALESCE(v_owner_email,'') LIKE 'club-create-cert-%@smarter-poker.invalid'
       OR COALESCE(v_owner_email,'') LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     )
     OR COALESCE(v_club.is_union,false)
     OR v_club.union_id IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.union_clubs u WHERE u.club_id=p_club_id)
     OR NOT EXISTS(SELECT 1 FROM public.club_welcome_entitlements e WHERE e.club_id=p_club_id)
     OR NOT EXISTS(SELECT 1 FROM public.club_welcome_package_receipts r WHERE r.club_id=p_club_id) THEN
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_IDENTITY_REFUSED' USING ERRCODE='42501';
  END IF;

  IF v_club.lifecycle_status='retired' THEN
    RETURN jsonb_build_object('success',true,'already_retired',true,'club_id',p_club_id,
      'disposition','retained_terminal_fixture_owner');
  END IF;

  -- The only member is the owner, holding nothing; no agent.
  IF (SELECT count(*) FROM public.club_members m WHERE m.club_id=p_club_id)<>1
     OR NOT EXISTS(SELECT 1 FROM public.club_members m
        WHERE m.club_id=p_club_id AND m.user_id=v_club.owner_id
          AND COALESCE(m.chip_balance,0)=0 AND COALESCE(m.promo_balance,0)=0
          AND COALESCE(m.held_chips,0)=0 AND COALESCE(m.locked_chips,0)=0
          AND COALESCE(m.credit_used,0)=0 AND COALESCE(m.credit_limit,0)=0)
     OR EXISTS(SELECT 1 FROM public.agents a WHERE a.club_id=p_club_id) THEN
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_MEMBERSHIP_REFUSED' USING ERRCODE='55000';
  END IF;

  -- Nobody ever sat, entered or played a hand in it.
  IF EXISTS(SELECT 1 FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id
             WHERE t.club_id=p_club_id)
     OR EXISTS(SELECT 1 FROM public.tournament_players p JOIN public.tournaments t ON t.id=p.tournament_id
                WHERE t.club_id=p_club_id)
     OR EXISTS(SELECT 1 FROM public.hand_history h JOIN public.tables t ON t.id=h.table_id
                WHERE t.club_id=p_club_id)
     OR EXISTS(SELECT 1 FROM public.hand_history h JOIN public.tournaments t ON t.id=h.tournament_id
                WHERE t.club_id=p_club_id) THEN
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_HAS_PLAY' USING ERRCODE='55000';
  END IF;

  -- Every tournament is an untouched open board or a cancelled generation
  -- whose receipt moved nothing. Anything else is not this door's to retire.
  IF EXISTS(
    SELECT 1 FROM public.tournaments t
     WHERE t.club_id=p_club_id
       AND NOT (
         upper(COALESCE(t.status::text,'')) IN ('REGISTERING','ANNOUNCED')
         AND COALESCE(t.current_players,0)=0 AND t.started_at IS NULL AND t.ended_at IS NULL
       )
       AND NOT (
         upper(COALESCE(t.status::text,''))='CANCELLED'
         AND COALESCE(t.current_players,0)=0 AND t.started_at IS NULL
         AND EXISTS(SELECT 1 FROM public.tournament_cancellation_receipts r
           WHERE r.tournament_id=t.id
             AND r.source_player_count=0 AND r.source_seat_count=0
             AND r.refunded_count=0 AND r.refund_line_count=0
             AND r.ticket_return_count=0 AND r.zero_refund_count=0
             AND r.total_refunded=0 AND r.total_ticket_returned=0
             AND r.fees_reversed=0 AND r.total_rake_before=0 AND r.total_rake_after=0
             AND r.released_seat_count=0
             AND cardinality(r.source_player_ids)=0 AND cardinality(r.source_seat_ids)=0
             AND cardinality(r.refunded_registration_ids)=0
             AND cardinality(r.ticket_return_ids)=0
             AND cardinality(r.zero_refund_registration_ids)=0
             AND cardinality(r.fee_reversal_ids)=0)
       )) THEN
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_TOURNAMENT_HISTORY_REFUSED' USING ERRCODE='55000';
  END IF;
  SELECT count(*) INTO v_history FROM public.tournaments t
   WHERE t.club_id=p_club_id AND upper(COALESCE(t.status::text,''))='CANCELLED';
  IF v_history=0 THEN
    -- A fixture with no history belongs to the pristine certification door.
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_HAS_NO_HISTORY' USING ERRCODE='55000';
  END IF;

  -- Act as the fixture's owner, carried as platform operations.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_club.owner_id, 'role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_club.owner_id::text, true);

  -- Close the fixture's own open cash tables that are not part of the welcome
  -- package (the unwind closes the package's), through the owner's door.
  SELECT COALESCE(array_agg(t.id ORDER BY t.id),'{}') INTO v_tables
    FROM public.tables t JOIN public.cash_games g ON g.id=t.cluster_id
   WHERE g.club_id=p_club_id
     AND lower(COALESCE(t.status,'')) NOT IN ('closed','completed','cancelled','finished')
     AND NOT EXISTS(SELECT 1 FROM public.club_welcome_package_items i
                     WHERE i.club_id=p_club_id AND i.entity_id=g.id);
  FOREACH v_table IN ARRAY v_tables LOOP
    v_close := public.fn_close_managed_game('table', v_table);
    IF v_close->>'ok' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_TABLE_CLOSE_REFUSED: % %', v_table, v_close
        USING ERRCODE='55000';
    END IF;
  END LOOP;

  v_result := public.fn_retire_settled_club(p_club_id, v_club.name, v_reason);

  -- Hand the caller back exactly the identity it called with.
  PERFORM set_config('request.jwt.claims', COALESCE(v_prior_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prior_sub, ''), true);

  IF COALESCE((v_result->>'success')::boolean,false) IS NOT TRUE
     OR NOT EXISTS(SELECT 1 FROM public.clubs c
                    WHERE c.id=p_club_id AND c.lifecycle_status='retired'
                      AND c.owner_id=v_club.owner_id) THEN
    RAISE EXCEPTION 'STALE_WELCOME_FIXTURE_RETIREMENT_REFUSED: %', left(COALESCE(v_result::text,'null'),500)
      USING ERRCODE='55000';
  END IF;

  RETURN jsonb_build_object('success',true,'club_id',p_club_id,
    'disposition','retained_terminal_fixture_owner',
    'tables_closed',cardinality(v_tables),
    'cancelled_generations_kept',v_history,
    'retired_at',v_result->'retired_at');
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_retire_stale_welcome_fixture_with_history(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_retire_stale_welcome_fixture_with_history(uuid,text)
  TO service_role;

COMMIT;
