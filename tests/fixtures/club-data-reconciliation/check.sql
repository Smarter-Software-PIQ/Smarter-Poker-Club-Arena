DO $test$
DECLARE r jsonb; k constant uuid:='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'; f constant uuid:='a0000000-0000-0000-0000-000000000001';
BEGIN
 BEGIN
  PERFORM fn_ca_club_acct_cash_fee_rows('[{"id":"eeeeeeee-0000-0000-0000-000000009099","rake_record_id":"eeeeeeee-0000-0000-0000-000000009098","player_id":"11111111-0000-0000-0000-000000000001","club_id":"a41434bb-8d0c-400a-8f0d-e8b3d65afed4","union_id":"fade0000-0000-0000-0000-000000000001","earned_at":"2026-11-10T12:00Z","rake_credit":1}]');
  RAISE EXCEPTION 'missing RR and RA incorrectly treated as zero BBJ';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE 'CLUB_DATA_BBJ_ORIGINAL_SOURCE_INCOMPLETE:%' THEN RAISE; END IF;
 END;
 IF (SELECT sum(bbj_gross) FROM ca_club_acct_fact_ct WHERE club_id=k AND stat_date='2026-11-10') IS DISTINCT FROM 4.25 THEN RAISE EXCEPTION 'original BBJ/late ownership not exact'; END IF;
 IF (SELECT sum(bbj_gross) FROM ca_club_acct_fact_ct WHERE club_id=f AND stat_date='2026-11-10') IS DISTINCT FROM 2.50 THEN RAISE EXCEPTION 'funded club BBJ not exact'; END IF;
 IF (SELECT sum(bbj_awards) FROM ca_club_acct_fact_ct WHERE club_id=k AND stat_date='2026-11-10') IS DISTINCT FROM 2::numeric THEN RAISE EXCEPTION 'original award not exact'; END IF;
 r:=ca_club_data_screen_union_basis(k,'2026-11-10','2026-11-10')->'summary';
 IF (r->>'fee')::numeric<>8 OR (r->>'total_winnings')::numeric<>-10.25 OR (r#>>'{reconciliation,bbj_gross}')::numeric<>4.25 THEN RAISE EXCEPTION 'public Data headline or original BBJ differs: %',r;END IF;
 r:=ca_club_data_screen_union_basis(k,'2026-11-10','2026-11-10','MTT')->'summary';
 IF (r#>>'{reconciliation,bbj_gross}')::numeric<>0 THEN RAISE EXCEPTION 'filtered MTT screen exposes cash BBJ';END IF;
 r:=fn_ca_club_acct_reconciliation(k,'2026-11-10','2026-11-10','{"cash_fee":8,"cash_winnings":-10.25,"tournament_fee":5,"tournament_winnings":-7}');
 IF r->>'bbj_gross'<>'4.25' OR r->>'bbj_net'<>'2.25' OR (r->>'cash_residual')::numeric<>0 OR (r->>'tournament_flow_difference')::numeric<>2 THEN RAISE EXCEPTION 'cash/tournament reconciliation differs: %',r;END IF;
 r:=fn_ca_club_acct_reconciliation(k,'2026-11-10','2026-11-10','{}',ARRAY['11111111-0000-0000-0000-000000000002'::uuid]);
 IF (r->>'bbj_gross')::numeric<>0 THEN RAISE EXCEPTION 'downline scope leaked another player';END IF;
 r:=fn_ca_club_acct_reconciliation(k,'2026-11-10','2026-11-10','{}',NULL,ARRAY[]::uuid[]);
 IF (r->>'bbj_gross')::numeric<>0 OR (r->>'bbj_awards')::numeric<>0 THEN RAISE EXCEPTION 'noncash filter included BBJ';END IF;
 IF fn_ca_accounting_day('2026-11-01 07:00Z')<>date '2026-11-01' OR fn_ca_accounting_day_start('2026-11-02')-fn_ca_accounting_day_start('2026-11-01')<>interval '25 hours' THEN RAISE EXCEPTION 'Pacific source boundary changed';END IF;
END $test$;
