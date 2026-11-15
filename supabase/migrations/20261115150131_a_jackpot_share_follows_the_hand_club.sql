-- 20261115150131_a_jackpot_share_follows_the_hand_club.sql
--
-- Version reserved by scripts/reserve-migration-version.sh.
--
-- OWNER RULE (2026-11-15, binding): a player can play in several clubs; each
-- club's numbers reflect ONLY the hands played through that club, and nothing
-- is excluded because a player belongs to several clubs.
--
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-15, audit finding D1):
--
--   bbj_credit_one_recipient pays a Bad Beat Jackpot share to the WALLET of a
--   recipient who has already left the table. It chose that wallet as:
--     1. the latest table_seats row for the table, only if the player's
--        membership in that club was still active/approved;
--     2. else tables.club_id (on a union table that is the union house club);
--     3. else fn_player_home_club (the club holding the player's highest
--        balance).
--   None of those is the club the hand was played through. table_seats rows
--   are gone once a player leaves, so step 1 almost never answered, and the
--   share fell to the union house or to whichever club held the most chips.
--   Measured for Midway Union since 2026-10-15: 218 wallet shares, of which 28
--   (8,663.26, all horses) were credited to a club other than the club the
--   hand's own rake attribution names:
--     week of 2026-10-19: 5,622.29 Felt->Union house, 203.12 KINGS->Union
--                         house, 26.56 Felt->KINGS
--     week of 2026-10-26: 1,424.82 Felt->Union house, 806.26 Felt->KINGS,
--                         261.45 KINGS->Union house, 106.25 KINGS->Felt
--     week of 2026-11-02: 212.51 KINGS->Union house
--   (read as "earning club -> wallet credited"). The weekly award reader
--   fn_union_pnl_week_bbj_stack_awards then attributed each wallet share to
--   the club of the wallet, so the statement of the wrong club carried it.
--
-- WHAT THIS DOES:
--
--   1. bbj_credit_one_recipient resolves a departed recipient's club from the
--      HAND: rake_attributions for (payout hand, recipient) - written before
--      the payout in every one of 271 measured shares (median 1.2 s before) -
--      else the cash buy-in receipt that funded this recipient's seat at this
--      table before the payout. It credits THAT club's retained member record
--      whatever its membership status (a suspended membership still owns its
--      wallet). If no such record exists the share is parked exactly as
--      before (bbj_unclaimed_shares; funding returned once). tables.club_id
--      and fn_player_home_club are no longer consulted: neither says where
--      the hand was played.
--   2. fn_union_pnl_week_bbj_stack_awards attributes a wallet share to the
--      hand's earning club (rake_attributions) and falls back to the credited
--      wallet's club only where the hand left no attribution. Every proof
--      condition of the wallet branch is unchanged.
--   3. original_inventory_proof_sources_match follows the reader's new body
--      (md5 read back from the catalog, never hardcoded).
--
-- NO BALANCE IS WRITTEN BY THIS MIGRATION. The 28 past shares are settled (or
-- recorded as not settleable) in docs/changelog/2026-11-15-a-jackpot-share-
-- follows-the-hand-club.md: 27 of the 28 wrong wallets no longer hold the
-- share (moving it back would take chips from a player, CLAUDE.md 10.9 rule
-- 3), and the remaining one would move chips into a suspended membership.
-- Issued statements are never edited.
--
-- @live-proof: position('THE HAND''S CLUB (owner rule 2026-11-15)' IN pg_get_functiondef('public.bbj_credit_one_recipient(uuid,uuid,uuid,numeric,boolean)'::regprocedure))>0 AND position('fn_player_home_club' IN pg_get_functiondef('public.bbj_credit_one_recipient(uuid,uuid,uuid,numeric,boolean)'::regprocedure))=0 AND position('ra.player_id=r.user_id' IN pg_get_functiondef('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)'::regprocedure))>0 AND smarter_private.original_inventory_proof_sources_match() IS TRUE

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.bbj_credit_one_recipient(uuid,uuid,uuid,numeric,boolean)'::regprocedure))
       IS DISTINCT FROM 'f06e9b6c154183bb8ee404e4cc979dec' THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_PREIMAGE_CHANGED: bbj_credit_one_recipient' USING ERRCODE = '55000';
  END IF;
  IF md5(pg_get_functiondef('public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)'::regprocedure))
       IS DISTINCT FROM 'faf875701e49db1cf99b481119e87404' THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_PREIMAGE_CHANGED: fn_union_pnl_week_bbj_stack_awards' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_SOURCES_ALREADY_DIFFER' USING ERRCODE = '55000';
  END IF;
END
$preimage$;

-- -----------------------------------------------------------------------------
-- 1. A departed recipient is paid in the club the hand was played through.
-- -----------------------------------------------------------------------------
DO $credit$
DECLARE
  c_sig constant text := 'public.bbj_credit_one_recipient(uuid,uuid,uuid,numeric,boolean)';
  c_from constant text := '/* THE SEAT''S CLUB FIRST (BBJ audit 2026-09-05).';
  c_to constant text := E'v_club := public.fn_player_home_club(p_user_id, NULL);\n  END IF;\n';
  c_park_old constant text := 'no club wallet resolved; share returned once to its funding bank and remains owed';
  c_park_new constant text := 'no member record in the club the hand was played through; share returned once to its funding bank and remains owed';
  c_body constant text :=
       E'/* THE HAND''S CLUB (owner rule 2026-11-15). "Each club''s numbers reflect\n'
    || E'     ONLY the hands played through that club." A departed recipient is paid\n'
    || E'     in the club this hand was played through: the hand''s own rake\n'
    || E'     attribution for the recipient, else the cash buy-in receipt that funded\n'
    || E'     the recipient''s seat at this table before the payout. Never the table''s\n'
    || E'     owner club and never a "home" club - neither says where the hand was\n'
    || E'     played (28 shares, 8,663.26, landed in the wrong club that way between\n'
    || E'     2026-10-19 and 2026-11-08). The club''s retained member record takes the\n'
    || E'     credit whatever its membership status; with no record the share parks. */\n'
    || E'  SELECT ra.club_id INTO v_club\n'
    || E'    FROM public.bbj_payouts hand_payout\n'
    || E'    JOIN public.rake_attributions ra ON ra.hand_id = hand_payout.hand_id\n'
    || E'   WHERE hand_payout.id = p_payout_id AND ra.player_id = p_user_id AND ra.club_id IS NOT NULL\n'
    || E'   ORDER BY ra.created_at DESC, ra.id DESC LIMIT 1;\n'
    || E'  IF v_club IS NULL THEN\n'
    || E'    SELECT x.funding_club_id INTO v_club\n'
    || E'      FROM public.cash_participant_funding_receipts x\n'
    || E'      JOIN public.bbj_payouts seat_payout ON seat_payout.id = p_payout_id\n'
    || E'     WHERE x.operation_kind = ''buyin'' AND x.table_id = p_table_id\n'
    || E'       AND x.account_entity_id = p_user_id AND x.funding_club_id IS NOT NULL\n'
    || E'       AND x.seat_joined_at <= seat_payout.created_at\n'
    || E'     ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1;\n'
    || E'  END IF;\n'
    || E'  IF v_club IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.club_members cm\n'
    || E'                                         WHERE cm.user_id = p_user_id AND cm.club_id = v_club) THEN\n'
    || E'    v_club := NULL;\n'
    || E'  END IF;\n';
  d text; i_from int; i_to int; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_from, ''))) / length(c_from) <> 1
     OR (length(d) - length(replace(d, c_to, ''))) / length(c_to) <> 1
     OR (length(d) - length(replace(d, c_park_old, ''))) / length(c_park_old) <> 1 THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_CREDIT_ANCHOR' USING ERRCODE = '55000';
  END IF;
  i_from := position(c_from IN d);
  i_to := position(c_to IN d) + length(c_to);
  IF i_to <= i_from THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_CREDIT_ANCHOR_ORDER' USING ERRCODE = '55000';
  END IF;
  d := substr(d, 1, i_from - 1) || c_body || substr(d, i_to);
  d := replace(d, c_park_old, c_park_new);
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE d;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> d
     OR position('fn_player_home_club' IN d) > 0
     OR position('FROM public.tables t' IN d) > 0 THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_CREDIT_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$credit$;

-- -----------------------------------------------------------------------------
-- 2. The weekly award reader attributes a wallet share to the hand's club.
-- -----------------------------------------------------------------------------
DO $reader$
DECLARE
  c_sig constant text := 'public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)';
  c_old constant text := 'SELECT q.ledger_id,(q.l->>''club_id'')::uuid club_id,r.user_id,r.amount,b.id payout_id';
  c_new constant text := E'-- The hand''s earning club (owner rule 2026-11-15), the credited wallet''s\n'
    || E'  -- club only where the hand left no attribution.\n'
    || E'  SELECT q.ledger_id,COALESCE((SELECT ra.club_id FROM public.rake_attributions ra\n'
    || E'    WHERE ra.hand_id=b.hand_id AND ra.player_id=r.user_id AND ra.club_id IS NOT NULL\n'
    || E'    ORDER BY ra.created_at DESC,ra.id DESC LIMIT 1),(q.l->>''club_id'')::uuid) club_id,r.user_id,r.amount,b.id payout_id';
  d text; m jsonb; m2 jsonb;
BEGIN
  d := pg_get_functiondef(c_sig::regprocedure);
  IF (length(d) - length(replace(d, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_READER_ANCHOR' USING ERRCODE = '55000';
  END IF;
  d := replace(d, c_old, c_new);
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_sig::regprocedure;
  EXECUTE d;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_sig::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_sig::regprocedure) <> d THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_READER_POSTIMAGE %', md5(pg_get_functiondef(c_sig::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$reader$;

-- -----------------------------------------------------------------------------
-- 3. The proof source list follows the reader's new body. The new md5 is read
--    back from the catalog under the list's own search_path (pg_catalog).
-- -----------------------------------------------------------------------------
DO $sources_pin$
DECLARE
  c_psm    constant text := 'smarter_private.original_inventory_proof_sources_match()';
  c_reader constant text := 'public.fn_union_pnl_week_bbj_stack_awards(uuid,timestamptz,timestamptz)';
  old_reader constant text := 'faf875701e49db1cf99b481119e87404';
  new_reader text; d text; p text; m jsonb; m2 jsonb; previous text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  new_reader := md5(pg_get_functiondef(c_reader::regprocedure));
  PERFORM set_config('search_path', previous, true);
  IF new_reader IS NOT DISTINCT FROM old_reader THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_READER_UNCHANGED' USING ERRCODE = '55000';
  END IF;
  d := pg_get_functiondef(c_psm::regprocedure);
  IF (length(d) - length(replace(d, old_reader, ''))) / length(old_reader) <> 1 THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_SOURCES_ANCHOR' USING ERRCODE = '55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m FROM pg_proc WHERE oid = c_psm::regprocedure;
  p := replace(d, old_reader, new_reader);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_psm::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm::regprocedure) <> p THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_SOURCES_POSTIMAGE %', md5(pg_get_functiondef(c_psm::regprocedure)) USING ERRCODE = '55000';
  END IF;
END
$sources_pin$;

-- 4. The pinned set holds again and no stale pin is left behind.
DO $pins_hold$
DECLARE v_stale text;
BEGIN
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_SOURCES_STILL_DIFFER' USING ERRCODE = '55000';
  END IF;
  IF smarter_private.original_inventory_basis_generation() NOT LIKE 'original-inventory-245-v1:%' THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_GENERATION_SHAPE: %', smarter_private.original_inventory_basis_generation() USING ERRCODE = '55000';
  END IF;
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES ('faf875701e49db1cf99b481119e87404'),
                 ('f06e9b6c154183bb8ee404e4cc979dec')) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'JACKPOT_HAND_CLUB_LEFT_A_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$pins_hold$;

COMMIT;
