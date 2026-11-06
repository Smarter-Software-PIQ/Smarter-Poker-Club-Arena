-- 20261106195136_a_free_buy_promo_chip_moves_at_cutoff_not_signup
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-06 19:51:36 UTC.
--
-- A FREE BUY'S PRIZE-POOL PROMO MONEY MOVES AT THE CUTOFF, NOT AT SIGN-UP
--
-- Owner rules (Dan, 2026-11-05 14:24 CT, "Free Buy tickets and guarantees"):
--   "Issuing a ticket moves no chips." "NO chips credited to the prize pool
--   until registration AND every rebuy/add-on window has closed." "During the
--   window: record grants, uses and registrations ... No early promo debit."
--   Guaranteed: P = max(G, C), U = max(0, G - C), tickets add nothing.
--   Non-guaranteed: V = 1 chip per valid first-entry ticket, P = V + C, U = V.
-- And 2026-11-06 13:45 CT: "GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF
-- THESE", the list that named this exact gap.
--
-- What production did: fn_ca_midway_free_buy_promo_head debited one promo chip
-- at every first entry and the registration doors booked it into the pools by
-- format (regular/aiof: 1 to the prize pool; mystery: 0.50 prize + 0.50 bounty;
-- pko: 1 to the bounty head). For a guaranteed event the finalization then had
-- to send the surplus back (fn_ca_return_excess_guarantee_promo_locked): the
-- 2026-11-06 Morning Free Buy f4793b0d posted 189 promo chips during
-- registration and returned all 189 at the cutoff. The total came out right,
-- but promo money sat in the pool during the window and a compensating write
-- undid it (CLAUDE.md 10.12).
--
-- What this changes (root fix, the line that produced the early debit):
--  1. The registration doors (human and horse) book NO prize-pool money for a
--     Free Buy entry. regular/aiof entries book nothing; a mystery entry books
--     only its 0.50 bounty half. A PKO entry is unchanged: its 1 chip IS the
--     player's bounty head, which a knockout during the window pays out, so it
--     must be funded when the head exists. That is bounty custody, not a
--     prize-pool credit, and section 2.3 requires correctly allocated bounty
--     money to stay where it is.
--  2. fn_ca_midway_free_buy_promo_head posts only that bounty part. With no
--     bounty part (regular/aiof) it posts nothing; the ticket redemption that
--     already ran records the use. Its return path (unregister, cancellation)
--     returns exactly what was posted, reads legacy one-chip legs from their own
--     metadata, and restores the ticket even when nothing was posted.
--  3. New fn_ca_fund_free_buy_at_cutoff_locked runs inside fn_apply_prize_guarantee,
--     the single finalization authority that the entry close (after
--     registration, rebuys and add-ons) and every early settlement call, in the
--     same subtransaction, before the excess return and the guarantee core:
--       guaranteed regular/aiof: U = house_due = max(0, max(0, G - C) - posted)
--         from the Midway promo wallet, so the core finds P = max(G, C) and
--         funds no union-bank overlay;
--       non-guaranteed regular/aiof (1 chip) and mystery (0.50 prize half):
--         the prize part for every first entry that holds a ticket or a legacy
--         funded head, less what legacy legs already posted;
--       pko: nothing (the heads are already funded at entry).
--     One keyed ledger leg per event (tourney:<id>:free_buy_cutoff_funding),
--     booked with kind midway_free_buy_promo_head so the escrow shadow
--     (fn_ca_tournament_escrow_chips) and fn_ca_guarantee_funding read it as
--     promo money with no bounty part. A retry finds the key and posts nothing.
--  4. Events registered before this migration keep their legacy legs. Their
--     posted promo counts as already funded, and the existing excess return
--     still sends back anything above U, so tonight's in-flight Free Buys
--     reconcile exactly once.
--
-- @live-proof: to_regprocedure('public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)') IS NOT NULL AND position('fn_ca_fund_free_buy_at_cutoff_locked' in pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure))>0 AND position('v_split.bounty:=0; v_split.prize:=0; -- cutoff' in pg_get_functiondef('public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'::regprocedure))>0 AND position('v_split.bounty:=0; v_split.prize:=0; -- cutoff' in pg_get_functiondef('public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'::regprocedure))>0 AND position('prize_part_at_cutoff' in pg_get_functiondef('public.fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

INSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES
 ('fn_ca_fund_free_buy_at_cutoff_locked', 'approved',
  'Private: at Free Buy finalization funds the prize-pool promo part once from the Midway promo wallet: U = max(0, G - C) less posted for guaranteed regular/aiof, the per-entry prize part for non-guaranteed formats; one keyed leg, escrow and pool in the finalization subtransaction.')
ON CONFLICT (proname) DO NOTHING;

-- 1. The registration doors book no prize-pool promo money.
DO $doors$
DECLARE
  v_sig text;
  v_def text;
  c_reg_old constant text := 'v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=1;';
  c_reg_new constant text := 'v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=0; -- cutoff';
  c_mys_old constant text := 'v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0.50;';
  c_mys_new constant text := 'v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0; -- cutoff';
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)',
    'public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)'] LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position(c_reg_new IN v_def) > 0 AND position(c_mys_new IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    IF (length(v_def) - length(replace(v_def, c_reg_old, ''))) / length(c_reg_old) <> 1
       OR (length(v_def) - length(replace(v_def, c_mys_old, ''))) / length(c_mys_old) <> 1 THEN
      RAISE EXCEPTION '%: expected exactly one regular and one mystery Free Buy split to amend', v_sig;
    END IF;
    v_def := replace(replace(v_def, c_reg_old, c_reg_new), c_mys_old, c_mys_new);
    EXECUTE v_def;
  END LOOP;
END
$doors$;

-- 2. The registration leg carries only the bounty part.
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head(p_tournament_id uuid, p_registration_id uuid, p_return boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 t public.tournaments%ROWTYPE;
 p public.tournament_players%ROWTYPE;
 funded public.chip_ledger%ROWTYPE;
 prior public.chip_ledger%ROWTYPE;
 k text;
 n integer;
 previous_skip text;
 v_format text;
 v_bounty numeric;
 v_prize numeric;
 v_amount numeric;
 v_deferred numeric;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 v_format:=public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL THEN RETURN 0; END IF;
 -- 2026-11-06: a Free Buy entry books only its bounty part at sign-up
 -- (pko: the 1-chip head; mystery: the 0.50 bounty half). The prize part
 -- (regular/aiof: 1, mystery: 0.50) is funded once at the cutoff by
 -- fn_ca_fund_free_buy_at_cutoff_locked. Legacy legs (amount 1) carry their
 -- own bounty_part/prize_part in metadata and are returned from it.
 v_bounty:=CASE v_format WHEN 'pko' THEN 1 WHEN 'mystery' THEN 0.50 ELSE 0 END;
 v_deferred:=round(1-v_bounty,2);
 SELECT * INTO p FROM public.tournament_players
  WHERE id=p_registration_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Promo bounty requires its exact registration'; END IF;
 k:='tourney:'||p_tournament_id||':promo_head:'||p_registration_id;
 SELECT * INTO funded FROM public.chip_ledger WHERE idempotency_key=k;
 IF funded.id IS NOT NULL THEN
   v_bounty:=coalesce((funded.metadata->>'bounty_part')::numeric, CASE WHEN v_format='pko' THEN 1 ELSE 0 END);
   v_prize:=coalesce((funded.metadata->>'prize_part')::numeric, round(funded.amount-v_bounty,2));
   IF funded.amount IS DISTINCT FROM round(v_bounty+v_prize,2) OR funded.amount<=0
     OR funded.category IS DISTINCT FROM 'promo_send'
     OR funded.from_type IS DISTINCT FROM 'union_wallet' OR funded.from_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
     OR funded.to_type IS DISTINCT FROM 'prize_liability' OR funded.to_entity_id IS DISTINCT FROM p_tournament_id
     OR funded.metadata->>'registration_id' IS DISTINCT FROM p_registration_id::text THEN
     RAISE EXCEPTION 'Promo bounty funding identity conflict';
   END IF;
 ELSE
   v_prize:=0;
 END IF;
 v_amount:=round(v_bounty+v_prize,2);
 IF p_return THEN
   IF funded.id IS NULL THEN
     -- Nothing was posted for this entry (regular/aiof since 2026-11-06):
     -- an unplayed entry still gets its ticket back.
     IF t.started_at IS NULL AND upper(coalesce(t.status,'')) IN ('ANNOUNCED','REGISTERING')
        AND coalesce(p.status,'') IN ('registered','playing') THEN
       PERFORM smarter_private.free_buy_ticket_restore(p_registration_id);
     END IF;
     RETURN 0;
   END IF;
   IF t.started_at IS NOT NULL OR upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING')
      OR coalesce(p.status,'') NOT IN ('registered','playing')
      OR (v_bounty>0 AND (p.current_bounty IS NULL OR p.current_bounty<v_bounty)) THEN
     RAISE EXCEPTION 'A played bounty cannot be returned as an unplayed promotion';
   END IF;
   k:=k||':return';
   SELECT * INTO prior FROM public.chip_ledger WHERE idempotency_key=k;
   IF prior.id IS NOT NULL THEN
     IF prior.amount IS DISTINCT FROM funded.amount OR prior.from_entity_id IS DISTINCT FROM p_tournament_id
        OR prior.category IS DISTINCT FROM 'reversal' OR prior.from_type IS DISTINCT FROM 'prize_liability'
        OR prior.to_type IS DISTINCT FROM 'union_wallet'
        OR prior.to_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
        OR prior.metadata->>'funding_ledger_id' IS DISTINCT FROM funded.id::text THEN
       RAISE EXCEPTION 'Promo bounty return identity conflict';
     END IF;
     RETURN 0;
   END IF;
 ELSE
   IF funded.id IS NOT NULL THEN RETURN 0; END IF;
   IF v_amount<=0 THEN
     -- regular/aiof: the entry is recorded by its ticket redemption; its
     -- promo money is decided at the cutoff, never here.
     RETURN 0;
   END IF;
   IF upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING','RUNNING','BREAK') OR p.current_bounty IS DISTINCT FROM v_bounty THEN
     RAISE EXCEPTION 'Promo funding requires a newly registered one-chip head';
   END IF;
 END IF;
 -- Initialize before the new ledger leg, then update once after it. This
 -- avoids counting a first-seen leg both through shadow initialization and delta.
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head prelock');
 previous_skip:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET
   promo_wallet=promo_wallet+CASE WHEN p_return THEN v_amount ELSE -v_amount END,updated_at=now()
 WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid
   AND (p_return OR promo_wallet>=v_amount);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this entry'; END IF;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(previous_skip,''),true);
 INSERT INTO public.chip_ledger(
   performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
   amount,category,club_id,tournament_id,idempotency_key,description,metadata)
 VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),CASE WHEN p_return THEN 'prize_liability' ELSE 'union_wallet' END,
   CASE WHEN p_return THEN p_tournament_id ELSE 'fade0000-0000-0000-0000-000000000001'::uuid END,
   CASE WHEN NOT p_return THEN 'union_wallets.promo_wallet' WHEN v_prize=0 THEN 'tournament_escrow.bounty_balance'
        WHEN v_bounty>0 THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   CASE WHEN p_return THEN 'union_wallet' ELSE 'prize_liability' END,
   CASE WHEN p_return THEN 'fade0000-0000-0000-0000-000000000001'::uuid ELSE p_tournament_id END,
   CASE WHEN p_return THEN 'union_wallets.promo_wallet' WHEN v_prize=0 THEN 'tournament_escrow.bounty_balance'
        WHEN v_bounty>0 THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   v_amount,CASE WHEN p_return THEN 'reversal' ELSE 'promo_send' END,t.club_id,p_tournament_id,k,
   CASE WHEN p_return AND v_format='pko' THEN 'Unplayed Free Buy Bounty Returned To Midway Promo Funds'
        WHEN p_return THEN 'Unplayed Free Buy Entry Returned To Midway Promo Funds'
        WHEN v_format='pko' THEN 'Midway Promo Funds Free Buy Initial Bounty'
        ELSE 'Midway Promo Funds Free Buy Initial Bounty Half' END,
   jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',p_registration_id,
     'user_id',p.user_id,'return',p_return,'funding_ledger_id',funded.id,
     'format',v_format,'bounty_part',v_bounty,'prize_part',v_prize,
     'prize_part_at_cutoff',CASE WHEN funded.id IS NULL THEN v_deferred ELSE 0 END));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head',
   p_gross_in=>CASE WHEN p_return THEN -v_amount ELSE v_amount END,
   p_bounty_in=>CASE WHEN p_return THEN -v_bounty ELSE v_bounty END);
 IF p_return THEN
   UPDATE public.tournaments SET bounty_pool=bounty_pool-v_bounty,prize_pool=prize_pool-v_prize
    WHERE id=p_tournament_id AND bounty_pool>=v_bounty AND prize_pool>=v_prize;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'Promo return exceeds funded bounty or prize pool'; END IF;
 END IF;
 IF p_return THEN PERFORM smarter_private.free_buy_ticket_restore(p_registration_id); END IF;
 RETURN 1;
END;
$function$;

-- Production already holds this function owner-only ({postgres=X/postgres});
-- restated so no browser role can ever execute the promo writer.
REVOKE ALL ON FUNCTION public.fn_ca_midway_free_buy_promo_head(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- 3. The cutoff funds the prize-pool part once.
CREATE FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked(p_tournament_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
 t public.tournaments%ROWTYPE;
 v_format text; v_funding jsonb; v_part numeric; v_entries integer;
 v_posted numeric; v_due numeric; k text; n integer; v_prev text;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
 IF NOT FOUND OR coalesce(t.prize_pool_finalized, false) THEN RETURN 0; END IF;
 v_format := public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL OR v_format = 'pko' THEN RETURN 0; END IF;
 k := 'tourney:' || p_tournament_id::text || ':free_buy_cutoff_funding';
 IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = k) THEN RETURN 0; END IF;

 IF v_format IN ('regular', 'aiof') AND coalesce(t.guaranteed_prize, 0) > 0 THEN
   -- U = max(0, G - C), less any promo a legacy entry already posted.
   v_funding := public.fn_ca_guarantee_funding(p_tournament_id);
   v_due := round(coalesce((v_funding->>'house_due')::numeric, 0), 2);
 ELSE
   -- V: the prize part of every valid first entry (a live ticket redemption,
   -- or a legacy funded head that was not returned), less legacy prize parts.
   v_part := CASE v_format WHEN 'mystery' THEN 0.50 ELSE 1 END;
   SELECT count(*) INTO v_entries
     FROM public.tournament_players tp
    WHERE tp.tournament_id = p_tournament_id
      AND (EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
                    WHERE r.registration_id = tp.id AND r.returned_at IS NULL)
        OR (EXISTS (SELECT 1 FROM public.chip_ledger l
                     WHERE l.idempotency_key = 'tourney:' || p_tournament_id::text || ':promo_head:' || tp.id::text)
            AND NOT EXISTS (SELECT 1 FROM public.chip_ledger l
                     WHERE l.idempotency_key = 'tourney:' || p_tournament_id::text || ':promo_head:' || tp.id::text || ':return')));
   SELECT coalesce(sum(CASE WHEN l.category = 'promo_send' THEN 1 ELSE -1 END
            * coalesce((l.metadata->>'prize_part')::numeric, 0)), 0)
     INTO v_posted
     FROM public.chip_ledger l
    WHERE l.tournament_id = p_tournament_id
      AND l.metadata->>'kind' = 'midway_free_buy_promo_head'
      AND l.category IN ('promo_send', 'reversal');
   v_due := round(greatest(0, v_part * v_entries - v_posted), 2);
 END IF;
 IF v_due IS NULL OR v_due <= 0 THEN RETURN 0; END IF;

 PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'Free Buy cutoff funding prelock');
 v_prev := current_setting('app.ledger_autoskip_union_wallets', true);
 PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
 UPDATE public.union_wallets SET promo_wallet = promo_wallet - v_due, updated_at = now()
  WHERE union_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND promo_wallet >= v_due;
 GET DIAGNOSTICS n = ROW_COUNT;
 PERFORM set_config('app.ledger_autoskip_union_wallets', coalesce(v_prev, ''), true);
 IF n <> 1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this Free Buy at its cutoff'; END IF;
 INSERT INTO public.chip_ledger (
   performed_by, from_type, from_entity_id, from_label, to_type, to_entity_id, to_label,
   amount, category, club_id, tournament_id, idempotency_key, description, metadata)
 VALUES (
   COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
   'union_wallet', 'fade0000-0000-0000-0000-000000000001'::uuid, 'union_wallets.promo_wallet',
   'prize_liability', p_tournament_id, 'tournament_escrow.prize_balance',
   v_due, 'promo_send', t.club_id, p_tournament_id, k,
   CASE WHEN coalesce(t.guaranteed_prize, 0) > 0
        THEN 'Midway Promo Funds Free Buy Guarantee At Cutoff'
        ELSE 'Midway Promo Funds Free Buy Entries At Cutoff' END,
   jsonb_build_object('kind', 'midway_free_buy_promo_head', 'stage', 'cutoff',
     'format', v_format, 'guarantee', coalesce(t.guaranteed_prize, 0),
     'entries', v_entries, 'funding', v_funding,
     'bounty_part', 0, 'prize_part', v_due));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'Free Buy cutoff funding',
   p_gross_in => v_due, p_bounty_in => 0);
 UPDATE public.tournaments SET prize_pool = coalesce(prize_pool, 0) + v_due
  WHERE id = p_tournament_id;
 RETURN v_due;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked(uuid) FROM PUBLIC, anon, authenticated;

-- 4. The single finalization authority funds the cutoff first.
DO $finalize$
DECLARE
  c_old constant text := '    PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);';
  c_new constant text := '    /* FREE BUY PROMO MOVES AT THE CUTOFF (2026-11-06): the prize-pool
       promo part is funded once here, after every entry window closed. */
    PERFORM public.fn_ca_fund_free_buy_at_cutoff_locked(p_tournament_id);
    PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);';
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure);
  IF position('fn_ca_fund_free_buy_at_cutoff_locked' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_apply_prize_guarantee: expected exactly one excess-return call to precede';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$finalize$;

COMMIT;
