-- Chicago calendar windows for Member Management and Player Statistics.
-- Reporting only: preserve authorization, funded ownership, fee cutoffs and Overall.
-- UTC daily buckets remain intact; subtract only partial-day edges using retained
-- timestamped facts. Existing retention removes facts and daily totals together.
-- Fee receipts use their timestamps; fixed redemption dates retain UTC midnight.
-- No hot-table DDL, financial writes, engine changes or background repair.
-- @live-proof: to_regprocedure('public.ca_member_record_chicago_facts(uuid,uuid,date,date)') IS NOT NULL
-- @live-proof: position('America/Chicago' IN pg_get_functiondef('public.ca_club_member_detail(uuid,uuid,date,date)'::regprocedure)) > 0
-- @live-proof: position('ca_member_record_chicago_facts' IN pg_get_functiondef('public.ca_club_member_statistics(uuid,uuid,text,date,date)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.ca_member_record_daily_facts(uuid,uuid,date,date)'::regprocedure))<>'aaa18d36aa254de31a779741eea13861' OR md5(pg_get_functiondef('public.ca_club_member_fee_totals(uuid,date,date,uuid)'::regprocedure))<>'e233f2f7c3952d9c744cecb87ba82f59' THEN RAISE EXCEPTION 'Chicago reporting helper source changed'; END IF;
END $guard$;

CREATE FUNCTION public.ca_member_record_chicago_facts(p_club uuid,p_user uuid,p_from date,p_to date)
RETURNS SETOF public.club_member_daily_facts
LANGUAGE sql STABLE SET search_path TO public,pg_temp AS $chicago$
 WITH b AS (
 SELECT p_from::timestamp AT TIME ZONE 'UTC' us,
 p_from::timestamp AT TIME ZONE 'America/Chicago' cs,
 (p_to+1)::timestamp AT TIME ZONE 'America/Chicago' ce,
 (p_to+2)::timestamp AT TIME ZONE 'UTC' ue
 ), rows AS (
 SELECT * FROM public.ca_member_record_daily_facts(p_club,p_user,p_from,p_to+1)
 UNION ALL
 SELECT p_club,f.user_id,(f.played_at AT TIME ZONE 'UTC')::date,
 lower(f.game_variant),f.tournament_id IS NOT NULL,
 -(1),-(CASE WHEN f.net>0 THEN 1 ELSE 0 END),-(CASE WHEN f.vpip THEN 1 ELSE 0 END),-(CASE WHEN f.pfr THEN 1 ELSE 0 END),-(CASE WHEN f.three_bet THEN 1 ELSE 0 END),-(CASE WHEN f.faced_three_bet THEN 1 ELSE 0 END),-(CASE WHEN f.folded_to_three_bet THEN 1 ELSE 0 END),-(CASE WHEN f.cbet_flop THEN 1 ELSE 0 END),-(CASE WHEN f.had_cbet_flop_opp THEN 1 ELSE 0 END),-(coalesce(f.rake_paid,0)),-(coalesce(f.net,0))
 FROM b CROSS JOIN LATERAL(VALUES(b.us,b.cs),(b.ce,b.ue)) edge(start_at,end_at)
 JOIN public.ca_hand_facts f ON f.user_id=p_user
 AND f.played_at>=edge.start_at AND f.played_at<edge.end_at
 WHERE public.fn_member_record_fact_club(f)=p_club
 AND public.fn_ca_launch_accounting_accepts(p_club,f.played_at)
 ) SELECT club_id,user_id,played_on,game_variant,is_mtt,
 sum(hands)::bigint,sum(wins)::bigint,sum(vpip_hands)::bigint,sum(pfr_hands)::bigint,sum(tb_hands)::bigint,sum(faced_tb)::bigint,sum(folded_tb)::bigint,sum(cb_hands)::bigint,sum(cb_opps)::bigint,sum(fees),sum(net)
 FROM rows GROUP BY club_id,user_id,played_on,game_variant,is_mtt;
$chicago$;
REVOKE ALL ON FUNCTION public.ca_member_record_chicago_facts(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
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
       AND (p_user_id IN(r.from_user,r.to_user))
       AND ra.created_at>=b.from_at AND (b.to_at IS NULL OR ra.created_at<b.to_at)
       AND ra.rake_amount > 0
       AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
     GROUP BY r.rule_key, r.club_id, r.from_user, r.to_user, r.share_bps, 4
  ), cash AS (
    SELECT d.user_id AS uid, sum(d.rake_cents)::numeric / 100 AS fees
      FROM (SELECT ra.club_id,ra.player_id AS user_id,(ra.created_at AT TIME ZONE 'UTC')::date AS day,round(ra.rake_amount*100)::bigint rake_cents
 FROM public.rake_attributions ra CROSS JOIN bounds b
 WHERE ra.club_id=p_club_id AND ra.player_id=p_user_id AND ra.rake_amount>0
 AND ra.created_at>=b.from_at AND (b.to_at IS NULL OR ra.created_at<b.to_at)
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
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.ca_club_member_detail(uuid,uuid,date,date)'::regprocedure)) IS DISTINCT FROM '2987cb34d6077d42094681b551405ca3' THEN RAISE EXCEPTION 'Chicago reporting preimage changed: ca_club_member_detail(uuid,uuid,date,date)'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.ca_club_member_detail(p_club_id uuid, p_user_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope uuid[] := public.fn_club_scope_ids(p_club_id);
  v_access text := public.ca_club_roster_access(p_club_id, p_user_id);
  v_sensitive boolean := v_access IN ('staff', 'downline', 'service');
  v_overall boolean := p_from IS NULL AND p_to IS NULL;
  v_ts_from timestamptz := CASE WHEN p_from IS NULL THEN NULL ELSE p_from::timestamp AT TIME ZONE 'America/Chicago' END;
  v_ts_to timestamptz := CASE WHEN p_to IS NULL THEN NULL ELSE (p_to + 1)::timestamp AT TIME ZONE 'America/Chicago' END;
  v_out jsonb;
BEGIN
  IF v_access = 'none' OR v_scope IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_members cm
    LEFT JOIN public.profiles profile ON profile.id = cm.user_id
    WHERE cm.club_id = p_club_id AND cm.user_id = p_user_id
      AND coalesce(cm.status, 'approved') IN ('active', 'approved')
      AND profile.status IS DISTINCT FROM 'deleted'
  ) THEN
    RETURN jsonb_build_object('identity', jsonb_build_object('user_id', NULL));
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.club_member_daily_facts_state WHERE singleton AND initialized)
  THEN RAISE EXCEPTION 'Member daily facts are not initialized'; END IF;

  WITH RECURSIVE mem AS MATERIALIZED (
    SELECT DISTINCT ON (cm.user_id)
           cm.user_id, cm.club_id, cm.role, cm.agent_id, cm.chip_balance,
           cm.promo_balance, cm.nickname, cm.notes, cm.display_name, cm.joined_at, cm.last_active_at,
           public.fn_club_role_rank(cm.role) AS role_rank
      FROM public.club_members cm
     WHERE cm.user_id = p_user_id
       AND cm.club_id = p_club_id
       AND coalesce(cm.status, 'approved') IN ('active', 'approved')
     ORDER BY cm.user_id, public.fn_club_role_rank(cm.role) DESC, cm.joined_at ASC
  ), edges AS MATERIALIZED (
    SELECT DISTINCT cm.user_id AS child, cm.agent_id AS parent
      FROM public.club_members cm
     WHERE cm.club_id = p_club_id
       AND cm.agent_id IS NOT NULL AND cm.agent_id <> cm.user_id
       AND coalesce(cm.status, 'approved') IN ('active', 'approved')
  ), tree AS MATERIALIZED (
    SELECT e.child, 1 AS depth FROM edges e WHERE e.parent = p_user_id
    UNION ALL
    SELECT e.child, t.depth + 1 FROM tree t JOIN edges e ON e.parent = t.child
     WHERE t.depth < 20
  ), downline AS MATERIALIZED (
    SELECT count(DISTINCT child) FILTER (WHERE depth = 1)::int AS direct,
           count(DISTINCT child)::int AS total FROM tree
      LEFT JOIN public.profiles downline_profile ON downline_profile.id = tree.child
     WHERE downline_profile.status IS DISTINCT FROM 'deleted'
  ), seat AS MATERIALIZED (
    SELECT 1 AS seated
      FROM public.table_seats ts JOIN public.tables t ON t.id = ts.table_id
     WHERE ts.user_id = p_user_id AND ts.left_at IS NULL
       AND t.status IN ('waiting', 'running')
       AND (ts.club_id = p_club_id OR t.club_id = p_club_id) LIMIT 1
  ), member_wallet AS MATERIALIZED (
    SELECT sum(coalesce(cm.chip_balance, 0)) AS player_wallet,
           sum(coalesce(cm.promo_balance, 0)) AS member_promo
      FROM public.club_members cm
     WHERE v_sensitive AND cm.user_id = p_user_id AND cm.club_id = p_club_id
       AND coalesce(cm.status, 'approved') IN ('active', 'approved')
  ), agent_wallet AS MATERIALIZED (
    SELECT sum(coalesce(a.agent_wallet_balance, 0)) AS agent_wallet,
           sum(coalesce(a.promo_wallet_balance, 0)) AS agent_promo
      FROM public.agents a
     WHERE v_sensitive AND a.user_id = p_user_id AND a.club_id = p_club_id
       AND coalesce(a.status, 'active') = 'active'
  ), roll AS MATERIALIZED (
    SELECT coalesce(sum(r.hands) FILTER(WHERE NOT r.is_mtt),0)::bigint hands,
      coalesce(sum(r.hands) FILTER(WHERE r.is_mtt),0)::bigint mtt_hands,
      coalesce(sum(r.net) FILTER(WHERE NOT r.is_mtt),0) net
    FROM public.ca_member_record_chicago_facts(p_club_id,p_user_id,p_from,p_to) r
    WHERE v_sensitive
  ), ledger_fee AS MATERIALIZED (
    SELECT coalesce(sum(lf.cash_fees), 0) AS fees,
           coalesce(sum(lf.tournament_fees), 0) AS mtt_fees
      FROM public.ca_club_member_chicago_fee_totals(p_club_id, p_from, p_to, p_user_id) lf
     WHERE v_sensitive
  ), txn AS MATERIALIZED (
    SELECT coalesce(sum(ct.amount) FILTER (WHERE ct.to_user_id = p_user_id
             AND lower(coalesce(ct.transaction_type, '')) ~ '(rakeback|commission)'), 0) AS claimed_back,
           coalesce(sum(abs(ct.amount)) FILTER (WHERE ct.from_user_id = p_user_id
             AND lower(coalesce(ct.transaction_type, '')) ~ '(transfer|send|distribute)'), 0) AS sent_out
      FROM public.chip_transactions ct
     WHERE v_sensitive AND ct.club_id = p_club_id
       -- The player bound. Both FILTERs above already require one of these
       -- equalities; stating it here lets the planner use the two
       -- (club_id, <user>, created_at) indexes instead of reading the club.
       AND (ct.to_user_id = p_user_id OR ct.from_user_id = p_user_id)
       AND (v_ts_from IS NULL OR ct.created_at >= v_ts_from)
       AND (v_ts_to IS NULL OR ct.created_at < v_ts_to)
  )
  SELECT jsonb_build_object(
    'identity', jsonb_build_object(
      'user_id', p_user_id,
      'player_number', pr.player_number,
      'alias', coalesce(nullif(btrim(pr.alias), ''), nullif(btrim(m.display_name), ''),
                        nullif(btrim(public.fn_arena_name(pr.alias, pr.username, pr.display_name, pr.first_name, pr.last_name, pr.full_name)), ''), pr.username),
      'username', pr.username,
      'display_name', coalesce(nullif(btrim(public.fn_arena_name(pr.alias, pr.username, pr.display_name, pr.first_name, pr.last_name, pr.full_name)), ''), pr.username),
      'avatar_url', coalesce(nullif(pr.arena_avatar_url, ''), pr.avatar_url),
      'role', m.role,
      'role_rank', coalesce(m.role_rank, 0),
      'nickname', CASE WHEN v_sensitive THEN m.nickname END,
      'remark', CASE WHEN v_sensitive THEN m.notes END,
      'last_login', CASE WHEN v_sensitive THEN greatest(pr.last_login, pr.last_seen, m.last_active_at) END,
      'joined_at', m.joined_at,
      'home_club_id', m.club_id,
      'home_club_name', cl.name,
      'upline_user_id', CASE WHEN v_sensitive THEN m.agent_id END,
      'upline_name', CASE WHEN v_sensitive THEN up.up_name END,
      'upline_player_number', CASE WHEN v_sensitive THEN up.up_number END
    ),
    'presence', jsonb_build_object(
      'is_online', s.seated IS NOT NULL OR (coalesce(pr.is_online, false) AND pr.last_seen > now() - interval '5 minutes'),
      'is_seated', s.seated IS NOT NULL
    ),
    'wallets', CASE WHEN v_sensitive THEN jsonb_build_object(
      'chip_balance', coalesce(m.chip_balance, 0),
      'player_wallet', coalesce(mw.player_wallet, 0),
      'agent_wallet', coalesce(aw.agent_wallet, 0),
      'promo_wallet', coalesce(mw.member_promo, 0) + coalesce(aw.agent_promo, 0)
    ) ELSE NULL END,
    'downline', CASE WHEN v_sensitive THEN jsonb_build_object(
      'downline_direct', coalesce(d.direct, 0), 'downline_total', coalesce(d.total, 0)
    ) ELSE NULL END,
    'stats', CASE WHEN v_sensitive THEN jsonb_build_object(
      'hands', coalesce(rl.hands, 0), 'mtt_hands', coalesce(rl.mtt_hands, 0),
      'total_fee', round(coalesce(ledger.fees, 0), 2), 'mtt_fee', round(coalesce(ledger.mtt_fees, 0), 2),
      'total_winnings', round(coalesce(rl.net, 0) + public.ca_club_member_jackpot_money(p_club_id,p_user_id,v_ts_from,v_ts_to), 2), 'mtt_winnings', round(coalesce(public.ca_club_member_tournament_money(p_club_id, p_user_id, v_ts_from, v_ts_to), 0), 2),
      'claimed_back', round(coalesce(tx.claimed_back, 0), 2), 'sent_out', round(coalesce(tx.sent_out, 0), 2)
    ) ELSE NULL END,
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'is_overall', v_overall),
    'capabilities', jsonb_build_object(
      'access', v_access,
      'can_view_financials', v_sensitive,
      'can_view_stats', v_sensitive,
      'can_view_downline', v_sensitive,
      'can_view_notes', v_sensitive,
      'can_edit_notes', v_sensitive AND auth.uid() IS DISTINCT FROM p_user_id,
      'can_manage_role', v_access IN ('staff', 'downline', 'service')
    )
  ) INTO v_out
  FROM (SELECT 1) anchor
  LEFT JOIN mem m ON true
  LEFT JOIN public.profiles pr ON pr.id = p_user_id
  LEFT JOIN public.clubs cl ON cl.id = m.club_id
  LEFT JOIN seat s ON true
  LEFT JOIN member_wallet mw ON true
  LEFT JOIN agent_wallet aw ON true
  LEFT JOIN downline d ON true
  LEFT JOIN roll rl ON true
  LEFT JOIN ledger_fee ledger ON true
  LEFT JOIN txn tx ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(nullif(btrim(u.alias), ''), nullif(btrim(public.fn_arena_name(u.alias, u.username, u.display_name, u.first_name, u.last_name, u.full_name)), ''), u.username) AS up_name,
           u.player_number AS up_number
      FROM public.profiles u WHERE u.id = m.agent_id
        AND u.status IS DISTINCT FROM 'deleted'
  ) up ON true;

  RETURN v_out;
END;
$function$
;
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.ca_club_member_statistics(uuid,uuid,text,date,date)'::regprocedure)) IS DISTINCT FROM 'f97c559e454d815c83e7abdfe7dbfa65' THEN RAISE EXCEPTION 'Chicago reporting preimage changed: ca_club_member_statistics(uuid,uuid,text,date,date)'; END IF; END $guard$;
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
                   SELECT sum(receipt.rake_credit)
                     FROM public.accounting_tournament_fee_sources receipt
                     JOIN public.tournaments tournament ON tournament.id=receipt.tournament_id
                    WHERE receipt.club_id=p_club_id AND receipt.player_id=p_user_id
                      AND lower(tournament.game_type)=v_variant
                      AND receipt.charged_at >= greatest(coalesce(v_from,'-infinity'::timestamptz),public.fn_ca_fee_counting_start()::timestamp AT TIME ZONE 'UTC')
                      AND (v_to IS NULL OR receipt.charged_at < v_to)
                 ),0),2) END,
    'from', p_from, 'to', p_to, 'is_overall', p_from IS NULL AND p_to IS NULL
  ) INTO v_out FROM agg a CROSS JOIN vars;
  RETURN v_out;
END;
$function$
;
DO $guard$ BEGIN IF md5(pg_get_functiondef('public.ca_club_member_downline_in_range(uuid,uuid,date,date)'::regprocedure)) IS DISTINCT FROM 'c9c033613c9e80f1e690ac5fff407c75' THEN RAISE EXCEPTION 'Chicago downline source changed'; END IF; END $guard$;
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
    SELECT lf.user_id AS uid, lf.total_fees AS fee_total
      FROM flat member CROSS JOIN LATERAL public.ca_club_member_chicago_fee_totals(p_club_id,p_from,p_to,member.uid) lf
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
COMMIT;
