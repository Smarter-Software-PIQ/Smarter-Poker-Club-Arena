-- All earned rake includes tournaments for Mikey and WooWoo.
-- The cash-only readers left the full tournament fees (3.50 / 23.50 live)
-- on these accounts. Apply the declared 50/50 rules to all recorded entry,
-- rebuy and add-on fee receipts, in lifetime and Chicago calendar reads.
-- Reporting only: source receipts, cash rules/redemptions, wallets, prizes,
-- rakeback and commissions stay authoritative and unchanged.
-- Private-rule DDL only; no hot game or money table writer locks.
-- @live-proof: position('tournament_share' IN pg_get_functiondef('public.ca_club_member_fee_totals(uuid,date,date,uuid)'::regprocedure)) > 0 AND position('tournament_share' IN pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.ca_club_member_fee_totals(uuid,date,date,uuid)'::regprocedure)) IS DISTINCT FROM 'e233f2f7c3952d9c744cecb87ba82f59'
 OR md5(pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure)) IS DISTINCT FROM 'dc92f5467b9615778e62fd4ac52c00a1' THEN
  RAISE EXCEPTION 'Tournament share reader preimage changed';
 END IF;
 IF (SELECT count(*) FROM smarter_private.player_rake_share_rules
      WHERE club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
        AND from_user IN('b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216','69f2cefa-017d-49f3-ac3e-61505633747c')
        AND to_user='47965354-0e56-43ef-931c-ddaab82af765'
        AND share_bps=5000 AND effective_until IS NULL) <> 2 THEN
  RAISE EXCEPTION 'Expected both permanent half-share rules';
 END IF;
END $guard$;
ALTER TABLE smarter_private.player_rake_share_rules
 ADD COLUMN tournament_effective_from date CHECK(tournament_effective_from IS NULL OR isfinite(tournament_effective_from));
COMMENT ON COLUMN smarter_private.player_rake_share_rules.tournament_effective_from IS
 'First UTC day of tournament earned-rake sharing, independent of historical cash cutover/redemptions. NULL preserves cash-only rules.';
UPDATE smarter_private.player_rake_share_rules SET tournament_effective_from='1970-01-01'
 WHERE club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'
   AND from_user IN('b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216','69f2cefa-017d-49f3-ac3e-61505633747c')
   AND to_user='47965354-0e56-43ef-931c-ddaab82af765'
   AND share_bps=5000 AND effective_until IS NULL;
CREATE OR REPLACE FUNCTION public.ca_club_member_chicago_fee_totals(p_club_id uuid, p_from date, p_to date, p_user_id uuid)
 RETURNS TABLE(user_id uuid, cash_fees numeric, tournament_fees numeric, total_fees numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT * FROM public.ca_club_member_fee_totals(p_club_id,NULL,NULL,p_user_id) WHERE p_from IS NULL AND p_to IS NULL
 UNION ALL
 SELECT * FROM (
  WITH bounds AS (
    SELECT greatest(coalesce(p_from, public.fn_ca_fee_counting_start()),
                    public.fn_ca_fee_counting_start()) AS from_day,
 greatest(p_from::timestamp AT TIME ZONE 'America/Chicago',public.fn_ca_fee_counting_start()::timestamp AT TIME ZONE 'UTC') AS from_at,
 (p_to+1)::timestamp AT TIME ZONE 'America/Chicago' AS to_at
  ), share AS (
    -- A standing rake share, from the rake_attributions rows the daily rollup
    -- counts (same day key, same filters), rounded per rule and day.
    SELECT r.club_id, r.from_user, r.to_user,
           (ra.created_at AT TIME ZONE 'UTC')::date AS day,
           round(sum(round(ra.rake_amount * 100)) * r.share_bps / 10000.0)::bigint AS cents
      FROM smarter_private.player_rake_share_rules r
      CROSS JOIN bounds b
      JOIN public.rake_attributions ra
        ON ra.club_id = r.club_id AND ra.player_id = r.from_user
       AND ra.created_at >= r.effective_from
       AND (r.effective_until IS NULL OR ra.created_at < r.effective_until)
     WHERE r.club_id = p_club_id
       AND (p_user_id IS NULL OR p_user_id IN(r.from_user,r.to_user))
       AND ra.created_at>=b.from_at AND (b.to_at IS NULL OR ra.created_at<b.to_at)
       AND ra.rake_amount > 0
       AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
     GROUP BY r.rule_key, r.club_id, r.from_user, r.to_user, r.share_bps, 4
  ), cash AS (
    SELECT d.user_id AS uid, sum(d.rake_cents)::numeric / 100 AS fees
      FROM (
       -- Complete UTC buckets remain the source of truth. Only the excluded
       -- portions of the first and last buckets require timestamped receipts.
       SELECT club_id,user_id,day,rake_cents FROM public.ca_club_rake_daily_user
        WHERE club_id=p_club_id AND (p_user_id IS NULL OR user_id=p_user_id)
          AND day >= greatest(coalesce(p_from,public.fn_ca_fee_counting_start()),public.fn_ca_fee_counting_start())
          AND (p_to IS NULL OR day <= p_to+1)
       UNION ALL
       SELECT ra.club_id,ra.player_id,(ra.created_at AT TIME ZONE 'UTC')::date,
              -round(ra.rake_amount*100)::bigint
       FROM bounds edge_bounds
       CROSS JOIN LATERAL (VALUES
         (greatest(p_from::timestamp AT TIME ZONE 'UTC',public.fn_ca_fee_counting_start()::timestamp AT TIME ZONE 'UTC'),edge_bounds.from_at),
         (edge_bounds.to_at,(p_to+2)::timestamp AT TIME ZONE 'UTC')
       ) edge(start_at,end_at)
       JOIN public.rake_attributions ra ON ra.club_id=p_club_id
         AND (p_user_id IS NULL OR ra.player_id=p_user_id) AND ra.created_at>=edge.start_at AND ra.created_at<edge.end_at
       WHERE ra.rake_amount>0
         AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
       UNION ALL
       SELECT club_id,user_id,effective_on,-amount_cents
         FROM smarter_private.player_fee_redemptions CROSS JOIN bounds redemption_bounds
 WHERE (effective_on::timestamp AT TIME ZONE 'UTC')>=redemption_bounds.from_at
 AND (redemption_bounds.to_at IS NULL OR (effective_on::timestamp AT TIME ZONE 'UTC')<redemption_bounds.to_at)
       UNION ALL
       SELECT club_id,from_user,day,-cents FROM share
       UNION ALL
       SELECT club_id,to_user,day,cents FROM share) d, bounds b
     WHERE d.club_id = p_club_id
       AND (p_user_id IS NULL OR d.user_id = p_user_id)
       AND d.day >= b.from_day
       
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
       AND s.charged_at>=b.from_at AND (b.to_at IS NULL OR s.charged_at<b.to_at)
     GROUP BY r.rule_key,r.club_id,r.from_user,r.to_user,r.share_bps,4
  ), mtt AS (
    SELECT t.user_id AS uid,sum(t.fees) AS fees
      FROM (
        SELECT club_id,player_id AS user_id,rake_credit AS fees FROM public.accounting_tournament_fee_sources,bounds b WHERE club_id=p_club_id AND charged_at>=b.from_at AND (b.to_at IS NULL OR charged_at<b.to_at)
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
    FULL JOIN mtt m ON m.uid = c.uid
 ) dated WHERE p_from IS NOT NULL OR p_to IS NOT NULL;
$function$;
CREATE OR REPLACE FUNCTION public.ca_club_member_fee_totals(p_club_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, cash_fees numeric, tournament_fees numeric, total_fees numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH bounds AS (
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
     WHERE r.club_id = p_club_id
       AND ra.rake_amount > 0
       AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
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
