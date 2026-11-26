-- 20261125235742_the_stale_certification_inventory_pages_past_kept_identities.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE STALE CERTIFICATION INVENTORY PAGES PAST KEPT IDENTITIES (2026-11-25).
--
-- fn_ca_stale_certification_accounts(timestamptz) returns the 21 OLDEST
-- reserved post-deploy profiles that are not deleted. The sweep that reads it
-- (scripts/ci/production-e2e-account.mjs, cleanupStaleProductionE2EAccounts)
-- keeps some of those identities on purpose and for good: the owner of record
-- of a retired fixture club (2026-10-26, 2026-11-07) and, since 2026-11-25, a
-- player of record of a retired fixture's finished game. A kept identity is
-- never deleted, so it never leaves the inventory.
--
-- Measured read-only 2026-11-25 23:40 UTC: 19 listed, every one of them kept
-- (17 owners of retired Cert RH / Cert HU / Crest Cert clubs, 2 Cert HU
-- players). Rabbit Hunt Certification runs daily and each run leaves one more
-- kept owner. At 21 the page is full of identities no door will ever remove
-- and no newer stale identity is reached again: the exact failure of
-- 2026-11-14 ("39 profiles no door will ever retire filled its LIMIT 21"),
-- and of 2026-10-31 before it (429 unreached identities), two days away.
--
-- THE FIX. A second reader with the same predicate and the same page size
-- that starts strictly after a (created_at, id) position. The sweep walks the
-- whole inventory page by page, bounded by its time budget, never by a count.
-- The first reader is untouched; its grants and its first page are asserted
-- against the new reader below.
--
-- Read-only (STABLE), service_role only, no table lock, no data change.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_ca_stale_certification_accounts_after(
  p_before timestamp with time zone,
  p_after_created_at timestamp with time zone,
  p_after_id uuid
)
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
   -- Same listing rule as fn_ca_stale_certification_accounts (20261114192610).
   AND p.status IS DISTINCT FROM 'deleted'
   -- Strictly after the last identity of the previous page; both NULL reads
   -- the first page.
   AND (p_after_created_at IS NULL OR p_after_id IS NULL
        OR (p.created_at, p.id) > (p_after_created_at, p_after_id))
 ORDER BY p.created_at, p.id LIMIT 21
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_stale_certification_accounts_after(timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_stale_certification_accounts_after(timestamptz, timestamptz, uuid) TO service_role;

DO $post$
DECLARE
  v_grantees text[];
  v_first uuid[];
  v_all uuid[];
  v_walked uuid[] := '{}';
  v_page record;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_rows integer;
  v_pages integer := 0;
BEGIN
  SELECT array_agg(r.rolname ORDER BY r.rolname) INTO v_grantees
    FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = 'public.fn_ca_stale_certification_accounts_after(timestamptz,timestamptz,uuid)'::regprocedure;
  IF v_grantees IS DISTINCT FROM ARRAY['postgres','service_role']::text[] THEN
    RAISE EXCEPTION 'STALE_INVENTORY_PAGING_GRANTS_CHANGED: %', v_grantees USING ERRCODE = '55000';
  END IF;
  SELECT array_agg(r.rolname ORDER BY r.rolname) INTO v_grantees
    FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = 'public.fn_ca_stale_certification_accounts(timestamptz)'::regprocedure;
  IF v_grantees IS DISTINCT FROM ARRAY['postgres','service_role']::text[] THEN
    RAISE EXCEPTION 'STALE_INVENTORY_PAGING_BASE_GRANTS_CHANGED: %', v_grantees USING ERRCODE = '55000';
  END IF;

  -- The first page is the first reader's page, row for row.
  SELECT COALESCE(array_agg(f.id ORDER BY f.created_at, f.id), '{}') INTO v_first
    FROM public.fn_ca_stale_certification_accounts(now()) f;
  SELECT COALESCE(array_agg(f.id ORDER BY f.created_at, f.id), '{}') INTO v_walked
    FROM public.fn_ca_stale_certification_accounts_after(now(), NULL, NULL) f;
  IF v_walked IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'STALE_INVENTORY_PAGING_FIRST_PAGE_MISMATCH' USING ERRCODE = '55000';
  END IF;

  -- Walking every page visits the whole listing once, in order, no repeats.
  SELECT COALESCE(array_agg(p.id ORDER BY p.created_at, p.id), '{}') INTO v_all
    FROM public.profiles p
   WHERE p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'
     AND p.created_at <= now() - interval '40 minutes'
     AND p.status IS DISTINCT FROM 'deleted';
  v_walked := '{}';
  LOOP
    v_rows := 0;
    FOR v_page IN
      SELECT f.id, f.created_at
        FROM public.fn_ca_stale_certification_accounts_after(now(), v_cursor_at, v_cursor_id) f
       ORDER BY f.created_at, f.id
    LOOP
      v_rows := v_rows + 1;
      v_walked := v_walked || v_page.id;
      v_cursor_at := v_page.created_at;
      v_cursor_id := v_page.id;
    END LOOP;
    v_pages := v_pages + 1;
    EXIT WHEN v_rows < 21 OR v_pages > 500;
  END LOOP;
  IF v_walked IS DISTINCT FROM v_all THEN
    RAISE EXCEPTION 'STALE_INVENTORY_PAGING_WALK_MISMATCH: walked % of % in % page(s)',
      cardinality(v_walked), cardinality(v_all), v_pages USING ERRCODE = '55000';
  END IF;
END
$post$;

COMMIT;
