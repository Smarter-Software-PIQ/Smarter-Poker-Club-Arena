-- 20261108011659_v31_public215_v2_sql_encoding_chain
--
-- WHAT THIS ADDS
--
-- The SQL side of feature contract v2 (holdem-public-hist215-v2, migration
-- 20261107224538): an independent v2 encoding chain for public215 audits, so a v2
-- dataset (R8) can build cells, prepare heldout audits and seal. It is a NEW chain
-- selected by the cell's / dataset's declared feature_contract_version.
--
-- v1 IS NOT TOUCHED. The 13 functions hashed by fn_gto_v31_public215_encoding_
-- implementation() (R7's sealed encoding identity 1121d3ff...) keep their exact
-- definitions; the self-test asserts that identity before and after. v1 cells and
-- datasets dispatch to exactly the v1 functions they called before.
--
--   new pure:  v2_appended(template) (indices 215..245, same rule/order as Club Arena
--              encodePublic215V2Appended), features_v2 = v1 features || v2 block (246),
--              compiled_raw_v2 (246-wide inference)
--   new chain: audit_key_v2, prepare_audit_v2, audit_prediction_v2, required_audit_v2
--              (v1 texts, version-guarded, calling the v2 pieces), encoding_
--              implementation_v2() = digest of the v1 13 + the 7 v2 functions
--   dispatch:  encoding_for(version), audit_key_for(version,...), prepare_audit_for,
--              audit_prediction_for, required_audit_for (v2 -> v2 chain, else v1)
--   patched (md5-pinned, exact-count anchors): prepare_model, prepare_seal_cell,
--              assert_prepared_seal, build_cell, dataset_models_valid, frozen_map,
--              build_receipt, prepare_public_physics, heldout_metrics, cell_metric_raw,
--              seal_cell_binding, horse_solver_agreement_v31_public215_decision call the
--              dispatchers; prepare_seal_cell, assert_prepared_seal and
--              prepare_heldout_public_physics take R7's census (107 contexts, 6,955 =
--              65 x 107 sources, 6,099 = 57 x 107 M1, 856 = 8 x 107 M2) from the
--              dataset's declared coverage instead of literals (identical for R7).
--   constraint: gto_v31_public_model_audit_combos_features_check admits 215 or 246.
--
-- TS/SQL parity: features_v2 equals Club Arena's encodePublic215Features (v2) bit
-- for bit on a fixed R8 state set (scripts/ci/test-v31-public215-v2-sql-parity.py,
-- PG17, byte-exact production preimages of the v1 encoder closure).
--
-- @live-proof: public.fn_gto_v31_public215_encoding_implementation()='1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d' AND md5(pg_get_functiondef('public.fn_gto_v31_prepare_heldout_public_physics(uuid,text,text,text,integer)'::regprocedure))='57d4cda19732f4747e2218342b7a718f' AND md5(pg_get_functiondef('public.fn_gto_v31_prepare_model(uuid,jsonb)'::regprocedure))='767f58852fc485d0e9b628de248de3a3' AND md5(pg_get_functiondef('public.fn_gto_v31_prepare_public_physics(uuid,text,text[])'::regprocedure))='c01e850b06ddb41265158761c213ef12' AND md5(pg_get_functiondef('public.fn_gto_v31_prepare_seal_cell(uuid,text)'::regprocedure))='e092f30e8a35091cbebf0e5dd718b4b1' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_assert_prepared_seal(gto_v31_datasets)'::regprocedure))='52a881301b6c740ab01cced819111bca' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text)'::regprocedure))='197ff9246c9f7d139c898c5a2bd9c019' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text)'::regprocedure))='1fea57f3f7c03587d6cd2cb221fdb0c8' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer)'::regprocedure))='db74194beab005ea6226fd306e503c24' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_audit_prediction_v2(gto_v31_runtime_cells,text,integer)'::regprocedure))='f0423d01b18109ab322ccfa84974d2a6' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_build_cell(uuid,jsonb)'::regprocedure))='39abfd440672a0c35e909794dbfa226a' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_build_receipt(gto_v31_runtime_cells,gto_v31_datasets,gto_v31_input_bundles)'::regprocedure))='aa608a378dc83a49171780675872116d' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_cell_metric_raw(uuid,uuid)'::regprocedure))='35a9020d79029b1eb56a9bf2dc7a6765' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_compiled_raw_v2(gto_v31_public215_head[],double precision[])'::regprocedure))='41825de5edd49220e0912efa81cbd61a' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_dataset_models_valid(gto_v31_datasets)'::regprocedure))='2e49a339aa4760821b6d1f3d9dc5c900' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_encoding_for(text)'::regprocedure))='a31e2394c580df6bc1b22f11f70a8289' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_encoding_implementation_v2()'::regprocedure))='e9d65fc19e9283f9d5b385b32d7d53ba' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[])'::regprocedure))='bf0f289696489cba05008d39391e3f1a' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_frozen_map(gto_v31_datasets)'::regprocedure))='ecee210b9460ec3e74dc4214f0955d80' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_heldout_metrics(uuid,text)'::regprocedure))='bb095ff152b02891c85ff40ced582add' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[])'::regprocedure))='3b00a8c00c8f8bf4846b2e22c95d937c' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_prepare_audit_v2(gto_v31_runtime_cells,text[])'::regprocedure))='07e5e4cf21c6b7cd233d7063611ac19d' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text)'::regprocedure))='0a95e324a6d12dd1421f8cd891fd3cd1' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_required_audit_v2(gto_v31_runtime_cells,text)'::regprocedure))='72ec4bc568ffdb127ac81dba2fb34f6a' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_seal_cell_binding(uuid,text)'::regprocedure))='26567cf1a25e5a24c328681fc5e66b64' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_v2_appended(jsonb)'::regprocedure))='c3b7c332f9b9b13ea5f27cfecc8c0eb0' AND md5(pg_get_functiondef('public.fn_horse_solver_agreement_v31_public215_decision(jsonb)'::regprocedure))='8ed2516c951d40dad7e3d744fd01b99c'

BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog,public;

DO $v1$ BEGIN
  IF public.fn_gto_v31_public215_encoding_implementation() IS DISTINCT FROM '1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d' THEN
    RAISE EXCEPTION 'v1 encoding identity is not the sealed one (%)', public.fn_gto_v31_public215_encoding_implementation();
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE proname IN('fn_gto_v31_public215_features_v2','fn_gto_v31_public215_encoding_for')) THEN
    RAISE EXCEPTION 'v2 SQL chain already present';
  END IF;
END $v1$;

-- @v2-pure-begin
CREATE FUNCTION public.fn_gto_v31_public215_v2_appended(p_template jsonb)
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

CREATE FUNCTION public.fn_gto_v31_public215_features_v2(p_combo integer, p_board text, p_template jsonb, p_mass numeric[])
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

CREATE FUNCTION public.fn_gto_v31_public215_compiled_raw_v2(p_heads gto_v31_public215_head[], p_x double precision[])
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

-- @v2-pure-end

-- The chain refers to itself (encoding_implementation_v2 names audit_key_v2 and
-- audit_key_v2 calls it); bodies are checked by the self-test calls below.
SET LOCAL check_function_bodies=off;
CREATE FUNCTION public.fn_gto_v31_public215_audit_key_v2(p_model_checksum text, p_template_checksum text, p_board text[], p_physics_key text)
 RETURNS text
 LANGUAGE sql
 STABLE STRICT
 SET search_path TO 'public'
AS $function$
 SELECT public.fn_gto_v31_public215_digest(jsonb_build_object('format','public_hist215_audit_v2','model_checksum',p_model_checksum,'template_checksum',p_template_checksum,'chronological_board',p_board,'physics_key',p_physics_key,'encoding_checksum',public.fn_gto_v31_public215_encoding_implementation_v2()))
$function$
;

CREATE FUNCTION public.fn_gto_v31_public215_prepare_audit_v2(p_cell gto_v31_runtime_cells, p_board text[])
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

CREATE FUNCTION public.fn_gto_v31_public215_audit_prediction_v2(p_cell gto_v31_runtime_cells, p_board text, p_combo integer)
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

CREATE FUNCTION public.fn_gto_v31_public215_required_audit_v2(p_cell gto_v31_runtime_cells, p_board text)
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

CREATE FUNCTION public.fn_gto_v31_public215_encoding_implementation_v2()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
 SELECT encode(digest(convert_to(string_agg(pg_get_functiondef(oid),E'\n'ORDER BY oid::regprocedure::text),'UTF8'),'sha256'),'hex')FROM pg_proc WHERE oid IN('public.fn_gto_v31_public215_f64(text)'::regprocedure,'public.fn_gto_v31_public215_ratio(numeric,numeric)'::regprocedure,'public.fn_gto_v31_public215_graph(integer[],integer[])'::regprocedure,'public.fn_gto_v31_public215_base181(integer,text,jsonb)'::regprocedure,'public.fn_gto_v31_public215_features(integer,text,jsonb,numeric[])'::regprocedure,'public.fn_gto_v31_public215_compile(jsonb)'::regprocedure,'public.fn_gto_v31_public215_compiled_raw(public.gto_v31_public215_head[],double precision[])'::regprocedure,'public.fn_gto_v31_public215_action_sum(double precision[])'::regprocedure,'public.fn_gto_v31_public215_normalize(text,integer,double precision[])'::regprocedure,'public.fn_gto_v31_public215_prepare_audit(public.gto_v31_runtime_cells,text[])'::regprocedure,'public.fn_gto_v31_public215_audit_prediction(public.gto_v31_runtime_cells,text,integer)'::regprocedure,'public.fn_gto_v31_public215_required_audit(public.gto_v31_runtime_cells,text)'::regprocedure,'public.fn_gto_v31_board_relative_key_v2(integer,text)'::regprocedure,'public.fn_gto_v31_public215_v2_appended(jsonb)'::regprocedure,'public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[])'::regprocedure,'public.fn_gto_v31_public215_compiled_raw_v2(public.gto_v31_public215_head[],double precision[])'::regprocedure,'public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text)'::regprocedure,'public.fn_gto_v31_public215_prepare_audit_v2(public.gto_v31_runtime_cells,text[])'::regprocedure,'public.fn_gto_v31_public215_audit_prediction_v2(public.gto_v31_runtime_cells,text,integer)'::regprocedure,'public.fn_gto_v31_public215_required_audit_v2(public.gto_v31_runtime_cells,text)'::regprocedure)
$function$
;

CREATE FUNCTION public.fn_gto_v31_public215_encoding_for(p_version text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT CASE WHEN p_version='holdem-public-hist215-v2' THEN public.fn_gto_v31_public215_encoding_implementation_v2() ELSE public.fn_gto_v31_public215_encoding_implementation() END
$function$
;

CREATE FUNCTION public.fn_gto_v31_public215_audit_key_for(p_version text, p_model_checksum text, p_template_checksum text, p_board text[], p_physics_key text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
 SELECT CASE WHEN p_version='holdem-public-hist215-v2' THEN public.fn_gto_v31_public215_audit_key_v2(p_model_checksum,p_template_checksum,p_board,p_physics_key) ELSE public.fn_gto_v31_public215_audit_key(p_model_checksum,p_template_checksum,p_board,p_physics_key) END
$function$
;

CREATE FUNCTION public.fn_gto_v31_public215_prepare_audit_for(p_cell gto_v31_runtime_cells, p_board text[])
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

CREATE FUNCTION public.fn_gto_v31_public215_audit_prediction_for(p_cell gto_v31_runtime_cells, p_board text, p_combo integer)
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

CREATE FUNCTION public.fn_gto_v31_public215_required_audit_for(p_cell gto_v31_runtime_cells, p_board text)
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

SET LOCAL check_function_bodies=on;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_v2_appended(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_compiled_raw_v2(gto_v31_public215_head[],double precision[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_prepare_audit_v2(gto_v31_runtime_cells,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_prediction_v2(gto_v31_runtime_cells,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_required_audit_v2(gto_v31_runtime_cells,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_encoding_implementation_v2() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_encoding_for(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text) FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE patch record; anchor jsonb; def text; hits integer; acl text;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_prepare_model(uuid,jsonb)'::regprocedure, '6edf5ac91a607b717075f89251fd4d18', '[["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_for(d.feature_contract_version)", 1]]'::jsonb),
    ('public.fn_gto_v31_prepare_seal_cell(uuid,text)'::regprocedure, '3658cec38d665f69f12f1cdda0a1584d', '[["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_for(d.feature_contract_version)", 2], ["public.fn_gto_v31_public215_audit_key(", "public.fn_gto_v31_public215_audit_key_for(d.feature_contract_version,", 1], ["IF jsonb_array_length(d.declared_coverage)<>107 OR", "IF jsonb_array_length(d.declared_coverage)<1 OR", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_assert_prepared_seal(gto_v31_datasets)'::regprocedure, '07f1911661b8843a6276e15e7870cfd1', '[["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_for(p_dataset.feature_contract_version)", 1], ["OR jsonb_array_length(p_dataset.declared_coverage)<>107 THEN", "OR jsonb_array_length(p_dataset.declared_coverage)<1 THEN", 1], ["WHERE dataset_id=p_dataset.dataset_id)<>6955\n", "WHERE dataset_id=p_dataset.dataset_id)<>65*jsonb_array_length(p_dataset.declared_coverage)\n", 1], ["machine_id=''M1'')<>6099\n", "machine_id=''M1'')<>57*jsonb_array_length(p_dataset.declared_coverage)\n", 1], ["machine_id=''M2'')<>856 THEN", "machine_id=''M2'')<>8*jsonb_array_length(p_dataset.declared_coverage) THEN", 1], ["IF cells<>107 OR cells<>", "IF cells<1 OR cells<>", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_build_cell(uuid,jsonb)'::regprocedure, '703b803f4b98e0b00b8e015e479c39dc', '[["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_for(v_dataset.feature_contract_version)", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_dataset_models_valid(gto_v31_datasets)'::regprocedure, 'ce6ed24221a1c34db522454015ff65f3', '[["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_for(p_dataset.feature_contract_version)", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_frozen_map(gto_v31_datasets)'::regprocedure, 'e3db693ea0c02f11937e908a9400d9e9', '[["public.fn_gto_v31_public215_encoding_implementation()", "public.fn_gto_v31_public215_encoding_for(d.feature_contract_version)", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_build_receipt(gto_v31_runtime_cells,gto_v31_datasets,gto_v31_input_bundles)'::regprocedure, 'e362a74de4c81ce3839c023822ec0a03', '[["public.fn_gto_v31_public215_prepare_audit(", "public.fn_gto_v31_public215_prepare_audit_for(", 1]]'::jsonb),
    ('public.fn_gto_v31_prepare_public_physics(uuid,text,text[])'::regprocedure, '194544c540195845150211f6e8a211f4', '[["public.fn_gto_v31_public215_prepare_audit(", "public.fn_gto_v31_public215_prepare_audit_for(", 1]]'::jsonb),
    ('public.fn_horse_solver_agreement_v31_public215_decision(jsonb)'::regprocedure, '06e693c54570b63ba127f2dd559f2638', '[["public.fn_gto_v31_public215_audit_prediction(", "public.fn_gto_v31_public215_audit_prediction_for(", 2]]'::jsonb),
    ('public.fn_gto_v31_public215_heldout_metrics(uuid,text)'::regprocedure, '4a5e48b9ea6495dac376502cddf1807e', '[["public.fn_gto_v31_public215_required_audit(", "public.fn_gto_v31_public215_required_audit_for(", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_cell_metric_raw(uuid,uuid)'::regprocedure, 'ba4853eea23acd9061a31b8d2b7e53c3', '[["public.fn_gto_v31_public215_required_audit(", "public.fn_gto_v31_public215_required_audit_for(", 1]]'::jsonb),
    ('public.fn_gto_v31_public215_seal_cell_binding(uuid,text)'::regprocedure, '7ed6b50e6c622d2dd9c09d7ca52dd0f1', '[["public.fn_gto_v31_public215_required_audit(", "public.fn_gto_v31_public215_required_audit_for(", 1]]'::jsonb),
    ('public.fn_gto_v31_prepare_heldout_public_physics(uuid,text,text,text,integer)'::regprocedure, 'b9e310b714a01ffa962b9a8764fdc51e', '[["OR jsonb_array_length(d.declared_coverage) IS DISTINCT FROM 107 OR", "OR jsonb_array_length(d.declared_coverage)<1 OR", 1], ["OR jsonb_array_length(s.selected) IS DISTINCT FROM 856 OR", "OR jsonb_array_length(s.selected) IS DISTINCT FROM 8*jsonb_array_length(d.declared_coverage) OR", 1]]'::jsonb)
  ) AS p(fn,pre_md5,anchors) LOOP
    def:=pg_get_functiondef(patch.fn);
    IF md5(def) IS DISTINCT FROM patch.pre_md5 THEN RAISE EXCEPTION '% preimage changed (md5 %), refusing to patch', patch.fn, md5(def); END IF;
    acl:=(SELECT proacl::text FROM pg_proc WHERE oid=patch.fn);
    FOR anchor IN SELECT value FROM jsonb_array_elements(patch.anchors) LOOP
      hits:=(length(def)-length(replace(def,anchor->>0,'')))/length(anchor->>0);
      IF hits<>(anchor->>2)::integer THEN RAISE EXCEPTION '% anchor found % times, expected %: %', patch.fn, hits, anchor->>2, anchor->>0; END IF;
      def:=replace(def,anchor->>0,anchor->>1);
    END LOOP;
    EXECUTE def;
    IF (SELECT proacl::text FROM pg_proc WHERE oid=patch.fn) IS DISTINCT FROM acl THEN RAISE EXCEPTION '% ACL changed', patch.fn; END IF;
  END LOOP;
END
$patch$;

DO $acl$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_gto_v31_public215_v2_appended(jsonb)','public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[])','public.fn_gto_v31_public215_compiled_raw_v2(gto_v31_public215_head[],double precision[])','public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text)','public.fn_gto_v31_public215_prepare_audit_v2(gto_v31_runtime_cells,text[])','public.fn_gto_v31_public215_audit_prediction_v2(gto_v31_runtime_cells,text,integer)','public.fn_gto_v31_public215_required_audit_v2(gto_v31_runtime_cells,text)','public.fn_gto_v31_public215_encoding_implementation_v2()','public.fn_gto_v31_public215_encoding_for(text)','public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text)','public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[])','public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer)','public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text)'] LOOP
    IF (SELECT proacl::text FROM pg_proc WHERE oid=f::regprocedure) IS DISTINCT FROM '{postgres=X/postgres}' THEN RAISE EXCEPTION '% ACL is not owner-only like its v1 counterpart', f; END IF;
  END LOOP;
END
$acl$;

DO $postimage$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_prepare_heldout_public_physics(uuid,text,text,text,integer)'::regprocedure,'57d4cda19732f4747e2218342b7a718f'),
    ('public.fn_gto_v31_prepare_model(uuid,jsonb)'::regprocedure,'767f58852fc485d0e9b628de248de3a3'),
    ('public.fn_gto_v31_prepare_public_physics(uuid,text,text[])'::regprocedure,'c01e850b06ddb41265158761c213ef12'),
    ('public.fn_gto_v31_prepare_seal_cell(uuid,text)'::regprocedure,'e092f30e8a35091cbebf0e5dd718b4b1'),
    ('public.fn_gto_v31_public215_assert_prepared_seal(gto_v31_datasets)'::regprocedure,'52a881301b6c740ab01cced819111bca'),
    ('public.fn_gto_v31_public215_audit_key_for(text,text,text,text[],text)'::regprocedure,'197ff9246c9f7d139c898c5a2bd9c019'),
    ('public.fn_gto_v31_public215_audit_key_v2(text,text,text[],text)'::regprocedure,'1fea57f3f7c03587d6cd2cb221fdb0c8'),
    ('public.fn_gto_v31_public215_audit_prediction_for(gto_v31_runtime_cells,text,integer)'::regprocedure,'db74194beab005ea6226fd306e503c24'),
    ('public.fn_gto_v31_public215_audit_prediction_v2(gto_v31_runtime_cells,text,integer)'::regprocedure,'f0423d01b18109ab322ccfa84974d2a6'),
    ('public.fn_gto_v31_public215_build_cell(uuid,jsonb)'::regprocedure,'39abfd440672a0c35e909794dbfa226a'),
    ('public.fn_gto_v31_public215_build_receipt(gto_v31_runtime_cells,gto_v31_datasets,gto_v31_input_bundles)'::regprocedure,'aa608a378dc83a49171780675872116d'),
    ('public.fn_gto_v31_public215_cell_metric_raw(uuid,uuid)'::regprocedure,'35a9020d79029b1eb56a9bf2dc7a6765'),
    ('public.fn_gto_v31_public215_compiled_raw_v2(gto_v31_public215_head[],double precision[])'::regprocedure,'41825de5edd49220e0912efa81cbd61a'),
    ('public.fn_gto_v31_public215_dataset_models_valid(gto_v31_datasets)'::regprocedure,'2e49a339aa4760821b6d1f3d9dc5c900'),
    ('public.fn_gto_v31_public215_encoding_for(text)'::regprocedure,'a31e2394c580df6bc1b22f11f70a8289'),
    ('public.fn_gto_v31_public215_encoding_implementation_v2()'::regprocedure,'e9d65fc19e9283f9d5b385b32d7d53ba'),
    ('public.fn_gto_v31_public215_features_v2(integer,text,jsonb,numeric[])'::regprocedure,'bf0f289696489cba05008d39391e3f1a'),
    ('public.fn_gto_v31_public215_frozen_map(gto_v31_datasets)'::regprocedure,'ecee210b9460ec3e74dc4214f0955d80'),
    ('public.fn_gto_v31_public215_heldout_metrics(uuid,text)'::regprocedure,'bb095ff152b02891c85ff40ced582add'),
    ('public.fn_gto_v31_public215_prepare_audit_for(gto_v31_runtime_cells,text[])'::regprocedure,'3b00a8c00c8f8bf4846b2e22c95d937c'),
    ('public.fn_gto_v31_public215_prepare_audit_v2(gto_v31_runtime_cells,text[])'::regprocedure,'07e5e4cf21c6b7cd233d7063611ac19d'),
    ('public.fn_gto_v31_public215_required_audit_for(gto_v31_runtime_cells,text)'::regprocedure,'0a95e324a6d12dd1421f8cd891fd3cd1'),
    ('public.fn_gto_v31_public215_required_audit_v2(gto_v31_runtime_cells,text)'::regprocedure,'72ec4bc568ffdb127ac81dba2fb34f6a'),
    ('public.fn_gto_v31_public215_seal_cell_binding(uuid,text)'::regprocedure,'26567cf1a25e5a24c328681fc5e66b64'),
    ('public.fn_gto_v31_public215_v2_appended(jsonb)'::regprocedure,'c3b7c332f9b9b13ea5f27cfecc8c0eb0'),
    ('public.fn_horse_solver_agreement_v31_public215_decision(jsonb)'::regprocedure,'8ed2516c951d40dad7e3d744fd01b99c')
  ) AS p(fn,post_md5) LOOP
    IF md5(pg_get_functiondef(r.fn)) IS DISTINCT FROM r.post_md5 THEN RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage', r.fn, md5(pg_get_functiondef(r.fn)); END IF;
  END LOOP;
END
$postimage$;

DO $constraint$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT def FROM pg_constraint WHERE conrelid='public.gto_v31_public_model_audit_combos'::regclass AND conname='gto_v31_public_model_audit_combos_features_check' AND convalidated;
  IF def IS DISTINCT FROM 'CHECK ((cardinality(features) = 215))' THEN RAISE EXCEPTION 'audit combo width constraint preimage changed or not validated: %', def; END IF;
END
$constraint$;
-- NOT VALID on purpose: re-validating would scan 1.48M existing rows (3.1 GB) and
-- exceed the applier's 12 s transaction budget (install runs 42437670477 /
-- 42437810344 / 42441329582 refused with 25P04). Every existing row already
-- satisfies the validated preimage (= 215, asserted just above), hence this
-- superset; new and updated rows are enforced as usual.
ALTER TABLE public.gto_v31_public_model_audit_combos DROP CONSTRAINT gto_v31_public_model_audit_combos_features_check,
  ADD CONSTRAINT gto_v31_public_model_audit_combos_features_check CHECK (cardinality(features) = ANY (ARRAY[215, 246])) NOT VALID;

-- Self-test (inside the transaction: any failure rolls the whole migration back).
DO $selftest$
DECLARE c public.gto_v31_runtime_cells; a public.gto_v31_public_model_audits; pair record; ac public.gto_v31_public_model_audit_combos;
        rows jsonb; r jsonb; mass numeric[]; x double precision[]; t jsonb; app double precision[]; board text; n integer:=0;
BEGIN
  IF public.fn_gto_v31_public215_encoding_implementation() IS DISTINCT FROM '1121d3ff6873757d8560e55f397e29df8978cc8b845259bbaa2c529f40950f6d'
     OR public.fn_gto_v31_public215_encoding_for('holdem-public-hist215-v1') IS DISTINCT FROM public.fn_gto_v31_public215_encoding_implementation()
     OR public.fn_gto_v31_public215_encoding_for('holdem-public-hist215-v2') IS DISTINCT FROM public.fn_gto_v31_public215_encoding_implementation_v2()
     OR public.fn_gto_v31_public215_encoding_implementation_v2() = public.fn_gto_v31_public215_encoding_implementation()
     OR public.fn_gto_v31_public215_encoding_implementation_v2() !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'selftest: encoding identities';
  END IF;
  -- v1: for a live R7 audit, the v2 vector's first 215 entries are exactly the stored
  -- v1 audited features, and every v1 dispatcher returns what v1 returns.
  FOR pair IN SELECT cc AS cell, aa AS audit FROM public.gto_v31_public_model_audits aa
      JOIN public.gto_v31_runtime_cells cc ON cc.model_checksum=aa.model_checksum AND cc.template_checksum=aa.template_checksum
      WHERE cc.policy_representation='public_hist215_v1' AND cc.feature_contract_version='holdem-public-hist215-v1'
      ORDER BY aa.audit_key LIMIT 1 LOOP
    c:=pair.cell; a:=pair.audit;
    board:=array_to_string(a.chronological_board,'');
    SELECT exact_mass_rows INTO STRICT rows FROM public.gto_v31_public_physics WHERE physics_key=a.physics_key;
    FOR ac IN SELECT * FROM public.gto_v31_public_model_audit_combos WHERE audit_key=a.audit_key ORDER BY combo LIMIT 4 LOOP
      SELECT e INTO STRICT r FROM jsonb_array_elements(rows) e WHERE (e->>0)::integer=ac.combo;
      mass:=ARRAY[(r->>1)::numeric,(r->>2)::numeric,(r->>3)::numeric,(r->>4)::numeric,(r->>5)::numeric,(r->>6)::numeric,(r->>7)::numeric,(r->>8)::numeric];
      x:=public.fn_gto_v31_public215_features_v2(ac.combo,board,c.public_template,mass);
      IF cardinality(x)<>246 OR x[1:215] IS DISTINCT FROM ac.features OR x[216:246] IS DISTINCT FROM public.fn_gto_v31_public215_v2_appended(c.public_template)
         OR (SELECT sum(v) FROM unnest(x[216:246]) v)<>0 THEN
        RAISE EXCEPTION 'selftest: v1 prefix or zero v2 block differs for an R7 template';
      END IF;
      n:=n+1;
    END LOOP;
    -- The stored audit key is v1's own key, so equality proves the v1 dispatch (each
    -- call recomputes the physics key; the applier's 12 s transaction budget allows one).
    IF public.fn_gto_v31_public215_required_audit_for(c,board) IS DISTINCT FROM a.audit_key
       OR public.fn_gto_v31_public215_audit_key_for(c.feature_contract_version,c.model_checksum,c.template_checksum,a.chronological_board,a.physics_key) IS DISTINCT FROM a.audit_key
       OR public.fn_gto_v31_public215_audit_prediction_for(c,board,ac.combo) IS DISTINCT FROM public.fn_gto_v31_public215_audit_prediction(c,board,ac.combo) THEN
      RAISE EXCEPTION 'selftest: v1 dispatch differs from v1';
    END IF;
  END LOOP;
  IF n<4 THEN RAISE EXCEPTION 'selftest: too few live R7 audit rows (%)', n; END IF;
  -- v2 block: an R8 category set lights exactly its own four columns.
  t:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(c.public_template,'{context,hero_position}','"UTG"'),'{context,opponent_position}','"CO"'),'{context,facing_size_bucket}','"mid"'),'{scenario,ip_range_checksum}','"1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19"');
  app:=public.fn_gto_v31_public215_v2_appended(t);
  IF cardinality(app)<>31 OR app[1]<>1 OR app[4]<>1 OR (SELECT sum(v) FROM unnest(app) v)<>4 OR app[5]<>1 OR app[29]<>1 THEN
    RAISE EXCEPTION 'selftest: v2 appended one-hot %', app;
  END IF;
  -- A v2 copy refuses a v1 cell; a v1 model refuses a 246-wide vector through v2 inference shape.
  BEGIN PERFORM public.fn_gto_v31_public215_required_audit_v2(c,board); RAISE EXCEPTION 'selftest: v2 chain accepted a v1 cell';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'public215 v2 cell required' THEN RAISE; END IF; END;
  RAISE NOTICE 'public215 v2 SQL chain selftest ok: % R7 audited vectors unchanged', n;
END
$selftest$;

COMMIT;
