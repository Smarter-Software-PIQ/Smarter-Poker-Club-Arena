-- 20261112205705_post_deploy_test_accounts_leave_kings_club_and_the_union.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Dan, 2026-11-12, inside KINGS CLUB Player Management: "REMOVE ANY AND ALL
-- 'POSTDEPLOY' ACCOUNTS."
--
-- WHAT WAS WRONG (read from production 2026-11-12 20:50 UTC)
--
-- Post-deploy certification identities (PostDeployxxxxx / Certpostxxxxxxx,
-- ca-customization-cert-postdeploy-*@example.invalid) were again sitting in
-- Dan's real clubs: 8 stale ones (3 to 80 hours old, every one past the
-- 162-minute STALE_ACCOUNT_AGE_MS floor) held 13 active memberships across
-- KINGS CLUB (6 admin, 2 player), Deep Stack Society (3 admin) and Midway
-- Union (3 admin), all zero chip and zero promo balance, none seated. The
-- same pattern 20261026050506 settled on 2026-10-26: a certification run's own
-- cleanup did not complete, and the operator-only Cert Residue Sweep last ran
-- on 2026-11-09 and failed before reaching them.
--
-- Probed in a rolled-back transaction (one DO block raising at its end, per
-- CLAUDE.md 11.5): cleanup_reserved_certification_account answered success
-- for 6 of the 8, auth_soft_delete_required for 1 (PostDeployda705, an
-- immutable-ledger actor whose memberships the door still departs), and
-- refused 1 (PostDeploy7c3c4: CERTIFICATION_PROTECTED_MEMBERSHIP_HAS_AUTHORITY_
-- OR_CUSTODY, it owns an unretired 'Crest Cert Template' club). The refused
-- identity's three staff memberships are departed through the lifecycle
-- departure write, exactly as 20261026050506 did for its three refusals: the
-- rows stay for the journals and are no longer members of anything.
--
-- WHAT THIS CHANGES
--
-- Data only, one transaction, no DDL, no schema reload, no money moves:
--   1. Every live reserved certification identity older than 162 minutes with
--      an active membership in one of the three real clubs goes through the
--      cleanup door. A run that is still inside its own window is never
--      touched; it removes its own identity when it finishes.
--   2. A door refusal departs only that identity's zero-balance memberships
--      in the three real clubs. A membership holding chips is left alone and
--      reported, never departed.
--   3. The transaction asserts that no live reserved identity older than the
--      floor remains an active member of the three clubs, so it aborts
--      instead of committing a half-done settlement.
--
-- The Auth retirement of auth_soft_delete_required actors stays with the
-- certification cleanup scripts (GoTrue API), as before; their memberships
-- are gone here, which is what Player Management lists.
--
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.club_members m JOIN public.profiles p ON p.id = m.user_id JOIN auth.users u ON u.id = p.id WHERE m.club_id IN ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid, '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid, 'fade0000-0000-0000-0000-000000000001'::uuid) AND m.membership_lifecycle_status = 'active' AND coalesce(m.status, 'approved') IN ('active', 'approved') AND p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid' AND u.deleted_at IS NULL AND p.created_at < '2026-11-12 18:00:00+00')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $post_deploy_test_accounts_leave_kings_club_and_the_union$
DECLARE
  v_clubs constant uuid[] := ARRAY[
    'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,  -- KINGS CLUB
    '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'::uuid,  -- Deep Stack Society
    'fade0000-0000-0000-0000-000000000001'::uuid   -- Midway Union
  ];
  v_floor constant timestamptz := clock_timestamp() - interval '162 minutes';
  r record;
  v_result jsonb;
  v_refusal text;
  v_door integer := 0;
  v_departed integer := 0;
  v_rows integer;
  v_left integer;
  v_funded integer;
BEGIN
  FOR r IN
    SELECT p.id, p.username
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
       AND u.deleted_at IS NULL AND p.status IS DISTINCT FROM 'deleted'
       AND NOT coalesce(p.is_horse, false) AND NOT coalesce(p.is_admin, false)
       AND p.created_at < v_floor
       AND EXISTS (SELECT 1 FROM public.club_members m
                    WHERE m.user_id = p.id AND m.membership_lifecycle_status = 'active'
                      AND coalesce(m.status, 'approved') IN ('active', 'approved')
                      AND m.club_id = ANY (v_clubs))
     ORDER BY p.created_at, p.id
  LOOP
    v_refusal := NULL;
    BEGIN
      v_result := public.cleanup_reserved_certification_account(r.id);
      IF coalesce(v_result ->> 'success', '') <> 'true'
         AND coalesce(v_result ->> 'reason', '') <> 'auth_soft_delete_required' THEN
        v_refusal := coalesce(v_result ->> 'reason', v_result::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- The door rolls its own work back when it raises; this block's
      -- subtransaction keeps the rest of the settlement intact.
      v_refusal := SQLSTATE || ' ' || SQLERRM;
    END;

    IF v_refusal IS NULL THEN
      v_door := v_door + 1;
      CONTINUE;
    END IF;

    RAISE NOTICE 'post_deploy_test_accounts: door refused % (%), departing its zero-balance memberships', r.username, v_refusal;
    PERFORM set_config('app.club_membership_lifecycle_write', 'depart', true);
    UPDATE public.club_members m
       SET status = 'suspended', is_active = false,
           membership_lifecycle_status = 'departed',
           departed_at = clock_timestamp(),
           departure_reason = 'Test Account Retired',
           updated_at = clock_timestamp()
     WHERE m.user_id = r.id AND m.membership_lifecycle_status = 'active'
       AND m.club_id = ANY (v_clubs)
       AND coalesce(m.chip_balance, 0) = 0 AND coalesce(m.promo_balance, 0) = 0;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM set_config('app.club_membership_lifecycle_write', '', true);
    v_departed := v_departed + v_rows;
  END LOOP;

  -- A reserved identity holding chips in a real club is never departed by
  -- this file: it is reported and left for a reconciled settlement.
  SELECT count(*) INTO v_funded
    FROM public.club_members m JOIN public.profiles p ON p.id = m.user_id
   WHERE m.club_id = ANY (v_clubs)
     AND m.membership_lifecycle_status = 'active'
     AND p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     AND (coalesce(m.chip_balance, 0) <> 0 OR coalesce(m.promo_balance, 0) <> 0);
  IF v_funded <> 0 THEN
    RAISE EXCEPTION 'POST_DEPLOY_TEST_ACCOUNT_HOLDS_CHIPS: % membership(s)', v_funded USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_left
    FROM public.club_members m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN auth.users u ON u.id = p.id
   WHERE m.club_id = ANY (v_clubs)
     AND m.membership_lifecycle_status = 'active'
     AND coalesce(m.status, 'approved') IN ('active', 'approved')
     AND p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     AND u.deleted_at IS NULL
     AND p.created_at < v_floor;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'POST_DEPLOY_TEST_ACCOUNTS_LEFT: %', v_left USING ERRCODE = '55000';
  END IF;

  RAISE NOTICE 'post_deploy_test_accounts_leave_kings_club_and_the_union: % through the door, % memberships departed', v_door, v_departed;
END
$post_deploy_test_accounts_leave_kings_club_and_the_union$;

COMMIT;
