-- Reserved by scripts/new-migration.mjs against main and remote branches.
-- The registration selector judged the minimum balance of every membership.
-- A broke unrelated club therefore hid a Horse whose actual paying wallet
-- was funded (live Micah Nakamura: 5.63 unrelated / 9727.40 paying wallet).
-- Resolve exactly as the ordinary entry wrapper does, without charging,
-- reserving, steering or modifying any wallet. The purchase retains its locks
-- and all ordinary solvency, membership, capacity and transaction safeguards.
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
COMMIT;
