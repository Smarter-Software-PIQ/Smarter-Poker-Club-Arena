-- The event completed at 2026-11-08 05:05:19Z before the net-coverage fix installed.
-- Its original 1742 place / 670 bounty settlement is immutable. The union promo
-- fund pays the exact 88-chip guarantee debt to all eleven recorded finishers,
-- using the original published percentages and canonical integer-cent ladder.
-- Existing approved-adjustment and idempotent credit doors preserve sealed books.
-- Probe once with app.owner_net_guarantee_probe=on; commit requires the returned
-- evidence digest (app.owner_net_guarantee_expected_paid) and promo balance
-- (app.owner_net_guarantee_expected_promo). One call, one transaction.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $correction$
DECLARE
 t constant uuid:='f22ceae6-2850-40ef-8f97-7d3660be32a3';
 bank constant uuid:='fade0000-0000-0000-0000-000000000001';
 migration constant text:='20261108041131_net_guarantee_coverage_and_union_promo_funding';
 prefix constant text:='net-guarantee-house:f22ceae6-2850-40ef-8f97-7d3660be32a3:';
 tr public.tournaments%ROWTYPE; er jsonb; terminal jsonb; paid jsonb; roster jsonb; obligations jsonb;
 weights jsonb; plan jsonb; wallets jsonb; evidence text; before_bank numeric; after_bank numeric;
 r record; k text; adj uuid; description text; reason text; balance_before numeric; balance_after numeric;
 receipts jsonb:='[]'; total numeric:=0; n integer; leg jsonb;
 probe boolean:=coalesce(current_setting('app.owner_net_guarantee_probe',true),'')='on';
BEGIN
 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(t);
 SELECT * INTO STRICT tr FROM public.tournaments WHERE id=t FOR UPDATE;
 SELECT to_jsonb(e) INTO STRICT er FROM public.tournament_escrow e WHERE tournament_id=t FOR UPDATE;
 SELECT to_jsonb(h) INTO STRICT terminal FROM public.tournament_terminal_settlements h WHERE tournament_id=t FOR UPDATE;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=t ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tournament_payouts WHERE tournament_id=t ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.tournament_obligations WHERE tournament_id=t ORDER BY id FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO paid FROM public.tournament_payouts p WHERE tournament_id=t;
 SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') INTO roster FROM public.tournament_players p WHERE tournament_id=t;
 SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') INTO obligations FROM public.tournament_obligations o WHERE tournament_id=t;
 IF tr.status<>'COMPLETED' OR tr.prize_pool<>1742 OR tr.bounty_pool<>670 OR tr.total_rake<>268
 OR tr.guaranteed_prize<>2500 OR tr.union_id<>bank OR tr.club_id<>bank OR NOT tr.prize_pool_finalized
 OR tr.payout_math_version<>1 OR public.fn_ca_tournament_unit_cents(t)<>1 OR coalesce(tr.bubble_protection,false)
 OR terminal->>'settlement_mode'<>'places' OR (terminal->>'cash_payout_total')::numeric<>1742
 OR (terminal->>'bounty_payout_total')::numeric<>670 OR (terminal->>'cash_payout_count')::integer<>11
 OR (terminal->>'prize_pool')::numeric<>1742 OR (terminal->>'bounty_pool')::numeric<>670
 OR terminal->>'completed_at' IS NULL OR er->>'terminal_closed_at' IS DISTINCT FROM terminal->>'completed_at'
 OR (er->>'prize_balance')::numeric<>0 OR (er->>'bounty_balance')::numeric<>0 OR (er->>'fee_balance')::numeric<>0
 OR (er->>'prize_out')::numeric<>1742 OR jsonb_array_length(paid)<>11 OR jsonb_array_length(roster)<>67
 OR EXISTS(SELECT 1 FROM public.tournament_payouts WHERE tournament_id=t AND (source<>'structure' OR paid_at IS NULL))
 THEN RAISE EXCEPTION 'completed 88-chip guarantee evidence changed'; END IF;
 SELECT jsonb_agg(jsonb_build_object('place',(e->>'place')::integer,'bp',round((e->>'percentage')::numeric*100)::bigint) ORDER BY (e->>'place')::integer)
 INTO weights FROM jsonb_array_elements(tr.payout_structure::jsonb)e;
 SELECT jsonb_agg(jsonb_build_object('place',l.place,'user_id',p.user_id,'club_id',p.club_id,
   'original',p.amount,'entitlement',l.cents::numeric/100,'delta',l.cents::numeric/100-p.amount) ORDER BY l.place)
 INTO plan FROM public.fn_ca_prize_ladder(183000,weights,1)l
 JOIN (SELECT x.position,x.user_id,x.amount,tp.club_id FROM public.tournament_payouts x
 JOIN public.tournament_players tp ON tp.tournament_id=x.tournament_id AND tp.user_id=x.user_id AND tp.position=x.position
 WHERE x.tournament_id=t)p ON p.position=l.place;
 IF jsonb_array_length(plan)<>11 OR (SELECT sum((e->>'delta')::numeric) FROM jsonb_array_elements(plan)e)<>88
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(plan)e WHERE (e->>'delta')::numeric<=0)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(plan)e WHERE public.fn_player_home_club((e->>'user_id')::uuid,NULL) IS DISTINCT FROM (e->>'club_id')::uuid)
 THEN RAISE EXCEPTION 'canonical 88-chip recipient plan changed'; END IF;
 -- Lock every destination deterministically before the source; no paid amount is inferred from current balances.
 PERFORM 1 FROM public.club_members m JOIN jsonb_array_elements(plan)e
 ON m.user_id=(e->>'user_id')::uuid AND m.club_id=(e->>'club_id')::uuid ORDER BY m.club_id,m.user_id FOR NO KEY UPDATE OF m;
 SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'club_id',m.club_id,'balance',m.chip_balance) ORDER BY m.club_id,m.user_id)
 INTO wallets FROM public.club_members m JOIN jsonb_array_elements(plan)e ON m.user_id=(e->>'user_id')::uuid AND m.club_id=(e->>'club_id')::uuid;
 IF jsonb_array_length(wallets)<>11 THEN RAISE EXCEPTION 'missing recipient wallet'; END IF;
 SELECT promo_wallet INTO STRICT before_bank FROM public.union_wallets WHERE union_id=bank FOR UPDATE;
 evidence:=md5(jsonb_build_object('tournament',to_jsonb(tr),'terminal',terminal,'escrow',er,'paid',paid,'roster',roster,'obligations',obligations,'plan',plan,'wallets',wallets)::text);
 SELECT count(*) INTO n FROM public.wallet_credit_idempotency WHERE key LIKE prefix||'%';
 IF n>0 THEN
   IF n<>11 OR (SELECT sum(amount) FROM public.wallet_credit_idempotency WHERE key LIKE prefix||'%')<>88
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(plan)e WHERE NOT EXISTS(
     SELECT 1 FROM public.wallet_credit_idempotency c JOIN public.chip_ledger l ON l.idempotency_key=c.key
     JOIN public.ca_manual_adjustments a ON a.id=l.correlation_id
     WHERE c.key=prefix||(e->>'user_id') AND c.user_id=(e->>'user_id')::uuid AND c.amount=(e->>'delta')::numeric
     AND l.from_type='union_wallet' AND l.from_entity_id=bank AND l.from_label='union_wallets.promo_wallet'
     AND l.to_type='player_wallet' AND l.to_entity_id=c.user_id AND l.amount=c.amount AND l.tournament_id IS NULL
     AND l.category='settlement' AND a.tournament_id=t AND a.target_id=c.user_id AND a.amount=c.amount AND a.status='settled'))
   THEN RAISE EXCEPTION '88-chip replay receipts conflict'; END IF;
   RETURN;
 END IF;
 IF before_bank IS NULL OR before_bank::text IN ('NaN','Infinity','-Infinity') OR before_bank<88 THEN RAISE EXCEPTION 'union promo balance insufficient'; END IF;
 IF NOT probe AND (current_setting('app.owner_net_guarantee_expected_paid',true) IS DISTINCT FROM evidence
   OR nullif(current_setting('app.owner_net_guarantee_expected_promo',true),'')::numeric IS DISTINCT FROM before_bank)
 THEN RAISE EXCEPTION '88-chip proof inputs changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_manual_adjustments WHERE tournament_id=t AND decision_note='migration '||migration)
 THEN RAISE EXCEPTION 'foreign guarantee adjustment exists'; END IF;
 FOR r IN SELECT * FROM jsonb_to_recordset(plan) AS x(place integer,user_id uuid,club_id uuid,original numeric,entitlement numeric,delta numeric) ORDER BY place LOOP
   k:=prefix||r.user_id::text;
   description:=format('Union Promo Guarantee Supplement Place %s',r.place);
   reason:=format('Player %s finished place %s in event %s and received %s from the sealed 1742-chip place pool. The guarantee excludes the 268-chip rake: 1742 places plus 670 bounties left 88 chips missing from 2500. The unchanged published percentages and canonical whole-cent 1830-chip ladder entitle this player to %s, so the union promo wallet pays exactly %s more under %s. The completed original settlement, standings, payouts and escrow are preserved; nobody is clawed back or paid twice.',r.user_id,r.place,t,r.original,r.entitlement,r.delta,migration);
   adj:=public.fn_ca_adjustment_under_10_9(t,r.user_id,r.delta,reason,migration,'Codex owner-authorized net guarantee correction');
   SELECT chip_balance INTO STRICT balance_before FROM public.club_members WHERE user_id=r.user_id AND club_id=r.club_id;
   PERFORM public.fn_ca_declare_ledger('settlement','union_wallet',bank,NULL,k,ARRAY['union_wallets']);
   PERFORM set_config('app.ledger_counterparty_label','union_wallets.promo_wallet',true);
   PERFORM set_config('app.ledger_correlation',adj::text,true);
   UPDATE public.union_wallets SET promo_wallet=promo_wallet-r.delta,updated_at=now() WHERE union_id=bank AND promo_wallet>=r.delta RETURNING promo_wallet INTO after_bank;
   IF NOT FOUND THEN RAISE EXCEPTION 'promo debit refused'; END IF;
   IF public.fn_credit_and_log(r.user_id,r.delta,k,'settlement',description,NULL) IS NOT TRUE THEN RAISE EXCEPTION 'guarantee supplement credit refused'; END IF;
   PERFORM set_config('app.ledger_autoskip_union_wallets','',true);
   PERFORM set_config('app.ledger_counterparty','',true);
   PERFORM set_config('app.ledger_counterparty_entity','',true);
   PERFORM set_config('app.ledger_counterparty_label','',true);
   PERFORM set_config('app.ledger_category','',true);
   PERFORM set_config('app.ledger_idempotency_key','',true);
   PERFORM set_config('app.ledger_correlation','',true);
   SELECT chip_balance INTO STRICT balance_after FROM public.club_members WHERE user_id=r.user_id AND club_id=r.club_id;
   IF balance_after IS DISTINCT FROM balance_before+r.delta THEN RAISE EXCEPTION 'recipient credit mismatch'; END IF;
   SELECT to_jsonb(l) INTO STRICT leg FROM public.chip_ledger l WHERE idempotency_key=k;
   IF leg->>'from_type'<>'union_wallet' OR leg->>'from_entity_id'<>bank::text OR leg->>'from_label'<>'union_wallets.promo_wallet'
   OR leg->>'to_type'<>'player_wallet' OR leg->>'to_entity_id'<>r.user_id::text OR (leg->>'amount')::numeric<>r.delta
   OR leg->>'tournament_id' IS NOT NULL OR leg->>'category'<>'settlement' OR leg->>'correlation_id'<>adj::text
   THEN RAISE EXCEPTION 'guarantee supplement journal mismatch'; END IF;
   UPDATE public.ca_manual_adjustments SET status='settled' WHERE id=adj AND status='approved';
   IF NOT FOUND THEN RAISE EXCEPTION 'guarantee supplement adjustment refused'; END IF;
   receipts:=receipts||jsonb_build_object('place',r.place,'user_id',r.user_id,'club_id',r.club_id,'amount',r.delta,'adjustment_id',adj,'key',k,'ledger_id',leg->>'id');
   total:=total+r.delta;
 END LOOP;
 IF total<>88 OR after_bank IS DISTINCT FROM before_bank-88
 OR to_jsonb(tr) IS DISTINCT FROM (SELECT to_jsonb(x) FROM public.tournaments x WHERE id=t)
 OR terminal IS DISTINCT FROM (SELECT to_jsonb(x) FROM public.tournament_terminal_settlements x WHERE tournament_id=t)
 OR er IS DISTINCT FROM (SELECT to_jsonb(x) FROM public.tournament_escrow x WHERE tournament_id=t)
 OR paid IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_payouts x WHERE tournament_id=t)
 OR roster IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_players x WHERE tournament_id=t)
 OR obligations IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.tournament_obligations x WHERE tournament_id=t)
 THEN RAISE EXCEPTION 'guarantee supplement conservation or sealed evidence failed'; END IF;
 IF probe THEN RAISE EXCEPTION USING MESSAGE='OWNER_NET_GUARANTEE_ROLLBACK '||jsonb_build_object('paid_digest',evidence,'promo_before',before_bank,'promo_after',after_bank,'total',total,'plan',plan,'receipts',receipts)::text; END IF;
 RAISE NOTICE '88 promo chips paid to all eleven finishers; original sealed books unchanged: %',receipts;
END $correction$;
