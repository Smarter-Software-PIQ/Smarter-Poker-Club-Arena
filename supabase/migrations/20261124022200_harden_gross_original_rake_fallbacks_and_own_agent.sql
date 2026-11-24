-- 20261124022200_harden_gross_original_rake_fallbacks_and_own_agent.sql
--
-- HARDEN REMAINING GROSS ORIGINAL RAKE CONSUMERS AFTER 20261116154831
-- (Post-fix hardening audit of incident 605ea9ca across all 28 live SQL
-- functions referencing public.accounting_payable_earning_sources).
--
-- ROOT CAUSE (found by full pg_proc audit 2026-11-24):
-- Migration 20261116154831 narrowed public.accounting_payable_earning_sources.rake_credit
-- to COALESCE((s.contract->>'payable_rake_credit')::numeric, s.rake_credit)
-- (gross minus promo_excluded_credit) so agent commission and player rakeback
-- exclude promo-funded fees, while keeping gross rake in s.contract->>'rake_credit'.
-- PR #11870 (20261123202500) fixed Union P&L evidence/straddle and PR #11878
-- (20261124010800) fixed weekly club statements and rake snapshots.
--
-- Two remaining consumers of accounting_payable_earning_sources still treated
-- s.rake_credit as gross original rake and would break on any promo-funded row:
--   1. public.fn_accounting_union_earned_plan_v3(uuid, timestamptz, timestamptz)
--      (fallback union earned-plan path): compared payable s.rake_credit against
--      gross bank receipts, gross tournament recognitions, contract->>'rake_credit',
--      and bank_total, and summed payable instead of gross in basis_detail.
--   2. smarter_private.admit_own_agent_source(text, uuid) +
--      smarter_private.own_agent_interpreted_contract(...): passed payable
--      s.rake_credit into fn_accounting_earning_contract (raising
--      own_agent_interpretation_historical_contract_disagrees), compared payable
--      s.rake_credit against gross fn_accounting_cash_commission_plan (raising
--      own_agent_interpretation_cash_capture_changed), failed to re-apply
--      fn_ca_promo_payable_contract to the rebuilt own-agent tiers, and subtracted
--      payable instead of gross from agents.lifetime_rake_generated /
--      weekly_rake_generated (leaving counters inflated by promo_excluded_credit).
--
-- FIX AT SOURCE:
--   1. Patch fn_accounting_union_earned_plan_v3 to reconcile against gross
--      COALESCE((s.contract->>'rake_credit')::numeric,s.rake_credit) across cash,
--      tournament, bank conservation, fingerprint, and basis_detail, while
--      tightening the agreement check to enforce gross - promo_excluded_credit = s.rake_credit.
--   2. Patch own_agent_interpreted_contract to re-apply
--      public.fn_ca_promo_payable_contract(canonical, (p_contract->>'promo_excluded_credit')::numeric)
--      whenever p_contract carries promo_excluded_credit so own-agent tiers still
--      exclude promo-funded fees and match the historical contract strictly.
--   3. Patch admit_own_agent_source to use gross COALESCE((s.contract->>'rake_credit')::numeric,s.rake_credit)
--      when calling own_agent_interpreted_contract, verifying fn_accounting_cash_commission_plan,
--      and reversing agents.lifetime_rake_generated / weekly_rake_generated.
--   4. Leave accounting_payable_earning_sources untouched so commission and
--      rakeback continue excluding promo-funded fees.
--
-- @live-proof: position('GROSS ORIGINAL RAKE HARDENING (20261124022200)' IN pg_get_functiondef('public.fn_accounting_union_earned_plan_v3(uuid,timestamptz,timestamptz)'::regprocedure)) > 0 AND position('GROSS ORIGINAL RAKE HARDENING (20261124022200)' IN pg_get_functiondef('smarter_private.own_agent_interpreted_contract(jsonb,uuid,uuid,numeric,uuid,timestamptz)'::regprocedure)) > 0 AND position('GROSS ORIGINAL RAKE HARDENING (20261124022200)' IN pg_get_functiondef('smarter_private.admit_own_agent_source(text,uuid)'::regprocedure)) > 0 AND md5(pg_get_functiondef('public.fn_accounting_union_earned_plan_v3(uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'e42fa0ee1e5d6ce48ad27ed79ed9ed53' AND md5(pg_get_functiondef('smarter_private.own_agent_interpreted_contract(jsonb,uuid,uuid,numeric,uuid,timestamptz)'::regprocedure)) IS DISTINCT FROM '038e7a69161b7d9b8434fe270fe45f59' AND md5(pg_get_functiondef('smarter_private.admit_own_agent_source(text,uuid)'::regprocedure)) IS DISTINCT FROM '4977d4df8d76714ca36bd1d5f3471e61'

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $apply_gross_rake_hardening$
DECLARE
  c_v3  CONSTANT text := 'public.fn_accounting_union_earned_plan_v3(uuid,timestamptz,timestamptz)';
  c_oic CONSTANT text := 'smarter_private.own_agent_interpreted_contract(jsonb,uuid,uuid,numeric,uuid,timestamptz)';
  c_adm CONSTANT text := 'smarter_private.admit_own_agent_source(text,uuid)';

  old_v3  CONSTANT text := 'e42fa0ee1e5d6ce48ad27ed79ed9ed53';
  old_oic CONSTANT text := '038e7a69161b7d9b8434fe270fe45f59';
  old_adm CONSTANT text := '4977d4df8d76714ca36bd1d5f3471e61';

  new_v3  text;
  new_oic text;
  new_adm text;

  d  text;
  p  text;
  a1 text; r1 text;
  a2 text; r2 text;
  a3 text; r3 text;
  a4 text; r4 text;
  a5 text; r5 text;
  m  jsonb;
  m2 jsonb;
  k1 integer; k2 integer; k3 integer; k4 integer; k5 integer;
  v_stale text;
BEGIN
  -- 1. Harden public.fn_accounting_union_earned_plan_v3(uuid, timestamptz, timestamptz)
  d := pg_get_functiondef(c_v3::regprocedure);
  IF md5(d) IS DISTINCT FROM old_v3 THEN
    RAISE EXCEPTION 'HARDEN_GROSS_PREIMAGE_V3 %', md5(d) USING ERRCODE = '55000';
  END IF;

  a1 := 'LEFT JOIN LATERAL (SELECT count(*) AS n,sum(s.rake_credit) AS total,';
  r1 :=
    E'-- GROSS ORIGINAL RAKE HARDENING (20261124022200): match gross bank receipts and union close basis.\n'
    || '  LEFT JOIN LATERAL (SELECT count(*) AS n,sum(COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)) AS total,';

  a2 :=
    E'LEFT JOIN LATERAL (SELECT count(*) AS n,sum(s.rake_credit) AS total\n'
    || '   FROM public.accounting_payable_earning_sources s WHERE s.source_type=''tournament_fee_accrual''';
  r2 :=
    E'LEFT JOIN LATERAL (SELECT count(*) AS n,sum(COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)) AS total\n'
    || '   FROM public.accounting_payable_earning_sources s WHERE s.source_type=''tournament_fee_accrual''';

  a3 := 'OR (s.contract->>''rake_credit'')::numeric IS DISTINCT FROM s.rake_credit';
  r3 := 'OR (s.contract->>''rake_credit'')::numeric IS NULL OR COALESCE((s.contract->>''promo_excluded_credit'')::numeric,0)<0 OR (s.contract->>''rake_credit'')::numeric-COALESCE((s.contract->>''promo_excluded_credit'')::numeric,0) IS DISTINCT FROM s.rake_credit';

  a4 := 'FROM public.accounting_payable_earning_sources s WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end;';
  r4 := 'FROM (SELECT s.source_type,s.source_id,s.rake_record_id,s.tournament_id,s.earned_at,COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit) AS rake_credit,s.contract FROM public.accounting_payable_earning_sources s WHERE s.union_id=p_union_id AND s.earned_at>=p_start AND s.earned_at<p_end) s;';

  a5 := 'SELECT s.club_id,COALESCE(f.game_type,''cash'') AS game_type,s.rake_credit,';
  r5 := 'SELECT s.club_id,COALESCE(f.game_type,''cash'') AS game_type,COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit) AS rake_credit,';

  k1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  k2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  k3 := (length(d) - length(replace(d, a3, ''))) / length(a3);
  k4 := (length(d) - length(replace(d, a4, ''))) / length(a4);
  k5 := (length(d) - length(replace(d, a5, ''))) / length(a5);
  IF k1 <> 1 OR k2 <> 1 OR k3 <> 1 OR k4 <> 1 OR k5 <> 1 THEN
    RAISE EXCEPTION 'HARDEN_GROSS_V3_ANCHOR_COUNT %/%/%/%/%', k1, k2, k3, k4, k5 USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_v3::regprocedure;
  p := replace(replace(replace(replace(replace(d, a1, r1), a2, r2), a3, r3), a4, r4), a5, r5);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_v3::regprocedure;
  new_v3 := md5(pg_get_functiondef(c_v3::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_v3::regprocedure) <> p OR new_v3 = old_v3 THEN
    RAISE EXCEPTION 'HARDEN_GROSS_V3_POSTIMAGE %', new_v3 USING ERRCODE = '55000';
  END IF;

  -- 2. Harden smarter_private.own_agent_interpreted_contract(...)
  d := pg_get_functiondef(c_oic::regprocedure);
  IF md5(d) IS DISTINCT FROM old_oic THEN
    RAISE EXCEPTION 'HARDEN_GROSS_PREIMAGE_OIC %', md5(d) USING ERRCODE = '55000';
  END IF;

  a1 := 'canonical:=public.fn_accounting_earning_contract(p_club,p_player,p_rake,p_union,p_terms);';
  r1 :=
    E'-- GROSS ORIGINAL RAKE HARDENING (20261124022200): preserve promo exclusion when re-interpreting own-agent tiers.\n'
    || E' canonical:=public.fn_accounting_earning_contract(p_club,p_player,p_rake,p_union,p_terms);\n'
    || ' IF p_contract ? ''promo_excluded_credit'' THEN canonical:=public.fn_ca_promo_payable_contract(canonical,(p_contract->>''promo_excluded_credit'')::numeric);END IF;';

  k1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  IF k1 <> 1 THEN
    RAISE EXCEPTION 'HARDEN_GROSS_OIC_ANCHOR_COUNT %', k1 USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_oic::regprocedure;
  p := replace(d, a1, r1);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_oic::regprocedure;
  new_oic := md5(pg_get_functiondef(c_oic::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_oic::regprocedure) <> p OR new_oic = old_oic THEN
    RAISE EXCEPTION 'HARDEN_GROSS_OIC_POSTIMAGE %', new_oic USING ERRCODE = '55000';
  END IF;

  -- 3. Harden smarter_private.admit_own_agent_source(text, uuid)
  d := pg_get_functiondef(c_adm::regprocedure);
  IF md5(d) IS DISTINCT FROM old_adm THEN
    RAISE EXCEPTION 'HARDEN_GROSS_PREIMAGE_ADM %', md5(d) USING ERRCODE = '55000';
  END IF;

  a1 := 'canonical:=smarter_private.own_agent_interpreted_contract(s.contract,s.club_id,s.player_id,s.rake_credit,s.union_id,s.terms_at);';
  r1 :=
    E'-- GROSS ORIGINAL RAKE HARDENING (20261124022200): pass gross original rake to contract check, cash proof, and agent counter reversal.\n'
    || ' canonical:=smarter_private.own_agent_interpreted_contract(s.contract,s.club_id,s.player_id,COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit),s.union_id,s.terms_at);';

  a2 := 'AND(p->>''rake_credit'')::numeric=s.rake_credit';
  r2 := 'AND(p->>''rake_credit'')::numeric=COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)';

  a3 := 'SET lifetime_rake_generated=coalesce(a.lifetime_rake_generated,0)-s.rake_credit,weekly_rake_generated=coalesce(a.weekly_rake_generated,0)-CASE WHEN public.fn_union_week_start(s.earned_at)=public.fn_union_week_start(now())THEN s.rake_credit ELSE 0 END';
  r3 := 'SET lifetime_rake_generated=coalesce(a.lifetime_rake_generated,0)-COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit),weekly_rake_generated=coalesce(a.weekly_rake_generated,0)-CASE WHEN public.fn_union_week_start(s.earned_at)=public.fn_union_week_start(now())THEN COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit) ELSE 0 END';

  k1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  k2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  k3 := (length(d) - length(replace(d, a3, ''))) / length(a3);
  IF k1 <> 1 OR k2 <> 1 OR k3 <> 1 THEN
    RAISE EXCEPTION 'HARDEN_GROSS_ADM_ANCHOR_COUNT %/%/%', k1, k2, k3 USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m FROM pg_proc WHERE oid = c_adm::regprocedure;
  p := replace(replace(replace(d, a1, r1), a2, r2), a3, r3);
  EXECUTE p;
  SELECT jsonb_build_object('o', proowner, 'a', proacl, 's', prosecdef, 'c', proconfig, 'v', provolatile)
    INTO m2 FROM pg_proc WHERE oid = c_adm::regprocedure;
  new_adm := md5(pg_get_functiondef(c_adm::regprocedure));
  IF m2 IS DISTINCT FROM m OR pg_get_functiondef(c_adm::regprocedure) <> p OR new_adm = old_adm THEN
    RAISE EXCEPTION 'HARDEN_GROSS_ADM_POSTIMAGE %', new_adm USING ERRCODE = '55000';
  END IF;

  -- 4. Verify zero stale MD5 pins remain anywhere in pg_proc.
  SELECT string_agg(DISTINCT x.md5 || ' is still pinned by ' || q.oid::regprocedure::text, '; ')
    INTO v_stale
    FROM (VALUES (old_v3), (old_oic), (old_adm)) x(md5)
    JOIN pg_catalog.pg_proc q ON strpos(q.prosrc, x.md5) > 0;
  IF v_stale IS NOT NULL THEN
    RAISE EXCEPTION 'HARDEN_GROSS_STALE_PIN: %', v_stale USING ERRCODE = '55000';
  END IF;
END
$apply_gross_rake_hardening$;

-- @probe-for: public.fn_accounting_union_earned_plan_v3
-- @probe-for: smarter_private.own_agent_interpreted_contract
-- @probe-for: smarter_private.admit_own_agent_source
DO $probe_gross_rake_hardening$
DECLARE
  v_hit_v3  boolean := false;
  v_hit_oic boolean := false;
  v_hit_adm boolean := false;
  v_oic jsonb;
BEGIN
  BEGIN
    PERFORM public.fn_accounting_union_earned_plan_v3(NULL, NULL, NULL);
    RAISE EXCEPTION 'probe-unwind-unexpected-v3';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_hit_v3 := true;
  END;

  v_oic := smarter_private.own_agent_interpreted_contract(
    '{}'::jsonb,
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    0,
    NULL,
    now()
  );
  IF v_oic IS NULL THEN
    v_hit_oic := true;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    PERFORM smarter_private.admit_own_agent_source('cash_rake_accrual', '00000000-0000-0000-0000-000000000000'::uuid);
    RAISE EXCEPTION 'probe-unwind-unexpected-adm';
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_hit_adm := true;
  END;

  IF NOT v_hit_v3 OR NOT v_hit_oic OR NOT v_hit_adm THEN
    RAISE EXCEPTION 'probe-unwind-incomplete';
  END IF;

  BEGIN
    RAISE EXCEPTION 'probe-unwind';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe-unwind' THEN
      RAISE;
    END IF;
  END;
END
$probe_gross_rake_hardening$;

COMMIT;
