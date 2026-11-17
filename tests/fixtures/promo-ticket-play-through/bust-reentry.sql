-- Disposable original accepted-generation opening only; never production.
-- Opening bankroll and prior P custody are synthetic. Every new purchase,
-- original bounty settlement, journal and deferred money guard remains real.
UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 second';
DO $prior_promo_opening$
DECLARE gid uuid;
BEGIN
 gid:=public.fn_ca_promo_play_through_record_grant('20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000001',8,'club_promo','native-bust-prior-entry');
 PERFORM public.fn_ca_promo_move_custody('20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000001','player_wallet','b7100000-0000-4000-8000-000000000001','event','b7200000-0000-4000-8000-000000000001',8,'spent');
 INSERT INTO public.ca_promo_event_principal_lots(grant_id,tournament_id,source_ref,original_amount,remaining)
 VALUES(gid,'b7200000-0000-4000-8000-000000000001','native-bust-prior-entry',8,8);
END $prior_promo_opening$;
DO $actual_reentry_after_bust$
DECLARE result jsonb;again jsonb;summary jsonb;gid uuid;changed boolean:=false;
BEGIN
 SELECT id INTO STRICT gid FROM public.ca_promo_play_through_grants WHERE source_ref='native-bust-prior-entry';
 result:=public.process_tournament_rebuy('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001','reentry',10,100,1,'native-promo-bust-reentry');
 IF result->>'success'<>'true' OR result->>'candidate_state'<>'rebought' OR result->>'prior_bounty_marker_verified'<>'true' THEN RAISE EXCEPTION 'actual original reentry did not close accepted old generation: %',result;END IF;
 again:=public.process_tournament_rebuy('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001','reentry',10,100,1,'native-promo-bust-reentry');
 IF result IS DISTINCT FROM again THEN RAISE EXCEPTION 'actual purchase receipt did not replay';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_grants WHERE id=gid AND remaining=0 AND close_reason='spent' AND fee_target=32) THEN RAISE EXCEPTION 'old promo principal did not permanently retire with original fee target evidence';END IF;
 IF (SELECT count(*) FROM public.ca_promo_event_entry_loss_receipts WHERE candidate_id='b7800000-0000-4000-8000-000000000001' AND principal=8)<>1 THEN RAISE EXCEPTION 'original entry loss was missing or duplicated';END IF;
 IF (SELECT sum(amount) FROM public.ca_promo_event_entry_loss_slices WHERE candidate_id='b7800000-0000-4000-8000-000000000001')<>8 THEN RAISE EXCEPTION 'original entry loss slice provenance changed';END IF;
 IF public.fn_ca_promo_locked_at('20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000001','player_wallet','b7100000-0000-4000-8000-000000000001')<>0 THEN RAISE EXCEPTION 'old busted principal locked new own funds';END IF;
 summary:=public.fn_ca_promo_play_through_summary('20000000-0000-0000-0000-000000000001','b7100000-0000-4000-8000-000000000001');
 IF (summary->>'wallet')::numeric<>90 OR (summary->>'cashable')::numeric<>90 OR (summary->>'locked')::numeric<>0 OR (summary->>'fee_target')::numeric<>0 THEN RAISE EXCEPTION 'remaining own bankroll acquired a phantom promo requirement: %',summary;END IF;
 IF public.fn_ca_promo_retire_busted_entry('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001','b7800000-0000-4000-8000-000000000001','native-promo-bust-reentry')<>8 THEN RAISE EXCEPTION 'original loss receipt did not replay';END IF;
 BEGIN PERFORM public.fn_ca_promo_retire_busted_entry('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000001','b7800000-0000-4000-8000-000000000001','changed-operation');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'promo_bust_loss_retry_intent_changed' THEN RAISE;END IF;changed:=true;END;
 IF NOT changed THEN RAISE EXCEPTION 'changed original loss operation was accepted';END IF;
END $actual_reentry_after_bust$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
