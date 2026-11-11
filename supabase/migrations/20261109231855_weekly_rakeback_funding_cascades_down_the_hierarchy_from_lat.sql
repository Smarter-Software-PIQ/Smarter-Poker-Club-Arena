-- 20261109231855_weekly_rakeback_funding_cascades_down_the_hierarchy_from_lat.sql
--
-- WEEKLY RAKEBACK FUNDING CASCADES DOWN THE RECORDED HIERARCHY (Dan, 2026-11-09)
--
-- Before round 3 the weekly runner calls
-- smarter_private.weekly_payout_fund_agent_shortfalls. Its body was a top-up:
-- club bank -> any agent whose wallet was short, by wallet balance. Two root
-- defects:
--   D5  it summed EVERY certificate version of a period instead of the latest
--       (max id) one, so a superseded snapshot was funded again (326.91 over on
--       week 2026-11-02; that leg is settled and is not touched here);
--   D6  it paid club bank -> payer directly, skipping the recorded hierarchy,
--       and measured the need from a wallet balance instead of the agreement.
--
-- The body is now an upfront plan (same signature, same call site):
--   * latest certificate of each pending period only;
--   * need(payer, player-week) = max(0, owed - covered), where covered is the
--     payer's own commission rows (public.agent_commissions) on exactly the
--     sources that certificate allocates to that payer; never netted across
--     players;
--   * each need travels club bank -> top agent -> ... -> payer along the agent
--     agreements in force at each allocation's agreement time
--     (accounting_agreement_history; agent_history_id and agreement_at are in
--     the certificate), one keyed leg per edge per week, parents first, and no
--     hop may leave a wallet short;
--   * an upline whose account is deleted is skipped: the path continues to its
--     nearest live upline, or to the club bank when there is none, so nothing
--     is credited to a wallet whose credits are returned to the bank. A
--     deleted direct payer is still funded and pays (its published rakeback
--     is reserved for it). An upline deleted after it already passed this
--     week's funding down is refused, naming it;
--   * a share whose recorded upline is the club owner is funded club bank ->
--     owner agent wallet (smarter_private.ensure_owner_routing_wallet) and
--     round 3 then pays those players from that wallet. A player with no
--     upline at all keeps the existing club bank -> player route;
--   * a club that cannot afford the week is refused before any transfer.
--
-- Round 3 and its two payout validators change only to recognise the owner
-- wallet route, and only for legs that carry its marker. No row carries that
-- marker before this file (measured on production 2026-11-09: 0 chip_ledger
-- rows have metadata ? 'cascade_route'), so every settled payout is judged
-- exactly as before. Nothing settled is replayed. This file writes no data,
-- adds no schedule and no repair path, and takes nothing back from anyone.
-- Horses are players: nothing here reads is_horse.
--
-- Requires 20261109231325 (smarter_private.ensure_owner_routing_wallet).
-- Proof: scripts/ci/test-rakeback-cascade-funding-postgres.py (PostgreSQL 17).
-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure))='dddb67b5024a01bb4f2dadc0ba1009f2'

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$BEGIN IF md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM '018a0fcbad1fabcf1b5427b9fa454028' THEN RAISE EXCEPTION 'rakeback_cascade_fund_preimage_changed';END IF;
 IF to_regprocedure('smarter_private.ensure_owner_routing_wallet(uuid)') IS NULL THEN RAISE EXCEPTION 'rakeback_cascade_requires_owner_routing_wallet';END IF;END $pre$;
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_key(p_club uuid,p_week date,p_payer uuid,p_payee uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$SELECT 'rakeback-cascade:v1:'||p_club::text||':'||to_char(p_week,'YYYY-MM-DD')||':'||COALESCE(p_payer::text,'club')||':'||p_payee::text$function$;

-- Is this certificate's club-paid share owed under the club owner as the
-- recorded upline? Read from the membership agreement each allocation names
-- (membership_history_id). One allocation with no upline, another upline, or
-- no readable agreement keeps the whole leg on the club bank route.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_owner_upline(p_calculation bigint,p_owner uuid,p_payer_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT COALESCE((SELECT CASE WHEN p_owner IS NULL OR c.player_id=p_owner THEN false
   WHEN p_payer_user IS NOT NULL THEN p_payer_user=p_owner
   ELSE COALESCE((SELECT bool_and(h.id IS NOT NULL AND NULLIF(h.after_terms->>'agent_id','')::uuid IS NOT DISTINCT FROM p_owner)
     FROM(SELECT DISTINCT(a->>'membership_history_id')::bigint mh FROM jsonb_array_elements(c.source_allocations)a WHERE a->>'payer_kind'='club')m
     LEFT JOIN public.accounting_agreement_history h ON h.id=m.mh AND h.entity_type='club_members'),false)END
  FROM public.accounting_rakeback_period_calculations c WHERE c.id=p_calculation),false)
$function$;

-- The funding key when this week's cascade funded the owner route for this
-- leg; NULL otherwise (round 3 then pays exactly as it always has).
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_owner_route(p_calculation bigint,p_club uuid,p_owner uuid,p_payer_user uuid,p_week date)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE k text;
BEGIN
 IF p_owner IS NULL OR p_club IS NULL OR p_week IS NULL THEN RETURN NULL; END IF;
 k:=smarter_private.rakeback_cascade_key(p_club,p_week,NULL,p_owner);
 IF NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=k AND l.status='posted' AND l.from_type='club_treasury'
   AND l.from_entity_id=p_club AND l.to_type='agent_wallet' AND l.to_entity_id=p_owner AND l.club_id=p_club
   AND l.metadata->>'cascade'='rakeback-funding-v1') THEN RETURN NULL; END IF;
 IF smarter_private.rakeback_cascade_owner_upline(p_calculation,p_owner,p_payer_user) THEN RETURN k; END IF;
 RETURN NULL;
END $function$;

-- A paid rakeback leg that left the owner's agent wallet is complete only when
-- it names the owner it debited and the club bank leg that funded that wallet.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_owner_leg_paid(p_ledger uuid,p_club uuid,p_payer_kind text,p_payer_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT COALESCE((SELECT l.from_type='agent_wallet' AND l.metadata->>'cascade_route'='owner_wallet' AND l.metadata->>'paid_from'='agent_wallet'
   AND l.from_entity_id=(l.metadata->>'cascade_owner')::uuid AND l.to_entity_id<>l.from_entity_id AND l.club_id=p_club
   AND(p_payer_kind='club' OR p_payer_user IS NULL OR p_payer_user=l.from_entity_id)
   AND EXISTS(SELECT 1 FROM public.chip_ledger f WHERE f.idempotency_key=l.metadata->>'cascade_funding_key' AND f.status='posted'
    AND f.from_type='club_treasury' AND f.from_entity_id=p_club AND f.to_type='agent_wallet' AND f.to_entity_id=l.from_entity_id
    AND f.club_id=p_club AND f.metadata->>'cascade'='rakeback-funding-v1')
  FROM public.chip_ledger l WHERE l.id=p_ledger),false)
$function$;

CREATE OR REPLACE FUNCTION smarter_private.weekly_payout_fund_agent_shortfalls(p_run uuid, p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE d_from date:=(p_from AT TIME ZONE 'America/Los_Angeles')::date;
 scope_key text:=CASE WHEN p_kind='union' THEN p_id::text ELSE 'club:'||p_id::text END;
 r2_key text; sid uuid; bad record; e record; step int:=0; progress int; todo int; k text; prior record;
 payer_before numeric; payer_after numeric; payee_before numeric; payee_after numeric; ledger_id uuid; receipts int;
 club_skip text; agent_skip text; sent jsonb:='[]'::jsonb; d int;
BEGIN
 IF p_run IS NULL OR p_kind IS NULL OR p_kind NOT IN('union','club') OR p_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>=p_to
 THEN RAISE EXCEPTION 'rakeback_cascade_scope_invalid' USING ERRCODE='22023'; END IF;
 r2_key:='round2:v3:'||scope_key||':'||extract(epoch FROM p_from)::text||':'||extract(epoch FROM p_to)::text;
 -- 1. LATEST CERTIFICATE ONLY (D5): one certificate per pending period, the
 --    one with the highest id. A superseded snapshot contributes nothing.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_certs(calc_id bigint PRIMARY KEY,period_id uuid,club_id uuid,player_id uuid,owner_id uuid) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_certs;
 INSERT INTO pg_temp._rcf_certs
 SELECT x.id,x.period_id,x.club_id,x.player_id,cl.owner_id FROM(
   SELECT DISTINCT ON(rp.id) c.id,c.period_id,c.club_id,c.player_id,c.coordinator_union_id
   FROM public.rakeback_periods rp JOIN public.accounting_rakeback_period_calculations c ON c.period_id=rp.id
   WHERE rp.period_start=d_from AND rp.status='pending' ORDER BY rp.id,c.id DESC)x
  JOIN public.clubs cl ON cl.id=x.club_id
  WHERE(p_kind='union' AND x.coordinator_union_id=p_id) OR(p_kind='club' AND x.club_id=p_id AND x.coordinator_union_id IS NULL);
 CREATE TEMP TABLE IF NOT EXISTS _rcf_legs(calc_id bigint,club_id uuid,player_id uuid,payer_kind text,payer_user uuid,owed numeric,route text,covered numeric DEFAULT 0,need numeric DEFAULT 0) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_legs;
 INSERT INTO pg_temp._rcf_legs(calc_id,club_id,player_id,payer_kind,payer_user,owed,route)
 SELECT x.calc_id,x.club_id,x.player_id,x.payer_kind,x.payer_user,sum(x.owed),x.route FROM(
  SELECT c.calc_id,c.club_id,c.player_id,fp.payer_kind,fp.payer_user,fp.owed,
   CASE WHEN fp.payer_kind<>'club' AND fp.payer_user IS NOT NULL AND fp.payer_user IS DISTINCT FROM c.owner_id THEN 'agent'
    WHEN fp.destination_kind='player_wallet' AND smarter_private.rakeback_cascade_owner_upline(c.calc_id,c.owner_id,fp.payer_user) THEN 'owner'
    ELSE 'bank' END route
  FROM pg_temp._rcf_certs c CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(c.calc_id)fp WHERE fp.owed>0)x
 GROUP BY x.calc_id,x.club_id,x.player_id,x.payer_kind,x.payer_user,x.route;
 IF NOT EXISTS(SELECT 1 FROM pg_temp._rcf_legs) THEN
  RETURN jsonb_build_object('version','rakeback-funding-v1','week_start',d_from,'edges','[]'::jsonb,'clubs','[]'::jsonb,'nodes','[]'::jsonb);
 END IF;
 SELECT l.club_id INTO bad FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE c.owner_id IS NULL LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_owner_missing: club % has no owner, so its recorded upline cannot be told from an unassigned player',bad.club_id USING ERRCODE='23514'; END IF;
 -- 2. What each real agent must be handed: owed minus its own commission on
 --    exactly the sources this certificate allocates to it.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_alloc(calc_id bigint,club_id uuid,payer uuid,st text,sid uuid,ah bigint,at timestamptz,unr numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_alloc;
 INSERT INTO pg_temp._rcf_alloc
 SELECT c.calc_id,c.club_id,NULLIF(a->>'payer_user_id','')::uuid,a->>'source_type',(a->>'source_id')::uuid,(a->>'agent_history_id')::bigint,
  COALESCE((a->>'agreement_at')::timestamptz,(a->>'earned_at')::timestamptz),(a->>'rake_credit')::numeric*(a->>'rate')::numeric
 FROM pg_temp._rcf_certs c JOIN public.accounting_rakeback_period_calculations cc ON cc.id=c.calc_id
 CROSS JOIN LATERAL jsonb_array_elements(cc.source_allocations)a
 WHERE EXISTS(SELECT 1 FROM pg_temp._rcf_legs l WHERE l.calc_id=c.calc_id AND l.route='agent')
  AND a->>'payer_kind'='agent' AND NULLIF(a->>'payer_user_id','')::uuid IS DISTINCT FROM c.owner_id;
 ANALYZE pg_temp._rcf_alloc;
 UPDATE pg_temp._rcf_legs l SET covered=x.covered FROM(
  SELECT a.calc_id,a.payer,COALESCE(sum(ac.amount),0) covered FROM pg_temp._rcf_alloc a
  LEFT JOIN public.agent_commissions ac ON ac.source_id=a.sid AND ac.source_type=a.st AND ac.user_id=a.payer AND ac.club_id=a.club_id
  GROUP BY a.calc_id,a.payer)x WHERE l.route='agent' AND x.calc_id=l.calc_id AND x.payer=l.payer_user;
 UPDATE pg_temp._rcf_legs SET need=CASE route WHEN 'agent' THEN greatest(owed-covered,0) WHEN 'owner' THEN owed ELSE 0 END WHERE true;
 -- 3. The hierarchy in force at each allocation's agreement time. Only the
 --    allocations of a leg that needs funding are walked.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_chain(ah bigint,at timestamptz,club_id uuid,depth int,agent_id uuid,user_id uuid,parent_agent_id uuid,chain_club uuid,PRIMARY KEY(ah,at,depth)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_chain;
 SELECT a.club_id,a.payer INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  WHERE a.ah IS NULL OR a.at IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounting_agreement_history h WHERE h.id=a.ah AND h.entity_type='agents') LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_missing: club % payer % has an allocation with no recorded agent agreement',bad.club_id,bad.payer USING ERRCODE='23514'; END IF;
 INSERT INTO pg_temp._rcf_chain
 SELECT k.ah,k.at,k.club_id,0,(h.after_terms->>'id')::uuid,(h.after_terms->>'user_id')::uuid,NULLIF(h.after_terms->>'parent_agent_id','')::uuid,(h.after_terms->>'club_id')::uuid
 FROM(SELECT DISTINCT a.ah,a.at,a.club_id FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0)k
 JOIN public.accounting_agreement_history h ON h.id=k.ah AND h.entity_type='agents';
 SELECT a.club_id,a.payer INTO bad FROM pg_temp._rcf_alloc a JOIN pg_temp._rcf_legs l ON l.calc_id=a.calc_id AND l.payer_user=a.payer AND l.need>0
  JOIN pg_temp._rcf_chain c ON c.ah=a.ah AND c.at=a.at AND c.depth=0 WHERE c.user_id IS DISTINCT FROM a.payer OR c.chain_club IS DISTINCT FROM a.club_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_missing: club % payer % is not the agent its allocation agreement records',bad.club_id,bad.payer USING ERRCODE='23514'; END IF;
 d:=0;
 LOOP
  d:=d+1;
  INSERT INTO pg_temp._rcf_chain
  SELECT x.ah,x.at,x.club_id,d,(h.after_terms->>'id')::uuid,(h.after_terms->>'user_id')::uuid,NULLIF(h.after_terms->>'parent_agent_id','')::uuid,(h.after_terms->>'club_id')::uuid
  FROM pg_temp._rcf_chain x JOIN public.clubs o ON o.id=x.club_id
  LEFT JOIN LATERAL(SELECT hist.id,hist.after_terms FROM public.accounting_agreement_history hist
    WHERE hist.entity_type='agents' AND hist.entity_key=x.parent_agent_id::text AND hist.observed_at<=x.at
     AND NOT EXISTS(SELECT 1 FROM public.accounting_agreement_history later WHERE later.transaction_id=hist.transaction_id AND later.observed_at>x.at)
    ORDER BY hist.observed_at DESC,hist.id DESC LIMIT 1)h ON true
  -- The owner is the club: what passes down through the owner comes straight
  -- from the club bank (round 2, Dan 2026-10-22), so the walk ends below it.
  WHERE x.depth=d-1 AND x.parent_agent_id IS NOT NULL AND x.user_id IS DISTINCT FROM o.owner_id;
  GET DIAGNOSTICS progress=ROW_COUNT;
  EXIT WHEN progress=0;
  SELECT x.club_id,x.parent_agent_id INTO bad FROM pg_temp._rcf_chain x JOIN pg_temp._rcf_chain p ON p.ah=x.ah AND p.at=x.at AND p.depth=d
   WHERE x.depth=d-1 AND p.agent_id IS NULL LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_missing: club % upline agent % has no agreement at the earning time',bad.club_id,bad.parent_agent_id USING ERRCODE='23514'; END IF;
  SELECT p.club_id,p.agent_id,p.chain_club INTO bad FROM pg_temp._rcf_chain p WHERE p.depth=d AND p.chain_club IS DISTINCT FROM p.club_id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_parent_outside_club: club % has upline agent % recorded in club %',bad.club_id,bad.agent_id,bad.chain_club USING ERRCODE='23514'; END IF;
  SELECT p.club_id,p.user_id INTO bad FROM pg_temp._rcf_chain p JOIN pg_temp._rcf_chain q ON q.ah=p.ah AND q.at=p.at AND q.depth<p.depth AND q.user_id=p.user_id WHERE p.depth=d LIMIT 1;
  IF FOUND OR d>=64 THEN RAISE EXCEPTION 'rakeback_cascade_hierarchy_cycle: club % agent % is its own upline',COALESCE(bad.club_id::text,'?'),COALESCE(bad.user_id::text,'?') USING ERRCODE='23514'; END IF;
 END LOOP;
 DELETE FROM pg_temp._rcf_chain c USING public.clubs o WHERE o.id=c.club_id AND c.user_id=o.owner_id AND c.depth>0;
 -- A DELETED UPLINE IS ROUTED AROUND (owner decision 2026-11-09; proved under
 -- the live trigger stack, scripts/ci/test-rakeback-cascade-real-guards-postgres.py).
 -- zzzz_deleted_agent_credit returns any credit to a deleted account's agent
 -- wallet to the club bank inside the crediting statement, so chips sent
 -- through such an upline never reach the next hop. The path therefore skips
 -- it and continues to its nearest live upline, or to the club bank when
 -- there is none: the same collapse applied to the owner above. Nothing is
 -- credited to the deleted account. A deleted DIRECT payer (depth 0) stays:
 -- what it owes its players is held back for it
 -- (deleted_wallet_published_rakeback_reserve) and round 3 pays from it.
 -- The one shape that cannot be routed: the account already passed this
 -- week's funding down before it was deleted, so a new route would send the
 -- same chips to the same agent a second time. Refused, naming both.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_skipped(club_id uuid,user_id uuid,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_skipped;
 INSERT INTO pg_temp._rcf_skipped SELECT DISTINCT c.club_id,c.user_id FROM pg_temp._rcf_chain c JOIN public.profiles p ON p.id=c.user_id AND p.status='deleted' WHERE c.depth>0;
 SELECT c.club_id,c.user_id,lo.user_id AS payee INTO bad FROM pg_temp._rcf_chain c JOIN pg_temp._rcf_skipped s ON s.club_id=c.club_id AND s.user_id=c.user_id
  JOIN pg_temp._rcf_chain lo ON lo.ah=c.ah AND lo.at=c.at AND lo.depth<c.depth
  WHERE c.depth>0 AND EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(c.club_id,d_from,c.user_id,lo.user_id)) ORDER BY 1,2,3 LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_upline_deleted_after_funding: club % upline agent % passed this week''s funding down to agent % and its account was deleted afterwards; a route around it would fund that agent twice',bad.club_id,bad.user_id,bad.payee USING ERRCODE='23514'; END IF;
 DELETE FROM pg_temp._rcf_chain c USING pg_temp._rcf_skipped s WHERE s.club_id=c.club_id AND s.user_id=c.user_id AND c.depth>0;
 -- 4. Each need is split over the paths its sources were earned under, in
 --    proportion to their unrounded rakeback, by running cents: nothing is
 --    lost or invented when an upline changed inside the week.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_flow(club_id uuid,path uuid[],amount numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_flow;
 INSERT INTO pg_temp._rcf_flow
 WITH paths AS(SELECT c.ah,c.at,array_agg(c.user_id ORDER BY c.depth) path FROM pg_temp._rcf_chain c GROUP BY c.ah,c.at),
 grp AS(SELECT a.calc_id,a.club_id,a.payer,p.path,sum(a.unr) w FROM pg_temp._rcf_alloc a JOIN paths p ON p.ah=a.ah AND p.at=a.at GROUP BY 1,2,3,4),
 run AS(SELECT g.*,l.need,sum(g.w) OVER(PARTITION BY g.calc_id,g.payer ORDER BY g.path::text) upto,sum(g.w) OVER(PARTITION BY g.calc_id,g.payer) total
  FROM grp g JOIN pg_temp._rcf_legs l ON l.calc_id=g.calc_id AND l.payer_user=g.payer AND l.route='agent' AND l.need>0)
 SELECT club_id,path,sum(round(need*upto/total,2)-round(need*(upto-w)/total,2)) FROM run WHERE total>0 GROUP BY club_id,path;
 IF (SELECT COALESCE(sum(amount),0) FROM pg_temp._rcf_flow) IS DISTINCT FROM (SELECT COALESCE(sum(need),0) FROM pg_temp._rcf_legs WHERE route='agent')
 THEN RAISE EXCEPTION 'rakeback_cascade_plan_does_not_conserve: paths carry % of % needed',(SELECT COALESCE(sum(amount),0) FROM pg_temp._rcf_flow),(SELECT COALESCE(sum(need),0) FROM pg_temp._rcf_legs WHERE route='agent') USING ERRCODE='23514'; END IF;
 -- 5. One edge per (club, payer, payee) for the week. payer NULL = club bank.
 CREATE TEMP TABLE IF NOT EXISTS _rcf_edges(club_id uuid,payer_user uuid,payee_user uuid,amount numeric,route text,sort_order int,state text) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_edges;
 INSERT INTO pg_temp._rcf_edges(club_id,payer_user,payee_user,amount,route)
 SELECT f.club_id,f.path[i+1],f.path[i],sum(f.amount),'hierarchy' FROM pg_temp._rcf_flow f CROSS JOIN LATERAL generate_subscripts(f.path,1)i
  WHERE f.amount>0 GROUP BY 1,2,3;
 INSERT INTO pg_temp._rcf_edges(club_id,payer_user,payee_user,amount,route)
 SELECT l.club_id,NULL,c.owner_id,sum(l.need),'owner_wallet' FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.route='owner' GROUP BY l.club_id,c.owner_id;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_nodes(club_id uuid,user_id uuid,sort_order int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_nodes;
 INSERT INTO pg_temp._rcf_nodes(club_id,user_id) SELECT DISTINCT club_id,payee_user FROM pg_temp._rcf_edges;
 SELECT count(*) INTO todo FROM pg_temp._rcf_nodes;
 WHILE todo>0 LOOP
  step:=step+1;
  UPDATE pg_temp._rcf_nodes n SET sort_order=step WHERE n.sort_order IS NULL AND NOT EXISTS(
   SELECT 1 FROM pg_temp._rcf_edges x JOIN pg_temp._rcf_nodes p ON p.club_id=x.club_id AND p.user_id=x.payer_user
   WHERE x.club_id=n.club_id AND x.payee_user=n.user_id AND(p.sort_order IS NULL OR p.sort_order=step));
  GET DIAGNOSTICS progress=ROW_COUNT;
  IF progress=0 THEN
   SELECT n.club_id,n.user_id INTO bad FROM pg_temp._rcf_nodes n WHERE n.sort_order IS NULL ORDER BY 1,2 LIMIT 1;
   RAISE EXCEPTION 'rakeback_cascade_hierarchy_cycle: club % agent % funds its own upline within the week',bad.club_id,bad.user_id USING ERRCODE='23514';
  END IF;
  todo:=todo-progress;
 END LOOP;
 UPDATE pg_temp._rcf_edges x SET sort_order=n.sort_order FROM pg_temp._rcf_nodes n WHERE n.club_id=x.club_id AND n.user_id=x.payee_user;
 -- The owner's wallet exists before anything moves; it is created only here,
 -- only through lane A's door, and only when the owner route carries chips.
 FOR e IN SELECT DISTINCT club_id FROM pg_temp._rcf_edges WHERE route='owner_wallet' AND amount>0 ORDER BY 1 LOOP
  IF smarter_private.ensure_owner_routing_wallet(e.club_id) IS NULL THEN RAISE EXCEPTION 'rakeback_cascade_club_owner_missing: club % owner has no routing wallet',e.club_id USING ERRCODE='23514'; END IF;
 END LOOP;
 UPDATE pg_temp._rcf_edges x SET state=CASE WHEN EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.idempotency_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)) THEN 'already_funded' ELSE 'to_send' END WHERE true;
 -- 6. AFFORDABILITY, before any transfer, per club.
 PERFORM c.id FROM public.clubs c WHERE c.id IN(SELECT club_id FROM pg_temp._rcf_legs) ORDER BY c.id FOR NO KEY UPDATE;
 IF p_kind='union' THEN
  SELECT cs.id INTO sid FROM public.ca_settlements cs WHERE cs.settlement_type='union_rakeback_close'
   AND cs.external_ref=p_id::text||':'||to_char(p_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')||'..'||to_char(p_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
 END IF;
 CREATE TEMP TABLE IF NOT EXISTS _rcf_clubs(club_id uuid PRIMARY KEY,received numeric,commission numeric,cascade numeric,cascade_unsent numeric,direct numeric,bank numeric) ON COMMIT DROP;
 TRUNCATE pg_temp._rcf_clubs;
 INSERT INTO pg_temp._rcf_clubs
 SELECT c.id,
  CASE WHEN p_kind='union' THEN COALESCE((SELECT l.amount FROM public.chip_ledger l WHERE l.idempotency_key='union_close:'||sid::text||':'||c.id::text AND l.to_type='club_treasury' AND l.to_entity_id=c.id),0) END,
  COALESCE((SELECT sum(l.amount) FROM public.agents a JOIN public.chip_ledger l ON l.idempotency_key=r2_key||':'||c.id::text||':club:'||a.user_id::text WHERE a.club_id=c.id AND l.from_type='club_treasury'),0),
  COALESCE((SELECT sum(x.amount) FROM pg_temp._rcf_edges x WHERE x.club_id=c.id AND x.payer_user IS NULL),0),
  COALESCE((SELECT sum(x.amount) FROM pg_temp._rcf_edges x WHERE x.club_id=c.id AND x.payer_user IS NULL AND x.state='to_send'),0),
  COALESCE((SELECT sum(l.owed) FROM pg_temp._rcf_legs l WHERE l.club_id=c.id AND l.route='bank'),0),c.chip_treasury
 FROM public.clubs c WHERE c.id IN(SELECT club_id FROM pg_temp._rcf_legs);
 SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.received IS NOT NULL AND x.commission+x.cascade+x.direct>x.received ORDER BY x.club_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_cannot_afford_week: club % received % for the week but owes % (commission from the bank %, agent and owner funding %, players paid by the bank %)',
   bad.club_id,bad.received,bad.commission+bad.cascade+bad.direct,bad.commission,bad.cascade,bad.direct USING ERRCODE='23514'; END IF;
 SELECT * INTO bad FROM pg_temp._rcf_clubs x WHERE x.bank IS NULL OR x.bank<>round(x.bank,2) OR x.cascade_unsent+x.direct>x.bank ORDER BY x.club_id LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_club_bank_short: club % bank holds % but the week still needs % (agent and owner funding %, players paid by the bank %)',
   bad.club_id,bad.bank,bad.cascade_unsent+bad.direct,bad.cascade_unsent,bad.direct USING ERRCODE='23514'; END IF;
 -- 7. Transfers, parents before children. A leg already sent under this
 --    week's key is never sent again; a larger plan than the leg that was
 --    sent means the certificates changed after funding, which is refused.
 SELECT x.club_id,x.payee_user,x.amount,l.amount AS funded INTO bad FROM pg_temp._rcf_edges x
  JOIN public.chip_ledger l ON l.idempotency_key=smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)
  WHERE x.state='already_funded' AND(l.amount<x.amount OR l.club_id IS DISTINCT FROM x.club_id OR l.to_entity_id IS DISTINCT FROM x.payee_user
   OR l.to_type<>'agent_wallet' OR l.from_entity_id IS DISTINCT FROM COALESCE(x.payer_user,x.club_id)) LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_funded_amount_changed: club % payee % was funded % for this week and the plan now needs %',bad.club_id,bad.payee_user,bad.funded,bad.amount USING ERRCODE='55000'; END IF;
 PERFORM a.id FROM public.agents a JOIN pg_temp._rcf_nodes n ON n.club_id=a.club_id AND n.user_id=a.user_id ORDER BY a.club_id,a.user_id FOR NO KEY UPDATE OF a;
 SELECT n.club_id,n.user_id INTO bad FROM pg_temp._rcf_nodes n LEFT JOIN public.agents a ON a.club_id=n.club_id AND a.user_id=n.user_id
  WHERE a.id IS NULL OR a.agent_wallet_balance IS NULL OR a.agent_wallet_balance<0 OR a.agent_wallet_balance<>round(a.agent_wallet_balance,2) ORDER BY 1,2 LIMIT 1;
 IF FOUND THEN RAISE EXCEPTION 'rakeback_cascade_agent_wallet_missing: club % agent % has no valid agent wallet',bad.club_id,bad.user_id USING ERRCODE='23514'; END IF;
 club_skip:=current_setting('app.ledger_autoskip_clubs',true);agent_skip:=current_setting('app.ledger_autoskip_agents',true);
 PERFORM set_config('app.ledger_autoskip_clubs','1',true);PERFORM set_config('app.ledger_autoskip_agents','1',true);
 FOR e IN SELECT * FROM pg_temp._rcf_edges WHERE state='to_send' AND amount>0 ORDER BY sort_order,club_id,payer_user NULLS FIRST,payee_user LOOP
  k:=smarter_private.rakeback_cascade_key(e.club_id,d_from,e.payer_user,e.payee_user);
  SELECT agent_wallet_balance INTO payee_before FROM public.agents WHERE club_id=e.club_id AND user_id=e.payee_user;
  payer_after:=NULL;
  IF e.payer_user IS NULL THEN
   SELECT chip_treasury INTO payer_before FROM public.clubs WHERE id=e.club_id;
   IF payer_before IS NULL OR payer_before<e.amount THEN RAISE EXCEPTION 'rakeback_cascade_club_bank_short: club % bank holds % and cannot fund agent % with %',e.club_id,payer_before,e.payee_user,e.amount USING ERRCODE='23514'; END IF;
   UPDATE public.clubs SET chip_treasury=chip_treasury-e.amount WHERE id=e.club_id AND chip_treasury>=e.amount RETURNING chip_treasury INTO payer_after;
  ELSE
   SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=e.club_id AND user_id=e.payer_user;
   IF payer_before IS NULL OR payer_before<e.amount THEN RAISE EXCEPTION 'rakeback_cascade_upstream_wallet_short: club % agent % holds % and cannot pass % down to agent %',e.club_id,e.payer_user,payer_before,e.amount,e.payee_user USING ERRCODE='23514'; END IF;
   UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-e.amount,updated_at=now() WHERE club_id=e.club_id AND user_id=e.payer_user AND agent_wallet_balance>=e.amount RETURNING agent_wallet_balance INTO payer_after;
  END IF;
  UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+e.amount,updated_at=now() WHERE club_id=e.club_id AND user_id=e.payee_user RETURNING agent_wallet_balance INTO payee_after;
  IF payer_after IS NULL OR payee_after IS NULL OR payer_before-payer_after<>e.amount OR payee_after-payee_before<>e.amount
  THEN RAISE EXCEPTION 'rakeback_cascade_transfer_not_conserved: club % payer % payee % amount %',e.club_id,COALESCE(e.payer_user::text,'club bank'),e.payee_user,e.amount USING ERRCODE='23514'; END IF;
  INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,union_id,description,idempotency_key,metadata,
    pre_from_balance,post_from_balance,pre_to_balance,post_to_balance)
   VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),CASE WHEN e.payer_user IS NULL THEN 'club_treasury' ELSE 'agent_wallet' END,
    COALESCE(e.payer_user,e.club_id),'agent_wallet',e.payee_user,e.amount,CASE WHEN e.payer_user IS NULL THEN 'club_bank_send' ELSE 'agent_send' END,e.club_id,
    CASE WHEN p_kind='union' THEN p_id END,'Weekly rakeback funding through the recorded hierarchy (week ending '||to_char(p_to AT TIME ZONE 'America/Chicago','Mon DD')||')',k,
    jsonb_build_object('cascade','rakeback-funding-v1','route',e.route,'run_id',p_run,'accounting_scope_kind',p_kind,'accounting_scope_id',p_id,'period_start',p_from,'period_end',p_to,
      'week_start',d_from,'pass_through',e.payer_user IS NOT NULL,'paid_to','agent_wallet'),payer_before,payer_after,payee_before,payee_after) RETURNING id INTO ledger_id;
  SELECT count(*) INTO receipts FROM public.settlement_invoices i WHERE i.source_ledger_id=ledger_id AND i.status='paid'
   AND i.chips_transferred AND i.message_sent AND i.net_amount=e.amount AND i.gross_amount=e.amount AND i.deductions=0;
  IF receipts<>1 THEN RAISE EXCEPTION 'rakeback_cascade_receipt_incomplete: club % payer % payee % amount % has % receipts',e.club_id,COALESCE(e.payer_user::text,'club bank'),e.payee_user,e.amount,receipts USING ERRCODE='23514'; END IF;
  sent:=sent||jsonb_build_array(ledger_id);
 END LOOP;
 PERFORM set_config('app.ledger_autoskip_clubs',COALESCE(club_skip,''),true);PERFORM set_config('app.ledger_autoskip_agents',COALESCE(agent_skip,''),true);
 RETURN jsonb_build_object('version','rakeback-funding-v1','week_start',d_from,'run_id',p_run,'ledger_ids',sent,
  'skipped_deleted_uplines',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',s.club_id,'user_id',s.user_id) ORDER BY s.club_id,s.user_id) FROM pg_temp._rcf_skipped s),'[]'::jsonb),
  'edges',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',x.club_id,'payer_user_id',x.payer_user,'payee_user_id',x.payee_user,'amount',x.amount,'route',x.route,'tier',x.sort_order,'state',x.state,
     'key',smarter_private.rakeback_cascade_key(x.club_id,d_from,x.payer_user,x.payee_user)) ORDER BY x.club_id,x.sort_order,x.payer_user NULLS FIRST,x.payee_user) FROM pg_temp._rcf_edges x),'[]'::jsonb),
  'nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',n.club_id,'user_id',n.user_id,'tier',n.sort_order,
     'inflow',(SELECT COALESCE(sum(x.amount),0) FROM pg_temp._rcf_edges x WHERE x.club_id=n.club_id AND x.payee_user=n.user_id),
     'to_children',(SELECT COALESCE(sum(x.amount),0) FROM pg_temp._rcf_edges x WHERE x.club_id=n.club_id AND x.payer_user=n.user_id),
     'players_need',(SELECT COALESCE(sum(l.need),0) FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.club_id=n.club_id AND((l.route='agent' AND l.payer_user=n.user_id) OR(l.route='owner' AND c.owner_id=n.user_id))),
     'players_owed',(SELECT COALESCE(sum(l.owed),0) FROM pg_temp._rcf_legs l JOIN pg_temp._rcf_certs c ON c.calc_id=l.calc_id WHERE l.club_id=n.club_id AND((l.route='agent' AND l.payer_user=n.user_id) OR(l.route='owner' AND c.owner_id=n.user_id))),
     'covered_by_own_commission',(SELECT COALESCE(sum(l.covered),0) FROM pg_temp._rcf_legs l WHERE l.club_id=n.club_id AND l.route='agent' AND l.payer_user=n.user_id))
     ORDER BY n.club_id,n.sort_order,n.user_id) FROM pg_temp._rcf_nodes n),'[]'::jsonb),
  'clubs',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',x.club_id,'received_for_week',x.received,'commission_from_bank',x.commission,'funding_from_bank',x.cascade,
     'funding_sent_now',x.cascade_unsent,'players_paid_by_bank',x.direct,'bank_before',x.bank) ORDER BY x.club_id) FROM pg_temp._rcf_clubs x),'[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_key(uuid,date,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_owner_upline(bigint,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_owner_route(bigint,uuid,uuid,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION smarter_private.rakeback_cascade_owner_leg_paid(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch_wallet_validator$
DECLARE src text:=pg_get_functiondef('smarter_private.rakeback_wallet_payout_complete(uuid,bigint)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '0f5fbe00efb06f9a49dcfae37d5830cc' THEN RAISE EXCEPTION 'rakeback_cascade_wallet_validator_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$ CROSS JOIN LATERAL(SELECT CASE WHEN g.payer_kind='club'OR g.payer_user IS NULL OR(l.from_type='club_treasury'AND l.metadata->>'owner_share_payer'=g.payer_user::text)THEN'club_treasury'ELSE'agent_wallet'END kind)funded$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_wallet_validator_anchor_0_changed';END IF;
 src:=replace(src,$o$ CROSS JOIN LATERAL(SELECT CASE WHEN g.payer_kind='club'OR g.payer_user IS NULL OR(l.from_type='club_treasury'AND l.metadata->>'owner_share_payer'=g.payer_user::text)THEN'club_treasury'ELSE'agent_wallet'END kind)funded$o$,$n$ CROSS JOIN LATERAL(SELECT coalesce(l.metadata->>'cascade_route'='owner_wallet'AND smarter_private.rakeback_cascade_owner_leg_paid(l.id,c.club_id,g.payer_kind,g.payer_user),false) ok)routed
 CROSS JOIN LATERAL(SELECT CASE WHEN routed.ok THEN'agent_wallet'WHEN g.payer_kind='club'OR g.payer_user IS NULL OR(l.from_type='club_treasury'AND l.metadata->>'owner_share_payer'=g.payer_user::text)THEN'club_treasury'ELSE'agent_wallet'END kind)funded$n$);
 IF cardinality(string_to_array(src,$o$l.from_entity_id IS DISTINCT FROM CASE WHEN funded.kind='club_treasury'THEN c.club_id ELSE g.payer_user END$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_wallet_validator_anchor_1_changed';END IF;
 src:=replace(src,$o$l.from_entity_id IS DISTINCT FROM CASE WHEN funded.kind='club_treasury'THEN c.club_id ELSE g.payer_user END$o$,$n$l.from_entity_id IS DISTINCT FROM CASE WHEN routed.ok THEN(l.metadata->>'cascade_owner')::uuid WHEN funded.kind='club_treasury'THEN c.club_id ELSE g.payer_user END$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.rakeback_wallet_payout_complete(uuid,bigint)'::regprocedure)) IS DISTINCT FROM 'c2b4cfdbc811adfae751d47fd5b298e6' THEN RAISE EXCEPTION 'rakeback_cascade_wallet_validator_postimage_changed';END IF;
END $patch_wallet_validator$;
DO $patch_split_validator$
DECLARE src text:=pg_get_functiondef('smarter_private.split_rakeback_payout_complete(uuid,bigint)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '516cd5a271fd21f4b2fe6f98e503dc75' THEN RAISE EXCEPTION 'rakeback_cascade_split_validator_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$  OR NOT COALESCE(CASE WHEN g.payer_kind='club' THEN l.from_type='club_treasury' AND l.from_entity_id=g.payer_entity$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_split_validator_anchor_0_changed';END IF;
 src:=replace(src,$o$  OR NOT COALESCE(CASE WHEN g.payer_kind='club' THEN l.from_type='club_treasury' AND l.from_entity_id=g.payer_entity$o$,$n$  OR NOT COALESCE(CASE WHEN coalesce(l.metadata->>'cascade_route'='owner_wallet'AND smarter_private.rakeback_cascade_owner_leg_paid(l.id,c.club_id,g.payer_kind,g.payer_user),false) THEN true
    WHEN g.payer_kind='club' THEN l.from_type='club_treasury' AND l.from_entity_id=g.payer_entity$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('smarter_private.split_rakeback_payout_complete(uuid,bigint)'::regprocedure)) IS DISTINCT FROM '47519877eefe45ac6ab39f6519bfb0e8' THEN RAISE EXCEPTION 'rakeback_cascade_split_validator_postimage_changed';END IF;
END $patch_split_validator$;
DO $patch_round3$
DECLARE src text:=pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
BEGIN
 IF md5(src) IS DISTINCT FROM '21409a0d24523597e10b5da44c252840' THEN RAISE EXCEPTION 'rakeback_cascade_round3_preimage_changed';END IF;
 IF cardinality(string_to_array(src,$o$typed_wallet boolean,PRIMARY KEY(period_id,payer_kind,payer_entity,destination_kind)) ON COMMIT DROP;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_0_changed';END IF;
 src:=replace(src,$o$typed_wallet boolean,PRIMARY KEY(period_id,payer_kind,payer_entity,destination_kind)) ON COMMIT DROP;$o$,$n$typed_wallet boolean,wallet_user uuid,cascade_key text,PRIMARY KEY(period_id,payer_kind,payer_entity,destination_kind)) ON COMMIT DROP;$n$);
 IF cardinality(string_to_array(src,$o$  CASE WHEN fp.payer_kind='club' OR fp.payer_user IS NULL OR fp.payer_user=owner_club.owner_id THEN 'club_treasury' ELSE 'agent_wallet' END,fp.destination_kind,EXISTS(SELECT FROM public.accounting_rakeback_wallet_contracts wc WHERE wc.calculation_id=i.certificate_id)
 FROM pg_temp._routed_player_todo i JOIN public.clubs owner_club ON owner_club.id=i.club_id
 CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(i.certificate_id)fp;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_1_changed';END IF;
 src:=replace(src,$o$  CASE WHEN fp.payer_kind='club' OR fp.payer_user IS NULL OR fp.payer_user=owner_club.owner_id THEN 'club_treasury' ELSE 'agent_wallet' END,fp.destination_kind,EXISTS(SELECT FROM public.accounting_rakeback_wallet_contracts wc WHERE wc.calculation_id=i.certificate_id)
 FROM pg_temp._routed_player_todo i JOIN public.clubs owner_club ON owner_club.id=i.club_id
 CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(i.certificate_id)fp;$o$,$n$  CASE WHEN fp.payer_kind='club' OR fp.payer_user IS NULL OR fp.payer_user=owner_club.owner_id THEN CASE WHEN cascade.key IS NOT NULL THEN 'agent_wallet' ELSE 'club_treasury' END ELSE 'agent_wallet' END,fp.destination_kind,EXISTS(SELECT FROM public.accounting_rakeback_wallet_contracts wc WHERE wc.calculation_id=i.certificate_id),
  CASE WHEN fp.payer_kind='club' OR fp.payer_user IS NULL OR fp.payer_user=owner_club.owner_id THEN CASE WHEN cascade.key IS NOT NULL THEN owner_club.owner_id END ELSE fp.payer_user END,cascade.key
 FROM pg_temp._routed_player_todo i JOIN public.clubs owner_club ON owner_club.id=i.club_id
 CROSS JOIN LATERAL smarter_private.rakeback_certificate_wallets(i.certificate_id)fp
 -- OWNER UPLINE ROUTE (20261109): a share recorded for the club owner as upline
 -- is paid from the owner's agent wallet when, and only when, this week's
 -- funding cascade put exactly that money there. Otherwise nothing changes.
 LEFT JOIN LATERAL(SELECT smarter_private.rakeback_cascade_owner_route(i.certificate_id,i.club_id,owner_club.owner_id,fp.payer_user,from_date) AS key
  WHERE fp.owed>0 AND fp.destination_kind='player_wallet' AND(fp.payer_kind='club' OR fp.payer_user IS NULL OR fp.payer_user=owner_club.owner_id))cascade ON true;$n$);
 IF cardinality(string_to_array(src,$o$FROM(SELECT club_id,payer_user user_id,-owed delta FROM pg_temp._routed_player_funding WHERE funded_from='agent_wallet' UNION ALL$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_2_changed';END IF;
 src:=replace(src,$o$FROM(SELECT club_id,payer_user user_id,-owed delta FROM pg_temp._routed_player_funding WHERE funded_from='agent_wallet' UNION ALL$o$,$n$FROM(SELECT club_id,wallet_user user_id,-owed delta FROM pg_temp._routed_player_funding WHERE funded_from='agent_wallet' UNION ALL$n$);
 IF cardinality(string_to_array(src,$o$FROM(SELECT club_id,payer_user,sum(owed) owed FROM pg_temp._routed_player_funding WHERE funded_from='agent_wallet' GROUP BY club_id,payer_user) x$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_3_changed';END IF;
 src:=replace(src,$o$FROM(SELECT club_id,payer_user,sum(owed) owed FROM pg_temp._routed_player_funding WHERE funded_from='agent_wallet' GROUP BY club_id,payer_user) x$o$,$n$FROM(SELECT club_id,wallet_user payer_user,sum(owed) owed FROM pg_temp._routed_player_funding WHERE funded_from='agent_wallet' GROUP BY club_id,wallet_user) x$n$);
 IF cardinality(string_to_array(src,$o$    SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.payer_user;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_4_changed';END IF;
 src:=replace(src,$o$    SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.payer_user;$o$,$n$    SELECT agent_wallet_balance INTO payer_before FROM public.agents WHERE club_id=r.club_id AND user_id=g.wallet_user;$n$);
 IF cardinality(string_to_array(src,$o$WHERE club_id=r.club_id AND user_id=g.payer_user AND agent_wallet_balance>=amount RETURNING agent_wallet_balance INTO payer_after;$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_5_changed';END IF;
 src:=replace(src,$o$WHERE club_id=r.club_id AND user_id=g.payer_user AND agent_wallet_balance>=amount RETURNING agent_wallet_balance INTO payer_after;$o$,$n$WHERE club_id=r.club_id AND user_id=g.wallet_user AND agent_wallet_balance>=amount RETURNING agent_wallet_balance INTO payer_after;$n$);
 IF cardinality(string_to_array(src,$o$     CASE WHEN g.funded_from='club_treasury' THEN r.club_id ELSE g.payer_user END,g.destination_kind,r.user_id,amount,'rakeback'$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_6_changed';END IF;
 src:=replace(src,$o$     CASE WHEN g.funded_from='club_treasury' THEN r.club_id ELSE g.payer_user END,g.destination_kind,r.user_id,amount,'rakeback'$o$,$n$     CASE WHEN g.funded_from='club_treasury' THEN r.club_id ELSE g.wallet_user END,g.destination_kind,r.user_id,amount,'rakeback'$n$);
 IF cardinality(string_to_array(src,$o$||CASE WHEN g.typed_wallet THEN jsonb_build_object('wallet_destination_version','own-agent-v1','destination_kind',g.destination_kind) ELSE '{}'::jsonb END,
      payer_before,payer_after,player_before,player_after)$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_7_changed';END IF;
 src:=replace(src,$o$||CASE WHEN g.typed_wallet THEN jsonb_build_object('wallet_destination_version','own-agent-v1','destination_kind',g.destination_kind) ELSE '{}'::jsonb END,
      payer_before,payer_after,player_before,player_after)$o$,$n$||CASE WHEN g.typed_wallet THEN jsonb_build_object('wallet_destination_version','own-agent-v1','destination_kind',g.destination_kind) ELSE '{}'::jsonb END
       ||CASE WHEN g.cascade_key IS NOT NULL THEN jsonb_build_object('cascade_route','owner_wallet','cascade_owner',g.wallet_user,'cascade_funding_key',g.cascade_key) ELSE '{}'::jsonb END,
      payer_before,payer_after,player_before,player_after)$n$);
 IF cardinality(string_to_array(src,$o$(SELECT f.club_id,f.payer_user user_id,-f.owed delta FROM pg_temp._routed_player_funding f JOIN pg_temp._routed_player_now n ON n.period_id=f.period_id WHERE f.funded_from='agent_wallet' UNION ALL$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_8_changed';END IF;
 src:=replace(src,$o$(SELECT f.club_id,f.payer_user user_id,-f.owed delta FROM pg_temp._routed_player_funding f JOIN pg_temp._routed_player_now n ON n.period_id=f.period_id WHERE f.funded_from='agent_wallet' UNION ALL$o$,$n$(SELECT f.club_id,f.wallet_user user_id,-f.owed delta FROM pg_temp._routed_player_funding f JOIN pg_temp._routed_player_now n ON n.period_id=f.period_id WHERE f.funded_from='agent_wallet' UNION ALL$n$);
 IF cardinality(string_to_array(src,$o$((f.funded_from='agent_wallet' AND f.payer_user=a.user_id) OR$o$)) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'rakeback_cascade_round3_anchor_9_changed';END IF;
 src:=replace(src,$o$((f.funded_from='agent_wallet' AND f.payer_user=a.user_id) OR$o$,$n$((f.funded_from='agent_wallet' AND f.wallet_user=a.user_id) OR$n$);
 EXECUTE src;
 IF md5(pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'db6ba33eed8762b2534d349024e4219f' THEN RAISE EXCEPTION 'rakeback_cascade_round3_postimage_changed';END IF;
END $patch_round3$;
DO $post$BEGIN IF md5(pg_get_functiondef('smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)'::regprocedure)) IS DISTINCT FROM 'dddb67b5024a01bb4f2dadc0ba1009f2' THEN RAISE EXCEPTION 'rakeback_cascade_fund_postimage_changed';END IF;END $post$;
COMMIT;
