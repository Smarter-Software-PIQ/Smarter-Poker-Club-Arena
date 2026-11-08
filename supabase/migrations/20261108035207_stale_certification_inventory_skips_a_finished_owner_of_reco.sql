-- 20261108035207_stale_certification_inventory_skips_a_finished_owner_of_reco.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: (to_regprocedure('public.fn_ca_certification_owner_of_record_state(uuid)') IS NOT NULL AND position('fn_ca_certification_owner_of_record_state' in pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamp with time zone)'::regprocedure)) > 0)
--
-- WHAT THIS CHANGES, AND WHY (2026-11-08):
--
-- A FINISHED OWNER OF RECORD LEAVES THE STALE CERTIFICATION INVENTORY.
--
-- scripts/ci/certify-rabbit-hunt.mjs mints a fresh reserved owner identity per
-- run and retires its 'Cert RH' club through fn_retire_settled_club; the UI
-- lane's retained 'Crest Cert Template' fixtures leave the same shape. The
-- account door (cleanup_reserved_certification_account) refuses any club
-- owner, and a retired club that keeps immutable history is never deleted, so
-- the identity is kept as the club's owner of record. Nothing ever retired its
-- credentials, so fn_ca_stale_certification_accounts listed it on every sweep
-- for ever. Read from production on 2026-11-08: eight such identities
-- (49ee6036, f55926cf, 748a15d9, 0f1f28e9, bc740156, b41ccb19, 205db075,
-- 1eb1fe67), each owning exactly one retired club (lifecycle_status
-- 'retired', chip_treasury / promo_balance / insurance_balance / chip_pool
-- 0.00, no open table, one member: the owner), holding one zero-balance
-- 'owner' membership in that club and nothing else (no seat, union, agent,
-- registration or wallet balance) - with their password still set and, for
-- five of them, live sessions. One more is added every day.
--
-- 1. fn_ca_certification_owner_of_record_state(uuid) -> text (read-only,
--    service-only) reads that shape with the SAME custody fragments the door
--    and fn_ca_certification_identity_retired use:
--      'not_finished'     not a reserved certification identity, or owns no
--                         club, or any owned club is not retired / not empty /
--                         has a non-terminal table, or it holds a union, an
--                         agent, a registration, a live seat, a wallet balance
--                         or any membership other than a zero-balance owner
--                         row of a club it owns that is retired;
--      'credentials_live' finished, but Auth still holds a password, a session
--                         or a refresh token (or is not soft-deleted);
--      'retired'          finished and Auth-retired.
--    The stale sweep (scripts/ci/production-e2e-account.mjs) retires the
--    credentials of a 'credentials_live' owner through GoTrue's supported soft
--    delete - the same call the door's auth_soft_delete_required answer uses -
--    and verifies 'retired' afterwards. Nothing in public is written.
-- 2. fn_ca_stale_certification_accounts stops listing a 'retired' owner of
--    record. Its envelope (namespace, 40-minute floor, LIMIT 21, ordering),
--    owner, ACL and configuration are unchanged; a 'not_finished' or
--    'credentials_live' owner is still listed and still loud.
--
-- No hot table is locked: function DDL only, one transaction, one reload.
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure);
BEGIN
  -- The exact production preimage, or this file's own installed body (replay).
  IF md5(v_def) <> 'd0ab035f530057448cc8b1b8bad3888c'
     AND position('fn_ca_certification_owner_of_record_state' IN v_def) = 0 THEN
    RAISE EXCEPTION 'STALE_CERTIFICATION_INVENTORY_PREIMAGE_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.fn_ca_certification_owner_of_record_state(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '8s'
AS $function$
 SELECT CASE
   WHEN NOT EXISTS (
     SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
      WHERE p.id = p_user_id
        AND (p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
          OR p.email LIKE 'club-create-cert-%@smarter-poker.invalid')
        AND p.role = 'user' AND NOT COALESCE(p.is_admin, false)
        AND NOT COALESCE(p.is_horse, false)
        AND EXISTS (SELECT 1 FROM public.clubs c WHERE c.owner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.owner_id = p.id
                         AND (c.lifecycle_status IS DISTINCT FROM 'retired'
                           OR COALESCE(c.chip_treasury, 0) <> 0
                           OR COALESCE(c.promo_balance, 0) <> 0
                           OR COALESCE(c.insurance_balance, 0) <> 0
                           OR COALESCE(c.chip_pool, 0) <> 0
                           OR EXISTS (SELECT 1 FROM public.tables t WHERE t.club_id = c.id
                                       AND lower(COALESCE(t.status::text, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished'))))
        AND NOT EXISTS (SELECT 1 FROM public.unions x WHERE x.owner_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.user_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.tournament_players t WHERE t.user_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.table_seats s LEFT JOIN public.tables t ON t.id = s.table_id
                         WHERE s.user_id = p.id
                           AND (s.left_at IS NULL OR t.id IS NULL
                             OR lower(COALESCE(t.status::text, '')) NOT IN ('closed', 'completed', 'cancelled', 'finished')
                             OR (COALESCE(s.stack, 0) <> 0 AND NOT EXISTS (
                               SELECT 1 FROM public.chip_ledger x
                                WHERE x.to_entity_id = s.user_id AND x.table_id = s.table_id
                                  AND x.category = 'table_cashout' AND x.status = 'posted'
                                  AND x.amount = s.stack
                                  AND x.created_at BETWEEN s.left_at - interval '1 minute'
                                                       AND s.left_at + interval '1 minute'))))
        AND NOT EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id = p.id
                         AND (COALESCE(w.balance, 0) <> 0 OR COALESCE(w.locked_balance, 0) <> 0))
        AND NOT EXISTS (SELECT 1 FROM public.club_members m WHERE m.user_id = p.id
                         AND (m.role IS DISTINCT FROM 'owner'
                           OR NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = m.club_id
                                           AND c.owner_id = p.id AND c.lifecycle_status = 'retired')
                           OR COALESCE(m.chip_balance, 0) <> 0 OR COALESCE(m.promo_balance, 0) <> 0
                           OR COALESCE(m.held_chips, 0) <> 0 OR COALESCE(m.locked_chips, 0) <> 0
                           OR COALESCE(m.credit_used, 0) <> 0 OR COALESCE(m.credit_limit, 0) <> 0
                           OR (m.agent_id IS NOT NULL AND m.agent_id IS DISTINCT FROM p.id)
                           OR m.parent_agent_id IS NOT NULL))
   ) THEN 'not_finished'
   WHEN EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id
                 AND u.deleted_at IS NOT NULL AND COALESCE(u.encrypted_password, '') = '')
    AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = p_user_id)
    AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens t WHERE t.user_id = p_user_id::text)
     THEN 'retired'
   ELSE 'credentials_live'
 END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_certification_owner_of_record_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_certification_owner_of_record_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_stale_certification_accounts(p_before timestamptz)
RETURNS TABLE(id uuid, email text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '8s'
AS $function$
 SELECT p.id, p.email::text, p.created_at
 FROM public.profiles p
 WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
   AND p.created_at <= LEAST(p_before, now() - interval '40 minutes')
   AND NOT public.fn_ca_certification_identity_retired(p.id)
   AND public.fn_ca_certification_owner_of_record_state(p.id) <> 'retired'
 ORDER BY p.created_at, p.id LIMIT 21
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_stale_certification_accounts(timestamptz) FROM PUBLIC, anon, authenticated;

DO $readback$
BEGIN
  IF position('fn_ca_certification_owner_of_record_state' IN
       pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) = 0
     OR position('LIMIT 21' IN
       pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) = 0
     OR has_function_privilege('anon', 'public.fn_ca_certification_owner_of_record_state(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_certification_owner_of_record_state(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_ca_stale_certification_accounts(timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_stale_certification_accounts(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STALE_CERTIFICATION_INVENTORY_READBACK_CHANGED' USING ERRCODE = '55000';
  END IF;
END
$readback$;
COMMIT;
