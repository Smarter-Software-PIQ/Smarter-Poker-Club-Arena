-- Production shapes for the native proof of migration 20261115162745 (FLOP-5 D6).
-- Generated from PokerIQ-Production (kuklfnapbkmacvwxktbh) on 2026-11-15 inside READ ONLY
-- transactions; never applied to production. The 146 functions below are byte-exact pg_get_functiondef copies of the live definitions (the closure of every function the migrations under proof patch, generate from, or call), with their live ACLs.
SET check_function_bodies = off;
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

CREATE OR REPLACE FUNCTION public.fn_gto_v31_active_cells(p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(dataset_id uuid, dataset_key text, dataset_checksum text, solver_version text, solver_binary_checksum text, pipeline_commit text, pipeline_bundle_checksum text, manifest_version text, manifest_checksum text, source_artifact_checksum text, source_combo_order_checksum text, range_bundle_checksum text, icm_model_checksum text, input_bundle_checksum text, cell_key_checksum text, cell_payload_checksum text, lineage_checksum text, quality_status text, dataset_state text, dataset_cells bigint, source_rows bigint, train_source_rows bigint, holdout_source_rows bigint, invalid_rows bigint, audited_at timestamp with time zone, street text, game_family text, objective text, utility_context text, table_size smallint, pot_type text, hero_position text, opponent_position text, depth_bucket integer, texture_class text, node_role text, facing_kind text, facing_size_bucket text, hand_matrix jsonb, action_specs jsonb, policy_ev_matrix jsonb, action_ev_matrix jsonb, feature_contract_version text, policy_export_schema text, policy_representation text, public_model jsonb, public_template jsonb, public_training_provenance jsonb, public_model_build_receipt jsonb, model_checksum text, template_checksum text, feature_schema_checksum text, training_provenance_checksum text, model_build_receipt_checksum text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.dataset_id, d.dataset_key, d.dataset_checksum,
         d.solver_version, d.solver_binary_checksum, d.pipeline_commit,
         d.pipeline_bundle_checksum,
         d.manifest_version, d.manifest_checksum, d.source_artifact_checksum,
         d.source_combo_order_checksum, d.range_bundle_checksum,
         d.icm_model_checksum,d.input_bundle_checksum,
         c.cell_key_checksum, c.cell_payload_checksum, c.lineage_checksum,
         d.quality_status, d.state, (d.coverage->>'cells')::bigint,
         d.source_rows, d.train_source_rows, d.holdout_source_rows,
         d.invalid_rows, d.audited_at,
         c.street, c.game_family, c.objective, c.utility_context, c.table_size,
         c.pot_type, c.hero_position, c.opponent_position,
         c.depth_bucket, c.texture_class, c.node_role, c.facing_kind,
         c.facing_size_bucket, c.hand_matrix, c.action_specs,
         c.policy_ev_matrix,c.action_ev_matrix,d.feature_contract_version,d.policy_export_schema,c.policy_representation,c.public_model,c.public_template,c.public_training_provenance,c.public_model_build_receipt,c.model_checksum,c.template_checksum,c.feature_schema_checksum,c.training_provenance_checksum,c.model_build_receipt_checksum
    FROM public.gto_v31_datasets d
    JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
     AND b.approval_status='approved' AND b.bundle_checksum=d.input_bundle_checksum
     AND b.feature_contract_version IS NOT DISTINCT FROM d.feature_contract_version AND b.policy_export_schema IS NOT DISTINCT FROM d.policy_export_schema AND b.policy_representation IS NOT DISTINCT FROM d.policy_representation
    JOIN public.gto_v31_runtime_cells c ON c.dataset_id=d.dataset_id AND c.feature_contract_version IS NOT DISTINCT FROM d.feature_contract_version AND c.policy_export_schema IS NOT DISTINCT FROM d.policy_export_schema AND c.policy_representation IS NOT DISTINCT FROM d.policy_representation
   WHERE d.state='active' AND d.quality_status='validated' AND d.invalid_rows=0
     AND d.dataset_checksum IS NOT NULL AND d.source_artifact_checksum IS NOT NULL
   ORDER BY c.street, c.game_family, c.objective, c.utility_context, c.table_size,
            c.pot_type, c.hero_position, c.opponent_position, c.depth_bucket,
            c.texture_class, c.node_role,
            c.facing_kind, c.facing_size_bucket
   OFFSET greatest(COALESCE(p_offset,0),0)
   LIMIT greatest(1,least(COALESCE(p_limit,500),CASE WHEN EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE state='active' AND policy_representation='public_hist215_v1') THEN 1 ELSE 500 END));
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_assert_source_contract(p_node jsonb, p_schema text, p_icm_checksum text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_schema IS NOT NULL AND p_schema<>'smarter-poker.pio-policy.v4'
 OR p_node->>'schema' IS DISTINCT FROM COALESCE(p_schema,'smarter-poker.pio-policy.v3')
 OR NOT public.fn_gto_v31_physical_positions_valid(p_node)
 OR (p_schema IS NOT NULL AND NOT public.fn_gto_v31_source_node_v4_valid(p_node))
 OR (p_schema IS NOT NULL AND p_node#>>'{complete_public_state,utility,icm_model_bundle_checksum}' IS DISTINCT FROM p_icm_checksum)
 THEN RAISE EXCEPTION 'source node disagrees with immutable dataset policy contract' USING ERRCODE='55000'; END IF;
 RETURN p_node;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_board_rank_signature(p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ranks constant text := '23456789TJQKA';
  v_cards integer := length(p_board)/2;
  v_seen text[] := ARRAY[]::text[];
  v_card text;
  v_flop text;
  v_runout text := '';
  v_i integer;
BEGIN
  IF length(p_board) NOT IN (6,8,10)
     OR p_board !~ '^([2-9TJQKA][cdhs]){3,5}$' THEN
    RETURN NULL;
  END IF;
  FOR v_i IN 0..v_cards-1 LOOP
    v_card:=substr(p_board,v_i*2+1,2);
    IF v_card=ANY(v_seen) THEN RETURN NULL; END IF;
    v_seen:=array_append(v_seen,v_card);
  END LOOP;
  SELECT string_agg(substr(p_board,n,1),'' ORDER BY position(substr(p_board,n,1) IN v_ranks),n)
    INTO v_flop
    FROM unnest(ARRAY[1,3,5]) n;
  IF v_cards>=4 THEN v_runout:=substr(p_board,7,1); END IF;
  IF v_cards=5 THEN v_runout:=v_runout||substr(p_board,9,1); END IF;
  RETURN v_cards::text||':'||v_flop||':'||v_runout;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_board_relative_key_v2(p_combo_index integer, p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  holes text[]; combo_high integer; combo_low integer;
  cards text[]; ranks integer[]:=ARRAY[]::integer[]; suits text[]:=ARRAY[]::text[];
  board_ranks integer[]; all_ranks integer[]; groups integer[]; multiplicities integer[];
  best integer[]:=ARRAY[]::integer[]; score integer[]; unique_ranks integer[];
  chosen integer[]; rank_counts integer[]; rank_count integer; subset_index integer; board_counts integer[]; all_counts integer[]; greater_count integer; same_count integer; suit_sort_keys integer[]:=ARRAY[]::integer[]; sort_key integer; swap_key integer; swap_tuple jsonb;
  bmult jsonb; hole_tuples jsonb[]:=ARRAY[]::jsonb[]; hole_relations jsonb;
  suit_tuples jsonb[]:=ARRAY[]::jsonb[]; suit_relations jsonb;
  tiebreak jsonb:='[]'::jsonb; tuple jsonb;
  i integer; j integer; a integer; b integer; c integer; d integer; e integer;
  r integer; top integer; contribution integer; min_hole integer:=2; max_hole integer:=0;
  straight integer; complete_ranks integer:=0; complete_cards integer:=0;
  flush_cards integer:=0; board_suit_count integer; hole_suit_count integer;
  unseen integer; adjacent integer:=0; one_gap integer:=0; windows integer:=0;
  suit text; suited_hole integer[]; run integer[]; is_flush boolean; has_straight boolean:=false;
  wire jsonb;
BEGIN
  IF p_combo_index NOT BETWEEN 0 AND 1325 OR length(p_board) NOT IN (6,8,10)
     OR p_board !~ '^([2-9TJQKA][cdhs]){3,5}$' THEN RETURN NULL; END IF;
  combo_high:=floor((1+sqrt(1+8*p_combo_index))/2)::integer;
  WHILE combo_high*(combo_high-1)/2>p_combo_index LOOP combo_high:=combo_high-1; END LOOP;
  WHILE (combo_high+1)*combo_high/2<=p_combo_index LOOP combo_high:=combo_high+1; END LOOP;
  combo_low:=p_combo_index-combo_high*(combo_high-1)/2;
  holes:=ARRAY[
    substr('23456789TJQKA',combo_low/4+1,1)||substr('cdhs',mod(combo_low,4)+1,1),
    substr('23456789TJQKA',combo_high/4+1,1)||substr('cdhs',mod(combo_high,4)+1,1)
  ];
  cards:=holes;
  FOR i IN 0..length(p_board)/2-1 LOOP cards:=array_append(cards,substr(p_board,2*i+1,2)); END LOOP;
  FOR i IN 1..cardinality(cards) LOOP FOR j IN i+1..cardinality(cards) LOOP
    IF cards[i]=cards[j] THEN RETURN NULL; END IF;
  END LOOP; END LOOP;
  FOR i IN 1..cardinality(cards) LOOP
    ranks:=array_append(ranks,strpos('23456789TJQKA',substr(cards[i],1,1))+1);
    suits:=array_append(suits,substr(cards[i],2,1));
  END LOOP;
  board_counts:=array_fill(0,ARRAY[15]); all_counts:=array_fill(0,ARRAY[15]);
  FOR i IN 1..cardinality(ranks) LOOP
    all_counts[ranks[i]]:=all_counts[ranks[i]]+1;
    IF i>=3 THEN board_counts[ranks[i]]:=board_counts[ranks[i]]+1; END IF;
  END LOOP;
  board_ranks:=ARRAY[]::integer[]; all_ranks:=ARRAY[]::integer[];
  FOR r IN REVERSE 14..2 LOOP
    IF board_counts[r]>0 THEN board_ranks:=array_append(board_ranks,r); END IF;
    IF all_counts[r]>0 THEN all_ranks:=array_append(all_ranks,r); END IF;
  END LOOP;
  bmult:='[]'::jsonb;
  FOR rank_count IN REVERSE 4..1 LOOP
    FOREACH r IN ARRAY board_ranks LOOP
      IF board_counts[r]=rank_count THEN bmult:=bmult||jsonb_build_array(rank_count); END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..2 LOOP
    greater_count:=0;
    FOREACH r IN ARRAY board_ranks LOOP
      IF r>ranks[i] THEN greater_count:=greater_count+1; END IF;
    END LOOP;
    hole_tuples:=array_append(hole_tuples,jsonb_build_array(greater_count,
      board_counts[ranks[i]],CASE WHEN ranks[i]=14 THEN 1 ELSE 0 END));
  END LOOP;
  -- Equal-length numeric tuples use the same lexicographic order as the old columns.
  IF hole_tuples[1]>hole_tuples[2] THEN
    hole_relations:=jsonb_build_array(hole_tuples[2],hole_tuples[1]);
  ELSE hole_relations:=jsonb_build_array(hole_tuples[1],hole_tuples[2]); END IF;

  -- Independent best-five enumeration (not the TS full-hand category counter).
  FOR a IN 1..cardinality(cards)-4 LOOP
   FOR b IN a+1..cardinality(cards)-3 LOOP
    FOR c IN b+1..cardinality(cards)-2 LOOP
     FOR d IN c+1..cardinality(cards)-1 LOOP
      FOR e IN d+1..cardinality(cards) LOOP
       -- Enumerate the same five cards without planning SQL for every subset.
       chosen:=ARRAY[a,b,c,d,e];
       rank_counts:=array_fill(0,ARRAY[15]);
       contribution:=0;
       FOREACH subset_index IN ARRAY chosen LOOP
         rank_counts[ranks[subset_index]]:=rank_counts[ranks[subset_index]]+1;
         IF subset_index<=2 THEN contribution:=contribution+1; END IF;
       END LOOP;
       unique_ranks:=ARRAY[]::integer[];
       FOR r IN REVERSE 14..2 LOOP
         IF rank_counts[r]>0 THEN unique_ranks:=array_append(unique_ranks,r); END IF;
       END LOOP;
       groups:=ARRAY[]::integer[];
       multiplicities:=ARRAY[]::integer[];
       FOR rank_count IN REVERSE 4..1 LOOP
         FOREACH r IN ARRAY unique_ranks LOOP
           IF rank_counts[r]=rank_count THEN
             groups:=array_append(groups,r);
             multiplicities:=array_append(multiplicities,rank_count);
           END IF;
         END LOOP;
       END LOOP;
       is_flush:=suits[a]=suits[b] AND suits[a]=suits[c]
         AND suits[a]=suits[d] AND suits[a]=suits[e];
       straight:=0;
       IF cardinality(unique_ranks)=5 THEN
         IF unique_ranks[1]-unique_ranks[5]=4 THEN straight:=unique_ranks[1];
         ELSIF unique_ranks=ARRAY[14,5,4,3,2] THEN straight:=5; END IF;
       END IF;
       IF is_flush AND straight>0 THEN score:=ARRAY[8,straight];
       ELSIF multiplicities[1]=4 THEN score:=ARRAY[7,groups[1],groups[2]];
       ELSIF multiplicities[1]=3 AND multiplicities[2]=2 THEN score:=ARRAY[6,groups[1],groups[2]];
       ELSIF is_flush THEN score:=ARRAY[5]||unique_ranks;
       ELSIF straight>0 THEN score:=ARRAY[4,straight];
       ELSIF multiplicities[1]=3 THEN score:=ARRAY[3]||groups;
       ELSIF multiplicities[1]=2 AND multiplicities[2]=2 THEN score:=ARRAY[2]||groups;
       ELSIF multiplicities[1]=2 THEN score:=ARRAY[1]||groups;
       ELSE score:=ARRAY[0]||unique_ranks; END IF;
       IF score>best THEN best:=score;min_hole:=contribution;max_hole:=contribution;
       ELSIF score=best THEN min_hole:=least(min_hole,contribution);max_hole:=greatest(max_hole,contribution); END IF;
      END LOOP;
     END LOOP;
    END LOOP;
   END LOOP;
  END LOOP;
  FOR i IN 2..cardinality(best) LOOP
    r:=best[i];
    tiebreak:=tiebreak||jsonb_build_array(jsonb_build_array(
      (ranks[1]=r)::integer+(ranks[2]=r)::integer,
      COALESCE(array_position(board_ranks,r)-1,-1),
      CASE WHEN r=ANY(ranks[1:2]) THEN 14-r ELSE -1 END));
  END LOOP;
  FOREACH suit IN ARRAY ARRAY['c','d','h','s'] LOOP
    board_suit_count:=0; hole_suit_count:=0; suited_hole:=NULL;
    FOR i IN 1..cardinality(cards) LOOP
      IF suits[i]=suit THEN
        IF i>=3 THEN board_suit_count:=board_suit_count+1;
        ELSE hole_suit_count:=hole_suit_count+1; suited_hole:=array_append(suited_hole,ranks[i]); END IF;
      END IF;
    END LOOP;
    IF cardinality(suited_hole)=2 AND suited_hole[1]<suited_hole[2] THEN
      suited_hole:=ARRAY[suited_hole[2],suited_hole[1]];
    END IF;
    tuple:=jsonb_build_array(board_suit_count,hole_suit_count);
    IF suited_hole IS NOT NULL THEN
      FOREACH r IN ARRAY suited_hole LOOP
        unseen:=14-r;
        FOR i IN 1..cardinality(cards) LOOP
          IF ranks[i]>r AND suits[i]=suit THEN unseen:=unseen-1; END IF;
        END LOOP;
        tuple:=tuple||jsonb_build_array(unseen);
      END LOOP;
    END IF;
    suit_tuples:=array_append(suit_tuples,tuple);
    IF cardinality(cards)<7 AND board_suit_count+hole_suit_count=4 THEN flush_cards:=flush_cards+9; END IF;
  END LOOP;
  -- Encode exactly the old four ORDER BY numeric columns, padding absent ranks as -1.
  FOR i IN 1..4 LOOP
    tuple:=suit_tuples[i];
    sort_key:=(((tuple->>0)::integer*4+(tuple->>1)::integer)*16+
      COALESCE((tuple->>2)::integer,-1)+1)*16+COALESCE((tuple->>3)::integer,-1)+1;
    suit_sort_keys:=array_append(suit_sort_keys,sort_key);
  END LOOP;
  FOR i IN 2..4 LOOP
    j:=i;
    WHILE j>1 AND suit_sort_keys[j]<suit_sort_keys[j-1] LOOP
      swap_key:=suit_sort_keys[j-1]; suit_sort_keys[j-1]:=suit_sort_keys[j]; suit_sort_keys[j]:=swap_key;
      swap_tuple:=suit_tuples[j-1]; suit_tuples[j-1]:=suit_tuples[j]; suit_tuples[j]:=swap_tuple;
      j:=j-1;
    END LOOP;
  END LOOP;
  suit_relations:=to_jsonb(suit_tuples);
  FOR top IN 5..14 LOOP
    run:=CASE WHEN top=5 THEN ARRAY[14,2,3,4,5] ELSE ARRAY[top-4,top-3,top-2,top-1,top] END;
    IF all_ranks @> run THEN has_straight:=true; END IF;
    same_count:=0;
    FOREACH r IN ARRAY run LOOP IF board_counts[r]>0 THEN same_count:=same_count+1; END IF; END LOOP;
    IF same_count>=4 THEN windows:=windows+1; END IF;
  END LOOP;
  IF cardinality(cards)<7 AND NOT has_straight THEN
    FOR r IN 2..14 LOOP
      IF NOT r=ANY(all_ranks) THEN
        FOR top IN 5..14 LOOP
          run:=CASE WHEN top=5 THEN ARRAY[14,2,3,4,5] ELSE ARRAY[top-4,top-3,top-2,top-1,top] END;
          IF (all_ranks||r) @> run THEN complete_ranks:=complete_ranks+1;complete_cards:=complete_cards+4;EXIT; END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  FOR i IN 1..cardinality(board_ranks) LOOP FOR j IN i+1..cardinality(board_ranks) LOOP
    IF board_ranks[i]-board_ranks[j]=1 OR (board_ranks[i]=14 AND board_ranks[j]=2) THEN adjacent:=adjacent+1; END IF;
    IF board_ranks[i]-board_ranks[j]=2 OR (board_ranks[i]=14 AND board_ranks[j]=3) THEN one_gap:=one_gap+1; END IF;
  END LOOP; END LOOP;
  wire:=jsonb_build_array('holdem-board-relative-v2',cardinality(cards)-2,best[1],bmult,hole_relations,
    ranks[1]=ranks[2],complete_ranks,complete_cards,suit_relations,flush_cards,tiebreak,
    jsonb_build_array(min_hole,max_hole),jsonb_build_array(adjacent,one_gap,windows));
  RETURN regexp_replace(wire::text,'\s','','g');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_board_relative_key_v2_valid(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb; tuple jsonb; item jsonb; field integer; integer_value integer;
BEGIN
  v:=p_key::jsonb;
  IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)<>13
     OR v->>0<>'holdem-board-relative-v2' OR regexp_replace(v::text,'\s','','g')<>p_key
     OR jsonb_typeof(v->5)<>'boolean' THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY[1,2,6,7,9] LOOP
    IF jsonb_typeof(v->field)<>'number' OR (v->>field)!~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
  END LOOP;
  IF (v->>1)::integer NOT IN (3,4,5) OR (v->>2)::integer NOT BETWEEN 0 AND 8
     OR (v->>6)::integer>13 OR (v->>7)::integer<>4*(v->>6)::integer
     OR (v->>9)::integer NOT IN (0,9) OR ((v->>1)::integer=5 AND ((v->>6)::integer<>0 OR (v->>9)::integer<>0)) THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY[3,4,8,10,11,12] LOOP
    IF jsonb_typeof(v->field)<>'array' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_array_length(v->3) NOT BETWEEN 1 AND (v->>1)::integer
     OR jsonb_array_length(v->4)<>2 OR jsonb_array_length(v->8)<>4
     OR jsonb_array_length(v->10) NOT BETWEEN 1 AND 5 OR jsonb_array_length(v->11)<>2 OR jsonb_array_length(v->12)<>3 THEN RETURN false; END IF;
  IF jsonb_array_length(v->10)<>(CASE (v->>2)::integer
       WHEN 0 THEN 5 WHEN 1 THEN 4 WHEN 2 THEN 3 WHEN 3 THEN 3
       WHEN 4 THEN 1 WHEN 5 THEN 5 WHEN 6 THEN 2 WHEN 7 THEN 2 ELSE 1 END) THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v->3) LOOP
    IF jsonb_typeof(item)<>'number' OR item::text !~ '^[1-4]$' THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT sum(value::text::integer) FROM jsonb_array_elements(v->3))<>(v->>1)::integer THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY[4,8,10] LOOP
    FOR tuple IN SELECT value FROM jsonb_array_elements(v->field) LOOP
      IF jsonb_typeof(tuple)<>'array' OR jsonb_array_length(tuple) NOT BETWEEN 2 AND 4
        OR (field IN (4,10) AND jsonb_array_length(tuple)<>3)
        OR (field=8 AND jsonb_array_length(tuple)<>2+(tuple->>1)::integer) THEN RETURN false; END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(tuple) LOOP
        IF jsonb_typeof(item)<>'number' OR item::text !~ '^(-1|0|[1-9][0-9]*)$' THEN RETURN false; END IF;
        integer_value:=item::text::integer;
        IF integer_value NOT BETWEEN (CASE WHEN field=10 THEN -1 ELSE 0 END) AND 12 THEN RETURN false; END IF;
      END LOOP;
      IF field=4 AND ((tuple->>0)::integer>(v->>1)::integer
         OR (tuple->>1)::integer>3 OR (tuple->>2)::integer NOT IN (0,1)) THEN RETURN false; END IF;
      IF field=8 AND ((tuple->>0)::integer>(v->>1)::integer OR (tuple->>1)::integer>2) THEN RETURN false; END IF;
      IF field=10 AND ((tuple->>0)::integer NOT BETWEEN 0 AND 2
         OR (tuple->>1)::integer NOT BETWEEN -1 AND jsonb_array_length(v->3)-1
         OR ((tuple->>0)::integer=0 AND (tuple->>2)::integer<>-1)
         OR ((tuple->>0)::integer>0 AND (tuple->>2)::integer<0)
         OR ((tuple->>0)::integer=0 AND (tuple->>1)::integer=-1)) THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  IF (SELECT sum((value->>0)::integer) FROM jsonb_array_elements(v->8))<>(v->>1)::integer
     OR (SELECT sum((value->>1)::integer) FROM jsonb_array_elements(v->8))<>2
     OR ((v->>5)::boolean AND (v#>'{4,0}'<>v#>'{4,1}' OR (v#>>'{4,0,1}')::integer>2)) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements((v->11)||(v->12)) AS parts(value)
    WHERE jsonb_typeof(parts.value)<>'number' OR parts.value::text !~ '^(0|[1-9][0-9]*)$')
    OR (v#>>'{11,0}')::integer NOT BETWEEN greatest(0,5-(v->>1)::integer) AND 2
    OR (v#>>'{11,1}')::integer NOT BETWEEN (v#>>'{11,0}')::integer AND 2
    OR (v#>>'{12,0}')::integer>10 OR (v#>>'{12,1}')::integer>10 OR (v#>>'{12,2}')::integer>10 THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_build_cell(p_dataset_id uuid, p_context jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1') THEN RETURN public.fn_gto_v31_public215_build_cell(p_dataset_id,p_context);END IF;RETURN public.fn_gto_v31_build_cell_matrix_v2(p_dataset_id,p_context);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_build_cell_matrix_v2(p_dataset_id uuid, p_context jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_source_nodes jsonb;
  v_source_rows integer;
  v_train_rows integer;
  v_holdout_rows integer;
  v_spec_variants integer;
  v_machine_variants integer;
  v_cross_split_board_overlaps integer;
  v_specs jsonb;
  v_hand_matrix jsonb;
  v_policy_evs jsonb;
  v_action_evs jsonb;
  v_lineage text;
  v_cell jsonb;
  v_existing_checksum text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF p_context IS NULL OR jsonb_typeof(p_context)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_context))<>13
     OR NOT (p_context ?& ARRAY['street','game_family','objective','utility_context',
       'table_size','pot_type','hero_position','opponent_position','depth_bucket',
       'texture_class','node_role','facing_kind','facing_size_bucket']) THEN
    RAISE EXCEPTION 'compact cell context is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
    WHERE d.value=p_context) THEN
    RAISE EXCEPTION 'compact cell is not in declared coverage';
  END IF;
  SELECT c.cell_key_checksum INTO v_existing_checksum
    FROM public.gto_v31_runtime_cells c
   WHERE c.dataset_id=p_dataset_id
     AND c.street=p_context->>'street'
     AND c.game_family=p_context->>'game_family'
     AND c.objective=p_context->>'objective'
     AND c.utility_context=p_context->>'utility_context'
     AND c.table_size=(p_context->>'table_size')::smallint
     AND c.pot_type=p_context->>'pot_type'
     AND c.hero_position=p_context->>'hero_position'
     AND c.opponent_position=p_context->>'opponent_position'
     AND c.depth_bucket=(p_context->>'depth_bucket')::integer
     AND c.texture_class=p_context->>'texture_class'
     AND c.node_role=p_context->>'node_role'
     AND c.facing_kind=p_context->>'facing_kind'
     AND c.facing_size_bucket=p_context->>'facing_size_bucket';


  WITH matching_nodes AS MATERIALIZED (
    SELECT a.source_row_id,a.machine_id,a.source_artifact_checksum,s.scenario_hash,s.strategy_matrix_v2,n.value AS node,
           CASE WHEN a.machine_id='M2' THEN 'holdout' ELSE 'train' END AS split
      FROM public.gto_v31_source_artifacts a
      JOIN public.solved_spots_gold s ON s.id=a.source_row_id
       AND s.quality_status='validated' AND s.audited_at IS NOT NULL
       AND s.source_artifact_checksum=a.source_artifact_checksum
      CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
     WHERE a.dataset_id=p_dataset_id
       AND n.value#>>'{node_context,street}'=p_context->>'street'
       AND n.value#>>'{node_context,game_family}'=p_context->>'game_family'
       AND n.value#>>'{node_context,objective}'=p_context->>'objective'
       AND n.value#>>'{node_context,utility_context}'=p_context->>'utility_context'
       AND (n.value#>>'{node_context,table_size}')::integer=(p_context->>'table_size')::integer
       AND n.value#>>'{node_context,pot_type}'=p_context->>'pot_type'
       AND n.value#>>'{node_context,hero_position}'=p_context->>'hero_position'
       AND n.value#>>'{node_context,opponent_position}'=p_context->>'opponent_position'
       AND (n.value#>>'{node_context,depth_bucket}')::integer=(p_context->>'depth_bucket')::integer
       AND n.value#>>'{node_context,texture_class}'=p_context->>'texture_class'
       AND n.value#>>'{node_context,node_role}'=p_context->>'node_role'
       AND n.value#>>'{node_context,facing_kind}'=p_context->>'facing_kind'
       AND n.value#>>'{node_context,facing_size_bucket}'=p_context->>'facing_size_bucket'
  ), matching_artifacts AS MATERIALIZED (
    SELECT DISTINCT source_row_id,source_artifact_checksum,scenario_hash,strategy_matrix_v2
      FROM matching_nodes
  ), verified_artifacts AS MATERIALIZED (
    SELECT source_row_id
      FROM matching_artifacts
     WHERE source_artifact_checksum=public.fn_gto_v31_source_artifact_checksum(scenario_hash,strategy_matrix_v2)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source_row_id',m.source_row_id,'machine_id',m.machine_id,
           'source_artifact_checksum',m.source_artifact_checksum,'node',m.node,'split',m.split
         ) ORDER BY m.source_row_id,m.node->>'node'),'[]'::jsonb)
    INTO v_source_nodes
    FROM matching_nodes m JOIN verified_artifacts a USING (source_row_id);
  PERFORM public.fn_gto_v31_assert_source_contract(n.value->'node',v_dataset.policy_export_schema,v_dataset.icm_model_checksum)
    FROM jsonb_array_elements(v_source_nodes) n(value);
  IF v_existing_checksum IS NOT NULL THEN RETURN v_existing_checksum; END IF;

  WITH source_nodes AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(v_source_nodes) AS n(
      source_row_id uuid,machine_id text,source_artifact_checksum text,node jsonb,split text
    )
  )
  SELECT count(*),count(*) FILTER (WHERE split='train'),count(*) FILTER (WHERE split='holdout'),
         count(DISTINCT node->'action_specs'),count(DISTINCT machine_id),
         (SELECT count(*) FROM source_nodes train
           JOIN source_nodes holdout
             ON public.fn_gto_v31_board_rank_signature(holdout.node#>>'{node_context,board}')=
                public.fn_gto_v31_board_rank_signature(train.node#>>'{node_context,board}')
          WHERE train.split='train' AND holdout.split='holdout'),
         (array_agg(node->'action_specs'))[1],
         encode(digest(string_agg(source_row_id::text||':'||(node->>'node')||':'||
           (node->>'node_checksum'),'' ORDER BY source_row_id::text,node->>'node'),'sha256'),'hex')
    INTO v_source_rows,v_train_rows,v_holdout_rows,v_spec_variants,v_machine_variants,
         v_cross_split_board_overlaps,v_specs,v_lineage
    FROM source_nodes;
  IF v_source_rows<2 OR v_train_rows<1 OR v_holdout_rows<1 OR v_spec_variants<>1
     OR v_machine_variants<>2 OR v_cross_split_board_overlaps<>0
     OR v_specs IS NULL OR v_lineage IS NULL THEN
    RAISE EXCEPTION 'cell needs M1 and M2, one action topology, and rank-disjoint train and holdout sources';
  END IF;

  WITH source_nodes AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(v_source_nodes) AS n(
      source_row_id uuid,machine_id text,source_artifact_checksum text,node jsonb,split text
    )
  ), combo_observations AS MATERIALIZED (
    SELECT public.fn_gto_v31_feature_key(i,n.node#>>'{node_context,board}',v_dataset.feature_contract_version) AS hand_key,
           i,(n.node->'matchups'->>i)::numeric AS weight,
           (n.node->'policy_evs_bb'->>i)::numeric AS policy_ev,n.node
      FROM source_nodes n CROSS JOIN generate_series(0,1325) i
     WHERE n.split='train' AND (n.node->'matchups'->>i)::numeric>0
  ), action_observations AS MATERIALIZED (
    SELECT o.hand_key,a.key AS action_id,o.weight,
           (o.node->'frequencies'->a.key->>o.i)::numeric AS frequency,
           (o.node->'action_evs_bb'->a.key->>o.i)::numeric AS action_ev
      FROM combo_observations o CROSS JOIN LATERAL jsonb_each(v_specs) a
  ), action_aggregate AS (
    SELECT hand_key,action_id,
           sum(frequency*weight)/sum(weight) AS frequency,
           sum(action_ev*weight)/sum(weight) AS action_ev
      FROM action_observations GROUP BY hand_key,action_id
  ), per_hand AS (
    SELECT hand_key,
           jsonb_object_agg(action_id,to_jsonb(round(frequency,6)) ORDER BY action_id) AS mix,
           jsonb_object_agg(action_id,to_jsonb(round(action_ev,6)) ORDER BY action_id) AS action_evs
      FROM action_aggregate GROUP BY hand_key
  ), policy_aggregate AS (
    SELECT hand_key,sum(policy_ev*weight)/sum(weight) AS policy_ev
      FROM combo_observations GROUP BY hand_key
  )
  SELECT jsonb_object_agg(h.hand_key,h.mix ORDER BY h.hand_key),
         jsonb_object_agg(h.hand_key,to_jsonb(round(p.policy_ev,6)) ORDER BY h.hand_key),
         jsonb_object_agg(h.hand_key,h.action_evs ORDER BY h.hand_key)
    INTO v_hand_matrix,v_policy_evs,v_action_evs
    FROM per_hand h JOIN policy_aggregate p USING (hand_key);
  IF v_hand_matrix IS NULL OR v_policy_evs IS NULL OR v_action_evs IS NULL THEN
    RAISE EXCEPTION 'cell has no live training combinations';
  END IF;

  v_cell:=p_context||public.fn_gto_v31_feature_identity(v_dataset.feature_contract_version)||public.fn_gto_v31_policy_identity(v_dataset.policy_export_schema)||jsonb_build_object(
    'hand_matrix',v_hand_matrix,'action_specs',v_specs,
    'policy_ev_matrix',v_policy_evs,'action_ev_matrix',v_action_evs,
    'source_rows',v_source_rows,'train_source_rows',v_train_rows,
    'holdout_source_rows',v_holdout_rows,'lineage_checksum',v_lineage
  );
  v_cell:=v_cell||jsonb_build_object('cell_key_checksum',public.fn_gto_v31_cell_key_checksum(v_cell));
  v_cell:=v_cell||jsonb_build_object('cell_payload_checksum',public.fn_gto_v31_cell_payload_checksum(v_cell));
  IF NOT public.fn_gto_v31_cell_payload_valid(v_cell) THEN
    RAISE EXCEPTION 'database-computed compact cell failed its release validator';
  END IF;

  INSERT INTO public.gto_v31_runtime_cells (
    dataset_id,cell_key_checksum,street,game_family,objective,utility_context,
    table_size,pot_type,hero_position,opponent_position,depth_bucket,texture_class,
    node_role,facing_kind,facing_size_bucket,hand_matrix,action_specs,
    policy_ev_matrix,action_ev_matrix,source_rows,train_source_rows,
    holdout_source_rows,cell_payload_checksum,lineage_checksum,feature_contract_version,policy_export_schema
  ) VALUES (
    p_dataset_id,v_cell->>'cell_key_checksum',v_cell->>'street',v_cell->>'game_family',
    v_cell->>'objective',v_cell->>'utility_context',(v_cell->>'table_size')::smallint,
    v_cell->>'pot_type',v_cell->>'hero_position',v_cell->>'opponent_position',
    (v_cell->>'depth_bucket')::integer,v_cell->>'texture_class',v_cell->>'node_role',
    v_cell->>'facing_kind',v_cell->>'facing_size_bucket',v_cell->'hand_matrix',
    v_cell->'action_specs',v_cell->'policy_ev_matrix',v_cell->'action_ev_matrix',
    (v_cell->>'source_rows')::integer,(v_cell->>'train_source_rows')::integer,
    (v_cell->>'holdout_source_rows')::integer,v_cell->>'cell_payload_checksum',v_cell->>'lineage_checksum',v_dataset.feature_contract_version,v_dataset.policy_export_schema
  );

  INSERT INTO public.gto_v31_cell_source_receipts (
    dataset_id,cell_id,source_row_id,source_node,source_node_checksum,
    source_artifact_checksum,machine_id,split
  )
  SELECT p_dataset_id,c.cell_id,n.source_row_id,n.node->>'node',n.node->>'node_checksum',
         n.source_artifact_checksum,n.machine_id,n.split
    FROM public.gto_v31_runtime_cells c
    CROSS JOIN LATERAL jsonb_to_recordset(v_source_nodes) AS n(
      source_row_id uuid,machine_id text,source_artifact_checksum text,node jsonb,split text
    )
   WHERE c.dataset_id=p_dataset_id AND c.cell_key_checksum=v_cell->>'cell_key_checksum';
  IF NOT FOUND THEN RAISE EXCEPTION 'database-computed cell did not retain source receipts'; END IF;
  RETURN v_cell->>'cell_key_checksum';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_composition(p_cells jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'flop', (SELECT count(*) FROM jsonb_array_elements(p_cells) e WHERE e->>'street'='flop'),
    'turn', (SELECT count(*) FROM jsonb_array_elements(p_cells) e WHERE e->>'street'='turn'),
    'river',(SELECT count(*) FROM jsonb_array_elements(p_cells) e WHERE e->>'street'='river'))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_context_valid(p_context jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_size integer;
  v_role text;
  v_facing text;
  v_bucket text;
  v_allowed_positions text[];
  v_key text;
BEGIN
  IF p_context IS NULL OR jsonb_typeof(p_context) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_context)) <> 13
     OR NOT (p_context ?& ARRAY[
       'street','game_family','objective','utility_context','table_size','pot_type',
       'hero_position','opponent_position','depth_bucket','texture_class','node_role',
       'facing_kind','facing_size_bucket'
     ]) THEN
    RETURN false;
  END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'street','game_family','objective','utility_context','pot_type','hero_position',
    'opponent_position','texture_class','node_role','facing_kind','facing_size_bucket'
  ] LOOP
    IF jsonb_typeof(p_context->v_key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  END LOOP;
  IF NOT public.fn_gto_v31_json_safe_integer(p_context->'table_size',2,10)
     OR NOT public.fn_gto_v31_json_safe_integer(p_context->'depth_bucket',10,150)
     OR (p_context->>'depth_bucket')::integer NOT IN (10,20,40,80,150)
     OR p_context->>'street' NOT IN ('flop','turn','river')
     OR p_context->>'game_family' NOT IN ('cash','spin','tourney_ev','tourney_icm')
     OR p_context->>'objective' NOT IN ('cash_ev','chip_ev','icm')
     OR p_context->>'utility_context' NOT IN
       ('cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder')
     OR p_context->>'pot_type' NOT IN ('limped','srp','3bet','4bet_plus')
     OR p_context->>'texture_class' !~ '^[ABML][mtr][pu][cd]$'
     OR p_context->>'node_role' NOT IN
       ('open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise',
        'check_raise','bet_raise','all_in') THEN
    RETURN false;
  END IF;
  IF NOT (
       (p_context->>'game_family'='cash' AND p_context->>'objective'='cash_ev'
         AND p_context->>'utility_context'='cash_ev')
    OR (p_context->>'game_family'='spin' AND p_context->>'objective'='chip_ev'
         AND p_context->>'utility_context'='chip_ev')
    OR (p_context->>'game_family'='spin' AND p_context->>'objective'='icm'
         AND p_context->>'utility_context'='spin_ladder')
    OR (p_context->>'game_family'='tourney_ev' AND p_context->>'objective'='chip_ev'
         AND p_context->>'utility_context'='chip_ev')
    OR (p_context->>'game_family'='tourney_icm' AND p_context->>'objective'='icm'
         AND p_context->>'utility_context' IN
           ('satellite','bubble','final_table','in_money','ladder'))
  ) THEN
    RETURN false;
  END IF;

  v_table_size := (p_context->>'table_size')::integer;
  v_allowed_positions := CASE v_table_size
    WHEN 2 THEN ARRAY['SB','BB']
    WHEN 3 THEN ARRAY['SB','BB','BTN']
    WHEN 4 THEN ARRAY['SB','BB','CO','BTN']
    WHEN 5 THEN ARRAY['SB','BB','HJ','CO','BTN']
    WHEN 6 THEN ARRAY['SB','BB','UTG','HJ','CO','BTN']
    WHEN 7 THEN ARRAY['SB','BB','UTG','MP','HJ','CO','BTN']
    WHEN 8 THEN ARRAY['SB','BB','UTG','UTG1','MP','HJ','CO','BTN']
    WHEN 9 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','MP','HJ','CO','BTN']
    WHEN 10 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','UTG3','MP','HJ','CO','BTN']
  END;
  IF NOT (p_context->>'hero_position'=ANY(v_allowed_positions))
     OR NOT (p_context->>'opponent_position'=ANY(v_allowed_positions))
     OR p_context->>'hero_position'=p_context->>'opponent_position' THEN
    RETURN false;
  END IF;

  v_role := p_context->>'node_role';
  v_facing := p_context->>'facing_kind';
  v_bucket := p_context->>'facing_size_bucket';
  IF v_role IN ('open','cbet','probe','delayed_cbet','barrel') THEN
    RETURN v_facing='none' AND v_bucket='none';
  ELSIF v_role='all_in' THEN
    RETURN v_facing='all_in' AND v_bucket='all_in';
  ELSIF v_role='facing_bet' THEN
    RETURN v_facing='bet' AND v_bucket IN ('small','mid','big');
  END IF;
  RETURN v_facing='raise' AND v_bucket IN ('small','mid','big');
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_contract_v3_error(p_cell jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE v_role text; v_kind text; v_bucket text; v_street integer;
BEGIN
  IF jsonb_typeof(p_cell) IS DISTINCT FROM 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_cell) k) IS DISTINCT FROM
        ARRAY['cell_contract','depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position',
              'line_class','node_role','objective','opponent_position','pot_type','street','table_size',
              'texture_class','utility_context'] THEN
    RETURN 'a cell contract v3 cell has exactly the 13 V31 context keys, cell_contract and line_class';
  END IF;
  IF p_cell->'cell_contract' IS DISTINCT FROM '"v3"'::jsonb THEN
    RETURN 'cell_contract must be "v3"';
  END IF;
  v_street := array_position(ARRAY['flop','turn','river'], CASE WHEN jsonb_typeof(p_cell->'street') = 'string' THEN p_cell->>'street' END);
  IF v_street IS NULL THEN
    RETURN 'a v3 cell street is flop, turn or river';
  END IF;
  IF jsonb_typeof(p_cell->'depth_bucket') IS DISTINCT FROM 'number' OR p_cell->>'depth_bucket' NOT IN ('10','20','40','80','150','200') THEN
    RETURN 'a v3 cell depth_bucket is 10, 20, 40, 80, 150 or 200';
  END IF;
  IF jsonb_typeof(p_cell->'line_class') IS DISTINCT FROM 'string'
     OR p_cell->>'line_class' !~ '^((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?(/((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?){0,2}$'
     OR length(p_cell->>'line_class') - length(replace(p_cell->>'line_class', '/', '')) <> v_street - 1 THEN
    RETURN format('a v3 %s cell line_class "%s" is malformed or names another street', p_cell->>'street', p_cell->>'line_class');
  END IF;
  v_role := p_cell->>'node_role'; v_kind := p_cell->>'facing_kind'; v_bucket := p_cell->>'facing_size_bucket';
  IF NOT ((v_role IN ('open','cbet','probe','delayed_cbet','barrel','donk') AND v_kind = 'none' AND v_bucket = 'none')
          OR (v_role = 'all_in' AND v_kind = 'all_in' AND v_bucket = 'all_in')
          OR (v_role = 'facing_bet' AND v_kind = 'bet' AND v_bucket IN ('small','mid','big'))
          OR (v_role IN ('facing_raise','check_raise','bet_raise') AND v_kind = 'raise' AND v_bucket IN ('small','mid','big'))) THEN
    RETURN format('a v3 cell role %s, facing %s and size %s disagree', v_role, v_kind, v_bucket);
  END IF;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_key_checksum(p_cell jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_gto_v31_json_checksum(jsonb_build_object(
    'street',p_cell->'street',
    'game_family',p_cell->'game_family',
    'objective',p_cell->'objective',
    'utility_context',p_cell->'utility_context',
    'table_size',p_cell->'table_size',
    'pot_type',p_cell->'pot_type',
    'hero_position',p_cell->'hero_position',
    'opponent_position',p_cell->'opponent_position',
    'depth_bucket',p_cell->'depth_bucket',
    'texture_class',p_cell->'texture_class',
    'node_role',p_cell->'node_role',
    'facing_kind',p_cell->'facing_kind',
    'facing_size_bucket',p_cell->'facing_size_bucket'
  ) || public.fn_gto_v31_feature_identity(p_cell->>'feature_contract_version')||public.fn_gto_v31_policy_identity(p_cell->>'policy_export_schema'));
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_payload_checksum(p_cell jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE identity jsonb;
BEGIN
 IF COALESCE(p_cell->>'policy_representation','matrix_v2')='matrix_v2' THEN RETURN public.fn_gto_v31_cell_payload_checksum_matrix_v2(p_cell);END IF;
 IF p_cell->>'policy_representation'<>'public_hist215_v1' THEN RAISE EXCEPTION 'unknown policy representation';END IF;
 identity:=jsonb_build_object('contract','public_hist215_cell_payload_v1',
 'cell_key_checksum',p_cell->'cell_key_checksum',
 'street',p_cell->'street',
 'game_family',p_cell->'game_family',
 'objective',p_cell->'objective',
 'utility_context',p_cell->'utility_context',
 'table_size',p_cell->'table_size',
 'pot_type',p_cell->'pot_type',
 'hero_position',p_cell->'hero_position',
 'opponent_position',p_cell->'opponent_position',
 'depth_bucket',p_cell->'depth_bucket',
 'texture_class',p_cell->'texture_class',
 'node_role',p_cell->'node_role',
 'facing_kind',p_cell->'facing_kind',
 'facing_size_bucket',p_cell->'facing_size_bucket',
 'feature_contract_version',p_cell->'feature_contract_version',
 'policy_export_schema',p_cell->'policy_export_schema',
 'policy_representation',p_cell->'policy_representation',
 'action_specs',p_cell->'action_specs',
 'public_model',p_cell->'public_model',
 'public_template',p_cell->'public_template',
 'public_training_provenance',p_cell->'public_training_provenance',
 'public_model_build_receipt',p_cell->'public_model_build_receipt',
 'model_checksum',p_cell->'model_checksum',
 'template_checksum',p_cell->'template_checksum',
 'feature_schema_checksum',p_cell->'feature_schema_checksum',
 'training_provenance_checksum',p_cell->'training_provenance_checksum',
 'model_build_receipt_checksum',p_cell->'model_build_receipt_checksum',
 'sql_physics_checksum',p_cell->'sql_physics_checksum',
 'source_rows',p_cell->'source_rows',
 'train_source_rows',p_cell->'train_source_rows',
 'holdout_source_rows',p_cell->'holdout_source_rows',
 'lineage_checksum',p_cell->'lineage_checksum');
 RETURN public.fn_gto_v31_json_checksum(identity);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_payload_checksum_matrix_v2(p_cell jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_gto_v31_json_checksum(jsonb_build_object(
    'cell_key_checksum',public.fn_gto_v31_cell_key_checksum(p_cell),
    'hand_matrix',p_cell->'hand_matrix',
    'action_specs',p_cell->'action_specs',
    'policy_ev_matrix',COALESCE(p_cell->'policy_ev_matrix','{}'::jsonb),
    'action_ev_matrix',COALESCE(p_cell->'action_ev_matrix','{}'::jsonb),
    'source_rows',p_cell->'source_rows',
    'train_source_rows',p_cell->'train_source_rows',
    'holdout_source_rows',p_cell->'holdout_source_rows'
  ));
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_payload_valid(p_cell jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
BEGIN
 IF COALESCE(p_cell->>'policy_representation','matrix_v2')='matrix_v2' THEN RETURN public.fn_gto_v31_cell_payload_valid_matrix_v2(p_cell);END IF;
 IF public.fn_gto_v31_public215_cell_model_valid(p_cell) IS NOT TRUE OR p_cell->>'cell_key_checksum' IS DISTINCT FROM public.fn_gto_v31_cell_key_checksum(p_cell) OR p_cell->>'cell_payload_checksum' IS DISTINCT FROM public.fn_gto_v31_cell_payload_checksum(p_cell) OR NOT public.fn_gto_v31_json_safe_integer(p_cell->'train_source_rows',1,9007199254740991) OR NOT public.fn_gto_v31_json_safe_integer(p_cell->'holdout_source_rows',1,9007199254740991) OR (p_cell->>'source_rows')::numeric<>(p_cell->>'train_source_rows')::numeric+(p_cell->>'holdout_source_rows')::numeric OR COALESCE(p_cell->>'lineage_checksum','')!~'^[0-9a-f]{64}$' THEN RETURN false;END IF;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_payload_valid_matrix_v2(p_cell jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := p_cell->>'node_role';
  v_facing text := p_cell->>'facing_kind';
  v_bucket text := p_cell->>'facing_size_bucket';
  v_action record;
  v_hand record;
  v_frequency record;
  v_sum numeric;
  v_family text;
  v_unit text;
  v_size numeric;
  v_actions jsonb := p_cell->'action_specs';
  v_matrix jsonb := p_cell->'hand_matrix';
  v_policy_evs jsonb := COALESCE(p_cell->'policy_ev_matrix', '{}'::jsonb);
  v_action_evs jsonb := COALESCE(p_cell->'action_ev_matrix', '{}'::jsonb);
  v_has_check boolean := false;
  v_has_fold boolean := false;
  v_has_call boolean := false;
  v_has_bet boolean := false;
  v_has_raise boolean := false;
  v_has_all_in boolean := false;
  v_table_size integer := COALESCE((p_cell->>'table_size')::integer,0);
  v_allowed_positions text[];
BEGIN
  IF p_cell IS NULL OR jsonb_typeof(p_cell) <> 'object'
     OR NOT public.fn_gto_v31_compact_matrices_valid(
       v_matrix,v_actions,v_policy_evs,v_action_evs,p_cell->>'street',p_cell->>'feature_contract_version'
     )
     OR jsonb_typeof(p_cell->'source_rows') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_cell->'train_source_rows') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_cell->'holdout_source_rows') IS DISTINCT FROM 'number'
     OR (p_cell->>'source_rows')::integer IS DISTINCT FROM
        (p_cell->>'train_source_rows')::integer + (p_cell->>'holdout_source_rows')::integer
     OR COALESCE(p_cell->>'cell_key_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_cell->>'cell_key_checksum' = repeat('0',64)
     OR p_cell->>'cell_key_checksum' IS DISTINCT FROM public.fn_gto_v31_cell_key_checksum(p_cell)
     OR COALESCE(p_cell->>'cell_payload_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_cell->>'cell_payload_checksum' = repeat('0',64)
     OR p_cell->>'cell_payload_checksum' IS DISTINCT FROM public.fn_gto_v31_cell_payload_checksum(p_cell)
     OR COALESCE(p_cell->>'lineage_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_cell->>'lineage_checksum' = repeat('0',64)
     OR COALESCE(p_cell->>'street','') NOT IN ('flop','turn','river')
     OR COALESCE(p_cell->>'game_family','') NOT IN ('cash','spin','tourney_ev','tourney_icm')
     OR COALESCE(p_cell->>'objective','') NOT IN ('cash_ev','chip_ev','icm')
     OR COALESCE(p_cell->>'utility_context','') NOT IN ('cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder')
     OR v_table_size NOT BETWEEN 2 AND 10
     OR COALESCE(p_cell->>'pot_type','') NOT IN ('limped','srp','3bet','4bet_plus')
     OR COALESCE(p_cell->>'hero_position','') NOT IN ('UTG','UTG1','UTG2','UTG3','MP','HJ','CO','BTN','SB','BB')
     OR COALESCE(p_cell->>'opponent_position','') NOT IN ('UTG','UTG1','UTG2','UTG3','MP','HJ','CO','BTN','SB','BB')
     OR p_cell->>'hero_position' = p_cell->>'opponent_position'
     OR COALESCE((p_cell->>'depth_bucket')::integer,0) NOT IN (10,20,40,80,150)
     OR COALESCE(p_cell->>'texture_class','') !~ '^[ABML][mtr][pu][cd]$'
     OR COALESCE(v_role,'') NOT IN ('open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in')
     OR COALESCE(v_facing,'') NOT IN ('none','bet','raise','all_in')
     OR COALESCE(v_bucket,'') NOT IN ('none','small','mid','big','all_in')
     OR jsonb_typeof(v_actions) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_actions)) < 2
     OR jsonb_typeof(v_matrix) <> 'object'
     OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_matrix))
     OR jsonb_typeof(v_policy_evs) <> 'object'
     OR jsonb_typeof(v_action_evs) <> 'object'
     OR COALESCE((p_cell->>'source_rows')::integer,0) <= 0
     OR COALESCE((p_cell->>'train_source_rows')::integer,0) <= 0
     OR COALESCE((p_cell->>'holdout_source_rows')::integer,0) <= 0 THEN
    RETURN false;
  END IF;

  IF NOT ((p_cell->>'game_family' = 'cash' AND p_cell->>'objective' = 'cash_ev') OR
          (p_cell->>'game_family' = 'tourney_icm' AND p_cell->>'objective' = 'icm') OR
          (p_cell->>'game_family' = 'tourney_ev' AND p_cell->>'objective' = 'chip_ev') OR
          (p_cell->>'game_family' = 'spin' AND p_cell->>'objective' IN ('chip_ev','icm'))) THEN
    RETURN false;
  END IF;
  IF NOT ((p_cell->>'objective' = 'cash_ev' AND p_cell->>'utility_context' = 'cash_ev') OR
          (p_cell->>'objective' = 'chip_ev' AND p_cell->>'utility_context' = 'chip_ev') OR
          (p_cell->>'objective' = 'icm' AND p_cell->>'game_family' = 'spin' AND
           p_cell->>'utility_context' = 'spin_ladder') OR
          (p_cell->>'objective' = 'icm' AND p_cell->>'game_family' = 'tourney_icm' AND
           p_cell->>'utility_context' IN ('satellite','bubble','final_table','in_money','ladder'))) THEN
    RETURN false;
  END IF;

  v_allowed_positions := CASE v_table_size
    WHEN 2 THEN ARRAY['SB','BB']
    WHEN 3 THEN ARRAY['SB','BB','BTN']
    WHEN 4 THEN ARRAY['SB','BB','CO','BTN']
    WHEN 5 THEN ARRAY['SB','BB','HJ','CO','BTN']
    WHEN 6 THEN ARRAY['SB','BB','UTG','HJ','CO','BTN']
    WHEN 7 THEN ARRAY['SB','BB','UTG','MP','HJ','CO','BTN']
    WHEN 8 THEN ARRAY['SB','BB','UTG','UTG1','MP','HJ','CO','BTN']
    WHEN 9 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','MP','HJ','CO','BTN']
    WHEN 10 THEN ARRAY['SB','BB','UTG','UTG1','UTG2','UTG3','MP','HJ','CO','BTN']
  END;
  IF NOT (p_cell->>'hero_position' = ANY(v_allowed_positions))
     OR NOT (p_cell->>'opponent_position' = ANY(v_allowed_positions)) THEN
    RETURN false;
  END IF;

  IF v_role IN ('open','cbet','probe','delayed_cbet','barrel') THEN
    IF v_facing <> 'none' OR v_bucket <> 'none' THEN RETURN false; END IF;
  ELSIF v_role = 'all_in' THEN
    IF v_facing <> 'all_in' OR v_bucket <> 'all_in' THEN RETURN false; END IF;
  ELSIF (v_role = 'facing_bet' AND v_facing <> 'bet')
     OR (v_role IN ('facing_raise','check_raise','bet_raise') AND v_facing <> 'raise')
     OR v_bucket NOT IN ('small','mid','big') THEN
    RETURN false;
  END IF;

  FOR v_action IN SELECT key, value FROM jsonb_each(v_actions) LOOP
    IF v_action.key = '' OR jsonb_typeof(v_action.value) <> 'object' THEN RETURN false; END IF;
    v_family := v_action.value->>'family';
    v_unit := v_action.value->>'size_unit';
    IF v_family NOT IN ('check','fold','call','bet','raise','all_in') THEN RETURN false; END IF;
    IF v_family = 'check' THEN v_has_check := true; END IF;
    IF v_family = 'fold' THEN v_has_fold := true; END IF;
    IF v_family = 'call' THEN v_has_call := true; END IF;
    IF v_family = 'bet' THEN v_has_bet := true; END IF;
    IF v_family = 'raise' THEN v_has_raise := true; END IF;
    IF v_family = 'all_in' THEN v_has_all_in := true; END IF;
    IF v_family IN ('check','fold','call') THEN
      IF v_unit IS DISTINCT FROM 'none'
         OR v_action.value->'size_value' IS DISTINCT FROM 'null'::jsonb
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM false THEN RETURN false; END IF;
    ELSIF v_family = 'all_in' THEN
      IF v_unit IS DISTINCT FROM 'all_in'
         OR v_action.value->'size_value' IS DISTINCT FROM 'null'::jsonb
         OR (v_action.value->>'all_in')::boolean IS DISTINCT FROM true THEN RETURN false; END IF;
    ELSE
      BEGIN v_size := (v_action.value->>'size_value')::numeric; EXCEPTION WHEN OTHERS THEN RETURN false; END;
      IF v_size <= 0 OR v_size > 20 OR COALESCE((v_action.value->>'all_in')::boolean,false)
         OR (v_family = 'bet' AND v_unit <> 'pot_fraction')
         OR (v_family = 'raise' AND v_unit <> 'pot_after_call_fraction') THEN RETURN false; END IF;
    END IF;
  END LOOP;

  IF v_role IN ('open','cbet','probe','delayed_cbet','barrel') THEN
    IF NOT v_has_check OR v_has_fold OR v_has_call THEN RETURN false; END IF;
  ELSE
    IF NOT v_has_fold OR NOT v_has_call OR v_has_check OR v_has_bet THEN RETURN false; END IF;
    IF v_role = 'all_in' AND (v_has_raise OR v_has_all_in) THEN RETURN false; END IF;
  END IF;

  FOR v_hand IN SELECT key, value FROM jsonb_each(v_matrix) LOOP
    IF NOT public.fn_gto_v31_feature_key_valid(v_hand.key,p_cell->>'street',p_cell->>'feature_contract_version')
       OR jsonb_typeof(v_hand.value) <> 'object'
       OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_hand.value)) THEN
      RETURN false;
    END IF;
    v_sum := 0;
    FOR v_frequency IN SELECT key, value FROM jsonb_each(v_hand.value) LOOP
      IF NOT (v_actions ? v_frequency.key) OR jsonb_typeof(v_frequency.value) <> 'number' THEN RETURN false; END IF;
      BEGIN v_size := (v_frequency.value #>> '{}')::numeric; EXCEPTION WHEN OTHERS THEN RETURN false; END;
      IF v_size < 0 OR v_size > 1 THEN RETURN false; END IF;
      v_sum := v_sum + v_size;
    END LOOP;
    IF abs(v_sum - 1) > 0.002 THEN RETURN false; END IF;

    IF NOT (v_policy_evs ? v_hand.key)
       OR jsonb_typeof(v_policy_evs -> (v_hand.key)) <> 'number' THEN
      RETURN false;
    END IF;
    IF NOT (v_action_evs ? v_hand.key)
       OR jsonb_typeof(v_action_evs -> (v_hand.key)) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_action_evs -> (v_hand.key))) <>
          (SELECT count(*) FROM jsonb_object_keys(v_actions))
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_actions) a(key)
            WHERE NOT ((v_action_evs -> (v_hand.key)) ? a.key)) THEN
      RETURN false;
    END IF;
    FOR v_frequency IN SELECT key, value FROM jsonb_each(v_action_evs -> (v_hand.key)) LOOP
      IF NOT (v_actions ? v_frequency.key)
         OR jsonb_typeof(v_frequency.value) <> 'number' THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
       SELECT 1 FROM jsonb_object_keys(v_policy_evs) AS k(value) WHERE NOT (v_matrix ? k.value)
     ) OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(v_action_evs) AS k(value) WHERE NOT (v_matrix ? k.value)
     ) THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_provenance_error(p_cells jsonb, p_provenance jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE e jsonb; s jsonb; g jsonb; m jsonb; u jsonb; v_rc text; v_real integer; v_label text;
        v_decided text[]; v_seats text[]; v_hero integer; v_line text;
BEGIN
  IF p_provenance IS NULL OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'array' THEN
    RETURN 'range provenance is missing: every registered cell declares how its ranges were constructed';
  END IF;
  IF jsonb_array_length(p_provenance) <> jsonb_array_length(p_cells)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_provenance) x
                 WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR jsonb_typeof(x->'cell') IS DISTINCT FROM 'object')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_cells) c
                 WHERE (SELECT count(*) FROM jsonb_array_elements(p_provenance) x
                         WHERE public.fn_gto_v31_public215_canonical(x->'cell') = public.fn_gto_v31_public215_canonical(c)) <> 1) THEN
    RETURN 'range provenance is missing for a registered cell: exactly one provenance entry per registered cell';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_provenance) LOOP
    v_label := format('%s %s %s v %s %s', e#>>'{cell,street}', e#>>'{cell,node_role}', e#>>'{cell,hero_position}',
                      e#>>'{cell,opponent_position}', e#>>'{cell,texture_class}');
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) IS DISTINCT FROM
       ARRAY['cell','game','public_history','range_construction','runtime_mapping','unnarrowed_seats','upstream_solve_checksum'] THEN
      RETURN format('cell %s range provenance must have exactly cell, range_construction, public_history, upstream_solve_checksum, unnarrowed_seats, game and runtime_mapping', v_label);
    END IF;
    v_rc := CASE WHEN jsonb_typeof(e->'range_construction') = 'string' THEN e->>'range_construction' END;
    IF v_rc = 'forced' THEN
      RETURN format('cell %s declares range_construction "forced": a forced-line (conditional_history) cell keeps full root ranges after earlier decisions and can never be registered', v_label);
    END IF;
    IF v_rc IS NULL OR v_rc NOT IN ('root','natural','subgame') THEN
      RETURN format('cell %s has unknown range_construction %s: it must be root, natural or subgame', v_label, COALESCE(e->>'range_construction','(none)'));
    END IF;
    -- The runtime mapping: the cell's own key components, the acting solver
    -- seat and the seat -> position map, all consistent with each other.
    m := e->'runtime_mapping';
    IF jsonb_typeof(m) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k) IS DISTINCT FROM
          (CASE WHEN jsonb_typeof(e->'cell') = 'object' AND e->'cell' ? 'cell_contract'
               -- cell contract v3: the mapping also names the contract and the line
               THEN ARRAY['cell_contract','depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position',
                          'hero_solver_player','line_class','node_role','objective','opponent_position','pot_type',
                          'solver_positions','street','table_size','utility_context']
               ELSE ARRAY['depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position','hero_solver_player',
                'node_role','objective','opponent_position','pot_type','solver_positions','street','table_size','utility_context'] END)
       OR (m - 'hero_solver_player' - 'solver_positions') IS DISTINCT FROM ((e->'cell') - 'texture_class')
       OR jsonb_typeof(m->'hero_solver_player') IS DISTINCT FROM 'number' OR m->>'hero_solver_player' NOT IN ('0','1')
       OR jsonb_typeof(m->'solver_positions') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'solver_positions') <> 2
       OR jsonb_typeof(m#>'{solver_positions,0}') IS DISTINCT FROM 'string'
       OR jsonb_typeof(m#>'{solver_positions,1}') IS DISTINCT FROM 'string'
       OR m#>>'{solver_positions,0}' = m#>>'{solver_positions,1}' THEN
      RETURN format('cell %s runtime_mapping must name exactly the registered cell''s key components (street, node role, facing, positions, depth and game keys), the acting solver seat and the two solver seat positions', v_label);
    END IF;
    v_hero := (m->>'hero_solver_player')::integer;
    IF m->'solver_positions'->v_hero IS DISTINCT FROM e#>'{cell,hero_position}'
       OR m->'solver_positions'->(1 - v_hero) IS DISTINCT FROM e#>'{cell,opponent_position}' THEN
      RETURN format('cell %s runtime_mapping seat disagrees with the cell: solver seat %s sits at %s, but the cell''s hero is %s', v_label,
                    v_hero, m->'solver_positions'->>v_hero, e#>>'{cell,hero_position}');
    END IF;
    IF jsonb_typeof(e->'public_history') IS DISTINCT FROM 'array' THEN
      RETURN format('cell %s public_history must be the ordered list of public actions before the node', v_label);
    END IF;
    v_real := 0;
    v_decided := ARRAY[]::text[];
    FOR s IN SELECT value FROM jsonb_array_elements(e->'public_history') LOOP
      IF jsonb_typeof(s) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(s) k) IS DISTINCT FROM
            ARRAY['available_actions','family','position','solver_player','street','target_chips']
         OR jsonb_typeof(s->'family') IS DISTINCT FROM 'string'
         OR s->>'family' NOT IN ('check','bet','call','raise','all_in')
         OR jsonb_typeof(s->'street') IS DISTINCT FROM 'string' OR s->>'street' NOT IN ('flop','turn','river')
         OR jsonb_typeof(s->'position') IS DISTINCT FROM 'string' OR btrim(s->>'position') = ''
         OR jsonb_typeof(s->'solver_player') IS DISTINCT FROM 'number' OR s->>'solver_player' NOT IN ('0','1')
         OR jsonb_typeof(s->'target_chips') IS DISTINCT FROM 'number' OR s->>'target_chips' !~ '^[0-9]{1,15}$'
         OR jsonb_typeof(s->'available_actions') IS DISTINCT FROM 'number' OR s->>'available_actions' !~ '^[1-9][0-9]?$' THEN
        RETURN format('cell %s public_history step is malformed: each step has street, position, solver_player, family, target_chips and available_actions', v_label);
      END IF;
      IF s->'position' IS DISTINCT FROM m->'solver_positions'->((s->>'solver_player')::integer) THEN
        RETURN format('cell %s public_history step by solver seat %s at %s disagrees with the runtime mapping''s seat positions', v_label,
                      s->>'solver_player', s->>'position');
      END IF;
      -- available_actions is DECLARED: the database cannot read the betting
      -- tree and trusts this count. The pipeline is the check (World Hub
      -- public_hist215.build_cell_provenance derives it from tree_lines and
      -- verify_round_registration refuses any other value).
      IF s->>'family' <> 'check' AND (s->>'available_actions')::integer < 2 THEN
        RETURN format('cell %s declares a %s as a one-action step: a bet, call, raise or all-in is always a decision with more than one available action', v_label, s->>'family');
      END IF;
      IF (s->>'available_actions')::integer >= 2 THEN
        v_real := v_real + 1;
        v_decided := v_decided || CASE s->>'solver_player' WHEN '0' THEN 'OOP' ELSE 'IP' END;
      END IF;
    END LOOP;
    IF v_rc = 'root' AND v_real > 0 THEN
      RETURN format('cell %s declares range_construction "root" after %s earlier decision(s) with more than one available action: such a node is natural or subgame, never root', v_label, v_real);
    END IF;
    IF v_rc = 'subgame' THEN
      -- Recorded, not verified: no table here holds the upstream solve.
      IF jsonb_typeof(e->'upstream_solve_checksum') IS DISTINCT FROM 'string'
         OR e->>'upstream_solve_checksum' !~ '^[0-9a-f]{64}$' OR e->>'upstream_solve_checksum' = repeat('0',64) THEN
        RETURN format('cell %s is a subgame and must name the upstream solve whose natural ranges are its inputs (upstream_solve_checksum)', v_label);
      END IF;
    ELSIF e->'upstream_solve_checksum' IS DISTINCT FROM 'null'::jsonb THEN
      RETURN format('cell %s is not a subgame and may not name an upstream solve', v_label);
    END IF;
    -- A seat that took one action with every hand at its earlier decision
    -- legitimately holds an unnarrowed range; it must be declared, and the
    -- seal then requires the data to show it.
    IF jsonb_typeof(e->'unnarrowed_seats') IS DISTINCT FROM 'array' THEN
      RETURN format('cell %s unnarrowed_seats must be a list (empty when every deciding seat narrowed)', v_label);
    END IF;
    v_seats := ARRAY[]::text[];
    FOR u IN SELECT value FROM jsonb_array_elements(e->'unnarrowed_seats') LOOP
      IF jsonb_typeof(u) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(u) k) IS DISTINCT FROM ARRAY['reason','seat','upstream_evidence_checksum']
         OR u->'seat' NOT IN ('"OOP"'::jsonb, '"IP"'::jsonb)
         OR u->'reason' IS DISTINCT FROM '"pure_prior_action"'::jsonb
         OR jsonb_typeof(u->'upstream_evidence_checksum') IS DISTINCT FROM 'string'
         OR u->>'upstream_evidence_checksum' !~ '^[0-9a-f]{64}$' OR u->>'upstream_evidence_checksum' = repeat('0',64) THEN
        RETURN format('cell %s unnarrowed seat is malformed: each has exactly seat (OOP or IP), reason pure_prior_action and upstream_evidence_checksum', v_label);
      END IF;
      IF v_rc = 'root' THEN
        RETURN format('cell %s is root: no seat has decided, so none can be declared unnarrowed', v_label);
      END IF;
      IF u->>'seat' = ANY(v_seats) THEN
        RETURN format('cell %s declares seat %s unnarrowed twice', v_label, u->>'seat');
      END IF;
      IF NOT (u->>'seat' = ANY(v_decided)) THEN
        RETURN format('cell %s declares %s unnarrowed by a pure prior action, but %s made no earlier decision with more than one available action', v_label, u->>'seat', u->>'seat');
      END IF;
      -- Only a seat that CHECKED at every earlier decision can keep an
      -- unnarrowed range legitimately; a bet, call, raise or all-in is the
      -- forced-line pattern (R8) and can never be waived by a declaration.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(e->'public_history') h
                  WHERE h->>'solver_player' = CASE u->>'seat' WHEN 'OOP' THEN '0' ELSE '1' END
                    AND h->>'family' <> 'check') THEN
        RETURN format('cell %s declares %s unnarrowed, but %s bet, called, raised or went all-in before the node: only a seat whose every earlier decision was a check can be declared unnarrowed', v_label, u->>'seat', u->>'seat');
      END IF;
      v_seats := v_seats || (u->>'seat');
    END LOOP;
    -- At least one deciding seat must stay undeclared and show narrowing,
    -- unless the cell has a single deciding seat (qualified above).
    IF cardinality(v_seats) > 0
       AND (SELECT count(DISTINCT x) FROM unnest(v_decided) x) >= 2
       AND cardinality(v_seats) >= (SELECT count(DISTINCT x) FROM unnest(v_decided) x) THEN
      RETURN format('cell %s declares every deciding seat unnarrowed: at least one seat with a real earlier decision must show an action-conditioned range', v_label);
    END IF;
    -- Cell contract v3: the cell must be a valid v3 context and its line_class
    -- must name exactly the public history, step by step and street by street
    -- (x check, c call, b bet, r raise, a all-in; sizes are the pipeline's).
    IF e->'cell' ? 'cell_contract' THEN
      IF public.fn_gto_v31_cell_contract_v3_error(e->'cell') IS NOT NULL THEN
        RETURN format('cell %s %s', v_label, public.fn_gto_v31_cell_contract_v3_error(e->'cell'));
      END IF;
      SELECT string_agg(z.part, '/' ORDER BY z.s) INTO v_line FROM (
        SELECT s.s, COALESCE((SELECT string_agg(CASE q.h->>'family' WHEN 'check' THEN 'x' WHEN 'call' THEN 'c'
                                                 WHEN 'bet' THEN 'b' WHEN 'raise' THEN 'r' ELSE 'a' END, '.' ORDER BY q.o)
                                FROM jsonb_array_elements(e->'public_history') WITH ORDINALITY q(h, o)
                               WHERE q.h->>'street' = (ARRAY['flop','turn','river'])[s.s]), '') AS part
          FROM generate_series(1, array_position(ARRAY['flop','turn','river'], e#>>'{cell,street}')) s(s)) z;
      IF v_line IS DISTINCT FROM regexp_replace(e#>>'{cell,line_class}', '-(small|mid|big)', '', 'g')
         OR (SELECT count(*) FROM jsonb_array_elements(e->'public_history') h
              WHERE array_position(ARRAY['flop','turn','river'], h->>'street')
                    > array_position(ARRAY['flop','turn','river'], e#>>'{cell,street}')) > 0 THEN
        RETURN format('cell %s line_class "%s" does not name its public history (%s)', v_label, e#>>'{cell,line_class}', COALESCE(v_line, 'none'));
      END IF;
    END IF;
    g := e->'game';
    IF jsonb_typeof(g) IS DISTINCT FROM 'object'
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(g) k) IS DISTINCT FROM
          ARRAY['betting_tree_checksum','chips_per_bb','depth_bucket','effective_stack_chips','players_to_flop',
                'pot_type','rake','root_pot_chips','variant']
       OR g->'variant' IS DISTINCT FROM '"nlh"'::jsonb
       OR g->'players_to_flop' IS DISTINCT FROM '2'::jsonb
       OR g->'pot_type' IS DISTINCT FROM e#>'{cell,pot_type}'
       OR g->'depth_bucket' IS DISTINCT FROM e#>'{cell,depth_bucket}'
       OR jsonb_typeof(g->'chips_per_bb') IS DISTINCT FROM 'number' OR g->>'chips_per_bb' !~ '^[1-9][0-9]{0,8}$'
       OR jsonb_typeof(g->'effective_stack_chips') IS DISTINCT FROM 'number' OR g->>'effective_stack_chips' !~ '^[1-9][0-9]{0,14}$'
       OR jsonb_typeof(g->'root_pot_chips') IS DISTINCT FROM 'number' OR g->>'root_pot_chips' !~ '^[1-9][0-9]{0,14}$'
       OR (g->>'effective_stack_chips')::numeric <> (g->>'depth_bucket')::numeric * (g->>'chips_per_bb')::numeric
       OR jsonb_typeof(g->'rake') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'rake') <> 2
       OR jsonb_typeof(g#>'{rake,0}') IS DISTINCT FROM 'number' OR (g#>>'{rake,0}')::numeric NOT BETWEEN 0 AND 1
       OR jsonb_typeof(g#>'{rake,1}') IS DISTINCT FROM 'number' OR g#>>'{rake,1}' !~ '^[0-9]{1,15}$'
       OR jsonb_typeof(g->'betting_tree_checksum') IS DISTINCT FROM 'string'
       OR g->>'betting_tree_checksum' !~ '^[0-9a-f]{64}$' OR g->>'betting_tree_checksum' = repeat('0',64) THEN
      RETURN format('cell %s game assumptions are missing or disagree with the cell: variant nlh, players_to_flop 2, the cell''s pot_type and depth_bucket, chips_per_bb, effective_stack_chips, root_pot_chips, rake [fraction, cap] and betting_tree_checksum', v_label);
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN 'range provenance is malformed: ' || SQLERRM;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_cell_set_checksum(p_cells jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_gto_v31_public215_digest(COALESCE(
    (SELECT jsonb_agg(e ORDER BY public.fn_gto_v31_public215_canonical(e) COLLATE "C")
       FROM jsonb_array_elements(p_cells) e), '[]'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_combo_cards(p_combo_index integer)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  v_high integer;
  v_low integer;
  v_ranks constant text := '23456789TJQKA';
  v_suits constant text := 'cdhs';
  v_card_low text;
  v_card_high text;
BEGIN
  IF p_combo_index < 0 OR p_combo_index > 1325 THEN RETURN NULL; END IF;
  v_high := floor((1 + sqrt(1 + 8 * p_combo_index)) / 2)::integer;
  WHILE v_high * (v_high - 1) / 2 > p_combo_index LOOP v_high := v_high - 1; END LOOP;
  WHILE (v_high + 1) * v_high / 2 <= p_combo_index LOOP v_high := v_high + 1; END LOOP;
  v_low := p_combo_index - v_high * (v_high - 1) / 2;
  v_card_low := substr(v_ranks, v_low / 4 + 1, 1) || substr(v_suits, mod(v_low,4) + 1, 1);
  v_card_high := substr(v_ranks, v_high / 4 + 1, 1) || substr(v_suits, mod(v_high,4) + 1, 1);
  RETURN ARRAY[v_card_low,v_card_high];
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_compact_matrices_valid(p_matrix jsonb, p_specs jsonb, p_policy_evs jsonb, p_action_evs jsonb, p_street text, p_version text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hand record;
  v_action text;
  v_value numeric;
  v_sum numeric;
  v_action_count integer;
BEGIN
  IF p_version IN('holdem-public-hist215-v1','holdem-public-hist215-v2') THEN
    RETURN COALESCE(p_matrix IS NULL AND p_policy_evs IS NULL AND p_action_evs IS NULL AND p_street IN ('flop','turn','river') AND public.fn_gto_v31_action_specs_valid(p_specs),false);
  END IF;
  IF NOT public.fn_gto_v31_action_specs_valid(p_specs)
     OR NOT public.fn_gto_v31_hand_matrix_valid(p_matrix,p_street,p_version)
     OR jsonb_typeof(p_policy_evs) <> 'object'
     OR jsonb_typeof(p_action_evs) <> 'object' THEN
    RETURN false;
  END IF;
  v_action_count := (SELECT count(*) FROM jsonb_object_keys(p_specs));
  IF (SELECT count(*) FROM jsonb_object_keys(p_policy_evs)) <>
       (SELECT count(*) FROM jsonb_object_keys(p_matrix))
     OR (SELECT count(*) FROM jsonb_object_keys(p_action_evs)) <>
       (SELECT count(*) FROM jsonb_object_keys(p_matrix)) THEN
    RETURN false;
  END IF;

  FOR v_hand IN SELECT key,value FROM jsonb_each(p_matrix) LOOP
    IF jsonb_typeof(v_hand.value) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_hand.value)) <> v_action_count
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_specs) a(key)
          WHERE NOT (v_hand.value ? a.key)
       )
       OR NOT (p_policy_evs ? v_hand.key)
       OR jsonb_typeof(p_policy_evs->v_hand.key) <> 'number'
       OR NOT (p_action_evs ? v_hand.key)
       OR jsonb_typeof(p_action_evs->v_hand.key) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_action_evs->v_hand.key)) <> v_action_count
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(p_specs) a(key)
          WHERE NOT ((p_action_evs->v_hand.key) ? a.key)
       ) THEN
      RETURN false;
    END IF;
    v_sum := 0;
    FOR v_action IN SELECT jsonb_object_keys(p_specs) LOOP
      IF jsonb_typeof(v_hand.value->v_action) <> 'number'
         OR jsonb_typeof(p_action_evs->v_hand.key->v_action) <> 'number' THEN
        RETURN false;
      END IF;
      v_value := (v_hand.value->>v_action)::numeric;
      IF v_value < 0 OR v_value > 1 THEN RETURN false; END IF;
      v_sum := v_sum + v_value;
    END LOOP;
    IF abs(v_sum - 1) > 0.002 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

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
   target:=substring(token FROM 2)::numeric-(spent[actor+1]-contribution[actor+1]); -- Pio bN: total since root
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

CREATE OR REPLACE FUNCTION public.fn_gto_v31_composition_text(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
  SELECT format('%s flop / %s turn / %s river', p->>'flop', p->>'turn', p->>'river')
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_dataset_links_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.gto_v31_round_registrations SET dataset_id = NEW.dataset_id
   WHERE dataset_key = NEW.dataset_key AND dataset_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V31 dataset % could not be linked to its registration', NEW.dataset_key;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_dataset_matches_range_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r public.gto_v31_round_registrations%ROWTYPE; v_tree text;
BEGIN
  SELECT * INTO r FROM public.gto_v31_round_registrations WHERE dataset_key = NEW.dataset_key;
  IF NOT FOUND THEN
    RETURN NEW;  -- gto_v31_dataset_matches_registration refuses an unregistered dataset
  END IF;
  IF r.cell_provenance IS NULL THEN
    RAISE EXCEPTION 'V31 round % was registered without range provenance and cannot create a dataset', r.round_key;
  END IF;
  SELECT e#>>'{game,betting_tree_checksum}' INTO v_tree FROM jsonb_array_elements(r.cell_provenance) e
   WHERE e#>>'{game,betting_tree_checksum}' IS DISTINCT FROM NEW.manifest_checksum LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'V31 round % range provenance mismatch: registered betting tree % but the dataset manifest is %',
      r.round_key, left(COALESCE(v_tree,'(none)'),12), left(NEW.manifest_checksum,12);
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_dataset_matches_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r public.gto_v31_round_registrations%ROWTYPE; v_comp jsonb;
BEGIN
  SELECT * INTO r FROM public.gto_v31_round_registrations
   WHERE dataset_key = NEW.dataset_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V31 dataset % has no round registration: register the round (composition, cells, provenance, acceptance criteria, evaluation plan) before any dataset is created', NEW.dataset_key;
  END IF;
  IF r.dataset_id IS NOT NULL THEN
    RAISE EXCEPTION 'V31 round % already has its dataset; a registration is used once', r.round_key;
  END IF;
  v_comp := public.fn_gto_v31_cell_composition(NEW.declared_coverage);
  IF public.fn_gto_v31_cell_set_checksum(NEW.declared_coverage) IS DISTINCT FROM r.cell_set_checksum
     OR jsonb_array_length(NEW.declared_coverage) <> jsonb_array_length(r.cells) THEN
    RAISE EXCEPTION 'V31 round % composition differs from its registration: registered % (% cells, set %), declared % (% cells, set %); no cell may be substituted',
      r.round_key, public.fn_gto_v31_composition_text(r.composition), jsonb_array_length(r.cells), left(r.cell_set_checksum,12),
      public.fn_gto_v31_composition_text(v_comp), jsonb_array_length(NEW.declared_coverage),
      left(public.fn_gto_v31_cell_set_checksum(NEW.declared_coverage),12);
  END IF;
  IF NEW.quality_gates IS DISTINCT FROM r.acceptance_criteria->'quality_gates' THEN
    RAISE EXCEPTION 'V31 round % quality gates differ from its registered acceptance criteria: registered %, declared %',
      r.round_key, r.acceptance_criteria->'quality_gates', NEW.quality_gates;
  END IF;
  -- Cell contract v3 (20261113 B5, review M1): feature contract
  -- holdem-public-hist215-v3 and cell contract v3 are tied both ways. A dataset
  -- declaring hist215-v3 needs a v3 registration (line-keyed cells), and a v3
  -- registration's dataset may not declare the older public215 contracts
  -- (hist215-v1 or v2 have no category for the 'big' facing bucket or the
  -- 'donk' role). Every other dataset reaches RETURN exactly as before.
  IF NEW.feature_contract_version = 'holdem-public-hist215-v3'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.cells) e WHERE jsonb_typeof(e) = 'object' AND e ? 'cell_contract') THEN
    RAISE EXCEPTION 'V31 dataset % declares feature contract holdem-public-hist215-v3, which requires cell contract v3, but round % registered v2 cells',
      NEW.dataset_key, r.round_key;
  END IF;
  IF NEW.feature_contract_version IN ('holdem-public-hist215-v1','holdem-public-hist215-v2')
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.cells) e WHERE jsonb_typeof(e) = 'object' AND e ? 'cell_contract') THEN
    RAISE EXCEPTION 'V31 round % registered cell contract v3 cells, which require feature contract holdem-public-hist215-v3; dataset % declares %',
      r.round_key, NEW.dataset_key, NEW.feature_contract_version;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_declared_coverage_valid(p_coverage jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_context jsonb;
BEGIN
  IF p_coverage IS NULL OR jsonb_typeof(p_coverage) <> 'array'
     OR jsonb_array_length(p_coverage)=0 THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_coverage)) <>
     (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_coverage)) THEN
    RETURN false;
  END IF;
  FOR v_context IN SELECT value FROM jsonb_array_elements(p_coverage) LOOP
    IF NOT public.fn_gto_v31_cell_context_valid(v_context) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_evaluation_cells(p_dataset_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(dataset_id uuid, dataset_key text, dataset_checksum text, solver_version text, solver_binary_checksum text, pipeline_commit text, pipeline_bundle_checksum text, manifest_version text, manifest_checksum text, source_artifact_checksum text, source_combo_order_checksum text, range_bundle_checksum text, icm_model_checksum text, input_bundle_checksum text, cell_key_checksum text, cell_payload_checksum text, lineage_checksum text, quality_status text, dataset_state text, dataset_cells bigint, source_rows bigint, train_source_rows bigint, holdout_source_rows bigint, invalid_rows bigint, audited_at timestamp with time zone, street text, game_family text, objective text, utility_context text, table_size smallint, pot_type text, hero_position text, opponent_position text, depth_bucket integer, texture_class text, node_role text, facing_kind text, facing_size_bucket text, hand_matrix jsonb, action_specs jsonb, policy_ev_matrix jsonb, action_ev_matrix jsonb, feature_contract_version text, policy_export_schema text, policy_representation text, public_model jsonb, public_template jsonb, public_training_provenance jsonb, public_model_build_receipt jsonb, model_checksum text, template_checksum text, feature_schema_checksum text, training_provenance_checksum text, model_build_receipt_checksum text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.dataset_id,d.dataset_key,d.dataset_checksum,d.solver_version,
         d.solver_binary_checksum,d.pipeline_commit,d.pipeline_bundle_checksum,
         d.manifest_version,
         d.manifest_checksum,d.source_artifact_checksum,
         d.source_combo_order_checksum,d.range_bundle_checksum,d.icm_model_checksum,
         d.input_bundle_checksum,c.cell_key_checksum,c.cell_payload_checksum,
         c.lineage_checksum,d.quality_status,d.state,(d.coverage->>'cells')::bigint,
         d.source_rows,d.train_source_rows,d.holdout_source_rows,d.invalid_rows,
         d.audited_at,c.street,c.game_family,c.objective,c.utility_context,
         c.table_size,c.pot_type,c.hero_position,c.opponent_position,c.depth_bucket,
         c.texture_class,c.node_role,c.facing_kind,c.facing_size_bucket,
         c.hand_matrix,c.action_specs,c.policy_ev_matrix,c.action_ev_matrix,d.feature_contract_version,d.policy_export_schema,c.policy_representation,c.public_model,c.public_template,c.public_training_provenance,c.public_model_build_receipt,c.model_checksum,c.template_checksum,c.feature_schema_checksum,c.training_provenance_checksum,c.model_build_receipt_checksum
    FROM public.gto_v31_datasets d
    JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
     AND b.approval_status='approved' AND b.bundle_checksum=d.input_bundle_checksum
     AND b.feature_contract_version IS NOT DISTINCT FROM d.feature_contract_version AND b.policy_export_schema IS NOT DISTINCT FROM d.policy_export_schema AND b.policy_representation IS NOT DISTINCT FROM d.policy_representation
    JOIN public.gto_v31_runtime_cells c ON c.dataset_id=d.dataset_id AND c.feature_contract_version IS NOT DISTINCT FROM d.feature_contract_version AND c.policy_export_schema IS NOT DISTINCT FROM d.policy_export_schema AND c.policy_representation IS NOT DISTINCT FROM d.policy_representation
   WHERE d.dataset_id=p_dataset_id AND d.state IN ('evaluating','candidate','active')
     AND d.quality_status='validated' AND d.invalid_rows=0
     AND d.dataset_checksum IS NOT NULL AND d.source_artifact_checksum IS NOT NULL
   ORDER BY c.street,c.game_family,c.objective,c.utility_context,c.table_size,
     c.pot_type,c.hero_position,c.opponent_position,c.depth_bucket,c.texture_class,
     c.node_role,c.facing_kind,c.facing_size_bucket
   OFFSET greatest(COALESCE(p_offset,0),0)
   LIMIT greatest(1,least(COALESCE(p_limit,500),CASE WHEN EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1') THEN 1 ELSE 500 END));
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_evaluation_contract_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.evaluation_contract IS DISTINCT FROM 'gto_v31_candidate.v3' THEN
      RAISE EXCEPTION 'a new V31 dataset is certified under evaluation contract v3';
    END IF;
  ELSIF NEW.evaluation_contract IS DISTINCT FROM OLD.evaluation_contract THEN
    RAISE EXCEPTION 'a V31 dataset''s evaluation contract is immutable';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_feature_binding_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NEW.feature_contract_version IS DISTINCT FROM OLD.feature_contract_version OR NEW.policy_export_schema IS DISTINCT FROM OLD.policy_export_schema OR NEW.policy_representation IS DISTINCT FROM OLD.policy_representation THEN RAISE EXCEPTION 'feature, policy and representation bindings are immutable';END IF;RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_feature_identity(p_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_version IS NULL THEN RETURN '{}';END IF;
 IF p_version NOT IN('rank-suit-count-v1','holdem-board-relative-v2','holdem-public-hist215-v1','holdem-public-hist215-v2') THEN RAISE EXCEPTION 'unknown feature contract version';END IF;RETURN jsonb_build_object('feature_contract_version',p_version);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_feature_key(p_combo integer, p_board text, p_version text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 PERFORM public.fn_gto_v31_feature_identity(p_version);IF p_version IN('holdem-public-hist215-v1','holdem-public-hist215-v2') THEN RAISE EXCEPTION 'public215 requires chronological public state and sealed numeric model; matrix keys are not model input';END IF;
 IF p_version='holdem-board-relative-v2' THEN RETURN public.fn_gto_v31_board_relative_key_v2(p_combo,p_board);END IF;RETURN public.fn_gto_v31_hand_key(p_combo,p_board);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_feature_key_valid(p_key text, p_street text, p_version text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_version='holdem-board-relative-v2' THEN
   RETURN public.fn_gto_v31_board_relative_key_v2_valid(p_key) AND (p_key::jsonb->>1)::integer=CASE p_street WHEN 'flop' THEN 3 WHEN 'turn' THEN 4 WHEN 'river' THEN 5 ELSE -1 END;
 END IF;
 IF p_version IS NOT NULL AND p_version<>'rank-suit-count-v1' THEN RETURN false; END IF;
 RETURN public.fn_gto_v31_hand_key_valid(p_key,p_street);
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_feature_request_valid(p_request jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
 SELECT COALESCE(NOT(p_request?'feature_contract_version')OR(jsonb_typeof(p_request->'feature_contract_version')='string'AND p_request->>'feature_contract_version' IN('rank-suit-count-v1','holdem-board-relative-v2','holdem-public-hist215-v1','holdem-public-hist215-v2')),false)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_hand_key(p_combo_index integer, p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cards text[] := public.fn_gto_v31_combo_cards(p_combo_index);
  v_ranks constant text := '23456789TJQKA';
  v_r1 text;
  v_r2 text;
  v_s1 text;
  v_s2 text;
  v_high text;
  v_low text;
  v_suffix text;
  v_count1 integer;
  v_count2 integer;
  v_high_count integer;
  v_low_count integer;
BEGIN
  IF p_board !~ '^([2-9TJQKA][cdhs]){3,5}$' THEN RETURN NULL; END IF;
  IF (SELECT count(DISTINCT substr(p_board,n,2))
        FROM generate_series(1,length(p_board),2) n) <> length(p_board)/2
     OR EXISTS (
       SELECT 1 FROM unnest(v_cards) c(card) WHERE position(c.card IN p_board)>0
     ) THEN
    RETURN NULL;
  END IF;
  v_r1 := left(v_cards[1],1);
  v_s1 := right(v_cards[1],1);
  v_r2 := left(v_cards[2],1);
  v_s2 := right(v_cards[2],1);

  SELECT count(*) INTO v_count1
    FROM generate_series(2,length(p_board),2) n
   WHERE substr(p_board,n,1)=v_s1;
  SELECT count(*) INTO v_count2
    FROM generate_series(2,length(p_board),2) n
   WHERE substr(p_board,n,1)=v_s2;

  IF position(v_r1 IN v_ranks) > position(v_r2 IN v_ranks) THEN
    v_high := v_r1;
    v_low := v_r2;
    v_high_count := v_count1;
    v_low_count := v_count2;
  ELSIF position(v_r2 IN v_ranks) > position(v_r1 IN v_ranks) THEN
    v_high := v_r2;
    v_low := v_r1;
    v_high_count := v_count2;
    v_low_count := v_count1;
  ELSE
    v_high := v_r1;
    v_low := v_r2;
    v_high_count := greatest(v_count1,v_count2);
    v_low_count := least(v_count1,v_count2);
  END IF;

  v_suffix := CASE
    WHEN v_high=v_low THEN ''
    WHEN v_s1=v_s2 THEN 's'
    ELSE 'o'
  END;
  RETURN v_high || v_low || v_suffix || ':' || v_high_count || v_low_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_hand_key_valid(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match text[];
  v_ranks constant text := 'AKQJT98765432';
  v_first text;
  v_second text;
  v_suitedness text;
  v_first_count integer;
  v_second_count integer;
BEGIN
  v_match := regexp_match(
    p_key,
    '^([AKQJT98765432])([AKQJT98765432])([so]?):([0-5])([0-5])$'
  );
  IF v_match IS NULL THEN RETURN false; END IF;
  v_first := v_match[1];
  v_second := v_match[2];
  v_suitedness := COALESCE(v_match[3],'');
  v_first_count := v_match[4]::integer;
  v_second_count := v_match[5]::integer;

  IF v_first = v_second THEN
    RETURN v_suitedness = ''
      AND v_first_count >= v_second_count
      AND v_first_count + v_second_count <= 5;
  END IF;
  RETURN COALESCE(
    v_suitedness IN ('s','o')
      AND position(v_first IN v_ranks) < position(v_second IN v_ranks)
      AND CASE v_suitedness
        WHEN 's' THEN v_first_count = v_second_count
        ELSE v_first_count + v_second_count <= 5
      END,
    false
  );
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_hand_key_valid(p_key text, p_street text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_match text[];
  v_board_cards integer;
  v_suitedness text;
  v_first_count integer;
  v_second_count integer;
BEGIN
  IF NOT public.fn_gto_v31_hand_key_valid(p_key) THEN RETURN false; END IF;
  v_board_cards := CASE p_street
    WHEN 'flop' THEN 3
    WHEN 'turn' THEN 4
    WHEN 'river' THEN 5
    ELSE NULL
  END;
  IF v_board_cards IS NULL THEN RETURN false; END IF;

  v_match := regexp_match(
    p_key,
    '^([AKQJT98765432])([AKQJT98765432])([so]?):([0-5])([0-5])$'
  );
  v_suitedness := COALESCE(v_match[3],'');
  v_first_count := v_match[4]::integer;
  v_second_count := v_match[5]::integer;
  IF v_suitedness = 's' THEN
    RETURN v_first_count <= v_board_cards;
  END IF;
  RETURN v_first_count + v_second_count <= v_board_cards;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_hand_matrix_valid(p_matrix jsonb, p_street text, p_version text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF p_version IN('holdem-public-hist215-v1','holdem-public-hist215-v2') THEN
    RETURN COALESCE(p_matrix IS NULL AND p_street IN ('flop','turn','river'),false);
  END IF;
  IF p_matrix IS NULL OR jsonb_typeof(p_matrix) <> 'object'
     OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_matrix)) THEN
    RETURN false;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_matrix) LOOP
    IF NOT public.fn_gto_v31_feature_key_valid(v_key,p_street,p_version) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_heldout_metrics(p_dataset_id uuid, p_game_family text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1')THEN RETURN public.fn_gto_v31_public215_heldout_metrics(p_dataset_id,p_game_family);END IF;RETURN public.fn_gto_v31_heldout_metrics_matrix_v2(p_dataset_id,p_game_family);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_heldout_metrics_matrix_v2(p_dataset_id uuid, p_game_family text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH scored_nodes AS MATERIALIZED (
    SELECT r.dataset_id,r.cell_id,r.source_row_id,r.source_node,r.split,
           public.fn_gto_v31_assert_source_contract(n.value,
           (SELECT d.policy_export_schema FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id),
           (SELECT d.icm_model_checksum FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id)) AS node
      FROM public.gto_v31_cell_source_receipts r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      JOIN public.solved_spots_gold s ON s.id=r.source_row_id
      CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND (p_game_family IS NULL OR c.game_family=p_game_family)
       AND n.value->>'node'=r.source_node
       AND n.value->>'node_checksum'=r.source_node_checksum
  ), holdout AS MATERIALIZED (
    SELECT r.source_row_id,r.source_node,c.cell_id,c.game_family,
           c.action_specs,i,k.hand_key,
           c.hand_matrix->k.hand_key AS compact_frequencies,
           (c.policy_ev_matrix->>k.hand_key)::numeric AS compact_policy,
           (n.value->'policy_evs_bb'->>i)::numeric AS source_policy,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'frequencies') a) AS source_frequencies,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'action_evs_bb') a) AS source_action_evs,
           (n.value->'matchups'->>i)::numeric AS weight
      FROM scored_nodes r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      CROSS JOIN LATERAL (SELECT r.node AS value) n
      CROSS JOIN generate_series(0,1325) i
      CROSS JOIN LATERAL (SELECT public.fn_gto_v31_feature_key(i,n.value#>>'{node_context,board}',c.feature_contract_version) AS hand_key OFFSET 0) k
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND (p_game_family IS NULL OR c.game_family=p_game_family)
       AND n.value->>'node'=r.source_node
       AND (n.value->'matchups'->>i)::numeric>0
  ), action_observations AS MATERIALIZED (
    SELECT h.*,a.key AS action_id,a.value->>'family' AS action_family,
           CASE WHEN a.value->>'family' IN ('bet','raise')
                THEN (a.value->>'size_value')::numeric ELSE NULL END AS size_value,
           (h.source_frequencies->>a.key)::numeric AS source_frequency,
           (h.compact_frequencies->>a.key)::numeric AS compact_frequency,
           (h.source_action_evs->>a.key)::numeric AS source_action_ev
      FROM holdout h CROSS JOIN LATERAL jsonb_each(h.action_specs) a
  ), per_combo AS MATERIALIZED (
    SELECT source_row_id,source_node,cell_id,game_family,i,hand_key,weight,
           max(source_policy) AS source_policy_ev,
           max(compact_policy) AS compact_policy_ev,
           sum(source_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS source_size,
           sum(compact_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS compact_size,
           bool_or(size_value IS NOT NULL) AS sizing_eligible,
           max(source_action_ev) AS best_action_ev,
           sum(compact_frequency*source_action_ev) AS compact_mixed_ev,
           bool_and(compact_frequency IS NOT NULL AND source_action_ev IS NOT NULL)
             AS regret_eligible
      FROM action_observations
     GROUP BY source_row_id,source_node,cell_id,game_family,i,hand_key,weight
  )
  SELECT jsonb_build_object(
    'frequency_mae',(SELECT sum(abs(source_frequency-compact_frequency)*weight)/NULLIF(sum(weight),0)
      FROM action_observations),
    'sizing_mae',COALESCE((SELECT sum(abs(source_size-compact_size)*weight)/NULLIF(sum(weight),0)
      FROM per_combo WHERE sizing_eligible),0),
    'policy_ev_mae_bb',(SELECT sum(abs(source_policy_ev-compact_policy_ev)*weight)/NULLIF(sum(weight),0)
      FROM per_combo),
    'mean_action_regret_bb',(SELECT sum(greatest(0,best_action_ev-compact_mixed_ev)*weight)/NULLIF(sum(weight),0)
      FROM per_combo WHERE regret_eligible),
    'regret_coverage',(SELECT count(*)::numeric/NULLIF((SELECT count(*) FROM per_combo),0)
      FROM per_combo WHERE regret_eligible),
    'holdout_source_rows',(SELECT count(DISTINCT source_row_id) FROM holdout),
    'frequency_observations',(SELECT count(*) FROM action_observations),
    'sizing_observations',(SELECT count(*) FROM per_combo WHERE sizing_eligible),
    'policy_ev_observations',(SELECT count(*) FROM per_combo),
    'regret_observations',(SELECT count(*) FROM per_combo WHERE regret_eligible),
    'live_combo_observations',(SELECT count(*) FROM per_combo),
    'missing_observations',(SELECT count(*) FROM holdout WHERE compact_frequencies IS NULL OR compact_policy IS NULL)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_input_bundle_checksum(p_bundle jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE files jsonb;identity jsonb;
BEGIN
 IF p_bundle->>'feature_contract_version' IN('holdem-public-hist215-v1','holdem-public-hist215-v2')AND p_bundle->>'policy_representation'IS DISTINCT FROM 'public_hist215_v1'THEN RAISE EXCEPTION 'public215 feature identity requires explicit approved numeric representation/protocols';END IF;
 IF NOT(p_bundle?'policy_representation') OR p_bundle->'policy_representation'='null'::jsonb OR p_bundle->>'policy_representation'='matrix_v2' THEN RETURN public.fn_gto_v31_input_bundle_checksum_matrix_v2(p_bundle-'policy_representation');END IF;
 IF NOT public.fn_gto_v31_public215_bundle_valid(p_bundle) THEN RAISE EXCEPTION 'complete explicitly approved public215 bundle required';END IF;
 SELECT jsonb_agg(value ORDER BY value->>'kind' COLLATE "C",value->>'path' COLLATE "C",value->>'checksum' COLLATE "C")INTO files FROM jsonb_array_elements(p_bundle->'files')WHERE value->>'kind'<>'scenario_manifest';
 identity:=jsonb_build_object('contract','smarter-poker.horse-solver-v31-input-bundle.v3','bundle_key',p_bundle->'bundle_key','bundle_version',p_bundle->'bundle_version','range_bundle_checksum',p_bundle->'range_bundle_checksum','source_combo_order_checksum',p_bundle->'source_combo_order_checksum','icm_model_checksum',p_bundle->'icm_model_checksum','files',files,'feature_contract_version',p_bundle->'feature_contract_version','policy_export_schema',p_bundle->'policy_export_schema','policy_representation',p_bundle->'policy_representation','public215_contexts',p_bundle->'public215_contexts','public215_protocols',p_bundle->'public215_protocols');RETURN public.fn_gto_v31_public215_digest(identity);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_input_bundle_checksum_matrix_v2(p_bundle jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_file jsonb;
  v_files jsonb;
  v_identity jsonb;
BEGIN
  IF p_bundle IS NULL
     OR jsonb_typeof(p_bundle) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_bundle)) <> (7 + CASE WHEN p_bundle ? 'feature_contract_version' THEN 1 ELSE 0 END + CASE WHEN p_bundle ? 'policy_export_schema' THEN 1 ELSE 0 END)
     OR NOT (p_bundle ?& ARRAY['bundle_key','bundle_version','range_bundle_checksum',
       'source_combo_order_checksum','icm_model_checksum','files','approval_note'])
     OR NOT public.fn_gto_v31_feature_request_valid(p_bundle)
     OR NOT public.fn_gto_v31_policy_request_valid(p_bundle)
     OR jsonb_typeof(p_bundle->'bundle_key') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_bundle->'bundle_version') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_bundle->'range_bundle_checksum') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_bundle->'source_combo_order_checksum') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_bundle->'icm_model_checksum') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_bundle->'approval_note') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_bundle->'files') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_bundle->'files') = 0
     OR p_bundle->>'bundle_key' !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
     OR p_bundle->>'bundle_version' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
     OR p_bundle->>'range_bundle_checksum' !~ '^[0-9a-f]{64}$'
     OR p_bundle->>'range_bundle_checksum' = repeat('0',64)
     OR p_bundle->>'source_combo_order_checksum' !~ '^[0-9a-f]{64}$'
     OR p_bundle->>'source_combo_order_checksum' = repeat('0',64)
     OR p_bundle->>'icm_model_checksum' !~ '^[0-9a-f]{64}$'
     OR p_bundle->>'icm_model_checksum' = repeat('0',64)
     OR p_bundle->>'approval_note' !~ '[^[:space:]]'
     OR length(p_bundle->>'approval_note') > 2000 THEN
    RAISE EXCEPTION 'V31 input bundle identity requires canonical JSON strings';
  END IF;

  FOR v_file IN SELECT value FROM jsonb_array_elements(p_bundle->'files') LOOP
    IF jsonb_typeof(v_file) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_file)) <> 3
       OR NOT (v_file ?& ARRAY['kind','path','checksum'])
       OR jsonb_typeof(v_file->'kind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_file->'path') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_file->'checksum') IS DISTINCT FROM 'string'
       OR v_file->>'kind' NOT IN ('range','combo_order','icm_model','payout_model','scenario_manifest')
       OR v_file->>'path' !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,255}$'
       OR position('..' IN v_file->>'path') > 0
       OR ('/' || (v_file->>'path') || '/') LIKE '%//%'
       OR ('/' || (v_file->>'path') || '/') LIKE '%/./%'
       OR v_file->>'checksum' !~ '^[0-9a-f]{64}$'
       OR v_file->>'checksum' = repeat('0',64) THEN
      RAISE EXCEPTION 'V31 input bundle identity contains a noncanonical file receipt';
    END IF;
  END LOOP;

  IF (SELECT count(DISTINCT value->>'path') FROM jsonb_array_elements(p_bundle->'files'))
       <> jsonb_array_length(p_bundle->'files')
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='range') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='range'
         AND f.value->>'checksum'=p_bundle->>'range_bundle_checksum') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='combo_order') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='combo_order'
         AND f.value->>'checksum'=p_bundle->>'source_combo_order_checksum') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='icm_model') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='icm_model'
         AND f.value->>'checksum'=p_bundle->>'icm_model_checksum') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(p_bundle->'files') f(value)
       WHERE f.value->>'kind'='scenario_manifest') <> 1 THEN
    RAISE EXCEPTION 'V31 input bundle identity does not reconcile its file receipts';
  END IF;

  SELECT jsonb_agg(
           value
           ORDER BY (value->>'kind') COLLATE "C",
                    (value->>'path') COLLATE "C",
                    (value->>'checksum') COLLATE "C"
         )
    INTO v_files
    FROM jsonb_array_elements(p_bundle->'files') f(value)
   WHERE value->>'kind' <> 'scenario_manifest';

  v_identity := jsonb_build_object(
    'contract','smarter-poker.horse-solver-v31-input-bundle.v2',
    'bundle_key',p_bundle->'bundle_key',
    'bundle_version',p_bundle->'bundle_version',
    'range_bundle_checksum',p_bundle->'range_bundle_checksum',
    'source_combo_order_checksum',p_bundle->'source_combo_order_checksum',
    'icm_model_checksum',p_bundle->'icm_model_checksum',
    'files',v_files
  );

  v_identity := v_identity || public.fn_gto_v31_feature_identity(p_bundle->>'feature_contract_version');
  v_identity := v_identity || public.fn_gto_v31_policy_identity(p_bundle->>'policy_export_schema');
  RETURN encode(digest(convert_to(
    public.fn_training_canonical_jsonb_text_v1(v_identity),
    'UTF8'
  ),'sha256'),'hex');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_input_bundle_id(p_bundle_checksum text)
 RETURNS uuid
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_hex text;
BEGIN
  IF p_bundle_checksum !~ '^[0-9a-f]{64}$' OR p_bundle_checksum = repeat('0',64) THEN
    RAISE EXCEPTION 'V31 input bundle checksum is invalid';
  END IF;

  -- RFC 4122 version 5 / variant 1 shape over the first 128 checksum bits.
  v_hex := substring(p_bundle_checksum,1,12) || '5' ||
           substring(p_bundle_checksum,14,3) || '8' ||
           substring(p_bundle_checksum,18,15);
  RETURN (
    substring(v_hex,1,8) || '-' || substring(v_hex,9,4) || '-' ||
    substring(v_hex,13,4) || '-' || substring(v_hex,17,4) || '-' ||
    substring(v_hex,21,12)
  )::uuid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_json_checksum(p_payload jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT encode(digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
$function$
;

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

CREATE OR REPLACE FUNCTION public.fn_gto_v31_node_checksum(p_node jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.fn_gto_v31_json_checksum(p_node - 'node_checksum');
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_node_line_proof(p_node text, p_preflop_aggressor integer, p_root_pot_chips numeric, p_effective_stack_chips numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tokens text[]:=string_to_array(p_node,':');
  v_token text;
  v_actor integer:=0;
  v_wager boolean:=false;
  v_closed boolean:=false;
  v_closed_by_checks boolean:=false;
  v_street_index integer:=0;
  v_types text[]:=ARRAY[]::text[];
  v_actors integer[]:=ARRAY[]::integer[];
  v_previous text;
  v_i integer;
  v_hero_aggressive integer;
  v_last_aggressor integer;
  v_flop_aggressor integer;
  v_turn_aggressor integer;
  v_flop_checked boolean:=false;
  v_turn_checked boolean:=false;
  v_previous_aggressor integer;
  v_older_aggressor integer;
  v_previous_checked boolean:=false;
  v_role text;
  v_street text;
  v_pot numeric:=p_root_pot_chips;
  v_contributions numeric[]:=ARRAY[0,0]::numeric[];
  v_spent numeric[]:=ARRAY[0,0]::numeric[];
  v_current_target numeric:=0;
  v_target numeric;
  v_prior_target numeric;
  v_delta numeric;
  v_remaining numeric;
  v_last_target numeric;
  v_last_prior_target numeric;
  v_last_actor_total numeric;
  v_last_kind text;
  v_last_all_in boolean:=false;
  v_last_raise_pot_after_call numeric;
  v_fraction numeric;
  v_facing_kind text:='none';
  v_facing_bucket text:='none';
BEGIN
  IF p_node IS NULL
     OR (p_preflop_aggressor IS NOT NULL AND p_preflop_aggressor NOT IN (0,1))
     OR p_root_pot_chips<=0 OR p_effective_stack_chips<=0
     OR p_root_pot_chips<>trunc(p_root_pot_chips)
     OR p_effective_stack_chips<>trunc(p_effective_stack_chips) THEN
    RETURN NULL;
  END IF;
  IF array_length(v_tokens,1)<2 OR v_tokens[1]<>'r' OR v_tokens[2]<>'0' THEN RETURN NULL; END IF;
  IF array_length(v_tokens,1)>=3 THEN
    FOR v_i IN 3..array_length(v_tokens,1) LOOP
      v_token:=v_tokens[v_i];
      IF v_token~'^[2-9TJQKA][cdhs]$' THEN
        IF NOT v_closed THEN RETURN NULL; END IF;
        IF v_street_index=0 THEN
          v_flop_aggressor:=v_last_aggressor;
          v_flop_checked:=v_closed_by_checks;
        ELSIF v_street_index=1 THEN
          v_turn_aggressor:=v_last_aggressor;
          v_turn_checked:=v_closed_by_checks;
        ELSE
          RETURN NULL;
        END IF;
        v_street_index:=v_street_index+1;
        v_actor:=0; v_wager:=false; v_closed:=false;
        v_closed_by_checks:=false; v_last_aggressor:=NULL;
        v_contributions:=ARRAY[0,0]::numeric[]; v_current_target:=0;
        v_last_target:=NULL; v_last_prior_target:=NULL; v_last_actor_total:=NULL;
        v_last_kind:=NULL; v_last_all_in:=false;
        v_last_raise_pot_after_call:=NULL;
        v_types:=ARRAY[]::text[]; v_actors:=ARRAY[]::integer[];
      ELSIF v_token='c' THEN
        IF v_closed THEN RETURN NULL; END IF;
        v_previous:=CASE WHEN array_length(v_types,1)>0 THEN v_types[array_length(v_types,1)] END;
        v_types:=array_append(v_types,CASE WHEN v_wager THEN 'call' ELSE 'check' END);
        v_actors:=array_append(v_actors,v_actor);
        IF v_wager THEN
          v_delta:=v_current_target-v_contributions[v_actor+1];
          v_remaining:=p_effective_stack_chips-v_spent[v_actor+1];
          IF v_delta<0 OR v_delta>v_remaining THEN RETURN NULL; END IF;
          v_contributions[v_actor+1]:=v_contributions[v_actor+1]+v_delta;
          v_spent[v_actor+1]:=v_spent[v_actor+1]+v_delta;
          v_pot:=v_pot+v_delta;
        END IF;
        IF v_wager OR v_previous='check' THEN
          v_closed:=true;
          v_closed_by_checks:=NOT v_wager AND v_previous='check';
          v_wager:=false;
        END IF;
        v_actor:=1-v_actor;
      ELSIF v_token~'^b[1-9][0-9]*$' THEN
        IF v_closed THEN RETURN NULL; END IF;
        v_target:=substring(v_token FROM 2)::numeric
          -(v_spent[v_actor+1]-v_contributions[v_actor+1]); -- Pio bN: total since root
        v_prior_target:=v_current_target;
        v_remaining:=p_effective_stack_chips-v_spent[v_actor+1];
        v_last_actor_total:=v_contributions[v_actor+1]+v_remaining;
        IF v_target<=v_contributions[v_actor+1]
           OR (v_wager AND v_target<=v_current_target)
           OR v_target>v_last_actor_total THEN RETURN NULL; END IF;
        IF v_wager THEN
          v_last_raise_pot_after_call:=v_pot+(v_current_target-v_contributions[v_actor+1]);
          IF v_last_raise_pot_after_call<=0 THEN RETURN NULL; END IF;
        ELSE
          v_last_raise_pot_after_call:=NULL;
        END IF;
        v_types:=array_append(v_types,CASE WHEN v_wager THEN 'raise' ELSE 'bet' END);
        v_actors:=array_append(v_actors,v_actor);
        v_last_kind:=CASE WHEN v_wager THEN 'raise' ELSE 'bet' END;
        v_last_target:=v_target; v_last_prior_target:=v_prior_target;
        v_last_all_in:=v_target=v_last_actor_total;
        v_delta:=v_target-v_contributions[v_actor+1];
        v_contributions[v_actor+1]:=v_target;
        v_spent[v_actor+1]:=v_spent[v_actor+1]+v_delta;
        v_pot:=v_pot+v_delta; v_current_target:=v_target;
        v_last_aggressor:=v_actor; v_wager:=true; v_actor:=1-v_actor;
      ELSE
        RETURN NULL;
      END IF;
    END LOOP;
  END IF;
  IF v_closed THEN RETURN NULL; END IF;
  v_street:=CASE v_street_index WHEN 0 THEN 'flop' WHEN 1 THEN 'turn' WHEN 2 THEN 'river' END;
  IF v_street IS NULL THEN RETURN NULL; END IF;

  IF v_wager THEN
    IF v_last_all_in THEN
      v_role:='all_in'; v_facing_kind:='all_in'; v_facing_bucket:='all_in';
    ELSIF v_types[array_length(v_types,1)]='bet' THEN
      v_role:='facing_bet';
      v_facing_kind:='bet';
      IF v_pot-v_last_target<=0 THEN RETURN NULL; END IF;
      v_fraction:=v_last_target/(v_pot-v_last_target);
      v_facing_bucket:=CASE WHEN v_fraction<0.6 THEN 'small'
        WHEN v_fraction<1.1 THEN 'mid' ELSE 'big' END;
    ELSIF v_types[array_length(v_types,1)]='raise' THEN
      SELECT max(i) INTO v_hero_aggressive FROM generate_subscripts(v_types,1) i
       WHERE i<array_length(v_types,1) AND v_actors[i]=v_actor
         AND v_types[i] IN ('bet','raise');
      IF v_hero_aggressive IS NULL THEN RETURN NULL; END IF;
      IF v_types[v_hero_aggressive]='raise' THEN
        v_role:='facing_raise';
      ELSIF EXISTS (SELECT 1 FROM generate_subscripts(v_types,1) i
          WHERE i<v_hero_aggressive AND v_actors[i]<>v_actor AND v_types[i]='check') THEN
        v_role:='check_raise';
      ELSE
        v_role:='bet_raise';
      END IF;
      v_facing_kind:='raise';
      IF v_last_raise_pot_after_call IS NULL OR v_last_raise_pot_after_call<=0 THEN RETURN NULL; END IF;
      v_fraction:=(v_last_target-v_last_prior_target)/v_last_raise_pot_after_call;
      v_facing_bucket:=CASE WHEN v_fraction<0.6 THEN 'small'
        WHEN v_fraction<1.1 THEN 'mid' ELSE 'big' END;
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM generate_subscripts(v_types,1) i WHERE v_actors[i]=v_actor) THEN
      RETURN NULL;
    END IF;
    IF v_street_index=0 THEN
      v_previous_aggressor:=p_preflop_aggressor;
      IF v_previous_aggressor=v_actor THEN v_role:='cbet';
      ELSIF v_previous_aggressor IS NULL THEN v_role:='open';
      ELSE RETURN NULL;
      END IF;
    ELSE
      IF v_street_index=1 THEN
        v_previous_aggressor:=v_flop_aggressor;
        v_previous_checked:=v_flop_checked;
        v_older_aggressor:=p_preflop_aggressor;
      ELSE
        v_previous_aggressor:=v_turn_aggressor;
        v_previous_checked:=v_turn_checked;
        v_older_aggressor:=v_flop_aggressor;
      END IF;
      IF v_previous_aggressor=v_actor THEN
        v_role:='barrel';
      ELSIF v_previous_aggressor IS NOT NULL THEN
        RETURN NULL;
      ELSIF NOT v_previous_checked THEN
        RETURN NULL;
      ELSIF v_older_aggressor=v_actor THEN
        v_role:='delayed_cbet';
      ELSIF v_older_aggressor IS NOT NULL THEN
        v_role:='probe';
      ELSE
        v_role:='open';
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'street',v_street,
    'current_actor_solver_player',v_actor,
    'derived_node_role',v_role,
    'derived_facing_kind',v_facing_kind,
    'derived_facing_size_bucket',v_facing_bucket,
    'facing_target_chips',CASE WHEN v_wager THEN v_last_target END,
    'facing_actor_total_chips',CASE WHEN v_wager THEN v_last_actor_total END,
    'previous_street_aggressor_solver_player',v_previous_aggressor,
    'previous_street_checked_through',v_previous_checked,
    'older_street_aggressor_solver_player',v_older_aggressor
  );
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

CREATE OR REPLACE FUNCTION public.fn_gto_v31_policy_identity(p_schema text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_schema IS NULL THEN RETURN '{}'::jsonb; END IF;
 IF p_schema<>'smarter-poker.pio-policy.v4' THEN RAISE EXCEPTION 'unknown policy export schema'; END IF;
 RETURN jsonb_build_object('policy_export_schema',p_schema);
END; $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_policy_request_valid(p_request jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
 SELECT COALESCE(jsonb_typeof(p_request)='object' AND
   (NOT p_request ? 'policy_export_schema' OR
    (jsonb_typeof(p_request->'policy_export_schema')='string' AND
     p_request->>'policy_export_schema'='smarter-poker.pio-policy.v4')),false);
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_action_sum(p double precision[])
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE n integer:=cardinality(p);r double precision[];v double precision:=0::double precision;i integer;j integer;
BEGIN
 IF n<1 OR n>16 THEN RAISE EXCEPTION 'public215 action axis';END IF;
 IF n<8 THEN FOR i IN 1..n LOOP v:=v+p[i];END LOOP;RETURN v;END IF;
 r:=p[1:8];i:=9;WHILE i+7<=n LOOP FOR j IN 1..8 LOOP r[j]:=r[j]+p[i+j-1];END LOOP;i:=i+8;END LOOP;
 v:=((r[1]+r[2])+(r[3]+r[4]))+((r[5]+r[6])+(r[7]+r[8]));WHILE i<=n LOOP v:=v+p[i];i:=i+1;END LOOP;RETURN 0::double precision+v;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_assert_prepared_seal(p_dataset gto_v31_datasets)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'extensions'
AS $function$
DECLARE c public.gto_v31_runtime_cells;r public.gto_v31_seal_cell_preparations;binding jsonb;fingerprint text;raws jsonb:='[]';cells integer:=0;authorities integer;physics text;receipt text;
BEGIN
 PERFORM public.fn_gto_v31_seal_preparation_guards();
 PERFORM public.fn_gto_v31_public215_lock_seal_inputs(p_dataset.dataset_id,NULL);
 fingerprint:=public.fn_gto_v31_seal_qualification_fingerprint();
 IF p_dataset.state<>'building'OR p_dataset.policy_representation<>'public_hist215_v1'OR jsonb_array_length(p_dataset.declared_coverage)<1 THEN RAISE EXCEPTION 'complete building public seal required';END IF;
 IF public.fn_gto_v31_public215_source_headers_valid(p_dataset)IS NOT TRUE OR public.fn_gto_v31_public215_selected_complete(p_dataset)IS NOT TRUE THEN RAISE EXCEPTION 'current full source/selection authority required';END IF;
 PERFORM public.fn_gto_v31_public215_frozen_map(p_dataset);
 -- Every artifact/node must be covered by a prepared cell, in BOTH directions.
 IF EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=p_dataset.dataset_id AND a.node_count<>(SELECT count(*)FROM public.gto_v31_cell_source_receipts z WHERE z.dataset_id=a.dataset_id AND z.source_row_id=a.source_row_id))
 OR EXISTS(SELECT 1 FROM public.gto_v31_cell_source_receipts z WHERE z.dataset_id=p_dataset.dataset_id AND NOT EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=z.dataset_id AND a.source_row_id=z.source_row_id))
 OR EXISTS(SELECT 1 FROM public.gto_v31_cell_source_receipts z JOIN public.gto_v31_runtime_cells x ON x.cell_id=z.cell_id WHERE z.dataset_id=p_dataset.dataset_id AND(x.dataset_id<>z.dataset_id OR NOT EXISTS(SELECT 1 FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=z.dataset_id AND j.source_row_id=z.source_row_id AND j.source_node=z.source_node AND j.node_checksum=z.source_node_checksum AND j.artifact_checksum=z.source_artifact_checksum AND j.machine_id=z.machine_id AND j.context=x.public_template->'context')))
 OR(SELECT count(*)FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset.dataset_id)<>65*jsonb_array_length(p_dataset.declared_coverage)
 OR(SELECT count(*)FROM public.gto_v31_public_source_journal WHERE dataset_id=p_dataset.dataset_id AND machine_id='M1')<>57*jsonb_array_length(p_dataset.declared_coverage)
 OR(SELECT count(*)FROM public.gto_v31_public_source_journal WHERE dataset_id=p_dataset.dataset_id AND machine_id='M2')<>8*jsonb_array_length(p_dataset.declared_coverage) THEN RAISE EXCEPTION 'prepared source census/membership differs';END IF;
 physics:=public.fn_gto_v31_public215_digest(jsonb_build_object('physics',public.fn_gto_v31_public215_physics_implementation(),'encoding',public.fn_gto_v31_public215_encoding_for(p_dataset.feature_contract_version)));
 -- Retain the original whole-model authority and current implementation checks.
 -- Only the already-attested expensive payload predicate is reused below.
 SELECT count(DISTINCT jsonb_build_object('variant',public_model->'variant','capture',public_training_provenance->'capture_receipt_checksum','recipe',public_training_provenance->'training_recipe_checksum','partition',public_training_provenance->'source_partition_checksum','protocol',public_training_provenance->'runtime_parity_protocol_checksum','encoder',public_training_provenance->'encoder_checksum','physics',public_training_provenance->'physics_checksum','lock',public_training_provenance->'dependency_lock_checksum','parameters',public_training_provenance->'parameters'))INTO authorities FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset.dataset_id;
 IF authorities<>1 OR EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells x WHERE x.dataset_id=p_dataset.dataset_id AND(x.policy_representation IS DISTINCT FROM p_dataset.policy_representation OR x.sql_physics_checksum IS DISTINCT FROM physics))THEN RAISE EXCEPTION 'numeric model authority/implementation differs';END IF;
 FOR c IN SELECT *FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset.dataset_id ORDER BY public.fn_gto_v31_public215_canonical(public_template->'context')COLLATE "C"LOOP
  binding:=public.fn_gto_v31_public215_seal_cell_binding(p_dataset.dataset_id,c.cell_key_checksum);
  SELECT *INTO STRICT r FROM public.gto_v31_seal_cell_preparations WHERE dataset_id=p_dataset.dataset_id AND cell_key_checksum=c.cell_key_checksum AND qualification_fingerprint=fingerprint AND input_checksum=public.fn_gto_v31_json_checksum(binding)FOR SHARE;
  receipt:=public.fn_gto_v31_json_checksum(jsonb_build_object('format','public215_preseal_receipt_v1','qualification_fingerprint',fingerprint,'input_binding',binding,'raw_metrics',r.raw_metrics));
  IF r.input_binding IS DISTINCT FROM binding OR r.receipt_checksum IS DISTINCT FROM receipt OR r.context IS DISTINCT FROM c.public_template->'context'OR r.preparation_offset<>(binding#>>'{cell,preparation_offset}')::integer THEN RAISE EXCEPTION 'prepared seal receipt differs';END IF;
  IF r.raw_metrics->>'dataset_id'IS DISTINCT FROM p_dataset.dataset_id::text OR r.raw_metrics->>'cell_id'IS DISTINCT FROM c.cell_id::text OR r.raw_metrics->>'game_family'IS DISTINCT FROM c.game_family THEN RAISE EXCEPTION 'prepared raw metrics identity differs';END IF;
  raws:=raws||jsonb_build_array(r.raw_metrics);cells:=cells+1;
 END LOOP;
 IF cells<1 OR cells<>jsonb_array_length(p_dataset.declared_coverage)OR public.fn_gto_v31_seal_qualification_fingerprint()IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'prepared validation census/implementation changed';END IF;
 RETURN raws;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_audit_key(p_model_checksum text, p_template_checksum text, p_board text[], p_physics_key text)
 RETURNS text
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
 SELECT public.fn_gto_v31_public215_digest(jsonb_build_object('format','public_hist215_audit_v1','model_checksum',p_model_checksum,'template_checksum',p_template_checksum,'chronological_board',p_board,'physics_key',p_physics_key,'encoding_checksum',public.fn_gto_v31_public215_encoding_implementation()))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_audit_key_for(p_version text, p_model_checksum text, p_template_checksum text, p_board text[], p_physics_key text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT CASE WHEN p_version='holdem-public-hist215-v2' THEN public.fn_gto_v31_public215_audit_key_v2(p_model_checksum,p_template_checksum,p_board,p_physics_key) ELSE public.fn_gto_v31_public215_audit_key(p_model_checksum,p_template_checksum,p_board,p_physics_key) END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_audit_key_v2(p_model_checksum text, p_template_checksum text, p_board text[], p_physics_key text)
 RETURNS text
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
 SELECT public.fn_gto_v31_public215_digest(jsonb_build_object('format','public_hist215_audit_v2','model_checksum',p_model_checksum,'template_checksum',p_template_checksum,'chronological_board',p_board,'physics_key',p_physics_key,'encoding_checksum',public.fn_gto_v31_public215_encoding_implementation_v2()))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_audit_prediction(p_cell gto_v31_runtime_cells, p_board text, p_combo integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE board text[];physics text;k text;r public.gto_v31_public_model_audit_combos%ROWTYPE;m jsonb:='{}';q jsonb:='{}';i integer;id text;
BEGIN
 IF p_cell.policy_representation IS DISTINCT FROM 'public_hist215_v1' OR NOT public.fn_gto_v31_public215_cards(p_board) THEN RAISE EXCEPTION 'sealed public215 state required';END IF;
 SELECT array_agg(substring(p_board FROM j FOR 2)ORDER BY j)INTO board FROM generate_series(1,length(p_board),2)j;physics:=public.fn_gto_v31_public215_physics_key(p_cell.public_template,board);k:=public.fn_gto_v31_public215_audit_key(p_cell.model_checksum,p_cell.template_checksum,board,physics);
 IF NOT EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=k AND a.model_checksum=p_cell.model_checksum AND a.template_checksum=p_cell.template_checksum AND a.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation()) THEN RAISE EXCEPTION 'independent complete public SQL audit is not prepared';END IF;
 SELECT * INTO STRICT r FROM public.gto_v31_public_model_audit_combos c WHERE c.audit_key=k AND c.combo=p_combo;
 FOR i IN 1..jsonb_array_length(p_cell.public_model->'action_ids') LOOP id:=p_cell.public_model#>>ARRAY['action_ids',(i-1)::text];m:=m||jsonb_build_object(id,r.frequencies[i]);q:=q||jsonb_build_object(id,r.action_evs[i]);END LOOP;
 RETURN jsonb_build_object('policy',r.policy_ev,'mix',m,'Q',q);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_audit_prediction_for(p_cell gto_v31_runtime_cells, p_board text, p_combo integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_cell.feature_contract_version='holdem-public-hist215-v2' THEN RETURN public.fn_gto_v31_public215_audit_prediction_v2(p_cell,p_board,p_combo);END IF;
 RETURN public.fn_gto_v31_public215_audit_prediction(p_cell,p_board,p_combo);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_audit_prediction_v2(p_cell gto_v31_runtime_cells, p_board text, p_combo integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE board text[];physics text;k text;r public.gto_v31_public_model_audit_combos%ROWTYPE;m jsonb:='{}';q jsonb:='{}';i integer;id text;
BEGIN
 IF p_cell.policy_representation IS DISTINCT FROM 'public_hist215_v1' OR p_cell.feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2' OR NOT public.fn_gto_v31_public215_cards(p_board) THEN RAISE EXCEPTION 'sealed public215 state required';END IF;
 SELECT array_agg(substring(p_board FROM j FOR 2)ORDER BY j)INTO board FROM generate_series(1,length(p_board),2)j;physics:=public.fn_gto_v31_public215_physics_key(p_cell.public_template,board);k:=public.fn_gto_v31_public215_audit_key_v2(p_cell.model_checksum,p_cell.template_checksum,board,physics);
 IF NOT EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=k AND a.model_checksum=p_cell.model_checksum AND a.template_checksum=p_cell.template_checksum AND a.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation_v2()) THEN RAISE EXCEPTION 'independent complete public SQL audit is not prepared';END IF;
 SELECT * INTO STRICT r FROM public.gto_v31_public_model_audit_combos c WHERE c.audit_key=k AND c.combo=p_combo;
 FOR i IN 1..jsonb_array_length(p_cell.public_model->'action_ids') LOOP id:=p_cell.public_model#>>ARRAY['action_ids',(i-1)::text];m:=m||jsonb_build_object(id,r.frequencies[i]);q:=q||jsonb_build_object(id,r.action_evs[i]);END LOOP;
 RETURN jsonb_build_object('policy',r.policy_ev,'mix',m,'Q',q);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_base181(p_combo integer, p_board text, p_template jsonb)
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE prior text[]:=ARRAY['allcount10','allcount11','allcount12','allcount13','allcount14','allcount2','allcount3','allcount4','allcount5','allcount6','allcount7','allcount8','allcount9','boardcount10','boardcount11','boardcount12','boardcount13','boardcount14','boardcount2','boardcount3','boardcount4','boardcount5','boardcount6','boardcount7','boardcount8','boardcount9','boardmaxsuit','boardrank0','boardrank1','boardrank2','boardrank3','boardrank4','depth','facing_kind=all_in','facing_kind=bet','facing_kind=none','facing_kind=raise','facing_size_bucket=all_in','facing_size_bucket=none','facing_size_bucket=small','flushrank','game_family=cash','game_family=spin','game_family=tourney_ev','game_family=tourney_icm','hero_position=BB','hero_position=BTN','hero_position=SB','hgap','hhigh','hlow','holesuitboard0','holesuitboard1','hpocket','hsuited','iprange=01b3d4e721b36cf6d8d89fd4941b5ece0e9fd2853f61d1e5f98fbebb3f8f5228','iprange=46a1052fd09045ea14940360740c08c8e45786680fb629b992bd6dd60dbb7448','iprange=4e711cfed033f777818cc507b6c54c1963959d325916fad5eeb2903076817dea','iprange=53b631c6ee33a42f19c276dceef8e49bff0f5d012f3332200301e8e02a6f2e7f','iprange=5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','iprange=7297e35f5f97d678bf1c50f2c67f00b676d0da819459b34b566abeb553dfee21','matches','maxsuit','node_role=all_in','node_role=barrel','node_role=bet_raise','node_role=cbet','node_role=check_raise','node_role=delayed_cbet','node_role=facing_bet','node_role=facing_raise','node_role=open','node_role=probe','nover','npairs','nquads','ntrips','nunder','objective=cash_ev','objective=chip_ev','objective=icm','ooprange=3ac1e6fa6d92a000680addaf06eab130d2af9467d2e90aceae7cb542b8725c11','ooprange=4002e2111513d1de3ea6dec8a16bedb436fdd7f9a34ea6f08e2f5e95ee7bba1a','ooprange=505f32cd9ae2cef66951fcaecc0e8a8fc217ef1d4c0010bc0fe7b57ccf5a417a','ooprange=5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','ooprange=6f7f9456008af722359ef4b8d53353c7e3fbdb94412a2d7cc206526cf2857a1b','ooprange=85a3cb6615c4547abb4e559d5858dfbdc40eb4938abbf14c1bbf564c027b6c7e','opponent_position=BB','opponent_position=BTN','opponent_position=SB','pot_type=3bet','pot_type=4bet_plus','pot_type=limped','pot_type=srp','potbb','rakecap','rakepct','span','stackbb','straighttop','straightwindow','street=flop','street=river','street=turn','tablesize','utility_context=bubble','utility_context=cash_ev','utility_context=chip_ev','utility_context=final_table','utility_context=in_money','utility_context=ladder','utility_context=satellite','utility_context=spin_ladder'];own integer[];cards integer[];board integer[]:=ARRAY[]::integer[];ranks integer[];br integer[];hr integer[];bc integer[]:=array_fill(0,ARRAY[15]);ac integer[]:=array_fill(0,ARRAY[15]);sc integer[]:=array_fill(0,ARRAY[4]);bs integer[]:=array_fill(0,ARRAY[4]);ctx jsonb:=p_template->'context';scenario jsonb:=p_template->'scenario';f jsonb:='{}';v jsonb;out double precision[]:=ARRAY[]::double precision[];i integer;j integer;r integer;n integer;high integer;low integer;card integer;tmp integer;k text;val jsonb;matches integer:=0;nover integer:=0;nunder integer:=0;np integer:=0;nt integer:=0;nq integer:=0;maxs integer:=0;maxbs integer:=0;flushrank integer:=0;sw integer:=0;st integer:=0;hits integer;top integer;wr integer;countv integer;
BEGIN
 IF p_combo NOT BETWEEN 0 AND 1325 OR p_board!~'^([2-9TJQKA][cdhs]){3,5}$' THEN RAISE EXCEPTION 'public215 cards';END IF;
 high:=floor((1+sqrt(1+8*p_combo))/2)::integer;WHILE high*(high-1)/2>p_combo LOOP high:=high-1;END LOOP;WHILE (high+1)*high/2<=p_combo LOOP high:=high+1;END LOOP;low:=p_combo-high*(high-1)/2;own:=ARRAY[low,high];
 n:=length(p_board)/2;FOR i IN 0..n-1 LOOP board:=array_append(board,(strpos('23456789TJQKA',substr(p_board,2*i+1,1))-1)*4+strpos('cdhs',substr(p_board,2*i+2,1))-1);END LOOP;
 cards:=own||board;IF (SELECT count(DISTINCT x) FROM unnest(cards)x)<>n+2 THEN RAISE EXCEPTION 'public215 impossible deck';END IF;
 FOREACH card IN ARRAY board LOOP bc[card/4+2]:=bc[card/4+2]+1;bs[card%4+1]:=bs[card%4+1]+1;END LOOP;
 -- Original f09 hole normalization: rank descending, then matching-board suitcount descending.
 IF own[1]/4<own[2]/4 OR (own[1]/4=own[2]/4 AND bs[own[1]%4+1]<bs[own[2]%4+1]) THEN tmp:=own[1];own[1]:=own[2];own[2]:=tmp;END IF;
 FOREACH card IN ARRAY cards LOOP ac[card/4+2]:=ac[card/4+2]+1;sc[card%4+1]:=sc[card%4+1]+1;END LOOP;
 hr:=ARRAY[own[1]/4+2,own[2]/4+2];SELECT array_agg(x.value/4+2 ORDER BY x.value/4 DESC) INTO br FROM unnest(board)x(value);
 FOR i IN 1..2 LOOP matches:=matches+bc[hr[i]];IF hr[i]>br[1] THEN nover:=nover+1;END IF;IF hr[i]<br[n] THEN nunder:=nunder+1;END IF;END LOOP;
 FOR r IN 2..14 LOOP IF ac[r]=2 THEN np:=np+1;ELSIF ac[r]=3 THEN nt:=nt+1;ELSIF ac[r]=4 THEN nq:=nq+1;END IF;END LOOP;
 FOR i IN 1..4 LOOP maxs:=greatest(maxs,sc[i]);maxbs:=greatest(maxbs,bs[i]);END LOOP;
 FOREACH card IN ARRAY cards LOOP IF sc[card%4+1]>=5 THEN flushrank:=greatest(flushrank,card/4+2);END IF;END LOOP;
 FOR top IN 5..14 LOOP hits:=0;FOR wr IN top-4..top LOOP r:=CASE WHEN wr=1 THEN 14 ELSE wr END;IF ac[r]>0 THEN hits:=hits+1;END IF;END LOOP;sw:=greatest(sw,hits);IF hits=5 THEN st:=greatest(st,top);END IF;END LOOP;
 f:=jsonb_build_object('hhigh',hr[1],'hlow',hr[2],'hgap',hr[1]-hr[2],'hpocket',(hr[1]=hr[2])::integer,'hsuited',(own[1]%4=own[2]%4)::integer,'nover',nover,'nunder',nunder,'matches',matches,'maxsuit',maxs,'boardmaxsuit',maxbs,'span',br[1]-br[n],'npairs',np,'ntrips',nt,'nquads',nq,'straightwindow',sw,'straighttop',st,'flushrank',flushrank,'holesuitboard0',bs[own[1]%4+1],'holesuitboard1',bs[own[2]%4+1],'depth',(ctx->>'depth_bucket')::integer,'tablesize',(ctx->>'table_size')::integer,'potbb',public.fn_gto_v31_public215_f64(scenario->>'pot_chips_f64')/public.fn_gto_v31_public215_f64(scenario->>'chips_per_bb_f64'),'stackbb',public.fn_gto_v31_public215_f64(scenario->>'effective_stack_chips_f64')/public.fn_gto_v31_public215_f64(scenario->>'chips_per_bb_f64'),'rakepct',public.fn_gto_v31_public215_f64(scenario#>>'{rake_f64,0}'),'rakecap',public.fn_gto_v31_public215_f64(scenario#>>'{rake_f64,1}'));
 FOR i IN 1..n LOOP f:=f||jsonb_build_object('boardrank'||(i-1),br[i]);END LOOP;
 FOR r IN 2..14 LOOP f:=f||jsonb_build_object('boardcount'||r,bc[r],'allcount'||r,ac[r]);END LOOP;
 FOR k,val IN SELECT key,value FROM jsonb_each(ctx) LOOP IF k NOT IN('texture_class','depth_bucket','table_size') THEN f:=f||jsonb_build_object(k||'='||(val#>>'{}'),1);END IF;END LOOP;
 f:=f||jsonb_build_object('iprange='||(scenario->>'ip_range_checksum'),1,'ooprange='||(scenario->>'oop_range_checksum'),1);
 FOREACH k IN ARRAY prior LOOP out:=array_append(out,COALESCE((f->>k)::double precision,0));END LOOP;
 v:=public.fn_gto_v31_board_relative_key_v2(p_combo,p_board)::jsonb;IF v IS NULL THEN RAISE EXCEPTION 'public215 V2 geometry missing';END IF;
 out:=out||ARRAY[(v->>1)::double precision,(v->>2)::double precision];FOR i IN 0..8 LOOP out:=array_append(out,((v->>2)::integer=i)::integer::double precision);END LOOP;
 FOR i IN 0..4 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['3',i::text])::double precision,-1));END LOOP;out:=array_append(out,jsonb_array_length(v->3)::double precision);
 FOR i IN 0..1 LOOP FOR j IN 0..2 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['4',i::text,j::text])::double precision,-1));END LOOP;END LOOP;
 out:=out||ARRAY[(v->>5)::boolean::integer::double precision,(v->>6)::double precision,(v->>7)::double precision];
 FOR i IN 0..3 LOOP FOR j IN 0..3 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['8',i::text,j::text])::double precision,-1));END LOOP;END LOOP;
 FOR i IN 0..3 LOOP out:=array_append(out,jsonb_array_length(v#>ARRAY['8',i::text])::double precision);END LOOP;out:=array_append(out,(v->>9)::double precision);
 FOR i IN 0..4 LOOP FOR j IN 0..2 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['10',i::text,j::text])::double precision,-1));END LOOP;END LOOP;out:=array_append(out,jsonb_array_length(v->10)::double precision);
 FOR i IN 0..1 LOOP out:=array_append(out,(v#>>ARRAY['11',i::text])::double precision);END LOOP;FOR i IN 0..2 LOOP out:=array_append(out,(v#>>ARRAY['12',i::text])::double precision);END LOOP;
 IF cardinality(out)<>181 THEN RAISE EXCEPTION 'public215 base181 shape %',cardinality(out);END IF;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_bits(p double precision[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$ SELECT jsonb_agg(encode(float8send(x),'hex') ORDER BY i)FROM unnest(p)WITH ORDINALITY t(x,i) $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_build_cell(p_dataset_id uuid, p_context jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_envelope jsonb:=p_context;v_bundle public.gto_v31_input_bundles%ROWTYPE;
  v_modelcell public.gto_v31_runtime_cells%ROWTYPE;v_approved jsonb;v_globalsources jsonb;v_board text[];v_item jsonb;
  v_source_nodes jsonb;
  v_source_rows integer;
  v_train_rows integer;
  v_holdout_rows integer;
  v_spec_variants integer;
  v_machine_variants integer;
  v_cross_split_board_overlaps integer;
  v_specs jsonb;
  v_hand_matrix jsonb;
  v_policy_evs jsonb;
  v_action_evs jsonb;
  v_lineage text;
  v_cell jsonb;
  v_existing_checksum text;
BEGIN
  IF NOT public.fn_gto_v31_public215_keys(v_envelope,ARRAY['context','policy_representation','public_model','public_template','public_training_provenance','public_model_build_receipt','model_checksum','template_checksum','feature_schema_checksum','training_provenance_checksum','model_build_receipt_checksum']) OR v_envelope->>'policy_representation' IS DISTINCT FROM 'public_hist215_v1' OR octet_length(public.fn_gto_v31_public215_canonical(v_envelope))>4194304 THEN RAISE EXCEPTION 'complete bounded public215 model envelope required';END IF;
  p_context:=v_envelope->'context';
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF p_context IS NULL OR jsonb_typeof(p_context)<>'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_context))<>13
     OR NOT (p_context ?& ARRAY['street','game_family','objective','utility_context',
       'table_size','pot_type','hero_position','opponent_position','depth_bucket',
       'texture_class','node_role','facing_kind','facing_size_bucket']) THEN
    RAISE EXCEPTION 'compact cell context is invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
    WHERE d.value=p_context) THEN
    RAISE EXCEPTION 'compact cell is not in declared coverage';
  END IF;
  SELECT c.cell_key_checksum INTO v_existing_checksum
    FROM public.gto_v31_runtime_cells c
   WHERE c.dataset_id=p_dataset_id
     AND c.street=p_context->>'street'
     AND c.game_family=p_context->>'game_family'
     AND c.objective=p_context->>'objective'
     AND c.utility_context=p_context->>'utility_context'
     AND c.table_size=(p_context->>'table_size')::smallint
     AND c.pot_type=p_context->>'pot_type'
     AND c.hero_position=p_context->>'hero_position'
     AND c.opponent_position=p_context->>'opponent_position'
     AND c.depth_bucket=(p_context->>'depth_bucket')::integer
     AND c.texture_class=p_context->>'texture_class'
     AND c.node_role=p_context->>'node_role'
     AND c.facing_kind=p_context->>'facing_kind'
     AND c.facing_size_bucket=p_context->>'facing_size_bucket';


  WITH matching_nodes AS MATERIALIZED (
    SELECT a.source_row_id,a.machine_id,a.source_artifact_checksum,s.scenario_hash,s.strategy_matrix_v2,n.value AS node,
           CASE WHEN a.machine_id='M2' THEN 'holdout' ELSE 'train' END AS split
      FROM public.gto_v31_source_artifacts a
      JOIN public.solved_spots_gold s ON s.id=a.source_row_id
       AND s.quality_status='validated' AND s.audited_at IS NOT NULL
       AND s.source_artifact_checksum=a.source_artifact_checksum
      CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
     WHERE a.dataset_id=p_dataset_id
       AND n.value#>>'{node_context,street}'=p_context->>'street'
       AND n.value#>>'{node_context,game_family}'=p_context->>'game_family'
       AND n.value#>>'{node_context,objective}'=p_context->>'objective'
       AND n.value#>>'{node_context,utility_context}'=p_context->>'utility_context'
       AND (n.value#>>'{node_context,table_size}')::integer=(p_context->>'table_size')::integer
       AND n.value#>>'{node_context,pot_type}'=p_context->>'pot_type'
       AND n.value#>>'{node_context,hero_position}'=p_context->>'hero_position'
       AND n.value#>>'{node_context,opponent_position}'=p_context->>'opponent_position'
       AND (n.value#>>'{node_context,depth_bucket}')::integer=(p_context->>'depth_bucket')::integer
       AND n.value#>>'{node_context,texture_class}'=p_context->>'texture_class'
       AND n.value#>>'{node_context,node_role}'=p_context->>'node_role'
       AND n.value#>>'{node_context,facing_kind}'=p_context->>'facing_kind'
       AND n.value#>>'{node_context,facing_size_bucket}'=p_context->>'facing_size_bucket'
  ), matching_artifacts AS MATERIALIZED (
    SELECT DISTINCT source_row_id,source_artifact_checksum,scenario_hash,strategy_matrix_v2
      FROM matching_nodes
  ), verified_artifacts AS MATERIALIZED (
    SELECT source_row_id
      FROM matching_artifacts
     WHERE source_artifact_checksum=public.fn_gto_v31_source_artifact_checksum(scenario_hash,strategy_matrix_v2)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source_row_id',m.source_row_id,'machine_id',m.machine_id,
           'source_artifact_checksum',m.source_artifact_checksum,'node',m.node,'split',m.split
         ) ORDER BY m.source_row_id,m.node->>'node'),'[]'::jsonb)
    INTO v_source_nodes
    FROM matching_nodes m JOIN verified_artifacts a USING (source_row_id);
  PERFORM public.fn_gto_v31_assert_source_contract(n.value->'node',v_dataset.policy_export_schema,v_dataset.icm_model_checksum)
    FROM jsonb_array_elements(v_source_nodes) n(value);
  IF v_existing_checksum IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.cell_key_checksum=v_existing_checksum AND c.policy_representation='public_hist215_v1' AND c.public_model=v_envelope->'public_model' AND c.public_template=v_envelope->'public_template' AND c.public_training_provenance=v_envelope->'public_training_provenance' AND c.public_model_build_receipt=v_envelope->'public_model_build_receipt' AND c.model_checksum=v_envelope->>'model_checksum' AND c.template_checksum=v_envelope->>'template_checksum' AND c.feature_schema_checksum=v_envelope->>'feature_schema_checksum' AND c.training_provenance_checksum=v_envelope->>'training_provenance_checksum' AND c.model_build_receipt_checksum=v_envelope->>'model_build_receipt_checksum') THEN RAISE EXCEPTION 'numeric cell retry has different frozen model bytes';END IF;
    RETURN v_existing_checksum;
  END IF;

  WITH source_nodes AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(v_source_nodes) AS n(
      source_row_id uuid,machine_id text,source_artifact_checksum text,node jsonb,split text
    )
  )
  SELECT count(*),count(*) FILTER (WHERE split='train'),count(*) FILTER (WHERE split='holdout'),
         count(DISTINCT node->'action_specs'),count(DISTINCT machine_id),
         (SELECT count(*) FROM source_nodes train
           JOIN source_nodes holdout
             ON public.fn_gto_v31_board_rank_signature(holdout.node#>>'{node_context,board}')=
                public.fn_gto_v31_board_rank_signature(train.node#>>'{node_context,board}')
          WHERE train.split='train' AND holdout.split='holdout'),
         (array_agg(node->'action_specs'))[1],
         encode(digest(string_agg(source_row_id::text||':'||(node->>'node')||':'||
           (node->>'node_checksum'),'' ORDER BY source_row_id::text,node->>'node'),'sha256'),'hex')
    INTO v_source_rows,v_train_rows,v_holdout_rows,v_spec_variants,v_machine_variants,
         v_cross_split_board_overlaps,v_specs,v_lineage
    FROM source_nodes;
  IF v_source_rows<2 OR v_train_rows<1 OR v_holdout_rows<1 OR v_spec_variants<>1
     OR v_machine_variants<>2 OR v_cross_split_board_overlaps<>0
     OR v_specs IS NULL OR v_lineage IS NULL THEN
    RAISE EXCEPTION 'cell needs M1 and M2, one action topology, and rank-disjoint train and holdout sources';
  END IF;

  IF v_train_rows<>57 OR v_holdout_rows<>8 THEN RAISE EXCEPTION 'numeric cell requires complete approved57 M1 and selected8 M2 nodes';END IF;
  SELECT * INTO STRICT v_bundle FROM public.gto_v31_input_bundles WHERE input_bundle_id=v_dataset.input_bundle_id AND approval_status='approved' AND bundle_checksum=v_dataset.input_bundle_checksum;
  IF v_dataset.policy_representation IS DISTINCT FROM 'public_hist215_v1' OR public.fn_gto_v31_public215_bundle_valid(v_bundle.bundle_manifest) IS NOT TRUE OR public.fn_gto_v31_public215_runtime_protocol_valid(v_bundle.bundle_manifest#>'{public215_protocols,runtime_parity_protocol}',v_bundle.bundle_manifest->'public215_contexts') IS NOT TRUE THEN RAISE EXCEPTION 'approved public215 bundle and protocol required';END IF;
  SELECT value INTO STRICT v_approved FROM jsonb_array_elements(v_bundle.bundle_manifest->'public215_contexts')WHERE value->'context'=p_context;
  IF v_envelope->'public_model'->'action_ids' IS DISTINCT FROM v_approved->'model_action_order' OR v_envelope->>'template_checksum' IS DISTINCT FROM v_approved->>'template_checksum' OR v_envelope->>'feature_schema_checksum' IS DISTINCT FROM v_approved->>'feature_schema_checksum' THEN RAISE EXCEPTION 'model action order/template/schema differs from independently approved source target';END IF;
  v_cell:=p_context||v_envelope-'context'||public.fn_gto_v31_feature_identity(v_dataset.feature_contract_version)||public.fn_gto_v31_policy_identity(v_dataset.policy_export_schema)||jsonb_build_object('hand_matrix',NULL,'policy_ev_matrix',NULL,'action_ev_matrix',NULL,'action_specs',v_specs,'source_rows',v_source_rows,'train_source_rows',v_train_rows,'holdout_source_rows',v_holdout_rows,'lineage_checksum',v_lineage,'sql_physics_checksum',public.fn_gto_v31_public215_digest(jsonb_build_object('physics',public.fn_gto_v31_public215_physics_implementation(),'encoding',public.fn_gto_v31_public215_encoding_for(v_dataset.feature_contract_version))));
  v_cell:=v_cell||jsonb_build_object('cell_key_checksum',public.fn_gto_v31_cell_key_checksum(v_cell));v_cell:=v_cell||jsonb_build_object('cell_payload_checksum',public.fn_gto_v31_cell_payload_checksum(v_cell));
  IF public.fn_gto_v31_cell_payload_valid(v_cell) IS NOT TRUE THEN RAISE EXCEPTION 'strict frozen numeric model payload failed validation';END IF;
  v_modelcell:=jsonb_populate_record(NULL::public.gto_v31_runtime_cells,v_cell||jsonb_build_object('dataset_id',p_dataset_id));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_source_nodes)s WHERE public.fn_gto_v31_public215_template_geometry(v_modelcell.public_template,public.fn_gto_v31_public215_source_geometry(s->'node'))IS NOT TRUE)THEN RAISE EXCEPTION 'numeric template and actual M1/M2 source root geometry/actor/rake disagree';END IF;
  v_globalsources:=public.fn_gto_v31_public215_sources(v_dataset);
  IF EXISTS(WITH ranks AS MATERIALIZED(SELECT value->>'machine_id' machine,public.fn_gto_v31_public215_rank_signature(value->>'board')signature FROM jsonb_array_elements(v_globalsources))SELECT 1 FROM ranks GROUP BY signature HAVING count(DISTINCT machine)>1)THEN RAISE EXCEPTION 'new215 global rank-group train/holdout overlap';END IF;
  IF public.fn_gto_v31_public215_provenance_valid(v_modelcell,v_dataset,v_bundle,v_globalsources) IS NOT TRUE THEN RAISE EXCEPTION 'numeric model provenance does not reconcile genuine complete approved M1 capture';END IF;
  IF public.fn_gto_v31_public215_selected_complete(v_dataset)IS NOT TRUE OR public.fn_gto_v31_public215_frozen_model_valid(v_modelcell,v_dataset)IS NOT TRUE THEN RAISE EXCEPTION 'complete exact selected M2 subset and frozen pre-opening model identity required';END IF;
  IF public.fn_gto_v31_public215_build_receipt(v_modelcell,v_dataset,v_bundle) IS NOT TRUE THEN RAISE EXCEPTION 'independent public215 SQL/all-head runtime parity or bounded Linux cost receipt failed';END IF;

  INSERT INTO public.gto_v31_runtime_cells (
    dataset_id,cell_key_checksum,street,game_family,objective,utility_context,
    table_size,pot_type,hero_position,opponent_position,depth_bucket,texture_class,
    node_role,facing_kind,facing_size_bucket,hand_matrix,action_specs,
    policy_ev_matrix,action_ev_matrix,source_rows,train_source_rows,
    holdout_source_rows,cell_payload_checksum,lineage_checksum,feature_contract_version,policy_export_schema,policy_representation,public_model,public_template,public_training_provenance,public_model_build_receipt,model_checksum,template_checksum,feature_schema_checksum,training_provenance_checksum,model_build_receipt_checksum,sql_physics_checksum
  ) VALUES (
    p_dataset_id,v_cell->>'cell_key_checksum',v_cell->>'street',v_cell->>'game_family',
    v_cell->>'objective',v_cell->>'utility_context',(v_cell->>'table_size')::smallint,
    v_cell->>'pot_type',v_cell->>'hero_position',v_cell->>'opponent_position',
    (v_cell->>'depth_bucket')::integer,v_cell->>'texture_class',v_cell->>'node_role',
    v_cell->>'facing_kind',v_cell->>'facing_size_bucket',NULL,
    v_cell->'action_specs',NULL,NULL,
    (v_cell->>'source_rows')::integer,(v_cell->>'train_source_rows')::integer,
    (v_cell->>'holdout_source_rows')::integer,v_cell->>'cell_payload_checksum',v_cell->>'lineage_checksum',v_dataset.feature_contract_version,v_dataset.policy_export_schema,'public_hist215_v1',v_modelcell.public_model,v_modelcell.public_template,v_modelcell.public_training_provenance,v_modelcell.public_model_build_receipt,v_modelcell.model_checksum,v_modelcell.template_checksum,v_modelcell.feature_schema_checksum,v_modelcell.training_provenance_checksum,v_modelcell.model_build_receipt_checksum,v_modelcell.sql_physics_checksum
  );

  INSERT INTO public.gto_v31_cell_source_receipts (
    dataset_id,cell_id,source_row_id,source_node,source_node_checksum,
    source_artifact_checksum,machine_id,split
  )
  SELECT p_dataset_id,c.cell_id,n.source_row_id,n.node->>'node',n.node->>'node_checksum',
         n.source_artifact_checksum,n.machine_id,n.split
    FROM public.gto_v31_runtime_cells c
    CROSS JOIN LATERAL jsonb_to_recordset(v_source_nodes) AS n(
      source_row_id uuid,machine_id text,source_artifact_checksum text,node jsonb,split text
    )
   WHERE c.dataset_id=p_dataset_id AND c.cell_key_checksum=v_cell->>'cell_key_checksum';
  IF NOT FOUND THEN RAISE EXCEPTION 'database-computed cell did not retain source receipts'; END IF;
  RETURN v_cell->>'cell_key_checksum';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_build_receipt(p_cell gto_v31_runtime_cells, p_dataset gto_v31_datasets, p_bundle gto_v31_input_bundles)
 RETURNS boolean
 LANGUAGE plpgsql
 STRICT
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb:=p_cell.public_model_build_receipt;t jsonb:=p_cell.public_training_provenance;runtime jsonb;cost jsonb;cases jsonb;approved jsonb;item jsonb;actual public.gto_v31_public_model_audit_combos%ROWTYPE;k text;board text[];ownlo integer;ownhi integer;v_combo integer;i integer:=0;physics double precision;inference double precision;maxphysics double precision:=0;maxinference double precision:=0;f text;
BEGIN
 IF NOT public.fn_gto_v31_public215_keys(r,ARRAY['format','dataset_id','input_bundle_checksum','model_checksum','training_provenance_checksum','template_checksum','feature_schema_checksum','encoder_checksum','physics_checksum','dependency_lock_checksum','producer_commit','producer_bundle_checksum','runtime','cases','cost']) OR r->>'format' IS DISTINCT FROM 'public_hist215_build_receipt_v1' OR r->>'dataset_id' IS DISTINCT FROM p_dataset.dataset_id::text OR r->>'input_bundle_checksum' IS DISTINCT FROM p_bundle.bundle_checksum OR r->>'model_checksum' IS DISTINCT FROM p_cell.model_checksum OR r->>'training_provenance_checksum' IS DISTINCT FROM p_cell.training_provenance_checksum OR r->>'template_checksum' IS DISTINCT FROM p_cell.template_checksum OR r->>'feature_schema_checksum' IS DISTINCT FROM p_cell.feature_schema_checksum OR public.fn_gto_v31_public215_digest(r) IS DISTINCT FROM p_cell.model_build_receipt_checksum THEN RETURN false;END IF;
 FOREACH f IN ARRAY ARRAY['encoder_checksum','physics_checksum','dependency_lock_checksum','producer_commit','producer_bundle_checksum'] LOOP IF r->f IS DISTINCT FROM t->f THEN RETURN false;END IF;END LOOP;
 runtime:=r->'runtime';cost:=r->'cost';cases:=r->'cases';
 IF NOT public.fn_gto_v31_public215_keys(runtime,ARRAY['node_version','platform','arch','napi_version','native_source_checksum','native_binary_checksum']) OR jsonb_typeof(runtime->'node_version') IS DISTINCT FROM 'string' OR runtime->>'node_version'!~'^v?22\.[0-9]+\.[0-9]+$' OR runtime->>'platform' IS DISTINCT FROM 'linux' OR COALESCE(runtime->>'arch','') NOT IN('x64','arm64') OR runtime->'napi_version' IS DISTINCT FROM '8'::jsonb OR runtime->>'native_source_checksum' IS DISTINCT FROM '83442cb6604dfaa30ec7ecc6ce38957355609e722b5df85b866365c97f0ccf9b' OR COALESCE(runtime->>'native_binary_checksum','')!~'^[0-9a-f]{64}$' OR runtime->>'native_binary_checksum'=repeat('0',64) THEN RETURN false;END IF;
 SELECT value->'cases' INTO approved FROM jsonb_array_elements(p_bundle.bundle_manifest#>'{public215_protocols,runtime_parity_protocol,contexts}') WHERE value->'context'=p_cell.public_template->'context';
 IF approved IS NULL OR jsonb_typeof(cases) IS DISTINCT FROM 'array' OR jsonb_array_length(cases)<>jsonb_array_length(approved) OR jsonb_array_length(cases) NOT BETWEEN 2 AND 32 THEN RETURN false;END IF;
 IF NOT public.fn_gto_v31_public215_keys(cost,ARRAY['method','clock','cold_cases','max_physics_ms_f64','max_inference_ms_f64','execution_limit_ms','model_bytes','head_count']) OR cost->>'method' IS DISTINCT FROM 'cold_public215_features_and_all_heads_v1' OR cost->>'clock' IS DISTINCT FROM 'process.hrtime.bigint' OR cost->'cold_cases' IS DISTINCT FROM to_jsonb(jsonb_array_length(cases)) OR cost->'execution_limit_ms' IS DISTINCT FROM '8000'::jsonb OR cost->'model_bytes' IS DISTINCT FROM to_jsonb(octet_length(public.fn_gto_v31_public215_canonical(p_cell.public_model))) OR cost->'head_count' IS DISTINCT FROM to_jsonb(jsonb_array_length(p_cell.public_model->'heads')) THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(cases) LOOP
  IF NOT public.fn_gto_v31_public215_keys(item,ARRAY['board','own','features_f64','raw_heads_f64','policy_ev_f64','Q_f64','frequency_f64','physics_ms_f64','inference_ms_f64']) OR (item-'features_f64'-'raw_heads_f64'-'policy_ev_f64'-'Q_f64'-'frequency_f64'-'physics_ms_f64'-'inference_ms_f64') IS DISTINCT FROM approved->i OR NOT public.fn_gto_v31_public215_cards(item->>'board',item->'own') THEN RETURN false;END IF;
  IF jsonb_typeof(item->'physics_ms_f64') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'inference_ms_f64') IS DISTINCT FROM 'string' THEN RETURN false;END IF;physics:=public.fn_gto_v31_public215_f64(item->>'physics_ms_f64');inference:=public.fn_gto_v31_public215_f64(item->>'inference_ms_f64');IF physics<=0 OR inference<physics OR inference>8000 THEN RETURN false;END IF;maxphysics:=greatest(maxphysics,physics);maxinference:=greatest(maxinference,inference);
  SELECT array_agg(substring(item->>'board' FROM j FOR 2)ORDER BY j)INTO board FROM generate_series(1,length(item->>'board'),2)j;
  ownlo:=(strpos('23456789TJQKA',left(item#>>'{own,0}',1))-1)*4+strpos('cdhs',right(item#>>'{own,0}',1))-1;ownhi:=(strpos('23456789TJQKA',left(item#>>'{own,1}',1))-1)*4+strpos('cdhs',right(item#>>'{own,1}',1))-1;v_combo:=ownhi*(ownhi-1)/2+ownlo;
  k:=public.fn_gto_v31_public215_prepare_audit_for(p_cell,board);SELECT * INTO STRICT actual FROM public.gto_v31_public_model_audit_combos WHERE audit_key=k AND public.gto_v31_public_model_audit_combos.combo=v_combo;
  IF public.fn_gto_v31_public215_bits(actual.features) IS DISTINCT FROM item->'features_f64' OR public.fn_gto_v31_public215_bits(actual.raw_heads) IS DISTINCT FROM item->'raw_heads_f64' OR encode(float8send(actual.policy_ev),'hex') IS DISTINCT FROM item->>'policy_ev_f64' OR public.fn_gto_v31_public215_bits(actual.action_evs) IS DISTINCT FROM item->'Q_f64' OR public.fn_gto_v31_public215_bits(actual.frequencies) IS DISTINCT FROM item->'frequency_f64' THEN RETURN false;END IF;i:=i+1;
 END LOOP;
 RETURN encode(float8send(maxphysics),'hex')=cost->>'max_physics_ms_f64' AND encode(float8send(maxinference),'hex')=cost->>'max_inference_ms_f64';
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_bundle_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE base jsonb;oldfiles jsonb;v_file jsonb;context_entry jsonb;contexts jsonb;protocols jsonb;k text;digest text;previous text:='';identity text;
BEGIN
 IF jsonb_typeof(p)<>'object' OR (SELECT count(*)FROM jsonb_object_keys(p))<>12 OR NOT p?&ARRAY['bundle_key','bundle_version','range_bundle_checksum','source_combo_order_checksum','icm_model_checksum','files','approval_note','feature_contract_version','policy_export_schema','policy_representation','public215_contexts','public215_protocols'] OR p->>'policy_representation'<>'public_hist215_v1' OR p->>'feature_contract_version' NOT IN('holdem-public-hist215-v1','holdem-public-hist215-v2') OR p->>'policy_export_schema'<>'smarter-poker.pio-policy.v4' THEN RETURN false;END IF;
 IF jsonb_typeof(p->'files')<>'array' THEN RETURN false;END IF;
 FOR v_file IN SELECT value FROM jsonb_array_elements(p->'files') LOOP
  IF jsonb_typeof(v_file)<>'object' OR (SELECT count(*)FROM jsonb_object_keys(v_file))<>3 OR NOT v_file?&ARRAY['kind','path','checksum'] OR jsonb_typeof(v_file->'kind')<>'string' OR jsonb_typeof(v_file->'path')<>'string' OR jsonb_typeof(v_file->'checksum')<>'string' OR v_file->>'kind' NOT IN('range','combo_order','icm_model','payout_model','scenario_manifest','public215_template','public215_training_recipe','public215_source_partition','public215_runtime_parity_protocol','public215_dependency_lock','public215_physics_protocol','public215_feature_schema') OR v_file->>'path'!~'^[A-Za-z0-9][A-Za-z0-9._/-]{1,255}$' OR position('..' IN v_file->>'path')>0 OR('/'||(v_file->>'path')||'/')LIKE '%//%'OR('/'||(v_file->>'path')||'/')LIKE '%/./%' OR v_file->>'checksum'!~'^[0-9a-f]{64}$' OR v_file->>'checksum'=repeat('0',64) THEN RETURN false;END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'path')FROM jsonb_array_elements(p->'files'))<>jsonb_array_length(p->'files') THEN RETURN false;END IF;
 SELECT jsonb_agg(value)INTO oldfiles FROM jsonb_array_elements(p->'files')WHERE value->>'kind' NOT LIKE 'public215_%';
 base:=(p-'policy_representation'-'public215_contexts'-'public215_protocols')||jsonb_build_object('feature_contract_version','holdem-board-relative-v2','files',oldfiles);
 PERFORM public.fn_gto_v31_input_bundle_checksum_matrix_v2(base);
 protocols:=p->'public215_protocols';IF jsonb_typeof(protocols)<>'object' OR (SELECT count(*)FROM jsonb_object_keys(protocols))<>6 OR NOT protocols?&ARRAY['training_recipe','source_partition','runtime_parity_protocol','dependency_lock','physics_protocol','feature_schema'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['training_recipe','source_partition','runtime_parity_protocol','dependency_lock','physics_protocol','feature_schema'] LOOP
  IF jsonb_typeof(protocols->k)<>'object' THEN RETURN false;END IF;digest:=public.fn_gto_v31_public215_digest(protocols->k);
  IF (SELECT count(*)FROM jsonb_array_elements(p->'files')f WHERE f->>'kind'='public215_'||k AND f->>'checksum'=digest)<>1 OR(SELECT count(*)FROM jsonb_array_elements(p->'files')f WHERE f->>'kind'='public215_'||k)<>1 THEN RETURN false;END IF;
 END LOOP;
 IF COALESCE(protocols#>>'{training_recipe,whole_variant}','')NOT IN('direct','coherent')OR protocols#>'{training_recipe,parameters}'IS DISTINCT FROM '{"max_iter":100,"max_leaf_nodes":15,"min_samples_leaf":10,"l2_regularization_f64":"4024000000000000","early_stopping":false,"random_state":731}'::jsonb OR jsonb_typeof(protocols#>'{training_recipe,encoder_descriptor}')IS DISTINCT FROM 'object'OR protocols#>>'{training_recipe,encoder_checksum}'IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols#>'{training_recipe,encoder_descriptor}')THEN RETURN false;END IF;
 IF public.fn_gto_v31_public215_digest(protocols->'feature_schema') IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(p->>'feature_contract_version') THEN RETURN false;END IF;
 contexts:=p->'public215_contexts';IF jsonb_typeof(contexts)<>'array' OR jsonb_array_length(contexts)<1 THEN RETURN false;END IF;
 FOR context_entry IN SELECT value FROM jsonb_array_elements(contexts) LOOP
  IF jsonb_typeof(context_entry)<>'object' OR (SELECT count(*)FROM jsonb_object_keys(context_entry))<>5 OR NOT context_entry?&ARRAY['context','expected_children','model_action_order','template_checksum','feature_schema_checksum'] OR jsonb_typeof(context_entry->'context')<>'object' OR (SELECT count(*)FROM jsonb_object_keys(context_entry->'context'))<>13 OR context_entry->>'feature_schema_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(p->>'feature_contract_version') OR context_entry->>'template_checksum'!~'^[0-9a-f]{64}$' THEN RETURN false;END IF;
  IF NOT (context_entry->'context')?&ARRAY['street','game_family','objective','utility_context','table_size','pot_type','hero_position','opponent_position','depth_bucket','texture_class','node_role','facing_kind','facing_size_bucket'] THEN RETURN false;END IF;
  identity:=public.fn_gto_v31_public215_canonical(context_entry->'context');IF identity COLLATE "C"<=previous COLLATE "C" THEN RETURN false;END IF;previous:=identity;
  IF jsonb_typeof(context_entry->'expected_children')<>'array' OR jsonb_array_length(context_entry->'expected_children') NOT BETWEEN 2 AND 16 OR EXISTS(SELECT 1 FROM jsonb_array_elements(context_entry->'expected_children')a WHERE jsonb_typeof(a)<>'string' OR a#>>'{}'!~'^(c|f|b[1-9][0-9]{0,78})$') OR (SELECT count(DISTINCT value)FROM jsonb_array_elements(context_entry->'expected_children'))<>jsonb_array_length(context_entry->'expected_children') THEN RETURN false;END IF;
  IF context_entry->'model_action_order' IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY value#>>'{}' COLLATE "C")FROM jsonb_array_elements(context_entry->'expected_children'))THEN RETURN false;END IF;
  IF (SELECT count(*)FROM jsonb_array_elements(p->'files')f WHERE f->>'kind'='public215_template' AND f->>'checksum'=context_entry->>'template_checksum')<>1 THEN RETURN false;END IF;
 END LOOP;
 IF (SELECT count(*)FROM jsonb_array_elements(p->'files')f WHERE f->>'kind'='public215_template')<>jsonb_array_length(contexts) THEN RETURN false;END IF;
 PERFORM public.fn_gto_v31_public215_canonical(p-'approval_note');RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_canonical(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE fast text;t text;v record;parts text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(p)='object' AND p->>'format'='public_hist215_v1' THEN
  fast:=public.fn_gto_v31_public215_model_canonical_fast(p);IF fast IS NOT NULL THEN RETURN fast;END IF;
 END IF;
 CASE jsonb_typeof(p)
 WHEN 'object' THEN
  FOR v IN SELECT key,value FROM jsonb_each(p) ORDER BY key COLLATE "C" LOOP
   IF v.key!~'^[ -~]*$' THEN RAISE EXCEPTION 'public215 canonical ASCII key';END IF;
   parts:=array_append(parts,to_jsonb(v.key)::text||':'||public.fn_gto_v31_public215_canonical(v.value));
  END LOOP;RETURN '{'||array_to_string(parts,',')||'}';
 WHEN 'array' THEN
  FOR v IN SELECT value FROM jsonb_array_elements(p) LOOP parts:=array_append(parts,public.fn_gto_v31_public215_canonical(v.value));END LOOP;RETURN '['||array_to_string(parts,',')||']';
 WHEN 'string' THEN IF (p#>>'{}')!~'^[ -~]*$' THEN RAISE EXCEPTION 'public215 canonical ASCII';END IF;RETURN p::text;
 WHEN 'number' THEN t:=p::text;IF t!~'^-?(0|[1-9][0-9]*)$' OR abs(t::numeric)>9007199254740991 OR t='-0' THEN RAISE EXCEPTION 'public215 canonical safeinteger';END IF;RETURN t;
 ELSE RETURN p::text;
 END CASE;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_cards(p_board text, p_own jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE cards text[];card text;lo integer;hi integer;
BEGIN
 IF p_board IS NULL OR p_board!~'^([2-9TJQKA][cdhs]){3,5}$' THEN RETURN false;END IF;
 SELECT array_agg(substring(p_board FROM i FOR 2))INTO cards FROM generate_series(1,length(p_board),2)i;
 IF p_own IS NOT NULL THEN
  IF jsonb_typeof(p_own) IS DISTINCT FROM 'array' OR jsonb_array_length(p_own)<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_own)c WHERE jsonb_typeof(c) IS DISTINCT FROM 'string' OR c#>>'{}'!~'^[2-9TJQKA][cdhs]$') THEN RETURN false;END IF;
  lo:=(strpos('23456789TJQKA',left(p_own->>0,1))-1)*4+strpos('cdhs',right(p_own->>0,1))-1;
  hi:=(strpos('23456789TJQKA',left(p_own->>1,1))-1)*4+strpos('cdhs',right(p_own->>1,1))-1;
  IF lo>=hi THEN RETURN false;END IF;cards:=cards||ARRAY[p_own->>0,p_own->>1];
 END IF;
 RETURN cardinality(cards)=(SELECT count(DISTINCT x)FROM unnest(cards)x);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_cell_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
 IF OLD.policy_representation='public_hist215_v1' THEN RAISE EXCEPTION 'numeric model cell and all immutable receipts cannot be rewritten or deleted';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_cell_model_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE k text;m jsonb:=p->'public_model';t jsonb:=p->'public_template';
BEGIN
 IF p->>'policy_representation' IS DISTINCT FROM 'public_hist215_v1' OR p->>'feature_contract_version' NOT IN('holdem-public-hist215-v1','holdem-public-hist215-v2') OR p->>'policy_export_schema' IS DISTINCT FROM 'smarter-poker.pio-policy.v4' OR COALESCE(p->'hand_matrix','null')<>'null' OR COALESCE(p->'policy_ev_matrix','null')<>'null' OR COALESCE(p->'action_ev_matrix','null')<>'null' OR public.fn_gto_v31_public215_model_valid(m) IS NOT TRUE OR public.fn_gto_v31_public215_template_valid_for(t,p->>'feature_contract_version') IS NOT TRUE OR p->>'feature_schema_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(p->>'feature_contract_version') THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['model_checksum','template_checksum','training_provenance_checksum','model_build_receipt_checksum','sql_physics_checksum'] LOOP IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR p->>k!~'^[0-9a-f]{64}$' OR p->>k=repeat('0',64) THEN RETURN false;END IF;END LOOP;
 IF public.fn_gto_v31_public215_digest(m) IS DISTINCT FROM p->>'model_checksum' OR public.fn_gto_v31_public215_digest(t) IS DISTINCT FROM p->>'template_checksum' OR public.fn_gto_v31_public215_digest(p->'public_training_provenance') IS DISTINCT FROM p->>'training_provenance_checksum' OR public.fn_gto_v31_public215_digest(p->'public_model_build_receipt') IS DISTINCT FROM p->>'model_build_receipt_checksum' OR m->>'template_sha256' IS DISTINCT FROM p->>'template_checksum' OR m->>'feature_schema_sha256' IS DISTINCT FROM p->>'feature_schema_checksum' OR m->>'provenance_sha256' IS DISTINCT FROM p->>'training_provenance_checksum' OR NOT public.fn_gto_v31_action_specs_valid(p->'action_specs') OR (SELECT count(*)FROM jsonb_object_keys(p->'action_specs'))<>jsonb_array_length(m->'action_ids') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(m->'action_ids')a WHERE NOT(p->'action_specs')?a) THEN RETURN false;END IF;
 FOR k IN SELECT jsonb_object_keys(t->'context') LOOP IF p->k IS DISTINCT FROM t#>ARRAY['context',k] THEN RETURN false;END IF;END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_compile(p_model jsonb)
 RETURNS gto_v31_public215_head[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE result public.gto_v31_public215_head[]:=ARRAY[]::public.gto_v31_public215_head[];h public.gto_v31_public215_head;t public.gto_v31_public215_tree;head jsonb;tree jsonb;node jsonb;i integer;n integer;
BEGIN
 IF NOT public.fn_gto_v31_public215_model_valid(p_model) THEN RAISE EXCEPTION 'strict numeric public215 model required';END IF;
 FOR head IN SELECT value FROM jsonb_array_elements(p_model->'heads') LOOP
  h.baseline:=public.fn_gto_v31_public215_f64(head->>'baseline_f64');h.trees:=ARRAY[]::public.gto_v31_public215_tree[];
  FOR tree IN SELECT value FROM jsonb_array_elements(head->'trees') LOOP
   n:=jsonb_array_length(tree);t.feature:=array_fill((-1)::smallint,ARRAY[n]);t.threshold:=array_fill(0::double precision,ARRAY[n]);t.left_child:=array_fill(0::smallint,ARRAY[n]);t.right_child:=array_fill(0::smallint,ARRAY[n]);t.leaf_value:=array_fill(0::double precision,ARRAY[n]);
   FOR i IN 0..n-1 LOOP node:=tree->i;
    IF node?'value_f64' THEN t.leaf_value[i+1]:=public.fn_gto_v31_public215_f64(node->>'value_f64');
    ELSE t.feature[i+1]:=(node->>'feature')::smallint;t.threshold[i+1]:=public.fn_gto_v31_public215_f64(node->>'threshold_f64');t.left_child[i+1]:=(node->>'left')::smallint;t.right_child[i+1]:=(node->>'right')::smallint;END IF;
   END LOOP;h.trees:=array_append(h.trees,t);
  END LOOP;result:=array_append(result,h);
 END LOOP;RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_compiled_raw(p_heads gto_v31_public215_head[], p_x double precision[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE h public.gto_v31_public215_head;t public.gto_v31_public215_tree;i integer;v double precision;out double precision[]:=ARRAY[]::double precision[];
BEGIN
 IF cardinality(p_x)<>215 OR array_ndims(p_x)<>1 OR array_lower(p_x,1)<>1 OR EXISTS(SELECT 1 FROM unnest(p_x)x WHERE x IS NULL OR x::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'public215 finite215 vector';END IF;
 FOREACH h IN ARRAY p_heads LOOP
  v:=0::double precision;v:=v+h.baseline;
  FOREACH t IN ARRAY h.trees LOOP
   i:=1;WHILE t.feature[i]<>-1 LOOP IF p_x[t.feature[i]+1]<=t.threshold[i] THEN i:=t.left_child[i]+1;ELSE i:=t.right_child[i]+1;END IF;END LOOP;v:=v+t.leaf_value[i];
  END LOOP;
  IF v::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'public215 raw prediction overflow';END IF;out:=array_append(out,v);
 END LOOP;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_compiled_raw_v2(p_heads gto_v31_public215_head[], p_x double precision[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE h public.gto_v31_public215_head;t public.gto_v31_public215_tree;i integer;v double precision;out double precision[]:=ARRAY[]::double precision[];
BEGIN
 IF cardinality(p_x)<>246 OR array_ndims(p_x)<>1 OR array_lower(p_x,1)<>1 OR EXISTS(SELECT 1 FROM unnest(p_x)x WHERE x IS NULL OR x::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'public215 finite246 vector';END IF;
 FOREACH h IN ARRAY p_heads LOOP
  v:=0::double precision;v:=v+h.baseline;
  FOREACH t IN ARRAY h.trees LOOP
   i:=1;WHILE t.feature[i]<>-1 LOOP IF p_x[t.feature[i]+1]<=t.threshold[i] THEN i:=t.left_child[i]+1;ELSE i:=t.right_child[i]+1;END IF;END LOOP;v:=v+t.leaf_value[i];
  END LOOP;
  IF v::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'public215 raw prediction overflow';END IF;out:=array_append(out,v);
 END LOOP;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_context(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_object_agg(k,p->k)FROM unnest(ARRAY['street','game_family','objective','utility_context','table_size','pot_type','hero_position','opponent_position','depth_bucket','texture_class','node_role','facing_kind','facing_size_bucket'])k
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_dataset_models_valid(p_dataset gto_v31_datasets)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE n integer;authority integer;physics text;
BEGIN
 IF p_dataset.policy_representation IS DISTINCT FROM 'public_hist215_v1' THEN RETURN true;END IF;
 physics:=public.fn_gto_v31_public215_digest(jsonb_build_object('physics',public.fn_gto_v31_public215_physics_implementation(),'encoding',public.fn_gto_v31_public215_encoding_for(p_dataset.feature_contract_version)));
 SELECT count(*),count(DISTINCT jsonb_build_object('variant',public_model->'variant','capture',public_training_provenance->'capture_receipt_checksum','recipe',public_training_provenance->'training_recipe_checksum','partition',public_training_provenance->'source_partition_checksum','protocol',public_training_provenance->'runtime_parity_protocol_checksum','encoder',public_training_provenance->'encoder_checksum','physics',public_training_provenance->'physics_checksum','lock',public_training_provenance->'dependency_lock_checksum','parameters',public_training_provenance->'parameters'))INTO n,authority FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset.dataset_id;
 IF public.fn_gto_v31_public215_selected_complete(p_dataset)IS NOT TRUE OR EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset.dataset_id AND public.fn_gto_v31_public215_frozen_model_valid(c,p_dataset)IS NOT TRUE)THEN RETURN false;END IF;
 IF n<>jsonb_array_length(p_dataset.declared_coverage) OR authority<>1 OR EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset.dataset_id AND(c.policy_representation IS DISTINCT FROM p_dataset.policy_representation OR c.sql_physics_checksum IS DISTINCT FROM physics OR public.fn_gto_v31_cell_payload_valid(to_jsonb(c)) IS NOT TRUE))THEN RETURN false;END IF;RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_dense_wtl(p_board integer[], p_weights numeric[])
 RETURNS TABLE(combo integer, current_w numeric, current_t numeric, current_z numeric, terminal_w numeric, terminal_t numeric, terminal_z numeric)
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
 WITH combos AS MATERIALIZED (
  SELECT (b*(b-1)/2+a)::integer i,a,b,p_weights[b*(b-1)/2+a+1]::bigint w
  FROM generate_series(1,51)b CROSS JOIN LATERAL generate_series(0,b-1)a
  WHERE NOT a=ANY(p_board) AND NOT b=ANY(p_board)
 ), runs AS MATERIALIZED (
  SELECT -1 id,p_board board,-1 x,-1 y
  UNION ALL SELECT 0,p_board,-1,-1 WHERE cardinality(p_board)=5
  UNION ALL SELECT a,p_board||a,a,-1 FROM generate_series(0,51)a WHERE cardinality(p_board)=4 AND NOT a=ANY(p_board)
  UNION ALL SELECT a*52+b,p_board||ARRAY[a,b],a,b FROM generate_series(0,51)a CROSS JOIN LATERAL generate_series(a+1,51)b WHERE cardinality(p_board)=3 AND NOT a=ANY(p_board) AND NOT b=ANY(p_board)
 ), scores AS MATERIALIZED (
  SELECT r.id,c.i,c.a,c.b,c.w,public.fn_gto_v31_public215_rank(r.board||ARRAY[c.a,c.b]) score
  FROM runs r JOIN combos c ON c.a<>r.x AND c.a<>r.y AND c.b<>r.x AND c.b<>r.y
 ), global_groups AS MATERIALIZED (
  SELECT id,score,sum(w) w FROM scores GROUP BY id,score
 ), global_cdf AS MATERIALIZED (
  SELECT id,score,coalesce(sum(w) OVER(PARTITION BY id ORDER BY score ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) wins,w ties,sum(w) OVER(PARTITION BY id) z FROM global_groups
 ), per_groups AS MATERIALIZED (
  SELECT id,card,score,sum(w)w FROM scores CROSS JOIN LATERAL unnest(ARRAY[a,b])card GROUP BY id,card,score
 ), per_cdf AS MATERIALIZED (
  SELECT id,card,score,coalesce(sum(w) OVER(PARTITION BY id,card ORDER BY score ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)wins,w ties,sum(w) OVER(PARTITION BY id,card) z FROM per_groups
 ), each AS MATERIALIZED (
  SELECT s.id,s.i,g.wins-a.wins-b.wins wins,g.ties-a.ties-b.ties+s.w ties,g.z-a.z-b.z+s.w z
  FROM scores s JOIN global_cdf g ON g.id=s.id AND g.score=s.score
  JOIN per_cdf a ON a.id=s.id AND a.card=s.a AND a.score=s.score
  JOIN per_cdf b ON b.id=s.id AND b.card=s.b AND b.score=s.score
 )
 SELECT i,max(wins)FILTER(WHERE id=-1),max(ties)FILTER(WHERE id=-1),max(z)FILTER(WHERE id=-1),sum(wins)FILTER(WHERE id<>-1),sum(ties)FILTER(WHERE id<>-1),sum(z)FILTER(WHERE id<>-1)
 FROM each GROUP BY i ORDER BY i;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_digest(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'extensions'
AS $function$ SELECT encode(digest(convert_to(public.fn_gto_v31_public215_canonical(p),'UTF8'),'sha256'),'hex') $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_encoding_for(p_version text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT CASE WHEN p_version='holdem-public-hist215-v2' THEN public.fn_gto_v31_public215_encoding_implementation_v2() ELSE public.fn_gto_v31_public215_encoding_implementation() END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_encoding_implementation()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
 SELECT encode(digest(convert_to(string_agg(pg_get_functiondef(oid),E'\n'ORDER BY oid::regprocedure::text),'UTF8'),'sha256'),'hex')FROM pg_proc WHERE oid IN('public.fn_gto_v31_public215_f64(text)'::regprocedure,'public.fn_gto_v31_public215_ratio(numeric,numeric)'::regprocedure,'public.fn_gto_v31_public215_graph(integer[],integer[])'::regprocedure,'public.fn_gto_v31_public215_base181(integer,text,jsonb)'::regprocedure,'public.fn_gto_v31_public215_features(integer,text,jsonb,numeric[])'::regprocedure,'public.fn_gto_v31_public215_compile(jsonb)'::regprocedure,'public.fn_gto_v31_public215_compiled_raw(public.gto_v31_public215_head[],double precision[])'::regprocedure,'public.fn_gto_v31_public215_action_sum(double precision[])'::regprocedure,'public.fn_gto_v31_public215_normalize(text,integer,double precision[])'::regprocedure,'public.fn_gto_v31_public215_prepare_audit(public.gto_v31_runtime_cells,text[])'::regprocedure,'public.fn_gto_v31_public215_audit_prediction(public.gto_v31_runtime_cells,text,integer)'::regprocedure,'public.fn_gto_v31_public215_required_audit(public.gto_v31_runtime_cells,text)'::regprocedure,'public.fn_gto_v31_board_relative_key_v2(integer,text)'::regprocedure)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_encoding_implementation_v2()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
 SELECT encode(digest(convert_to(string_agg(pg_get_functiondef(oid),E'\n'ORDER BY oid::regprocedure::text),'UTF8'),'sha256'),'hex')FROM pg_proc WHERE oid IN('public.fn_gto_v31_public215_f64(text)'::regprocedure,'public.fn_gto_v31_public215_ratio(numeric,numeric)'::regprocedure,'public.fn_gto_v31_public215_graph(integer[],integer[])'::regprocedure,'public.fn_gto_v31_public215_base181(integer,text,jsonb)'::regprocedure,'public.fn_gto_v31_public215_features(integer,text,jsonb,numeric[])'::regprocedure,'public.fn_gto_v31_public215_compile(jsonb)'::regprocedure,'public.fn_gto_v31_public215_compiled_raw(public.gto_v31_public215_head[],double precision[])'::regprocedure,'public.fn_gto_v31_public215_action_sum(double precision[])'::regprocedure,'public.fn_gto_v31_public215_normalize(text,integer,double precision[])'::regprocedure,'public.fn_gto_v31_public215_prepare_audit(public.gto_v31_runtime_cells,text[])'::regprocedure,'public.fn_gto_v31_public215_audit_prediction(public.gto_v31_runtime_cells,text,integer)'::regprocedure,'public.fn_gto_v31_public215_required_audit(public.gto_v31_runtime_cells,text)'::regprocedure,'public.fn_gto_v31_board_relative_key_v2(integer,text)'::regprocedure,'public.fn_gto_v31_public215_v2_appended(jsonb)'::regprocedure,'public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[])'::regprocedure,'public.fn_gto_v31_public215_compiled_raw_v2(public.gto_v31_public215_head[],double precision[])'::regprocedure,'public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text)'::regprocedure,'public.fn_gto_v31_public215_prepare_audit_v2(public.gto_v31_runtime_cells,text[])'::regprocedure,'public.fn_gto_v31_public215_audit_prediction_v2(public.gto_v31_runtime_cells,text,integer)'::regprocedure,'public.fn_gto_v31_public215_required_audit_v2(public.gto_v31_runtime_cells,text)'::regprocedure)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_f64(p_hex text)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE b bytea;e integer;m bigint;v double precision;i integer;
BEGIN
 IF p_hex!~'^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'public215 f64 word';END IF;
 b:=decode(p_hex,'hex');e:=((get_byte(b,0)&127)<<4)|(get_byte(b,1)>>4);
 IF e=2047 THEN RAISE EXCEPTION 'public215 nonfinite f64';END IF;
 m:=get_byte(b,1)&15;FOR i IN 2..7 LOOP m:=m*256+get_byte(b,i);END LOOP;
 IF e=0 THEN v:=(m::double precision/4503599627370496::double precision)*power(2::double precision,-1022::double precision);
 ELSE v:=(1::double precision+m::double precision/4503599627370496::double precision)*power(2::double precision,(e-1023)::double precision);END IF;
 IF get_byte(b,0)>=128 THEN v:=-v;END IF;
 IF encode(float8send(v),'hex')<>p_hex THEN RAISE EXCEPTION 'public215 f64 decode identity';END IF;
 RETURN v;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_feature_contract_of_schema(p_schema text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE p_schema WHEN '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f' THEN 'holdem-public-hist215-v1' WHEN 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4' THEN 'holdem-public-hist215-v2' END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_feature_schema(p_version text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE p_version WHEN 'holdem-public-hist215-v1' THEN '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f' WHEN 'holdem-public-hist215-v2' THEN 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4' END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_features(p_combo integer, p_board text, p_template jsonb, p_mass numeric[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE out double precision[];board integer[]:=ARRAY[]::integer[];own integer[];hi integer;lo integer;i integer;
BEGIN
 IF cardinality(p_mass)<>8 OR p_mass[4]<=0 OR p_mass[8]<=0 OR p_mass[1]+p_mass[2]+p_mass[3]<>p_mass[4] OR p_mass[5]+p_mass[6]+p_mass[7]<>p_mass[8] THEN RAISE EXCEPTION 'independent exact WTL masses required';END IF;
 out:=public.fn_gto_v31_public215_base181(p_combo,p_board,p_template);
 FOR i IN 1..3 LOOP out:=array_append(out,public.fn_gto_v31_public215_ratio(p_mass[i],p_mass[4]));END LOOP;FOR i IN 5..7 LOOP out:=array_append(out,public.fn_gto_v31_public215_ratio(p_mass[i],p_mass[8]));END LOOP;
 hi:=floor((1+sqrt(1+8*p_combo))/2)::integer;WHILE hi*(hi-1)/2>p_combo LOOP hi:=hi-1;END LOOP;WHILE (hi+1)*hi/2<=p_combo LOOP hi:=hi+1;END LOOP;lo:=p_combo-hi*(hi-1)/2;own:=ARRAY[lo,hi];
 FOR i IN 0..length(p_board)/2-1 LOOP board:=array_append(board,(strpos('23456789TJQKA',substr(p_board,2*i+1,1))-1)*4+strpos('cdhs',substr(p_board,2*i+2,1))-1);END LOOP;
 out:=out||public.fn_gto_v31_public215_graph(own,board);IF cardinality(out)<>215 THEN RAISE EXCEPTION 'public215 full feature shape';END IF;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_features_v2(p_combo integer, p_board text, p_template jsonb, p_mass numeric[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE out double precision[];
BEGIN
 -- v1's 215 features unchanged in place (the frozen v1 encoder), then the v2 block.
 out:=public.fn_gto_v31_public215_features(p_combo,p_board,p_template,p_mass)||public.fn_gto_v31_public215_v2_appended(p_template);
 IF cardinality(out)<>246 THEN RAISE EXCEPTION 'public215 v2 full feature shape';END IF;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_frozen_map(d gto_v31_datasets)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE b public.gto_v31_input_bundles;result jsonb;capture text;count_prepared integer;count_frozen integer;authorities integer;current_source text;
BEGIN
 SELECT * INTO STRICT b FROM public.gto_v31_input_bundles WHERE input_bundle_id=d.input_bundle_id AND approval_status='approved'AND bundle_checksum=d.input_bundle_checksum;
 IF public.fn_gto_v31_public215_source_headers_valid(d)IS NOT TRUE THEN RAISE EXCEPTION 'canonical source header authority changed';END IF;
 current_source:=public.fn_gto_v31_public215_digest(jsonb_build_object('physics',public.fn_gto_v31_public215_physics_implementation(),'encoding',public.fn_gto_v31_public215_encoding_for(d.feature_contract_version)));
 SELECT p.identity->>'capture_receipt_checksum'INTO STRICT capture FROM public.gto_v31_model_preparations p WHERE p.dataset_id=d.dataset_id ORDER BY p.cell_key_checksum LIMIT 1;
 SELECT count(*),count(f.cell_key_checksum),count(DISTINCT jsonb_build_object('variant',p.identity->'variant','capture',p.identity->'capture_receipt_checksum','recipe',p.identity->'training_recipe_checksum','partition',p.identity->'source_partition_checksum','encoder',p.identity->'encoder_checksum','physics',p.identity->'physics_checksum','dependency',p.identity->'dependency_lock_checksum','protocol',p.identity->'runtime_parity_protocol_checksum'))INTO count_prepared,count_frozen,authorities FROM public.gto_v31_model_preparations p LEFT JOIN public.gto_v31_model_freezes f ON f.dataset_id=p.dataset_id AND f.cell_key_checksum=p.cell_key_checksum WHERE p.dataset_id=d.dataset_id;
 IF count_prepared<>jsonb_array_length(d.declared_coverage)OR count_frozen<>count_prepared OR authorities<>1 OR EXISTS(SELECT 1 FROM public.gto_v31_model_preparations p WHERE p.dataset_id=d.dataset_id AND(p.identity->>'capture_receipt_checksum'IS DISTINCT FROM capture OR p.sql_physics_checksum IS DISTINCT FROM current_source OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.declared_coverage)c WHERE c=p.context)))THEN RAISE EXCEPTION 'all genuine M1 numeric programs and independent bounded Linux receipts must be frozen before blind opening';END IF;
 SELECT jsonb_agg(jsonb_build_object('context',p.context,'model_checksum',p.identity->>'model_checksum','model_build_receipt_checksum',f.model_build_receipt_checksum,'template_checksum',p.identity->>'template_checksum','training_provenance_checksum',p.identity->>'training_provenance_checksum')ORDER BY public.fn_gto_v31_public215_canonical(p.context)COLLATE "C")INTO result FROM public.gto_v31_model_preparations p JOIN public.gto_v31_model_freezes f ON f.dataset_id=p.dataset_id AND f.cell_key_checksum=p.cell_key_checksum WHERE p.dataset_id=d.dataset_id;RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_frozen_model_valid(c gto_v31_runtime_cells, d gto_v31_datasets)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE s public.gto_v31_public_selections;model jsonb;key text;
BEGIN
 SELECT * INTO STRICT s FROM public.gto_v31_public_selections WHERE dataset_id=d.dataset_id AND input_bundle_checksum=d.input_bundle_checksum;
 SELECT value INTO STRICT model FROM jsonb_array_elements(s.frozen_models)WHERE value->'context'=c.public_template->'context';
 IF model->>'model_checksum' IS DISTINCT FROM c.model_checksum OR model->>'model_build_receipt_checksum' IS DISTINCT FROM c.model_build_receipt_checksum OR model->>'template_checksum' IS DISTINCT FROM c.template_checksum OR model->>'training_provenance_checksum' IS DISTINCT FROM c.training_provenance_checksum THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['capture_receipt_checksum','training_recipe_checksum','source_partition_checksum','runtime_parity_protocol_checksum','encoder_checksum','physics_checksum','dependency_lock_checksum','feature_schema_checksum']LOOP IF c.public_training_provenance->key IS DISTINCT FROM s.receipt->key THEN RETURN false;END IF;END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_graph(p_own integer[], p_board integer[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE h integer[];f integer[];slots integer[];v integer[];best integer[];i integer;j integer;a integer;b integer;c integer;hi integer;
BEGIN
 IF cardinality(p_own)<>2 OR cardinality(p_board) NOT IN(3,4,5) OR EXISTS(SELECT 1 FROM unnest(p_own||p_board)x WHERE x IS NULL OR x NOT BETWEEN 0 AND 51) OR (SELECT count(DISTINCT x) FROM unnest(p_own||p_board)x)<>cardinality(p_board)+2 THEN RAISE EXCEPTION 'public215 graph shape';END IF;
 FOR hi IN 0..1 LOOP
  h:=CASE WHEN hi=0 THEN p_own ELSE ARRAY[p_own[2],p_own[1]] END;
  IF h[1]/4<h[2]/4 THEN CONTINUE;END IF;
  FOR a IN 1..3 LOOP FOR b IN 1..3 LOOP FOR c IN 1..3 LOOP
   IF a=b OR a=c OR b=c THEN CONTINUE;END IF;f:=ARRAY[p_board[a],p_board[b],p_board[c]];
   IF f[1]/4<f[2]/4 OR f[2]/4<f[3]/4 THEN CONTINUE;END IF;
   slots:=h||f||ARRAY[COALESCE(p_board[4],-1),COALESCE(p_board[5],-1)];v:=ARRAY[]::integer[];
   FOR i IN 1..7 LOOP v:=array_append(v,CASE WHEN slots[i]<0 THEN 0 ELSE slots[i]/4+2 END);END LOOP;
   FOR i IN 1..7 LOOP FOR j IN i+1..7 LOOP v:=array_append(v,CASE WHEN slots[i]>=0 AND slots[j]>=0 AND slots[i]%4=slots[j]%4 THEN 1 ELSE 0 END);END LOOP;END LOOP;
   IF best IS NULL OR v<best THEN best:=v;END IF;
  END LOOP;END LOOP;END LOOP;
 END LOOP;
 RETURN best::double precision[];
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_heldout_metrics(p_dataset_id uuid, p_game_family text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH scored_nodes AS MATERIALIZED (
    SELECT r.dataset_id,r.cell_id,r.source_row_id,r.source_node,r.split,
           public.fn_gto_v31_assert_source_contract(n.value,
           (SELECT d.policy_export_schema FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id),
           (SELECT d.icm_model_checksum FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id)) AS node
      FROM public.gto_v31_cell_source_receipts r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      JOIN public.solved_spots_gold s ON s.id=r.source_row_id
      CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND (p_game_family IS NULL OR c.game_family=p_game_family)
       AND n.value->>'node'=r.source_node
       AND n.value->>'node_checksum'=r.source_node_checksum
  ), public_states AS MATERIALIZED (
    SELECT r.*,c.public_model->'action_ids'AS public_actions,
           public.fn_gto_v31_public215_required_audit_for(c,r.node#>>'{node_context,board}')AS audit_key
      FROM scored_nodes r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
  ), holdout AS MATERIALIZED (
    SELECT r.source_row_id,r.source_node,c.cell_id,c.game_family,
           c.action_specs,i,k.hand_key,
           (SELECT jsonb_object_agg(a.action,ap.frequencies[a.ord::integer]ORDER BY a.ord)FROM jsonb_array_elements_text(r.public_actions)WITH ORDINALITY a(action,ord))AS compact_frequencies,
           ap.policy_ev::numeric AS compact_policy,
           (n.value->'policy_evs_bb'->>i)::numeric AS source_policy,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'frequencies') a) AS source_frequencies,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'action_evs_bb') a) AS source_action_evs,
           (n.value->'matchups'->>i)::numeric AS weight
      FROM public_states r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      CROSS JOIN LATERAL (SELECT r.node AS value) n
      CROSS JOIN generate_series(0,1325) i
      CROSS JOIN LATERAL (SELECT i::text AS hand_key OFFSET 0) k
      LEFT JOIN public.gto_v31_public_model_audit_combos ap ON ap.audit_key=r.audit_key AND ap.combo=i
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND (p_game_family IS NULL OR c.game_family=p_game_family)
       AND n.value->>'node'=r.source_node
       AND (n.value->'matchups'->>i)::numeric>0
  ), action_observations AS MATERIALIZED (
    SELECT h.*,a.key AS action_id,a.value->>'family' AS action_family,
           CASE WHEN a.value->>'family' IN ('bet','raise')
                THEN (a.value->>'size_value')::numeric ELSE NULL END AS size_value,
           (h.source_frequencies->>a.key)::numeric AS source_frequency,
           (h.compact_frequencies->>a.key)::numeric AS compact_frequency,
           (h.source_action_evs->>a.key)::numeric AS source_action_ev
      FROM holdout h CROSS JOIN LATERAL jsonb_each(h.action_specs) a
  ), per_combo AS MATERIALIZED (
    SELECT source_row_id,source_node,cell_id,game_family,i,hand_key,weight,
           max(source_policy) AS source_policy_ev,
           max(compact_policy) AS compact_policy_ev,
           sum(source_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS source_size,
           sum(compact_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS compact_size,
           bool_or(size_value IS NOT NULL) AS sizing_eligible,
           max(source_action_ev) AS best_action_ev,
           sum(compact_frequency*source_action_ev) AS compact_mixed_ev,
           bool_and(compact_frequency IS NOT NULL AND source_action_ev IS NOT NULL)
             AS regret_eligible
      FROM action_observations
     GROUP BY source_row_id,source_node,cell_id,game_family,i,hand_key,weight
  )
  SELECT jsonb_build_object(
    'frequency_mae',(SELECT sum(abs(source_frequency-compact_frequency)*weight)/NULLIF(sum(weight),0)
      FROM action_observations),
    'sizing_mae',COALESCE((SELECT sum(abs(source_size-compact_size)*weight)/NULLIF(sum(weight),0)
      FROM per_combo WHERE sizing_eligible),0),
    'policy_ev_mae_bb',(SELECT sum(abs(source_policy_ev-compact_policy_ev)*weight)/NULLIF(sum(weight),0)
      FROM per_combo),
    'mean_action_regret_bb',(SELECT sum(greatest(0,best_action_ev-compact_mixed_ev)*weight)/NULLIF(sum(weight),0)
      FROM per_combo WHERE regret_eligible),
    'regret_coverage',(SELECT count(*)::numeric/NULLIF((SELECT count(*) FROM per_combo),0)
      FROM per_combo WHERE regret_eligible),
    'holdout_source_rows',(SELECT count(DISTINCT source_row_id) FROM holdout),
    'frequency_observations',(SELECT count(*) FROM action_observations),
    'sizing_observations',(SELECT count(*) FROM per_combo WHERE sizing_eligible),
    'policy_ev_observations',(SELECT count(*) FROM per_combo),
    'regret_observations',(SELECT count(*) FROM per_combo WHERE regret_eligible),
    'live_combo_observations',(SELECT count(*) FROM per_combo),
    'missing_observations',(SELECT count(*) FROM holdout WHERE compact_frequencies IS NULL OR compact_policy IS NULL)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_immutable_physics()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$ BEGIN RAISE EXCEPTION 'derived public physics rows are immutable';END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_keys(p jsonb, keys text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
 SELECT COALESCE(jsonb_typeof(p)='object' AND (SELECT count(*) FROM jsonb_object_keys(p))=cardinality(keys) AND p?&keys,false)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_lock_seal_inputs(p_dataset_id uuid, p_cell_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE bundle uuid;
BEGIN
 SELECT input_bundle_id INTO STRICT bundle FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND state='building'AND policy_representation='public_hist215_v1'FOR UPDATE;
 PERFORM b.input_bundle_id FROM public.gto_v31_input_bundles b WHERE b.input_bundle_id=bundle ORDER BY b.input_bundle_id FOR SHARE;
 PERFORM c.cell_id FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key)ORDER BY c.cell_key_checksum COLLATE "C"FOR SHARE;
 PERFORM p.cell_key_checksum FROM public.gto_v31_model_preparations p WHERE p.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR p.cell_key_checksum=p_cell_key)ORDER BY p.cell_key_checksum COLLATE "C"FOR SHARE;
 PERFORM f.cell_key_checksum FROM public.gto_v31_model_freezes f WHERE f.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR f.cell_key_checksum=p_cell_key)ORDER BY f.cell_key_checksum COLLATE "C"FOR SHARE;
 PERFORM s.dataset_id FROM public.gto_v31_public_selections s WHERE s.dataset_id=p_dataset_id FOR SHARE;
 PERFORM r.cell_id FROM public.gto_v31_cell_source_receipts r WHERE r.dataset_id=p_dataset_id AND r.cell_id IN(SELECT c.cell_id FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ORDER BY r.cell_id,r.source_row_id,r.source_node COLLATE "C"FOR SHARE;
 PERFORM a.source_row_id FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=p_dataset_id AND a.source_row_id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ORDER BY a.source_row_id FOR SHARE;
 PERFORM j.source_row_id FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR j.context=(SELECT c.public_template->'context'FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.cell_key_checksum=p_cell_key))ORDER BY j.source_row_id,j.source_node COLLATE "C"FOR SHARE;
 PERFORM g.id FROM public.solved_spots_gold g WHERE g.id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ORDER BY g.id FOR SHARE;
 PERFORM a.audit_key FROM public.gto_v31_public_model_audits a WHERE EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c JOIN public.gto_v31_public_source_journal j ON j.dataset_id=c.dataset_id AND j.context=c.public_template->'context'AND j.machine_id='M2'WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key)AND a.model_checksum=c.model_checksum AND a.template_checksum=c.template_checksum AND a.chronological_board=ARRAY(SELECT substring(j.board FROM n FOR 2)FROM generate_series(1,length(j.board),2)n ORDER BY n))ORDER BY a.audit_key COLLATE "C"FOR SHARE;
 -- Seed only IDs that are already SHARE-locked. Concurrent UPSERT writers
 -- either wait on their gold/bundle row or serialize on this metadata PK.
 INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id)
 SELECT 'gold',g.id::text FROM public.solved_spots_gold g WHERE g.id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key))ON CONFLICT DO NOTHING;
 INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id)VALUES('bundle',bundle::text)ON CONFLICT DO NOTHING;
 PERFORM v.input_id FROM public.gto_v31_seal_input_revisions v WHERE v.input_kind='epoch'OR(v.input_kind='bundle'AND v.input_id=bundle::text)OR(v.input_kind='gold'AND v.input_id IN(SELECT r.source_row_id::text FROM public.gto_v31_cell_source_receipts r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id WHERE c.dataset_id=p_dataset_id AND(p_cell_key IS NULL OR c.cell_key_checksum=p_cell_key)))ORDER BY v.input_kind,v.input_id COLLATE "C"FOR SHARE;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_metrics_from_raw(p_raw_receipts jsonb, p_game_family text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_raw jsonb;v_value jsonb;v_key text;v_dataset text;v_cell_ids text[]:=ARRAY[]::text[];v_source_id text;
 sum_keys constant text[]:=ARRAY['frequency_numerator','frequency_denominator','sizing_numerator','sizing_denominator','policy_numerator','policy_denominator','regret_numerator','regret_denominator'];
 count_keys constant text[]:=ARRAY['frequency','sizing','policy','regret','live','missing'];
BEGIN
 IF jsonb_typeof(p_raw_receipts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'raw metric receipt array required'; END IF;
 FOR v_raw IN SELECT v FROM jsonb_array_elements(p_raw_receipts) v LOOP
  IF jsonb_typeof(v_raw) IS DISTINCT FROM 'object'
   OR v_raw-ARRAY['format','dataset_id','cell_id','game_family','sums','counts','holdout_source_ids']<>'{}'::jsonb
   OR NOT v_raw?&ARRAY['format','dataset_id','cell_id','game_family','sums','counts','holdout_source_ids']
   OR v_raw->'format' IS DISTINCT FROM '"public215_cell_metric_raw_v1"'::jsonb
   OR jsonb_typeof(v_raw->'dataset_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_raw->'cell_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_raw->'game_family') IS DISTINCT FROM 'string'
   OR jsonb_typeof(v_raw->'sums') IS DISTINCT FROM 'object'
   OR (v_raw->'sums')-sum_keys<>'{}'::jsonb OR NOT (v_raw->'sums')?&sum_keys
   OR jsonb_typeof(v_raw->'counts') IS DISTINCT FROM 'object'
   OR (v_raw->'counts')-count_keys<>'{}'::jsonb OR NOT (v_raw->'counts')?&count_keys
   OR jsonb_typeof(v_raw->'holdout_source_ids') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'raw metric receipt shape differs'; END IF;
  IF ((v_raw->>'dataset_id')::uuid)::text IS DISTINCT FROM v_raw->>'dataset_id'
   OR ((v_raw->>'cell_id')::uuid)::text IS DISTINCT FROM v_raw->>'cell_id'
   OR (v_dataset IS NOT NULL AND v_dataset IS DISTINCT FROM v_raw->>'dataset_id')
   OR (v_raw->>'cell_id')=ANY(v_cell_ids)
  THEN RAISE EXCEPTION 'raw metric receipt identity differs or repeats'; END IF;
  v_dataset:=v_raw->>'dataset_id';v_cell_ids:=array_append(v_cell_ids,v_raw->>'cell_id');
  FOREACH v_key IN ARRAY sum_keys LOOP
   v_value:=v_raw->'sums'->v_key;
   IF v_value IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR (v_value#>>'{}')!~'^-?[0-9]+(\.[0-9]+)?$')
   THEN RAISE EXCEPTION 'raw metric sum must be exact NUMERIC text or null'; END IF;
  END LOOP;
  FOREACH v_key IN ARRAY count_keys LOOP
   v_value:=v_raw->'counts'->v_key;
   IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' OR (v_value#>>'{}')!~'^(0|[1-9][0-9]*)$'
   THEN RAISE EXCEPTION 'raw metric count must be exact nonnegative integer text'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_raw->'holdout_source_ids') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
   OR (SELECT count(*) FROM jsonb_array_elements(v_raw->'holdout_source_ids'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(v_raw->'holdout_source_ids') x)
  THEN RAISE EXCEPTION 'raw metric source identity set differs'; END IF;
  FOR v_source_id IN SELECT x FROM jsonb_array_elements_text(v_raw->'holdout_source_ids') x LOOP
   IF v_source_id::uuid::text IS DISTINCT FROM v_source_id THEN RAISE EXCEPTION 'raw metric source identity is not canonical'; END IF;
  END LOOP;
 END LOOP;
 RETURN (
  WITH selected AS MATERIALIZED (
   SELECT e.value r FROM jsonb_array_elements(p_raw_receipts) e
    WHERE p_game_family IS NULL OR e.value->>'game_family'=p_game_family
  ), totals AS (
   SELECT sum((r#>>'{sums,frequency_numerator}')::numeric) fn,
          sum((r#>>'{sums,frequency_denominator}')::numeric) fd,
          sum((r#>>'{sums,sizing_numerator}')::numeric) sn,
          sum((r#>>'{sums,sizing_denominator}')::numeric) sd,
          sum((r#>>'{sums,policy_numerator}')::numeric) pn,
          sum((r#>>'{sums,policy_denominator}')::numeric) pd,
          sum((r#>>'{sums,regret_numerator}')::numeric) rn,
          sum((r#>>'{sums,regret_denominator}')::numeric) rd,
          COALESCE(sum((r#>>'{counts,frequency}')::numeric),0) frequency_count,
          COALESCE(sum((r#>>'{counts,sizing}')::numeric),0) sizing_count,
          COALESCE(sum((r#>>'{counts,policy}')::numeric),0) policy_count,
          COALESCE(sum((r#>>'{counts,regret}')::numeric),0) regret_count,
          COALESCE(sum((r#>>'{counts,live}')::numeric),0) live_count,
          COALESCE(sum((r#>>'{counts,missing}')::numeric),0) missing_count
    FROM selected
  )
  SELECT jsonb_build_object(
   'frequency_mae',fn/NULLIF(fd,0),
   'sizing_mae',COALESCE(sn/NULLIF(sd,0),0),
   'policy_ev_mae_bb',pn/NULLIF(pd,0),
   'mean_action_regret_bb',rn/NULLIF(rd,0),
   'regret_coverage',regret_count/NULLIF(policy_count,0),
   'holdout_source_rows',(SELECT count(DISTINCT ids.source_id) FROM selected CROSS JOIN LATERAL jsonb_array_elements_text(r->'holdout_source_ids') ids(source_id)),
   'frequency_observations',frequency_count,
   'sizing_observations',sizing_count,
   'policy_ev_observations',policy_count,
   'regret_observations',regret_count,
   'live_combo_observations',live_count,
   'missing_observations',missing_count
  ) FROM totals
 );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_model_canonical_fast(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
WITH root AS MATERIALIZED(
 SELECT p WHERE CASE WHEN jsonb_typeof(p)='object' THEN
 p-ARRAY['format','variant','feature_count','action_ids','heads','template_sha256','feature_schema_sha256','provenance_sha256']='{}'::jsonb
 AND p?&ARRAY['format','variant','feature_count','action_ids','heads','template_sha256','feature_schema_sha256','provenance_sha256']
 AND p->>'format'='public_hist215_v1' AND jsonb_typeof(p->'format')='string'
 AND jsonb_typeof(p->'heads')='array' AND jsonb_typeof(p->'action_ids')='array'
 AND CASE WHEN jsonb_typeof(p->'feature_count')='number' THEN
  (p->'feature_count')::text~'^-?(0|[1-9][0-9]*)$' AND abs((p->>'feature_count')::numeric)<=9007199254740991 ELSE false END
 AND (SELECT bool_and(jsonb_typeof(p->k)='string' AND p->>k~'^[ -~]*$')
 FROM unnest(ARRAY['variant','template_sha256','feature_schema_sha256','provenance_sha256'])k)
 ELSE false END
)
SELECT CASE WHEN actions.valid AND heads.valid
 THEN '{"action_ids":['||actions.body||'],"feature_count":'||(r.p->'feature_count')::text||',"feature_schema_sha256":'||(r.p->'feature_schema_sha256')::text||',"format":'||(r.p->'format')::text||',"heads":['||heads.body||'],"provenance_sha256":'||(r.p->'provenance_sha256')::text||',"template_sha256":'||(r.p->'template_sha256')::text||',"variant":'||(r.p->'variant')::text||'}' END
FROM root r
CROSS JOIN LATERAL(
 SELECT COALESCE(string_agg(a.value::text,',' ORDER BY a.ordinality),'') body,
 COALESCE(bool_and(jsonb_typeof(a.value)='string' AND (a.value#>>'{}')~'^[ -~]*$'),true) valid
 FROM jsonb_array_elements(r.p->'action_ids')WITH ORDINALITY a
)actions
CROSS JOIN LATERAL(
 SELECT COALESCE(string_agg('{"baseline_f64":'||(h.value->'baseline_f64')::text||',"trees":['||trees.body||']}',',' ORDER BY h.ordinality),'') body,
 COALESCE(bool_and(CASE WHEN jsonb_typeof(h.value)='object' THEN
 h.value-ARRAY['baseline_f64','trees']='{}'::jsonb AND h.value?&ARRAY['baseline_f64','trees']
 AND jsonb_typeof(h.value->'baseline_f64')='string' AND h.value->>'baseline_f64'~'^[ -~]*$'
 AND jsonb_typeof(h.value->'trees')='array' AND trees.valid ELSE false END),true) valid
 FROM jsonb_array_elements(r.p->'heads')WITH ORDINALITY h
 CROSS JOIN LATERAL(
  SELECT COALESCE(string_agg('['||nodes.body||']',',' ORDER BY t.ordinality),'') body,
  COALESCE(bool_and(jsonb_typeof(t.value)='array' AND nodes.valid),true) valid
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.value->'trees')='array' THEN h.value->'trees' ELSE '[]'::jsonb END)WITH ORDINALITY t
  CROSS JOIN LATERAL(
   SELECT COALESCE(string_agg(render.token,',' ORDER BY n.ordinality),'') body,
   COALESCE(bool_and(render.token IS NOT NULL),true) valid
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.value)='array' THEN t.value ELSE '[]'::jsonb END)WITH ORDINALITY n
   CROSS JOIN LATERAL(SELECT
 CASE WHEN jsonb_typeof(n.value)='object' THEN CASE WHEN n.value?'value_f64' THEN
  CASE WHEN n.value-'value_f64'='{}'::jsonb AND jsonb_typeof(n.value->'value_f64')='string' AND n.value->>'value_f64'~'^[ -~]*$'
   THEN '{"value_f64":'||(n.value->'value_f64')::text||'}' END
 ELSE
  CASE WHEN n.value-ARRAY['feature','threshold_f64','left','right','missing_left']='{}'::jsonb
  AND n.value?&ARRAY['feature','threshold_f64','left','right','missing_left']
  AND jsonb_typeof(n.value->'missing_left')='boolean'
  AND jsonb_typeof(n.value->'threshold_f64')='string' AND n.value->>'threshold_f64'~'^[ -~]*$'
  AND (SELECT bool_and(CASE WHEN jsonb_typeof(n.value->k)='number' THEN
    (n.value->k)::text~'^-?(0|[1-9][0-9]*)$' AND abs((n.value->>k)::numeric)<=9007199254740991 ELSE false END)
    FROM unnest(ARRAY['feature','left','right'])k)
  THEN '{"feature":'||(n.value->'feature')::text||',"left":'||(n.value->'left')::text||',"missing_left":'||(n.value->'missing_left')::text||',"right":'||(n.value->'right')::text||',"threshold_f64":'||(n.value->'threshold_f64')::text||'}' END
 END END token OFFSET 0)render
  )nodes
 )trees
)heads
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_model_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE acts jsonb;head jsonb;trees jsonb;tree jsonb;node jsonb;ni integer;n integer;leaves integer;visited boolean[];stack integer[];child integer;which text;f double precision;width integer;
BEGIN
 width:=public.fn_gto_v31_public215_model_width(p->>'feature_schema_sha256');
 IF jsonb_typeof(p)<>'object' OR p-ARRAY['format','variant','feature_count','action_ids','heads','template_sha256','feature_schema_sha256','provenance_sha256']<>'{}'::jsonb OR NOT p?&ARRAY['format','variant','feature_count','action_ids','heads','template_sha256','feature_schema_sha256','provenance_sha256'] OR jsonb_typeof(p->'format')<>'string' OR jsonb_typeof(p->'variant')<>'string' OR p->>'format'<>'public_hist215_v1' OR p->>'variant' NOT IN('direct','coherent') OR p->'feature_count'<>to_jsonb(width) THEN RETURN false;END IF;
 IF octet_length(public.fn_gto_v31_public215_canonical(p))>8388608 THEN RETURN false;END IF;
 FOREACH which IN ARRAY ARRAY['template_sha256','feature_schema_sha256','provenance_sha256'] LOOP IF jsonb_typeof(p->which)<>'string' OR p->>which!~'^[0-9a-f]{64}$' THEN RETURN false;END IF;END LOOP;
 acts:=p->'action_ids';IF jsonb_typeof(acts)<>'array' OR jsonb_array_length(acts) NOT BETWEEN 1 AND 16 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(acts))<>jsonb_array_length(acts) OR EXISTS(SELECT 1 FROM jsonb_array_elements(acts)a WHERE jsonb_typeof(a)<>'string' OR a#>>'{}'!~'^[A-Za-z0-9_.:-]{1,96}$' OR a#>>'{}' IN('__proto__','prototype','constructor')) THEN RETURN false;END IF;
 IF jsonb_typeof(p->'heads')<>'array' OR jsonb_array_length(p->'heads')<>1+2*jsonb_array_length(acts) THEN RETURN false;END IF;
 FOR head IN SELECT value FROM jsonb_array_elements(p->'heads') LOOP
  IF jsonb_typeof(head)<>'object' OR head-ARRAY['baseline_f64','trees']<>'{}'::jsonb OR NOT head?&ARRAY['baseline_f64','trees'] THEN RETURN false;END IF;
  IF jsonb_typeof(head->'baseline_f64')<>'string' THEN RETURN false;END IF;f:=public.fn_gto_v31_public215_f64(head->>'baseline_f64');trees:=head->'trees';IF jsonb_typeof(trees)<>'array' OR jsonb_array_length(trees)<>100 THEN RETURN false;END IF;
  FOR tree IN SELECT value FROM jsonb_array_elements(trees) LOOP
   IF jsonb_typeof(tree)<>'array' OR jsonb_array_length(tree) NOT BETWEEN 1 AND 29 THEN RETURN false;END IF;
   n:=jsonb_array_length(tree);leaves:=0;
   FOR ni IN 0..n-1 LOOP
    node:=tree->ni;IF jsonb_typeof(node)<>'object' THEN RETURN false;END IF;
    IF node?'value_f64' THEN
     IF node-'value_f64'<>'{}'::jsonb OR jsonb_typeof(node->'value_f64')<>'string' THEN RETURN false;END IF;f:=public.fn_gto_v31_public215_f64(node->>'value_f64');leaves:=leaves+1;
    ELSE
     IF node-ARRAY['feature','threshold_f64','left','right','missing_left']<>'{}'::jsonb OR NOT node?&ARRAY['feature','threshold_f64','left','right','missing_left'] OR jsonb_typeof(node->'missing_left')<>'boolean' THEN RETURN false;END IF;
     FOREACH which IN ARRAY ARRAY['feature','left','right'] LOOP IF jsonb_typeof(node->which)<>'number' OR node->>which!~'^(0|[1-9][0-9]*)$' THEN RETURN false;END IF;END LOOP;
     IF (node->>'feature')::numeric>=width OR (node->>'left')::numeric>=n OR (node->>'right')::numeric>=n OR node->'left'=node->'right' THEN RETURN false;END IF;IF jsonb_typeof(node->'threshold_f64')<>'string' THEN RETURN false;END IF;f:=public.fn_gto_v31_public215_f64(node->>'threshold_f64');
    END IF;
   END LOOP;
   IF leaves>15 OR n<>2*leaves-1 THEN RETURN false;END IF;
   visited:=array_fill(false,ARRAY[n]);stack:=ARRAY[0];
   WHILE cardinality(stack)>0 LOOP
    ni:=stack[cardinality(stack)];stack:=stack[1:cardinality(stack)-1];IF visited[ni+1] THEN RETURN false;END IF;visited[ni+1]:=true;node:=tree->ni;
    IF NOT node?'value_f64' THEN stack:=stack||ARRAY[(node->>'left')::integer,(node->>'right')::integer];END IF;
   END LOOP;
   IF array_position(visited,false) IS NOT NULL THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_model_width(p_schema text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE WHEN p_schema='c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4' THEN 246 ELSE 215 END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_normalize(p_variant text, p_count integer, p_raw double precision[])
 RETURNS TABLE(policy_ev double precision, action_evs double precision[], frequencies double precision[])
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE i integer;v double precision;total double precision;products double precision[]:=ARRAY[]::double precision[];
BEGIN
 IF p_variant NOT IN('direct','coherent') OR p_count NOT BETWEEN 1 AND 16 OR cardinality(p_raw)<>1+2*p_count OR EXISTS(SELECT 1 FROM unnest(p_raw)x WHERE x IS NULL OR x::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'public215 complete raw heads';END IF;
 action_evs:=p_raw[2:1+p_count];frequencies:=ARRAY[]::double precision[];
 FOR i IN 1..p_count LOOP v:=p_raw[1+p_count+i];IF v<0 THEN v:=0;ELSIF v>1 THEN v:=1;END IF;frequencies:=array_append(frequencies,v);END LOOP;
 total:=public.fn_gto_v31_public215_action_sum(frequencies);IF NOT total>1e-12 THEN RAISE EXCEPTION 'public215 zero normalized frequency mass';END IF;
 FOR i IN 1..p_count LOOP frequencies[i]:=frequencies[i]/total;products:=array_append(products,frequencies[i]*action_evs[i]);END LOOP;
 policy_ev:=CASE WHEN p_variant='direct' THEN p_raw[1] ELSE public.fn_gto_v31_public215_action_sum(products) END;
 IF policy_ev::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'public215 normalized overflow';END IF;RETURN NEXT;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_normalized_weights(p_template jsonb)
 RETURNS numeric[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a numeric[]:=ARRAY[]::numeric[];s numeric:=0;g numeric:=0;x numeric;y numeric;t numeric;v jsonb;i integer;
BEGIN
 IF p_template->>'format'<>'public_hist215_template_v1' OR jsonb_typeof(p_template->'opponent_weights')<>'array' OR jsonb_array_length(p_template->'opponent_weights')<>1326 THEN RAISE EXCEPTION 'exact approved1326 rootweights required';END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_template->'opponent_weights') LOOP
  IF jsonb_typeof(v)<>'string' OR v#>>'{}'!~'^(0|[1-9][0-9]{0,12})$' THEN RAISE EXCEPTION 'canonical rootweight';END IF;x:=(v#>>'{}')::numeric;
  IF x>1000000000000 THEN RAISE EXCEPTION 'authored rootweight precision';END IF;s:=s+x;a:=array_append(a,x);y:=x;WHILE y<>0 LOOP t:=mod(g,y);g:=y;y:=t;END LOOP;
 END LOOP;
 IF s<=0 OR s>9223372036854775807 THEN RAISE EXCEPTION 'positive bounded rootmass';END IF;
 FOR i IN 1..1326 LOOP a[i]:=div(a[i],g);END LOOP;RETURN a;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_physics_implementation()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
 SELECT encode(digest(convert_to(string_agg(pg_get_functiondef(oid),E'\n'ORDER BY oid::regprocedure::text),'UTF8'),'sha256'),'hex')FROM pg_proc WHERE oid IN('public.fn_gto_v31_public215_rank(integer[])'::regprocedure,'public.fn_gto_v31_public215_dense_wtl(integer[],numeric[])'::regprocedure,'public.fn_gto_v31_public215_normalized_weights(jsonb)'::regprocedure,'public.fn_gto_v31_public215_physics_key(jsonb,text[])'::regprocedure,'public.fn_gto_v31_public215_prepare_math(jsonb,text[])'::regprocedure,'public.fn_gto_v31_public215_ratio(numeric,numeric)'::regprocedure)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_physics_key(p_template jsonb, p_board text[])
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE ids integer[];weights numeric[];ws jsonb;
BEGIN
 IF cardinality(p_board) NOT IN(3,4,5) OR EXISTS(SELECT 1 FROM unnest(p_board)c WHERE c IS NULL OR c!~'^[2-9TJQKA][cdhs]$') OR (SELECT count(DISTINCT c)FROM unnest(p_board)c)<>cardinality(p_board) THEN RAISE EXCEPTION 'canonical legal public board';END IF;
 SELECT array_agg((strpos('23456789TJQKA',substr(c,1,1))-1)*4+strpos('cdhs',substr(c,2,1))-1 ORDER BY (strpos('23456789TJQKA',substr(c,1,1))-1)*4+strpos('cdhs',substr(c,2,1))-1) INTO ids FROM unnest(p_board)c;
 weights:=public.fn_gto_v31_public215_normalized_weights(p_template);SELECT jsonb_agg(w::text ORDER BY i) INTO ws FROM unnest(weights)WITH ORDINALITY t(w,i);
 RETURN public.fn_gto_v31_public215_digest(jsonb_build_object('format','public_root_wtl_v1','board_ids',ids,'normalized_root_weights',ws,'implementation_checksum',public.fn_gto_v31_public215_physics_implementation()));
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_prepare_audit(p_cell gto_v31_runtime_cells, p_board text[])
 RETURNS text
 LANGUAGE plpgsql
 STRICT
 SET search_path TO 'public'
AS $function$
DECLARE physics text;k text;heads public.gto_v31_public215_head[];ph public.gto_v31_public_physics%ROWTYPE;r jsonb;mass numeric[];x double precision[];raw double precision[];norm record;data jsonb:='[]';n integer:=0;dc text;
BEGIN
 IF p_cell.policy_representation<>'public_hist215_v1' OR public.fn_gto_v31_public215_digest(p_cell.public_model)<>p_cell.model_checksum OR public.fn_gto_v31_public215_digest(p_cell.public_template)<>p_cell.template_checksum THEN RAISE EXCEPTION 'immutable genuine model/template required';END IF;
 physics:=public.fn_gto_v31_public215_prepare_math(p_cell.public_template,p_board);k:=public.fn_gto_v31_public215_audit_key(p_cell.model_checksum,p_cell.template_checksum,p_board,physics);
 PERFORM pg_advisory_xact_lock(hashtextextended('v31-public-audit:'||k,0));
 IF EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=k) THEN RETURN k;END IF;
 SELECT * INTO STRICT ph FROM public.gto_v31_public_physics WHERE physics_key=physics;SELECT c.heads INTO heads FROM public.gto_v31_public_model_compiled c WHERE c.model_checksum=p_cell.model_checksum AND c.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation();
 IF heads IS NULL THEN heads:=public.fn_gto_v31_public215_compile(p_cell.public_model);INSERT INTO public.gto_v31_public_model_compiled VALUES(p_cell.model_checksum,public.fn_gto_v31_public215_encoding_implementation(),heads)ON CONFLICT DO NOTHING;END IF;
 -- Private child FK is deferred until its complete immutable parent digest is inserted.
 FOR r IN SELECT value FROM jsonb_array_elements(ph.exact_mass_rows) LOOP
  mass:=ARRAY[(r->>1)::numeric,(r->>2)::numeric,(r->>3)::numeric,(r->>4)::numeric,(r->>5)::numeric,(r->>6)::numeric,(r->>7)::numeric,(r->>8)::numeric];
  x:=public.fn_gto_v31_public215_features((r->>0)::integer,array_to_string(p_board,''),p_cell.public_template,mass);raw:=public.fn_gto_v31_public215_compiled_raw(heads,x);SELECT * INTO STRICT norm FROM public.fn_gto_v31_public215_normalize(p_cell.public_model->>'variant',jsonb_array_length(p_cell.public_model->'action_ids'),raw);
  INSERT INTO public.gto_v31_public_model_audit_combos VALUES(k,(r->>0)::integer,x,raw,norm.policy_ev,norm.action_evs,norm.frequencies);n:=n+1;
 END LOOP;
 IF n<>ph.legal_combos THEN RAISE EXCEPTION 'complete all-legal audit derivation required';END IF;
 SELECT jsonb_agg(jsonb_build_array(combo,public.fn_gto_v31_public215_bits(features),public.fn_gto_v31_public215_bits(raw_heads),encode(float8send(policy_ev),'hex'),public.fn_gto_v31_public215_bits(action_evs),public.fn_gto_v31_public215_bits(frequencies))ORDER BY combo)INTO data FROM public.gto_v31_public_model_audit_combos c WHERE c.audit_key=k;dc:=public.fn_gto_v31_public215_digest(jsonb_build_object('audit_key',k,'derived_rows',data));
 INSERT INTO public.gto_v31_public_model_audits VALUES(k,physics,p_cell.model_checksum,p_cell.template_checksum,public.fn_gto_v31_public215_encoding_implementation(),p_board,n,dc,now());
 RETURN k;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_prepare_audit_for(p_cell gto_v31_runtime_cells, p_board text[])
 RETURNS text
 LANGUAGE plpgsql
 STRICT
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_cell.feature_contract_version='holdem-public-hist215-v2' THEN RETURN public.fn_gto_v31_public215_prepare_audit_v2(p_cell,p_board);END IF;
 RETURN public.fn_gto_v31_public215_prepare_audit(p_cell,p_board);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_prepare_audit_v2(p_cell gto_v31_runtime_cells, p_board text[])
 RETURNS text
 LANGUAGE plpgsql
 STRICT
 SET search_path TO 'public'
AS $function$
DECLARE physics text;k text;heads public.gto_v31_public215_head[];ph public.gto_v31_public_physics%ROWTYPE;r jsonb;mass numeric[];x double precision[];raw double precision[];norm record;data jsonb:='[]';n integer:=0;dc text;
BEGIN
 IF p_cell.policy_representation<>'public_hist215_v1' OR p_cell.feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2' OR public.fn_gto_v31_public215_digest(p_cell.public_model)<>p_cell.model_checksum OR public.fn_gto_v31_public215_digest(p_cell.public_template)<>p_cell.template_checksum THEN RAISE EXCEPTION 'immutable genuine model/template required';END IF;
 physics:=public.fn_gto_v31_public215_prepare_math(p_cell.public_template,p_board);k:=public.fn_gto_v31_public215_audit_key_v2(p_cell.model_checksum,p_cell.template_checksum,p_board,physics);
 PERFORM pg_advisory_xact_lock(hashtextextended('v31-public-audit:'||k,0));
 IF EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=k) THEN RETURN k;END IF;
 SELECT * INTO STRICT ph FROM public.gto_v31_public_physics WHERE physics_key=physics;SELECT c.heads INTO heads FROM public.gto_v31_public_model_compiled c WHERE c.model_checksum=p_cell.model_checksum AND c.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation_v2();
 IF heads IS NULL THEN heads:=public.fn_gto_v31_public215_compile(p_cell.public_model);INSERT INTO public.gto_v31_public_model_compiled VALUES(p_cell.model_checksum,public.fn_gto_v31_public215_encoding_implementation_v2(),heads)ON CONFLICT DO NOTHING;END IF;
 -- Private child FK is deferred until its complete immutable parent digest is inserted.
 FOR r IN SELECT value FROM jsonb_array_elements(ph.exact_mass_rows) LOOP
  mass:=ARRAY[(r->>1)::numeric,(r->>2)::numeric,(r->>3)::numeric,(r->>4)::numeric,(r->>5)::numeric,(r->>6)::numeric,(r->>7)::numeric,(r->>8)::numeric];
  x:=public.fn_gto_v31_public215_features_v2((r->>0)::integer,array_to_string(p_board,''),p_cell.public_template,mass);raw:=public.fn_gto_v31_public215_compiled_raw_v2(heads,x);SELECT * INTO STRICT norm FROM public.fn_gto_v31_public215_normalize(p_cell.public_model->>'variant',jsonb_array_length(p_cell.public_model->'action_ids'),raw);
  INSERT INTO public.gto_v31_public_model_audit_combos VALUES(k,(r->>0)::integer,x,raw,norm.policy_ev,norm.action_evs,norm.frequencies);n:=n+1;
 END LOOP;
 IF n<>ph.legal_combos THEN RAISE EXCEPTION 'complete all-legal audit derivation required';END IF;
 SELECT jsonb_agg(jsonb_build_array(combo,public.fn_gto_v31_public215_bits(features),public.fn_gto_v31_public215_bits(raw_heads),encode(float8send(policy_ev),'hex'),public.fn_gto_v31_public215_bits(action_evs),public.fn_gto_v31_public215_bits(frequencies))ORDER BY combo)INTO data FROM public.gto_v31_public_model_audit_combos c WHERE c.audit_key=k;dc:=public.fn_gto_v31_public215_digest(jsonb_build_object('audit_key',k,'derived_rows',data));
 INSERT INTO public.gto_v31_public_model_audits VALUES(k,physics,p_cell.model_checksum,p_cell.template_checksum,public.fn_gto_v31_public215_encoding_implementation_v2(),p_board,n,dc,now());
 RETURN k;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_prepare_math(p_template jsonb, p_board text[])
 RETURNS text
 LANGUAGE plpgsql
 STRICT
 SET search_path TO 'public'
AS $function$
DECLARE k text;impl text;weights numeric[];ids integer[];rows jsonb;ws jsonb;pc text;count_rows integer;factor integer;expected integer;
BEGIN
 k:=public.fn_gto_v31_public215_physics_key(p_template,p_board);IF EXISTS(SELECT 1 FROM public.gto_v31_public_physics p WHERE p.physics_key=k) THEN RETURN k;END IF;
 impl:=public.fn_gto_v31_public215_physics_implementation();weights:=public.fn_gto_v31_public215_normalized_weights(p_template);
 SELECT array_agg((strpos('23456789TJQKA',substr(c,1,1))-1)*4+strpos('cdhs',substr(c,2,1))-1 ORDER BY (strpos('23456789TJQKA',substr(c,1,1))-1)*4+strpos('cdhs',substr(c,2,1))-1) INTO ids FROM unnest(p_board)c;
 factor:=CASE cardinality(ids) WHEN 3 THEN 990 WHEN 4 THEN 44 ELSE 1 END;expected:=CASE cardinality(ids) WHEN 3 THEN 1176 WHEN 4 THEN 1128 ELSE 1081 END;
 SELECT count(*),jsonb_agg(jsonb_build_array(combo,current_w::text,current_t::text,(current_z-current_w-current_t)::text,current_z::text,terminal_w::text,terminal_t::text,(terminal_z-terminal_w-terminal_t)::text,terminal_z::text) ORDER BY combo)
 INTO count_rows,rows FROM public.fn_gto_v31_public215_dense_wtl(ids,weights)
 WHERE current_z>0 AND current_w>=0 AND current_t>=0 AND current_w+current_t<=current_z AND terminal_z=current_z*factor AND terminal_w>=0 AND terminal_t>=0 AND terminal_w+terminal_t<=terminal_z;
 IF count_rows<>expected THEN RAISE EXCEPTION 'complete legal-combo public physics required (including zero-training-weight holes)';END IF;
 SELECT jsonb_agg(w::text ORDER BY i) INTO ws FROM unnest(weights)WITH ORDINALITY t(w,i);pc:=public.fn_gto_v31_public215_digest(jsonb_build_object('physics_key',k,'rows',rows));
 INSERT INTO public.gto_v31_public_physics(physics_key,implementation_checksum,board_ids,normalized_weights_checksum,exact_mass_rows,physics_checksum,legal_combos)VALUES(k,impl,ids,public.fn_gto_v31_public215_digest(ws),rows,pc,count_rows) ON CONFLICT DO NOTHING;
 RETURN k;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_provenance_valid(p_cell gto_v31_runtime_cells, p_dataset gto_v31_datasets, p_bundle gto_v31_input_bundles, p_sources jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE t jsonb:=p_cell.public_training_provenance;protocols jsonb:=p_bundle.bundle_manifest->'public215_protocols';partition jsonb:=protocols->'source_partition';global_sources jsonb;cell_sources jsonb;groups jsonb;expected_groups jsonb;entry jsonb;context jsonb:=p_cell.public_template->'context';i integer;source jsonb;lastkey text:='';key text;k text;
BEGIN
 IF NOT public.fn_gto_v31_public215_keys(t,ARRAY['format','approved_input_bundle_id','input_bundle_checksum','manifest_checksum','capture_receipt_checksum','training_recipe_checksum','source_partition_checksum','producer_commit','producer_bundle_checksum','solver_binary_checksum','range_bundle_checksum','icm_model_checksum','feature_schema_checksum','encoder_checksum','physics_checksum','dependency_lock_checksum','runtime_parity_protocol_checksum','whole_variant','parameters','machine_id','source_count','artifact_count','board_count','sources']) OR t->>'format' IS DISTINCT FROM 'public_hist215_training_v1' OR t->>'approved_input_bundle_id' IS DISTINCT FROM p_dataset.input_bundle_id::text OR t->>'input_bundle_checksum' IS DISTINCT FROM p_dataset.input_bundle_checksum OR t->>'manifest_checksum' IS DISTINCT FROM p_dataset.manifest_checksum OR t->>'producer_commit' IS DISTINCT FROM p_dataset.pipeline_commit OR t->>'producer_bundle_checksum' IS DISTINCT FROM p_dataset.pipeline_bundle_checksum OR t->>'solver_binary_checksum' IS DISTINCT FROM p_dataset.solver_binary_checksum OR t->>'range_bundle_checksum' IS DISTINCT FROM p_dataset.range_bundle_checksum OR t->>'icm_model_checksum' IS DISTINCT FROM p_dataset.icm_model_checksum OR t->>'feature_schema_checksum' IS DISTINCT FROM p_cell.feature_schema_checksum OR t->>'machine_id' IS DISTINCT FROM 'M1' OR t->>'whole_variant' IS DISTINCT FROM p_cell.public_model->>'variant' OR t->'whole_variant'IS DISTINCT FROM protocols#>'{training_recipe,whole_variant}' OR t->'parameters'IS DISTINCT FROM protocols#>'{training_recipe,parameters}' OR t->'parameters' IS DISTINCT FROM '{"max_iter":100,"max_leaf_nodes":15,"min_samples_leaf":10,"l2_regularization_f64":"4024000000000000","early_stopping":false,"random_state":731}'::jsonb THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['training_recipe','source_partition','dependency_lock','runtime_parity_protocol'] LOOP IF t->>(k||'_checksum') IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols->k) THEN RETURN false;END IF;END LOOP;
 IF t->>'physics_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols->'physics_protocol') OR t->>'encoder_checksum' IS DISTINCT FROM protocols#>>'{training_recipe,encoder_checksum}' OR t->>'encoder_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(protocols#>'{training_recipe,encoder_descriptor}') OR COALESCE(t->>'encoder_checksum','')!~'^[0-9a-f]{64}$' THEN RETURN false;END IF;
 IF partition->>'format' IS DISTINCT FROM 'public_hist215_source_partition_protocol_v1' OR jsonb_typeof(partition->'training_contexts') IS DISTINCT FROM 'array' OR jsonb_array_length(partition->'training_contexts')<>jsonb_array_length(p_bundle.bundle_manifest->'public215_contexts') THEN RETURN false;END IF;
 -- All M1 sources must be exactly the complete preapproved public training groups.
 -- Unknown future M2 boards/labels are deliberately absent from this digest.
 FOR entry IN SELECT value FROM jsonb_array_elements(partition->'training_contexts') LOOP
  IF (SELECT count(DISTINCT value->'context')FROM jsonb_array_elements(partition->'training_contexts'))<>jsonb_array_length(partition->'training_contexts') THEN RETURN false;END IF;
  IF jsonb_typeof(entry->'rank_signatures') IS DISTINCT FROM 'array' OR jsonb_array_length(entry->'rank_signatures')<>57 OR (SELECT count(DISTINCT value)FROM jsonb_array_elements(entry->'rank_signatures'))<>57 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_bundle.bundle_manifest->'public215_contexts')c WHERE c->'context'=entry->'context') THEN RETURN false;END IF;
  SELECT jsonb_agg(sig ORDER BY sig COLLATE "C")INTO groups FROM(SELECT public.fn_gto_v31_public215_rank_signature(value->>'board')sig FROM jsonb_array_elements(p_sources) WHERE value->>'machine_id'='M1' AND value->'context'=entry->'context')q;
  SELECT jsonb_agg(value ORDER BY value#>>'{}' COLLATE "C")INTO expected_groups FROM jsonb_array_elements(entry->'rank_signatures');IF groups IS DISTINCT FROM expected_groups THEN RETURN false;END IF;
 END LOOP;
 IF (SELECT count(*)FROM jsonb_array_elements(p_sources) WHERE value->>'machine_id'='M1')<>57*jsonb_array_length(partition->'training_contexts') THEN RETURN false;END IF;
 SELECT jsonb_agg(value-'machine_id'-'context' ORDER BY value->>'source_row_id' COLLATE "C",value->>'source_node' COLLATE "C")INTO global_sources FROM jsonb_array_elements(p_sources)WHERE value->>'machine_id'='M1';
 IF t->>'capture_receipt_checksum' IS DISTINCT FROM public.fn_gto_v31_public215_digest(global_sources) THEN RETURN false;END IF;
 SELECT jsonb_agg(value-'machine_id'-'context' ORDER BY value->>'source_row_id' COLLATE "C",value->>'source_node' COLLATE "C")INTO cell_sources FROM jsonb_array_elements(p_sources) WHERE value->>'machine_id'='M1' AND value->'context'=context;
 IF cell_sources IS NULL OR t->'sources' IS DISTINCT FROM cell_sources OR t->'source_count' IS DISTINCT FROM to_jsonb(jsonb_array_length(cell_sources)) OR t->'artifact_count' IS DISTINCT FROM(SELECT to_jsonb(count(DISTINCT value->>'source_row_id'))FROM jsonb_array_elements(cell_sources)) OR t->'board_count' IS DISTINCT FROM(SELECT to_jsonb(count(DISTINCT value->>'board'))FROM jsonb_array_elements(cell_sources)) THEN RETURN false;END IF;
 RETURN public.fn_gto_v31_public215_digest(t)=p_cell.training_provenance_checksum;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_rank(p_cards integer[])
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE counts integer[]:=array_fill(0,ARRAY[15]); sc integer[]:=array_fill(0,ARRAY[4]); sm integer[]:=array_fill(0,ARRAY[4]); mask integer:=0; c integer; r integer; s integer; hi integer; st integer:=0; fs integer:=0; q integer:=0; tr integer[]:=ARRAY[]::integer[]; pa integer[]:=ARRAY[]::integer[]; ranks integer[]:=ARRAY[]::integer[]; vals integer[]; cat integer:=0; result integer;
BEGIN
 -- Called only with the internally validated public deck by the private WTL owner.
 IF cardinality(p_cards) NOT BETWEEN 5 AND 7 THEN RAISE EXCEPTION 'public215 rank requires5..7 cards'; END IF;
 FOREACH c IN ARRAY p_cards LOOP
  r:=c/4+2;s:=c%4+1;counts[r]:=counts[r]+1;sc[s]:=sc[s]+1;mask:=mask|(1<<r);sm[s]:=sm[s]|(1<<r);
 END LOOP;
 FOR s IN 1..4 LOOP
  IF sc[s]>=5 THEN
   FOR hi IN REVERSE 14..6 LOOP IF (sm[s]&(31<<(hi-4)))=(31<<(hi-4)) THEN st:=hi;EXIT;END IF;END LOOP;
   IF st=0 AND (sm[s]&16444)=16444 THEN st:=5;END IF;
   IF st>0 THEN cat:=8;vals:=ARRAY[st];EXIT;END IF;fs:=s;
  END IF;
 END LOOP;
 IF cat<>8 THEN
  FOR r IN REVERSE 14..2 LOOP
   IF counts[r]>0 THEN ranks:=array_append(ranks,r);END IF;
   IF counts[r]>=2 THEN pa:=array_append(pa,r);END IF;
   IF counts[r]>=3 THEN tr:=array_append(tr,r);END IF;
   IF counts[r]=4 THEN q:=r;END IF;
  END LOOP;
  IF q>0 THEN cat:=7;FOREACH r IN ARRAY ranks LOOP IF r<>q THEN vals:=ARRAY[q,r];EXIT;END IF;END LOOP;
  ELSIF cardinality(tr)>0 AND EXISTS(SELECT 1 FROM unnest(pa) x WHERE x<>tr[1]) THEN
   cat:=6;FOREACH r IN ARRAY pa LOOP IF r<>tr[1] THEN vals:=ARRAY[tr[1],r];EXIT;END IF;END LOOP;
  ELSIF fs>0 THEN cat:=5;vals:=ARRAY[]::integer[];FOR r IN REVERSE 14..2 LOOP IF (sm[fs]&(1<<r))<>0 THEN vals:=array_append(vals,r);END IF;END LOOP;
  ELSE
   st:=0;FOR hi IN REVERSE 14..6 LOOP IF (mask&(31<<(hi-4)))=(31<<(hi-4)) THEN st:=hi;EXIT;END IF;END LOOP;
   IF st=0 AND (mask&16444)=16444 THEN st:=5;END IF;
   IF st>0 THEN cat:=4;vals:=ARRAY[st];
   ELSIF cardinality(tr)>0 THEN cat:=3;vals:=ARRAY[tr[1]];FOREACH r IN ARRAY ranks LOOP IF r<>tr[1] AND cardinality(vals)<3 THEN vals:=array_append(vals,r);END IF;END LOOP;
   ELSIF cardinality(pa)>=2 THEN cat:=2;FOREACH r IN ARRAY ranks LOOP IF r<>pa[1] AND r<>pa[2] THEN vals:=ARRAY[pa[1],pa[2],r];EXIT;END IF;END LOOP;
   ELSIF cardinality(pa)=1 THEN cat:=1;vals:=ARRAY[pa[1]];FOREACH r IN ARRAY ranks LOOP IF r<>pa[1] AND cardinality(vals)<4 THEN vals:=array_append(vals,r);END IF;END LOOP;
   ELSE vals:=ranks;END IF;
  END IF;
 END IF;
 result:=cat;FOR r IN 1..5 LOOP result:=result*15+COALESCE(vals[r],0);END LOOP;RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_rank_signature(p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE ranks text;
BEGIN
 IF NOT public.fn_gto_v31_public215_cards(p_board)THEN RAISE EXCEPTION 'invalid public rank-group board';END IF;
 SELECT string_agg(substring(p_board FROM j FOR 1),'' ORDER BY strpos('23456789TJQKA',substring(p_board FROM j FOR 1)),j)INTO ranks FROM generate_series(1,length(p_board),2)j;RETURN(length(p_board)/2)::text||':'||ranks;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_ratio(p_n numeric, p_d numeric)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE e integer:=0;n numeric:=p_n;q numeric;r numeric;
BEGIN
 IF p_n<0 OR p_d<=0 OR p_n>p_d OR p_n<>trunc(p_n) OR p_d<>trunc(p_d) OR p_d>9223372036854775807::numeric*990 THEN RAISE EXCEPTION 'public215 ratio bounds';END IF;
 IF p_n=0 THEN RETURN 0::double precision;END IF;
 WHILE n<p_d LOOP n:=n*2;e:=e-1;END LOOP;
 n:=p_n*power(2::numeric,52-e);q:=div(n,p_d);r:=n-q*p_d;
 IF r*2>p_d OR (r*2=p_d AND mod(q,2)=1) THEN q:=q+1;END IF;
 RETURN q::double precision*power(2::double precision,(e-52)::double precision);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_required_audit(p_cell gto_v31_runtime_cells, p_board text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE board text[];physics text;k text;
BEGIN
 SELECT array_agg(substring(p_board FROM j FOR 2)ORDER BY j)INTO board FROM generate_series(1,length(p_board),2)j;physics:=public.fn_gto_v31_public215_physics_key(p_cell.public_template,board);k:=public.fn_gto_v31_public215_audit_key(p_cell.model_checksum,p_cell.template_checksum,board,physics);
 IF NOT EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=k AND a.model_checksum=p_cell.model_checksum AND a.template_checksum=p_cell.template_checksum AND a.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation())THEN RAISE EXCEPTION 'independent complete public SQL audit is not prepared';END IF;RETURN k;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_required_audit_for(p_cell gto_v31_runtime_cells, p_board text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
BEGIN
 IF p_cell.feature_contract_version='holdem-public-hist215-v2' THEN RETURN public.fn_gto_v31_public215_required_audit_v2(p_cell,p_board);END IF;
 RETURN public.fn_gto_v31_public215_required_audit(p_cell,p_board);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_required_audit_v2(p_cell gto_v31_runtime_cells, p_board text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE board text[];physics text;k text;
BEGIN
 IF p_cell.feature_contract_version IS DISTINCT FROM 'holdem-public-hist215-v2' THEN RAISE EXCEPTION 'public215 v2 cell required';END IF;
 SELECT array_agg(substring(p_board FROM j FOR 2)ORDER BY j)INTO board FROM generate_series(1,length(p_board),2)j;physics:=public.fn_gto_v31_public215_physics_key(p_cell.public_template,board);k:=public.fn_gto_v31_public215_audit_key_v2(p_cell.model_checksum,p_cell.template_checksum,board,physics);
 IF NOT EXISTS(SELECT 1 FROM public.gto_v31_public_model_audits a WHERE a.audit_key=k AND a.model_checksum=p_cell.model_checksum AND a.template_checksum=p_cell.template_checksum AND a.encoding_checksum=public.fn_gto_v31_public215_encoding_implementation_v2())THEN RAISE EXCEPTION 'independent complete public SQL audit is not prepared';END IF;RETURN k;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_runtime_protocol_valid(p jsonb, contexts jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE c jsonb;item jsonb;i integer:=0;board text;
BEGIN
 IF NOT public.fn_gto_v31_public215_keys(p,ARRAY['format','method','clock','platform','node_major','napi_version','native_source_checksum','execution_limit_ms','contexts']) OR p->>'format' IS DISTINCT FROM 'public_hist215_runtime_parity_protocol_v1' OR p->>'method' IS DISTINCT FROM 'cold_public215_features_and_all_heads_v1' OR p->>'clock' IS DISTINCT FROM 'process.hrtime.bigint' OR p->>'platform' IS DISTINCT FROM 'linux' OR p->'node_major' IS DISTINCT FROM '22'::jsonb OR p->'napi_version' IS DISTINCT FROM '8'::jsonb OR p->'execution_limit_ms' IS DISTINCT FROM '8000'::jsonb OR p->>'native_source_checksum' IS DISTINCT FROM '83442cb6604dfaa30ec7ecc6ce38957355609e722b5df85b866365c97f0ccf9b' OR jsonb_typeof(p->'contexts') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'contexts')<>jsonb_array_length(contexts) THEN RETURN false;END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p->'contexts') LOOP
  IF NOT public.fn_gto_v31_public215_keys(c,ARRAY['context','cases']) OR c->'context' IS DISTINCT FROM contexts->i->'context' OR jsonb_typeof(c->'cases') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'cases') NOT BETWEEN 2 AND 32 OR (SELECT count(DISTINCT value)FROM jsonb_array_elements(c->'cases'))<>jsonb_array_length(c->'cases') THEN RETURN false;END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(c->'cases') LOOP
   IF NOT public.fn_gto_v31_public215_keys(item,ARRAY['board','own']) OR jsonb_typeof(item->'board') IS DISTINCT FROM 'string' OR NOT public.fn_gto_v31_public215_cards(item->>'board',item->'own') OR length(item->>'board')<>(CASE c#>>'{context,street}' WHEN 'flop' THEN 6 WHEN 'turn' THEN 8 WHEN 'river' THEN 10 ELSE 0 END) THEN RETURN false;END IF;
  END LOOP;i:=i+1;
 END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_seal_cell_binding(p_dataset_id uuid, p_cell_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'extensions'
AS $function$
DECLARE d public.gto_v31_datasets;b public.gto_v31_input_bundles;c public.gto_v31_runtime_cells;p public.gto_v31_model_preparations;f public.gto_v31_model_freezes;
 receipt_rows jsonb;source_versions jsonb;journal_rows jsonb;audit_rows jsonb;bundle_revision bigint;ordinal bigint;
BEGIN
 SELECT * INTO STRICT d FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND state='building'AND policy_representation='public_hist215_v1';
 SELECT * INTO STRICT b FROM public.gto_v31_input_bundles WHERE input_bundle_id=d.input_bundle_id AND bundle_checksum=d.input_bundle_checksum AND approval_status='approved';
 SELECT * INTO STRICT c FROM public.gto_v31_runtime_cells WHERE dataset_id=d.dataset_id AND cell_key_checksum=p_cell_key AND policy_representation='public_hist215_v1';
 SELECT * INTO STRICT p FROM public.gto_v31_model_preparations WHERE dataset_id=d.dataset_id AND cell_key_checksum=c.cell_key_checksum;
 SELECT * INTO STRICT f FROM public.gto_v31_model_freezes WHERE dataset_id=d.dataset_id AND cell_key_checksum=c.cell_key_checksum;
 IF p.context IS DISTINCT FROM c.public_template->'context' OR p.identity->>'model_checksum' IS DISTINCT FROM c.model_checksum OR p.identity->>'template_checksum'IS DISTINCT FROM c.template_checksum OR p.identity->>'training_provenance_checksum'IS DISTINCT FROM c.training_provenance_checksum OR f.model_build_receipt_checksum IS DISTINCT FROM c.model_build_receipt_checksum OR f.public_model_build_receipt IS DISTINCT FROM c.public_model_build_receipt THEN RAISE EXCEPTION 'prepared model differs from frozen model';END IF;
 SELECT count(*)INTO ordinal FROM public.gto_v31_model_preparations z WHERE z.dataset_id=d.dataset_id AND public.fn_gto_v31_public215_canonical(z.context)COLLATE "C"<public.fn_gto_v31_public215_canonical(p.context)COLLATE "C";
 SELECT COALESCE(revision,0)INTO bundle_revision FROM public.gto_v31_seal_input_revisions WHERE input_kind='bundle'AND input_id=b.input_bundle_id::text;bundle_revision:=COALESCE(bundle_revision,0);
 SELECT jsonb_agg(to_jsonb(r)ORDER BY r.source_row_id::text COLLATE "C",r.source_node COLLATE "C")INTO receipt_rows FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id AND r.dataset_id=d.dataset_id;
 SELECT jsonb_agg(jsonb_build_object('artifact',to_jsonb(a),'gold_id',g.id,'gold_revision',COALESCE(v.revision,0),'present',COALESCE(v.present,true),'scenario_hash',g.scenario_hash,'quality_status',g.quality_status,'audited_at',g.audited_at,'source_artifact_checksum',g.source_artifact_checksum,'machine_id',g.machine_id,'solver_version',g.solver_version,'solver_binary_checksum',g.solver_binary_checksum,'pipeline_commit',g.pipeline_commit,'pipeline_bundle_checksum',g.pipeline_bundle_checksum,'manifest_version',g.manifest_version,'manifest_checksum',g.manifest_checksum)ORDER BY a.source_row_id::text COLLATE "C")INTO source_versions
 FROM public.gto_v31_source_artifacts a JOIN public.solved_spots_gold g ON g.id=a.source_row_id LEFT JOIN public.gto_v31_seal_input_revisions v ON v.input_kind='gold'AND v.input_id=g.id::text WHERE a.dataset_id=d.dataset_id AND a.source_row_id IN(SELECT r.source_row_id FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id);
 SELECT jsonb_agg(to_jsonb(j)ORDER BY j.source_row_id::text COLLATE "C",j.source_node COLLATE "C")INTO journal_rows FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=d.dataset_id AND j.context=p.context;
 SELECT jsonb_agg(jsonb_build_object('audit_key',a.audit_key,'physics_key',a.physics_key,'model_checksum',a.model_checksum,'template_checksum',a.template_checksum,'encoding_checksum',a.encoding_checksum,'legal_combos',a.legal_combos,'audit_checksum',a.audit_checksum,'prepared_at',a.prepared_at,'derived_count',(SELECT count(*)FROM public.gto_v31_public_model_audit_combos z WHERE z.audit_key=a.audit_key))ORDER BY a.audit_key COLLATE "C")INTO audit_rows
 FROM public.gto_v31_public_source_journal j JOIN public.gto_v31_public_model_audits a ON a.audit_key=public.fn_gto_v31_public215_required_audit_for(c,j.board)WHERE j.dataset_id=d.dataset_id AND j.context=p.context AND j.machine_id='M2';
 RETURN jsonb_build_object('dataset',to_jsonb(d),'bundle',jsonb_build_object('input_bundle_id',b.input_bundle_id,'bundle_key',b.bundle_key,'bundle_checksum',b.bundle_checksum,'range_bundle_checksum',b.range_bundle_checksum,'source_combo_order_checksum',b.source_combo_order_checksum,'icm_model_checksum',b.icm_model_checksum,'approval_status',b.approval_status,'approved_by',b.approved_by,'approved_at',b.approved_at,'revoked_by',b.revoked_by,'revoked_at',b.revoked_at,'revocation_reason',b.revocation_reason,'feature_contract_version',b.feature_contract_version,'policy_export_schema',b.policy_export_schema,'policy_representation',b.policy_representation),'bundle_revision',bundle_revision,'epochs',(SELECT jsonb_object_agg(input_id,revision)FROM public.gto_v31_seal_input_revisions WHERE input_kind='epoch'),
 'cell',jsonb_build_object('cell_id',c.cell_id,'cell_key_checksum',c.cell_key_checksum,'context',p.context,'preparation_offset',ordinal,'model_checksum',c.model_checksum,'template_checksum',c.template_checksum,'training_provenance_checksum',c.training_provenance_checksum,'model_build_receipt_checksum',c.model_build_receipt_checksum,'cell_payload_checksum',c.cell_payload_checksum,'lineage_checksum',c.lineage_checksum,'sql_physics_checksum',c.sql_physics_checksum,'source_rows',c.source_rows,'train_source_rows',c.train_source_rows,'holdout_source_rows',c.holdout_source_rows),
 'receipts',receipt_rows,'sources',source_versions,'journal',journal_rows,'audits',audit_rows);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_seal_prepared(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_cells bigint;
  v_source bigint;
  v_train bigint;
  v_holdout bigint;
  v_source_nodes bigint;
  v_receipts bigint;
  v_checksum text;
  v_source_checksum text;
  v_coverage jsonb;
  v_metrics jsonb;
  v_metric_checksum text;
  v_frequency_mae numeric;
  v_sizing_mae numeric;
  v_policy_mae numeric;
  v_regret numeric;
  v_regret_coverage numeric;
  v_frequency_observations bigint;
  v_sizing_observations bigint;
  v_policy_observations bigint;
  v_regret_observations bigint;
  v_live_observations bigint;
  v_missing bigint;
  v_pass boolean;
  v_family text;
  v_family_metrics jsonb;
  v_by_family jsonb := '{}'::jsonb;
  v_prepared_raw jsonb;v_qualification text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND (c.feature_contract_version IS DISTINCT FROM v_dataset.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM v_dataset.policy_export_schema)) THEN RAISE EXCEPTION 'cell feature version differs from dataset'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF v_dataset.policy_representation IS DISTINCT FROM 'public_hist215_v1' THEN RAISE EXCEPTION 'prepared seal requires public model';END IF;
  IF v_dataset.policy_representation='public_hist215_v1' THEN
    PERFORM c.cell_id FROM public.gto_v31_runtime_cells c
      WHERE c.dataset_id=p_dataset_id ORDER BY c.cell_key_checksum FOR SHARE;
  END IF;
  -- Full public payload validation is attested after unchanged coverage guards.
  -- Every source was fully validated under row locks in its bound preparation.

  IF NOT EXISTS (
    SELECT 1 FROM public.gto_v31_input_bundles b
     WHERE b.input_bundle_id=v_dataset.input_bundle_id
       AND b.approval_status='approved' AND b.bundle_checksum=v_dataset.input_bundle_checksum
       AND b.feature_contract_version IS NOT DISTINCT FROM v_dataset.feature_contract_version
       AND b.range_bundle_checksum=v_dataset.range_bundle_checksum
       AND b.source_combo_order_checksum=v_dataset.source_combo_order_checksum
       AND b.icm_model_checksum=v_dataset.icm_model_checksum
  ) THEN RAISE EXCEPTION 'dataset input approval is absent or revoked'; END IF;

  SELECT count(*),COALESCE(sum(source_rows),0),COALESCE(sum(train_source_rows),0),
         COALESCE(sum(holdout_source_rows),0)
    INTO v_cells,v_source,v_train,v_holdout
    FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  IF v_cells=0 OR jsonb_array_length(v_dataset.declared_coverage)<>v_cells
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(v_dataset.declared_coverage))<>v_cells
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_runtime_cells c
        WHERE c.dataset_id=p_dataset_id AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
           WHERE d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket)))
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id
           AND d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket))) THEN
    RAISE EXCEPTION 'runtime cells do not exactly equal declared coverage';
  END IF;
  IF v_dataset.evaluation_contract='gto_v31_candidate.v3' THEN
    -- Contract v3 (2026-11-06): breadth within the dataset's own scope.
    IF NOT public.fn_gto_v31_v3_breadth_ok(p_dataset_id) THEN
      RAISE EXCEPTION 'required v3 scope coverage is incomplete: every family and objective the dataset carries must cover every street the playbook carries';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='flop')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='turn')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='river')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='cash' AND objective='cash_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='icm')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_ev' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_icm' AND objective='icm')
     OR EXISTS (
       SELECT 1
         FROM (VALUES ('cash','cash_ev'),('spin','chip_ev'),('spin','icm'),
                      ('tourney_ev','chip_ev'),('tourney_icm','icm'))
              required_family(game_family,objective)
         CROSS JOIN unnest(ARRAY['flop','turn','river']) required_street(street)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c
           WHERE c.dataset_id=p_dataset_id
             AND c.game_family=required_family.game_family
             AND c.objective=required_family.objective
             AND c.street=required_street.street))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['limped','srp','3bet','4bet_plus']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.pot_type=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.utility_context=required.value))
     OR EXISTS (SELECT 1 FROM generate_series(2,10) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.table_size=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.node_role=required.value)) THEN
    RAISE EXCEPTION 'required Phase 4 street, family, utility, table, pot, or response coverage is incomplete';
  END IF;
  v_prepared_raw:=public.fn_gto_v31_public215_assert_prepared_seal(v_dataset);
  v_qualification:=public.fn_gto_v31_seal_qualification_fingerprint();
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
     WHERE c.dataset_id=p_dataset_id
       AND (c.cell_key_checksum<>public.fn_gto_v31_cell_key_checksum(to_jsonb(c))
         OR c.cell_payload_checksum<>public.fn_gto_v31_cell_payload_checksum(to_jsonb(c))
         OR c.source_rows<>c.train_source_rows+c.holdout_source_rows
         OR CASE WHEN v_dataset.policy_representation='public_hist215_v1' THEN false
                 ELSE NOT public.fn_gto_v31_cell_payload_valid(to_jsonb(c)) END)
  ) THEN RAISE EXCEPTION 'a compact cell seal or payload no longer validates'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
    LEFT JOIN LATERAL (
      SELECT count(*) n,count(*) FILTER (WHERE r.split='train') train_n,
             count(*) FILTER (WHERE r.split='holdout') holdout_n,
             encode(digest(string_agg(r.source_row_id::text||':'||r.source_node||':'||
               r.source_node_checksum,'' ORDER BY r.source_row_id::text,r.source_node),'sha256'),'hex') lineage
        FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id
    ) x ON true
     WHERE c.dataset_id=p_dataset_id AND
       (x.n<>c.source_rows OR x.train_n<>c.train_source_rows OR x.holdout_n<>c.holdout_source_rows
        OR x.lineage IS DISTINCT FROM c.lineage_checksum)
  ) THEN RAISE EXCEPTION 'cell source receipts do not reconcile'; END IF;
  SELECT COALESCE(sum(node_count),0) INTO v_source_nodes
    FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT count(*) INTO v_receipts FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id;
  IF v_source_nodes<>v_receipts OR v_source<>v_receipts
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_source_artifacts a
       LEFT JOIN public.solved_spots_gold s ON s.id=a.source_row_id
        WHERE a.dataset_id=p_dataset_id AND (s.id IS NULL OR s.quality_status<>'validated'
          OR s.audited_at IS NULL OR s.source_artifact_checksum<>a.source_artifact_checksum
          OR s.solver_version<>v_dataset.solver_version
          OR s.solver_binary_checksum<>v_dataset.solver_binary_checksum
          OR s.machine_id<>a.machine_id OR s.pipeline_commit<>v_dataset.pipeline_commit
          OR s.pipeline_bundle_checksum<>v_dataset.pipeline_bundle_checksum
          OR s.manifest_version::text<>v_dataset.manifest_version
          OR s.manifest_checksum<>v_dataset.manifest_checksum)) THEN
    RAISE EXCEPTION 'source artifacts are missing, omitted, quarantined, or changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M1')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M2') THEN
    RAISE EXCEPTION 'dataset provenance does not include both solver hosts';
  END IF;

  v_metrics:=public.fn_gto_v31_public215_metrics_from_raw(v_prepared_raw,NULL);
  v_frequency_mae:=(v_metrics->>'frequency_mae')::numeric;
  v_sizing_mae:=(v_metrics->>'sizing_mae')::numeric;
  v_policy_mae:=(v_metrics->>'policy_ev_mae_bb')::numeric;
  v_regret:=(v_metrics->>'mean_action_regret_bb')::numeric;
  v_regret_coverage:=(v_metrics->>'regret_coverage')::numeric;
  v_frequency_observations:=COALESCE((v_metrics->>'frequency_observations')::bigint,0);
  v_sizing_observations:=COALESCE((v_metrics->>'sizing_observations')::bigint,0);
  v_policy_observations:=COALESCE((v_metrics->>'policy_ev_observations')::bigint,0);
  v_regret_observations:=COALESCE((v_metrics->>'regret_observations')::bigint,0);
  v_live_observations:=COALESCE((v_metrics->>'live_combo_observations')::bigint,0);
  v_missing:=COALESCE((v_metrics->>'missing_observations')::bigint,0);
  IF v_missing<>0 OR v_frequency_observations=0 OR v_sizing_observations=0
     OR v_policy_observations=0
     OR v_regret_observations=0 OR v_live_observations=0
     OR v_frequency_mae IS NULL OR v_sizing_mae IS NULL OR v_policy_mae IS NULL
     OR v_regret IS NULL OR v_regret_coverage IS NULL THEN
    RAISE EXCEPTION 'heldout observations are incomplete or absent';
  END IF;
  v_pass:=v_frequency_mae<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
    AND v_sizing_mae<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
    AND v_policy_mae<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
    AND v_regret<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
    AND v_regret_coverage>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric;

  FOREACH v_family IN ARRAY public.fn_gto_v31_required_families(p_dataset_id) LOOP
    v_family_metrics:=public.fn_gto_v31_public215_metrics_from_raw(v_prepared_raw,v_family);
    IF COALESCE((v_family_metrics->>'frequency_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'sizing_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'policy_ev_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'regret_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'missing_observations')::bigint,0)<>0 THEN
      RAISE EXCEPTION 'heldout observations are incomplete for family %',v_family;
    END IF;
    v_family_metrics:=v_family_metrics||jsonb_build_object('validated',
      (v_family_metrics->>'frequency_mae')::numeric<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
      AND (v_family_metrics->>'sizing_mae')::numeric<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
      AND (v_family_metrics->>'policy_ev_mae_bb')::numeric<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
      AND (v_family_metrics->>'mean_action_regret_bb')::numeric<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
      AND (v_family_metrics->>'regret_coverage')::numeric>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric);
    v_pass:=v_pass AND (v_family_metrics->>'validated')::boolean;
    v_by_family:=v_by_family||jsonb_build_object(v_family,v_family_metrics);
  END LOOP;

  v_metrics:=v_metrics||jsonb_build_object('validated',v_pass,'by_family',v_by_family);
  v_metric_checksum:=public.fn_gto_v31_json_checksum(v_metrics);
  v_metrics:=v_metrics||jsonb_build_object('metrics_checksum',v_metric_checksum);

  SELECT jsonb_build_object('cells',count(*),'streets',jsonb_agg(DISTINCT street),
    'families',jsonb_agg(DISTINCT game_family||':'||objective),
    'utility_contexts',jsonb_agg(DISTINCT utility_context),
    'table_sizes',jsonb_agg(DISTINCT table_size),'pot_types',jsonb_agg(DISTINCT pot_type),
    'node_roles',jsonb_agg(DISTINCT node_role),'complete',true)
    INTO v_coverage FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex')
    INTO v_source_checksum FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(v_dataset.dataset_key||':'||v_dataset.pipeline_bundle_checksum||':'||
    v_dataset.manifest_checksum||':'||
    v_dataset.input_bundle_checksum||':'||CASE WHEN v_dataset.feature_contract_version IS NULL THEN '' ELSE v_dataset.feature_contract_version||':' END||CASE WHEN v_dataset.policy_export_schema IS NULL THEN '' ELSE v_dataset.policy_export_schema||':' END||string_agg(cell_key_checksum||':'||
      cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex')
    INTO v_checksum FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;

  IF public.fn_gto_v31_seal_qualification_fingerprint()IS DISTINCT FROM v_qualification THEN RAISE EXCEPTION 'seal validation implementation changed';END IF;
  UPDATE public.gto_v31_datasets SET
    state=CASE WHEN v_pass THEN 'evaluating' ELSE 'rejected' END,
    quality_status=CASE WHEN v_pass THEN 'validated' ELSE 'rejected' END,
    source_rows=v_source,train_source_rows=v_train,holdout_source_rows=v_holdout,
    invalid_rows=0,source_artifact_checksum=v_source_checksum,dataset_checksum=v_checksum,
    coverage=v_coverage,heldout_metrics=v_metrics,sealed_at=now(),audited_at=now()
   WHERE dataset_id=p_dataset_id;
  INSERT INTO public.gto_v31_release_evaluations (
    dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,result_checksum
  ) VALUES (
    p_dataset_id,v_checksum,'heldout','all',CASE WHEN v_pass THEN 'pass' ELSE 'fail' END,
    v_metrics,public.fn_gto_v31_json_checksum(jsonb_build_object(
      'dataset_checksum',v_checksum,'kind','heldout','family','all','metrics',v_metrics))
  );
  RETURN v_checksum;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_selected_complete(d gto_v31_datasets)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE s public.gto_v31_public_selections;actual jsonb;
BEGIN
 SELECT * INTO STRICT s FROM public.gto_v31_public_selections WHERE dataset_id=d.dataset_id AND input_bundle_checksum=d.input_bundle_checksum;
 IF public.fn_gto_v31_public215_digest(s.receipt) IS DISTINCT FROM s.receipt_checksum THEN RETURN false;END IF;
 SELECT jsonb_agg(jsonb_build_object('context_id',public.fn_gto_v31_public215_digest(context),'rank_signature',public.fn_gto_v31_public215_rank_signature(board),'board',board)ORDER BY public.fn_gto_v31_public215_digest(context)COLLATE "C",public.fn_gto_v31_public215_rank_signature(board)COLLATE "C")INTO actual FROM public.gto_v31_public_source_journal WHERE dataset_id=d.dataset_id AND machine_id='M2';
 RETURN actual=s.selected AND jsonb_array_length(actual)=8*jsonb_array_length(d.declared_coverage);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_source_geometry(p_node jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT jsonb_build_object('pot',p_node#>'{line_proof,root_pot_chips}','stack',p_node#>'{line_proof,effective_stack_chips}','bb',p_node#>'{line_proof,chips_per_bb}','root_actor',CASE p_node#>>'{line_proof,hero_solver_player}'WHEN '0'THEN 'OOP'WHEN '1'THEN 'IP'ELSE NULL END,'rake',p_node#>'{complete_public_state,utility,rake}')
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_source_headers_valid(d gto_v31_datasets)
 RETURNS boolean
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
 SELECT NOT EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a LEFT JOIN public.solved_spots_gold s ON s.id=a.source_row_id WHERE a.dataset_id=d.dataset_id AND(s.id IS NULL OR s.quality_status IS DISTINCT FROM 'validated'OR s.audited_at IS NULL OR s.source_artifact_checksum IS DISTINCT FROM a.source_artifact_checksum OR s.machine_id IS DISTINCT FROM a.machine_id OR s.solver_version IS DISTINCT FROM d.solver_version OR s.solver_binary_checksum IS DISTINCT FROM d.solver_binary_checksum OR s.pipeline_commit IS DISTINCT FROM d.pipeline_commit OR s.pipeline_bundle_checksum IS DISTINCT FROM d.pipeline_bundle_checksum OR s.manifest_version::text IS DISTINCT FROM d.manifest_version OR s.manifest_checksum IS DISTINCT FROM d.manifest_checksum))AND NOT EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a LEFT JOIN LATERAL(SELECT count(*)n,min(j.artifact_checksum)lo,max(j.artifact_checksum)hi,min(j.machine_id)machine FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=a.dataset_id AND j.source_row_id=a.source_row_id)x ON true WHERE a.dataset_id=d.dataset_id AND(x.n<>a.node_count OR x.lo IS DISTINCT FROM a.source_artifact_checksum OR x.hi IS DISTINCT FROM a.source_artifact_checksum OR x.machine IS DISTINCT FROM a.machine_id))AND NOT EXISTS(SELECT 1 FROM public.gto_v31_public_source_journal j WHERE j.dataset_id=d.dataset_id AND NOT EXISTS(SELECT 1 FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=j.dataset_id AND a.source_row_id=j.source_row_id))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_sources(p_dataset gto_v31_datasets)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE result jsonb;
BEGIN
 IF public.fn_gto_v31_public215_source_headers_valid(p_dataset)IS NOT TRUE THEN RAISE EXCEPTION 'canonical approved source metadata is missing/quarantined/changed';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('source_row_id',source_row_id,'source_node',source_node,'board',board,'node_checksum',node_checksum,'artifact_checksum',artifact_checksum,'machine_id',machine_id,'context',context)ORDER BY source_row_id::text COLLATE "C",source_node COLLATE "C"),'[]')INTO result FROM public.gto_v31_public_source_journal WHERE dataset_id=p_dataset.dataset_id;RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_template_geometry(p_template jsonb, p_geometry jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
BEGIN
 RETURN COALESCE(p_template->>'root_actor'=p_geometry->>'root_actor'AND public.fn_gto_v31_public215_f64(p_template#>>'{scenario,pot_chips_f64}')=(p_geometry->>'pot')::double precision AND public.fn_gto_v31_public215_f64(p_template#>>'{scenario,effective_stack_chips_f64}')=(p_geometry->>'stack')::double precision AND public.fn_gto_v31_public215_f64(p_template#>>'{scenario,chips_per_bb_f64}')=(p_geometry->>'bb')::double precision AND public.fn_gto_v31_public215_f64(p_template#>>'{scenario,rake_f64,0}')=(p_geometry#>>'{rake,0}')::double precision AND public.fn_gto_v31_public215_f64(p_template#>>'{scenario,rake_f64,1}')=(p_geometry#>>'{rake,1}')::double precision,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_template_valid(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb:=p->'context';s jsonb:=p->'scenario';k text;v jsonb;pot double precision;stack double precision;bb double precision;
BEGIN
 IF NOT public.fn_gto_v31_public215_keys(p,ARRAY['format','context','root_actor','scenario','opponent_weights']) OR p->>'format' IS DISTINCT FROM 'public_hist215_template_v1' OR COALESCE(p->>'root_actor','') NOT IN('IP','OOP') OR NOT public.fn_gto_v31_public215_keys(c,ARRAY['street','game_family','objective','utility_context','table_size','pot_type','hero_position','opponent_position','depth_bucket','texture_class','node_role','facing_kind','facing_size_bucket']) OR NOT public.fn_gto_v31_json_safe_integer(c->'depth_bucket',1,9007199254740991) OR NOT public.fn_gto_v31_json_safe_integer(c->'table_size',2,10) OR COALESCE(c->>'street','') NOT IN('flop','turn','river') OR jsonb_typeof(c->'texture_class') IS DISTINCT FROM 'string' OR length(c->>'texture_class') NOT BETWEEN 1 AND 96 THEN RETURN false;END IF;
 -- Prior labels are fixed in the full approved descriptor; unknown categories cannot become zeros.
 -- Canonical categories present in the frozen f09 prefix.
 FOR k,v IN SELECT key,value FROM jsonb_each(c) WHERE key NOT IN('depth_bucket','table_size','texture_class') LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(v#>>'{}')>96 OR NOT (CASE k
   WHEN 'street' THEN v#>>'{}' IN('flop','turn','river') WHEN 'game_family' THEN v#>>'{}' IN('cash','spin','tourney_ev','tourney_icm') WHEN 'objective' THEN v#>>'{}' IN('cash_ev','chip_ev','icm') WHEN 'utility_context' THEN v#>>'{}' IN('bubble','cash_ev','chip_ev','final_table','in_money','ladder','satellite','spin_ladder') WHEN 'hero_position' THEN v#>>'{}' IN('BB','BTN','SB') WHEN 'opponent_position' THEN v#>>'{}' IN('BB','BTN','SB') WHEN 'node_role' THEN v#>>'{}' IN('all_in','barrel','bet_raise','cbet','check_raise','delayed_cbet','facing_bet','facing_raise','open','probe') WHEN 'pot_type' THEN v#>>'{}' IN('3bet','4bet_plus','limped','srp') WHEN 'facing_kind' THEN v#>>'{}' IN('all_in','bet','none','raise') WHEN 'facing_size_bucket' THEN v#>>'{}' IN('all_in','none','small') ELSE false END) THEN RETURN false;END IF;
 END LOOP;
 IF NOT public.fn_gto_v31_public215_keys(s,ARRAY['pot_chips_f64','effective_stack_chips_f64','chips_per_bb_f64','rake_f64','ip_range_checksum','oop_range_checksum']) OR jsonb_typeof(s->'rake_f64') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'rake_f64')<>2 THEN RETURN false;END IF;
 IF COALESCE(s->>'ip_range_checksum','') NOT IN('01b3d4e721b36cf6d8d89fd4941b5ece0e9fd2853f61d1e5f98fbebb3f8f5228','46a1052fd09045ea14940360740c08c8e45786680fb629b992bd6dd60dbb7448','4e711cfed033f777818cc507b6c54c1963959d325916fad5eeb2903076817dea','53b631c6ee33a42f19c276dceef8e49bff0f5d012f3332200301e8e02a6f2e7f','5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','7297e35f5f97d678bf1c50f2c67f00b676d0da819459b34b566abeb553dfee21') THEN RETURN false;END IF;
 IF COALESCE(s->>'oop_range_checksum','') NOT IN('3ac1e6fa6d92a000680addaf06eab130d2af9467d2e90aceae7cb542b8725c11','4002e2111513d1de3ea6dec8a16bedb436fdd7f9a34ea6f08e2f5e95ee7bba1a','505f32cd9ae2cef66951fcaecc0e8a8fc217ef1d4c0010bc0fe7b57ccf5a417a','5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','6f7f9456008af722359ef4b8d53353c7e3fbdb94412a2d7cc206526cf2857a1b','85a3cb6615c4547abb4e559d5858dfbdc40eb4938abbf14c1bbf564c027b6c7e') THEN RETURN false;END IF;
 pot:=public.fn_gto_v31_public215_f64(s->>'pot_chips_f64');stack:=public.fn_gto_v31_public215_f64(s->>'effective_stack_chips_f64');bb:=public.fn_gto_v31_public215_f64(s->>'chips_per_bb_f64');IF pot<=0 OR stack<=0 OR bb<=0 OR (pot/bb)::text IN('Infinity','NaN') OR (stack/bb)::text IN('Infinity','NaN') OR public.fn_gto_v31_public215_f64(s#>>'{rake_f64,0}')<0 OR public.fn_gto_v31_public215_f64(s#>>'{rake_f64,1}')<0 THEN RETURN false;END IF;
 PERFORM public.fn_gto_v31_public215_normalized_weights(p);PERFORM public.fn_gto_v31_public215_canonical(p);RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_template_valid_for(p jsonb, p_version text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE p_version WHEN 'holdem-public-hist215-v1' THEN public.fn_gto_v31_public215_template_valid(p)
                       WHEN 'holdem-public-hist215-v2' THEN public.fn_gto_v31_public215_template_valid_v2(p) ELSE false END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_template_valid_v2(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE c jsonb:=p->'context';s jsonb:=p->'scenario';k text;v jsonb;pot double precision;stack double precision;bb double precision;
BEGIN
 IF NOT public.fn_gto_v31_public215_keys(p,ARRAY['format','context','root_actor','scenario','opponent_weights']) OR p->>'format' IS DISTINCT FROM 'public_hist215_template_v1' OR COALESCE(p->>'root_actor','') NOT IN('IP','OOP') OR NOT public.fn_gto_v31_public215_keys(c,ARRAY['street','game_family','objective','utility_context','table_size','pot_type','hero_position','opponent_position','depth_bucket','texture_class','node_role','facing_kind','facing_size_bucket']) OR NOT public.fn_gto_v31_json_safe_integer(c->'depth_bucket',1,9007199254740991) OR NOT public.fn_gto_v31_json_safe_integer(c->'table_size',2,10) OR COALESCE(c->>'street','') NOT IN('flop','turn','river') OR jsonb_typeof(c->'texture_class') IS DISTINCT FROM 'string' OR length(c->>'texture_class') NOT BETWEEN 1 AND 96 THEN RETURN false;END IF;
 -- Prior labels are fixed in the full approved descriptor; unknown categories cannot become zeros.
 -- Canonical categories present in the frozen f09 prefix.
 FOR k,v IN SELECT key,value FROM jsonb_each(c) WHERE key NOT IN('depth_bucket','table_size','texture_class') LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(v#>>'{}')>96 OR NOT (CASE k
   WHEN 'street' THEN v#>>'{}' IN('flop','turn','river') WHEN 'game_family' THEN v#>>'{}' IN('cash','spin','tourney_ev','tourney_icm') WHEN 'objective' THEN v#>>'{}' IN('cash_ev','chip_ev','icm') WHEN 'utility_context' THEN v#>>'{}' IN('bubble','cash_ev','chip_ev','final_table','in_money','ladder','satellite','spin_ladder') WHEN 'hero_position' THEN v#>>'{}' IN('BB','BTN','CO','HJ','SB','UTG') WHEN 'opponent_position' THEN v#>>'{}' IN('BB','BTN','CO','HJ','SB','UTG') WHEN 'node_role' THEN v#>>'{}' IN('all_in','barrel','bet_raise','cbet','check_raise','delayed_cbet','facing_bet','facing_raise','open','probe') WHEN 'pot_type' THEN v#>>'{}' IN('3bet','4bet_plus','limped','srp') WHEN 'facing_kind' THEN v#>>'{}' IN('all_in','bet','none','raise') WHEN 'facing_size_bucket' THEN v#>>'{}' IN('all_in','mid','none','small') ELSE false END) THEN RETURN false;END IF;
 END LOOP;
 IF NOT public.fn_gto_v31_public215_keys(s,ARRAY['pot_chips_f64','effective_stack_chips_f64','chips_per_bb_f64','rake_f64','ip_range_checksum','oop_range_checksum']) OR jsonb_typeof(s->'rake_f64') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'rake_f64')<>2 THEN RETURN false;END IF;
 IF COALESCE(s->>'ip_range_checksum','') NOT IN('01b3d4e721b36cf6d8d89fd4941b5ece0e9fd2853f61d1e5f98fbebb3f8f5228','46a1052fd09045ea14940360740c08c8e45786680fb629b992bd6dd60dbb7448','4e711cfed033f777818cc507b6c54c1963959d325916fad5eeb2903076817dea','53b631c6ee33a42f19c276dceef8e49bff0f5d012f3332200301e8e02a6f2e7f','5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','7297e35f5f97d678bf1c50f2c67f00b676d0da819459b34b566abeb553dfee21','1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19','4c4aca48c0b577be5492f05d19eb294557a2cf87103dcf42773db40956b58bad','8094ad2bd7fd8e75d410ec521e9749199cc43986319efd148940aa1e886258b8','8d05309cf40a74905140d9a3c2b857b4aa0917f37c2434e43c95c8227e0a3c12','8e091848a962599d769f99a352a6a1bc7aed2222ede6509f457aa4ac6f44a129','940cbb36f68dfee091837aee988eed475ac6cf0f2b6107373014a6bca47eba3c','b1d304ccba44f89fa02db583045f4e04a6a6a350ddae1ca4e8dc5a4beb20efb1','c8a29032b419bc0f571b511b5c3b4ea5d34f19c07a92660643623102a4d5023c','cfb46e1b5d5e73cfbcfe954cd5e9a774181eb9154b3d1ff23d58de6b08335400','df7c2db33566dd6b1ab17146e5c86e45025159eb9b591efdfd0c403d102b50b0','ebefaf9e605ad69e732d3c29d38c966f229b56437748534ceb9281a318ccd31a') THEN RETURN false;END IF;
 IF COALESCE(s->>'oop_range_checksum','') NOT IN('3ac1e6fa6d92a000680addaf06eab130d2af9467d2e90aceae7cb542b8725c11','4002e2111513d1de3ea6dec8a16bedb436fdd7f9a34ea6f08e2f5e95ee7bba1a','505f32cd9ae2cef66951fcaecc0e8a8fc217ef1d4c0010bc0fe7b57ccf5a417a','5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','6f7f9456008af722359ef4b8d53353c7e3fbdb94412a2d7cc206526cf2857a1b','85a3cb6615c4547abb4e559d5858dfbdc40eb4938abbf14c1bbf564c027b6c7e','22f7c9b7c5cd1a795476f2e5419b1829d6e13bbfe6dd7a682c56f8c6c72a387e','2eb11daeca4ffdaa8dac768fabfb388ed7a7ea0eae4c65e46618c6eda3444e46','45f108f17d60c7ca10db794ef2a2d1a1c354075f8e24e9eb94559baabaaea54b','6f32554c839177cb628055124548b524a033250bcc2d2c2612e8b8885b4bdd46','789b60c1614b66a8e8e9bfb7d457837683fda8aa798a1090564fea928a0c9ef2','8c26e3d32a0944a4f66c3afbf54efe80ac6e24a4cee7eaf8311dc95c54743f65','8e091848a962599d769f99a352a6a1bc7aed2222ede6509f457aa4ac6f44a129','940cbb36f68dfee091837aee988eed475ac6cf0f2b6107373014a6bca47eba3c','a70f8bc53d028a436d875c4374b9b8bb615e7eef33f14676bdb95fc64da0fe81','b342d9978e3f4dc9b96aeb9509cff1501f71bb3480db9f0e74db160241937b13','c8682c9598acfdb2947b0bf029bf812ba1f1c92b40b8fb452c81f28f46f99fed','d94b67df0b44afe07d24d6b9b1b69ab517afc327a3186c1535aebab6a949310c','df7c2db33566dd6b1ab17146e5c86e45025159eb9b591efdfd0c403d102b50b0') THEN RETURN false;END IF;
 pot:=public.fn_gto_v31_public215_f64(s->>'pot_chips_f64');stack:=public.fn_gto_v31_public215_f64(s->>'effective_stack_chips_f64');bb:=public.fn_gto_v31_public215_f64(s->>'chips_per_bb_f64');IF pot<=0 OR stack<=0 OR bb<=0 OR (pot/bb)::text IN('Infinity','NaN') OR (stack/bb)::text IN('Infinity','NaN') OR public.fn_gto_v31_public215_f64(s#>>'{rake_f64,0}')<0 OR public.fn_gto_v31_public215_f64(s#>>'{rake_f64,1}')<0 THEN RETURN false;END IF;
 PERFORM public.fn_gto_v31_public215_normalized_weights(p);PERFORM public.fn_gto_v31_public215_canonical(p);RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_v2_appended(p_template jsonb)
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE appended text[]:=ARRAY['facing_size_bucket=mid','hero_position=CO','hero_position=HJ','hero_position=UTG','iprange=1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19','iprange=4c4aca48c0b577be5492f05d19eb294557a2cf87103dcf42773db40956b58bad','iprange=8094ad2bd7fd8e75d410ec521e9749199cc43986319efd148940aa1e886258b8','iprange=8d05309cf40a74905140d9a3c2b857b4aa0917f37c2434e43c95c8227e0a3c12','iprange=8e091848a962599d769f99a352a6a1bc7aed2222ede6509f457aa4ac6f44a129','iprange=940cbb36f68dfee091837aee988eed475ac6cf0f2b6107373014a6bca47eba3c','iprange=b1d304ccba44f89fa02db583045f4e04a6a6a350ddae1ca4e8dc5a4beb20efb1','iprange=c8a29032b419bc0f571b511b5c3b4ea5d34f19c07a92660643623102a4d5023c','iprange=cfb46e1b5d5e73cfbcfe954cd5e9a774181eb9154b3d1ff23d58de6b08335400','iprange=df7c2db33566dd6b1ab17146e5c86e45025159eb9b591efdfd0c403d102b50b0','iprange=ebefaf9e605ad69e732d3c29d38c966f229b56437748534ceb9281a318ccd31a','ooprange=22f7c9b7c5cd1a795476f2e5419b1829d6e13bbfe6dd7a682c56f8c6c72a387e','ooprange=2eb11daeca4ffdaa8dac768fabfb388ed7a7ea0eae4c65e46618c6eda3444e46','ooprange=45f108f17d60c7ca10db794ef2a2d1a1c354075f8e24e9eb94559baabaaea54b','ooprange=6f32554c839177cb628055124548b524a033250bcc2d2c2612e8b8885b4bdd46','ooprange=789b60c1614b66a8e8e9bfb7d457837683fda8aa798a1090564fea928a0c9ef2','ooprange=8c26e3d32a0944a4f66c3afbf54efe80ac6e24a4cee7eaf8311dc95c54743f65','ooprange=8e091848a962599d769f99a352a6a1bc7aed2222ede6509f457aa4ac6f44a129','ooprange=940cbb36f68dfee091837aee988eed475ac6cf0f2b6107373014a6bca47eba3c','ooprange=a70f8bc53d028a436d875c4374b9b8bb615e7eef33f14676bdb95fc64da0fe81','ooprange=b342d9978e3f4dc9b96aeb9509cff1501f71bb3480db9f0e74db160241937b13','ooprange=c8682c9598acfdb2947b0bf029bf812ba1f1c92b40b8fb452c81f28f46f99fed','ooprange=d94b67df0b44afe07d24d6b9b1b69ab517afc327a3186c1535aebab6a949310c','ooprange=df7c2db33566dd6b1ab17146e5c86e45025159eb9b591efdfd0c403d102b50b0','opponent_position=CO','opponent_position=HJ','opponent_position=UTG'];present text[]:=ARRAY[]::text[];k text;val jsonb;out double precision[]:=ARRAY[]::double precision[];
BEGIN
 -- Feature contract v2 block (indices 215..245): one-hot of the exact public
 -- context category or ROOT range checksum, zero otherwise. Same rule and order
 -- as Club Arena encodePublic215V2Appended / PUBLIC_HIST215_V2_APPENDED.
 FOR k,val IN SELECT key,value FROM jsonb_each(p_template->'context') LOOP IF k NOT IN('texture_class','depth_bucket','table_size') THEN present:=array_append(present,k||'='||(val#>>'{}'));END IF;END LOOP;
 present:=present||ARRAY['iprange='||(p_template#>>'{scenario,ip_range_checksum}'),'ooprange='||(p_template#>>'{scenario,oop_range_checksum}')];
 FOREACH k IN ARRAY appended LOOP out:=array_append(out,CASE WHEN k=ANY(present) THEN 1::double precision ELSE 0::double precision END);END LOOP;
 IF cardinality(out)<>31 THEN RAISE EXCEPTION 'public215 v2 appended shape';END IF;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_quality_gates_valid(p_gates jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_gates IS NULL OR jsonb_typeof(p_gates) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_gates)) <> 5
     OR NOT (p_gates ?& ARRAY[
       'max_frequency_mae','max_sizing_mae','max_policy_ev_mae_bb',
       'max_action_regret_bb','min_regret_coverage'
     ])
     OR EXISTS (
       SELECT 1 FROM jsonb_each(p_gates) gate
        WHERE jsonb_typeof(gate.value) <> 'number'
     ) THEN
    RETURN false;
  END IF;
  RETURN (p_gates->>'max_frequency_mae')::numeric BETWEEN 0 AND 0.15
     AND (p_gates->>'max_sizing_mae')::numeric BETWEEN 0 AND 0.25
     AND (p_gates->>'max_policy_ev_mae_bb')::numeric BETWEEN 0 AND 0.50
     AND (p_gates->>'max_action_regret_bb')::numeric BETWEEN 0 AND 0.25
     AND (p_gates->>'min_regret_coverage')::numeric BETWEEN 0.50 AND 1;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_range_evidence_is_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'V31 range evidence is append-only';
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_range_is_rescale(p_ref double precision[], p_ref_board text, p_obs double precision[], p_obs_board text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
-- One pass over the 1,326 combos that stops at the first support change or
-- ratio outside the tolerance, so a narrowed pair is decided after a few
-- combos and only a true rescale pays for the full pass.
DECLARE
  v_dead boolean[] := array_fill(false, ARRAY[52]); v_board text; k integer; c integer; hi integer; lo integer;
  r double precision; o double precision; q double precision; v_min double precision; v_max double precision;
BEGIN
  IF array_length(p_ref, 1) IS DISTINCT FROM 1326 OR array_length(p_obs, 1) IS DISTINCT FROM 1326 THEN
    RETURN false;
  END IF;
  FOREACH v_board IN ARRAY ARRAY[p_ref_board, p_obs_board] LOOP
    FOR k IN 0 .. length(v_board) / 2 - 1 LOOP
      c := (strpos('23456789TJQKA', substr(v_board, 2 * k + 1, 1)) - 1) * 4 + strpos('cdhs', substr(v_board, 2 * k + 2, 1)) - 1;
      IF c BETWEEN 0 AND 51 THEN v_dead[c + 1] := true; END IF;
    END LOOP;
  END LOOP;
  FOR hi IN 1 .. 51 LOOP
    CONTINUE WHEN v_dead[hi + 1];
    FOR lo IN 0 .. hi - 1 LOOP
      CONTINUE WHEN v_dead[lo + 1];
      r := p_ref[hi * (hi - 1) / 2 + lo + 1];
      o := p_obs[hi * (hi - 1) / 2 + lo + 1];
      IF (r > 0) IS DISTINCT FROM (o > 0) THEN RETURN false; END IF;
      IF r > 0 AND o > 0 THEN
        q := o / r;
        v_min := LEAST(COALESCE(v_min, q), q);
        v_max := GREATEST(COALESCE(v_max, q), q);
        IF v_max > v_min * (1 + 1e-4) THEN RETURN false; END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_min IS NOT NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_record_range_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.gto_v31_round_registrations%ROWTYPE; g record;
  v_nodes jsonb; n jsonb; p jsonb; v_cell jsonb; v_key text; v_label text; v_history jsonb; v_board text;
  v_oop double precision[]; v_ip double precision[]; v_me text; v_oop_group text; v_ip_group text;
BEGIN
  SELECT * INTO r FROM public.gto_v31_round_registrations WHERE dataset_id = NEW.dataset_id FOR UPDATE;
  IF NOT FOUND OR r.cell_provenance IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT s.strategy_matrix_v2->'nodes' INTO v_nodes FROM public.solved_spots_gold s WHERE s.id = NEW.source_row_id;
  IF v_nodes IS NULL OR jsonb_typeof(v_nodes) IS DISTINCT FROM 'array' OR jsonb_array_length(v_nodes) <> NEW.node_count THEN
    RAISE EXCEPTION 'V31 round % source artifact % has no readable source nodes; its range provenance cannot be verified',
      r.round_key, NEW.source_row_id;
  END IF;
  FOR n IN SELECT value FROM jsonb_array_elements(v_nodes) LOOP
    SELECT jsonb_object_agg(k, n->'node_context'->k) INTO v_cell
      FROM unnest(ARRAY['street','game_family','objective','utility_context','table_size','pot_type','hero_position',
                        'opponent_position','depth_bucket','texture_class','node_role','facing_kind','facing_size_bucket']) k;
    v_key := public.fn_gto_v31_public215_canonical(v_cell);
    v_board := n#>>'{node_context,board}';
    SELECT e INTO p FROM jsonb_array_elements(r.cell_provenance) e
     WHERE public.fn_gto_v31_public215_canonical(e->'cell') = v_key;
    IF p IS NULL THEN
      -- Not a registered cell: it cannot become one (the seal compares the built cells with the registration).
      INSERT INTO public.gto_v31_range_evidence(dataset_id, kind, source_row_id, source_node, cell_key, registered, board)
      VALUES (NEW.dataset_id, 'source_node', NEW.source_row_id, n->>'node', v_key, false, COALESCE(v_board,''));
      CONTINUE;
    END IF;
    v_label := format('%s %s %s v %s %s', p#>>'{cell,street}', p#>>'{cell,node_role}', p#>>'{cell,hero_position}',
                      p#>>'{cell,opponent_position}', p#>>'{cell,texture_class}');
    SELECT COALESCE(jsonb_agg(x.step - 'available_actions' ORDER BY x.ord), '[]'::jsonb) INTO v_history
      FROM jsonb_array_elements(p->'public_history') WITH ORDINALITY x(step, ord);
    IF n#>'{complete_public_state,public_history}' IS DISTINCT FROM v_history THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % was solved after public history % but the registration declares %',
        r.round_key, v_label, n->>'node', COALESCE(n#>'{complete_public_state,public_history}','null'::jsonb), v_history;
    END IF;
    IF n#>'{complete_public_state,utility,rake}' IS DISTINCT FROM p#>'{game,rake}' THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % was solved with rake % but the registration declares rake %',
        r.round_key, v_label, n->>'node', COALESCE(n#>'{complete_public_state,utility,rake}','null'::jsonb), p#>'{game,rake}';
    END IF;
    IF n#>>'{line_proof,manifest_checksum}' IS DISTINCT FROM p#>>'{game,betting_tree_checksum}' THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % was solved on betting tree % but the registration declares %',
        r.round_key, v_label, n->>'node', left(COALESCE(n#>>'{line_proof,manifest_checksum}','(none)'),12), left(p#>>'{game,betting_tree_checksum}',12);
    END IF;
    IF n#>'{line_proof,effective_stack_chips}' IS DISTINCT FROM p#>'{game,effective_stack_chips}'
       OR n#>'{line_proof,chips_per_bb}' IS DISTINCT FROM p#>'{game,chips_per_bb}'
       OR n#>'{line_proof,root_pot_chips}' IS DISTINCT FROM p#>'{game,root_pot_chips}'
       OR n#>'{line_proof,hero_solver_player}' IS DISTINCT FROM p#>'{runtime_mapping,hero_solver_player}' THEN
      RAISE EXCEPTION 'V31 round % cell % range provenance mismatch: source node % stack, root pot, chip unit or acting seat (%, %, %, seat %) differs from the registration (%, %, %, seat %)',
        r.round_key, v_label, n->>'node',
        n#>>'{line_proof,effective_stack_chips}', n#>>'{line_proof,root_pot_chips}', n#>>'{line_proof,chips_per_bb}', n#>>'{line_proof,hero_solver_player}',
        p#>>'{game,effective_stack_chips}', p#>>'{game,root_pot_chips}', p#>>'{game,chips_per_bb}', p#>>'{runtime_mapping,hero_solver_player}';
    END IF;
    IF jsonb_typeof(n#>'{solver_ranges,OOP}') IS DISTINCT FROM 'array' OR jsonb_typeof(n#>'{solver_ranges,IP}') IS DISTINCT FROM 'array'
       OR jsonb_array_length(n#>'{solver_ranges,OOP}') <> 1326 OR jsonb_array_length(n#>'{solver_ranges,IP}') <> 1326
       OR v_board IS NULL OR v_board !~ '^([2-9TJQKA][cdhs]){3,5}$' THEN
      RAISE EXCEPTION 'V31 round % cell % source node % carries no exact node ranges (policy export v4 solver_ranges); its range provenance cannot be verified',
        r.round_key, v_label, n->>'node';
    END IF;
    v_oop := ARRAY(SELECT (x.w#>>'{}')::double precision FROM jsonb_array_elements(n#>'{solver_ranges,OOP}') WITH ORDINALITY x(w, ord) ORDER BY x.ord);
    v_ip := ARRAY(SELECT (x.w#>>'{}')::double precision FROM jsonb_array_elements(n#>'{solver_ranges,IP}') WITH ORDINALITY x(w, ord) ORDER BY x.ord);
    v_me := NEW.source_row_id::text || '/' || (n->>'node');
    v_oop_group := NULL;
    v_ip_group := NULL;
    FOR g IN SELECT e.source_row_id, e.source_node, e.board, e.oop_vector, e.ip_vector
               FROM public.gto_v31_range_evidence e
              WHERE e.dataset_id = NEW.dataset_id AND e.cell_key = v_key AND e.kind = 'source_node' AND e.registered
                AND (e.oop_vector IS NOT NULL OR e.ip_vector IS NOT NULL)
              ORDER BY e.evidence_id LOOP
      IF v_oop_group IS NULL AND g.oop_vector IS NOT NULL AND COALESCE(public.fn_gto_v31_range_is_rescale(
           g.oop_vector::double precision[], g.board, v_oop, v_board), false) THEN
        v_oop_group := g.source_row_id::text || '/' || g.source_node;
      END IF;
      IF v_ip_group IS NULL AND g.ip_vector IS NOT NULL AND COALESCE(public.fn_gto_v31_range_is_rescale(
           g.ip_vector::double precision[], g.board, v_ip, v_board), false) THEN
        v_ip_group := g.source_row_id::text || '/' || g.source_node;
      END IF;
      EXIT WHEN v_oop_group IS NOT NULL AND v_ip_group IS NOT NULL;
    END LOOP;
    INSERT INTO public.gto_v31_range_evidence(dataset_id, kind, source_row_id, source_node, cell_key, registered, board,
      oop_group, ip_group, oop_vector, ip_vector)
    VALUES (NEW.dataset_id, 'source_node', NEW.source_row_id, n->>'node', v_key, true, v_board,
      COALESCE(v_oop_group, v_me), COALESCE(v_ip_group, v_me),
      CASE WHEN v_oop_group IS NULL THEN v_oop::real[] END, CASE WHEN v_ip_group IS NULL THEN v_ip::real[] END);
  END LOOP;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_register_dataset(p_dataset jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_machines text[];
  v_gates jsonb := p_dataset->'quality_gates';
  v_bundle public.gto_v31_input_bundles%ROWTYPE;
  v_key text;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p_dataset IS NULL OR jsonb_typeof(p_dataset) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_dataset)) <> (15 + CASE WHEN p_dataset ? 'feature_contract_version' THEN 1 ELSE 0 END + CASE WHEN p_dataset ? 'policy_export_schema' THEN 1 ELSE 0 END)
     OR NOT (p_dataset ?& ARRAY[
       'dataset_key','solver_version','solver_binary_checksum','pipeline_commit',
       'pipeline_bundle_checksum','manifest_version','manifest_checksum',
       'source_combo_order_checksum','range_bundle_checksum','icm_model_checksum',
       'input_bundle_id','input_bundle_checksum','machine_ids','declared_coverage','quality_gates'
     ])
     OR NOT public.fn_gto_v31_feature_request_valid(p_dataset)
     OR NOT public.fn_gto_v31_policy_request_valid(p_dataset)
     OR jsonb_typeof(p_dataset->'machine_ids') <> 'array'
     OR jsonb_array_length(p_dataset->'machine_ids') <> 2
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_dataset->'machine_ids') item(value)
        WHERE jsonb_typeof(item.value) <> 'string'
     )
     OR NOT public.fn_gto_v31_declared_coverage_valid(p_dataset->'declared_coverage')
     OR NOT public.fn_gto_v31_quality_gates_valid(v_gates) THEN
    RAISE EXCEPTION 'invalid certified dataset declaration';
  END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'dataset_key','solver_version','solver_binary_checksum','pipeline_commit',
    'pipeline_bundle_checksum','manifest_version','manifest_checksum',
    'source_combo_order_checksum','range_bundle_checksum','icm_model_checksum',
    'input_bundle_id','input_bundle_checksum'
  ] LOOP
    IF jsonb_typeof(p_dataset->v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid certified dataset declaration';
    END IF;
  END LOOP;

  SELECT array_agg(value ORDER BY value) INTO v_machines
    FROM jsonb_array_elements_text(p_dataset->'machine_ids');
  IF COALESCE(p_dataset->>'dataset_key','') !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
     OR COALESCE(p_dataset->>'solver_version','') = ''
     OR COALESCE(p_dataset->>'solver_binary_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'solver_binary_checksum' = repeat('0',64)
     OR COALESCE(p_dataset->>'pipeline_commit','') !~ '^[0-9a-f]{40}$'
     OR COALESCE(p_dataset->>'pipeline_bundle_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'pipeline_bundle_checksum' = repeat('0',64)
     OR COALESCE(p_dataset->>'manifest_version','') = ''
     OR COALESCE(p_dataset->>'manifest_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'manifest_checksum' = repeat('0',64)
     OR COALESCE(p_dataset->>'source_combo_order_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'source_combo_order_checksum' = repeat('0',64)
     OR COALESCE(p_dataset->>'range_bundle_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'range_bundle_checksum' = repeat('0',64)
     OR COALESCE(p_dataset->>'icm_model_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'icm_model_checksum' = repeat('0',64)
     OR COALESCE(p_dataset->>'input_bundle_id','') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR COALESCE(p_dataset->>'input_bundle_checksum','') !~ '^[0-9a-f]{64}$'
     OR p_dataset->>'input_bundle_checksum' = repeat('0',64)
     OR v_machines IS DISTINCT FROM ARRAY['M1','M2']::text[] THEN
    RAISE EXCEPTION 'invalid certified dataset declaration';
  END IF;

  SELECT * INTO v_bundle FROM public.gto_v31_input_bundles
   WHERE input_bundle_id=(p_dataset->>'input_bundle_id')::uuid
     AND approval_status='approved' FOR SHARE;
  IF NOT FOUND
     OR v_bundle.feature_contract_version IS DISTINCT FROM p_dataset->>'feature_contract_version'
     OR v_bundle.policy_export_schema IS DISTINCT FROM p_dataset->>'policy_export_schema'
     OR v_bundle.bundle_checksum IS DISTINCT FROM p_dataset->>'input_bundle_checksum'
     OR v_bundle.range_bundle_checksum IS DISTINCT FROM p_dataset->>'range_bundle_checksum'
     OR v_bundle.source_combo_order_checksum IS DISTINCT FROM p_dataset->>'source_combo_order_checksum'
     OR v_bundle.icm_model_checksum IS DISTINCT FROM p_dataset->>'icm_model_checksum' THEN
    RAISE EXCEPTION 'dataset inputs are not the currently approved bundle';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_bundle.bundle_manifest->'files') f(value)
     WHERE f.value->>'kind'='scenario_manifest'
       AND f.value->>'checksum'=p_dataset->>'manifest_checksum'
  ) THEN
    RAISE EXCEPTION 'dataset manifest is not in the approved input bundle';
  END IF;

  IF v_bundle.policy_representation='public_hist215_v1' AND(
    public.fn_gto_v31_public215_bundle_valid(v_bundle.bundle_manifest) IS NOT TRUE OR
    public.fn_gto_v31_public215_runtime_protocol_valid(v_bundle.bundle_manifest#>'{public215_protocols,runtime_parity_protocol}',v_bundle.bundle_manifest->'public215_contexts') IS NOT TRUE OR
    (SELECT jsonb_agg(value->'context' ORDER BY public.fn_gto_v31_public215_canonical(value->'context') COLLATE "C")FROM jsonb_array_elements(v_bundle.bundle_manifest->'public215_contexts')) IS DISTINCT FROM
    (SELECT jsonb_agg(value ORDER BY public.fn_gto_v31_public215_canonical(value) COLLATE "C")FROM jsonb_array_elements(p_dataset->'declared_coverage'))
  ) THEN RAISE EXCEPTION 'public215 approved context/protocol census differs';END IF;
  INSERT INTO public.gto_v31_datasets (
    dataset_key, solver_version, solver_binary_checksum, pipeline_commit,
    pipeline_bundle_checksum, manifest_version, manifest_checksum,
    source_combo_order_checksum, range_bundle_checksum, icm_model_checksum,
    input_bundle_id, input_bundle_checksum, machine_ids, declared_coverage, quality_gates, feature_contract_version, policy_export_schema,policy_representation
  ) VALUES (
    p_dataset->>'dataset_key', p_dataset->>'solver_version', p_dataset->>'solver_binary_checksum',
    p_dataset->>'pipeline_commit', p_dataset->>'pipeline_bundle_checksum',
    p_dataset->>'manifest_version', p_dataset->>'manifest_checksum',
    p_dataset->>'source_combo_order_checksum', p_dataset->>'range_bundle_checksum',
    p_dataset->>'icm_model_checksum', (p_dataset->>'input_bundle_id')::uuid,
    p_dataset->>'input_bundle_checksum', v_machines, p_dataset->'declared_coverage', v_gates,p_dataset->>'feature_contract_version',p_dataset->>'policy_export_schema',v_bundle.policy_representation
  ) RETURNING dataset_id INTO v_id;
  RETURN v_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_register_round(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p) k) IS DISTINCT FROM
        ARRAY['acceptance_criteria','candidate','cell_provenance','cell_set_checksum','cells','composition','dataset_key',
              'dataset_provenance','evaluation_plan','owner_authorization','round_key'] THEN
    RAISE EXCEPTION 'a V31 round registration has exactly round_key, dataset_key, composition, cells, cell_set_checksum, cell_provenance, owner_authorization, candidate, dataset_provenance, acceptance_criteria and evaluation_plan';
  END IF;
  INSERT INTO public.gto_v31_round_registrations(round_key, dataset_key, composition, cells, cell_set_checksum,
    cell_provenance, owner_authorization, candidate, dataset_provenance, acceptance_criteria, evaluation_plan)
  VALUES (p->>'round_key', p->>'dataset_key', p->'composition', p->'cells', p->>'cell_set_checksum',
    p->'cell_provenance', p->'owner_authorization', p->'candidate', p->'dataset_provenance', p->'acceptance_criteria',
    p->'evaluation_plan')
  RETURNING registration_id INTO v_id;
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_required_families(p_dataset_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.gto_v31_datasets d
                            WHERE d.dataset_id=p_dataset_id
                              AND d.evaluation_contract='gto_v31_candidate.v3')
              THEN public.fn_gto_v31_v3_families(p_dataset_id)
              ELSE ARRAY['cash','spin','tourney_ev','tourney_icm']::text[] END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_round_registration_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE k text;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'a V31 round registration is permanent';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['dataset_id','heldout_consumed_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['dataset_id','heldout_consumed_at'])
       OR (OLD.dataset_id IS NOT NULL AND NEW.dataset_id IS DISTINCT FROM OLD.dataset_id)
       OR (OLD.heldout_consumed_at IS NOT NULL AND NEW.heldout_consumed_at IS DISTINCT FROM OLD.heldout_consumed_at)
       OR (NEW.heldout_consumed_at IS NOT NULL AND NEW.dataset_id IS NULL) THEN
      RAISE EXCEPTION 'a V31 round registration is immutable; only its dataset link and held-out consumption are stamped, once each';
    END IF;
    RETURN NEW;
  END IF;
  -- INSERT
  IF NEW.dataset_id IS NOT NULL OR NEW.heldout_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a V31 round is registered before its dataset exists';
  END IF;
  -- Cell contract v3 (20261113 B5): a registration whose cells declare
  -- cell_contract is a v3 registration and every cell must be a valid v3
  -- context. Any other registration takes the unchanged v2 check below.
  IF jsonb_typeof(NEW.cells) = 'array' AND jsonb_array_length(NEW.cells) >= 1
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.cells) e
                  WHERE jsonb_typeof(e) = 'object' AND e ? 'cell_contract') THEN
    SELECT public.fn_gto_v31_cell_contract_v3_error(e) INTO k
      FROM jsonb_array_elements(NEW.cells) e
     WHERE public.fn_gto_v31_cell_contract_v3_error(e) IS NOT NULL LIMIT 1;
    IF k IS NOT NULL
       OR (SELECT count(DISTINCT public.fn_gto_v31_public215_canonical(e)) FROM jsonb_array_elements(NEW.cells) e)
          <> jsonb_array_length(NEW.cells) THEN
      RAISE EXCEPTION 'registered cells must be distinct V31 cell contract v3 contexts; one registration is all v2 or all v3: %',
        COALESCE(k, 'a cell repeats');
    END IF;
  ELSIF jsonb_typeof(NEW.cells) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.cells) < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.cells) e
                 WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
                    OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(e) x) IS DISTINCT FROM
                       ARRAY['depth_bucket','facing_kind','facing_size_bucket','game_family','hero_position',
                             'node_role','objective','opponent_position','pot_type','street','table_size',
                             'texture_class','utility_context']
                    OR e->>'street' NOT IN ('flop','turn','river'))
     OR (SELECT count(DISTINCT public.fn_gto_v31_public215_canonical(e)) FROM jsonb_array_elements(NEW.cells) e)
        <> jsonb_array_length(NEW.cells) THEN
    RAISE EXCEPTION 'registered cells must be distinct V31 cell contexts with the 13 context keys';
  END IF;
  IF NEW.composition IS DISTINCT FROM public.fn_gto_v31_cell_composition(NEW.cells) THEN
    RAISE EXCEPTION 'registered composition % is not the composition of the registered cells (%)',
      NEW.composition, public.fn_gto_v31_cell_composition(NEW.cells);
  END IF;
  IF NEW.cell_set_checksum IS DISTINCT FROM public.fn_gto_v31_cell_set_checksum(NEW.cells) THEN
    RAISE EXCEPTION 'registered cell-set checksum does not hash the registered cells';
  END IF;
  FOREACH k IN ARRAY ARRAY['approved_by','approved_at','source','quote'] LOOP
    IF jsonb_typeof(NEW.owner_authorization->k) IS DISTINCT FROM 'string' OR btrim(NEW.owner_authorization->>k) = '' THEN
      RAISE EXCEPTION 'owner_authorization needs approved_by, approved_at, source and quote';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['summary','changes','diagnosis'] LOOP
    IF NEW.candidate->k IS NULL OR NEW.candidate->k = 'null'::jsonb THEN
      RAISE EXCEPTION 'candidate needs summary, changes and diagnosis';
    END IF;
  END LOOP;
  -- eligibility_checksum: the board-capacity census the plan was selected
  -- under. R8's approved 70/23/7 had none and could not be built.
  FOREACH k IN ARRAY ARRAY['plan_checksum','eligibility_checksum','pipeline_commit','board_recipe','ranges'] LOOP
    IF NEW.dataset_provenance->k IS NULL OR NEW.dataset_provenance->k = 'null'::jsonb THEN
      RAISE EXCEPTION 'dataset_provenance needs plan_checksum, eligibility_checksum, pipeline_commit, board_recipe and ranges';
    END IF;
  END LOOP;
  IF NOT public.fn_gto_v31_quality_gates_valid(NEW.acceptance_criteria->'quality_gates') THEN
    RAISE EXCEPTION 'acceptance_criteria.quality_gates must be valid V31 quality gates';
  END IF;
  -- The programme's standing thresholds (every round since R4) are a floor:
  -- a registration may tighten them, never loosen them.
  IF (NEW.acceptance_criteria#>>'{quality_gates,max_frequency_mae}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,max_sizing_mae}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,max_policy_ev_mae_bb}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,max_action_regret_bb}')::numeric > 0.05
     OR (NEW.acceptance_criteria#>>'{quality_gates,min_regret_coverage}')::numeric < 0.95 THEN
    RAISE EXCEPTION 'a registration may not loosen the V31 quality thresholds (0.05 frequency, sizing, policy EV and regret; 0.95 regret coverage)';
  END IF;
  IF jsonb_typeof(NEW.evaluation_plan->'heldout_consumptions') IS DISTINCT FROM 'number'
     OR (NEW.evaluation_plan->>'heldout_consumptions') <> '1'
     OR NEW.evaluation_plan->'steps' IS NULL THEN
    RAISE EXCEPTION 'evaluation_plan must consume the held-out set exactly once and list its steps';
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_round_registration_provenance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_error text;
BEGIN
  v_error := public.fn_gto_v31_cell_provenance_error(NEW.cells, NEW.cell_provenance);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'V31 round % cannot be registered: %', NEW.round_key, v_error;
  END IF;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_runtime_cell_context(c gto_v31_runtime_cells)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'street',c.street,'game_family',c.game_family,'objective',c.objective,
    'utility_context',c.utility_context,'table_size',c.table_size,'pot_type',c.pot_type,
    'hero_position',c.hero_position,'opponent_position',c.opponent_position,
    'depth_bucket',c.depth_bucket,'texture_class',c.texture_class,'node_role',c.node_role,
    'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_build(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
BEGIN
 IF COALESCE(auth.role(),'')<>'service_role'AND current_user NOT IN('postgres','supabase_admin')THEN RAISE EXCEPTION 'service_role required';END IF;
 IF EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1')THEN
  RETURN public.fn_gto_v31_public215_seal_prepared(p_dataset_id);
 END IF;
 RETURN public.fn_gto_v31_seal_build_legacy_v31(p_dataset_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_build_legacy_v31(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET statement_timeout TO '240s'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_cells bigint;
  v_source bigint;
  v_train bigint;
  v_holdout bigint;
  v_source_nodes bigint;
  v_receipts bigint;
  v_checksum text;
  v_source_checksum text;
  v_coverage jsonb;
  v_metrics jsonb;
  v_metric_checksum text;
  v_frequency_mae numeric;
  v_sizing_mae numeric;
  v_policy_mae numeric;
  v_regret numeric;
  v_regret_coverage numeric;
  v_frequency_observations bigint;
  v_sizing_observations bigint;
  v_policy_observations bigint;
  v_regret_observations bigint;
  v_live_observations bigint;
  v_missing bigint;
  v_pass boolean;
  v_family text;
  v_family_metrics jsonb;
  v_by_family jsonb := '{}'::jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='building' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND (c.feature_contract_version IS DISTINCT FROM v_dataset.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM v_dataset.policy_export_schema)) THEN RAISE EXCEPTION 'cell feature version differs from dataset'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not building'; END IF;
  IF v_dataset.policy_representation='public_hist215_v1' THEN
    PERFORM c.cell_id FROM public.gto_v31_runtime_cells c
      WHERE c.dataset_id=p_dataset_id ORDER BY c.cell_key_checksum FOR SHARE;
  END IF;
  IF public.fn_gto_v31_public215_dataset_models_valid(v_dataset) IS NOT TRUE THEN RAISE EXCEPTION 'numeric model set/source authority/SQL implementation differs from immutable dataset';END IF;
  PERFORM public.fn_gto_v31_assert_source_contract(n.value,v_dataset.policy_export_schema,v_dataset.icm_model_checksum)
    FROM public.gto_v31_source_artifacts a
    JOIN public.solved_spots_gold s ON s.id=a.source_row_id
    CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
   WHERE a.dataset_id=p_dataset_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.gto_v31_input_bundles b
     WHERE b.input_bundle_id=v_dataset.input_bundle_id
       AND b.approval_status='approved' AND b.bundle_checksum=v_dataset.input_bundle_checksum
       AND b.feature_contract_version IS NOT DISTINCT FROM v_dataset.feature_contract_version
       AND b.range_bundle_checksum=v_dataset.range_bundle_checksum
       AND b.source_combo_order_checksum=v_dataset.source_combo_order_checksum
       AND b.icm_model_checksum=v_dataset.icm_model_checksum
  ) THEN RAISE EXCEPTION 'dataset input approval is absent or revoked'; END IF;

  SELECT count(*),COALESCE(sum(source_rows),0),COALESCE(sum(train_source_rows),0),
         COALESCE(sum(holdout_source_rows),0)
    INTO v_cells,v_source,v_train,v_holdout
    FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  IF v_cells=0 OR jsonb_array_length(v_dataset.declared_coverage)<>v_cells
     OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(v_dataset.declared_coverage))<>v_cells
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_runtime_cells c
        WHERE c.dataset_id=p_dataset_id AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
           WHERE d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket)))
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_dataset.declared_coverage) d(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id
           AND d.value=jsonb_build_object(
             'street',c.street,'game_family',c.game_family,'objective',c.objective,
             'utility_context',c.utility_context,'table_size',c.table_size,
             'pot_type',c.pot_type,'hero_position',c.hero_position,
             'opponent_position',c.opponent_position,'depth_bucket',c.depth_bucket,
             'texture_class',c.texture_class,'node_role',c.node_role,
             'facing_kind',c.facing_kind,'facing_size_bucket',c.facing_size_bucket))) THEN
    RAISE EXCEPTION 'runtime cells do not exactly equal declared coverage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='flop')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='turn')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND street='river')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='cash' AND objective='cash_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='spin' AND objective='icm')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_ev' AND objective='chip_ev')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id AND game_family='tourney_icm' AND objective='icm')
     OR EXISTS (
       SELECT 1
         FROM (VALUES ('cash','cash_ev'),('spin','chip_ev'),('spin','icm'),
                      ('tourney_ev','chip_ev'),('tourney_icm','icm'))
              required_family(game_family,objective)
         CROSS JOIN unnest(ARRAY['flop','turn','river']) required_street(street)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_runtime_cells c
           WHERE c.dataset_id=p_dataset_id
             AND c.game_family=required_family.game_family
             AND c.objective=required_family.objective
             AND c.street=required_street.street))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['limped','srp','3bet','4bet_plus']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.pot_type=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cash_ev','chip_ev','spin_ladder','satellite','bubble','final_table','in_money','ladder']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.utility_context=required.value))
     OR EXISTS (SELECT 1 FROM generate_series(2,10) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.table_size=required.value))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel','facing_bet','facing_raise','check_raise','bet_raise','all_in']) required(value)
       WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND c.node_role=required.value)) THEN
    RAISE EXCEPTION 'required Phase 4 street, family, utility, table, pot, or response coverage is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
     WHERE c.dataset_id=p_dataset_id
       AND (c.cell_key_checksum<>public.fn_gto_v31_cell_key_checksum(to_jsonb(c))
         OR c.cell_payload_checksum<>public.fn_gto_v31_cell_payload_checksum(to_jsonb(c))
         OR c.source_rows<>c.train_source_rows+c.holdout_source_rows
         OR CASE WHEN v_dataset.policy_representation='public_hist215_v1' THEN false
                 ELSE NOT public.fn_gto_v31_cell_payload_valid(to_jsonb(c)) END)
  ) THEN RAISE EXCEPTION 'a compact cell seal or payload no longer validates'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.gto_v31_runtime_cells c
    LEFT JOIN LATERAL (
      SELECT count(*) n,count(*) FILTER (WHERE r.split='train') train_n,
             count(*) FILTER (WHERE r.split='holdout') holdout_n,
             encode(digest(string_agg(r.source_row_id::text||':'||r.source_node||':'||
               r.source_node_checksum,'' ORDER BY r.source_row_id::text,r.source_node),'sha256'),'hex') lineage
        FROM public.gto_v31_cell_source_receipts r WHERE r.cell_id=c.cell_id
    ) x ON true
     WHERE c.dataset_id=p_dataset_id AND
       (x.n<>c.source_rows OR x.train_n<>c.train_source_rows OR x.holdout_n<>c.holdout_source_rows
        OR x.lineage IS DISTINCT FROM c.lineage_checksum)
  ) THEN RAISE EXCEPTION 'cell source receipts do not reconcile'; END IF;
  SELECT COALESCE(sum(node_count),0) INTO v_source_nodes
    FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT count(*) INTO v_receipts FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id;
  IF v_source_nodes<>v_receipts OR v_source<>v_receipts
     OR EXISTS (
       SELECT 1 FROM public.gto_v31_source_artifacts a
       LEFT JOIN public.solved_spots_gold s ON s.id=a.source_row_id
        WHERE a.dataset_id=p_dataset_id AND (s.id IS NULL OR s.quality_status<>'validated'
          OR s.audited_at IS NULL OR s.source_artifact_checksum<>a.source_artifact_checksum
          OR s.source_artifact_checksum<>public.fn_gto_v31_source_artifact_checksum(s.scenario_hash,s.strategy_matrix_v2)
          OR s.solver_version<>v_dataset.solver_version
          OR s.solver_binary_checksum<>v_dataset.solver_binary_checksum
          OR s.machine_id<>a.machine_id OR s.pipeline_commit<>v_dataset.pipeline_commit
          OR s.pipeline_bundle_checksum<>v_dataset.pipeline_bundle_checksum
          OR s.manifest_version::text<>v_dataset.manifest_version
          OR s.manifest_checksum<>v_dataset.manifest_checksum)) THEN
    RAISE EXCEPTION 'source artifacts are missing, omitted, quarantined, or changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M1')
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_cell_source_receipts WHERE dataset_id=p_dataset_id AND machine_id='M2') THEN
    RAISE EXCEPTION 'dataset provenance does not include both solver hosts';
  END IF;

  v_metrics:=public.fn_gto_v31_heldout_metrics(p_dataset_id,NULL);
  v_frequency_mae:=(v_metrics->>'frequency_mae')::numeric;
  v_sizing_mae:=(v_metrics->>'sizing_mae')::numeric;
  v_policy_mae:=(v_metrics->>'policy_ev_mae_bb')::numeric;
  v_regret:=(v_metrics->>'mean_action_regret_bb')::numeric;
  v_regret_coverage:=(v_metrics->>'regret_coverage')::numeric;
  v_frequency_observations:=COALESCE((v_metrics->>'frequency_observations')::bigint,0);
  v_sizing_observations:=COALESCE((v_metrics->>'sizing_observations')::bigint,0);
  v_policy_observations:=COALESCE((v_metrics->>'policy_ev_observations')::bigint,0);
  v_regret_observations:=COALESCE((v_metrics->>'regret_observations')::bigint,0);
  v_live_observations:=COALESCE((v_metrics->>'live_combo_observations')::bigint,0);
  v_missing:=COALESCE((v_metrics->>'missing_observations')::bigint,0);
  IF v_missing<>0 OR v_frequency_observations=0 OR v_sizing_observations=0
     OR v_policy_observations=0
     OR v_regret_observations=0 OR v_live_observations=0
     OR v_frequency_mae IS NULL OR v_sizing_mae IS NULL OR v_policy_mae IS NULL
     OR v_regret IS NULL OR v_regret_coverage IS NULL THEN
    RAISE EXCEPTION 'heldout observations are incomplete or absent';
  END IF;
  v_pass:=v_frequency_mae<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
    AND v_sizing_mae<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
    AND v_policy_mae<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
    AND v_regret<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
    AND v_regret_coverage>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric;

  FOREACH v_family IN ARRAY ARRAY['cash','spin','tourney_ev','tourney_icm'] LOOP
    v_family_metrics:=public.fn_gto_v31_heldout_metrics(p_dataset_id,v_family);
    IF COALESCE((v_family_metrics->>'frequency_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'sizing_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'policy_ev_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'regret_observations')::bigint,0)=0
       OR COALESCE((v_family_metrics->>'missing_observations')::bigint,0)<>0 THEN
      RAISE EXCEPTION 'heldout observations are incomplete for family %',v_family;
    END IF;
    v_family_metrics:=v_family_metrics||jsonb_build_object('validated',
      (v_family_metrics->>'frequency_mae')::numeric<=(v_dataset.quality_gates->>'max_frequency_mae')::numeric
      AND (v_family_metrics->>'sizing_mae')::numeric<=(v_dataset.quality_gates->>'max_sizing_mae')::numeric
      AND (v_family_metrics->>'policy_ev_mae_bb')::numeric<=(v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
      AND (v_family_metrics->>'mean_action_regret_bb')::numeric<=(v_dataset.quality_gates->>'max_action_regret_bb')::numeric
      AND (v_family_metrics->>'regret_coverage')::numeric>=(v_dataset.quality_gates->>'min_regret_coverage')::numeric);
    v_pass:=v_pass AND (v_family_metrics->>'validated')::boolean;
    v_by_family:=v_by_family||jsonb_build_object(v_family,v_family_metrics);
  END LOOP;

  v_metrics:=v_metrics||jsonb_build_object('validated',v_pass,'by_family',v_by_family);
  v_metric_checksum:=public.fn_gto_v31_json_checksum(v_metrics);
  v_metrics:=v_metrics||jsonb_build_object('metrics_checksum',v_metric_checksum);

  SELECT jsonb_build_object('cells',count(*),'streets',jsonb_agg(DISTINCT street),
    'families',jsonb_agg(DISTINCT game_family||':'||objective),
    'utility_contexts',jsonb_agg(DISTINCT utility_context),
    'table_sizes',jsonb_agg(DISTINCT table_size),'pot_types',jsonb_agg(DISTINCT pot_type),
    'node_roles',jsonb_agg(DISTINCT node_role),'complete',true)
    INTO v_coverage FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex')
    INTO v_source_checksum FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(v_dataset.dataset_key||':'||v_dataset.pipeline_bundle_checksum||':'||
    v_dataset.manifest_checksum||':'||
    v_dataset.input_bundle_checksum||':'||CASE WHEN v_dataset.feature_contract_version IS NULL THEN '' ELSE v_dataset.feature_contract_version||':' END||CASE WHEN v_dataset.policy_export_schema IS NULL THEN '' ELSE v_dataset.policy_export_schema||':' END||string_agg(cell_key_checksum||':'||
      cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex')
    INTO v_checksum FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;

  UPDATE public.gto_v31_datasets SET
    state=CASE WHEN v_pass THEN 'evaluating' ELSE 'rejected' END,
    quality_status=CASE WHEN v_pass THEN 'validated' ELSE 'rejected' END,
    source_rows=v_source,train_source_rows=v_train,holdout_source_rows=v_holdout,
    invalid_rows=0,source_artifact_checksum=v_source_checksum,dataset_checksum=v_checksum,
    coverage=v_coverage,heldout_metrics=v_metrics,sealed_at=now(),audited_at=now()
   WHERE dataset_id=p_dataset_id;
  INSERT INTO public.gto_v31_release_evaluations (
    dataset_id,dataset_checksum,evaluation_kind,game_family,verdict,metrics,result_checksum
  ) VALUES (
    p_dataset_id,v_checksum,'heldout','all',CASE WHEN v_pass THEN 'pass' ELSE 'fail' END,
    v_metrics,public.fn_gto_v31_json_checksum(jsonb_build_object(
      'dataset_checksum',v_checksum,'kind','heldout','family','all','metrics',v_metrics))
  );
  RETURN v_checksum;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_dataset_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
 PERFORM d.dataset_id FROM public.gto_v31_datasets d WHERE d.dataset_id=NEW.dataset_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'seal input dataset is absent';END IF;RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_matches_range_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.gto_v31_round_registrations%ROWTYPE; p jsonb; u jsonb; v_key text; v_label text; v_rc text; v_seat_name text;
  v_nodes bigint; v_evidence bigint; v_n bigint; v_share numeric[]; v_real boolean[]; v_seat integer;
  v_max_oop bigint; v_max_ip bigint;
BEGIN
  IF OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.gto_v31_round_registrations WHERE dataset_id = NEW.dataset_id;
  IF NOT FOUND THEN
    RETURN NEW;  -- gto_v31_seal_matches_registration refuses an unregistered dataset
  END IF;
  IF r.cell_provenance IS NULL THEN
    RAISE EXCEPTION 'V31 round % has no range provenance and cannot be sealed; the held-out set is not consumed', r.round_key;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.cell_provenance) e
              WHERE e#>>'{game,betting_tree_checksum}' IS DISTINCT FROM NEW.manifest_checksum) THEN
    RAISE EXCEPTION 'V31 round % range provenance mismatch at seal: the registered betting tree is not the dataset manifest %; the held-out set is not consumed',
      r.round_key, left(NEW.manifest_checksum,12);
  END IF;
  SELECT COALESCE(sum(a.node_count),0) INTO v_nodes FROM public.gto_v31_source_artifacts a WHERE a.dataset_id = NEW.dataset_id;
  SELECT count(*) INTO v_evidence FROM public.gto_v31_range_evidence e WHERE e.dataset_id = NEW.dataset_id AND e.kind = 'source_node';
  IF v_nodes <> v_evidence THEN
    RAISE EXCEPTION 'V31 round % range evidence is incomplete at seal: % source nodes ingested, % with range evidence; the held-out set is not consumed',
      r.round_key, v_nodes, v_evidence;
  END IF;
  FOR p IN SELECT value FROM jsonb_array_elements(r.cell_provenance) LOOP
    v_key := public.fn_gto_v31_public215_canonical(p->'cell');
    v_rc := p->>'range_construction';
    v_label := format('%s %s %s v %s %s', p#>>'{cell,street}', p#>>'{cell,node_role}', p#>>'{cell,hero_position}',
                      p#>>'{cell,opponent_position}', p#>>'{cell,texture_class}');
    -- The runtime mapping names a runtime cell this dataset actually built.
    IF NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
                    WHERE c.dataset_id = NEW.dataset_id
                      AND public.fn_gto_v31_runtime_cell_context(c) - 'texture_class'
                          = (p->'runtime_mapping') - 'hero_solver_player' - 'solver_positions'
                      AND to_jsonb(c.texture_class) = p#>'{cell,texture_class}') THEN
      RAISE EXCEPTION 'V31 round % cell % runtime mapping names no runtime cell of this dataset at seal (street, role, facing, positions, depth and game keys must be the built cell''s); the held-out set is not consumed',
        r.round_key, v_label;
    END IF;
    SELECT count(*) INTO v_n FROM public.gto_v31_range_evidence e
     WHERE e.dataset_id = NEW.dataset_id AND e.cell_key = v_key AND e.kind = 'source_node' AND e.registered;
    IF v_n < 2 THEN
      RAISE EXCEPTION 'V31 round % cell % has % source node(s) with range evidence: a range construction cannot be verified on fewer than two source boards; the held-out set is not consumed',
        r.round_key, v_label, v_n;
    END IF;
    -- Rescale share per player: the largest scale group over the boards; a
    -- group of one board is no rescale of anything, so share 0 then.
    SELECT max(cnt) INTO v_max_oop FROM (SELECT count(*) cnt FROM public.gto_v31_range_evidence e
      WHERE e.dataset_id = NEW.dataset_id AND e.cell_key = v_key AND e.kind = 'source_node' AND e.registered GROUP BY e.oop_group) x;
    SELECT max(cnt) INTO v_max_ip FROM (SELECT count(*) cnt FROM public.gto_v31_range_evidence e
      WHERE e.dataset_id = NEW.dataset_id AND e.cell_key = v_key AND e.kind = 'source_node' AND e.registered GROUP BY e.ip_group) x;
    v_share := ARRAY[CASE WHEN v_max_oop >= 2 THEN round(v_max_oop::numeric / v_n, 4) ELSE 0 END,
                     CASE WHEN v_max_ip >= 2 THEN round(v_max_ip::numeric / v_n, 4) ELSE 0 END];
    IF v_rc = 'root' THEN
      IF v_max_oop <> v_n OR v_max_ip <> v_n THEN
        RAISE EXCEPTION 'V31 round % cell % range provenance mismatch at seal: declared "root" but its source nodes carry narrowed ranges (rescale share OOP %, IP %; root requires 1 for both); the held-out set is not consumed',
          r.round_key, v_label, v_share[1], v_share[2];
      END IF;
      CONTINUE;
    END IF;
    SELECT ARRAY[COALESCE(bool_or(s->>'solver_player' = '0' AND (s->>'available_actions')::integer >= 2), false),
                 COALESCE(bool_or(s->>'solver_player' = '1' AND (s->>'available_actions')::integer >= 2), false)]
      INTO v_real FROM jsonb_array_elements(p->'public_history') s;
    FOR v_seat IN 0..1 LOOP
      CONTINUE WHEN NOT v_real[v_seat + 1];
      v_seat_name := CASE v_seat WHEN 0 THEN 'OOP' ELSE 'IP' END;
      SELECT x INTO u FROM jsonb_array_elements(p->'unnarrowed_seats') x WHERE x->>'seat' = v_seat_name;
      IF u IS NOT NULL THEN
        IF v_share[v_seat + 1] < 0.90 THEN
          RAISE EXCEPTION 'V31 round % cell % range provenance mismatch at seal: % is declared unnarrowed by a pure prior action, but only % of its % source boards (share %) hold one rescaled range; a declared pure action needs at least 0.90; the held-out set is not consumed',
            r.round_key, v_label, v_seat_name, CASE v_seat WHEN 0 THEN v_max_oop ELSE v_max_ip END, v_n, v_share[v_seat + 1];
        END IF;
        -- upstream_evidence_checksum is recorded, not verified (no table here holds that evidence).
        INSERT INTO public.gto_v31_range_evidence(dataset_id, kind, cell_key, registered, attested_seat, attested_reason,
          upstream_evidence_checksum, rescale_share)
        VALUES (NEW.dataset_id, 'unnarrowed_attestation', v_key, true, v_seat_name, u->>'reason',
          u->>'upstream_evidence_checksum', v_share[v_seat + 1]);
      ELSIF v_share[v_seat + 1] > 0.10 THEN
        RAISE EXCEPTION 'V31 round % cell % range provenance mismatch at seal: declared "%" after a real decision by %, but % holds a constant rescale of one range on % of % source boards (share %, refused above 0.10). That is the forced-line signature (conditional_history, authored_range_preserving_response), not an action-conditioned range; a seat that truly took one action with every hand must be declared in unnarrowed_seats; the held-out set is not consumed',
          r.round_key, v_label, v_rc, v_seat_name, v_seat_name, CASE v_seat WHEN 0 THEN v_max_oop ELSE v_max_ip END, v_n, v_share[v_seat + 1];
      END IF;
      u := NULL;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_matches_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r public.gto_v31_round_registrations%ROWTYPE; v_cells jsonb; v_comp jsonb;
BEGIN
  IF OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS NULL THEN
    IF OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
      RAISE EXCEPTION 'V31 dataset % is already sealed; its held-out set was consumed', OLD.dataset_key;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.gto_v31_round_registrations
   WHERE dataset_id = NEW.dataset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'V31 dataset % has no round registration and cannot consume a held-out set', NEW.dataset_key;
  END IF;
  IF r.heldout_consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'V31 round % already consumed its held-out set at %', r.round_key, r.heldout_consumed_at;
  END IF;
  SELECT COALESCE(jsonb_agg(public.fn_gto_v31_runtime_cell_context(c)), '[]'::jsonb) INTO v_cells
    FROM public.gto_v31_runtime_cells c WHERE c.dataset_id = NEW.dataset_id;
  v_comp := public.fn_gto_v31_cell_composition(v_cells);
  IF public.fn_gto_v31_cell_set_checksum(v_cells) IS DISTINCT FROM r.cell_set_checksum
     OR jsonb_array_length(v_cells) <> jsonb_array_length(r.cells) THEN
    RAISE EXCEPTION 'V31 round % built cells differ from its registration at seal: registered % (% cells), built % (% cells); the held-out set is not consumed',
      r.round_key, public.fn_gto_v31_composition_text(r.composition), jsonb_array_length(r.cells),
      public.fn_gto_v31_composition_text(v_comp), jsonb_array_length(v_cells);
  END IF;
  IF NEW.quality_gates IS DISTINCT FROM r.acceptance_criteria->'quality_gates' THEN
    RAISE EXCEPTION 'V31 round % seal gates differ from its registered acceptance criteria', r.round_key;
  END IF;
  UPDATE public.gto_v31_round_registrations SET heldout_consumed_at = NEW.sealed_at
   WHERE registration_id = r.registration_id;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_preparation_guards()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE r record;fk oid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'bounded sealing requires read committed';END IF;
 FOR r IN SELECT * FROM(VALUES
 ('solved_spots_gold','gto_v31_seal_gold_revision','fn_gto_v31_seal_revision_changed'),('gto_v31_input_bundles','gto_v31_seal_bundle_revision','fn_gto_v31_seal_revision_changed'),
 ('gto_v31_runtime_cells','gto_v31_public215_cell_immutable','fn_gto_v31_public215_cell_immutable'),('gto_v31_model_preparations','gto_v31_model_preparations_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_model_freezes','gto_v31_model_freezes_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_source_journal','gto_v31_public_source_journal_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_public_selections','gto_v31_public_selections_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_model_audits','gto_v31_public_model_audits_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_public_model_audit_combos','gto_v31_public_model_audit_combos_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_physics','gto_v31_public_physics_immutable','fn_gto_v31_public215_immutable_physics'),('gto_v31_public_model_compiled','gto_v31_public_model_compiled_immutable','fn_gto_v31_public215_immutable_physics'),
 ('gto_v31_public_model_audit_combos','gto_v31_seal_audit_append_guard','fn_gto_v31_seal_audit_append_guard'),('gto_v31_seal_cell_preparations','gto_v31_seal_preparation_immutable','fn_gto_v31_public215_immutable_physics'))v(relation,trigger_name,function_name)
 LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=('public.'||r.relation)::regclass AND t.tgname=r.trigger_name AND t.tgenabled IN('O','A') AND t.tgtype=CASE WHEN r.trigger_name IN('gto_v31_seal_gold_revision','gto_v31_seal_bundle_revision')THEN 29 WHEN r.trigger_name='gto_v31_seal_audit_append_guard'THEN 7 ELSE 27 END AND t.tgqual IS NULL AND t.tgattr::text='' AND p.proname=r.function_name AND p.pronamespace='public'::regnamespace)THEN RAISE EXCEPTION 'bounded seal mutation guard missing';END IF;
 END LOOP;
 IF(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_gto_v31_public215_cell_immutable()'::regprocedure)<>'3f134c10be911c591966e47ce71c1857'
 OR(SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_gto_v31_public215_immutable_physics()'::regprocedure)<>'3e077e1da2805175f53325ca4487feee' THEN RAISE EXCEPTION 'bounded seal immutable owners changed';END IF;
 FOR r IN SELECT unnest(ARRAY['gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts'])name LOOP
  SELECT c.oid INTO STRICT fk FROM pg_constraint c WHERE c.conrelid=('public.'||r.name)::regclass AND c.confrelid='public.gto_v31_datasets'::regclass AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND NOT c.condeferred;
  IF(SELECT count(*)=4 AND bool_and(tgenabled IN('O','A'))FROM pg_trigger WHERE tgconstraint=fk)IS NOT TRUE THEN RAISE EXCEPTION 'bounded seal dataset FK absent';END IF;
 END LOOP;
 FOR r IN SELECT unnest(ARRAY['gto_v31_public_source_journal','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_selections','gto_v31_seal_cell_preparations'])name LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=('public.'||r.name)::regclass AND t.tgname='gto_v31_seal_dataset_insert_guard' AND t.tgtype=7 AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgfoid='public.fn_gto_v31_seal_dataset_insert_guard()'::regprocedure AND t.tgenabled IN('O','A'))THEN RAISE EXCEPTION 'bounded seal parent insert guard absent';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.gto_v31_seal_input_revisions v WHERE v.input_kind='epoch' AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=('public.'||v.input_id)::regclass AND t.tgname='gto_v31_seal_truncate_epoch' AND t.tgtype=32 AND t.tgqual IS NULL AND t.tgfoid='public.fn_gto_v31_seal_revision_changed()'::regprocedure AND t.tgenabled IN('O','A')))OR(SELECT count(*)FROM public.gto_v31_seal_input_revisions WHERE input_kind='epoch')<>13 THEN RAISE EXCEPTION 'bounded seal truncate guards absent';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.gto_v31_seal_input_revisions'::regclass AND t.tgname='gto_v31_seal_revisions_no_truncate'AND t.tgtype=34 AND t.tgqual IS NULL AND t.tgfoid='public.fn_gto_v31_public215_immutable_physics()'::regprocedure AND t.tgenabled IN('O','A'))THEN RAISE EXCEPTION 'seal revision clocks cannot be reset';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner)))a WHERE c.oid IN('public.gto_v31_seal_input_revisions'::regclass,'public.gto_v31_seal_cell_preparations'::regclass)AND a.grantee<>c.relowner)THEN RAISE EXCEPTION 'seal receipts must remain owner-only';END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_qualification_fingerprint()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'extensions'
AS $function$
 WITH relations AS MATERIALIZED(
 SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 AND c.relname=ANY(ARRAY['gto_v31_datasets','gto_v31_input_bundles','gto_v31_runtime_cells','gto_v31_cell_source_receipts','gto_v31_source_artifacts','solved_spots_gold','gto_v31_public_source_journal','gto_v31_public_selections','gto_v31_model_preparations','gto_v31_model_freezes','gto_v31_public_physics','gto_v31_public_model_compiled','gto_v31_public_model_audits','gto_v31_public_model_audit_combos','gto_v31_seal_input_revisions','gto_v31_seal_cell_preparations'])
 ), definitions AS MATERIALIZED(
 SELECT p.oid,p.proname,n.nspname,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proisstrict,p.proparallel,p.proleakproof,p.proconfig,
 pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) body
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND(position('gto_v31' IN p.proname)>0 OR p.proname IN('fn_gto_texture_class','fn_gto_texture_class_any','fn_training_canonical_jsonb_text_v1'))
 )
 SELECT public.fn_gto_v31_json_checksum(jsonb_build_object('format','public215_preseal_qualification_v1',
 'functions',(SELECT jsonb_agg(jsonb_build_object('identity',nspname||'.'||proname||'('||args||')','definition',body,
 'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'volatility',provolatile,'strict',proisstrict,'parallel',proparallel,'leakproof',proleakproof,'config',proconfig,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee=0,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor))FROM aclexplode(COALESCE(proacl,acldefault('f',proowner)))a))ORDER BY nspname,proname,args)FROM definitions),
 'relations',(SELECT jsonb_agg(jsonb_build_object('name',r.relname,'owner',pg_get_userbyid(r.relowner),'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))ORDER BY a.attnum)FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,'privilege',a.privilege_type,'grantable',a.is_grantable)ORDER BY a.grantee=0,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)END,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor))FROM aclexplode(COALESCE(r.relacl,acldefault('r',r.relowner)))a),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred)ORDER BY c.conname)FROM pg_constraint c WHERE c.conrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('name',CASE WHEN t.tgisinternal THEN NULL ELSE t.tgname END,'type',t.tgtype,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'arguments',encode(t.tgargs,'hex'),'constraint',CASE WHEN t.tgconstraint<>0 THEN pg_get_constraintdef(t.tgconstraint)ELSE NULL END,'definition',CASE WHEN NOT t.tgisinternal THEN pg_get_triggerdef(t.oid)ELSE NULL END)ORDER BY t.tgisinternal,t.tgfoid::regprocedure::text,t.tgtype,CASE WHEN t.tgconstraint<>0 THEN pg_get_constraintdef(t.tgconstraint)ELSE ''END,CASE WHEN NOT t.tgisinternal THEN t.tgname ELSE ''END)FROM pg_trigger t WHERE t.tgrelid=r.oid))ORDER BY r.relname)FROM relations r)))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_seal_revision_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE kind text;old_id text;new_id text;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' THEN RAISE EXCEPTION 'unexpected seal revision relation';END IF;
 IF TG_OP='TRUNCATE' THEN
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id,revision)VALUES('epoch',TG_TABLE_NAME,1)
  ON CONFLICT(input_kind,input_id)DO UPDATE SET revision=gto_v31_seal_input_revisions.revision+1;
  RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='solved_spots_gold' THEN
  kind:='gold';IF TG_OP<>'INSERT' THEN old_id:=OLD.id::text;END IF;IF TG_OP<>'DELETE' THEN new_id:=NEW.id::text;END IF;
 ELSIF TG_TABLE_NAME='gto_v31_input_bundles' THEN
  kind:='bundle';IF TG_OP<>'INSERT' THEN old_id:=OLD.input_bundle_id::text;END IF;IF TG_OP<>'DELETE' THEN new_id:=NEW.input_bundle_id::text;END IF;
 ELSE RAISE EXCEPTION 'unexpected seal revision relation';END IF;
 IF old_id IS NOT NULL AND(old_id IS DISTINCT FROM new_id OR TG_OP='DELETE') THEN
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id,revision,present)VALUES(kind,old_id,1,false)
  ON CONFLICT(input_kind,input_id)DO UPDATE SET revision=gto_v31_seal_input_revisions.revision+1,present=false;
 END IF;
 IF new_id IS NOT NULL THEN
  INSERT INTO public.gto_v31_seal_input_revisions(input_kind,input_id,revision,present)VALUES(kind,new_id,1,true)
  ON CONFLICT(input_kind,input_id)DO UPDATE SET revision=gto_v31_seal_input_revisions.revision+1,present=true;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_source_artifact_checksum(p_scenario_hash text, p_strategy_matrix_v2 jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT encode(digest(convert_to(
    public.fn_training_canonical_jsonb_text_v1(jsonb_build_object(
      'scenario_hash',p_scenario_hash,
      'strategy_matrix_v2',p_strategy_matrix_v2
    )),
    'UTF8'
  ),'sha256'),'hex');
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
       OR v_facing_target <> substring(v_last_token FROM 2)::numeric-(v_effective_stack_chips-v_facing_actor_total) -- Pio bN: total since root
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

CREATE OR REPLACE FUNCTION public.fn_gto_v31_source_node_v4_valid(p_node jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
 projected jsonb; state jsonb:=p_node->'complete_public_state';
 ranges jsonb:=p_node->'solver_ranges'; utility jsonb:=state->'utility';
 model jsonb:=utility->'icm_model'; rake jsonb:=utility->'rake';
 actor text; side text; value numeric; i integer; a integer; b integer;
 board_ids integer[]:=ARRAY[]::integer[]; card text; weight numeric;
 oop_values numeric[];ip_values numeric[];range_values numeric[];matchup_values numeric[];numeric_values boolean;
BEGIN
 IF p_node IS NULL OR jsonb_typeof(p_node) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_node))<>14
 OR NOT (p_node ?& ARRAY['schema','node','node_checksum','node_context','line_proof','action_specs',
 'frequencies','policy_evs_bb','action_evs_bb','matchups','source_combo_order_checksum',
 'range_bundle_checksum','complete_public_state','solver_ranges'])
 OR p_node->>'schema' IS DISTINCT FROM 'smarter-poker.pio-policy.v4'
 OR p_node->>'node_checksum' IS DISTINCT FROM public.fn_gto_v31_node_checksum(p_node)
 OR jsonb_typeof(state) IS DISTINCT FROM 'object'
 OR state IS DISTINCT FROM public.fn_gto_v31_complete_public_state(p_node)
 OR jsonb_typeof(utility) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(utility))<>5
 OR NOT utility ?& ARRAY['objective','utility_context','rake','icm_model_bundle_checksum','icm_model']
 OR utility->'objective' IS DISTINCT FROM p_node#>'{node_context,objective}'
 OR utility->'utility_context' IS DISTINCT FROM p_node#>'{node_context,utility_context}'
 OR jsonb_typeof(utility->'icm_model_bundle_checksum') IS DISTINCT FROM 'string'
 OR COALESCE(utility->>'icm_model_bundle_checksum','') !~ '^[0-9a-f]{64}$'
 OR utility->>'icm_model_bundle_checksum'=repeat('0',64)
 OR jsonb_typeof(ranges) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM jsonb_object_keys(ranges))<>3
 OR NOT ranges ?& ARRAY['schema','OOP','IP']
 OR ranges->>'schema' IS DISTINCT FROM 'smarter-poker.pio-exact-node-ranges.v1' THEN RETURN false; END IF;
 IF utility->>'objective'='icm' THEN
  IF rake IS DISTINCT FROM '[0,0]'::jsonb OR jsonb_typeof(model) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM jsonb_object_keys(model))<>6
  OR NOT model ?& ARRAY['model_id','source_snapshot_checksum','oop_stack_chips','ip_stack_chips','root_pot_chips','payout_per_chip']
  OR jsonb_typeof(model->'model_id') IS DISTINCT FROM 'string' OR length(model->>'model_id') NOT BETWEEN 1 AND 128
  OR jsonb_typeof(model->'source_snapshot_checksum') IS DISTINCT FROM 'string'
  OR model->>'source_snapshot_checksum' !~ '^[0-9a-f]{64}$'
  OR model->>'source_snapshot_checksum'=repeat('0',64)
  OR NOT public.fn_gto_v31_json_safe_integer(model->'oop_stack_chips',1,9007199254740991)
  OR NOT public.fn_gto_v31_json_safe_integer(model->'ip_stack_chips',1,9007199254740991)
  OR model->'root_pot_chips' IS DISTINCT FROM p_node#>'{line_proof,root_pot_chips}'
  OR jsonb_typeof(model->'payout_per_chip') IS DISTINCT FROM 'number'
  OR (model->>'payout_per_chip')::numeric<=0 THEN RETURN false; END IF;
 ELSE
  IF model IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(rake) IS DISTINCT FROM 'array'
  OR jsonb_array_length(rake)<>2 OR jsonb_typeof(rake->0) IS DISTINCT FROM 'number'
  OR (rake->>0)::numeric NOT BETWEEN 0 AND 1
  OR NOT public.fn_gto_v31_json_safe_integer(rake->1,0,9007199254740991) THEN RETURN false; END IF;
 END IF;
 projected:=(p_node-'complete_public_state'-'solver_ranges')||
  jsonb_build_object('schema','smarter-poker.pio-policy.v3','node_checksum',p_node->>'node_checksum');
 IF NOT public.fn_gto_v31_source_node_v3_fields_valid(projected) THEN RETURN false; END IF;
 FOR card IN SELECT substring(p_node#>>'{node_context,board}' FROM k FOR 2)
   FROM generate_series(1,length(p_node#>>'{node_context,board}'),2) k LOOP
  board_ids:=array_append(board_ids,(strpos('23456789TJQKA',left(card,1))-1)*4+strpos('cdhs',right(card,1))-1);
 END LOOP;
 actor:=CASE p_node#>>'{line_proof,hero_solver_player}' WHEN '0' THEN 'OOP' ELSE 'IP' END;
 -- Decode each full range exactly once; all JSON type guards remain strict.
 FOREACH side IN ARRAY ARRAY['OOP','IP'] LOOP
  IF jsonb_typeof(ranges->side) IS DISTINCT FROM 'array' OR jsonb_array_length(ranges->side)<>1326 THEN RETURN false; END IF;
  SELECT array_agg(CASE WHEN jsonb_typeof(e.value)='number' THEN (e.value#>>'{}')::numeric END ORDER BY e.ordinality),
   bool_and(jsonb_typeof(e.value)='number') INTO range_values,numeric_values
  FROM jsonb_array_elements(ranges->side) WITH ORDINALITY e;
  IF numeric_values IS DISTINCT FROM true THEN RETURN false;END IF;
  IF side='OOP' THEN oop_values:=range_values;ELSE ip_values:=range_values;END IF;
 END LOOP;
 -- The unchanged complete V3 validator above owns matchup types/shape/bounds.
 -- #>>'{}' preserves the original ->>i numeric conversion, including SQL NULL.
 SELECT array_agg((e.value#>>'{}')::numeric ORDER BY e.ordinality) INTO matchup_values
 FROM jsonb_array_elements(p_node->'matchups') WITH ORDINALITY e;
 FOREACH side IN ARRAY ARRAY['OOP','IP'] LOOP
  range_values:=CASE side WHEN 'OOP' THEN oop_values ELSE ip_values END;
  i:=0;
  FOR b IN 1..51 LOOP FOR a IN 0..b-1 LOOP
   value:=range_values[i+1];
   IF value NOT BETWEEN 0 AND 1 OR ((a=ANY(board_ids) OR b=ANY(board_ids)) AND value<>0) THEN RETURN false; END IF;
   weight:=matchup_values[i+1];
   IF side=actor AND weight>0 AND value<=0 THEN RETURN false; END IF;
   i:=i+1;
  END LOOP; END LOOP;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_v3_breadth_ok(p_dataset_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Breadth within the dataset's own scope: every family/objective the
  -- playbook carries covers every street the playbook carries anywhere.
  SELECT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id)
     AND NOT EXISTS (
       SELECT 1
         FROM (SELECT DISTINCT c.game_family,c.objective FROM public.gto_v31_runtime_cells c
                WHERE c.dataset_id=p_dataset_id) fo
        CROSS JOIN (SELECT DISTINCT c.street FROM public.gto_v31_runtime_cells c
                     WHERE c.dataset_id=p_dataset_id) s
        WHERE NOT EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
                           WHERE c.dataset_id=p_dataset_id AND c.game_family=fo.game_family
                             AND c.objective=fo.objective AND c.street=s.street))
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_v3_families(p_dataset_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(f.family ORDER BY f.ord),ARRAY[]::text[])
    FROM unnest(ARRAY['cash','spin','tourney_ev','tourney_icm']) WITH ORDINALITY f(family,ord)
   WHERE EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells c
                  WHERE c.dataset_id=p_dataset_id AND c.game_family=f.family)
$function$
;

CREATE OR REPLACE FUNCTION public.fn_training_canonical_jsonb_text_v1(p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_result text;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(
        to_jsonb(entry.key)::text || ':'
          || public.fn_training_canonical_jsonb_text_v1(entry.value),
        ',' ORDER BY entry.key COLLATE "C"
      ), '') || '}'
      INTO v_result
      FROM jsonb_each(p_value) AS entry;
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(
        public.fn_training_canonical_jsonb_text_v1(entry.value),
        ',' ORDER BY entry.ordinality
      ), '') || ']'
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS entry(value, ordinality);
    ELSE
      v_result := p_value::text;
  END CASE;
  RETURN v_result;
END;
$function$
;

REVOKE ALL ON FUNCTION public.fn_gto_texture_class(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_texture_class(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_texture_class(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_texture_class(text) TO anon;
GRANT EXECUTE ON FUNCTION public.fn_gto_texture_class(text) TO PUBLIC;
REVOKE ALL ON FUNCTION public.fn_gto_texture_class_any(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_texture_class_any(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_action_specs_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_action_specs_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_active_cells(integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_active_cells(integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_assert_source_contract(jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_assert_source_contract(jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_board_rank_signature(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_board_rank_signature(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_board_relative_key_v2(integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_board_relative_key_v2(integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_board_relative_key_v2_valid(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_board_relative_key_v2_valid(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_build_cell(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_build_cell(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_build_cell_matrix_v2(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_composition(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_context_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_cell_context_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_contract_v3_error(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_key_checksum(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_cell_key_checksum(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_payload_checksum(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_cell_payload_checksum(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_payload_checksum_matrix_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_payload_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_cell_payload_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_payload_valid_matrix_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_provenance_error(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_cell_set_checksum(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_combo_cards(integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_combo_cards(integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_complete_public_state(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_complete_public_state(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_composition_text(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_dataset_links_registration() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_dataset_matches_range_provenance() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_dataset_matches_registration() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_declared_coverage_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_declared_coverage_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_cells(uuid,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_evaluation_cells(uuid,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_contract_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_feature_binding_immutable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_feature_identity(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_feature_identity(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_feature_key(integer,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_feature_key(integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_feature_key_valid(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_feature_key_valid(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_feature_request_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_feature_request_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_hand_key(integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_hand_key(integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_hand_key_valid(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_hand_key_valid(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_hand_key_valid(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_hand_key_valid(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_hand_matrix_valid(jsonb,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_hand_matrix_valid(jsonb,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_heldout_metrics(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_heldout_metrics(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_heldout_metrics_matrix_v2(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_input_bundle_checksum(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_input_bundle_checksum(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_input_bundle_checksum_matrix_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_input_bundle_id(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_input_bundle_id(text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_json_checksum(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_json_checksum(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_json_safe_integer(jsonb,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_json_safe_integer(jsonb,numeric,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_node_checksum(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_node_checksum(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_physical_positions_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_physical_positions_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_policy_identity(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_policy_identity(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_policy_identity(text) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_gto_v31_policy_request_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_policy_request_valid(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_policy_request_valid(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_action_sum(double precision[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_assert_prepared_seal(gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_key(text,text,text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_prediction(gto_v31_runtime_cells,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_prediction_v2(gto_v31_runtime_cells,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_base181(integer,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_bits(double precision[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_build_cell(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_build_receipt(gto_v31_runtime_cells,gto_v31_datasets,gto_v31_input_bundles) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_bundle_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_canonical(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_cards(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_cell_immutable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_cell_model_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_compile(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_compiled_raw(gto_v31_public215_head[],double precision[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_compiled_raw_v2(gto_v31_public215_head[],double precision[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_context(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_dataset_models_valid(gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_dense_wtl(integer[],numeric[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_digest(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_encoding_for(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_encoding_implementation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_encoding_implementation_v2() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_f64(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_feature_contract_of_schema(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_feature_schema(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_features(integer,text,jsonb,numeric[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_frozen_map(gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_frozen_model_valid(gto_v31_runtime_cells,gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_graph(integer[],integer[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_heldout_metrics(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_immutable_physics() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_keys(jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_lock_seal_inputs(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_metrics_from_raw(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_model_canonical_fast(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_model_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_model_width(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_normalize(text,integer,double precision[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_normalized_weights(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_physics_implementation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_physics_key(jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_prepare_audit(gto_v31_runtime_cells,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_prepare_audit_v2(gto_v31_runtime_cells,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_prepare_math(jsonb,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_provenance_valid(gto_v31_runtime_cells,gto_v31_datasets,gto_v31_input_bundles,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_rank(integer[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_rank_signature(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_ratio(numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_required_audit(gto_v31_runtime_cells,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_required_audit_v2(gto_v31_runtime_cells,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_runtime_protocol_valid(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_seal_cell_binding(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_seal_prepared(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_selected_complete(gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_source_geometry(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_source_headers_valid(gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_sources(gto_v31_datasets) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_template_geometry(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_template_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_template_valid_for(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_template_valid_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_v2_appended(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_quality_gates_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_quality_gates_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_range_evidence_is_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_range_is_rescale(double precision[],text,double precision[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_record_range_evidence() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_register_dataset(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_register_dataset(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_register_round(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_register_round(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_required_families(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_round_registration_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_round_registration_provenance_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_runtime_cell_context(gto_v31_runtime_cells) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_build(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_seal_build(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_build_legacy_v31(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_dataset_insert_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_matches_range_provenance() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_matches_registration() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_preparation_guards() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_qualification_fingerprint() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_seal_revision_changed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_artifact_checksum(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_artifact_checksum(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_node_scalar_types_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_node_scalar_types_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_node_v3_fields_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_node_v3_fields_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_node_v4_valid(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_node_v4_valid(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_breadth_ok(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_v3_families(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_training_canonical_jsonb_text_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
SET check_function_bodies = on;
