CREATE OR REPLACE FUNCTION public.fn_gto_v31_complete_public_state(p_node jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
 lp jsonb:=p_node->'line_proof'; c jsonb:=p_node->'node_context';
 state jsonb:=p_node->'complete_public_state';
 bb numeric; root numeric; stack numeric; actor integer:=0; stage integer:=0;
 pot numeric; bet numeric:=0; increment numeric; old numeric; remaining numeric;
 target numeric; paid numeric; raised numeric; family text; token text;
 contribution numeric[]:=ARRAY[0,0]::numeric[]; spent numeric[]:=ARRAY[0,0]::numeric[];
 positions text[]; board text; history jsonb:='[]'; derived jsonb;
BEGIN
 IF NOT public.fn_gto_v31_json_safe_integer(lp->'chips_per_bb',1,9007199254740991)
 OR NOT public.fn_gto_v31_json_safe_integer(lp->'root_pot_chips',1,9007199254740991)
 OR NOT public.fn_gto_v31_json_safe_integer(lp->'effective_stack_chips',1,9007199254740991)
 OR NOT public.fn_gto_v31_physical_positions_valid(p_node) THEN RETURN NULL; END IF;
 bb:=(lp->>'chips_per_bb')::numeric; root:=(lp->>'root_pot_chips')::numeric;
 stack:=(lp->>'effective_stack_chips')::numeric; pot:=root; increment:=bb;
 derived:=public.fn_gto_v31_node_line_proof(p_node->>'node',
   (lp->>'preflop_aggressor_solver_player')::integer,root,stack);
 IF derived IS NULL THEN RETURN NULL; END IF;
 positions:=CASE (lp->>'hero_solver_player')::integer WHEN 0
   THEN ARRAY[c->>'hero_position',c->>'opponent_position']
   ELSE ARRAY[c->>'opponent_position',c->>'hero_position'] END;
 board:=left(c->>'board',6);
 FOREACH token IN ARRAY (string_to_array(p_node->>'node',':'))[3:] LOOP
  IF token ~ '^[2-9TJQKA][cdhs]$' THEN
   stage:=stage+1; actor:=0; bet:=0; increment:=bb; contribution:=ARRAY[0,0]::numeric[];
   board:=board||token; CONTINUE;
  END IF;
  old:=contribution[actor+1]; remaining:=stack-spent[actor+1];
  IF token='c' THEN
   family:=CASE WHEN bet>old THEN 'call' ELSE 'check' END; target:=bet;
  ELSIF token ~ '^b[1-9][0-9]*$' THEN
   target:=substring(token FROM 2)::numeric;
   IF target<=bet OR target>old+remaining OR
      (target<bet+increment AND target<>old+remaining) THEN RETURN NULL; END IF;
   family:=CASE WHEN target=old+remaining THEN 'all_in' WHEN bet>0 THEN 'raise' ELSE 'bet' END;
   raised:=target-bet; IF raised>=increment THEN increment:=raised; END IF; bet:=target;
  ELSE RETURN NULL; END IF;
  paid:=target-old; IF paid<0 OR paid>remaining THEN RETURN NULL; END IF;
  contribution[actor+1]:=target; spent[actor+1]:=spent[actor+1]+paid; pot:=pot+paid;
  history:=history||jsonb_build_array(jsonb_build_object('street',(ARRAY['flop','turn','river'])[stage+1],
   'solver_player',actor,'position',positions[actor+1],'family',family,'target_chips',target));
  actor:=1-actor;
 END LOOP;
 IF stage NOT BETWEEN 0 AND 2 OR board IS DISTINCT FROM c->>'board'
 OR actor IS DISTINCT FROM (lp->>'hero_solver_player')::integer
 OR actor IS DISTINCT FROM (derived->>'current_actor_solver_player')::integer
 OR pot>9007199254740991 OR bet+increment>9007199254740991 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('schema','smarter-poker.pio-complete-public-state.v1',
  'stack_semantics','solver-effective-behind-at-root','utility',state->'utility',
  'node',p_node->>'node','board',board,'root_board',left(board,6),
  'street',(ARRAY['flop','turn','river'])[stage+1],'acting_solver_player',actor,
  'table_size',c->'table_size','positions',to_jsonb(positions),
  'chips_per_bb',bb,'root_pot_chips',root,'root_behind_chips',jsonb_build_array(stack,stack),
  'pot_chips',pot,'contributions_chips',to_jsonb(contribution),'total_spent_chips',to_jsonb(spent),
  'remaining_chips',jsonb_build_array(stack-spent[1],stack-spent[2]),
  'current_target_chips',bet,'to_call_chips',bet-contribution[actor+1],
  'last_full_raise_increment_chips',increment,'minimum_raise_target_chips',bet+increment,
  'public_history',history);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$
;
