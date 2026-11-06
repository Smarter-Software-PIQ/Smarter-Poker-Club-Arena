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
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.ca_club_member_statistics(uuid,uuid,text,date,date)'::regprocedure)) IS DISTINCT FROM '6dfeb368faa40fd90c86e47aacd77257' THEN
  RAISE EXCEPTION 'Tournament variant statistics preimage changed';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.ca_club_member_statistics(p_club_id uuid, p_user_id uuid, p_variant text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_access text := public.ca_club_roster_access(p_club_id, p_user_id);
  v_variant text := NULLIF(lower(btrim(COALESCE(p_variant, ''))), '');
  v_from timestamptz := CASE WHEN p_from IS NULL THEN NULL ELSE p_from::timestamp AT TIME ZONE 'America/Chicago' END;
  v_to timestamptz := CASE WHEN p_to IS NULL THEN NULL ELSE (p_to + 1)::timestamp AT TIME ZONE 'America/Chicago' END;
  v_viewer_is_member boolean;
  v_target_is_member boolean;
  v_out jsonb;
BEGIN
  IF v_access NOT IN ('staff','downline','service') THEN
    -- A member of the club asking about somebody who is not one is told so;
    -- anyone else is told only that they may not look.
    v_viewer_is_member := auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.club_members cm
       WHERE cm.club_id = p_club_id AND cm.user_id = auth.uid()
         AND coalesce(cm.status, 'approved') IN ('active', 'approved'));
    v_target_is_member := EXISTS (
      SELECT 1 FROM public.club_members cm
       WHERE cm.club_id = p_club_id AND cm.user_id = p_user_id
         AND coalesce(cm.status, 'approved') IN ('active', 'approved'));
    RETURN jsonb_build_object(
      'authorized', false,
      'reason', CASE WHEN v_viewer_is_member AND NOT v_target_is_member
                     THEN 'not_member' ELSE 'restricted' END);
  END IF;

  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'The Start Date Must Come Before The End Date' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.club_member_daily_facts_state WHERE singleton AND initialized)
  THEN RAISE EXCEPTION 'Member daily facts are not initialized'; END IF;

  WITH agg AS (
    SELECT coalesce(sum(f.hands),0)::bigint AS hands,
           coalesce(sum(f.wins),0)::bigint AS wins,
           coalesce(sum(f.vpip_hands),0)::bigint AS vpip_hands,
           coalesce(sum(f.pfr_hands),0)::bigint AS pfr_hands,
           coalesce(sum(f.tb_hands),0)::bigint AS tb_hands,
           coalesce(sum(f.faced_tb),0)::bigint AS faced_tb,
           coalesce(sum(f.folded_tb),0)::bigint AS folded_tb,
           coalesce(sum(f.cb_hands),0)::bigint AS cb_hands,
           coalesce(sum(f.cb_opps),0)::bigint AS cb_opps,
           coalesce(sum(f.fees) FILTER (WHERE f.played_on >= public.fn_ca_fee_counting_start()),0) AS fees,
           coalesce(sum(f.net) FILTER (WHERE NOT f.is_mtt),0) AS net
      FROM public.ca_member_record_chicago_facts(p_club_id,p_user_id,p_from,p_to) f
     WHERE f.club_id=p_club_id AND f.user_id=p_user_id
       AND (v_variant IS NULL OR v_variant='all' OR f.game_variant=v_variant)

  ), vars AS (
    SELECT coalesce(jsonb_agg(v.game_variant ORDER BY v.game_variant),'[]'::jsonb) AS list
      FROM (SELECT DISTINCT f.game_variant FROM public.ca_member_record_daily_facts(p_club_id,p_user_id,NULL,NULL) f
             WHERE f.club_id=p_club_id AND f.user_id=p_user_id
               AND f.game_variant IS NOT NULL AND f.hands>0) v
  )
  SELECT jsonb_build_object(
    'authorized', true, 'variant', COALESCE(v_variant,'all'), 'variants', vars.list,
    'hands', a.hands,
    'hands_won', a.wins,
    'win_rate', COALESCE(round(100.0*a.wins/NULLIF(a.hands,0),2),0),
    'vpip', COALESCE(round(100.0*a.vpip_hands/NULLIF(a.hands,0),2),0),
    'pfr',  COALESCE(round(100.0*a.pfr_hands/NULLIF(a.hands,0),2),0),
    -- 3-bets per hand dealt. Not per opportunity: the facts table does not
    -- record whether this player faced an open they could have 3-bet.
    'three_bet', COALESCE(round(100.0*a.tb_hands/NULLIF(a.hands,0),2),0),
    'three_bet_basis', 'hands',
    'three_bets', a.tb_hands,
    'fold_to_three_bet', COALESCE(round(100.0*a.folded_tb/NULLIF(a.faced_tb,0),2),0),
    'faced_three_bets', a.faced_tb,
    'cbet', COALESCE(round(100.0*a.cb_hands/NULLIF(a.cb_opps,0),2),0),
    'cbet_opportunities', a.cb_opps,
    'net', round(a.net + public.ca_club_member_jackpot_money(p_club_id,p_user_id,v_from,v_to,v_variant) + CASE WHEN v_variant IS NULL OR v_variant='all'
      THEN coalesce(public.ca_club_member_tournament_money(p_club_id, p_user_id, v_from, v_to), 0)
      ELSE coalesce((SELECT sum(leg.signed) FROM (
             SELECT l.amount AS signed
               FROM public.chip_ledger l JOIN public.tournaments t ON t.id = l.tournament_id
              WHERE l.club_id = p_club_id AND l.to_entity_id = p_user_id
                AND l.to_type = 'player_wallet' AND l.from_type = 'prize_liability'
                AND l.tournament_id IS NOT NULL AND l.status = 'posted'
                AND (v_from IS NULL OR l.created_at >= v_from)
                AND (v_to IS NULL OR l.created_at < v_to)
                AND lower(t.game_type) = v_variant
             UNION ALL
             SELECT -l.amount
               FROM public.chip_ledger l JOIN public.tournaments t ON t.id = l.tournament_id
              WHERE l.club_id = p_club_id AND l.from_entity_id = p_user_id
                AND l.from_type = 'player_wallet' AND l.to_type = 'prize_liability'
                AND l.tournament_id IS NOT NULL AND l.status = 'posted'
                AND (v_from IS NULL OR l.created_at >= v_from)
                AND (v_to IS NULL OR l.created_at < v_to)
                AND lower(t.game_type) = v_variant) leg), 0) END, 2),
    'fees', CASE WHEN v_variant IS NULL OR v_variant='all'
                 THEN coalesce((SELECT lf.total_fees FROM public.ca_club_member_chicago_fee_totals(p_club_id, p_from, p_to, p_user_id) lf
                                 WHERE lf.user_id=p_user_id), 0)
                 ELSE round(a.fees + coalesce((
                   -- member_variant_tournament_fee_receipts
                   WITH receipts AS MATERIALIZED (
                     SELECT receipt.* FROM public.accounting_tournament_fee_sources receipt
                     JOIN public.tournaments tournament ON tournament.id=receipt.tournament_id
                     WHERE receipt.club_id=p_club_id
                       AND lower(tournament.game_type)=v_variant
                       AND receipt.charged_at >= greatest(coalesce(v_from,'-infinity'::timestamptz),public.fn_ca_fee_counting_start()::timestamp AT TIME ZONE 'UTC')
                       AND (v_to IS NULL OR receipt.charged_at<v_to)
                       AND (receipt.player_id=p_user_id OR receipt.player_id IN(
                         SELECT r.from_user FROM smarter_private.player_rake_share_rules r
                          WHERE r.club_id=p_club_id AND r.to_user=p_user_id))
                   ), tournament_share AS (
                     SELECT r.rule_key,r.from_user,r.to_user,
                            (receipt.charged_at AT TIME ZONE 'UTC')::date AS day,
                            round(sum(receipt.rake_credit)*100*r.share_bps/10000.0)/100 AS fees
                       FROM receipts receipt JOIN smarter_private.player_rake_share_rules r
                         ON r.club_id=receipt.club_id AND r.from_user=receipt.player_id
                        AND receipt.charged_at >= (r.tournament_effective_from::timestamp AT TIME ZONE 'UTC')
                        AND (r.effective_until IS NULL OR receipt.charged_at<r.effective_until)
                      WHERE r.tournament_effective_from IS NOT NULL AND p_user_id IN(r.from_user,r.to_user)
                      GROUP BY r.rule_key,r.from_user,r.to_user,r.share_bps,4
                   )
                   SELECT sum(credit.fees) FROM (
                     SELECT receipt.rake_credit AS fees FROM receipts receipt WHERE receipt.player_id=p_user_id
                     UNION ALL
                     SELECT CASE WHEN from_user=p_user_id THEN -fees ELSE fees END FROM tournament_share
                   ) credit
                 ),0),2) END,
    'from', p_from, 'to', p_to, 'is_overall', p_from IS NULL AND p_to IS NULL
  ) INTO v_out FROM agg a CROSS JOIN vars;
  RETURN v_out;
END;
$function$
;
REVOKE ALL ON FUNCTION public.ca_club_member_fee_totals(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ca_club_member_fee_totals(uuid,date,date,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ca_club_member_statistics(uuid,uuid,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ca_club_member_statistics(uuid,uuid,text,date,date) TO authenticated,service_role;
COMMIT;
