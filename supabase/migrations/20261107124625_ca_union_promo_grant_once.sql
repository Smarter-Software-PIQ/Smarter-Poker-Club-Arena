-- 20261107124625_ca_union_promo_grant_once.sql
--
-- RECORDING OF A MIGRATION APPLIED DIRECTLY (CLAUDE.md section 2, rule 11).
-- Production holds this table and function from 2026-11-07 12:46 UTC, applied
-- through the Supabase MCP while chasing the duplicate 25-chip union promo.
-- Rule 11 requires the byte-exact recording on main as the next step; this
-- file is that recording.
--
-- IT IS SUPERSEDED BY THE VERY NEXT MIGRATION, AND ON PURPOSE.
-- This was written before the live sender was identified. It is a SECOND,
-- PARALLEL campaign guard, and the platform already had the right one:
-- fn_sp_signup_welcome_back_run (20261104145956) keys the 25-chip
-- welcome-back promo on sp_signup_welcome_back_awards, one row per player for
-- life, with an op_id derived from the player id. Two guards that must agree
-- about the same campaign is the failure in CLAUDE.md 10.84 - three lists had
-- to agree and nothing checked them - so 20261107130207 drops this one and
-- repairs the real guard instead. Recorded here because production held it;
-- do not reintroduce it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ca_union_promo_campaign_claims (
  campaign_key text   NOT NULL,
  union_id     uuid   NOT NULL,
  user_id      uuid   NOT NULL,
  club_id      uuid,
  amount       numeric,
  ledger_id    uuid,
  chip_tx_id   uuid,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_key, union_id, user_id)
);

COMMENT ON TABLE public.ca_union_promo_campaign_claims IS
  'One row per (campaign, union, member) that has been paid a campaign promo. The primary key is the guard: the second sender to arrive claims nothing and pays nothing. Holds no balance.';

ALTER TABLE public.ca_union_promo_campaign_claims ENABLE ROW LEVEL SECURITY;

-- The copy applied to production at 12:46 UTC carried RLS but no explicit
-- grants, which the explicit-table-access guard requires. They are written
-- here so this recording passes the same gate every migration does. Nothing
-- re-runs: production already holds version 20261107124625, so the applier
-- answers ALREADY-APPLIED, and the next migration drops the table outright.
REVOKE ALL ON public.ca_union_promo_campaign_claims FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_union_promo_campaign_claims TO service_role;

INSERT INTO public.ca_money_rpc_registry (proname, status, notes)
VALUES ('fn_ca_union_promo_grant_once', 'approved',
        'Campaign-idempotent wrapper over fn_promo_disburse union->player. Takes the (campaign_key, union_id, user_id) claim FIRST; a member already claimed for that campaign is skipped and no chips move. Moves money only via fn_promo_disburse, so that door''s own gating and journaling apply unchanged; a failed disbursement raises, rolling the claim back so a legitimate retry still works. Gated to the union owner or a service caller.')
ON CONFLICT (proname) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;

CREATE OR REPLACE FUNCTION public.fn_ca_union_promo_grant_once(
  p_union_id     uuid,
  p_user_id      uuid,
  p_amount       numeric,
  p_campaign_key text,
  p_club_id      uuid DEFAULT NULL,
  p_note         text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_actor    uuid := auth.uid();
  v_service  boolean := public.fn_caller_is_engine();
  v_key      text := btrim(COALESCE(p_campaign_key, ''));
  v_op       uuid := gen_random_uuid();
  v_claimed  boolean := false;
  v_res      jsonb;
  v_ledger   uuid;
  v_prior    record;
BEGIN
  IF v_actor IS NULL AND NOT v_service THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not Authenticated');
  END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A Campaign Key Is Required');
  END IF;
  IF p_union_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Union And Member Are Required');
  END IF;
  IF NOT v_service AND NOT EXISTS (
       SELECT 1 FROM unions u WHERE u.id = p_union_id AND u.owner_id = v_actor) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Only The Union Owner May Disburse Union Promo');
  END IF;

  -- THE CLAIM COMES FIRST. Whichever sender arrives second claims nothing.
  INSERT INTO public.ca_union_promo_campaign_claims
    (campaign_key, union_id, user_id, club_id, amount)
  VALUES (v_key, p_union_id, p_user_id, p_club_id, round(p_amount, 2))
  ON CONFLICT (campaign_key, union_id, user_id) DO NOTHING;
  v_claimed := FOUND;

  IF NOT v_claimed THEN
    SELECT granted_at, amount, ledger_id INTO v_prior
      FROM public.ca_union_promo_campaign_claims
     WHERE campaign_key = v_key AND union_id = p_union_id AND user_id = p_user_id;
    RETURN jsonb_build_object('success', true, 'skipped', true,
      'reason', 'already_granted_this_campaign', 'campaign_key', v_key,
      'user_id', p_user_id, 'granted_at', v_prior.granted_at,
      'amount', v_prior.amount, 'ledger_id', v_prior.ledger_id);
  END IF;

  v_res := public.fn_promo_disburse('union', p_union_id, 'player', p_user_id,
             p_amount,
             COALESCE(NULLIF(btrim(p_note), ''), 'Union Promo (' || v_key || ')'),
             p_club_id, v_op);

  -- A REFUSED DISBURSEMENT MUST NOT BURN THE CLAIM. Raising rolls the claim
  -- back with it, so the member can still be paid once the cause is fixed.
  IF COALESCE((v_res ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'union promo campaign % could not pay member %: %',
      v_key, p_user_id, COALESCE(v_res ->> 'error', 'unknown error');
  END IF;

  SELECT id INTO v_ledger FROM public.chip_ledger
   WHERE idempotency_key = 'promo_disburse:' || v_op::text
     AND to_entity_id = p_user_id
   LIMIT 1;

  UPDATE public.ca_union_promo_campaign_claims
     SET ledger_id  = v_ledger,
         chip_tx_id = NULLIF(v_res ->> 'transaction_id', '')::uuid,
         amount     = round(p_amount, 2),
         club_id    = COALESCE(p_club_id, NULLIF(v_res ->> 'club_id', '')::uuid)
   WHERE campaign_key = v_key AND union_id = p_union_id AND user_id = p_user_id;

  RETURN v_res || jsonb_build_object('claimed', true, 'skipped', false,
    'campaign_key', v_key, 'ledger_id', v_ledger);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_union_promo_grant_once(uuid, uuid, numeric, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_union_promo_grant_once(uuid, uuid, numeric, text, uuid, text) TO service_role;

-- THE 128 ALREADY PAID ARE CLAIMED NOW, not when the app switches over, so the
-- live drip cannot pay any of them a second time the moment it starts calling
-- this door. The duplicate legs reversed on 2026-11-07 are deliberately NOT
-- claimed twice: one claim per member is the whole point.
INSERT INTO public.ca_union_promo_campaign_claims
  (campaign_key, union_id, user_id, club_id, amount, ledger_id, granted_at)
SELECT 'union_welcome_25', g.union_id, g.user_id, g.club_id, 25, g.id, g.created_at
FROM (
  SELECT to_entity_id AS user_id, union_id, club_id, id, created_at,
         row_number() OVER (PARTITION BY to_entity_id ORDER BY created_at) rn
    FROM public.chip_ledger
   WHERE amount = 25 AND category = 'promo'
     AND description = 'Union Promo Disbursement'
     AND from_type = 'union_wallet' AND to_type = 'player_wallet'
) g
WHERE g.rn = 1
ON CONFLICT (campaign_key, union_id, user_id) DO NOTHING;

COMMIT;
