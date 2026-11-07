-- Byte-exact production helper definitions (read-only, 2026-11-07).
CREATE OR REPLACE FUNCTION public.fn_gto_v31_json_safe_integer(p_value jsonb, p_min numeric, p_max numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_value numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'number' THEN RETURN false; END IF;
  v_value := (p_value #>> '{}')::numeric;
  RETURN v_value = trunc(v_value) AND v_value BETWEEN p_min AND p_max;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_physical_positions_valid(p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
 c jsonb:=p_node->'node_context'; lp jsonb:=p_node->'line_proof';
 seats integer; player integer; positions text[]; h integer; o integer;
BEGIN
 IF jsonb_typeof(c->'table_size') IS DISTINCT FROM 'number'
    OR (c->>'table_size') !~ '^(2|3|4|5|6|7|8|9|10)$'
    OR jsonb_typeof(lp->'hero_solver_player') IS DISTINCT FROM 'number'
    OR (lp->>'hero_solver_player') !~ '^[01]$' THEN RETURN false; END IF;
 seats:=(c->>'table_size')::integer; player:=(lp->>'hero_solver_player')::integer;
 positions:=CASE seats
  WHEN 2 THEN ARRAY['BB','SB'] WHEN 3 THEN ARRAY['SB','BB','BTN']
  WHEN 4 THEN ARRAY['SB','BB','CO','BTN'] WHEN 5 THEN ARRAY['SB','BB','HJ','CO','BTN']
  WHEN 6 THEN ARRAY['SB','BB','UTG','HJ','CO','BTN']
  WHEN 7 THEN ARRAY['SB','BB','UTG','MP','HJ','CO','BTN']
  WHEN 8 THEN ARRAY['SB','BB','UTG','UTG1','MP','HJ','CO','BTN']
  WHEN 9 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','MP','HJ','CO','BTN']
  WHEN 10 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','UTG3','MP','HJ','CO','BTN'] END;
 h:=array_position(positions,c->>'hero_position');
 o:=array_position(positions,c->>'opponent_position');
 RETURN COALESCE(h<>o AND ((player=0 AND h<o) OR (player=1 AND h>o)),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_texture_class(p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_ranks integer[] := '{}';
  v_suits text[] := '{}';
  v_ch text; v_r integer; v_i integer;
  v_hi integer; v_high text; v_suitkind text; v_paired boolean;
  v_conn boolean := false;
  v_distinct integer[];
  v_span integer;
begin
  if p_board is null or length(p_board) < 6 then return null; end if;
  for v_i in 0..2 loop
    v_ch := substr(p_board, v_i * 2 + 1, 1);
    v_r := case v_ch
      when 'A' then 14 when 'K' then 13 when 'Q' then 12 when 'J' then 11
      when 'T' then 10 else nullif(v_ch, '')::integer end;
    if v_r is null then return null; end if;
    v_ranks := v_ranks || v_r;
    v_suits := v_suits || substr(p_board, v_i * 2 + 2, 1);
  end loop;

  v_hi := greatest(v_ranks[1], v_ranks[2], v_ranks[3]);
  v_high := case
    when v_hi = 14 then 'A'
    when v_hi >= 12 then 'B'
    when v_hi >= 9  then 'M'
    else 'L' end;

  v_suitkind := case
    when v_suits[1] = v_suits[2] and v_suits[2] = v_suits[3] then 'm'
    when v_suits[1] = v_suits[2] or v_suits[2] = v_suits[3] or v_suits[1] = v_suits[3] then 't'
    else 'r' end;

  v_paired := v_ranks[1] = v_ranks[2] or v_ranks[2] = v_ranks[3] or v_ranks[1] = v_ranks[3];

  select array_agg(distinct r order by r) into v_distinct from unnest(v_ranks) r;
  if array_length(v_distinct, 1) >= 2 then
    v_span := v_distinct[array_length(v_distinct, 1)] - v_distinct[1];
    if v_span <= 4 then v_conn := true; end if;
    if not v_conn and v_distinct[array_length(v_distinct, 1)] = 14 then
      if (v_distinct[array_length(v_distinct, 1) - 1] <= 5) then v_conn := true; end if;
    end if;
  end if;

  return v_high || v_suitkind || case when v_paired then 'p' else 'u' end
         || case when v_conn then 'c' else 'd' end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_texture_class_any(p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_n integer;
  v_ranks integer[] := '{}';
  v_suits text[] := '{}';
  v_ch text; v_r integer; v_i integer;
  v_hi integer := 0; v_high text; v_suitkind text; v_paired boolean := false;
  v_conn boolean := false;
  v_maxsuit integer := 0;
  v_cnt integer;
  v_distinct integer[];
  v_win integer;
begin
  if p_board is null then return null; end if;
  v_n := length(p_board) / 2;
  if v_n < 3 or length(p_board) % 2 <> 0 then return null; end if;
  if v_n = 3 then
    return public.fn_gto_texture_class(p_board);
  end if;
  if v_n > 5 then return null; end if;

  for v_i in 0..(v_n - 1) loop
    v_ch := substr(p_board, v_i * 2 + 1, 1);
    v_r := case v_ch
      when 'A' then 14 when 'K' then 13 when 'Q' then 12 when 'J' then 11
      when 'T' then 10 else nullif(v_ch, '')::integer end;
    if v_r is null then return null; end if;
    v_ranks := v_ranks || v_r;
    v_suits := v_suits || substr(p_board, v_i * 2 + 2, 1);
    if v_r > v_hi then v_hi := v_r; end if;
  end loop;

  v_high := case
    when v_hi = 14 then 'A'
    when v_hi >= 12 then 'B'
    when v_hi >= 9  then 'M'
    else 'L' end;

  select max(c) into v_maxsuit from (
    select count(*) c from unnest(v_suits) s group by s
  ) x;
  v_suitkind := case when v_maxsuit >= 4 then 'm' when v_maxsuit = 3 then 't' else 'r' end;

  select count(*) into v_cnt from (
    select 1 from unnest(v_ranks) r group by r having count(*) >= 2
  ) p;
  v_paired := v_cnt > 0;

  select array_agg(distinct r order by r) into v_distinct from unnest(v_ranks) r;
  for v_win in reverse 14..6 loop
    if (select count(*) from unnest(v_distinct) r
        where r <= v_win and r > v_win - 5
           or (v_win = 5 and r = 14)) >= 3 then
      v_conn := true;
      exit;
    end if;
  end loop;
  if not v_conn then
    if (select count(*) from unnest(v_distinct) r where r <= 5 or r = 14) >= 3 then
      v_conn := true;
    end if;
  end if;

  return v_high || v_suitkind || case when v_paired then 'p' else 'u' end
         || case when v_conn then 'c' else 'd' end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_source_node_scalar_types_valid(p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_context jsonb := p_node->'node_context';
  v_line jsonb := p_node->'line_proof';
  v_key text;
  v_max constant numeric := 9007199254740991;
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node) <> 'object' THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'schema','node','node_checksum','source_combo_order_checksum','range_bundle_checksum'
  ] LOOP
    IF jsonb_typeof(p_node->v_key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  END LOOP;
  IF length(p_node->>'node') NOT BETWEEN 3 AND 512
     OR p_node->>'node' !~
       '^r:0(:c|:f|:b[1-9][0-9]{0,78}|:[2-9TJQKA][cdhs])*$' THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(v_context) <> 'object' OR jsonb_typeof(v_line) <> 'object' THEN RETURN false; END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'street','game_family','objective','utility_context','pot_type','hero_position',
    'opponent_position','texture_class','node_role','facing_kind','facing_size_bucket','board'
  ] LOOP
    IF jsonb_typeof(v_context->v_key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  END LOOP;
  IF NOT public.fn_gto_v31_json_safe_integer(v_context->'table_size',2,10)
     OR NOT public.fn_gto_v31_json_safe_integer(v_context->'depth_bucket',10,150)
     OR NOT (
       v_context->'facing_target_chips'='null'::jsonb
       OR public.fn_gto_v31_json_safe_integer(v_context->'facing_target_chips',0,v_max)
     )
     OR NOT (
       v_context->'facing_actor_total_chips'='null'::jsonb
       OR public.fn_gto_v31_json_safe_integer(v_context->'facing_actor_total_chips',0,v_max)
     ) THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(v_line->'schema') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_line->'manifest_checksum') IS DISTINCT FROM 'string'
     OR NOT public.fn_gto_v31_json_safe_integer(v_line->'hero_solver_player',0,1)
     OR NOT (
       v_line->'preflop_aggressor_solver_player'='null'::jsonb
       OR public.fn_gto_v31_json_safe_integer(v_line->'preflop_aggressor_solver_player',0,1)
     )
     OR NOT public.fn_gto_v31_json_safe_integer(v_line->'root_pot_chips',1,v_max)
     OR NOT public.fn_gto_v31_json_safe_integer(v_line->'effective_stack_chips',1,v_max)
     OR NOT public.fn_gto_v31_json_safe_integer(v_line->'chips_per_bb',1,v_max) THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_action_specs_valid(p_specs jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_action record;
  v_family text;
  v_unit text;
  v_size numeric;
  v_call_family text;
BEGIN
  IF p_specs IS NULL OR jsonb_typeof(p_specs) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_specs)) < 2
     OR NOT (p_specs ? 'c')
     OR jsonb_typeof(p_specs#>'{c,family}') IS DISTINCT FROM 'string'
     OR p_specs#>>'{c,family}' NOT IN ('check','call') THEN
    RETURN false;
  END IF;
  v_call_family := p_specs#>>'{c,family}';
  IF v_call_family='call' AND NOT (p_specs ? 'f') THEN RETURN false; END IF;

  FOR v_action IN SELECT key,value FROM jsonb_each(p_specs) LOOP
    IF v_action.key !~ '^(c|f|b[1-9][0-9]{0,78})$'
       OR jsonb_typeof(v_action.value) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_action.value)) <> 4
       OR NOT (v_action.value ?& ARRAY['family','size_unit','size_value','all_in'])
       OR jsonb_typeof(v_action.value->'family') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_action.value->'size_unit') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_action.value->'all_in') IS DISTINCT FROM 'boolean' THEN
      RETURN false;
    END IF;
    v_family := v_action.value->>'family';
    v_unit := v_action.value->>'size_unit';
    IF v_family NOT IN ('check','fold','call','bet','raise','all_in')
       OR (v_action.key='c' AND v_family<>v_call_family)
       OR (v_action.key='f' AND v_family<>'fold')
       OR (v_action.key LIKE 'b%' AND v_call_family='check'
           AND v_family NOT IN ('bet','all_in'))
       OR (v_action.key LIKE 'b%' AND v_call_family='call'
           AND v_family NOT IN ('raise','all_in')) THEN
      RETURN false;
    END IF;
    IF v_family IN ('check','fold','call') THEN
      IF v_unit <> 'none'
         OR v_action.value->'size_value' IS DISTINCT FROM 'null'::jsonb
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM false THEN
        RETURN false;
      END IF;
    ELSIF v_family = 'all_in' THEN
      IF v_unit <> 'all_in'
         OR v_action.value->'size_value' IS DISTINCT FROM 'null'::jsonb
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM true THEN
        RETURN false;
      END IF;
    ELSE
      IF jsonb_typeof(v_action.value->'size_value') IS DISTINCT FROM 'number'
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM false THEN
        RETURN false;
      END IF;
      v_size := (v_action.value->>'size_value')::numeric;
      IF v_size <= 0 OR v_size > 20
         OR (v_family = 'bet' AND v_unit <> 'pot_fraction')
         OR (v_family = 'raise' AND v_unit <> 'pot_after_call_fraction') THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

