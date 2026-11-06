-- 20261105225426_guaranteed_free_buy_ticket_funding_is_part_of_h
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 22:54:26 UTC.
--
-- A GUARANTEED FREE BUY'S TICKET FUNDING IS PART OF H, NEVER ON TOP OF IT
--
-- Owner rule (Dan, 2026-11-05): "Ticket sponsorship is included in the
-- guarantee-funding requirement. Do not add a separate one-chip-per-ticket
-- transfer on top of H." Example: G 500, 250 first-entry tickets, 160 chips
-- from player wallets -> total promo funding 340, final regular pool 500.
--
-- What production does: every Midway Free Buy first entry is funded one promo
-- chip at registration (fn_ca_midway_free_buy_promo_head). With the gross
-- close-out (20261105222502) a guaranteed event's posted promo counts as
-- house funding P, and the close-out funds only max(0, H - P). But when the
-- field's own payments plus the tickets pass the guarantee (C + V > G), the
-- promo already posted is MORE than H, and nothing returned the difference:
-- the house/promo funding exceeded max(0, G - C).
--
-- What this changes: fn_apply_prize_guarantee, the single finalization
-- authority, now returns that excess to the Midway promo wallet before the
-- pool is finalized, in the same subtransaction as the finalization (a refused
-- finalization rolls the return back). Excess = least(posted - H, net promo
-- posted, prize pool), only for a guaranteed regular or all-in-or-fold Midway
-- Free Buy (the formats whose promo chip lands in the prize pool; PKO and
-- mystery Free Buys carry no guarantee), only while the pool is not yet
-- finalized, keyed once per event ('tourney:<id>:guarantee_promo_excess_return').
-- A non-guaranteed Free Buy keeps its voucher funding V untouched.
--
-- @live-proof: to_regprocedure('public.fn_ca_return_excess_guarantee_promo_locked(uuid)') IS NOT NULL AND position('fn_ca_return_excess_guarantee_promo_locked' in pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure))>0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

INSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES
 ('fn_ca_return_excess_guarantee_promo_locked', 'approved',
  'Private: at guarantee finalization returns promo funding above H = max(0, G - C) of a guaranteed regular/aiof Midway Free Buy to the Midway promo wallet; one keyed reversal leg, escrow and pool in the finalization subtransaction.')
ON CONFLICT (proname) DO NOTHING;

CREATE FUNCTION public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION public.fn_ca_return_excess_guarantee_promo_locked(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE
 v_def text;
 c_anchor constant text := E'    v_return := public.fn_ca_return_excess_start_overlay_locked(p_tournament_id);\n';
BEGIN
 v_def := pg_get_functiondef('public.fn_apply_prize_guarantee(uuid,text)'::regprocedure);
 IF (length(v_def) - length(replace(v_def, c_anchor, ''))) / length(c_anchor) <> 1 THEN
  RAISE EXCEPTION 'fn_apply_prize_guarantee anchor not found exactly once; refusing to patch';
 END IF;
 EXECUTE replace(v_def, c_anchor, c_anchor
  || E'    /* TICKET FUNDING IS PART OF H (2026-11-05): promo above max(0, G - C)\n'
  || E'       goes back to the promo wallet before the pool finalizes. */\n'
  || E'    PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);\n');
END
$patch$;

COMMIT;
