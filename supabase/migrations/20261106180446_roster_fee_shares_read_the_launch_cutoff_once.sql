-- Roster HTTP 500s timed out in the fee helper on two production browser runs.
-- Its cash-share scan re-read the same club launch cutoff for every attribution.
-- Read that boundary once; preserve missing/nonfinite receipt rules and all cents.
-- Live read-only comparison: 274.7ms -> 43.4ms for 546 rows, no production writes.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.ca_club_member_fee_totals(uuid,date,date,uuid)'::regprocedure)) IS DISTINCT FROM '5adf122ff09c68b80cebcaabb35eaa31'
 OR md5(pg_get_functiondef('public.fn_ca_launch_accounting_accepts(uuid,timestamptz)'::regprocedure)) IS DISTINCT FROM '0f902b31908c9b6634635c1fab7363c4' THEN
  RAISE EXCEPTION 'ROSTER_FEE_CUTOFF_PREIMAGE_CHANGED';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.ca_club_member_fee_totals(p_club_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, cash_fees numeric, tournament_fees numeric, total_fees numeric)
 LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH launch AS MATERIALIZED (
    SELECT public.fn_ca_launch_accounting_cutoff('club',p_club_id) AS cutoff
  ), bounds AS (
    SELECT greatest(coalesce(p_from, public.fn_ca_fee_counting_start()),
                    public.fn_ca_fee_counting_start()) AS from_day
  ), share AS (
    -- A standing rake share, from the rake_attributions rows the daily rollup
    -- counts (same day key, same filters), rounded per rule and day.
    SELECT r.club_id, r.from_user, r.to_user,
           (ra.created_at AT TIME ZONE 'UTC')::date AS day,
           round(sum(round(ra.rake_amount * 100)) * r.share_bps / 10000.0)::bigint AS cents
      FROM smarter_private.player_rake_share_rules r
      JOIN public.rake_attributions ra
        ON ra.club_id = r.club_id AND ra.player_id = r.from_user
       AND ra.created_at >= r.effective_from
       AND (r.effective_until IS NULL OR ra.created_at < r.effective_until)
     CROSS JOIN launch l
     WHERE r.club_id = p_club_id
       AND ra.rake_amount > 0
       AND (l.cutoff IS NULL OR EXISTS (
         SELECT 1 FROM public.rake_records rr WHERE rr.id=ra.rake_record_id
           AND rr.created_at IS NOT NULL AND isfinite(rr.created_at)
           AND rr.created_at >= l.cutoff))
     GROUP BY r.rule_key, r.club_id, r.from_user, r.to_user, r.share_bps, 4
  ), cash AS (
    SELECT d.user_id AS uid, sum(d.rake_cents)::numeric / 100 AS fees
      FROM (SELECT club_id,user_id,day,rake_cents FROM public.ca_club_rake_daily_user
       UNION ALL
       SELECT club_id,user_id,effective_on,-amount_cents
         FROM smarter_private.player_fee_redemptions
       UNION ALL
       SELECT club_id,from_user,day,-cents FROM share
       UNION ALL
       SELECT club_id,to_user,day,cents FROM share) d, bounds b
     WHERE d.club_id = p_club_id
       AND (p_user_id IS NULL OR d.user_id = p_user_id)
       AND d.day >= b.from_day
       AND (p_to IS NULL OR d.day <= p_to)
     GROUP BY d.user_id
  ), tournament_share AS (
    -- All earned rake includes tournament entry/rebuy/add-on fee receipts.
    -- Round per rule and UTC day; identical cents leave and arrive.
    SELECT r.club_id,r.from_user,r.to_user,
           (s.charged_at AT TIME ZONE 'UTC')::date AS day,
           round(sum(s.rake_credit)*100*r.share_bps/10000.0)/100 AS fees
      FROM smarter_private.player_rake_share_rules r
      JOIN public.accounting_tournament_fee_sources s
        ON s.club_id=r.club_id AND s.player_id=r.from_user
       AND s.charged_at >= (r.tournament_effective_from::timestamp AT TIME ZONE 'UTC')
       AND (r.effective_until IS NULL OR s.charged_at<r.effective_until)
      CROSS JOIN bounds b
     WHERE r.club_id=p_club_id AND r.tournament_effective_from IS NOT NULL
       AND (p_user_id IS NULL OR p_user_id IN(r.from_user,r.to_user))
       AND (s.charged_at AT TIME ZONE 'UTC')::date>=b.from_day AND (p_to IS NULL OR (s.charged_at AT TIME ZONE 'UTC')::date<=p_to)
     GROUP BY r.rule_key,r.club_id,r.from_user,r.to_user,r.share_bps,4
  ), mtt AS (
    SELECT t.user_id AS uid,sum(t.fees) AS fees
      FROM (
        SELECT club_id,user_id,fees FROM public.ca_club_member_tournament_fee_daily,bounds b WHERE club_id=p_club_id AND day>=b.from_day AND (p_to IS NULL OR day<=p_to)
        UNION ALL
        SELECT club_id,from_user,-fees FROM tournament_share
        UNION ALL
        SELECT club_id,to_user,fees FROM tournament_share
      ) t
     WHERE t.club_id=p_club_id AND (p_user_id IS NULL OR t.user_id=p_user_id)
     GROUP BY t.user_id
  )
  SELECT coalesce(c.uid, m.uid),
         round(coalesce(c.fees, 0), 2),
         round(coalesce(m.fees, 0), 2),
         round(coalesce(c.fees, 0) + coalesce(m.fees, 0), 2)
    FROM cash c
    FULL JOIN mtt m ON m.uid = c.uid;
$function$;
COMMIT;
