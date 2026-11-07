-- 20261107195146_a_union_own_club_is_house_rake_not_rakeback
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 19:51:46 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- A UNION'S OWN CLUB IS HOUSE RAKE, NOT RAKEBACK (2026-11-07).
--
-- Rake earned at a union's own club (the club row whose id is the union id,
-- clubs.is_union = true) is house rake: round 1 of the union close keeps all
-- of it in the union bank and pays rakeback only on the member clubs' basis.
-- Every Midway week since the v3 rules (2026-09-21) shows it - period_rake
-- minus the member clubs' basis equals house_rake, retained in full (835,
-- 2,648, 853, 96 chips for 09-28..10-19). The owner's recorded floor reason
-- for the August weeks says the same: the old basis "credited the
-- union-as-a-club". fn_accounting_week_clubs excludes the union club
-- (x.id<>p_union_id, since 20261016000241) and the close counts any pending
-- rakeback period at the union club as an error (union_rakeback_wrong_club).
--
-- Yet six were written on 2026-11-02 20:15:00 for the 10-26 week - 54.95 on
-- 78.50 of tournament fees from union-hosted events (Sunday Funday Main Event,
-- Union Mystery Bounty, Nightly 10K, Sunday 200 Deep Stack), payer the union
-- club. Writer, proven from the request row and calculation timestamps:
-- fn_accounting_split_advance_due (cron 272's chunked tick) resumed
-- leftover split parts for the union club - parts that no installed code
-- creates, left part-done by that day's owner-override recovery - through
-- fn_rakeback_recompute_split -> fn_rakeback_split_write. The round 1 receipt
-- for that week (ca_settlements 8b447f71-6531-40d0-9b84-fe9d012c3c28) shows
-- house_rake 78.5 retained: the same 78.50, already in the union bank. So the
-- 54.95 is not owed, and paying it would pay the same rake twice. Nothing
-- moved: no rakeback_period_payouts row and no ledger leg for these six.
--
-- 1. THE WRITERS REFUSE A UNION'S OWN CLUB. fn_rakeback_recompute_periods and
--    fn_rakeback_recompute_split raise rakeback_for_union_own_club_refused,
--    and fn_accounting_split_advance_due stops resuming parts for such a club.
--    The paying calculator, split_check and split_write are NOT touched: their
--    md5s are recorded by own-agent preparation and changing them would make
--    already-prepared weeks refuse to pay.
-- 2. THE SIX ARE RETIRED as status 'closed' with the reason, exactly as the
--    union-club periods of 09-14 were ('closed', "Superseded by
--    owner-authorized operation"), each re-checked: pending, at the union
--    club, never paid, and together 54.95 on 78.50 of rake equal to the
--    round 1 house_rake. A re-run retires 0.
--
-- @live-proof: (SELECT count(*) FROM public.rakeback_periods WHERE club_id='fade0000-0000-0000-0000-000000000001' AND period_start='2026-10-26' AND status='pending')=0 AND position('rakeback_for_union_own_club_refused' IN pg_get_functiondef('public.fn_rakeback_recompute_split(uuid,date,date)'::regprocedure))>0 AND position('rakeback_for_union_own_club_refused' IN pg_get_functiondef('public.fn_rakeback_recompute_periods(uuid,date,date,uuid[])'::regprocedure))>0 AND position('c.is_union IS TRUE' IN pg_get_functiondef('public.fn_accounting_split_advance_due()'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $house_rake$
DECLARE
  c_periods constant text := 'public.fn_rakeback_recompute_periods(uuid,date,date,uuid[])';
  c_split   constant text := 'public.fn_rakeback_recompute_split(uuid,date,date)';
  c_advance constant text := 'public.fn_accounting_split_advance_due()';
  guard constant text := E'\n IF EXISTS(SELECT 1 FROM public.clubs u WHERE u.id=p_club_id AND u.is_union IS TRUE) THEN\n  -- A UNION''S OWN CLUB IS HOUSE RAKE (20261107195146): round 1 retains it.\n  RAISE EXCEPTION ''rakeback_for_union_own_club_refused'' USING ERRCODE=''22023'';\n END IF;';
  a_p constant text := E' THEN RAISE EXCEPTION ''invalid_accounting_period_request'' USING ERRCODE=''22023''; END IF;\n IF public.fn_ca_launch_accounting_waived(''club'',p_club_id,';
  a_s constant text := E'BEGIN\n IF COALESCE(current_setting(''app.weekly_accounting_chunked'',true),'''')<>''on''';
  a_a constant text := E'WHERE p.kind=''players'' ORDER BY p.computed_at,p.club_id,p.period_start LOOP';
  r_a constant text := E'WHERE p.kind=''players''\n     AND NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=p.club_id AND c.is_union IS TRUE)\n   ORDER BY p.computed_at,p.club_id,p.period_start LOOP';
  dp text; ds text; da text; m jsonb; m2 jsonb; n integer; v_sum numeric; v_rake numeric; v_house numeric;
BEGIN
  dp := pg_get_functiondef(c_periods::regprocedure);
  ds := pg_get_functiondef(c_split::regprocedure);
  da := pg_get_functiondef(c_advance::regprocedure);
  IF md5(dp) IS DISTINCT FROM '34534e8ec5452e854db21fb4e7b4bc3a' OR md5(ds) IS DISTINCT FROM '70340fa2112a400cb3dd2a48bba9c98f'
     OR md5(da) IS DISTINCT FROM 'bb03eb0985cf5aa9b6c3704cf0b33131' THEN
    RAISE EXCEPTION 'HOUSE_RAKE_PREIMAGE_DRIFT' USING ERRCODE='55000';
  END IF;
  IF (length(dp)-length(replace(dp,a_p,'')))/length(a_p)<>1 OR (length(ds)-length(replace(ds,a_s,'')))/length(a_s)<>1
     OR (length(da)-length(replace(da,a_a,'')))/length(a_a)<>1 THEN
    RAISE EXCEPTION 'HOUSE_RAKE_ANCHORS' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) ORDER BY oid) INTO m
    FROM pg_proc WHERE oid IN (c_periods::regprocedure, c_split::regprocedure, c_advance::regprocedure);
  EXECUTE replace(dp, a_p, replace(a_p, E' END IF;\n IF public.fn_ca_launch', E' END IF;'||guard||E'\n IF public.fn_ca_launch'));
  EXECUTE replace(ds, a_s, E'BEGIN'||guard||substr(a_s, 6));
  EXECUTE replace(da, a_a, r_a);
  SELECT jsonb_agg(jsonb_build_object('o',proowner,'a',proacl,'s',prosecdef,'c',proconfig,'v',provolatile) ORDER BY oid) INTO m2
    FROM pg_proc WHERE oid IN (c_periods::regprocedure, c_split::regprocedure, c_advance::regprocedure);
  IF m2 IS DISTINCT FROM m THEN RAISE EXCEPTION 'HOUSE_RAKE_METADATA_CHANGED' USING ERRCODE='55000'; END IF;
  IF md5(pg_get_functiondef(c_periods::regprocedure)) IS DISTINCT FROM 'ab0d968bb5228ca44cf2a5d703aeb925'
     OR md5(pg_get_functiondef(c_split::regprocedure)) IS DISTINCT FROM 'c588b50d35036fc2be1fecbbe5514324'
     OR md5(pg_get_functiondef(c_advance::regprocedure)) IS DISTINCT FROM '2228aae0a157fe6821287f4128918b25' THEN
    RAISE EXCEPTION 'HOUSE_RAKE_POSTIMAGE_DRIFT' USING ERRCODE='55000';
  END IF;

  -- 2. Retire the six, re-checked against the round 1 house_rake.
  SELECT (c.totals->>'house_rake')::numeric INTO v_house FROM public.ca_settlements c
   WHERE c.id='8b447f71-6531-40d0-9b84-fe9d012c3c28' AND c.settlement_type='union_rakeback_close' AND c.union_id='fade0000-0000-0000-0000-000000000001';
  SELECT count(*), COALESCE(sum(rp.rakeback_amount),0), COALESCE(sum(rp.rake_generated),0) INTO n, v_sum, v_rake
    FROM public.rakeback_periods rp
   WHERE rp.id IN ('116eb1b1-02c3-4df3-8bef-d56ebb36f549','3408004c-e8b5-4214-ae16-d46c03c1a8b2','99e5c7a5-013a-430b-a729-93134fba3e42','9cb6798d-ce7e-476f-b7ab-9ceff1356aa6','b1a76e1c-c035-4c6e-b32c-372f903f5941','d66343ce-47ca-41be-80a6-2b3c75eb345e')
     AND rp.club_id='fade0000-0000-0000-0000-000000000001' AND rp.period_start='2026-10-26' AND rp.status='pending' AND rp.paid_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.rakeback_period_payouts pp WHERE pp.rakeback_period_id=rp.id);
  IF n = 6 THEN
    IF v_sum IS DISTINCT FROM 54.95 OR v_rake IS DISTINCT FROM 78.50 OR v_house IS DISTINCT FROM 78.5 THEN
      RAISE EXCEPTION 'HOUSE_RAKE_SIX_DRIFTED: % periods, rakeback %, rake %, round 1 house_rake %', n, v_sum, v_rake, v_house USING ERRCODE='55000';
    END IF;
    UPDATE public.rakeback_periods rp
       SET status='closed', deferred_at=now(),
           deferred_reason='House rake, not rakeback: earned at the union''s own club and retained in full by round 1 (ca_settlements 8b447f71-6531-40d0-9b84-fe9d012c3c28 house_rake 78.5); written in error 2026-11-02 by a resumed split (20261107195146)'
     WHERE rp.id IN ('116eb1b1-02c3-4df3-8bef-d56ebb36f549','3408004c-e8b5-4214-ae16-d46c03c1a8b2','99e5c7a5-013a-430b-a729-93134fba3e42','9cb6798d-ce7e-476f-b7ab-9ceff1356aa6','b1a76e1c-c035-4c6e-b32c-372f903f5941','d66343ce-47ca-41be-80a6-2b3c75eb345e')
       AND rp.status='pending';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 6 THEN RAISE EXCEPTION 'HOUSE_RAKE_RETIRED_%', n USING ERRCODE='55000'; END IF;
  ELSIF n <> 0 OR EXISTS(SELECT 1 FROM public.rakeback_periods WHERE club_id='fade0000-0000-0000-0000-000000000001' AND period_start='2026-10-26' AND status='pending') THEN
    RAISE EXCEPTION 'HOUSE_RAKE_SIX_PARTIAL: % of 6 still pending', n USING ERRCODE='55000';
  END IF;
END $house_rake$;

COMMIT;
