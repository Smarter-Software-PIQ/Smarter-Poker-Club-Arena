-- Reserved by scripts/new-migration.mjs against main and remote branches.
-- The registration selector judged the minimum balance of every membership.
-- A broke unrelated club therefore hid a Horse whose actual paying wallet
-- was funded (live Micah Nakamura: 5.63 unrelated / 9727.40 paying wallet).
-- Resolve exactly as the ordinary entry wrapper does, without charging,
-- reserving, steering or modifying any wallet. The purchase retains its locks
-- and all ordinary solvency, membership, capacity and transaction safeguards.
-- @live-proof: public.fn_ca_horse_mtt_entry_purchase_window_open('mtt-v2','REGISTERING',now()+interval '24 hours',now(),0::numeric,0::numeric,false) AND NOT public.fn_ca_horse_mtt_entry_purchase_window_open('mtt-v2','REGISTERING',now()+interval '24 hours 0.001 seconds',now(),0::numeric,0::numeric,false) AND NOT public.fn_ca_horse_mtt_entry_purchase_window_open('mtt-v2','REGISTERING',now()+interval '2 hours',now(),10::numeric,1::numeric,false)
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_ca_horse_tournament_bankrolls(
  p_tournament_id uuid, p_horse_ids uuid[])
RETURNS TABLE(user_id uuid, club_id uuid, chip_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH candidates AS MATERIALIZED (
    SELECT p.id
      FROM public.profiles p
     WHERE p.id = ANY(p_horse_ids)
       AND p.is_horse IS TRUE AND p.horse_status = 'available'
       AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id)
  ), paying AS MATERIALIZED (
    SELECT h.id,
           COALESCE(public.fn_ca_entry_paying_club(h.id, p_tournament_id),
                    public.fn_tournament_club_for_user(h.id, p_tournament_id, NULL)) AS club_id
      FROM candidates h
  )
  SELECT h.id, h.club_id, m.chip_balance
    FROM paying h
    LEFT JOIN public.club_members m
      ON m.user_id = h.id AND m.club_id = h.club_id
     AND m.status IN ('active', 'approved')
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_horse_tournament_bankrolls(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_tournament_bankrolls(uuid, uuid[]) TO service_role;
-- The overlay selector priced a PKO entry at its gross buy-in, including
-- bounty value that never funds the regular guarantee (45 vs20 in Funday).
-- Patch only the qualified installed body; preserve its unlimited ABI,
-- scope/window/status predicates, ownership, ACL and function settings.
DO $overlay$
DECLARE
  v_source text;
  v_definition text;
  v_after text;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid)
    INTO v_source, v_definition
    FROM pg_proc p WHERE p.oid='public.fn_overlay_at_risk(uuid)'::regprocedure;
  IF md5(v_source) IS DISTINCT FROM 'ff7ba48340ea8b9800b8f4685a447196' THEN
    RAISE EXCEPTION 'horse_overlay_prize_share_preimage_changed';
  END IF;
  v_after := replace(v_definition,
    't.buy_in_amount, t.guaranteed_prize,',
    'funding.prize, t.guaranteed_prize,');
  v_after := replace(v_after,
    'nullif(t.buy_in_amount, 0)', 'nullif(funding.prize, 0)');
  v_after := replace(v_after,
    '  from tournaments t CROSS JOIN admission a',
    '  from tournaments t CROSS JOIN admission a
  CROSS JOIN LATERAL public.fn_tournament_entry_split(
    t.buy_in_amount, t.buy_in_fee, t.bounty_amount,
    COALESCE(t.is_bounty,false) OR COALESCE(t.is_pko,false)
      OR COALESCE(t.is_mystery_bounty,false)) funding');
  v_after := replace(v_after,
    'and t.buy_in_amount > 0', 'and funding.prize > 0');
  IF v_after = v_definition
     OR position('nullif(t.buy_in_amount, 0)' IN v_after)>0
     OR position('CROSS JOIN LATERAL public.fn_tournament_entry_split(' IN v_after)=0
     OR position('funding.prize, t.guaranteed_prize,' IN v_after)=0 THEN
    RAISE EXCEPTION 'horse_overlay_prize_share_anchor_changed';
  END IF;
  EXECUTE v_after;
END;
$overlay$;

-- The owner subsequently extended free preregistration from six hours to a
-- full day. The ordinary horse door already invokes this price-aware helper;
-- changing only its qualified free branch retains every money/capacity gate.
DO $daywindow$
DECLARE
  v_source text;
  v_definition text;
  v_after text;
  v_before_metadata jsonb;
  v_after_metadata jsonb;
BEGIN
  SELECT p.prosrc, pg_get_functiondef(p.oid),
         jsonb_build_object('owner',p.proowner,'acl',p.proacl,'secdef',p.prosecdef,
           'config',p.proconfig,'volatile',p.provolatile,'parallel',p.proparallel,
           'strict',p.proisstrict,'leakproof',p.proleakproof)
    INTO v_source,v_definition,v_before_metadata
    FROM pg_proc p WHERE p.oid=
      'public.fn_ca_horse_mtt_entry_purchase_window_open(text,text,timestamptz,timestamptz,numeric,numeric,boolean)'::regprocedure;
  IF md5(v_source) IS DISTINCT FROM '87046aa899ac14f34dc1076f6f7a3497' THEN
    RAISE EXCEPTION 'horse_free_day_window_preimage_changed';
  END IF;
  v_after := replace(v_definition, 'interval ''6 hours''', 'interval ''24 hours''');
  IF v_after=v_definition OR position('interval ''6 hours''' IN v_after)>0 THEN
    RAISE EXCEPTION 'horse_free_day_window_anchor_changed';
  END IF;
  EXECUTE v_after;
  SELECT jsonb_build_object('owner',p.proowner,'acl',p.proacl,'secdef',p.prosecdef,
           'config',p.proconfig,'volatile',p.provolatile,'parallel',p.proparallel,
           'strict',p.proisstrict,'leakproof',p.proleakproof)
    INTO v_after_metadata FROM pg_proc p WHERE p.oid=
      'public.fn_ca_horse_mtt_entry_purchase_window_open(text,text,timestamptz,timestamptz,numeric,numeric,boolean)'::regprocedure;
  IF v_after_metadata IS DISTINCT FROM v_before_metadata THEN
    RAISE EXCEPTION 'horse_free_day_window_authority_changed';
  END IF;
END;
$daywindow$;
COMMIT;
