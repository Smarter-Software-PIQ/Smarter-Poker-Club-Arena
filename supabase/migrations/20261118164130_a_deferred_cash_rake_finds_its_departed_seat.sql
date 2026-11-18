-- 20261118164130_a_deferred_cash_rake_finds_its_departed_seat.sql
--
-- A DEFERRED CASH RAKE FINDS ITS DEPARTED SEAT
-- (fn_post_commit_stranded_watchdog, critical, 2026-11-18 16:20 UTC)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~16:25 UTC)
--
-- The stranded-obligation watchdog went critical: hand 59989058 (a39c6714) at
-- union table "PLO6 0.50/1 Classic Main 2" (f02a6a5e) stored a 0.75 rake
-- obligation at 16:09:49.7 and every banking attempt since (675 by 16:23)
-- failed 23514 cash_earning_seat_provenance_missing_or_ambiguous, raised by
-- fn_cash_earning_club's shared-union branch.
--
-- That branch reads the earning club ONLY from a LIVE table_seats row covering
-- the hand's start. #11256 (2026-11-18, "a cash hand never waits on a
-- tournament wallet lock") moved cash rake out of the hand's own commit into a
-- stored obligation banked by a later continuation. Before #11256 the reader
-- ran while every participant was still seated; now it runs after them. Seat 4
-- was horse 7c0be9c9 (funded by club 2a1132b9, receipt d54f9f6f). It left at
-- 16:09:51.2 (ca_seat_stack_exits 639580, club 2a1132b9), two seconds after the
-- hand, and the must-move balancer seated 3fe15f75 in that same chair at
-- 16:09:53.3 (cash_seat_moves a116a96b). The participant's chair row now names
-- someone else, the reader finds no row, and a deterministic refusal retries on
-- every following hand forever. No chips moved: the obligation is held, not
-- lost. The Lightning branch of the same function already solved this ("a
-- chair row can be gone by settlement; its buy-in receipt is immutable").
--
-- THE FIX (the reader, not a retry or a skip)
--
-- When no live chair row of the participant covers the hand's start, the
-- earning club is read from the participant's FIRST seat exit at this table at
-- or after the hand started: the occupancy that held the chair when the hand
-- was dealt ended there, and ca_seat_stack_exits records that chair's club
-- immutably at the moment it ended. A participant in the hand was seated at its
-- start (the engine committed them as a contributor), so the first exit after
-- the start is the end of that same occupancy. Applied to both table branches
-- (shared union and private). The union branch keeps its exact validation: the
-- club must belong to the union, and a missing or ambiguous answer still
-- refuses. A live chair row still wins whenever it exists, so every hand the
-- reader answered before answers identically. The Lightning branch is
-- unchanged.
--
-- Live install waits for the release freeze (owner order 2026-11-18 09:12 CT)
-- and goes through the protected applier. Rows written by this file: none. The held obligation for hand 59989058
-- banks at the next continuation through the existing path. No money moves
-- here.
--
-- @live-proof: position('THE CHAIR CAN BE GONE BY THE TIME THE RAKE BANKS' in pg_get_functiondef('public.fn_cash_earning_club(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION pg_temp.prov_subst(p_sig text, p_before text, p_after text,
                                   p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

SELECT pg_temp.prov_subst(
  'public.fn_cash_earning_club(uuid,uuid,uuid,uuid,uuid)',
  '2ba3a2891019b46e06b46b4c642e566a', '625ef5361cf04730ba87d4531700a029',
  ARRAY[
$o1$    AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);
  -- An overlapping unknown-club seat also makes the evidence ambiguous.
$o1$,
$o2$   AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);
 IF cardinality(clubs) IS DISTINCT FROM 1
$o2$],
  ARRAY[
$n1$    AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);
  -- THE CHAIR CAN BE GONE BY THE TIME THE RAKE BANKS (see the shared-union
  -- branch below): read the occupancy's club from its first exit after start.
  IF clubs IS NULL THEN
   SELECT ARRAY[e.club_id] INTO clubs FROM public.ca_seat_stack_exits e
    WHERE e.user_id=p_player_id AND e.table_id=p_table_id AND e.occurred_at>=started
    ORDER BY e.occurred_at, e.id LIMIT 1;
  END IF;
  -- An overlapping unknown-club seat also makes the evidence ambiguous.
$n1$,
$n2$   AND s.joined_at<=started AND (s.left_at IS NULL OR s.left_at>started);
 -- THE CHAIR CAN BE GONE BY THE TIME THE RAKE BANKS (20261118 stranded rake,
 -- hand 59989058). Cash rake is banked by a continuation after the hand, so a
 -- participant may already have left and their chair been reseated. A
 -- participant was seated when the hand was dealt; the occupancy that held the
 -- chair then ended at the participant's FIRST exit at this table at or after
 -- the start, and ca_seat_stack_exits recorded that chair's club immutably. A
 -- live chair row still wins; a missing or foreign club still refuses below.
 IF clubs IS NULL THEN
  SELECT ARRAY[e.club_id] INTO clubs FROM public.ca_seat_stack_exits e
   WHERE e.user_id=p_player_id AND e.table_id=p_table_id AND e.occurred_at>=started
     AND e.club_id IS NOT NULL
   ORDER BY e.occurred_at, e.id LIMIT 1;
 END IF;
 IF cardinality(clubs) IS DISTINCT FROM 1
$n2$]);

COMMIT;
