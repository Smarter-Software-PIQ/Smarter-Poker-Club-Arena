-- Minimal fixture: the tables these functions read, exact production copies of
-- the functions this change touches or depends on, and stubs for the rest.
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
DROP SCHEMA IF EXISTS smarter_private CASCADE; CREATE SCHEMA smarter_private;
DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY, club_id uuid, union_id uuid, name text, status text, started_at timestamptz,
  tournament_type text DEFAULT 'MTT', variant text, satellite_target_id uuid, free_buy boolean DEFAULT true,
  buy_in_amount numeric DEFAULT 0, buy_in_fee numeric DEFAULT 0,
  is_bounty boolean DEFAULT false, is_pko boolean DEFAULT false, is_mystery_bounty boolean DEFAULT false,
  all_in_or_fold boolean DEFAULT false, bounty_amount numeric DEFAULT 0,
  guaranteed_prize numeric DEFAULT 0, prize_pool numeric DEFAULT 0, bounty_pool numeric DEFAULT 0,
  prize_pool_finalized boolean DEFAULT false);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, status text, current_bounty numeric);
CREATE TABLE public.chip_ledger(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), performed_by uuid, from_type text, from_entity_id uuid, from_label text,
  to_type text, to_entity_id uuid, to_label text, amount numeric, category text, club_id uuid, tournament_id uuid,
  idempotency_key text UNIQUE, description text, metadata jsonb, status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.union_wallets(union_id uuid PRIMARY KEY, promo_wallet numeric, updated_at timestamptz);
CREATE TABLE public.ca_money_rpc_registry(proname text PRIMARY KEY, status text, notes text);
CREATE TABLE public.tournament_escrow(tournament_id uuid PRIMARY KEY, enforced boolean DEFAULT true,
  gross_in numeric DEFAULT 0, bounty_in numeric DEFAULT 0, prize_balance numeric DEFAULT 0, bounty_balance numeric DEFAULT 0);
CREATE TABLE smarter_private.free_buy_ticket_days(user_id uuid, gaming_day date, allotment smallint DEFAULT 5, used smallint DEFAULT 0, granted_at timestamptz, PRIMARY KEY(user_id, gaming_day));
CREATE TABLE smarter_private.free_buy_ticket_redemptions(registration_id uuid PRIMARY KEY, user_id uuid, tournament_id uuid, gaming_day date, redeemed_at timestamptz DEFAULT now(), returned_at timestamptz);

-- Stub: the maintained escrow; prize_balance = gross - bounty. The real one also shadows the ledger.
CREATE FUNCTION public.fn_ca_escrow_apply(p_tournament_id uuid, p_label text, p_gross_in numeric DEFAULT 0, p_bounty_in numeric DEFAULT 0)
RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.tournament_escrow(tournament_id) VALUES (p_tournament_id) ON CONFLICT DO NOTHING;
 UPDATE public.tournament_escrow SET gross_in=gross_in+p_gross_in, bounty_in=bounty_in+p_bounty_in,
   prize_balance=prize_balance+p_gross_in-p_bounty_in, bounty_balance=bounty_balance+p_bounty_in
  WHERE tournament_id=p_tournament_id;
$$;
CREATE FUNCTION public.fn_ca_lock_settlement_lane_for_tournament(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_ca_return_excess_start_overlay_locked(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
-- Stub core: funds max(G, pool) - pool from the union bank as one overlay leg, finalizes.
CREATE FUNCTION public.fn_ca_apply_prize_guarantee_core(p_tournament_id uuid, p_source text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t public.tournaments%ROWTYPE; v_ov numeric;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 v_ov := round(greatest(t.guaranteed_prize, t.prize_pool) - t.prize_pool, 2);
 IF v_ov > 0 THEN
   INSERT INTO public.chip_ledger(from_type,from_entity_id,to_type,to_entity_id,amount,category,tournament_id,idempotency_key)
   VALUES ('union_bank','fade0000-0000-0000-0000-000000000001','prize_liability',p_tournament_id,v_ov,'overlay',p_tournament_id,'tourney:'||p_tournament_id||':guarantee_overlay');
   PERFORM public.fn_ca_escrow_apply(p_tournament_id,'overlay',v_ov,0);
 END IF;
 UPDATE public.tournaments SET prize_pool=prize_pool+v_ov, prize_pool_finalized=true WHERE id=p_tournament_id;
 RETURN jsonb_build_object('ok',true,'prize_pool',t.prize_pool+v_ov,'overlay',v_ov,'bank_type','union',
   'bank_entity_id','fade0000-0000-0000-0000-000000000001',
   'escrow_after',(SELECT prize_balance FROM public.tournament_escrow WHERE tournament_id=p_tournament_id));
END $$;
