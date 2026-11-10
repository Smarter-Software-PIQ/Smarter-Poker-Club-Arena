-- @live-proof: (SELECT position('Midway Prize Funding Unavailable' IN pg_get_functiondef('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)'::regprocedure))>0)
-- Existing prize operations lock the union wallet first, then the playing club.
-- Preserve the existing payer's ABI, trigger-owned journal and single member receipt.
BEGIN;
CREATE TABLE public.wheel_midway_chip_funding (
 prize_key text PRIMARY KEY, category text NOT NULL, club_id uuid NOT NULL, player_id uuid NOT NULL,
 amount numeric NOT NULL CHECK(amount>0), promo numeric NOT NULL CHECK(promo>=0),
 club_cash numeric NOT NULL CHECK(club_cash>=0), union_cash numeric NOT NULL CHECK(union_cash>=0),
 platform_cash numeric NOT NULL CHECK(platform_cash>=0), member_after numeric NOT NULL,
 promo_after numeric NOT NULL, bank_after numeric NOT NULL, cover_after numeric NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(amount=promo+club_cash+union_cash+platform_cash)
);
ALTER TABLE public.wheel_midway_chip_funding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wheel_midway_chip_funding FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE public.wheel_midway_chip_funding TO service_role;
-- Earned games keep their original decision and reservation while a real source is unavailable.
CREATE TABLE public.wheel_midway_prize_claims (
 prize_key text PRIMARY KEY, club_id uuid NOT NULL, player_id uuid NOT NULL, category text NOT NULL,
 amount numeric NOT NULL CHECK(amount>0), uncovered numeric NOT NULL CHECK(uncovered>0 AND uncovered<=amount),
 decision jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
ALTER TABLE public.wheel_midway_prize_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wheel_midway_prize_claims FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.wheel_midway_prize_claims TO service_role;
CREATE FUNCTION public.fn_midway_prize_wait(p_detail text,p_decision jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public AS $wait$
DECLARE d jsonb:=p_detail::jsonb; amount_due numeric:=(d->>'prize_chips')::numeric;
BEGIN
 IF d->>'source' IS DISTINCT FROM 'midway_wheel' THEN RAISE EXCEPTION 'Unrecognized prize refusal'; END IF;
 INSERT INTO public.wheel_midway_prize_claims(prize_key,club_id,player_id,category,amount,uncovered,decision)
 VALUES(d->>'prize_key',(d->>'club_id')::uuid,(d->>'player_id')::uuid,d->>'category',amount_due,(d->>'uncovered_chips')::numeric,p_decision)
 ON CONFLICT(prize_key) DO NOTHING;
 RETURN jsonb_build_object('ok',false,'pending_prize',true,'paid',false,'prize_chips',amount_due,
   'error',format('Your %s Chip Prize Is Reserved. Open Diamond Spins And Choose Claim Prize To Retry Payment.',amount_due));
END $wait$;
REVOKE ALL ON FUNCTION public.fn_midway_prize_wait(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_midway_prize_wait(text,jsonb) TO service_role;

DO $migration$
DECLARE
 target regprocedure:='public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)'::regprocedure;
 definition text:=pg_get_functiondef(target); edit record;
BEGIN
 FOR edit IN SELECT * FROM (VALUES
 ($old$  v_lock record;$old$,$new$  v_lock record;
  midway boolean := p_kind='union' AND p_host='fade0000-0000-0000-0000-000000000001'::uuid
    AND public.fn_diamond_spin_ledger_category(p_category);
  union_available numeric:=0; union_part numeric:=0; platform_part numeric:=0;
  union_after numeric; club_part numeric; policy public.ca_mint_policy%ROWTYPE;
  prior public.wheel_midway_chip_funding; issuer_room numeric; funded jsonb; leg record; copied numeric;$new$),
 ($old$  IF p_kind = 'union' THEN
    SELECT COALESCE(chip_treasury, 0)$old$,$new$  IF midway THEN
    IF nullif(btrim(p_key),'') IS NULL THEN RAISE EXCEPTION 'Midway prize requires a settlement key'; END IF;
    SELECT * INTO prior FROM public.wheel_midway_chip_funding WHERE prize_key=p_key;
    IF FOUND THEN
      IF (prior.club_id,prior.player_id,prior.amount,prior.category) IS DISTINCT FROM (p_club,p_user,p_amount,p_category) THEN
        RAISE EXCEPTION 'Midway prize key already identifies a different settlement';
      END IF;
      promo_after:=prior.promo_after; bank_after:=prior.bank_after; cover_after:=prior.cover_after;
      member_after:=prior.member_after; from_promo:=prior.promo; from_bank:=prior.amount-prior.promo;
      RETURN;
    END IF;
  END IF;
  union_available:=v_lock.o_bank;
  IF p_kind = 'union' THEN
    SELECT COALESCE(chip_treasury, 0)$new$),
 ($old$  IF from_bank > v_lock.o_bank THEN
    RAISE EXCEPTION$old$,$new$  IF midway AND from_bank>greatest(v_lock.o_bank,0) THEN
    club_part:=greatest(v_lock.o_bank,0);
    union_part:=least(union_available,from_bank-club_part);
    platform_part:=from_bank-club_part-union_part;
    IF platform_part>0 THEN
      PERFORM pg_advisory_xact_lock(hashtext('ca_mint_ledger:chips'));
      SELECT * INTO STRICT policy FROM public.ca_mint_policy WHERE id=1 FOR SHARE;
      issuer_room:=greatest(0,least(policy.per_operation_cap_chips,
        policy.rolling_24h_cap_chips-public.fn_ca_mint_issued_24h('chips')));
      IF platform_part>issuer_room THEN
        -- All funding legs roll back together. The caller preserves the original unpaid prize.
        RAISE LOG 'MIDWAY_WHEEL_UNFUNDED prize_key=% category=% club=% amount=% platform_required=% available=% uncovered=%',
          p_key,p_category,p_club,p_amount,platform_part,issuer_room,platform_part-issuer_room;
        RAISE EXCEPTION 'Midway Prize Funding Unavailable' USING ERRCODE='PMW01',
          DETAIL=jsonb_build_object('source','midway_wheel','category',p_category,'club_id',p_club,'player_id',p_user,
            'paid',false,'prize_key',p_key,'prize_chips',p_amount,
            'platform_required',platform_part,'platform_available',issuer_room,
            'uncovered_chips',platform_part-issuer_room)::text;
      END IF;
    END IF;
    from_bank:=club_part;
  ELSIF from_bank > v_lock.o_bank THEN
    RAISE EXCEPTION$new$),
 ($old$  PERFORM set_config('app.ledger_category', '', true);$old$,$new$  IF union_part+platform_part>0 THEN
    FOR leg IN SELECT * FROM (VALUES (':union',union_part),(':platform',platform_part)) AS legs(suffix,amount)
      WHERE amount>0 ORDER BY CASE suffix WHEN ':union' THEN 1 ELSE 2 END
    LOOP
      IF leg.suffix=':platform' THEN
        funded:=public.fn_ca_fund_club(p_club,leg.amount,'Midway Diamond Spins prize '||p_key,p_key||':platform-issue');
        IF (funded->>'ok')::boolean IS DISTINCT FROM true OR coalesce((funded->>'replayed')::boolean,false) THEN
          RAISE EXCEPTION 'Midway platform funding did not produce a new registered issuance';
        END IF;
      END IF;
      PERFORM public.fn_ca_declare_ledger(p_category,'player_wallet',p_user,NULL,p_key||leg.suffix,ARRAY['club_members']);
      IF leg.suffix=':union' THEN
        UPDATE public.union_wallets SET chip_balance=chip_balance-leg.amount,updated_at=now()
          WHERE union_id=p_host AND chip_balance>=leg.amount RETURNING chip_balance INTO union_after;
        IF NOT FOUND THEN RAISE EXCEPTION 'Midway union bank did not fund its locked share'; END IF;
        INSERT INTO public.union_wallet_transactions(union_id,club_id,wallet,direction,amount,balance_after,tx_type,notes,created_by)
          VALUES(p_host,p_club,'chip_balance','debit',leg.amount,union_after,p_category,p_note,p_user);
      ELSE
        UPDATE public.clubs SET chip_treasury=chip_treasury-leg.amount,updated_at=now()
          WHERE id=p_club AND chip_treasury>=leg.amount RETURNING chip_treasury INTO bank_after;
        IF NOT FOUND THEN RAISE EXCEPTION 'Midway platform-funded prize did not leave the playing club'; END IF;
      END IF;
      SELECT amount INTO STRICT copied FROM public.chip_ledger WHERE idempotency_key=p_key||leg.suffix
        AND to_entity_id=p_user AND to_type='player_wallet' AND category=p_category AND status='posted';
      IF copied<>leg.amount THEN RAISE EXCEPTION 'Midway funding leg amount differs from prize'; END IF;
      UPDATE public.club_members SET chip_balance=coalesce(chip_balance,0)+leg.amount,updated_at=now()
        WHERE club_id=p_club AND user_id=p_user AND coalesce(status,'active') IN ('active','approved')
        RETURNING chip_balance INTO STRICT member_after;
    END LOOP;
  END IF;

  PERFORM set_config('app.ledger_category', '', true);$new$),
 ($old$  INSERT INTO public.chip_transactions (club_id, from_user_id$old$,$new$  IF midway THEN
    IF EXISTS(SELECT 1 FROM public.wheel_midway_prize_claims WHERE prize_key=p_key AND
      (amount,club_id,player_id,category) IS DISTINCT FROM (p_amount,p_club,p_user,p_category)) THEN
      RAISE EXCEPTION 'Midway prize does not match its reserved obligation';
    END IF;
    UPDATE public.wheel_midway_prize_claims SET paid_at=now() WHERE prize_key=p_key AND paid_at IS NULL;
    p_meta:=coalesce(p_meta,'{}'::jsonb)||jsonb_build_object('funding_version',2,'from_club_treasury',from_bank,
      'from_union_bank',union_part,'from_platform',platform_part,'funding_key',p_key);
    INSERT INTO public.wheel_midway_chip_funding(prize_key,category,club_id,player_id,amount,promo,club_cash,
      union_cash,platform_cash,member_after,promo_after,bank_after,cover_after)
    VALUES(p_key,p_category,p_club,p_user,p_amount,from_promo,from_bank,union_part,platform_part,
      member_after,promo_after,bank_after,cover_after);
    from_bank:=from_bank+union_part+platform_part;
  END IF;
  INSERT INTO public.chip_transactions (club_id, from_user_id$new$)
 ) edits(before_text,after_text)
 LOOP
  IF (length(definition)-length(replace(definition,edit.before_text,'')))/length(edit.before_text)<>1 THEN
    RAISE EXCEPTION 'Unexpected Diamond Spins payer definition at %',edit.before_text;
  END IF;
  definition:=replace(definition,edit.before_text,edit.after_text);
 END LOOP;
 EXECUTE definition;
END $migration$;
-- The round and pool locks are outside each recoverable payment block. A second request cannot
-- replace a player's first sealed cashout, pick or drop while the claim is awaiting funds.
DO $decisions$
DECLARE edit record; target regprocedure; definition text; definitions jsonb:='{}';
BEGIN
 FOR edit IN SELECT * FROM (VALUES
 ('fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)',$o$  v_member_after numeric;$o$,$n$  held jsonb; reason text;
  v_member_after numeric;$n$),
 ('fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)',$o$   SELECT * INTO v_pay FROM public.fn_diamond_game_pay_chips('wheel_prize'$o$,$n$   BEGIN
   SELECT * INTO v_pay FROM public.fn_diamond_game_pay_chips('wheel_prize'$n$),
 ('fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)',$o$   v_member_after:=v_pay.member_after;$o$,$n$   v_member_after:=v_pay.member_after;
   EXCEPTION WHEN SQLSTATE 'PMW01' THEN
     GET STACKED DIAGNOSTICS reason=PG_EXCEPTION_DETAIL;
     held:=public.fn_midway_prize_wait(reason,jsonb_build_object('note','Diamond Spins: '||v_prize_label,'meta',
       jsonb_build_object('spin_id',v_spin_id,'host_id',v_host,'host_kind',v_kind,'welcome',p_welcome,'bonus_ticket_id',p_bonus_ticket_id,
         'contract_version',4,'vip',v_vip,'multiplier',v_prize_multiplier,'secondary_ord',v_second_ord)));
   END;$n$),
 ('fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)',$o$chips_paid = chips_paid + CASE WHEN p_welcome THEN 0 ELSE v_prize_chips END$o$,$n$chips_paid = chips_paid + CASE WHEN p_welcome OR held IS NOT NULL THEN 0 ELSE v_prize_chips END$n$),
 ('fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)',$o$welcome_chips_paid = welcome_chips_paid + CASE WHEN p_welcome THEN v_value_chips ELSE 0 END$o$,$n$welcome_chips_paid = welcome_chips_paid + CASE WHEN p_welcome AND held IS NULL THEN v_value_chips ELSE 0 END$n$),
 ('fn_wheel_spin_v2(uuid,uuid,text,bigint,text,uuid)',$o$  IF v_award.id IS NOT NULL THEN v_result$o$,$n$  IF held IS NOT NULL THEN v_result:=v_result||jsonb_build_object('chip_prize_reserved',true,'prize_chips',v_prize_chips); END IF;
  IF v_award.id IS NOT NULL THEN v_result$n$),
 ('fn_wheel_bonus_start(uuid,uuid,text,boolean,text,bigint,integer,integer,integer)',$o$ IF a.status='redeemed' THEN$o$,$n$ IF a.host_id='fade0000-0000-0000-0000-000000000001' AND a.host_kind='union' AND a.game='plinko'
    AND p_mode IS NULL AND p_auto_cashout_cents IS NULL AND p_max_steps IS NULL THEN
   -- The old one-shot entry also runs on a durable sealed batch. The staged entry inserts a session
   -- before recursively opening the ordinary award, so this routes only the original legacy call.
   IF a.status='pending' AND NOT EXISTS(SELECT 1 FROM public.wheel_plinko_sessions WHERE award_id=a.id) THEN
     RETURN public.fn_wheel_plinko_begin(a.id,p_commit_id,p_client_seed,p_double,p_denom,p_table_version,p_commit_id,true);
   END IF;
   IF a.status='redeemed' AND a.request=wanted AND EXISTS(
      SELECT 1 FROM public.wheel_midway_prize_claims q WHERE q.prize_key LIKE 'plinko-drop:'||a.id||':%'
        AND q.paid_at IS NULL AND q.decision->>'request'=p_commit_id::text) THEN
     RETURN public.fn_wheel_plinko_release(a.id,p_commit_id,true);
   END IF;
 END IF;
 IF a.status='redeemed' THEN$n$),
 ('fn_choice_act(uuid,text,integer,integer)',$o$BEGIN
 IF auth.uid()$o$,$n$pending public.wheel_midway_prize_claims; reason text;
BEGIN
 IF auth.uid()$n$),
 ('fn_choice_act(uuid,text,integer,integer)',$o$ n:=cardinality(r.picked);$o$,$n$ SELECT * INTO pending FROM public.wheel_midway_prize_claims WHERE prize_key='choice-prize:'||r.id AND paid_at IS NULL;
 IF FOUND THEN
   p_action:=pending.decision->>'action'; p_cell:=(pending.decision->>'cell')::integer;
   p_expected_step:=(pending.decision->>'step')::integer;
 END IF;
 n:=cardinality(r.picked);$n$),
 ('fn_choice_act(uuid,text,integer,integer)',$o$  UPDATE public.diamond_game_pools SET reserved_chips=reserved_chips-r.reserved_chips,
   chips_paid=chips_paid+v_pay,updated_at=now() WHERE host_id=r.host_id AND game=r.game;$o$,$n$  BEGIN
  UPDATE public.diamond_game_pools SET reserved_chips=reserved_chips-r.reserved_chips,
   chips_paid=chips_paid+v_pay,updated_at=now() WHERE host_id=r.host_id AND game=r.game;$n$),
 ('fn_choice_act(uuid,text,integer,integer)',$o$ END IF;
 UPDATE public.diamond_choice_rounds SET mine_cells=r.mine_cells,picked=r.picked,status=r.status,payout_chips=v_pay,
  settled_at=CASE WHEN r.status<>'open' THEN clock_timestamp() END WHERE id=r.id RETURNING * INTO r;$o$,$n$  EXCEPTION WHEN SQLSTATE 'PMW01' THEN
    GET STACKED DIAGNOSTICS reason=PG_EXCEPTION_DETAIL;
    RETURN public.fn_midway_prize_wait(reason,jsonb_build_object('action',p_action,'cell',p_cell,'step',p_expected_step));
  END;
 END IF;
 UPDATE public.diamond_choice_rounds SET mine_cells=r.mine_cells,picked=r.picked,status=r.status,payout_chips=v_pay,
  settled_at=CASE WHEN r.status<>'open' THEN clock_timestamp() END WHERE id=r.id RETURNING * INTO r;$n$),
 ('fn_crash_decide(public.crash_rounds,boolean,text,integer)',$o$  v_intake_chips numeric;$o$,$n$  v_intake_chips numeric; pending public.wheel_midway_prize_claims; reason text;$n$),
 ('fn_crash_decide(public.crash_rounds,boolean,text,integer)',$o$  IF r.auto_cashout_cents IS NOT NULL AND$o$,$n$  SELECT * INTO pending FROM public.wheel_midway_prize_claims WHERE prize_key='crash-prize:'||r.id AND paid_at IS NULL;
  IF FOUND THEN
    v_result:=pending.decision->>'result'; v_at_cents:=(pending.decision->>'cents')::integer;
    v_elapsed_ms:=(pending.decision->>'elapsed_ms')::bigint; p_by:=pending.decision->>'by';
  ELSIF r.auto_cashout_cents IS NOT NULL AND$n$),
 ('fn_crash_decide(public.crash_rounds,boolean,text,integer)',$o$  UPDATE public.diamond_game_pools SET reserved_chips=reserved_chips-r.reserved_chips
   WHERE host_id=r.host_id AND game='crash';$o$,$n$  BEGIN
  UPDATE public.diamond_game_pools SET reserved_chips=reserved_chips-r.reserved_chips
   WHERE host_id=r.host_id AND game='crash';$n$),
 ('fn_crash_decide(public.crash_rounds,boolean,text,integer)',$o$  RETURN r;
END$o$,$n$  RETURN r;
  EXCEPTION WHEN SQLSTATE 'PMW01' THEN
    GET STACKED DIAGNOSTICS reason=PG_EXCEPTION_DETAIL;
    PERFORM public.fn_midway_prize_wait(reason,jsonb_build_object('result',v_result,'cents',v_at_cents,'elapsed_ms',v_elapsed_ms,'by',p_by));
    RETURN p_round;
  END;
END$n$),
 ('fn_crash_round_result(public.crash_rounds)',$o$SELECT public.fn_wheel_award_receipt(r.commit_id)||$o$,$n$SELECT coalesce((SELECT jsonb_build_object('ok',false,'pending_prize',true,'paid',false,'prize_chips',q.amount,
    'error',format('Your %s Chip Prize Is Reserved. Open Diamond Spins And Choose Claim Prize To Retry Payment.',q.amount))
    FROM public.wheel_midway_prize_claims q WHERE q.prize_key='crash-prize:'||r.id AND q.paid_at IS NULL),
    public.fn_wheel_award_receipt(r.commit_id)||$n$),
 ('fn_crash_round_result(public.crash_rounds)',$o$'created_at', r.created_at);$o$,$n$'created_at', r.created_at));$n$),
 ('fn_wheel_plinko_release(uuid,uuid,boolean)',$o$ target integer; total integer; amount numeric; result jsonb;$o$,$n$ target integer; total integer; amount numeric; result jsonb; pending public.wheel_midway_prize_claims; reason text;$n$),
 ('fn_wheel_plinko_release(uuid,uuid,boolean)',$o$ total:=jsonb_array_length(s.sealed_result->'drops');$o$,$n$ SELECT * INTO pending FROM public.wheel_midway_prize_claims
   WHERE prize_key IN ('plinko-drop:'||p_award_id||':'||(s.released_count+1),
     'plinko-drop:'||p_award_id||':'||jsonb_array_length(s.sealed_result->'drops')) AND paid_at IS NULL;
 IF FOUND THEN
   IF p_all IS DISTINCT FROM (pending.decision->>'all')::boolean THEN
     RETURN jsonb_build_object('ok',false,'pending_prize',true,'paid',false,'prize_chips',pending.amount,
       'error',CASE WHEN (pending.decision->>'all')::boolean THEN 'Choose Drop All To Retry Your Reserved Prize'
                    ELSE 'Choose Drop One To Retry Your Reserved Prize' END);
   END IF;
 END IF;
 total:=jsonb_array_length(s.sealed_result->'drops');$n$),
 ('fn_wheel_plinko_release(uuid,uuid,boolean)',$o$  PERFORM public.fn_diamond_game_pay_chips('plinko_prize'$o$,$n$  BEGIN
  PERFORM public.fn_diamond_game_pay_chips('plinko_prize'$n$),
 ('fn_wheel_plinko_release(uuid,uuid,boolean)',$o$  UPDATE public.diamond_game_pools SET chips_paid=chips_paid+amount,reserved_chips=reserved_chips-amount,updated_at=now() WHERE host_id=a.host_id AND game='plinko';$o$,$n$  EXCEPTION WHEN SQLSTATE 'PMW01' THEN
    GET STACKED DIAGNOSTICS reason=PG_EXCEPTION_DETAIL;
    RETURN public.fn_midway_prize_wait(reason,jsonb_build_object('request',p_request_id,'all',p_all));
  END;
  UPDATE public.diamond_game_pools SET chips_paid=chips_paid+amount,reserved_chips=reserved_chips-amount,updated_at=now() WHERE host_id=a.host_id AND game='plinko';$n$),
 ('fn_wheel_plinko_release(uuid,uuid,boolean)',$o$ INSERT INTO public.wheel_plinko_releases VALUES(p_award_id,p_request_id,p_all,result);$o$,$n$ INSERT INTO public.wheel_plinko_releases VALUES(p_award_id,p_request_id,p_all,result);
 IF pending.prize_key IS NOT NULL AND (pending.decision->>'request')::uuid<>p_request_id THEN
   INSERT INTO public.wheel_plinko_releases VALUES(p_award_id,(pending.decision->>'request')::uuid,p_all,result);
 END IF;$n$)
 ) edits(signature,before_text,after_text)
 LOOP
  target:=('public.'||edit.signature)::regprocedure;
  definition:=coalesce(definitions->>edit.signature,pg_get_functiondef(target));
  IF (length(definition)-length(replace(definition,edit.before_text,'')))/length(edit.before_text)<>1 THEN
    RAISE EXCEPTION 'Unexpected % eligibility or result source at %',target,edit.before_text;
  END IF;
  definitions:=definitions||jsonb_build_object(edit.signature,replace(definition,edit.before_text,edit.after_text));
 END LOOP;
 FOR definition IN SELECT value FROM jsonb_each_text(definitions) LOOP EXECUTE definition; END LOOP;
END $decisions$;

CREATE INDEX wheel_midway_pending_player ON public.wheel_midway_prize_claims(player_id,club_id,created_at) WHERE paid_at IS NULL;

CREATE FUNCTION public.fn_wheel_pending_chip_prizes(p_club_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',prize_key,'chips',amount::text) ORDER BY created_at,prize_key),'[]'::jsonb)
 FROM public.wheel_midway_prize_claims WHERE player_id=auth.uid() AND club_id=p_club_id AND paid_at IS NULL
$$;

DO $state$
DECLARE target regprocedure:='public.fn_wheel_state_v2(uuid,bigint)'::regprocedure; original text:=pg_get_functiondef(target);
 needle text:=' RETURN s||jsonb_build_object(''contract_version'',4,''payout_rules_version'',2';
BEGIN
 IF (length(original)-length(replace(original,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Unexpected wheel state'; END IF;
 EXECUTE replace(original,needle,' RETURN s||jsonb_build_object(''pending_chip_prizes'',public.fn_wheel_pending_chip_prizes(p_club_id))||jsonb_build_object(''contract_version'',4,''payout_rules_version'',2');
END $state$;

CREATE FUNCTION public.fn_wheel_claim_chip_prize(p_club_id uuid,p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $claim$
DECLARE q public.wheel_midway_prize_claims; target uuid; result jsonb; host constant uuid:='fade0000-0000-0000-0000-000000000001';
BEGIN
 SELECT * INTO q FROM public.wheel_midway_prize_claims WHERE prize_key=p_key AND player_id=auth.uid() AND club_id=p_club_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Prize Could Not Be Found'); END IF;
 IF q.paid_at IS NULL THEN
   IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('ok',false,'error','The Platform Is In Its Maintenance Break'); END IF;
   target:=split_part(p_key,':',2)::uuid;
   CASE q.category
    WHEN 'crash_prize' THEN result:=public.fn_crash_settle(target,false);
    WHEN 'plinko_prize' THEN result:=public.fn_wheel_plinko_release(target,(q.decision->>'request')::uuid,(q.decision->>'all')::boolean);
    WHEN 'mines_prize','crossing_prize' THEN result:=public.fn_choice_act(target,q.decision->>'action',(q.decision->>'cell')::integer,(q.decision->>'step')::integer);
    WHEN 'wheel_prize' THEN
     PERFORM 1 FROM public.wheel_pools WHERE host_id=host FOR UPDATE;
     SELECT * INTO STRICT q FROM public.wheel_midway_prize_claims WHERE prize_key=p_key;
     IF q.paid_at IS NULL THEN
      BEGIN
       PERFORM public.fn_diamond_game_pay_chips(q.category,host,'union',q.club_id,q.player_id,q.amount,p_key,q.decision->>'note',q.decision->'meta');
       UPDATE public.wheel_pools SET chips_paid=chips_paid+CASE WHEN (q.decision#>>'{meta,welcome}')::boolean THEN 0 ELSE q.amount END,
         welcome_chips_paid=welcome_chips_paid+CASE WHEN (q.decision#>>'{meta,welcome}')::boolean THEN q.amount ELSE 0 END WHERE host_id=host;
      EXCEPTION WHEN SQLSTATE 'PMW01' THEN NULL;
      END;
     END IF;
    ELSE RAISE EXCEPTION 'Unknown reserved chip prize';
   END CASE;
 END IF;
 SELECT * INTO STRICT q FROM public.wheel_midway_prize_claims WHERE prize_key=p_key;
 RETURN jsonb_build_object('ok',q.paid_at IS NOT NULL,'paid',q.paid_at IS NOT NULL,'chips',q.amount::text,
   'error',CASE WHEN q.paid_at IS NULL THEN coalesce(result->>'error','Your Prize Is Still Reserved. Try Again When Funding Is Available.') END);
END $claim$;
REVOKE ALL ON FUNCTION public.fn_wheel_pending_chip_prizes(uuid),public.fn_wheel_claim_chip_prize(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_wheel_pending_chip_prizes(uuid),public.fn_wheel_claim_chip_prize(uuid,text) TO authenticated,service_role;
COMMIT;
