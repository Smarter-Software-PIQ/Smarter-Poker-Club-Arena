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
        -- The enclosing settlement rolls back, including the entry if this was an immediate spin.
        -- Preserve the unpaid obligation in the database event log across that rollback.
        RAISE LOG 'MIDWAY_WHEEL_UNFUNDED prize_key=% category=% club=% amount=% platform_required=% available=% uncovered=%',
          p_key,p_category,p_club,p_amount,platform_part,issuer_room,platform_part-issuer_room;
        RAISE EXCEPTION 'Midway Prize Funding Unavailable' USING ERRCODE='P0403',
          DETAIL=jsonb_build_object('paid',false,'prize_key',p_key,'prize_chips',p_amount,
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
COMMIT;
