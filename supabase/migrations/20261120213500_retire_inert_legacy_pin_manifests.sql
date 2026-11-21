-- 20261120213500_retire_inert_legacy_pin_manifests.sql
--
-- RETIRE INERT LEGACY PIN-MANIFEST FUNCTIONS (2026-11-20, Wave 2 hardening).
--
-- Two completed historical one-shot pin-manifest functions kept tripping the
-- applier's stale-pin guard (migration-stale-pins.mjs) on every unrelated
-- tournament and hand-settlement migration, forcing repeated -- @stale-pin-ok
-- declarations (20261118160405, 20261118171613, 20261118191946, 20261119011750,
-- 20261119053909, 20261119141104, 20261119181500, 20261119232617):
--
--   1. smarter_private.original_hand_correction_sources_match()
--      Created in 20261013022132 to gate one-shot historical hand source
--      corrections (30 tournament hands + 17 cash hands) by pinning 26 core
--      hand-settlement function md5s. That correction window is closed and
--      the function already returns FALSE on production (verified 2026-11-19).
--      Retiring its body to `SELECT false` preserves the exact refusal of
--      every correction proof while releasing all 26 stale/live pins.
--
--   2. public.fn_ca_guard_mtt_admission_contract()
--      Trigger function on public.ca_mtt_admission_contract. Its 149-entry
--      JSON activation manifest (20260917232232 / 20260918023535 /
--      20260918093004) was read ONLY on the one-way transition
--      OLD.abi = 'legacy-capacity-v1' -> NEW.abi = 'unlimited-mtt-v2', which
--      production completed in 20260918023630. Because ca_mtt_admission_contract
--      is immutable at 'unlimited-mtt-v2', that branch is permanently
--      unreachable. Retiring the trigger function removes all 149 dead pins
--      while preserving exact immutability enforcement
--      (MTT_ADMISSION_CONTRACT_IMMUTABLE, SQLSTATE 55000) on INSERT, UPDATE,
--      DELETE, and TRUNCATE (allowing only no-op UPDATEs).
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only: no table or row lock, no
-- install window, one transaction, one schema reload. Neither function is
-- pinned by any other installed function.
--
-- @live-proof: (SELECT smarter_private.original_hand_correction_sources_match() IS FALSE AND (SELECT prosrc !~ '[0-9a-f]{32}' FROM pg_proc WHERE oid = 'smarter_private.original_hand_correction_sources_match()'::regprocedure) AND (SELECT prosrc !~ '[0-9a-f]{32}' FROM pg_proc WHERE oid = 'public.fn_ca_guard_mtt_admission_contract()'::regprocedure))

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $precheck$
DECLARE
  v_contract_count integer;
  v_contract_abi text;
BEGIN
  IF to_regprocedure('smarter_private.original_hand_correction_sources_match()') IS NULL THEN
    RAISE EXCEPTION '20261120213500: smarter_private.original_hand_correction_sources_match() not found'
      USING ERRCODE = '55000';
  END IF;

  IF smarter_private.original_hand_correction_sources_match() IS TRUE THEN
    RAISE EXCEPTION '20261120213500: original_hand_correction_sources_match() still returns TRUE; refusing retirement'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.fn_ca_guard_mtt_admission_contract()') IS NULL THEN
    RAISE EXCEPTION '20261120213500: public.fn_ca_guard_mtt_admission_contract() not found'
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.ca_mtt_admission_contract') IS NOT NULL THEN
    SELECT count(*), min(abi)
      INTO v_contract_count, v_contract_abi
      FROM public.ca_mtt_admission_contract;
    IF v_contract_count > 0 AND (v_contract_count <> 1 OR v_contract_abi IS DISTINCT FROM 'unlimited-mtt-v2') THEN
      RAISE EXCEPTION '20261120213500: ca_mtt_admission_contract is not in terminal unlimited-mtt-v2 state (count=%, abi=%)',
        v_contract_count, v_contract_abi
        USING ERRCODE = '55000';
    END IF;
  END IF;
END
$precheck$;

CREATE OR REPLACE FUNCTION smarter_private.original_hand_correction_sources_match()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, smarter_private
AS $function$
  -- Retired 2026-11-20 (Wave 2 hardening, 20261120213500): the historical
  -- original-hand source-correction window is closed and the 26-function pin
  -- manifest already returned false on production (verified 2026-11-19).
  SELECT false;
$function$;

ALTER FUNCTION smarter_private.original_hand_correction_sources_match() OWNER TO postgres;
REVOKE ALL ON FUNCTION smarter_private.original_hand_correction_sources_match() FROM PUBLIC, anon, authenticated, service_role;

-- @probe-exempt: public.fn_ca_guard_mtt_admission_contract trigger function cannot be called directly; verified by immutability DML probe below and native PG proof
CREATE OR REPLACE FUNCTION public.fn_ca_guard_mtt_admission_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- Retired 2026-11-20 (Wave 2 hardening, 20261120213500): the one-way
  -- transition legacy-capacity-v1 -> unlimited-mtt-v2 completed on production
  -- in 20260918023630. The 149-entry activation manifest is unreachable and
  -- released; immutability of public.ca_mtt_admission_contract stays enforced.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.singleton IS NOT DISTINCT FROM OLD.singleton
       AND NEW.abi IS NOT DISTINCT FROM OLD.abi THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'MTT_ADMISSION_CONTRACT_IMMUTABLE' USING ERRCODE = '55000';
END;
$function$;

ALTER FUNCTION public.fn_ca_guard_mtt_admission_contract() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_ca_guard_mtt_admission_contract() FROM PUBLIC, anon, authenticated, service_role;

DO $postcheck$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid IN (
       'smarter_private.original_hand_correction_sources_match()'::regprocedure,
       'public.fn_ca_guard_mtt_admission_contract()'::regprocedure
     )
       AND (
         prosrc ~ '[0-9a-f]{32}'
         OR pg_get_userbyid(proowner) IS DISTINCT FROM 'postgres'
         OR EXISTS (
           SELECT 1
             FROM aclexplode(COALESCE(proacl, acldefault('f', proowner))) a
            WHERE a.grantee <> proowner
         )
       )
  ) THEN
    RAISE EXCEPTION '20261120213500: post-install security or pin-release verification failed'
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('public.ca_mtt_admission_contract') IS NOT NULL
     AND (
       SELECT count(*)
         FROM pg_trigger t
        WHERE t.tgrelid = 'public.ca_mtt_admission_contract'::regclass
          AND NOT t.tgisinternal
          AND t.tgenabled IN ('O', 'A')
          AND t.tgfoid = 'public.fn_ca_guard_mtt_admission_contract()'::regprocedure
     ) < 2 THEN
    RAISE EXCEPTION '20261120213500: ca_mtt_admission_contract immutability triggers missing or disabled'
      USING ERRCODE = '55000';
  END IF;
END
$postcheck$;

-- @probe-for: smarter_private.original_hand_correction_sources_match
DO $probe$
BEGIN
  IF smarter_private.original_hand_correction_sources_match() IS DISTINCT FROM false THEN
    RAISE EXCEPTION '20261120213500: original_hand_correction_sources_match() probe did not return false';
  END IF;
  IF to_regclass('public.ca_mtt_admission_contract') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.ca_mtt_admission_contract (singleton, abi)
      VALUES (true, 'legacy-capacity-v1');
      RAISE EXCEPTION '20261120213500: ca_mtt_admission_contract insert unexpectedly succeeded';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'MTT_ADMISSION_CONTRACT_IMMUTABLE' THEN RAISE; END IF;
    END;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
