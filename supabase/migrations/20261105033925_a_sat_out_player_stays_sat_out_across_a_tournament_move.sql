-- 20261105033925_a_sat_out_player_stays_sat_out_across_a_tournament_move.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A SAT-OUT PLAYER STAYS SAT OUT ACROSS A TOURNAMENT MOVE
--
-- Dan 2026-11-04: "WHEN A PLAYER IS 'SITTING OUT' THEY SHOULDN'T GET THE 'SIT
-- OUT' POP UP AGAIN, IF THEY ARE TABLE CHANGED. IT SHOULD JUST STAY WITH THE
-- ORIGINAL 'SITTING OUT'."
--
-- fn_move_tournament_player (balancing moves, table breaks) opened the
-- destination chair with is_sitting_out=false, is_away=false, sit_out_at=NULL
-- whatever the source chair said. The engine's adoptTournamentMovePresence
-- carries the SAT_OUT presence in memory and then writes is_sitting_out=true
-- back to the new chair a sweep later, so every client that read the chair in
-- between saw the player arrive ACTIVE and then flip to sitting out: a brand
-- new sit-out, re-presented, with a restarted clock (sit_out_at was never
-- carried at all). The cash mover (fn_cash_seat_move_execute, 2026-09-05)
-- already carries all three columns; this makes the tournament mover agree.
--
-- The destination chair now takes is_sitting_out, is_away and sit_out_at from
-- the source row as it was read before the move. The closed source chair still
-- clears its own flags. Nothing else in the body changes: same locks, same
-- exit authority, same receipts, same SECURITY DEFINER, search_path,
-- statement_timeout, owner and ACL. The preimage guard pins the exact live
-- definition (md5 319af66018c7e1cd0781fc1a35c28219).
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
--
-- @live-proof: position('sit_out_at=v_source.sit_out_at' in pg_get_functiondef('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure)) > 0 AND position('v_source.time_bank_uses_remaining,v_source.sit_out_at,NULL,' in pg_get_functiondef('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure)) > 0 AND position('is_sitting_out=coalesce(v_source.is_sitting_out,false)' in pg_get_functiondef('public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $pre$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure
       AND md5(pg_get_functiondef(p.oid)) = '319af66018c7e1cd0781fc1a35c28219'
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig = ARRAY['search_path=public, pg_temp', 'statement_timeout=30s']
       AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'MOVE_TOURNAMENT_PLAYER_PREIMAGE_DRIFT';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_move_tournament_player(p_tournament_id uuid, p_user_id uuid, p_source_table_id uuid, p_destination_table_id uuid, p_destination_seat_number integer, p_request_id uuid, p_source_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_tp public.tournament_players%ROWTYPE;
  v_source public.table_seats%ROWTYPE;
  v_destination public.table_seats%ROWTYPE;
  v_destination_id uuid;
  v_token uuid;
  v_moved_at timestamptz;
  v_rows integer;
  v_live_count integer;
  v_result jsonb;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_move_tournament_player requires service authority'
      USING ERRCODE='28000';
  END IF;
  IF p_tournament_id IS NULL OR p_user_id IS NULL
     OR p_source_table_id IS NULL OR p_destination_table_id IS NULL
     OR p_request_id IS NULL OR p_source_table_id=p_destination_table_id
     OR p_source_mode NOT IN ('live_source','closed_orphan')
     OR p_destination_seat_number NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'invalid tournament move identity' USING ERRCODE='22023';
  END IF;

  IF current_setting('app.smarter_data_actor',true)='tournament-manager' THEN
    PERFORM smarter_private.f06_authority(p_tournament_id,NULLIF(current_setting('app.smarter_tournament_lease_generation',true),'')::uuid);
  END IF;
  -- HOTFIX EDIT (b): G -> T via the 20260910035245 helper, not the raw global key.
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('table_cap:'||p_user_id::text,0));

  v_result:=public.fn_ca_tournament_seat_move_receipt(p_request_id);
  IF v_result IS NOT NULL THEN
    IF (v_result->>'tournament_id')::uuid IS DISTINCT FROM p_tournament_id
       OR (v_result->>'user_id')::uuid IS DISTINCT FROM p_user_id
       OR (v_result->>'source_table_id')::uuid IS DISTINCT FROM p_source_table_id
       OR (v_result->>'destination_table_id')::uuid
            IS DISTINCT FROM p_destination_table_id
       OR v_result->>'source_mode' IS DISTINCT FROM p_source_mode
       OR (v_result->>'destination_seat_number')::integer
            IS DISTINCT FROM p_destination_seat_number THEN
      RAISE EXCEPTION 'tournament move request id belongs to another operation'
        USING ERRCODE='23505';
    END IF;
    RETURN v_result||jsonb_build_object('replayed',true);
  END IF;

  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % does not exist',p_tournament_id
      USING ERRCODE='P0002';
  END IF;
  IF upper(COALESCE(v_t.status,''))<>'RUNNING' THEN
    RAISE EXCEPTION 'tournament % is not RUNNING',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  SELECT * INTO v_tp FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id AND tp.user_id=p_user_id
   FOR UPDATE;
  IF NOT FOUND OR v_tp.status<>'playing'
     OR v_tp.table_id IS DISTINCT FROM p_source_table_id THEN
    RAISE EXCEPTION 'tournament move source roster is not exact'
      USING ERRCODE='P0404';
  END IF;

  PERFORM tb.id FROM public.tables tb
   WHERE tb.id IN (p_source_table_id,p_destination_table_id)
   ORDER BY tb.id FOR UPDATE;
  IF (SELECT count(*) FROM public.tables tb
       WHERE tb.id IN (p_source_table_id,p_destination_table_id)
         AND tb.tournament_id=p_tournament_id)<>2 THEN
    RAISE EXCEPTION 'tournament move tables do not share the event'
      USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tables tb
     WHERE tb.id=p_destination_table_id
       AND (COALESCE(tb.is_deleted,false)
         OR lower(COALESCE(tb.status,''))='closed'
         OR p_destination_seat_number>COALESCE(tb.max_players,9))) THEN
    RAISE EXCEPTION 'tournament move destination is not open'
      USING ERRCODE='55000';
  END IF;
  IF p_source_mode='closed_orphan' AND NOT EXISTS (
    SELECT 1 FROM public.tables tb
     WHERE tb.id=p_source_table_id
       AND (COALESCE(tb.is_deleted,false)
         OR lower(COALESCE(tb.status,''))='closed')) THEN
    RAISE EXCEPTION 'closed-orphan move source is not closed'
      USING ERRCODE='55000';
  END IF;
  IF p_source_mode='live_source' AND EXISTS (
    SELECT 1 FROM public.tables tb
     WHERE tb.id=p_source_table_id
       AND (COALESCE(tb.is_deleted,false)
         OR lower(COALESCE(tb.status,''))='closed')) THEN
    RAISE EXCEPTION 'live-source move source is closed'
      USING ERRCODE='55000';
  END IF;

  PERFORM s.id
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id AND s.user_id=p_user_id
     AND s.left_at IS NULL
   ORDER BY s.id FOR UPDATE OF s;
  SELECT count(*) INTO v_live_count
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id AND s.user_id=p_user_id
     AND s.left_at IS NULL;
  IF v_live_count<>1 THEN
    RAISE EXCEPTION 'tournament move requires exactly one live source seat'
      USING ERRCODE='P0404';
  END IF;

  SELECT s.* INTO v_source FROM public.table_seats s
   WHERE s.table_id=p_source_table_id AND s.user_id=p_user_id
     AND s.left_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_source.seat_number IS DISTINCT FROM v_tp.seat_number
     OR v_source.stack IS NULL
     OR v_source.stack::text IN ('NaN','Infinity','-Infinity')
     OR v_source.stack<=0
     OR abs(v_source.stack-v_tp.chips::numeric)>0.5 THEN
    RAISE EXCEPTION 'tournament move source chips or coordinates are not exact'
      USING ERRCODE='P0404';
  END IF;

  SELECT s.* INTO v_destination FROM public.table_seats s
   WHERE s.table_id=p_destination_table_id
     AND s.seat_number=p_destination_seat_number FOR UPDATE;
  IF FOUND AND v_destination.left_at IS NULL THEN
    RAISE EXCEPTION 'tournament move destination seat is occupied'
      USING ERRCODE='23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id
       AND tp.user_id<>p_user_id
       AND tp.status IN ('registered','playing')
       AND tp.table_id=p_destination_table_id
       AND tp.seat_number=p_destination_seat_number) THEN
    RAISE EXCEPTION 'tournament move destination roster is occupied'
      USING ERRCODE='23505';
  END IF;

  PERFORM smarter_private.f06_move_guard(p_tournament_id,p_user_id,p_source_table_id,p_destination_table_id,p_destination_seat_number,p_request_id,p_source_mode,v_source.id,v_source.occupancy_id);
  v_token:=public.fn_ca_open_tournament_seat_exit_authority(
    p_tournament_id,'move',p_user_id);
  v_moved_at:=clock_timestamp();
  BEGIN
    UPDATE public.table_seats s
       SET stack=0,left_at=v_moved_at,status='left',leave_pending=false,
           is_sitting_out=false,is_away=false,sit_out_at=NULL,
           scheduled_leave_hands=NULL
     WHERE s.id=v_source.id AND s.left_at IS NULL
       AND s.stack=v_source.stack;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    IF v_rows<>1 THEN
      RAISE EXCEPTION 'tournament move lost its locked source seat'
        USING ERRCODE='55000';
    END IF;

    IF v_destination.id IS NULL THEN
      INSERT INTO public.table_seats(
        table_id,seat_number,user_id,player_id,member_id,stack,
        is_sitting_out,is_away,joined_at,horse_id,scheduled_leave_hands,
        left_at,status,leave_pending,auto_rebuy,time_bank_remaining,
        time_bank_uses_remaining,sit_out_at,entry_hold,entry_post_agreed)
      VALUES(
        p_destination_table_id,p_destination_seat_number,p_user_id,
        v_source.player_id,v_source.member_id,v_source.stack,
        coalesce(v_source.is_sitting_out,false),coalesce(v_source.is_away,false),
        v_moved_at,v_source.horse_id,NULL,NULL,'active',false,
        v_source.auto_rebuy,v_source.time_bank_remaining,
        v_source.time_bank_uses_remaining,v_source.sit_out_at,NULL,
        v_source.entry_post_agreed)
      RETURNING id INTO v_destination_id;
    ELSE
      UPDATE public.table_seats s
         SET user_id=p_user_id,player_id=v_source.player_id,
             member_id=v_source.member_id,stack=v_source.stack,
             is_sitting_out=coalesce(v_source.is_sitting_out,false),
             is_away=coalesce(v_source.is_away,false),joined_at=v_moved_at,
             horse_id=v_source.horse_id,scheduled_leave_hands=NULL,
             left_at=NULL,status='active',leave_pending=false,
             auto_rebuy=v_source.auto_rebuy,
             time_bank_remaining=v_source.time_bank_remaining,
             time_bank_uses_remaining=v_source.time_bank_uses_remaining,
             sit_out_at=v_source.sit_out_at,entry_hold=NULL,
             entry_post_agreed=v_source.entry_post_agreed
       WHERE s.id=v_destination.id AND s.left_at IS NOT NULL
       RETURNING id INTO v_destination_id;
      IF v_destination_id IS NULL THEN
        RAISE EXCEPTION 'tournament move could not reuse destination seat'
          USING ERRCODE='55000';
      END IF;
    END IF;

    UPDATE public.tournament_players tp
       SET table_id=p_destination_table_id,
           seat_number=p_destination_seat_number
     WHERE tp.id=v_tp.id AND tp.status='playing'
       AND tp.table_id=p_source_table_id
       AND tp.seat_number=v_source.seat_number;
    GET DIAGNOSTICS v_rows=ROW_COUNT;
    IF v_rows<>1 THEN
      RAISE EXCEPTION 'tournament move lost its locked roster row'
        USING ERRCODE='55000';
    END IF;

    UPDATE public.tables tb
       SET current_players=(
         SELECT count(*) FROM public.table_seats s
          WHERE s.table_id=tb.id AND s.left_at IS NULL),
           updated_at=now()
     WHERE tb.id IN (p_source_table_id,p_destination_table_id);

    IF (SELECT count(*) FROM public.table_seats s
        JOIN public.tables tb ON tb.id=s.table_id
       WHERE tb.tournament_id=p_tournament_id
         AND s.user_id=p_user_id AND s.left_at IS NULL)<>1
       OR NOT EXISTS (
         SELECT 1 FROM public.table_seats s
          WHERE s.id=v_destination_id
            AND s.table_id=p_destination_table_id
            AND s.seat_number=p_destination_seat_number
            AND s.user_id=p_user_id AND s.left_at IS NULL
            AND s.stack=v_source.stack)
       OR NOT EXISTS (
         SELECT 1 FROM public.table_seats s
          WHERE s.id=v_source.id AND s.left_at=v_moved_at AND s.stack=0)
       OR NOT EXISTS (
         SELECT 1 FROM public.tournament_players tp
          WHERE tp.id=v_tp.id AND tp.status='playing'
            AND tp.table_id=p_destination_table_id
            AND tp.seat_number=p_destination_seat_number) THEN
      RAISE EXCEPTION 'tournament move final proof is not exact'
        USING ERRCODE='P0404';
    END IF;

    INSERT INTO public.tournament_seat_move_receipts(
      request_id,tournament_id,user_id,source_table_id,destination_table_id,
      source_seat_id,destination_seat_id,source_seat_number,
      destination_seat_number,source_mode,stack,moved_at)
    VALUES(
      p_request_id,p_tournament_id,p_user_id,p_source_table_id,
      p_destination_table_id,v_source.id,v_destination_id,
      v_source.seat_number,p_destination_seat_number,p_source_mode,
      v_source.stack,v_moved_at);

    -- HOTFIX EDIT (a): the consuming guard trigger is not installed; rows are deleted, not counted.
    PERFORM public.fn_ca_close_tournament_seat_exit_authority(v_token,false);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_close_tournament_seat_exit_authority(v_token,false);
    RAISE;
  END;

  v_result:=public.fn_ca_tournament_seat_move_receipt(p_request_id);
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'tournament move receipt did not persist'
      USING ERRCODE='P0404';
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$
;

-- CREATE OR REPLACE keeps the owner and ACL; restate them so the proof below
-- is a statement about this file and not about what happened to be there.
REVOKE ALL ON FUNCTION public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text) TO service_role;

DO $post$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
   WHERE p.oid = 'public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)'::regprocedure
     AND p.proowner = 'postgres'::regrole
     AND p.prosecdef
     AND p.proconfig = ARRAY['search_path=public, pg_temp', 'statement_timeout=30s']
     AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}';
  IF v_def IS NULL
     OR position('sit_out_at=v_source.sit_out_at' in v_def) = 0
     OR position('v_source.time_bank_uses_remaining,v_source.sit_out_at,NULL,' in v_def) = 0
     OR position('is_sitting_out=coalesce(v_source.is_sitting_out,false)' in v_def) = 0
     OR position('coalesce(v_source.is_sitting_out,false),coalesce(v_source.is_away,false),' in v_def) = 0
     OR position('is_sitting_out=false,is_away=false,sit_out_at=NULL,' in v_def) = 0 THEN
    RAISE EXCEPTION 'MOVE_TOURNAMENT_PLAYER_POSTIMAGE_DRIFT';
  END IF;
END $post$;

COMMIT;
