-- Version reserved by scripts/reserve-migration-version.sh against protected main and worktrees.
-- THE HORSE SPLIT DRAIN KEEPS TOURNAMENT SEAT MOVES (2026-11-02).
--
-- 20261102141229 refuses every new live horse seat while the split drains, so a
-- horse already entered in a running MTT, SNG or Spin could not be moved to
-- another table while the drain waits for that event to finish. Found before
-- the drain was armed (19:20Z); nothing was refused. While draining or
-- executing, a seat at a tournament table is admitted (the event that owns the
-- entry seats and moves it); new cash seats, new entries, memberships and
-- rejoins still wait. Enforcement after the split is unchanged. Function
-- bodies only: no table DDL.
-- @live-proof: (SELECT position('20261102191900' IN pg_get_functiondef('public.fn_ca_reject_automated_user_club_row()'::regprocedure))>0)
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_reject_automated_user_club_row()'::regprocedure)) IS DISTINCT FROM '1a1085e35cacdc619f9509733b51b428'
 THEN RAISE EXCEPTION 'automated_club_guard_preimage_changed'; END IF;
 IF md5(pg_get_functiondef('public.fn_stamp_seat_club()'::regprocedure)) IS DISTINCT FROM '06ace966fb210e38a4889262f60416ff'
 THEN RAISE EXCEPTION 'seat_stamp_preimage_changed'; END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_reject_automated_user_club_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_club_id uuid;
  v_user_id uuid;
  v_automated boolean := false;
  v_is_horse boolean := false;
  v_refusal text;
  v_tournament_seat boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'club_members' THEN
    v_club_id := NEW.club_id;
    v_user_id := NEW.user_id;
    v_automated := COALESCE(NEW.is_bot, false);
  ELSIF TG_TABLE_NAME = 'agents' THEN
    v_club_id := NEW.club_id;
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'table_seats' THEN
    -- A historical/departed seat remains immutable evidence. Only a live seat
    -- can put an automated player back onto a user-created club table.
    IF NEW.left_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT t.club_id, t.tournament_id IS NOT NULL INTO v_club_id, v_tournament_seat FROM public.tables t WHERE t.id = NEW.table_id;
    v_user_id := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'tournament_players' THEN
    SELECT t.club_id INTO v_club_id
      FROM public.tournaments t WHERE t.id = NEW.tournament_id;
    v_user_id := NEW.user_id;
  ELSE
    RAISE EXCEPTION 'Unsupported Automated-Club Guard Table: %', TG_TABLE_NAME;
  END IF;

  v_is_horse := COALESCE(
    (SELECT p.is_horse FROM public.profiles p WHERE p.id = v_user_id), false
  );
  v_automated := v_automated OR v_is_horse;

  IF v_automated AND NOT public.fn_ca_house_board_allows_automation(v_club_id) THEN
    RAISE EXCEPTION 'AUTOMATED_PLAYER_HOUSE_BOARD_ONLY: Automated Players Cannot Enter A User-Created Club'
      USING ERRCODE = '42501';
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229). Agents rows follow
  -- their membership; a departed membership update (lifecycle) is judged by
  -- fn_guard_membership_lifecycle_write instead.
  -- A horse already entered in a running event keeps being seated and moved by
  -- that event while the split drains (20261102191900); only new cash seats, new
  -- entries and memberships wait.
  IF v_is_horse AND TG_TABLE_NAME <> 'agents'
     AND NOT (v_tournament_seat AND public.fn_ca_horse_split_phase() IN ('draining','executing')) THEN
    v_refusal := public.fn_ca_horse_club_refusal(
      v_user_id, v_club_id,
      CASE WHEN TG_TABLE_NAME = 'tournament_players' THEN NEW.club_id END,
      TG_TABLE_NAME = 'club_members');
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_stamp_seat_club()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_refusal text;
BEGIN
  -- A SEAT KEEPS THE CLUB IT WAS SEATED UNDER (2026-09-10). Nothing that the
  -- stamp is derived from changed, and the seat already carries a club, so
  -- there is nothing to derive. This was 6.0 ms of club_members lookups on
  -- every stack write; see the migration header.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id
     AND NEW.club_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT NULL AND NEW.table_id IS NOT NULL THEN
    NEW.club_id := COALESCE(
      public.fn_seat_club_for_user(NEW.user_id, NEW.table_id, NEW.club_id),
      NEW.club_id
    );
  END IF;

  -- HORSES BELONG TO ONE ASSIGNED CLUB (20261102141229): a live horse seat is
  -- funded only from the horse's assigned club, whatever routed it here.
  IF NEW.left_at IS NULL AND NEW.user_id IS NOT NULL
     AND public.fn_ca_horse_split_phase() <> 'inactive'
     -- A tournament seat during the drain is the running event's own move (20261102191900).
     AND (public.fn_ca_horse_split_phase() = 'enforcing'
          OR NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.id = NEW.table_id AND t.tournament_id IS NOT NULL))
     AND COALESCE((SELECT p.is_horse FROM public.profiles p WHERE p.id = NEW.user_id), false) THEN
    v_refusal := public.fn_ca_horse_club_refusal(
      NEW.user_id, (SELECT t.club_id FROM public.tables t WHERE t.id = NEW.table_id), NEW.club_id, false);
    IF v_refusal IS NOT NULL THEN
      RAISE EXCEPTION '%', v_refusal USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

COMMIT;
