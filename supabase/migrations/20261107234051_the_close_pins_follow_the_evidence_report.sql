-- 20261107234051_the_close_pins_follow_the_evidence_report
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 23:40:51 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- THE CLOSE'S PINS FOLLOW THE EVIDENCE REPORT (2026-11-07).
--
-- 20261107021911 (weekly close rake check reads boundary straddlers) changed
-- public.fn_union_pnl_evidence_report from md5 ca8931142b7e8ad6bbac07bd0913d268
-- to b36f9e252823addb55be086a26f3dedf - a verification-only change to the
-- rake comparison - but two functions still pinned the old body:
--
--   smarter_private.original_inventory_proof_sources_match()  (the 65-source
--     list behind original_inventory_basis_generation)
--   public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)
--     (proves the week's original flows two hours at a time only while the
--     report is the reviewed definition)
--
-- MEASURED on production 2026-11-07 23:30Z: proof_sources_match() = false
-- (evidence_report is the only one of the 65 that differs), so
-- original_inventory_basis_generation() = NULL and every Midway close since
-- 02:19Z ran 'original-inventory-245:unqualified': no boundary, flows,
-- touched or clubs certificate is read or written (the 10-19 opening
-- boundary, 41 s, is recomputed on every 5-minute tick), and once the earned
-- windows finish the advance returns true and the report proves the week's
-- 814,510 original flows in one statement (162 s), which cannot fit job 272's
-- attempt. The 2026-10-19 close could not finish.
--
-- 021911 changed only the rake check (accepted - straddle = earned); flows,
-- boundaries, touches and the certificates the window proofs feed are read
-- exactly as before, so what both pins protect is unchanged. This moves:
--   1. the advance's report pin ca89.. -> b36f..;
--   2. the 65-source list's report entry ca89.. -> b36f.. and its advance
--      entry a7cd837b.. -> the advance's new body.
-- Owner, ACL, security, config and volatility unchanged; pre and post images
-- md5-pinned. After it, proof_sources_match() is true and the generation is
-- a fresh 'original-inventory-245-v1:' value (its source hash covers these
-- functions), so no certificate from before 021911 is reused.
--
-- @live-proof: smarter_private.original_inventory_proof_sources_match() IS TRUE AND smarter_private.original_inventory_basis_generation() LIKE 'original-inventory-245-v1:%' AND position('b36f9e252823addb55be086a26f3dedf' IN pg_get_functiondef('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $close_pins_follow_the_report$
DECLARE
  c_report constant text := 'public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)';
  c_adv    constant text := 'public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)';
  c_psm    constant text := 'smarter_private.original_inventory_proof_sources_match()';
  old_report constant text := 'ca8931142b7e8ad6bbac07bd0913d268';
  new_report constant text := 'b36f9e252823addb55be086a26f3dedf';
  old_adv    constant text := 'a7cd837baeff4a3f2bfbad0f17f323b8';
  new_adv    constant text := '4b5bc9cae04ce0f98ce56381b7dd524f';
  e_report_old constant text := $e$('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)','ca8931142b7e8ad6bbac07bd0913d268')$e$;
  e_report_new constant text := $e$('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)','b36f9e252823addb55be086a26f3dedf')$e$;
  e_adv_old    constant text := $e$('public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)','a7cd837baeff4a3f2bfbad0f17f323b8')$e$;
  d text; p text; m jsonb; m2 jsonb; adv_now text;
BEGIN
  IF md5(pg_get_functiondef(c_report::regprocedure)) IS DISTINCT FROM new_report THEN
    RAISE EXCEPTION 'CLOSE_PINS_REPORT_NOT_021911 %', md5(pg_get_functiondef(c_report::regprocedure)) USING ERRCODE='55000';
  END IF;

  -- 1. The advance's report pin.
  d := pg_get_functiondef(c_adv::regprocedure);
  IF md5(d) IS DISTINCT FROM old_adv THEN RAISE EXCEPTION 'CLOSE_PINS_ADVANCE_PREIMAGE %', md5(d) USING ERRCODE='55000'; END IF;
  IF (length(d)-length(replace(d,old_report,'')))/32 <> 1 THEN RAISE EXCEPTION 'CLOSE_PINS_ADVANCE_ANCHOR' USING ERRCODE='55000'; END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m FROM pg_proc WHERE oid=c_adv::regprocedure;
  p := replace(d, old_report, new_report);
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m2 FROM pg_proc WHERE oid=c_adv::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_adv::regprocedure) <> p
     OR md5(p) IS DISTINCT FROM new_adv THEN
    RAISE EXCEPTION 'CLOSE_PINS_ADVANCE_POSTIMAGE %', md5(pg_get_functiondef(c_adv::regprocedure)) USING ERRCODE='55000';
  END IF;

  adv_now := md5(pg_get_functiondef(c_adv::regprocedure));

  -- 2. The 65-source list: the report entry and the advance entry.
  d := pg_get_functiondef(c_psm::regprocedure);
  IF md5(d) IS DISTINCT FROM '5751413734130d759efc720fbc598c92' THEN RAISE EXCEPTION 'CLOSE_PINS_SOURCES_PREIMAGE %', md5(d) USING ERRCODE='55000'; END IF;
  IF (length(d)-length(replace(d,e_report_old,'')))/length(e_report_old) <> 1
     OR (length(d)-length(replace(d,e_adv_old,'')))/length(e_adv_old) <> 1 THEN
    RAISE EXCEPTION 'CLOSE_PINS_SOURCES_ANCHORS' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m FROM pg_proc WHERE oid=c_psm::regprocedure;
  p := replace(replace(d, e_report_old, e_report_new), e_adv_old, replace(e_adv_old, old_adv, adv_now));
  EXECUTE p;
  SELECT jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) INTO m2 FROM pg_proc WHERE oid=c_psm::regprocedure;
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_psm::regprocedure) <> p
     OR md5(p) IS DISTINCT FROM 'bb3f5552448e42e7d55c470d49591049' THEN
    RAISE EXCEPTION 'CLOSE_PINS_SOURCES_POSTIMAGE %', md5(pg_get_functiondef(c_psm::regprocedure)) USING ERRCODE='55000';
  END IF;

  -- 3. The pinned set holds again.
  IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN
    RAISE EXCEPTION 'CLOSE_PINS_SOURCES_STILL_DIFFER' USING ERRCODE='55000';
  END IF;
END $close_pins_follow_the_report$;

COMMIT;
