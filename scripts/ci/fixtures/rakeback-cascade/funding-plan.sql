-- CANDIDATE, NOT INSTALLED. The weekly cascade funding plan as one pure
-- computation: who the club bank funds, what each parent passes to each child,
-- what each agent pays its players and what it retains, each chip counted once.
-- It reads nothing and writes nothing outside its own temporary tables.
--
-- Rate basis (chip standard P4, fn_accounting_earning_contract): an agent's own
-- amount on a source is its rate on the rake remaining after the tiers below
-- it. Own amounts are disjoint per agent. The direct agent pays its players
-- out of its own amount.
--
-- Inputs (all amounts whole cents):
--   p_nodes        [{club_id,user_id,parent_user_id|null,own_amount}]
--   p_obligations  [{club_id,payer_user_id|null,player_id,owed,covered}]
--                  payer null = an unassigned player paid by the club bank;
--                  covered = the payer's own amounts on that player's sources.
--   p_clubs        [{club_id,distributable}] what the club actually received
--                  for the week after the union kept its share.
CREATE OR REPLACE FUNCTION smarter_private.rakeback_cascade_funding_plan(p_nodes jsonb, p_obligations jsonb, p_clubs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE result jsonb; step int:=0; progress int;
BEGIN
 IF jsonb_typeof(p_nodes) IS DISTINCT FROM 'array' OR jsonb_typeof(p_obligations) IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_clubs) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'cascade_plan_input_invalid' USING ERRCODE='22023'; END IF;
 CREATE TEMP TABLE IF NOT EXISTS _cfp_nodes(club_id uuid,user_id uuid,parent_user_id uuid,own numeric,pass numeric DEFAULT 0,owed numeric DEFAULT 0,
  covered numeric DEFAULT 0,depth int,PRIMARY KEY(club_id,user_id)) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _cfp_obl(club_id uuid,payer_user_id uuid,player_id uuid,owed numeric,covered numeric) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _cfp_clubs(club_id uuid PRIMARY KEY,distributable numeric) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS _cfp_closure(club_id uuid,ancestor uuid,descendant uuid,PRIMARY KEY(club_id,ancestor,descendant)) ON COMMIT DROP;
 TRUNCATE pg_temp._cfp_nodes; TRUNCATE pg_temp._cfp_obl; TRUNCATE pg_temp._cfp_clubs; TRUNCATE pg_temp._cfp_closure;
 BEGIN
  INSERT INTO pg_temp._cfp_nodes(club_id,user_id,parent_user_id,own)
   SELECT (n->>'club_id')::uuid,(n->>'user_id')::uuid,NULLIF(n->>'parent_user_id','')::uuid,(n->>'own_amount')::numeric FROM jsonb_array_elements(p_nodes) n;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'cascade_duplicate_recipient' USING ERRCODE='23514';
 END;
 INSERT INTO pg_temp._cfp_obl SELECT (o->>'club_id')::uuid,NULLIF(o->>'payer_user_id','')::uuid,(o->>'player_id')::uuid,(o->>'owed')::numeric,(o->>'covered')::numeric
  FROM jsonb_array_elements(p_obligations) o;
 BEGIN
  INSERT INTO pg_temp._cfp_clubs SELECT (c->>'club_id')::uuid,(c->>'distributable')::numeric FROM jsonb_array_elements(p_clubs) c;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'cascade_duplicate_club' USING ERRCODE='23514';
 END;
 IF EXISTS(SELECT 1 FROM pg_temp._cfp_nodes WHERE club_id IS NULL OR user_id IS NULL OR own IS NULL OR own<0 OR own<>round(own,2) OR own::text IN('NaN','Infinity','-Infinity') OR parent_user_id=user_id)
  OR EXISTS(SELECT 1 FROM pg_temp._cfp_obl WHERE club_id IS NULL OR player_id IS NULL OR owed IS NULL OR covered IS NULL OR owed<0 OR covered<0
    OR owed<>round(owed,2) OR covered<>round(covered,2) OR owed::text IN('NaN','Infinity','-Infinity') OR covered::text IN('NaN','Infinity','-Infinity')
    OR payer_user_id=player_id OR (payer_user_id IS NULL AND covered<>0))
  OR EXISTS(SELECT 1 FROM pg_temp._cfp_clubs WHERE club_id IS NULL OR distributable IS NULL OR distributable<0 OR distributable<>round(distributable,2) OR distributable::text IN('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'cascade_plan_amount_invalid' USING ERRCODE='23514'; END IF;
 -- A payer with no commission tier of its own (an owner upline, a zero-rate
 -- agent that was never a tier) is still a wallet the money passes through.
 INSERT INTO pg_temp._cfp_nodes(club_id,user_id,parent_user_id,own)
  SELECT DISTINCT o.club_id,o.payer_user_id,NULL::uuid,0 FROM pg_temp._cfp_obl o WHERE o.payer_user_id IS NOT NULL
  ON CONFLICT DO NOTHING;
 IF EXISTS(SELECT 1 FROM pg_temp._cfp_nodes n WHERE n.parent_user_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM pg_temp._cfp_nodes p WHERE p.club_id=n.club_id AND p.user_id=n.parent_user_id))
 THEN RAISE EXCEPTION 'cascade_parent_outside_club_or_missing' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT club_id FROM pg_temp._cfp_nodes UNION SELECT club_id FROM pg_temp._cfp_obl) x
   WHERE NOT EXISTS(SELECT 1 FROM pg_temp._cfp_clubs c WHERE c.club_id=x.club_id))
 THEN RAISE EXCEPTION 'cascade_club_distributable_missing' USING ERRCODE='23514'; END IF;
 -- Depth from the club downward; a node never reached is on a cycle.
 UPDATE pg_temp._cfp_nodes SET depth=1 WHERE parent_user_id IS NULL;
 LOOP
  step:=step+1;
  UPDATE pg_temp._cfp_nodes n SET depth=p.depth+1 FROM pg_temp._cfp_nodes p
   WHERE n.depth IS NULL AND p.club_id=n.club_id AND p.user_id=n.parent_user_id AND p.depth=step;
  GET DIAGNOSTICS progress=ROW_COUNT;
  EXIT WHEN progress=0;
  IF step>=64 THEN RAISE EXCEPTION 'cascade_hierarchy_too_deep' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_temp._cfp_nodes WHERE depth IS NULL) THEN RAISE EXCEPTION 'cascade_hierarchy_cycle' USING ERRCODE='23514'; END IF;
 -- Pass-through is counted per player-week and never netted against another
 -- player's surplus: an agent keeps its approved margin on a covered player.
 UPDATE pg_temp._cfp_nodes n SET pass=x.pass,owed=x.owed,covered=x.covered FROM (
  SELECT club_id,payer_user_id,sum(greatest(owed-covered,0)) pass,sum(owed) owed,sum(covered) covered FROM pg_temp._cfp_obl WHERE payer_user_id IS NOT NULL GROUP BY 1,2) x
  WHERE x.club_id=n.club_id AND x.payer_user_id=n.user_id;
 IF EXISTS(SELECT 1 FROM pg_temp._cfp_nodes WHERE covered>own) THEN RAISE EXCEPTION 'cascade_covered_exceeds_own_commission' USING ERRCODE='23514'; END IF;
 INSERT INTO pg_temp._cfp_closure
  WITH RECURSIVE up AS (
   SELECT club_id,user_id AS ancestor,user_id AS descendant,parent_user_id FROM pg_temp._cfp_nodes
   UNION ALL
   SELECT u.club_id,p.user_id,u.descendant,p.parent_user_id FROM up u JOIN pg_temp._cfp_nodes p ON p.club_id=u.club_id AND p.user_id=u.parent_user_id)
  SELECT club_id,ancestor,descendant FROM up;
 WITH flow AS (
  SELECT n.club_id,n.user_id,n.parent_user_id,n.depth,n.own,n.pass,n.owed,
   (SELECT sum(d.own) FROM pg_temp._cfp_closure c JOIN pg_temp._cfp_nodes d ON d.club_id=c.club_id AND d.user_id=c.descendant WHERE c.club_id=n.club_id AND c.ancestor=n.user_id) sub_own,
   (SELECT sum(d.pass) FROM pg_temp._cfp_closure c JOIN pg_temp._cfp_nodes d ON d.club_id=c.club_id AND d.user_id=c.descendant WHERE c.club_id=n.club_id AND c.ancestor=n.user_id) sub_pass
  FROM pg_temp._cfp_nodes n),
 node_out AS (
  SELECT f.*,f.sub_own+f.sub_pass AS inflow,
   COALESCE((SELECT sum(k.sub_own+k.sub_pass) FROM flow k WHERE k.club_id=f.club_id AND k.parent_user_id=f.user_id),0) AS to_children
  FROM flow f),
 club_out AS (
  SELECT c.club_id,c.distributable,
   COALESCE((SELECT sum(n.inflow) FROM node_out n WHERE n.club_id=c.club_id AND n.parent_user_id IS NULL),0) agent_outflow,
   COALESCE((SELECT sum(o.owed) FROM pg_temp._cfp_obl o WHERE o.club_id=c.club_id AND o.payer_user_id IS NULL),0) direct_player_outflow,
   COALESCE((SELECT sum(o.owed) FROM pg_temp._cfp_obl o WHERE o.club_id=c.club_id),0) players_total,
   COALESCE((SELECT sum(n.own+n.pass-n.owed) FROM node_out n WHERE n.club_id=c.club_id),0) retained_total
  FROM pg_temp._cfp_clubs c)
 SELECT jsonb_build_object(
  'edges',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',club_id,'payer_user_id',parent_user_id,'payee_user_id',user_id,'depth',depth,
     'commission',sub_own,'passthrough',sub_pass,'amount',inflow) ORDER BY depth,club_id,parent_user_id NULLS FIRST,user_id) FROM node_out WHERE inflow>0),'[]'::jsonb),
  'nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',club_id,'user_id',user_id,'parent_user_id',parent_user_id,'depth',depth,'own',own,'passthrough',pass,
     'owed_players',owed,'inflow',inflow,'to_children',to_children,'outflow',to_children+owed,'retained',inflow-to_children-owed) ORDER BY club_id,depth,user_id) FROM node_out),'[]'::jsonb),
  'clubs',COALESCE((SELECT jsonb_agg(jsonb_build_object('club_id',club_id,'distributable',distributable,'agent_outflow',agent_outflow,'direct_player_outflow',direct_player_outflow,
     'total_outflow',agent_outflow+direct_player_outflow,'players_total',players_total,'retained_total',retained_total,
     'from_reserves',greatest(agent_outflow+direct_player_outflow-distributable,0),'affordable',agent_outflow+direct_player_outflow<=distributable,
     'club_keeps',distributable-agent_outflow-direct_player_outflow) ORDER BY club_id) FROM club_out),'[]'::jsonb)) INTO result;
 -- Conservation: every node keeps exactly own + pass - owed and never less
 -- than zero; every club pays out exactly what agents keep plus what players get.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'nodes') n WHERE (n->>'retained')::numeric<0
    OR (n->>'retained')::numeric IS DISTINCT FROM (n->>'own')::numeric+(n->>'passthrough')::numeric-(n->>'owed_players')::numeric)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'clubs') c
    WHERE (c->>'total_outflow')::numeric IS DISTINCT FROM (c->>'players_total')::numeric+(c->>'retained_total')::numeric)
 THEN RAISE EXCEPTION 'cascade_plan_does_not_conserve' USING ERRCODE='23514'; END IF;
 RETURN result;
END $function$;
