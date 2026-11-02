-- Owner correction November 2: the guarantee covers regular PLUS bounty prizes.
-- Attendance's no-rake break-even floor uses the full advertised entry charge.
-- This changes only the read-only Horse selector, never splits/charges/ledgers.
-- Historical migration 20261101200640 is immutable and is corrected forward.
-- @live-proof: position('funding.prize' in (SELECT prosrc FROM pg_proc WHERE oid='public.fn_overlay_at_risk(uuid)'::regprocedure))=0 AND position('nullif(funding.charge, 0)' in (SELECT prosrc FROM pg_proc WHERE oid='public.fn_overlay_at_risk(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $coverage$
DECLARE
  v_source text;
  v_definition text;
  v_after text;
  v_before_metadata jsonb;
  v_after_metadata jsonb;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid),
    jsonb_build_object('owner',p.proowner,'acl',p.proacl,'secdef',p.prosecdef,
      'config',p.proconfig,'volatile',p.provolatile,'parallel',p.proparallel,
      'strict',p.proisstrict,'leakproof',p.proleakproof)
  INTO v_source,v_definition,v_before_metadata
  FROM pg_proc p WHERE p.oid='public.fn_overlay_at_risk(uuid)'::regprocedure;
  IF md5(v_source) IS DISTINCT FROM '0df4d5c0721b53ebd708b3cf1415ea48' THEN
    RAISE EXCEPTION 'horse_total_guarantee_coverage_preimage_changed';
  END IF;
  v_after := replace(v_definition, 'funding.prize', 'funding.charge');
  IF v_after=v_definition OR position('funding.prize' IN v_after)>0
    OR position('nullif(funding.charge, 0)' IN v_after)=0 THEN
    RAISE EXCEPTION 'horse_total_guarantee_coverage_anchor_changed';
  END IF;
  EXECUTE v_after;
  SELECT jsonb_build_object('owner',p.proowner,'acl',p.proacl,'secdef',p.prosecdef,
    'config',p.proconfig,'volatile',p.provolatile,'parallel',p.proparallel,
    'strict',p.proisstrict,'leakproof',p.proleakproof)
  INTO v_after_metadata FROM pg_proc p
  WHERE p.oid='public.fn_overlay_at_risk(uuid)'::regprocedure;
  IF v_before_metadata IS DISTINCT FROM v_after_metadata THEN
    RAISE EXCEPTION 'horse_total_guarantee_coverage_authority_changed';
  END IF;
END;
$coverage$;
COMMIT;
