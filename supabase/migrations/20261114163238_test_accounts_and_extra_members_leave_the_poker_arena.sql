-- 20261114163238_test_accounts_and_extra_members_leave_the_poker_arena.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- OWNER INSTRUCTION (Dan, 2026-11-14 10:02 Chicago, with a screenshot of the
-- Midway Union cashier listing PostDeployf5601 beside KingFish):
--   "1, REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE POKER ARENA.
--    2, REMOVE ANY AND ALL PLAYERS FROM THE MIDWAY UNION THAT SHOULD NOT BE
--    THERE, KINGFISH, AND SMARTERPOKEROFFICIAL ARE THE ONLY ONES THAT SHOULD
--    BE THERE."
--
-- WHAT WAS WRONG, READ FROM ROWS (2026-11-14 16:00-16:30 UTC):
--
--   * 1,273 reserved post-deploy certification identities
--     (ca-customization-cert-postdeploy-*@example.invalid: 568 named
--     PostDeploy*, 705 named crest_cert*) still held profiles.status 'active',
--     from 2026-10-28 to today. 1,224 had already been retired in Auth by the
--     cleanup door's retained-ledger-actor branch, which signs the identity out
--     and keeps its profile because the chip ledger names it, but never marks
--     that profile deleted. So every one of them stayed a live, searchable
--     player. 48 still held ACTIVE club memberships in 25 clubs (15.80 chips,
--     no promo, credit, held, locked or diamond custody), and 22 members still
--     had one as their agent (8 in active clubs, re-homed by the deletion; 14
--     in retired fixture clubs, frozen history).
--   * Midway Union (clubs.id fade0000-...-0001) held seven active members:
--     KingFish (owner), SmarterPokerOfficial, Johnny (1250), Danny (1259),
--     minhloc73gr (911830), Chase45 (1263) and PostDeployf5601 (1013864, a
--     test admin added at 15:33 UTC today). The four players hold no balance,
--     agent wallet, downline, seat, entry, cash out, escrow, ticket or chip
--     request in Midway (read at 16:20 UTC).
--
-- WHAT THIS DOES:
--
--   1. THE ROOT: the cleanup door's retained-ledger-actor readback now marks the
--      identity's profile 'deleted' before it answers 'retained_ledger_actor'.
--      The October 16 deleted-account triggers then do what a deletion always
--      does - free chips back to the club bank through the ledger, every
--      membership departed, every list stops showing it (CLAUDE.md 10.12: the
--      writer is fixed, no sweep). The door already requires zero club rows
--      before that answer, so the departure has nothing to move.
--   2. A live certification identity is never listed in another person's
--      cashier: fn_club_cashier_members_page_v3 (the Trade cashier roster)
--      skips reserved certification identities unless the viewer is that
--      identity. The post-deploy run still holds the staff roles it needs (the
--      Lightning operator certificate is a Midway admin by Dan's 2026-10-24
--      ruling, "Admin on Midway"); nobody else sees it while it runs.
--   3. Invoice delivery never addresses a deleted account, a departed
--      membership or a test identity: fn_accounting_invoice_party_users reads
--      only live, non-test profiles and active memberships.
--   4. The residue leaves for good: every reserved identity older than the
--      162-minute certificate age floor (STALE_ACCOUNT_AGE_MS, so no running
--      certificate loses its account) that owns no active club is marked
--      'deleted' through the same triggers. The six that still own a 'Cert HU'
--      or 'Crest Cert Template' fixture club are left to their own guarded
--      retirement door (cleanupStaleCertificationClubs), never orphaned here.
--   5. Midway Union keeps only KingFish and SmarterPokerOfficial: the four
--      players leave through the staff door fn_remove_settled_club_member,
--      acting as the club owner KingFish exactly as the Remove button does
--      (audited, records retained). PostDeployf5601 left in step 4 when it
--      was older than the age floor at install, otherwise its own run's
--      cleanup removes it for good through step 1.
--
-- Rehearsed 2026-11-14 in one self-aborting block on production (rolled
-- back): 1,260 identities marked, 15.80 chips left the wallets and 15.80
-- arrived in the one receiving bank, 0 active memberships left in active
-- clubs, the four Midway players departed through the staff door, 4.3 s.
--
-- No balance column is written here: chips move only through
-- fn_ca_deleted_wallet_bank_return inside the deletion trigger. No row is
-- deleted. Every assertion below aborts the whole transaction if the board
-- moved since it was read.
--
-- @live-proof: position('fn_ca_reserved_certification_identity' IN pg_get_functiondef('public.fn_club_cashier_members_page_v3(uuid,integer,uuid,integer)'::regprocedure))>0 AND position('status IS DISTINCT FROM ''deleted''' IN pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure))>0 AND NOT EXISTS (SELECT 1 FROM public.club_members m JOIN public.profiles p ON p.id=m.user_id WHERE m.club_id='fade0000-0000-0000-0000-000000000001' AND m.membership_lifecycle_status='active' AND p.id NOT IN ('47965354-0e56-43ef-931c-ddaab82af765','2d1cd6c3-5700-4af9-a271-d4863fdab20d') AND NOT COALESCE(p.is_horse,false) AND NOT public.fn_ca_reserved_certification_identity(p.id))

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '170s';

-- -----------------------------------------------------------------------------
-- Preimages: a function changed since it was read on 2026-11-14 is a different
-- decision. Refuse rather than overwrite someone else's change.
-- -----------------------------------------------------------------------------
DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure))
       IS DISTINCT FROM '49c918b1d5efc3e6841d7f4494bc48f9'
     OR md5(pg_get_functiondef('public.fn_club_cashier_members_page_v3(uuid,integer,uuid,integer)'::regprocedure))
       IS DISTINCT FROM '69233cd46670fbc2989173f6ba9f4328'
     OR md5(pg_get_functiondef('public.fn_accounting_invoice_party_users(text,uuid)'::regprocedure))
       IS DISTINCT FROM '415fb20fcbac87a99e480e90b0ae4ea7' THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_PREIMAGE_CHANGED';
  END IF;
END
$preimage$;

-- -----------------------------------------------------------------------------
-- One predicate for "a reserved post-deploy certification identity". The
-- namespace is the one the cleanup door, the stale sweep and the retirement
-- script already admit; never a horse, never a platform admin.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_reserved_certification_identity(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user_id
       AND (p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
         OR p.email LIKE 'club-create-cert-%@smarter-poker.invalid')
       AND NOT COALESCE(p.is_horse, false)
       AND NOT COALESCE(p.is_admin, false)
  )
$function$;
-- Read only inside SECURITY DEFINER functions, which run as their owner; no
-- browser role needs to call it.
REVOKE ALL ON FUNCTION public.fn_ca_reserved_certification_identity(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_reserved_certification_identity(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 1. The cleanup door's retained-ledger readback marks the profile deleted.
-- The body is the installed body with one block extended; the preimage digest
-- above pins every other byte.
-- -----------------------------------------------------------------------------
DO $door$
DECLARE
  c_old constant text := E'    IF public.fn_ca_certification_identity_retired(p_user_id) THEN\n'
    || E'      RETURN jsonb_build_object(''success'', true, ''disposition'', ''retained_ledger_actor'',\n'
    || E'                               ''user_id'', p_user_id);\n'
    || E'    END IF;';
  c_new constant text := E'    IF public.fn_ca_certification_identity_retired(p_user_id) THEN\n'
    || E'      -- REMOVED FOR GOOD (owner, 2026-11-14): a retired test identity is a\n'
    || E'      -- deleted account. The deleted-account triggers return any free chips\n'
    || E'      -- to the club bank and depart every membership; retirement above has\n'
    || E'      -- already proved there is none. Idempotent on replay.\n'
    || E'      UPDATE public.profiles SET status = ''deleted'', updated_at = now()\n'
    || E'       WHERE id = p_user_id AND status IS DISTINCT FROM ''deleted'';\n'
    || E'      RETURN jsonb_build_object(''success'', true, ''disposition'', ''retained_ledger_actor'',\n'
    || E'                               ''user_id'', p_user_id);\n'
    || E'    END IF;';
  v_def text := pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure);
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_DOOR_PATCH_MISMATCH';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
  IF position('status IS DISTINCT FROM ''deleted''' IN
       pg_get_functiondef('public.cleanup_reserved_certification_account(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_DOOR_INSTALL_MISMATCH';
  END IF;
END
$door$;

-- -----------------------------------------------------------------------------
-- 2. The Trade cashier roster never lists another person's test identity.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_club_cashier_members_page_v3(p_club_id uuid, p_after_role_rank integer DEFAULT NULL::integer, p_after_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 500)
 RETURNS TABLE(user_id uuid, role text, role_rank integer, depth integer, chip_balance numeric, name text, username text, player_number text, avatar_url text, is_horse boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select m.user_id, m.role, m.role_rank, m.depth, m.chip_balance,
         m.name, m.username, m.player_number, m.avatar_url, (public.fn_can_see_horse_flag(p_club_id) AND COALESCE(m.is_horse,false))
    from public.fn_club_cashier_members_v2(p_club_id) m
   where (m.user_id = auth.uid() or not public.fn_ca_reserved_certification_identity(m.user_id))
     and (p_after_role_rank is null
      or m.role_rank < p_after_role_rank
      or (m.role_rank = p_after_role_rank and m.user_id > p_after_user_id))
   order by m.role_rank desc, m.user_id
   limit greatest(1, least(coalesce(p_limit, 500), 500))
$function$;
-- The grants it already holds on production, stated: signed-in players only.
REVOKE ALL ON FUNCTION public.fn_club_cashier_members_page_v3(uuid,integer,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_club_cashier_members_page_v3(uuid,integer,uuid,integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. An invoice is never addressed to a deleted account or a departed member.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_accounting_invoice_party_users(p_kind text, p_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 -- The people of record behind one party of an accounting transfer: the same
 -- rule as fn_accounting_party_users, without its caller filter. For invoice
 -- delivery only; no browser role may execute it. A deleted account and a
 -- departed membership are never people of record (owner, 2026-10-16 and
 -- 2026-11-14).
 SELECT DISTINCT p.id FROM public.profiles p WHERE p.status IS DISTINCT FROM 'deleted'
  AND NOT public.fn_ca_reserved_certification_identity(p.id) AND p.id IN (
  SELECT p_id WHERE p_kind IN('agent','player')
  UNION SELECT c.owner_id FROM public.clubs c WHERE p_kind='club' AND c.id=p_id
  UNION SELECT m.user_id FROM public.club_members m WHERE p_kind='club' AND m.club_id=p_id
   AND m.role IN('owner','co_owner','admin') AND COALESCE(m.status,'active') IN('active','approved')
   AND m.membership_lifecycle_status='active'
  UNION SELECT u.owner_id FROM public.unions u WHERE p_kind='union' AND u.id=p_id
  UNION SELECT a.user_id FROM public.union_admins a WHERE p_kind='union' AND a.union_id=p_id
   AND public.fn_union_overseer_of_record(p_id,a.user_id)
 );
$function$;
-- The grants it already holds on production, stated: delivery only.
REVOKE ALL ON FUNCTION public.fn_accounting_invoice_party_users(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_accounting_invoice_party_users(text,uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. The residue leaves for good, through the deleted-account triggers.
-- -----------------------------------------------------------------------------
DO $residue$
DECLARE
  v_candidates integer;
  v_marked integer;
  v_bank_before numeric;
  v_bank_after numeric;
  v_wallets_before numeric;
BEGIN
  CREATE TEMP TABLE ca_retiring_test_identity ON COMMIT DROP AS
  SELECT p.id
    FROM public.profiles p
   WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     AND p.status IS DISTINCT FROM 'deleted'
     AND NOT COALESCE(p.is_horse, false) AND NOT COALESCE(p.is_admin, false)
     AND p.created_at < now() - interval '162 minutes'
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.owner_id = p.id AND c.lifecycle_status = 'active');
  SELECT count(*) INTO v_candidates FROM pg_temp.ca_retiring_test_identity;
  -- Read 2026-11-14: 1,265 old enough, 6 owners of active fixture clubs.
  IF v_candidates < 1000 OR v_candidates > 1400 THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_COHORT_MOVED: %', v_candidates;
  END IF;

  -- Conservation: the free chips leaving these wallets arrive in club banks.
  SELECT COALESCE(sum(COALESCE(m.chip_balance, 0) - COALESCE(m.held_chips, 0) - COALESCE(m.locked_chips, 0)), 0)
    INTO v_wallets_before
    FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
   WHERE m.user_id IN (SELECT id FROM pg_temp.ca_retiring_test_identity)
     AND c.lifecycle_status = 'active' AND c.asset = 'chips'
     AND COALESCE(m.chip_balance, 0) - COALESCE(m.held_chips, 0) - COALESCE(m.locked_chips, 0) > 0;
  IF v_wallets_before > 100 THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_CHIPS_MOVED: %', v_wallets_before;
  END IF;
  -- Only the banks that receive chips are measured, and they are locked first
  -- so nothing else moves them between the two reads (read 2026-11-14: one
  -- 'Cert HU' fixture club, 15.80 chips).
  CREATE TEMP TABLE ca_receiving_bank ON COMMIT DROP AS
  SELECT DISTINCT m.club_id
    FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
   WHERE m.user_id IN (SELECT id FROM pg_temp.ca_retiring_test_identity)
     AND c.lifecycle_status = 'active' AND c.asset = 'chips'
     AND COALESCE(m.chip_balance, 0) - COALESCE(m.held_chips, 0) - COALESCE(m.locked_chips, 0) > 0;
  PERFORM 1 FROM public.clubs c WHERE c.id IN (SELECT club_id FROM pg_temp.ca_receiving_bank)
   ORDER BY c.id FOR UPDATE;
  SELECT COALESCE(sum(c.chip_treasury), 0) INTO v_bank_before
    FROM public.clubs c WHERE c.id IN (SELECT club_id FROM pg_temp.ca_receiving_bank);

  UPDATE public.profiles p
     SET status = 'deleted', updated_at = now()
   WHERE p.id IN (SELECT id FROM pg_temp.ca_retiring_test_identity)
     AND p.status IS DISTINCT FROM 'deleted';
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  IF v_marked <> v_candidates THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_COUNT_MISMATCH: % of %', v_marked, v_candidates;
  END IF;

  SELECT COALESCE(sum(c.chip_treasury), 0) INTO v_bank_after
    FROM public.clubs c WHERE c.id IN (SELECT club_id FROM pg_temp.ca_receiving_bank);
  IF EXISTS (SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
              WHERE m.user_id IN (SELECT id FROM pg_temp.ca_retiring_test_identity)
                AND c.lifecycle_status = 'active'
                AND m.membership_lifecycle_status = 'active') THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_MEMBERSHIP_REMAINS';
  END IF;
  -- Active clubs only: a retired fixture club's rows are frozen history the
  -- deletion path never edits (read 2026-11-14: 14 such rows, in seven
  -- retired 'Cert RH' / 'Cert HU' clubs, every one of them between two test
  -- identities).
  IF EXISTS (SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id = m.club_id
              WHERE m.membership_lifecycle_status = 'active' AND c.lifecycle_status = 'active'
                AND (m.agent_id IN (SELECT id FROM pg_temp.ca_retiring_test_identity)
                  OR m.parent_agent_id IN (SELECT id FROM pg_temp.ca_retiring_test_identity))) THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_DOWNLINE_REMAINS';
  END IF;
  IF round(v_bank_after - v_bank_before, 2) <> round(v_wallets_before, 2) THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_REMOVAL_BANK_RETURN_MISMATCH: bank % wallets %',
      round(v_bank_after - v_bank_before, 2), v_wallets_before;
  END IF;
  RAISE NOTICE 'TEST_ACCOUNTS_LEFT: % identities deleted, % chips returned to club banks',
    v_marked, v_wallets_before;
END
$residue$;

-- -----------------------------------------------------------------------------
-- 5. Midway Union keeps KingFish and SmarterPokerOfficial only. The four
-- players leave through the staff door as the club owner, exactly as the
-- Remove button does. A refusal aborts the whole migration.
-- -----------------------------------------------------------------------------
DO $midway$
DECLARE
  c_midway constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_kingfish constant uuid := '47965354-0e56-43ef-931c-ddaab82af765';
  c_official constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d';
  v_saved_claims text := current_setting('request.jwt.claims', true);
  v_saved_sub text := current_setting('request.jwt.claim.sub', true);
  v_target uuid;
  v_result jsonb;
  v_left integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = c_midway AND owner_id = c_kingfish) THEN
    RAISE EXCEPTION 'MIDWAY_OWNER_CHANGED';
  END IF;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', c_kingfish, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c_kingfish::text, true);
  FOR v_target IN
    SELECT m.user_id
      FROM public.club_members m JOIN public.profiles p ON p.id = m.user_id
     WHERE m.club_id = c_midway
       AND m.membership_lifecycle_status = 'active'
       AND m.user_id NOT IN (c_kingfish, c_official)
       AND NOT COALESCE(p.is_horse, false)
       -- A test identity a certificate is using right now leaves with its run
       -- (the door above), never through the staff door, which refuses staff.
       AND NOT public.fn_ca_reserved_certification_identity(m.user_id)
     ORDER BY m.user_id
  LOOP
    v_result := public.fn_remove_settled_club_member(c_midway, v_target);
    IF COALESCE(v_result->>'success', 'false') <> 'true' THEN
      RAISE EXCEPTION 'MIDWAY_MEMBER_REMOVAL_REFUSED: % %', v_target, v_result::text;
    END IF;
    v_left := v_left + 1;
  END LOOP;
  PERFORM set_config('request.jwt.claims', COALESCE(v_saved_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_saved_sub, ''), true);
  -- Read 2026-11-14: Johnny, Danny, minhloc73gr and Chase45. A run that finds
  -- more than that has met a member nobody reviewed and stops.
  IF v_left > 4 THEN
    RAISE EXCEPTION 'MIDWAY_REMOVAL_COHORT_MOVED: %', v_left;
  END IF;
  IF EXISTS (SELECT 1 FROM public.club_members m JOIN public.profiles p ON p.id = m.user_id
              WHERE m.club_id = c_midway AND m.membership_lifecycle_status = 'active'
                AND m.user_id NOT IN (c_kingfish, c_official)
                AND NOT COALESCE(p.is_horse, false)
                AND NOT public.fn_ca_reserved_certification_identity(m.user_id)) THEN
    RAISE EXCEPTION 'MIDWAY_UNEXPECTED_MEMBER_REMAINS';
  END IF;
  RAISE NOTICE 'MIDWAY_ROSTER_CLEAN: % members departed', v_left;
END
$midway$;

COMMIT;
