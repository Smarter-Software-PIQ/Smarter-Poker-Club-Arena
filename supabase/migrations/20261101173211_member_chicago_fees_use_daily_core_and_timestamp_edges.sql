-- 20261101173211_member_chicago_fees_use_daily_core_and_timestamp_edges
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-01 17:32:11 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.

-- A 30-day read scanned all raw rake receipts (35.076s live). Preserve daily
-- core totals and subtract only excluded timestamp edges; no changes to money,
-- fee eligibility, standing-share rounding, redemption timestamps or Overall.
-- Read-only candidate plan:15.294ms; exact totals match the installed helper.
-- @live-proof: position('Complete UTC buckets' IN pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure)) IS DISTINCT FROM '58e99a95c1e2a7046b413c9d3c5cf767' THEN RAISE EXCEPTION 'Chicago fee source changed before optimization'; END IF; END $guard$;
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
  ), mtt AS (
    SELECT t.user_id AS uid, sum(t.fees) AS fees
      FROM (SELECT club_id,player_id user_id,charged_at,rake_credit fees FROM public.accounting_tournament_fee_sources) t, bounds b
     WHERE t.club_id = p_club_id
       AND (p_user_id IS NULL OR t.user_id = p_user_id)
       AND t.charged_at >= b.from_at
       AND (b.to_at IS NULL OR t.charged_at < b.to_at)
     GROUP BY t.user_id
  )
  SELECT coalesce(c.uid, m.uid),
         round(coalesce(c.fees, 0), 2),
         round(coalesce(m.fees, 0), 2),
         round(coalesce(c.fees, 0) + coalesce(m.fees, 0), 2)
    FROM cash c
    FULL JOIN mtt m ON m.uid = c.uid
 ) dated WHERE p_from IS NOT NULL OR p_to IS NOT NULL;
$function$
;
REVOKE ALL ON FUNCTION public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $guard$ BEGIN IF md5(pg_get_functiondef('public.ca_club_member_downline_in_range(uuid,uuid,date,date)'::regprocedure)) IS DISTINCT FROM '44c44f89398eef6620ab425f996ab573' THEN RAISE EXCEPTION 'Chicago downline source changed before optimization'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.ca_club_member_downline_in_range(p_club_id uuid, p_user_id uuid, p_from date, p_to date)
 RETURNS TABLE(user_id uuid, player_number text, alias text, username text, role text, role_rank integer, depth integer, chip_balance numeric, total_fees numeric, is_online boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope uuid[] := public.fn_club_scope_ids(p_club_id);
  v_access text := public.ca_club_roster_access(p_club_id, p_user_id);
BEGIN
  IF v_access NOT IN ('staff', 'downline', 'service') OR v_scope IS NULL THEN RETURN; END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'The Start Date Must Come Before The End Date' USING ERRCODE='22023';
  END IF;


  RETURN QUERY
  WITH RECURSIVE edges AS MATERIALIZED (
    SELECT DISTINCT cm.user_id AS child, cm.agent_id AS parent
      FROM public.club_members cm
     WHERE cm.club_id = p_club_id AND cm.agent_id IS NOT NULL AND cm.agent_id <> cm.user_id
       AND coalesce(cm.status, 'approved') IN ('active', 'approved')
  ), tree AS (
    SELECT e.child, 1 AS depth FROM edges e WHERE e.parent = p_user_id
    UNION ALL
    SELECT e.child, t.depth + 1 FROM tree t JOIN edges e ON e.parent = t.child WHERE t.depth < 20
  ), flat AS MATERIALIZED (
    SELECT t.child AS uid, min(t.depth)::int AS depth FROM tree t GROUP BY t.child
  ), mem AS MATERIALIZED (
    SELECT DISTINCT ON (cm.user_id) cm.user_id AS uid, cm.role, cm.chip_balance,
           public.fn_club_role_rank(cm.role) AS role_rank
      FROM public.club_members cm
     WHERE cm.club_id = p_club_id AND cm.user_id IN (SELECT f.uid FROM flat f)
       AND coalesce(cm.status, 'approved') IN ('active', 'approved')
     ORDER BY cm.user_id, public.fn_club_role_rank(cm.role) DESC, cm.joined_at ASC
  ), seated AS MATERIALIZED (
    SELECT DISTINCT ts.user_id AS uid FROM public.table_seats ts
      JOIN public.tables t ON t.id = ts.table_id
     WHERE ts.left_at IS NULL AND ts.user_id IN (SELECT f.uid FROM flat f)
       AND t.status IN ('waiting', 'running')
       AND (ts.club_id = p_club_id OR t.club_id = p_club_id)
  ), fees AS MATERIALIZED (
    -- One bulk fee read for both dated and Overall downlines.
    SELECT lf.user_id AS uid, lf.total_fees AS fee_total
      FROM public.ca_club_member_chicago_fee_totals(p_club_id,p_from,p_to,NULL) lf
     WHERE lf.user_id IN (SELECT f.uid FROM flat f)
  )
  SELECT f.uid, pr.player_number::text,
         public.fn_arena_name(pr.alias, pr.username, pr.display_name,
                              pr.first_name, pr.last_name, pr.full_name)::text,
         coalesce(pr.username, '')::text, coalesce(m.role, 'player')::text,
         coalesce(m.role_rank, 0), f.depth, coalesce(m.chip_balance, 0)::numeric,
         round(coalesce(fe.fee_total, 0), 2)::numeric,
         s.uid IS NOT NULL OR (coalesce(pr.is_online, false) AND pr.last_seen > now() - interval '5 minutes')
    FROM flat f LEFT JOIN mem m ON m.uid = f.uid LEFT JOIN public.profiles pr ON pr.id = f.uid
    LEFT JOIN seated s ON s.uid = f.uid LEFT JOIN fees fe ON fe.uid = f.uid
   WHERE pr.status IS DISTINCT FROM 'deleted'
   ORDER BY f.depth, coalesce(m.role_rank, 0) DESC,
            lower(public.fn_arena_name(pr.alias, pr.username, pr.display_name,
                                       pr.first_name, pr.last_name, pr.full_name));
END;
$function$
;
REVOKE ALL ON FUNCTION public.ca_club_member_downline_in_range(uuid,uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ca_club_member_downline_in_range(uuid,uuid,date,date) TO authenticated,service_role;
COMMIT;
