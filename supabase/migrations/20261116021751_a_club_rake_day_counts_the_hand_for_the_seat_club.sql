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
-- WHAT THIS CHANGES: every lookup after the witness is bound to the hand's
-- OWN SEAT OCCUPANCY, read from the hand's own commit record.
--
--   hand_atomic_commits.stack_result.request.stacks names, for every player
--   dealt into the hand, the seat row (seat_id) and that seat's sit-down time
--   (seat_joined_at). seat_joined_at is the occupancy key: every path that
--   puts a player into a chair stamps a new joined_at (fn_seat_stage_entitlement,
--   fn_ca_assign_tournament_player_seat_locked, fn_seat_late_registrant_*),
--   and the only paths that carry an old joined_at - the cash seat move and
--   seat swap - carry the seat's club_id with it in the same UPDATE. No writer
--   changes table_seats.club_id inside an occupancy except filling a NULL
--   (fn_heal_seat_provenance); a witness never carries NULL. So one
--   (player, table, seat_joined_at) has one club. Read from production
--   2026-11-15/16 (pg_proc, read-only).
--
--   For a dealt-in player with no witness on this hand:
--     2. the buy-in receipt of THIS occupancy (seat_joined_at equal);
--     3. the table_seats row of THIS occupancy (joined_at equal);
--     4. this player's own witness on the nearest earlier and the nearest
--        later hand at this table - each accepted only if that hand's commit
--        record shows the same seat_joined_at ("same sitting"); if both are
--        found and disagree, neither is used;
--     5. else the table's club.
--   A hand with no commit record (hands before the atomic commit, last seen
--   2026-11-07 18:18 UTC) keeps the previous dated receipt/seat reads at
--   steps 2-3 and has no step 4.
--
-- WHY NOT THE SEAT EXIT RECORD OR "THE LAST ATTRIBUTION IN A DAY" (the first
-- draft of this migration): neither is bound to the occupancy.
--   * fn_log_seat_stack_exit writes ca_seat_stack_exits only when a seat is
--     left with chips (v_stack > 0) and never on a diamond table; a bust-out,
--     and the stack-to-zero-first seat move, leave no exit row. 0 of 64,494
--     union exit rows since 2026-11-01 have a zero stack.
--   * 646 horse player-tables since 2026-11-01 have exits through more than
--     one club at the same union table. On 2026-11-02 alone, 14 exit rows
--     through club Y followed (since that player's previous exit there) 48
--     occupancies played through a different club X (3,221 witnessed hands)
--     that ended without an exit row. A zero-contribution hand in such an X
--     occupancy reads the later Y exit. Example (table a8cbda4f, horse
--     7e2aea2c): 62 zero-contribution hands of an occupancy played through
--     a41434bb; the first exit record names 2a1132b9 (16 h later, another
--     seat row) and the unbound dated receipt names a0000000 (an occupancy
--     of 2026-10-27).
--   * Samples of rows that reach step 4 (2026-11-14 06:00-06:10 and
--     2026-11-12 18:00-18:15): the occupancy-bound witness resolved 470 of
--     470 and 240 of 240, never with two clubs; the exit lookup came from a
--     different seat row than the hand's in 8 of 266 and 53 of 89 uses.
--
-- Rake, bbj and pot cannot move: every positive contribution carries its own
-- witness (step 1). Only the hand count of a zero contribution moves.
--
-- THE UNBOUND RECEIPT READ (step 2 as installed) CROSSES SITTINGS TOO. In
-- 2026-11-14 06:00-06:20, 1,099 dealt-in zero-contribution rows had a buy-in
-- receipt only from an EARLIER sitting at that table (2 h 25 m to 35 days
-- old); 152 of those name KINGS CLUB, and 151 of the 152 have a witness in
-- their own sitting naming another club. That is most of KINGS CLUB's hand
-- count since 2026-11-03, when its horses moved to other clubs.
--
-- Measured with this calculator, read-only, every hour of 2026-11-01..14
-- (production 2026-11-16): no positive contribution lacked a witness in any
-- window, so rake, bbj and pot per club are those of the installed calculator.
-- Hands, stored -> this rule, 14 days: Deep Stack Society 1,124,139 ->
-- 1,125,663; The Felt Society 1,117,937 -> 1,129,392; KINGS CLUB 442,439 ->
-- 174,129; Midway Union (table club, no evidence) 0 -> 3,189. 2026-11-14:
-- 78,578 -> 78,656 / 81,316 -> 81,397 / 9,571 -> 1,102 / 0 -> 11.
--
-- PER-RULE COUNTS (read-only, no stored aggregate): the calculation is moved
-- verbatim into fn_ca_club_rake_daily_parts, which also names the rule that
-- placed each part (witness / receipt / seat / same_sitting / table_club;
-- receipt_unbound / seat_unbound for hands with no commit record;
-- whole_hand for a hand with no usable split). fn_ca_club_rake_daily_compute
-- is that function summed, so the totals are the same rows by construction.
-- fn_ca_club_rake_daily_rule_counts(from, to) sums it by day, club and rule;
-- its hands add up to fn_ca_club_rake_daily_compute's hands per club and day.
-- All three are SECURITY DEFINER, STABLE, search_path=public, service_role
-- only, and write nothing.
--
-- NO HISTORY IS REBUILT. This changes future computations only: the live
-- per-hand rollup at commit and any later rebuild. Existing ca_club_rake_daily
-- rows stay as written; fn_ca_club_rake_daily_rebuild_range is the supported
-- door if an operator decides to recompute a closed day. No wallet, ledger,
-- settlement, scheduler or live-game state is changed.
--
-- @live-proof: position('fn_ca_club_rake_daily_parts(p_from, p_to, p_ids)' IN pg_get_functiondef('public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure))>0 AND position('|same_sitting' IN pg_get_functiondef('public.fn_ca_club_rake_daily_parts(timestamptz,timestamptz,uuid[])'::regprocedure))>0 AND position('ca_seat_stack_exits' IN pg_get_functiondef('public.fn_ca_club_rake_daily_parts(timestamptz,timestamptz,uuid[])'::regprocedure))=0 AND position('club_members' IN pg_get_functiondef('public.fn_ca_club_rake_daily_parts(timestamptz,timestamptz,uuid[])'::regprocedure))=0 AND (SELECT bool_and(p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=public'] AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) FROM pg_proc p WHERE p.oid IN ('public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure,'public.fn_ca_club_rake_daily_parts(timestamptz,timestamptz,uuid[])'::regprocedure,'public.fn_ca_club_rake_daily_rule_counts(timestamptz,timestamptz)'::regprocedure))

BEGIN;
SET LOCAL lock_timeout = '1s';

-- The body below replaces exactly production's current one, and nothing else.
DO $preimage$
DECLARE c_sig constant regprocedure := 'public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure;
BEGIN
  IF md5(pg_get_functiondef(c_sig)) IS DISTINCT FROM '855d57a4f57455e062a13e6f44faf296' THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_PREIMAGE_CHANGED: %', md5(pg_get_functiondef(c_sig)) USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.fn_ca_club_rake_daily_parts(timestamptz,timestamptz,uuid[])') IS NOT NULL
     OR to_regprocedure('public.fn_ca_club_rake_daily_rule_counts(timestamptz,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_PREIMAGE_CHANGED: parts or rule counts already exist' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('ca.club_rake_seat_club_meta',
    (SELECT jsonb_build_object('o',proowner::regrole::text,'a',proacl::text,'s',prosecdef,'c',proconfig,'v',provolatile,'l',prolang::text)::text
       FROM pg_proc WHERE oid = c_sig), true);
END
$preimage$;

-- The calculation, one row per part, with the rule that placed it.
CREATE FUNCTION public.fn_ca_club_rake_daily_parts(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[])
 RETURNS TABLE(club_id uuid, stat_date date, hands bigint, rake numeric, bbj numeric, pot numeric, source_rows bigint, rule text, player_rows bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT r.id, r.hand_id, r.table_id, r.club_id, r.created_at,
           coalesce(r.rake_amount, 0) AS rake, coalesce(r.bbj_contribution, 0) AS bbj,
           coalesce(r.pot_size, 0) AS pot, r.player_contributions
      FROM rake_records r
     WHERE p_ids IS NOT NULL AND r.id = ANY (p_ids)
       AND r.club_id IS NOT NULL AND NOT coalesce(r.is_tournament, false)
       AND public.fn_ca_launch_accounting_accepts(r.club_id,r.created_at)
    UNION ALL
    SELECT r.id, r.hand_id, r.table_id, r.club_id, r.created_at,
           coalesce(r.rake_amount, 0), coalesce(r.bbj_contribution, 0),
           coalesce(r.pot_size, 0), r.player_contributions
      FROM rake_records r
     WHERE p_ids IS NULL AND r.created_at >= p_from AND r.created_at < p_to
       AND r.club_id IS NOT NULL AND NOT coalesce(r.is_tournament, false)
       AND public.fn_ca_launch_accounting_accepts(r.club_id,r.created_at)
  ),
  tbl AS (
    SELECT s.id, s.hand_id, s.club_id AS table_club, (s.created_at AT TIME ZONE 'UTC')::date AS day,
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
           split_part(w.v, '|', 1)::uuid AS club_id, split_part(w.v, '|', 2) AS rule
      FROM contrib c JOIN tbl b ON b.id = c.id
      CROSS JOIN LATERAL (SELECT
           -- The witness wins. Without it, every reading is of the occupancy
           -- the hand was dealt from: its receipt, its seat row, or this
           -- player's own witness on a neighbouring hand of the same
           -- occupancy. Never a later or earlier sitting, never a membership.
           coalesce((SELECT ra.club_id::text || '|witness' FROM rake_attributions ra
                      WHERE ra.rake_record_id = c.id AND ra.player_id = c.uid AND ra.club_id IS NOT NULL
                      LIMIT 1),
             (SELECT coalesce(
                    CASE WHEN o.sj IS NOT NULL THEN
                    (SELECT x.funding_club_id::text || '|receipt' FROM public.cash_participant_funding_receipts x
                      WHERE x.operation_kind = 'buyin' AND x.table_id = b.table_id
                        AND x.account_entity_id = c.uid AND x.funding_club_id IS NOT NULL
                        AND x.seat_joined_at = o.sj
                      LIMIT 1)
                    ELSE
                    (SELECT x.funding_club_id::text || '|receipt_unbound' FROM public.cash_participant_funding_receipts x
                      WHERE x.operation_kind = 'buyin' AND x.table_id = b.table_id
                        AND x.account_entity_id = c.uid AND x.seat_joined_at <= b.created_at
                      ORDER BY x.seat_joined_at DESC LIMIT 1)
                    END,
                    CASE WHEN o.sj IS NOT NULL THEN
                    (SELECT ts.club_id::text || '|seat' FROM public.table_seats ts
                      WHERE ts.table_id = b.table_id AND ts.user_id = c.uid
                        AND ts.club_id IS NOT NULL AND ts.joined_at = o.sj
                      LIMIT 1)
                    ELSE
                    (SELECT ts.club_id::text || '|seat_unbound' FROM public.table_seats ts
                      WHERE ts.table_id = b.table_id AND ts.user_id = c.uid
                        AND ts.club_id IS NOT NULL AND ts.joined_at <= b.created_at
                      ORDER BY ts.joined_at DESC LIMIT 1)
                    END,
                    CASE WHEN o.sj IS NOT NULL THEN
                    (SELECT CASE WHEN count(DISTINCT n.club_id) = 1 THEN min(n.club_id::text) || '|same_sitting' END
                       FROM (
                         (SELECT pw.club_id, pw.hand_id FROM public.rake_attributions pw
                           WHERE pw.player_id = c.uid AND pw.table_id = b.table_id AND pw.club_id IS NOT NULL
                             AND pw.created_at >= o.sj AND pw.created_at <= b.created_at
                             AND pw.rake_record_id IS DISTINCT FROM c.id
                           ORDER BY pw.created_at DESC, pw.id DESC LIMIT 1)
                         UNION ALL
                         (SELECT nw.club_id, nw.hand_id FROM public.rake_attributions nw
                           WHERE nw.player_id = c.uid AND nw.table_id = b.table_id AND nw.club_id IS NOT NULL
                             AND nw.created_at > b.created_at AND nw.created_at < b.created_at + interval '7 days'
                           ORDER BY nw.created_at, nw.id LIMIT 1)
                       ) n
                      WHERE EXISTS (
                        SELECT 1 FROM public.hand_atomic_commits nc
                        CROSS JOIN LATERAL jsonb_array_elements(
                          CASE WHEN jsonb_typeof(nc.stack_result #> '{request,stacks}') = 'array'
                               THEN nc.stack_result #> '{request,stacks}' ELSE '[]'::jsonb END) ns
                         WHERE nc.hand_id = n.hand_id AND ns->>'user_id' = c.uid::text
                           AND CASE WHEN ns->>'seat_joined_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
                                    THEN (ns->>'seat_joined_at')::timestamptz END = o.sj))
                    END,
                    b.table_club::text || '|table_club')
                FROM (SELECT
           -- The occupancy this player was dealt in from, as the hand's own
           -- commit record names it (NULL for a hand without one).
           (SELECT CASE WHEN st->>'seat_joined_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
                        THEN (st->>'seat_joined_at')::timestamptz END
              FROM public.hand_atomic_commits hc
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(hc.stack_result #> '{request,stacks}') = 'array'
                     THEN hc.stack_result #> '{request,stacks}' ELSE '[]'::jsonb END) st
             WHERE b.hand_id IS NOT NULL AND hc.hand_id = b.hand_id AND st->>'user_id' = c.uid::text
             LIMIT 1) AS sj) o)) AS v) w
     WHERE c.uid IS NOT NULL AND c.contrib IS NOT NULL AND c.contrib >= 0
  ),
  split AS (
    -- One part per club on the hand; it was placed by the strongest rule
    -- among that club's rows on the hand.
    SELECT a.id, a.club_id, sum(a.contrib) AS contrib, count(*) AS src_rows,
           (array_agg(a.rule ORDER BY array_position(ARRAY['witness','receipt','receipt_unbound','seat','seat_unbound','same_sitting','table_club'], a.rule)))[1] AS rule
      FROM attributed a GROUP BY a.id, a.club_id
  ),
  split_total AS (
    SELECT s.id, sum(s.contrib) AS tot FROM split s GROUP BY s.id
  ),
  hand_rows AS (
    SELECT b.*, EXISTS (SELECT 1 FROM split_total st WHERE st.id = b.id AND st.tot > 0) AS has_split
      FROM tbl b
  )
  -- A union hand with a usable split: rake by contribution share, and one
  -- hand for every club that contributed.
  SELECT s.club_id, h.day, 1::bigint, h.rake * s.contrib / st.tot,
         0::numeric, 0::numeric, s.src_rows, s.rule, s.src_rows
    FROM split s
    JOIN split_total st ON st.id = s.id AND st.tot > 0
    JOIN hand_rows h ON h.id = s.id
  UNION ALL
  -- The table's club: the drop and the pot volume of every hand it hosted,
  -- plus the whole hand when nothing could be attributed.
  SELECT h.table_club, h.day,
         CASE WHEN h.has_split THEN 0 ELSE 1 END,
         CASE WHEN h.has_split THEN 0 ELSE h.rake END,
         h.bbj, h.pot,
         CASE WHEN h.has_split THEN 0 ELSE 1 END,
         CASE WHEN h.has_split THEN 'table_drop_and_pot' ELSE 'whole_hand' END,
         0::bigint
    FROM hand_rows h;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_club_rake_daily_compute(p_from timestamp with time zone, p_to timestamp with time zone, p_ids uuid[])
 RETURNS TABLE(club_id uuid, stat_date date, hands bigint, rake numeric, bbj numeric, pot numeric, source_rows bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Every part of every hand, summed per club and day. The rule that placed
  -- each part is read, never stored, by fn_ca_club_rake_daily_rule_counts.
  SELECT p.club_id, p.stat_date, sum(p.hands)::bigint, sum(p.rake), sum(p.bbj), sum(p.pot),
         sum(p.source_rows)::bigint
    FROM public.fn_ca_club_rake_daily_parts(p_from, p_to, p_ids) p
   GROUP BY p.club_id, p.stat_date;
$function$;

-- Read-only: how many hands each rule placed, per day and club.
CREATE FUNCTION public.fn_ca_club_rake_daily_rule_counts(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(stat_date date, club_id uuid, rule text, hands bigint, player_rows bigint, rake numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.stat_date, p.club_id, p.rule, sum(p.hands)::bigint, sum(p.player_rows)::bigint, sum(p.rake)
    FROM public.fn_ca_club_rake_daily_parts(p_from, p_to, NULL) p
   WHERE p_from IS NOT NULL AND p_to IS NOT NULL AND p_to > p_from AND p_to - p_from <= interval '31 days'
   GROUP BY p.stat_date, p.club_id, p.rule;
$function$;

ALTER FUNCTION public.fn_ca_club_rake_daily_parts(timestamptz, timestamptz, uuid[]) OWNER TO postgres;
ALTER FUNCTION public.fn_ca_club_rake_daily_rule_counts(timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_ca_club_rake_daily_parts(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_club_rake_daily_rule_counts(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_ca_club_rake_daily_compute(timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_rake_daily_parts(timestamptz, timestamptz, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_rake_daily_rule_counts(timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_rake_daily_compute(timestamptz, timestamptz, uuid[]) TO service_role;

-- Same owner, grants, SECURITY DEFINER, STABLE, search_path and language; the
-- exact new bodies; no membership or unbound exit lookup left.
DO $postimage$
DECLARE c_sig constant regprocedure := 'public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])'::regprocedure;
        c_parts constant regprocedure := 'public.fn_ca_club_rake_daily_parts(timestamptz,timestamptz,uuid[])'::regprocedure;
        c_counts constant regprocedure := 'public.fn_ca_club_rake_daily_rule_counts(timestamptz,timestamptz)'::regprocedure;
        v_def text := pg_get_functiondef(c_sig);
        v_parts text := pg_get_functiondef(c_parts);
        f regprocedure;
BEGIN
  IF (SELECT jsonb_build_object('o',proowner::regrole::text,'a',proacl::text,'s',prosecdef,'c',proconfig,'v',provolatile,'l',prolang::text)::text
        FROM pg_proc WHERE oid = c_sig) IS DISTINCT FROM current_setting('ca.club_rake_seat_club_meta', true) THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_AUTHORITY_MOVED' USING ERRCODE = '55000';
  END IF;
  FOREACH f IN ARRAY ARRAY[c_sig, c_parts, c_counts] LOOP
    IF (SELECT NOT (p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public']
                    AND p.proowner = 'postgres'::regrole AND l.lanname = 'sql')
              OR has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
              OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
          FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = f) THEN
      RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_AUTHORITY %', f USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF md5(v_def) IS DISTINCT FROM '08086fee164e22529ad6550cecaf8c39'
     OR md5(v_parts) IS DISTINCT FROM '5dd93d8a35d26759b5a5ffa164af9f46'
     OR md5(pg_get_functiondef(c_counts)) IS DISTINCT FROM 'f7bb7538aedbe8fd286193f93a44a414'
     OR position('club_members' IN v_parts) > 0
     OR position('joined_at ASC' IN v_parts) > 0
     OR position('ca_seat_stack_exits' IN v_parts) > 0
     OR position('fn_ca_club_rake_daily_parts(p_from, p_to, p_ids)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'CLUB_RAKE_SEAT_CLUB_POSTIMAGE % % %', md5(v_def), md5(v_parts), md5(pg_get_functiondef(c_counts)) USING ERRCODE = '55000';
  END IF;
END
$postimage$;

COMMIT;
