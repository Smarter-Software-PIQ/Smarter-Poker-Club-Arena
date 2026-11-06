-- Exact production copies (pg_get_functiondef, 2026-11-06 ~20:00Z).
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_format(p_tournament_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE
   WHEN t.is_pko AND NOT coalesce(t.is_mystery_bounty,false)
        AND t.bounty_amount=1 AND t.guaranteed_prize=0 THEN 'pko'
   WHEN coalesce(t.is_mystery_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND t.bounty_amount=0.50 THEN 'mystery'
   WHEN NOT coalesce(t.is_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND NOT coalesce(t.is_mystery_bounty,false)
        AND coalesce(t.all_in_or_fold,false) THEN 'aiof'
   WHEN NOT coalesce(t.is_bounty,false) AND NOT coalesce(t.is_pko,false)
        AND NOT coalesce(t.is_mystery_bounty,false)
        AND NOT coalesce(t.all_in_or_fold,false) THEN 'regular'
   END
 FROM public.tournaments t WHERE t.id=p_tournament_id
  AND (t.union_id='fade0000-0000-0000-0000-000000000001'::uuid
       OR t.club_id='fade0000-0000-0000-0000-000000000001'::uuid)
  AND t.free_buy
  AND upper(t.tournament_type)='MTT' AND t.buy_in_amount=0 AND t.buy_in_fee=0
  AND t.satellite_target_id IS NULL AND lower(coalesce(t.variant,''))<>'satellite';
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 WITH t AS (
  SELECT x.id, round(greatest(coalesce(x.guaranteed_prize, 0), 0), 2) AS g
    FROM public.tournaments x WHERE x.id = p_tournament_id
 ), l AS (
  SELECT c.category, c.from_type, c.to_type, c.from_entity_id, c.to_entity_id, c.amount
    FROM public.chip_ledger c
   WHERE (c.to_entity_id = p_tournament_id OR c.from_entity_id = p_tournament_id)
     AND coalesce(c.status, 'posted') = 'posted'
 ), s AS (
  SELECT
   coalesce(sum(l.amount) FILTER (WHERE l.to_entity_id = p_tournament_id AND l.to_type = 'prize_liability' AND (
      (l.from_type = 'player_wallet' AND l.category IN ('tournament_buyin', 'rebuy', 'addon'))
      OR (l.from_type = 'prize_liability' AND l.category = 'tournament_buyin' AND l.from_entity_id IS DISTINCT FROM p_tournament_id)
      OR (l.from_type = 'escrow' AND l.category = 'ticket_redeem'))), 0) AS paid_in,
   coalesce(sum(l.amount) FILTER (WHERE l.from_entity_id = p_tournament_id AND l.from_type = 'prize_liability'
      AND l.to_type = 'player_wallet' AND l.category IN ('refund', 'reversal')), 0) AS paid_back,
   coalesce(sum(l.amount) FILTER (WHERE l.to_entity_id = p_tournament_id AND l.to_type = 'prize_liability'
      AND l.category IN ('overlay', 'promo_send') AND l.from_type IN ('union_bank', 'union_wallet', 'club_treasury')), 0) AS house_in,
   coalesce(sum(l.amount) FILTER (WHERE l.from_entity_id = p_tournament_id AND l.from_type = 'prize_liability'
      AND l.category = 'reversal' AND l.to_type IN ('union_bank', 'union_wallet', 'club_treasury')), 0) AS house_out
  FROM l
 ), v AS (
  SELECT t.g, round(greatest(0, s.paid_in - s.paid_back), 2) AS c, round(s.house_in - s.house_out, 2) AS p
    FROM t, s
 )
 SELECT jsonb_build_object(
  'guarantee', v.g,
  'gross_coverage', v.c,
  'house_required', greatest(0, v.g - v.c),
  'house_posted', v.p,
  'house_due', greatest(0, greatest(0, v.g - v.c) - v.p),
  'house_over_required', greatest(0, v.p - greatest(0, v.g - v.c)))
 FROM v;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 t public.tournaments%ROWTYPE;
 v_format text; v_funding jsonb; v_promo numeric := 0; v_excess numeric; v_union uuid;
 k text; n integer; v_prev text;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
 IF NOT FOUND OR coalesce(t.prize_pool_finalized, false) OR coalesce(t.guaranteed_prize, 0) <= 0 THEN RETURN 0; END IF;
 v_format := public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL OR v_format NOT IN ('regular', 'aiof') THEN RETURN 0; END IF;
 k := 'tourney:' || p_tournament_id::text || ':guarantee_promo_excess_return';
 IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = k) THEN RETURN 0; END IF;
 v_funding := public.fn_ca_guarantee_funding(p_tournament_id);
 SELECT coalesce(sum(CASE WHEN l.category = 'promo_send' THEN l.amount ELSE -l.amount END), 0),
        (array_agg(DISTINCT CASE WHEN l.category = 'promo_send' THEN l.from_entity_id END)
          FILTER (WHERE l.category = 'promo_send'))[1]
   INTO v_promo, v_union
   FROM public.chip_ledger l
  WHERE (l.category = 'promo_send' AND l.to_type = 'prize_liability' AND l.to_entity_id = p_tournament_id
         AND l.from_type = 'union_wallet')
     OR (l.category = 'reversal' AND l.from_type = 'prize_liability' AND l.from_entity_id = p_tournament_id
         AND l.to_type = 'union_wallet' AND l.to_label = 'union_wallets.promo_wallet');
 v_excess := round(least((v_funding->>'house_over_required')::numeric, v_promo, coalesce(t.prize_pool, 0)), 2);
 IF v_excess IS NULL OR v_excess <= 0 OR v_union IS NULL THEN RETURN 0; END IF;

 PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'Guarantee promo excess prelock');
 v_prev := current_setting('app.ledger_autoskip_union_wallets', true);
 PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
 UPDATE public.union_wallets SET promo_wallet = promo_wallet + v_excess, updated_at = now()
  WHERE union_id = v_union;
 GET DIAGNOSTICS n = ROW_COUNT;
 PERFORM set_config('app.ledger_autoskip_union_wallets', coalesce(v_prev, ''), true);
 IF n <> 1 THEN RAISE EXCEPTION 'Guarantee promo excess has no promo wallet to return to'; END IF;
 INSERT INTO public.chip_ledger (
   performed_by, from_type, from_entity_id, from_label, to_type, to_entity_id, to_label,
   amount, category, club_id, tournament_id, idempotency_key, description, metadata)
 VALUES (
   COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
   'prize_liability', p_tournament_id, 'tournament_escrow.prize_balance',
   'union_wallet', v_union, 'union_wallets.promo_wallet',
   v_excess, 'reversal', t.club_id, p_tournament_id, k,
   'Free Buy Ticket Funding Above The Guarantee Returned To Midway Promo Funds',
   jsonb_build_object('kind', 'guarantee_promo_excess_return', 'format', v_format,
     'guarantee', t.guaranteed_prize, 'funding', v_funding, 'promo_net_before', v_promo));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'Guarantee promo excess returned', p_gross_in => -v_excess);
 UPDATE public.tournaments SET prize_pool = prize_pool - v_excess
  WHERE id = p_tournament_id AND prize_pool >= v_excess;
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 1 THEN RAISE EXCEPTION 'Guarantee promo excess exceeds the prize pool'; END IF;
 RETURN v_excess;
END $function$;

CREATE OR REPLACE FUNCTION smarter_private.free_buy_ticket_restore(p_registration_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'smarter_private'
AS $function$
DECLARE v_user uuid; v_day date;
BEGIN
 UPDATE smarter_private.free_buy_ticket_redemptions r SET returned_at = clock_timestamp()
  WHERE r.registration_id = p_registration_id AND r.returned_at IS NULL
 RETURNING r.user_id, r.gaming_day INTO v_user, v_day;
 IF v_user IS NULL THEN RETURN; END IF;
 UPDATE smarter_private.free_buy_ticket_days d SET used = d.used - 1
  WHERE d.user_id = v_user AND d.gaming_day = v_day AND d.used > 0;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_apply_prize_guarantee(p_tournament_id uuid, p_source text DEFAULT 'engine'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_overlay numeric;
  v_ledger_count integer;
  v_escrow public.tournament_escrow%ROWTYPE;
  v_return jsonb := NULL;
  v_refusal jsonb;
BEGIN
  /* THE LANE BEFORE THE ROW (2026-10-25). G shared, then T(id) exclusive,
     then the tournaments row: the order of every other writer of this
     event. Finalizing the pool here fires the deferred payer, which asks
     for T(id) exclusive at COMMIT; holding the row without the lane made
     that a deadlock with any rebuy, add-on or hand that holds T(id) and
     waits for the row. Re-entrant for callers that already hold it. */
  IF p_tournament_id IS NOT NULL THEN
    PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id);
  END IF;
  /* A GUARANTEE IS A FLOOR (2026-10-01). The start-time overlay part that
     money collected since has made unnecessary goes back to its bank before
     the pool is finalized, so the final pool is max(guarantee, collected).
     One subtransaction with the finalization: a refused finalization rolls
     the return back too, and the caller sees the refusal unchanged. */
  BEGIN
    v_return := public.fn_ca_return_excess_start_overlay_locked(p_tournament_id);
    /* TICKET FUNDING IS PART OF H (2026-11-05): promo above max(0, G - C)
       goes back to the promo wallet before the pool finalizes. */
    PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);
    v_result:=public.fn_ca_apply_prize_guarantee_core(
      p_tournament_id,p_source);
    IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
      v_refusal := v_result;
      RAISE EXCEPTION USING ERRCODE='P0405',
        MESSAGE='guarantee finalization refused; the excess return is rolled back with it';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0405' THEN
    RETURN v_refusal;
  END;
  v_overlay:=COALESCE((v_result->>'overlay')::numeric,0);
  IF v_overlay::text IN ('NaN','Infinity','-Infinity')
     OR v_overlay<0 OR v_overlay IS DISTINCT FROM round(v_overlay,2) THEN
    RAISE EXCEPTION 'guarantee core returned invalid overlay %',v_overlay
      USING ERRCODE='P0404';
  END IF;
  IF v_overlay>0 THEN
    SELECT count(*) INTO v_ledger_count
      FROM public.chip_ledger l
     WHERE l.idempotency_key=
             'tourney:'||p_tournament_id::text||':guarantee_overlay'
       AND l.tournament_id=p_tournament_id
       AND l.to_type='prize_liability'
       AND l.to_entity_id=p_tournament_id
       AND l.category='overlay'
       AND l.amount=v_overlay
       AND l.from_entity_id=(v_result->>'bank_entity_id')::uuid
       AND l.from_type=CASE WHEN v_result->>'bank_type'='union'
                            THEN 'union_bank' ELSE 'club_treasury' END;
    SELECT * INTO v_escrow
      FROM public.tournament_escrow e
     WHERE e.tournament_id=p_tournament_id
     FOR UPDATE;
    IF v_ledger_count<>1 OR NOT FOUND
       OR COALESCE(v_escrow.enforced,false) IS NOT TRUE
       OR v_result->>'escrow_after' IS NULL
       OR v_escrow.prize_balance IS DISTINCT FROM
            (v_result->>'escrow_after')::numeric THEN
      RAISE EXCEPTION
        'guarantee overlay is not one exact journaled escrow credit'
        USING ERRCODE='P0404';
    END IF;
  END IF;
  RETURN v_result||jsonb_build_object('overlay_journaled',true)
    ||CASE WHEN v_return IS NOT NULL
           THEN jsonb_build_object('excess_overlay_returned',v_return)
           ELSE '{}'::jsonb END;
END;
$function$;

-- Synthetic registration doors carrying the two exact production split lines
-- (production holds each exactly once in each door; measured 2026-11-06).
CREATE FUNCTION public.fn_register_for_tournament_before_atomic_capacity_20260907(p_tournament_id uuid, p_x boolean)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_split record; v_mfb text;
BEGIN
  SELECT 0::numeric AS charge, 0::numeric AS rake, 0::numeric AS bounty, 0::numeric AS prize INTO v_split;
  v_mfb:=public.fn_ca_midway_free_buy_format(p_tournament_id);
  IF v_mfb='pko' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;
  ELSIF v_mfb='mystery' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0.50;
  ELSIF v_mfb IN ('regular','aiof') THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=1;
  END IF;
  RETURN jsonb_build_object('prize',v_split.prize,'bounty',v_split.bounty);
END $f$;
CREATE FUNCTION public.fn_register_horse_for_tournament_before_maintenance_gate(p_tournament_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v_split record; v_mfb text;
BEGIN
  SELECT 0::numeric AS charge, 0::numeric AS rake, 0::numeric AS bounty, 0::numeric AS prize INTO v_split;
  v_mfb:=public.fn_ca_midway_free_buy_format(p_tournament_id);
  IF v_mfb='pko' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=1; v_split.prize:=0;
  ELSIF v_mfb='mystery' THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0.50; v_split.prize:=0.50;
  ELSIF v_mfb IN ('regular','aiof') THEN
    v_split.charge:=0; v_split.rake:=0; v_split.bounty:=0; v_split.prize:=1;
  END IF;
  RETURN jsonb_build_object('prize',v_split.prize,'bounty',v_split.bounty);
END $f$;
