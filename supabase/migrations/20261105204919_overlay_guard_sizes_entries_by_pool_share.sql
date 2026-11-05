-- 20261105204919_overlay_guard_sizes_entries_by_pool_share
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05. Carried over
-- unchanged from #9566 (on hold, to be closed) so the guarantee work ships as
-- one reviewed set. A Free Buy is untouched: its entries charge nothing, so it
-- is outside this selector (funding.charge > 0), and under the ticket rules
-- (20261105204917) a ticket entry adds nothing a guarantee could count.
--
-- THE OVERLAY GUARD COUNTS WHAT AN ENTRY ADDS TO THE POOLS, NOT WHAT IT COSTS.
--
-- Owner rule: horses register so that no event runs an overlay. A guarantee is
-- covered by prize pool + bounty pool (fn_ca_place_guarantee subtracts the
-- bounty pool from the guarantee), and rake is never part of either pool.
--
-- What was wrong: fn_overlay_at_risk sized entries_needed as
--   ceil(guarantee / charge)
-- where charge = buy-in + fee. Every paid event therefore aimed ~10% short of
-- its guarantee. Measured 2026-11-05 20:01 UTC:
--   Afternoon Deep Stack 500 GTD, 13.50+1.50: target 34 entries = 459 pooled
--   Five-Card Reload     250 GTD,  9.00+1.00: target 25 entries = 225 pooled
--   40 Chip 2.5K         2500 GTD, 36.00+4.00: target 63 entries = 2268 pooled
--   Union PKO Afternoon  750 GTD, 18.00+2.00: target 38 entries = 684 pooled
-- The guard stops at its target, so each of these ran an overlay of the fee
-- share of the guarantee.
--
-- What this changes: entries_needed = ceil(guarantee / (prize + bounty)) using
-- the same canonical split (fn_tournament_entry_split). Nothing else changes:
-- same columns, same window, same status filter, same Nov 3 attendance floor,
-- same capacity clamp, same ACL.
-- No money moves in this migration.
-- @live-proof: position('funding.prize + funding.bounty' IN pg_get_functiondef('public.fn_overlay_at_risk(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $$ BEGIN IF (SELECT md5(pg_get_functiondef('public.fn_overlay_at_risk(uuid)'::regprocedure))) IS DISTINCT FROM '19356474ce0b21749648cc45ba8dc3b1' THEN RAISE EXCEPTION 'Inspected definition changed: fn_overlay_at_risk'; END IF; END $$;

CREATE OR REPLACE FUNCTION public.fn_overlay_at_risk(p_union uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tournament_id uuid, name text, club_id uuid, status text, start_time timestamp with time zone, buy_in numeric, guaranteed_prize numeric, entries_needed integer, current_players integer, shortfall integer, max_players integer, minutes_to_start numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH admission AS MATERIALIZED (SELECT public.fn_ca_read_mtt_admission_contract() AS abi)
  select t.id, t.name, t.club_id, t.status, t.start_time,
         funding.charge, t.guaranteed_prize,
         coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(funding.prize + funding.bounty, 0))::int),
         coalesce(t.current_players, 0),
         greatest(
           least(
             coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(funding.prize + funding.bounty, 0))::int)
               - coalesce(t.current_players, 0),
             CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL
               ELSE coalesce(t.max_players, 0) - coalesce(t.current_players, 0) END
           ), 0)::int,
         CASE WHEN a.abi='unlimited-mtt-v2' AND t.format_contract IN ('mtt-v1','mtt-v2') THEN NULL ELSE coalesce(t.max_players, 0) END,
         round(extract(epoch from (t.start_time - now())) / 60.0, 1)
  from tournaments t CROSS JOIN admission a
  CROSS JOIN LATERAL public.fn_tournament_entry_split(
    t.buy_in_amount, t.buy_in_fee, t.bounty_amount,
    COALESCE(t.is_bounty,false) OR COALESCE(t.is_pko,false)
      OR COALESCE(t.is_mystery_bounty,false)) funding
  LEFT JOIN smarter_private.nov3_tournament_attendance att ON att.tournament_id=t.id
    AND (t.start_time AT TIME ZONE 'America/Chicago')::date=DATE '2026-11-03'
  left join clubs c on c.id = t.club_id
  where (t.guaranteed_prize > 0 OR att.attendance_floor > 0)
    and funding.charge > 0
    and (funding.prize + funding.bounty) > 0
    and upper(t.status) in ('SCHEDULED', 'REGISTERING', 'ANNOUNCED', 'RUNNING')
    and t.start_time > now() - interval '30 minutes'
    and t.start_time < now() + interval '3 hours'
    and (p_union is null or c.union_id = p_union or c.id = p_union)
    and coalesce(att.attendance_floor, ceil(t.guaranteed_prize / nullif(funding.prize + funding.bounty, 0))::int) > coalesce(t.current_players, 0)
  order by t.start_time asc;
$function$;

DO $$ BEGIN
  IF position('funding.prize + funding.bounty' IN pg_get_functiondef('public.fn_overlay_at_risk(uuid)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'fn_overlay_at_risk did not take the pool-share sizing';
  END IF;
END $$;
COMMIT;
