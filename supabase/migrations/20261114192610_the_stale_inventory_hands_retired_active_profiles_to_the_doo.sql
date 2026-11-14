-- 20261114192610_the_stale_inventory_hands_retired_active_profiles_to_the_doo
--
-- Reserved by scripts/new-migration.mjs on 2026-11-14 19:26:10 UTC.
--
-- THE STALE INVENTORY HANDS RETIRED, STILL-ACTIVE PROFILES TO THE DOOR (2026-11-14).
--
-- 20261114185038 made the stale certification inventory skip deleted
-- profiles. It kept the older exclusion of identities whose Auth record is
-- already retired, on the reasoning that no door could do more for them. That
-- stopped being true at 20261114163238: the cleanup door now finishes a
-- retired ledger actor by marking its profile deleted, which departs every
-- membership. A retired identity whose door call ran before that change keeps
-- an active profile that nothing will ever hand back to the door.
--
-- Measured read-only 2026-11-14 19:26 UTC: six such profiles older than the
-- 162-minute floor (PostDeployf5601 and five crest_cert identities, Auth
-- retired between 16:04 and 17:07 UTC, profiles still active), next to the four
-- Cert HU owners the inventory already lists.
--
-- THE FIX. The inventory lists every reserved post-deploy profile that is not
-- deleted, retired or not. A retired one costs the door one EXISTS and an
-- UPDATE; a deleted one is never listed again. The retirement predicate is no
-- longer evaluated per profile, so the call gets cheaper still (10 candidates,
-- 0.03 s measured with this predicate).
--
-- Signature, owner, security, config and grants unchanged, asserted below.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) <> '93294e56aaea15f40526c13c39b52c88' THEN
    RAISE EXCEPTION 'STALE_INVENTORY_RETIRED_PREIMAGE_CHANGED: fn_ca_stale_certification_accounts was edited since this change was qualified' USING ERRCODE = '55000';
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
   -- A deleted profile has been through retirement (20261114185038); a
   -- retired one that is not deleted yet still needs the door (20261114192610).
   AND p.status IS DISTINCT FROM 'deleted'
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
    RAISE EXCEPTION 'STALE_INVENTORY_RETIRED_GRANTS_CHANGED: %', v_grantees USING ERRCODE = '55000';
  END IF;
  IF position('fn_ca_certification_identity_retired' IN pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) > 0
     OR position('p.status IS DISTINCT FROM ''deleted''' IN pg_get_functiondef('public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'STALE_INVENTORY_RETIRED_INSTALL_MISMATCH' USING ERRCODE = '55000';
  END IF;
END
$post$;

COMMIT;
