-- 20261105205500_midway_free_buy_registered_events_reshape_to_their_slot
--
-- A MIDWAY FREE BUY THAT WAS BUILT IN THE WRONG FORMAT CAN BE PUT BACK ON ITS
-- SLOT BEFORE IT STARTS, WITHOUT SUSPENDING ANY GUARD (incident 2026-11-05).
--
-- Root cause of the bad build:
--  1. 20261102154336 made zz_freerolls_are_free_buy force EVERY Midway Free Buy
--     to the 1-chip promo PKO shape on insert, and fn_ca_convert_midway_free_buy
--     hard-codes that PKO shape for any legacy event it converts. The board build
--     at 2026-11-04 06:54 UTC therefore created the Nov 5 Afternoon (74ba8130,
--     schedule: All-In-Or-Fold 500 GTD) and Prime Time (1d115ff4, schedule:
--     Mystery Bounty) Free Buys as PKOs: every promo chip to the bounty pool,
--     0 to the prize pool.
--  2. Horses began registering into them at 08:29 UTC. The rotation migration
--     20261105035220, which reshapes those slots, was installed after that
--     (PR #9515, merged ~10:00 UTC), and it skips any event that already has
--     an entry. From then on the two contract guards (zz_freerolls_are_free_buy
--     and zzzz_freeze_registered_tournament_settlement_contract) froze the
--     wrong shape, and the only exception they allow
--     (app.midway_free_buy_conversion) converts INTO PKO, never out of it.
--  3. A bounty-only event has an empty prize ladder, so fn_settle_tournament_places
--     raises "derived an empty ladder" at the winner (930eee14 is stuck on it).
--
-- What this changes:
--  a. fn_ca_midway_free_buy_slot_format(uuid) reads the slot format from the
--     event's schedule (config.midwayFreeBuyFormat).
--  b. fn_ca_convert_midway_free_buy refuses to build the PKO shape for a slot
--     whose schedule is not PKO (the hard-coded build is what produced 1.).
--  c. fn_ca_reshape_midway_free_buy(p_tournament_id, p_expected_format) is a
--     private, owner-run money owner: for an unstarted, horse-only Midway Free
--     Buy that is still in the promo PKO shape and holds nothing but promo
--     heads, it reverses each 1-chip PKO head and re-books the same chip in the
--     slot's split (aiof/regular: all prize; mystery: 0.50/0.50), with
--     idempotent keys, the same journal shape as fn_ca_midway_free_buy_promo_head
--     (balance move + leg) so the promo fund nets to zero, moves the escrow
--     bounty side to the prize side, sets the flags to the slot shape and
--     verifies escrow against fn_ca_tournament_escrow_chips before commit.
--     A PKO slot is refused: no standard prize/bounty split is defined for the
--     promo PKO (owner decision pending).
--  d. The two guards accept exactly that transition, only inside the reshape
--     function's own context (app.midway_free_buy_reshape = event id), never
--     for a browser and never for any other change.
-- No wallet balance moves in this migration; executing (c) is an owner action.
-- @live-proof: to_regprocedure('public.fn_ca_reshape_midway_free_buy(uuid,text)') IS NOT NULL AND position('app.midway_free_buy_reshape' IN pg_get_functiondef('public.fn_freerolls_are_free_buy()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef('public.fn_ca_convert_midway_free_buy(uuid)'::regprocedure))) IS DISTINCT FROM 'a6a8734e26e051866564b87174dc3cfd' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_convert_midway_free_buy'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef('public.fn_freerolls_are_free_buy()'::regprocedure))) IS DISTINCT FROM 'cac558b3a9155d6412c35accaea4d160' THEN RAISE EXCEPTION 'Inspected definition changed: fn_freerolls_are_free_buy'; END IF; END $$;
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef('public.fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)'::regprocedure))) IS DISTINCT FROM 'fe1bc41ef98b6b31c40131e70f30f4d5' THEN RAISE EXCEPTION 'Inspected definition changed: fn_ca_midway_free_buy_conversion_transition'; END IF; END $$;
DO $$ BEGIN IF to_regprocedure('public.fn_ca_reshape_midway_free_buy(uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'reshape owner already exists'; END IF; END $$;

INSERT INTO public.ca_money_rpc_registry(proname,status,notes) VALUES
 ('fn_ca_reshape_midway_free_buy','approved','Private owner-run reshape of an unstarted horse-only promo PKO Midway Free Buy to its scheduled slot format; reverses and re-books each promo head with idempotent keys, promo fund nets zero, escrow verified before commit.')
ON CONFLICT(proname) DO NOTHING;

-- a. The slot format the schedule names.
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_slot_format(p_tournament_id uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
 SELECT CASE s.config->>'midwayFreeBuyFormat'
   WHEN 'promo-pko-v1' THEN 'pko'
   WHEN 'midway-free-buy-aiof-v1' THEN 'aiof'
   WHEN 'midway-free-buy-mystery-v1' THEN 'mystery'
   WHEN 'midway-free-buy-regular-v1' THEN 'regular' END
 FROM public.tournaments t JOIN public.tournament_schedules s ON s.id=t.schedule_id
 WHERE t.id=p_tournament_id
   AND (t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
        OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
   AND t.free_buy;
$f$;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_slot_format(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_midway_free_buy_slot_format(uuid) TO service_role;

-- d. The reshape transition, shared by both guards.
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_reshape_transition(o jsonb, n jsonb)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $f$
 SELECT coalesce(
   current_setting('app.midway_free_buy_reshape',true)=o->>'id'
   AND current_setting('role',true) IN ('none','service_role')
   AND o->>'status' IN ('ANNOUNCED','REGISTERING') AND n->>'status'=o->>'status'
   AND o->>'started_at' IS NULL AND NOT coalesce((o->>'prize_pool_finalized')::boolean,false)
   AND (o->>'union_id'='fade0000-0000-0000-0000-000000000001'
        OR o->>'club_id'='fade0000-0000-0000-0000-000000000001')
   AND (o->>'free_buy')::boolean AND upper(o->>'tournament_type')='MTT'
   AND (o->>'buy_in_amount')::numeric=0 AND (o->>'buy_in_fee')::numeric=0
   AND (o->>'is_pko')::boolean AND (o->>'bounty_amount')::numeric=1
   AND n->>'satellite_target_id' IS NULL
   AND (n->>'buy_in_amount')::numeric=0 AND (n->>'buy_in_fee')::numeric=0
   AND CASE public.fn_ca_midway_free_buy_slot_format((o->>'id')::uuid)
     WHEN 'aiof' THEN NOT (n->>'is_bounty')::boolean AND NOT (n->>'is_pko')::boolean
       AND NOT coalesce((n->>'is_mystery_bounty')::boolean,false) AND (n->>'all_in_or_fold')::boolean
       AND (n->>'bounty_amount')::numeric=0 AND (n->>'guaranteed_prize')::numeric=500
     WHEN 'regular' THEN NOT (n->>'is_bounty')::boolean AND NOT (n->>'is_pko')::boolean
       AND NOT coalesce((n->>'is_mystery_bounty')::boolean,false) AND NOT (n->>'all_in_or_fold')::boolean
       AND (n->>'bounty_amount')::numeric=0 AND (n->>'guaranteed_prize')::numeric=250
     WHEN 'mystery' THEN (n->>'is_mystery_bounty')::boolean AND NOT (n->>'is_pko')::boolean
       AND (n->>'bounty_amount')::numeric=0.50 AND (n->>'guaranteed_prize')::numeric=0
       AND n->>'variant'='mystery_bounty'
     ELSE false END
   AND (o-ARRAY['is_pko','is_bounty','is_mystery_bounty','bounty_amount','guaranteed_prize','all_in_or_fold',
      'variant','is_rebuy','is_reentry','rebuy_cost','add_on_available','addon_from_start','addon_cost',
      'addon_chips','addon_levels','short_description','updated_at','prize_pool','bounty_pool',
      'mystery_bounty_min','mystery_bounty_max','mystery_bounty_profile','mystery_bounty_activation',
      'mystery_bounty_activation_value','mystery_bounty_pool_percent','mystery_bounty_regular_pool_percent',
      'mystery_bounty_top_percent','mystery_bounty_stage'])
     = (n-ARRAY['is_pko','is_bounty','is_mystery_bounty','bounty_amount','guaranteed_prize','all_in_or_fold',
      'variant','is_rebuy','is_reentry','rebuy_cost','add_on_available','addon_from_start','addon_cost',
      'addon_chips','addon_levels','short_description','updated_at','prize_pool','bounty_pool',
      'mystery_bounty_min','mystery_bounty_max','mystery_bounty_profile','mystery_bounty_activation',
      'mystery_bounty_activation_value','mystery_bounty_pool_percent','mystery_bounty_regular_pool_percent',
      'mystery_bounty_top_percent','mystery_bounty_stage']),false);
$f$;
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_reshape_transition(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text; o text; n text;
BEGIN
 -- The settlement-contract freeze consults the conversion transition; the
 -- reshape transition joins it there.
 d:=pg_get_functiondef('public.fn_ca_midway_free_buy_conversion_transition(jsonb,jsonb)'::regprocedure);
 o:=$o$ SELECT coalesce(
   current_setting('app.midway_free_buy_conversion',true)=o->>'id'$o$;
 n:=$n$ SELECT public.fn_ca_midway_free_buy_reshape_transition(o,n) OR coalesce(
   current_setting('app.midway_free_buy_conversion',true)=o->>'id'$n$;
 IF (length(d)-length(replace(d,o,'')))<>length(o) THEN RAISE EXCEPTION 'conversion_transition_patch_not_single'; END IF;
 EXECUTE replace(d,o,n);

 -- The Free Buy trigger keeps a registered event's shape except inside the
 -- reshape owner's own transaction.
 d:=pg_get_functiondef('public.fn_freerolls_are_free_buy()'::regprocedure);
 o:=$o$    IF TG_OP='UPDATE'
       AND EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=NEW.id) THEN
$o$;
 n:=$n$    IF TG_OP='UPDATE'
       AND EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=NEW.id) THEN
      -- 20261105205500: the owner-run reshape to the schedule's slot format.
      IF public.fn_ca_midway_free_buy_reshape_transition(to_jsonb(OLD),to_jsonb(NEW)) THEN
        RETURN NEW;
      END IF;
$n$;
 IF (length(d)-length(replace(d,o,'')))<>length(o) THEN RAISE EXCEPTION 'freerolls_patch_not_single'; END IF;
 EXECUTE replace(d,o,n);

 -- b. The legacy converter never builds a PKO into a non-PKO slot again.
 d:=pg_get_functiondef('public.fn_ca_convert_midway_free_buy(uuid)'::regprocedure);
 o:=$o$IF public.fn_ca_midway_free_buy_format(t.id) IS NOT NULL THEN RETURN 0; END IF;$o$;
 n:=$n$IF public.fn_ca_midway_free_buy_format(t.id) IS NOT NULL THEN RETURN 0; END IF;
 -- 20261105205500: only a PKO slot may be converted to the promo PKO shape.
 IF public.fn_ca_midway_free_buy_slot_format(t.id) IS DISTINCT FROM 'pko' THEN
   RAISE EXCEPTION 'Free Buy conversion builds the promo PKO only for a PKO slot (slot %)',
     coalesce(public.fn_ca_midway_free_buy_slot_format(t.id),'unknown');
 END IF;$n$;
 IF (length(d)-length(replace(d,o,'')))<>length(o) THEN RAISE EXCEPTION 'converter_patch_not_single'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;

-- c. The owner-run reshape.
CREATE OR REPLACE FUNCTION public.fn_ca_reshape_midway_free_buy(p_tournament_id uuid, p_expected_format text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
 v_fmt text; v_new_bounty numeric; v_new_prize numeric;
 t public.tournaments%ROWTYPE; e public.tournament_escrow%ROWTYPE;
 h record; n integer:=0; v_humans integer; v_regs integer; v_heads integer;
 v_promo_before numeric; v_promo_after numeric; v_prev_skip text; v_prev_ctx text;
 v_actor uuid:=COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid);
 k text; v_move numeric; chk record;
BEGIN
 v_fmt:=public.fn_ca_midway_free_buy_slot_format(p_tournament_id);
 IF v_fmt IS NULL OR v_fmt IS DISTINCT FROM p_expected_format THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: slot format % does not match expected %', v_fmt, p_expected_format; END IF;
 IF v_fmt NOT IN ('aiof','regular','mystery') THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: slot % has no defined prize/bounty split for the promo entry', v_fmt; END IF;
 v_new_bounty:=CASE v_fmt WHEN 'mystery' THEN 0.50 ELSE 0 END;
 v_new_prize:=round(1-v_new_bounty,2);

 PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
 SELECT * INTO STRICT t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 PERFORM 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id ORDER BY id FOR UPDATE;
 IF public.fn_ca_midway_free_buy_format(p_tournament_id) IS DISTINCT FROM 'pko'
    OR upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING') OR t.started_at IS NOT NULL
    OR coalesce(t.prize_pool_finalized,false) OR coalesce(t.prize_pool,0)<>0 OR coalesce(t.total_rake,0)<>0 THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: % is not an unstarted unfunded promo PKO', p_tournament_id; END IF;
 SELECT count(*) FILTER (WHERE coalesce(p.is_horse,false) IS NOT TRUE), count(*) INTO v_humans, v_regs
   FROM public.tournament_players tp LEFT JOIN public.profiles p ON p.id=tp.user_id
  WHERE tp.tournament_id=p_tournament_id;
 IF v_humans<>0 THEN RAISE EXCEPTION 'RESHAPE_REFUSED: % real player registrations', v_humans; END IF;
 IF EXISTS (SELECT 1 FROM public.tournament_players WHERE tournament_id=p_tournament_id
   AND (status IS DISTINCT FROM 'registered' OR coalesce(rebuys,0)<>0 OR coalesce(add_on,false)
        OR current_bounty IS DISTINCT FROM 1 OR coalesce(bounty_winnings,0)<>0 OR table_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: a played, re-bought or non-standard registration exists'; END IF;
 IF EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.tournament_id=p_tournament_id
             AND coalesce(l.metadata->>'kind','')<>'midway_free_buy_promo_head') THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: money other than promo heads'; END IF;
 SELECT count(*) INTO v_heads FROM public.chip_ledger l
  WHERE l.tournament_id=p_tournament_id AND l.metadata->>'kind'='midway_free_buy_promo_head'
    AND l.category='promo_send' AND l.amount=1
    AND coalesce((l.metadata->>'bounty_part')::numeric,l.amount)=1;
 IF v_heads<>v_regs OR EXISTS (SELECT 1 FROM public.chip_ledger l WHERE l.tournament_id=p_tournament_id
      AND l.metadata->>'kind'='midway_free_buy_promo_head' AND l.category<>'promo_send') THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: heads % <> registrations % or a return exists', v_heads, v_regs; END IF;
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway Free Buy reshape prelock');
 SELECT * INTO STRICT e FROM public.tournament_escrow WHERE tournament_id=p_tournament_id FOR UPDATE;
 IF e.gross_in<>v_regs OR e.bounty_balance<>v_regs OR e.prize_balance<>0 OR e.fee_balance<>0 OR t.bounty_pool<>v_regs THEN
   RAISE EXCEPTION 'RESHAPE_REFUSED: escrow does not equal % promo heads', v_regs; END IF;

 SELECT promo_wallet INTO v_promo_before FROM public.union_wallets
  WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid FOR UPDATE;
 v_prev_skip:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 FOR h IN SELECT l.id AS funding_id, tp.id AS reg_id, tp.user_id FROM public.tournament_players tp
            JOIN public.chip_ledger l ON l.idempotency_key='tourney:'||p_tournament_id||':promo_head:'||tp.id
           WHERE tp.tournament_id=p_tournament_id ORDER BY tp.id LOOP
   k:='tourney:'||p_tournament_id||':promo_head:'||h.reg_id||':reshape:pko_to_'||v_fmt;
   UPDATE public.union_wallets SET promo_wallet=promo_wallet+1,updated_at=now()
    WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid;
   INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
     amount,category,club_id,tournament_id,idempotency_key,description,metadata)
   VALUES(v_actor,'prize_liability',p_tournament_id,'tournament_escrow.bounty_balance','union_wallet',
     'fade0000-0000-0000-0000-000000000001'::uuid,'union_wallets.promo_wallet',1,'reversal',t.club_id,p_tournament_id,
     k||':out','Free Buy Bounty Head Reclassified To Its Scheduled Format',
     jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',h.reg_id,'user_id',h.user_id,
       'return',false,'reshape',true,'funding_ledger_id',h.funding_id,'format','pko','to_format',v_fmt,
       'bounty_part',1,'prize_part',0));
   UPDATE public.union_wallets SET promo_wallet=promo_wallet-1,updated_at=now()
    WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid AND promo_wallet>=1;
   INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
     amount,category,club_id,tournament_id,idempotency_key,description,metadata)
   VALUES(v_actor,'union_wallet','fade0000-0000-0000-0000-000000000001'::uuid,'union_wallets.promo_wallet',
     'prize_liability',p_tournament_id,
     CASE WHEN v_fmt='mystery' THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
     1,'promo_send',t.club_id,p_tournament_id,k||':in','Midway Promo Funds Free Buy Initial Entry',
     jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',h.reg_id,'user_id',h.user_id,
       'return',false,'reshape',true,'reshape_of',h.funding_id,'format',v_fmt,
       'bounty_part',v_new_bounty,'prize_part',v_new_prize));
   n:=n+1;
 END LOOP;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(v_prev_skip,''),true);
 IF n<>v_regs THEN RAISE EXCEPTION 'RESHAPE_REFUSED: reshaped % of % heads', n, v_regs; END IF;
 v_move:=round(n*(1-v_new_bounty),2);
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway Free Buy reshape pko to '||v_fmt,p_bounty_in=>-v_move);

 v_prev_ctx:=current_setting('app.midway_free_buy_reshape',true);
 PERFORM set_config('app.midway_free_buy_reshape',p_tournament_id::text,true);
 IF v_fmt IN ('aiof','regular') THEN
   UPDATE public.tournaments SET is_bounty=false,is_pko=false,is_mystery_bounty=false,bounty_amount=0,
     guaranteed_prize=CASE v_fmt WHEN 'aiof' THEN 500 ELSE 250 END,all_in_or_fold=(v_fmt='aiof'),
     is_rebuy=true,is_reentry=true,rebuy_cost=1,
     add_on_available=(v_fmt='regular'),addon_from_start=(v_fmt='regular'),
     addon_cost=CASE WHEN v_fmt='regular' THEN 1 END,addon_chips=CASE WHEN v_fmt='regular' THEN starting_chips END,
     addon_levels=CASE WHEN v_fmt='regular' THEN 1 END,
     bounty_pool=0,prize_pool=n,
     short_description=CASE v_fmt
       WHEN 'aiof' THEN 'All-In Or Fold. Free Entry. Midway Promo Funds Your Entry. 500 Chip Guarantee. 1-Chip Rebuys For The First Hour. No Add-Ons Or Rake.'
       ELSE 'Free Entry. Midway Promo Funds Your Entry. 250 Chip Guarantee. 1-Chip Rebuys And Add-Ons For The First Hour. No Rake.' END
   WHERE id=p_tournament_id;
 ELSE
   UPDATE public.tournaments SET is_bounty=true,is_pko=false,is_mystery_bounty=true,variant='mystery_bounty',
     bounty_amount=0.50,guaranteed_prize=0,all_in_or_fold=false,
     mystery_bounty_min=0.25,mystery_bounty_max=5.00,mystery_bounty_profile='classic',
     mystery_bounty_activation='at_the_money',mystery_bounty_activation_value=NULL,
     mystery_bounty_pool_percent=100,mystery_bounty_regular_pool_percent=0,mystery_bounty_top_percent=20,
     mystery_bounty_stage='pending',is_rebuy=true,is_reentry=true,rebuy_cost=1,
     add_on_available=true,addon_from_start=true,addon_cost=1,addon_chips=starting_chips,addon_levels=1,
     bounty_pool=round(n*v_new_bounty,2),prize_pool=round(n*v_new_prize,2),
     short_description='Mystery Bounty. Free Entry. Midway Promo Funds Your 1-Chip Entry: Half To The Mystery Bounty Pool, Half To The Prize Pool. 1-Chip Rebuys And Add-Ons For The First Hour Split The Same Way. No Rake.'
   WHERE id=p_tournament_id;
 END IF;
 PERFORM set_config('app.midway_free_buy_reshape',coalesce(v_prev_ctx,''),true);
 UPDATE public.tournament_players SET current_bounty=v_new_bounty WHERE tournament_id=p_tournament_id;

 SELECT * INTO STRICT t FROM public.tournaments WHERE id=p_tournament_id;
 SELECT * INTO STRICT e FROM public.tournament_escrow WHERE tournament_id=p_tournament_id;
 SELECT * INTO chk FROM public.fn_ca_tournament_escrow_chips(p_tournament_id);
 SELECT promo_wallet INTO v_promo_after FROM public.union_wallets
  WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid;
 IF public.fn_ca_midway_free_buy_format(p_tournament_id) IS DISTINCT FROM v_fmt
    OR v_promo_after<>v_promo_before
    OR e.gross_in<>n OR e.prize_balance+e.bounty_balance<>n
    OR e.prize_balance<>t.prize_pool OR e.bounty_balance<>t.bounty_pool
    OR chk.prize_balance<>e.prize_balance OR chk.bounty_balance<>e.bounty_balance OR chk.fee_balance<>e.fee_balance THEN
   RAISE EXCEPTION 'RESHAPE_VERIFY: format % promo %->% escrow % % derived % %',
     public.fn_ca_midway_free_buy_format(p_tournament_id), v_promo_before, v_promo_after,
     e.prize_balance, e.bounty_balance, chk.prize_balance, chk.bounty_balance;
 END IF;
 RETURN jsonb_build_object('ok',true,'tournament_id',p_tournament_id,'format',v_fmt,'heads',n,
   'prize_pool',t.prize_pool,'bounty_pool',t.bounty_pool,'promo_wallet',v_promo_after);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_reshape_midway_free_buy(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
