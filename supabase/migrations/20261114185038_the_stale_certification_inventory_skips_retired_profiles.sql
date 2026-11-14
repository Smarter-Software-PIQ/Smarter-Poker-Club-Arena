-- 20261114185038_the_stale_certification_inventory_skips_retired_profiles
--
-- Reserved by scripts/new-migration.mjs on 2026-11-14 18:50:38 UTC.
--
-- THE STALE CERTIFICATION INVENTORY SKIPS RETIRED PROFILES (2026-11-14).
--
-- WHAT WAS WRONG, READ FROM ROWS. Every Club Create Certification run since at
-- least 2026-11-14 09:44 UTC failed its cleanup with
--   Stale Create Club Fixture Recovery Failed: fn_ca_stale_certification_accounts
--   ... 57014 canceling statement due to statement timeout
-- and the operator Cert Residue Sweep (run 43628368812) failed on the same
-- call. The inventory walks reserved post-deploy profiles oldest first and
-- evaluates fn_ca_certification_identity_retired (nine EXISTS probes, one of
-- them over chip_ledger) on each until it has 21 that are not retired. 1,269
-- profiles are older than the 162-minute floor; 1,223 of them are retired, so
-- every call evaluated the predicate about 1,250 times: 10.96 s measured,
-- against the function's own 8 s statement_timeout.
--
-- The 39 profiles that are deleted but not auth-retired made it worse than
-- slow. They are owners of record of retired fixture clubs and identities with
-- tournament history, which the cleanup door refuses every time, so they sat
-- at the front of the inventory, filled its LIMIT 21, and the sweep never
-- reached a newer stale identity.
--
-- THE FIX. A profile whose status is 'deleted' has been through retirement:
-- the cleanup door marks a retained ledger actor deleted, and the backlog was
-- retired the same way (both 20261114163238). No door does anything more for
-- it, so the inventory stops listing it. Measured read-only with this
-- predicate: 5 candidates, 0.06 s.
--
-- Body, signature, owner, security, config and grants are otherwise unchanged
-- (service_role and postgres only), asserted below.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) <> 'd0ab035f530057448cc8b1b8bad3888c' THEN
    RAISE EXCEPTION 'STALE_INVENTORY_PREIMAGE_CHANGED: fn_ca_stale_certification_accounts was edited since this change was qualified' USING ERRCODE = '55000';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_stale_certification_accounts(p_before timestamp with time zone)
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '8s'
AS $function$
 SELECT p.id, p.email::text, p.created_at
 FROM public.profiles p
 WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
   AND p.created_at <= LEAST(p_before, now() - interval '40 minutes')
   -- A deleted profile has been through retirement (20261114185038).
   AND p.status IS DISTINCT FROM 'deleted'
   AND NOT public.fn_ca_certification_identity_retired(p.id)
 ORDER BY p.created_at, p.id LIMIT 21
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_stale_certification_accounts(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_stale_certification_accounts(timestamptz) TO service_role;

DO $post$
DECLARE v_grantees text[];
BEGIN
  SELECT array_agg(r.rolname ORDER BY r.rolname) INTO v_grantees
    FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = 'public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure;
  IF v_grantees IS DISTINCT FROM ARRAY['postgres','service_role']::text[] THEN
    RAISE EXCEPTION 'STALE_INVENTORY_GRANTS_CHANGED: %', v_grantees USING ERRCODE = '55000';
  END IF;
  IF position('p.status IS DISTINCT FROM ''deleted''' IN pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'STALE_INVENTORY_INSTALL_MISMATCH' USING ERRCODE = '55000';
  END IF;
END
$post$;

COMMIT;
