-- 20261116021751_a_club_rake_day_counts_the_hand_for_the_seat_club
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-16 02:17:51 UTC.
--
-- OWNER RULE (2026-11-15, binding): a player can play in several clubs; each
-- club's numbers reflect ONLY the hands played through that club, and nothing
-- is excluded or moved because a player belongs to several clubs.
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-15/16):
--
--   fn_ca_club_rake_daily_compute credits each player's part of a UNION cash
--   hand to a club by (1) the hand's rake_attributions witness, (2) the buy-in
--   receipt at or before the hand, (3) the table_seats row at or before the
--   hand, (4) THE PLAYER'S FIRST-JOINED CLUB IN THE UNION, (5) the table's
--   club. Step 4 is a membership guess, not where the hand was played.
--
--   Every positive contribution has a witness, so no chip ever reached step
--   4. The rows that do are players dealt in who put nothing in the pot
--   (contribution 0): no rake, so no witness row. Nearly all are horses
--   (19,610 of 19,621 in a 3-hour sample). Horses sit without a buy-in
--   receipt, and a seat row is removed after it is left, so once the horse
--   has left the table steps 2 and 3 find nothing and step 4 answered.
--   A zero contribution moves no rake, but it adds the hand to that club's
--   ca_club_rake_daily.hands - the raked-hands count on the Club Dashboard
--   revenue tab and on Club Financials (rake per hand, average pot).
--   Recomputing 2026-11-14 (all 24 hours) with the current calculator:
--     KINGS CLUB          26,106 hands (live rows written at commit: 9,571)
--     Deep Stack Society  78,422          (live 78,578)
--     The Felt Society    80,837          (live 81,316)
--   i.e. a rebuild moves ~16,500 hands to KINGS CLUB, the club most horses
--   joined first, although the hands were played through Deep Stack and Felt.
--   In a 20-minute sample 40 of 79 such rows named a club other than the one
--   the same horse's seat was playing through at that table.
--
-- WHAT THIS CHANGES (steps 1-3 and 5 are untouched, in the same order):
--
--   Step 4 is replaced by the SAME SEAT, read where it survives its deletion:
--     4a. ca_seat_stack_exits - the seat's own club, copied from table_seats
--         when the seat was left (trigger trg_log_seat_stack_exit): the first
--         exit of this player from this table at or after the hand, i.e. the
--         seat that was occupied while the hand was dealt (bounded to 7 days,
--         which also bounds the index range scan);
--     4b. else this player's own rake_attributions row at this table earlier
--         in the same sitting (within 1 day, and no exit of this player from
--         this table logged in between) - the club that very seat was
--         attributed through on the previous hand it paid into.
--   Only when neither exists does the hand stay with the table's club (5).
--   No membership lookup remains. Both lookups sit inside the coalesce after
--   steps 1-3, so the 99.9% of rows that carry a witness pay nothing new, and
--   both ride existing indexes (ca_seat_stack_exits_user_idx,
--   idx_rake_attributions_player_id).
--
--   Measured on 2026-11-14 (24 hours, read-only, the same calculator inline
--   with the old and the new step 4): rake, bbj and pot per club identical to
--   the cent (54,379.73 / 73,692.09 / 544.94 rake; 21,717.30 bbj and
--   3,820,825.43 pot on Midway Union) and equal to the live rows; hands
--   KINGS CLUB 26,106 -> 6,063, Deep Stack Society 78,422 -> 78,632,
--   The Felt Society 80,837 -> 81,377, Midway Union 0 -> 249.
--
-- NO HISTORY IS REBUILT. This changes future computations only: the live
-- per-hand rollup at commit and any later rebuild. Existing ca_club_rake_daily
-- rows stay as written; fn_ca_club_rake_daily_rebuild_range is the supported
-- door if an operator decides to recompute a closed day. No wallet, ledger,
-- settlement, scheduler or live-game state is changed.
--
-- @live-proof: position('ca_seat_stack_exits' IN pg_get_functiondef('public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure))>0 AND position('club_members' IN pg_get_functiondef('public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure))=0 AND (SELECT p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public'] AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE') FROM pg_proc p WHERE p.oid='public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure)

BEGIN;
SET LOCAL lock_timeout = '1s';

-- The body below replaces exactly production's current one, and nothing else.
DO $preimage$
DECLARE c_sig constant regprocedure := 'public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure;
BEGIN
  IF md5(pg_get_functiondef(c_sig)) IS DISTINCT FROM '855d57a4f57455e062a13e6f44faf296' THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_PREIMAGE_CHANGED: %', md5(pg_get_functiondef(c_sig)) USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('ca.club_rake_seat_club_meta',
    (SELECT jsonb_build_object('o',proowner::regrole::text,'a',proacl::text,'s',prosecdef,'c',proconfig,'v',provolatile,'l',prolang::text)::text
       FROM pg_proc WHERE oid = c_sig), true);
END
$preimage$;

CREATE OR REPLACE FUNCTION public.fn_ca_club_rake_daily_compute(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[])
 RETURNS TABLE(club_id uuid, stat_date date, hands bigint, rake numeric, bbj numeric, pot numeric, source_rows bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT r.id, r.table_id, r.club_id, r.created_at,
           coalesce(r.rake_amount, 0) AS rake, coalesce(r.bbj_contribution, 0) AS bbj,
           coalesce(r.pot_size, 0) AS pot, r.player_contributions
      FROM rake_records r
     WHERE p_ids IS NOT NULL AND r.id = ANY (p_ids)
       AND r.club_id IS NOT NULL AND NOT coalesce(r.is_tournament, false)
       AND public.fn_ca_launch_accounting_accepts(r.club_id,r.created_at)
    UNION ALL
    SELECT r.id, r.table_id, r.club_id, r.created_at,
           coalesce(r.rake_amount, 0), coalesce(r.bbj_contribution, 0),
           coalesce(r.pot_size, 0), r.player_contributions
      FROM rake_records r
     WHERE p_ids IS NULL AND r.created_at >= p_from AND r.created_at < p_to
       AND r.club_id IS NOT NULL AND NOT coalesce(r.is_tournament, false)
       AND public.fn_ca_launch_accounting_accepts(r.club_id,r.created_at)
  ),
  tbl AS (
    SELECT s.id, s.club_id AS table_club, (s.created_at AT TIME ZONE 'UTC')::date AS day,
           s.rake, s.bbj, s.pot, s.player_contributions, t.union_id, s.table_id, s.created_at
      FROM src s
      LEFT JOIN tables t ON t.id = s.table_id
     WHERE t.id IS NULL OR t.tournament_id IS NULL
  ),
  -- Only a union table needs its contributions read: a standalone table's
  -- rake has exactly one place to go. A key that is not a uuid or a value
  -- that is not a number is ignored, never raised: a reporting rollup must
  -- not fail a ledger write. A contribution of zero still counts the hand
  -- for that player's club, as club_table_daily counts it.
  contrib AS (
    SELECT b.id, b.union_id,
           CASE WHEN e.key ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                THEN e.key::uuid END AS uid,
           CASE WHEN e.value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN e.value::numeric END AS contrib
      FROM tbl b
      CROSS JOIN LATERAL jsonb_each_text(
        CASE WHEN jsonb_typeof(b.player_contributions) = 'object'
             THEN b.player_contributions ELSE '{}'::jsonb END) e
     WHERE b.union_id IS NOT NULL
  ),
  attributed AS (
    SELECT c.id, c.contrib,
           -- The witness wins. Without it, use the funding or seat at the
           -- hand's time, never a later seat or buy-in at the same table.
           -- Once the seat row is gone (it is removed after it is left),
           -- the same seat is read from its own exit record, else from this
           -- player's own attribution at this table earlier in the same
           -- sitting. Never a membership lookup: a player in several clubs
           -- counts the hand for the club the hand was played through.
           coalesce((SELECT ra.club_id FROM rake_attributions ra
                      WHERE ra.rake_record_id = c.id AND ra.player_id = c.uid AND ra.club_id IS NOT NULL
                      LIMIT 1),
                    (SELECT x.funding_club_id FROM public.cash_participant_funding_receipts x
                      WHERE x.operation_kind = 'buyin' AND x.table_id = b.table_id
                        AND x.account_entity_id = c.uid AND x.seat_joined_at <= b.created_at
                      ORDER BY x.seat_joined_at DESC LIMIT 1),
                    (SELECT ts.club_id FROM public.table_seats ts
                      WHERE ts.table_id = b.table_id AND ts.user_id = c.uid
                        AND ts.club_id IS NOT NULL AND ts.joined_at <= b.created_at
                      ORDER BY ts.joined_at DESC LIMIT 1),
                    (SELECT e.club_id FROM public.ca_seat_stack_exits e
                      WHERE e.user_id = c.uid AND e.table_id = b.table_id
                        AND e.occurred_at >= b.created_at
                        AND e.occurred_at < b.created_at + interval '7 days'
                      ORDER BY e.occurred_at, e.id LIMIT 1),
                    (SELECT pa.club_id FROM public.rake_attributions pa
                      WHERE pa.player_id = c.uid AND pa.table_id = b.table_id
                        AND pa.club_id IS NOT NULL
                        AND pa.created_at <= b.created_at
                        AND pa.created_at > b.created_at - interval '1 day'
                        AND NOT EXISTS (SELECT 1 FROM public.ca_seat_stack_exits px
                                         WHERE px.user_id = c.uid AND px.table_id = b.table_id
                                           AND px.occurred_at > pa.created_at
                                           AND px.occurred_at < b.created_at)
                      ORDER BY pa.created_at DESC, pa.id DESC LIMIT 1),
                    b.table_club) AS club_id
      FROM contrib c JOIN tbl b ON b.id = c.id
     WHERE c.uid IS NOT NULL AND c.contrib IS NOT NULL AND c.contrib >= 0
  ),
  split AS (
    SELECT a.id, a.club_id, sum(a.contrib) AS contrib, count(*) AS src_rows
      FROM attributed a GROUP BY a.id, a.club_id
  ),
  split_total AS (
    SELECT s.id, sum(s.contrib) AS tot FROM split s GROUP BY s.id
  ),
  hand_rows AS (
    SELECT b.*, EXISTS (SELECT 1 FROM split_total st WHERE st.id = b.id AND st.tot > 0) AS has_split
      FROM tbl b
  ),
  parts AS (
    -- A union hand with a usable split: rake by contribution share, and one
    -- hand for every club that contributed.
    SELECT h.day, s.club_id, 1::bigint AS hands, h.rake * s.contrib / st.tot AS rake,
           0::numeric AS bbj, 0::numeric AS pot, s.src_rows
      FROM split s
      JOIN split_total st ON st.id = s.id AND st.tot > 0
      JOIN hand_rows h ON h.id = s.id
    UNION ALL
    -- The table's club: the drop and the pot volume of every hand it hosted,
    -- plus the whole hand when nothing could be attributed.
    SELECT h.day, h.table_club,
           CASE WHEN h.has_split THEN 0 ELSE 1 END,
           CASE WHEN h.has_split THEN 0 ELSE h.rake END,
           h.bbj, h.pot,
           CASE WHEN h.has_split THEN 0 ELSE 1 END
      FROM hand_rows h
  )
  SELECT p.club_id, p.day, sum(p.hands)::bigint, sum(p.rake), sum(p.bbj), sum(p.pot),
         sum(p.src_rows)::bigint
    FROM parts p
   GROUP BY p.club_id, p.day;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_club_rake_daily_compute(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_rake_daily_compute(timestamptz, timestamptz, uuid[]) TO service_role;

-- Same owner, grants, SECURITY DEFINER, STABLE, search_path and language; the
-- exact new body; no membership lookup left.
DO $postimage$
DECLARE c_sig constant regprocedure := 'public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure;
        v_def text := pg_get_functiondef(c_sig);
BEGIN
  IF (SELECT jsonb_build_object('o',proowner::regrole::text,'a',proacl::text,'s',prosecdef,'c',proconfig,'v',provolatile,'l',prolang::text)::text
        FROM pg_proc WHERE oid = c_sig) IS DISTINCT FROM current_setting('ca.club_rake_seat_club_meta', true) THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_AUTHORITY_MOVED' USING ERRCODE = '55000';
  END IF;
  IF (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = c_sig) <> 'sql' THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_LANGUAGE_MOVED' USING ERRCODE = '55000';
  END IF;
  IF md5(v_def) IS DISTINCT FROM '213cce58665f81c2eb12d3cd52ed81c6'
     OR position('club_members' IN v_def) > 0
     OR position('joined_at ASC' IN v_def) > 0
     OR position('FROM public.ca_seat_stack_exits e' IN v_def) = 0 THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_POSTIMAGE %', md5(v_def) USING ERRCODE = '55000';
  END IF;
END
$postimage$;

COMMIT;
