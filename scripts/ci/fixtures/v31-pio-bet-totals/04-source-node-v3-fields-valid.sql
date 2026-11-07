CREATE OR REPLACE FUNCTION public.fn_gto_v31_source_node_v3_fields_valid(p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_context jsonb := p_node->'node_context';
  v_line_proof jsonb := p_node->'line_proof';
  v_specs jsonb := p_node->'action_specs';
  v_frequencies jsonb := p_node->'frequencies';
  v_action_evs jsonb := p_node->'action_evs_bb';
  v_policy_evs jsonb := p_node->'policy_evs_bb';
  v_matchups jsonb := p_node->'matchups';
  v_action record;
  v_family text;
  v_unit text;
  v_size numeric;
  v_role text := v_context->>'node_role';
  v_facing text := v_context->>'facing_kind';
  v_bucket text := v_context->>'facing_size_bucket';
  v_has_check boolean := false;
  v_has_fold boolean := false;
  v_has_call boolean := false;
  v_has_bet boolean := false;
  v_table_size integer;
  v_allowed_positions text[];
  v_board text := v_context->>'board';
  v_cards text[] := ARRAY[]::text[];
  v_card text;
  v_i integer;
  v_weight numeric;
  v_frequency numeric;
  v_frequency_sum numeric;
  v_action_ev numeric;
  v_expected_ev numeric;
  v_action_keys text[];v_action_key text;v_action_index integer;
  v_weights numeric[];v_policies numeric[];v_decoded numeric[];
  v_frequency_values numeric[]:=ARRAY[]::numeric[];
  v_ev_values numeric[]:=ARRAY[]::numeric[];v_types_ok boolean;v_blocked boolean[];v_board_ids integer[];
  v_policy_ev numeric;
  v_derived_line jsonb;
  v_line_role text;
  v_hero_solver_player integer;
  v_preflop_aggressor integer;
  v_node_cards text[];
  v_expected_node_cards text[]:=ARRAY[]::text[];
  v_facing_target numeric;
  v_facing_actor_total numeric;
  v_root_pot_chips numeric;
  v_effective_stack_chips numeric;
  v_chips_per_bb numeric;
  v_last_token text;
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node)<>'object'
     OR NOT public.fn_gto_v31_source_node_scalar_types_valid(p_node)
     OR NOT public.fn_gto_v31_physical_positions_valid(p_node)
     OR NOT public.fn_gto_v31_action_specs_valid(v_specs)
     OR (SELECT count(*) FROM jsonb_object_keys(p_node))<>12
     OR NOT (p_node ?& ARRAY['schema','node','node_checksum','node_context','line_proof','action_specs',
       'frequencies','policy_evs_bb','action_evs_bb','matchups',
       'source_combo_order_checksum','range_bundle_checksum'])
     OR p_node->>'schema' IS DISTINCT FROM 'smarter-poker.pio-policy.v3'
     OR COALESCE(p_node->>'node','') !~ '^r:[0-9]+(:[cf]|:b[1-9][0-9]*|:[2-9TJQKA][cdhs])*$'
     OR COALESCE(p_node->>'node_checksum','') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_node->>'source_combo_order_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_node->>'source_combo_order_checksum'=repeat('0',64)
     OR COALESCE(p_node->>'range_bundle_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_node->>'range_bundle_checksum'=repeat('0',64)
     OR jsonb_typeof(v_context)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_context))<>16
     OR NOT (v_context ?& ARRAY['street','game_family','objective','utility_context',
       'table_size','pot_type','hero_position','opponent_position','depth_bucket',
       'texture_class','node_role','facing_kind','facing_size_bucket','board',
       'facing_target_chips','facing_actor_total_chips'])
     OR COALESCE(v_board,'') !~ '^([2-9TJQKA][cdhs]){3,5}$'
     OR length(v_board) <> (CASE v_context->>'street'
       WHEN 'flop' THEN 6 WHEN 'turn' THEN 8 WHEN 'river' THEN 10 ELSE 0 END)
     OR COALESCE(v_context->>'game_family','') NOT IN ('cash','spin','tourney_ev','tourney_icm')
     OR COALESCE(v_context->>'objective','') NOT IN ('cash_ev','chip_ev','icm')
     OR COALESCE(v_context->>'utility_context','') NOT IN
       ('cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder')
     OR COALESCE(v_context->>'pot_type','') NOT IN ('limped','srp','3bet','4bet_plus')
     OR COALESCE((v_context->>'depth_bucket')::integer,0) NOT IN (10,20,40,80,150)
     OR COALESCE(v_context->>'texture_class','') !~ '^[ABML][mtr][pu][cd]$'
     OR v_context->>'texture_class' IS DISTINCT FROM public.fn_gto_texture_class_any(v_board)
     OR COALESCE(v_role,'') NOT IN ('open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in')
     OR jsonb_typeof(v_line_proof)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_line_proof))<>7
     OR NOT (v_line_proof ?& ARRAY['schema','manifest_checksum','hero_solver_player',
       'preflop_aggressor_solver_player','root_pot_chips','effective_stack_chips',
       'chips_per_bb'])
     OR v_line_proof->>'schema' IS DISTINCT FROM 'smarter-poker.pio-line-proof.v1'
     OR COALESCE(v_line_proof->>'manifest_checksum','') !~ '^[0-9a-f]{64}$'
     OR v_line_proof->>'manifest_checksum'=repeat('0',64)
     OR jsonb_typeof(v_line_proof->'hero_solver_player')<>'number'
     OR COALESCE((v_line_proof->>'hero_solver_player')::integer,-1) NOT IN (0,1)
     OR jsonb_typeof(v_line_proof->'preflop_aggressor_solver_player') NOT IN ('number','null')
     OR (jsonb_typeof(v_line_proof->'preflop_aggressor_solver_player')='number'
       AND (v_line_proof->>'preflop_aggressor_solver_player')::integer NOT IN (0,1))
     OR jsonb_typeof(v_line_proof->'root_pot_chips')<>'number'
     OR jsonb_typeof(v_line_proof->'effective_stack_chips')<>'number'
     OR jsonb_typeof(v_line_proof->'chips_per_bb')<>'number'
     OR jsonb_typeof(v_specs)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_specs))<2
     OR jsonb_typeof(v_frequencies)<>'object'
     OR jsonb_typeof(v_action_evs)<>'object'
     OR jsonb_typeof(v_policy_evs)<>'array' OR jsonb_array_length(v_policy_evs)<>1326
     OR jsonb_typeof(v_matchups)<>'array' OR jsonb_array_length(v_matchups)<>1326
     OR (SELECT count(*) FROM jsonb_object_keys(v_frequencies))<>(SELECT count(*) FROM jsonb_object_keys(v_specs))
     OR (SELECT count(*) FROM jsonb_object_keys(v_action_evs))<>(SELECT count(*) FROM jsonb_object_keys(v_specs)) THEN
    RETURN false;
  END IF;

  v_hero_solver_player:=(v_line_proof->>'hero_solver_player')::integer;
  IF jsonb_typeof(v_line_proof->'preflop_aggressor_solver_player')='number' THEN
    v_preflop_aggressor:=(v_line_proof->>'preflop_aggressor_solver_player')::integer;
  END IF;
  v_root_pot_chips:=(v_line_proof->>'root_pot_chips')::numeric;
  v_effective_stack_chips:=(v_line_proof->>'effective_stack_chips')::numeric;
  v_chips_per_bb:=(v_line_proof->>'chips_per_bb')::numeric;
  IF v_root_pot_chips<=0 OR v_effective_stack_chips<=0 OR v_chips_per_bb<=0
     OR v_root_pot_chips<>trunc(v_root_pot_chips)
     OR v_effective_stack_chips<>trunc(v_effective_stack_chips)
     OR v_chips_per_bb<>trunc(v_chips_per_bb)
     OR v_effective_stack_chips<>((v_context->>'depth_bucket')::numeric*v_chips_per_bb) THEN
    RETURN false;
  END IF;
  IF (v_context->>'pot_type'='limped') IS DISTINCT FROM (v_preflop_aggressor IS NULL) THEN
    RETURN false;
  END IF;

  FOR v_i IN 0..length(v_board)/2-1 LOOP
    v_card:=substr(v_board,v_i*2+1,2);
    IF v_card=ANY(v_cards) THEN RETURN false; END IF;
    v_cards:=array_append(v_cards,v_card);
  END LOOP;
  SELECT COALESCE(array_agg(token ORDER BY ordinal),'{}'::text[]) INTO v_node_cards
    FROM unnest(string_to_array(p_node->>'node',':')) WITH ORDINALITY part(token,ordinal)
   WHERE token~'^[2-9TJQKA][cdhs]$';
  IF length(v_board)/2>3 THEN
    FOR v_i IN 3..length(v_board)/2-1 LOOP
      v_expected_node_cards:=array_append(v_expected_node_cards,substr(v_board,v_i*2+1,2));
    END LOOP;
  END IF;
  IF v_node_cards IS DISTINCT FROM v_expected_node_cards THEN RETURN false; END IF;
  v_derived_line:=public.fn_gto_v31_node_line_proof(
    p_node->>'node',
    v_preflop_aggressor,
    v_root_pot_chips,
    v_effective_stack_chips
  );
  v_line_role:=v_derived_line->>'derived_node_role';
  IF v_derived_line IS NULL
     OR v_derived_line->>'street' IS DISTINCT FROM v_context->>'street'
     OR COALESCE((v_derived_line->>'current_actor_solver_player')::integer,-1)<>v_hero_solver_player
     OR v_line_role<>v_role
     OR v_derived_line->>'derived_facing_kind' IS DISTINCT FROM v_facing
     OR v_derived_line->>'derived_facing_size_bucket' IS DISTINCT FROM v_bucket
     OR v_derived_line->'facing_target_chips' IS DISTINCT FROM v_context->'facing_target_chips'
     OR v_derived_line->'facing_actor_total_chips' IS DISTINCT FROM v_context->'facing_actor_total_chips' THEN
    RETURN false;
  END IF;
  v_last_token := (string_to_array(p_node->>'node',':'))[
    array_length(string_to_array(p_node->>'node',':'),1)
  ];
  IF v_role IN ('open','cbet','probe','delayed_cbet','barrel') THEN
    IF v_context->'facing_target_chips' IS DISTINCT FROM 'null'::jsonb
       OR v_context->'facing_actor_total_chips' IS DISTINCT FROM 'null'::jsonb THEN
      RETURN false;
    END IF;
  ELSE
    IF v_last_token !~ '^b[1-9][0-9]*$'
       OR jsonb_typeof(v_context->'facing_target_chips')<>'number'
       OR jsonb_typeof(v_context->'facing_actor_total_chips')<>'number' THEN
      RETURN false;
    END IF;
    v_facing_target := (v_context->>'facing_target_chips')::numeric;
    v_facing_actor_total := (v_context->>'facing_actor_total_chips')::numeric;
    IF v_facing_target <= 0 OR v_facing_actor_total <= 0
       OR v_facing_target > v_facing_actor_total
       OR v_facing_target <> substring(v_last_token FROM 2)::numeric
       OR (v_role='all_in' AND v_facing_target<>v_facing_actor_total)
       OR (v_role<>'all_in' AND v_facing_target>=v_facing_actor_total) THEN
      RETURN false;
    END IF;
  END IF;
  v_table_size := (v_context->>'table_size')::integer;
  v_allowed_positions := CASE v_table_size
    WHEN 2 THEN ARRAY['SB','BB'] WHEN 3 THEN ARRAY['SB','BB','BTN']
    WHEN 4 THEN ARRAY['SB','BB','CO','BTN'] WHEN 5 THEN ARRAY['SB','BB','HJ','CO','BTN']
    WHEN 6 THEN ARRAY['SB','BB','UTG','HJ','CO','BTN']
    WHEN 7 THEN ARRAY['SB','BB','UTG','MP','HJ','CO','BTN']
    WHEN 8 THEN ARRAY['SB','BB','UTG','UTG1','MP','HJ','CO','BTN']
    WHEN 9 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','MP','HJ','CO','BTN']
    WHEN 10 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','UTG3','MP','HJ','CO','BTN']
    ELSE NULL END;
  IF v_allowed_positions IS NULL
     OR NOT (v_context->>'hero_position'=ANY(v_allowed_positions))
     OR NOT (v_context->>'opponent_position'=ANY(v_allowed_positions))
     OR v_context->>'hero_position'=v_context->>'opponent_position'
     OR NOT ((v_context->>'game_family'='cash' AND v_context->>'objective'='cash_ev' AND v_context->>'utility_context'='cash_ev')
       OR (v_context->>'game_family'='spin' AND v_context->>'objective'='chip_ev' AND v_context->>'utility_context'='chip_ev')
       OR (v_context->>'game_family'='spin' AND v_context->>'objective'='icm' AND v_context->>'utility_context'='spin_ladder')
       OR (v_context->>'game_family'='tourney_ev' AND v_context->>'objective'='chip_ev' AND v_context->>'utility_context'='chip_ev')
       OR (v_context->>'game_family'='tourney_icm' AND v_context->>'objective'='icm' AND
           v_context->>'utility_context' IN ('satellite','bubble','final_table','in_money','ladder'))) THEN
    RETURN false;
  END IF;
  IF (v_role IN ('open','cbet','probe','delayed_cbet','barrel') AND (v_facing<>'none' OR v_bucket<>'none'))
     OR (v_role='all_in' AND (v_facing<>'all_in' OR v_bucket<>'all_in'))
     OR (v_role='facing_bet' AND (v_facing<>'bet' OR v_bucket NOT IN ('small','mid','big')))
     OR (v_role IN ('facing_raise','check_raise','bet_raise') AND
         (v_facing<>'raise' OR v_bucket NOT IN ('small','mid','big'))) THEN RETURN false; END IF;

  FOR v_action IN SELECT key,value FROM jsonb_each(v_specs) LOOP
    IF NOT (v_frequencies?v_action.key) OR NOT (v_action_evs?v_action.key)
       OR jsonb_typeof(v_action.value)<>'object'
       OR jsonb_typeof(v_frequencies->v_action.key)<>'array'
       OR jsonb_array_length(v_frequencies->v_action.key)<>1326
       OR jsonb_typeof(v_action_evs->v_action.key)<>'array'
       OR jsonb_array_length(v_action_evs->v_action.key)<>1326 THEN RETURN false; END IF;
    v_family:=v_action.value->>'family'; v_unit:=v_action.value->>'size_unit';
    IF v_family NOT IN ('check','fold','call','bet','raise','all_in') THEN RETURN false; END IF;
    v_has_check:=v_has_check OR v_family='check'; v_has_fold:=v_has_fold OR v_family='fold';
    v_has_call:=v_has_call OR v_family='call'; v_has_bet:=v_has_bet OR v_family='bet';
    IF v_family IN ('check','fold','call') THEN
      IF v_unit IS DISTINCT FROM 'none' OR v_action.value->'size_value' IS DISTINCT FROM 'null'::jsonb
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM false THEN RETURN false; END IF;
    ELSIF v_family='all_in' THEN
      IF v_unit IS DISTINCT FROM 'all_in' OR v_action.value->'size_value' IS DISTINCT FROM 'null'::jsonb
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM true THEN RETURN false; END IF;
    ELSE
      v_size:=(v_action.value->>'size_value')::numeric;
      IF v_size<=0 OR v_size>20 OR COALESCE((v_action.value->>'all_in')::boolean,false)
         OR (v_family='bet' AND v_unit<>'pot_fraction')
         OR (v_family='raise' AND v_unit<>'pot_after_call_fraction') THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF v_role IN ('open','cbet','probe','delayed_cbet','barrel') THEN
    IF NOT v_has_check OR v_has_fold OR v_has_call THEN RETURN false; END IF;
  ELSIF v_role='all_in' THEN
    IF NOT v_has_fold OR NOT v_has_call OR v_has_check OR v_has_bet
       OR EXISTS (SELECT 1 FROM jsonb_each(v_specs) s WHERE s.value->>'family' NOT IN ('fold','call')) THEN RETURN false; END IF;
  ELSE
    IF NOT v_has_fold OR NOT v_has_call OR v_has_check OR v_has_bet THEN RETURN false; END IF;
  END IF;

  -- Decode each vector once; JSON numbers remain exact NUMERIC values.
  SELECT array_agg(key ORDER BY ordinality) INTO v_action_keys FROM jsonb_each(v_specs) WITH ORDINALITY;
  SELECT array_agg(CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::numeric END ORDER BY ordinality),
         bool_and(jsonb_typeof(value)='number') INTO v_weights,v_types_ok
    FROM jsonb_array_elements(v_matchups) WITH ORDINALITY;
  IF v_types_ok IS NOT TRUE THEN RETURN false; END IF;
  SELECT array_agg(CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::numeric END ORDER BY ordinality),
         bool_and(jsonb_typeof(value) IN ('number','null')) INTO v_policies,v_types_ok
    FROM jsonb_array_elements(v_policy_evs) WITH ORDINALITY;
  IF v_types_ok IS NOT TRUE THEN RETURN false; END IF;
  FOREACH v_action_key IN ARRAY v_action_keys LOOP
    SELECT array_agg(CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::numeric END ORDER BY ordinality),
           bool_and(jsonb_typeof(value)='number') INTO v_decoded,v_types_ok
      FROM jsonb_array_elements(v_frequencies->v_action_key) WITH ORDINALITY;
    IF v_types_ok IS NOT TRUE THEN RETURN false; END IF;
    v_frequency_values:=v_frequency_values||ARRAY[v_decoded];
    SELECT array_agg(CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::numeric END ORDER BY ordinality),
           bool_and(jsonb_typeof(value) IN ('number','null')) INTO v_decoded,v_types_ok
      FROM jsonb_array_elements(v_action_evs->v_action_key) WITH ORDINALITY;
    IF v_types_ok IS NOT TRUE THEN RETURN false; END IF;
    v_ev_values:=v_ev_values||ARRAY[v_decoded];
  END LOOP;
  SELECT array_agg((strpos('23456789TJQKA',left(card,1))-1)*4+strpos('cdhs',right(card,1))-1)
    INTO v_board_ids FROM unnest(v_cards) card;
  SELECT array_agg(a=ANY(v_board_ids) OR b=ANY(v_board_ids) ORDER BY b,a)
    INTO v_blocked FROM generate_series(1,51) b CROSS JOIN generate_series(0,50) a WHERE a<b;
  FOR v_i IN 0..1325 LOOP
    v_weight:=v_weights[v_i+1];
    IF v_weight<0 THEN RETURN false; END IF;
    v_frequency_sum:=0; v_expected_ev:=0;
    FOR v_action_index IN 1..cardinality(v_action_keys) LOOP
      v_frequency:=v_frequency_values[v_action_index][v_i+1];
      IF v_frequency<0 OR v_frequency>1 THEN RETURN false; END IF;
      v_frequency_sum:=v_frequency_sum+v_frequency;
      v_action_ev:=v_ev_values[v_action_index][v_i+1];
      IF v_weight>0 THEN
        IF v_action_ev IS NULL THEN RETURN false; END IF;
        v_expected_ev:=v_expected_ev+v_frequency*v_action_ev;
      ELSIF v_frequency<>0 OR v_action_ev IS NOT NULL THEN RETURN false;
      END IF;
    END LOOP;
    v_policy_ev:=v_policies[v_i+1];
    IF v_weight>0 THEN
      IF abs(v_frequency_sum-1)>0.00002 OR v_policy_ev IS NULL THEN RETURN false; END IF;
      IF abs(v_policy_ev-v_expected_ev)>0.02 THEN RETURN false; END IF;
    ELSIF v_frequency_sum<>0 OR v_policy_ev IS NOT NULL THEN RETURN false;
    END IF;
    IF v_blocked[v_i+1] AND v_weight<>0 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$
;
