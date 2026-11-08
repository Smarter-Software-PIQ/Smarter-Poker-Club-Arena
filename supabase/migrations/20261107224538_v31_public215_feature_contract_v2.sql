-- 20261107224538_v31_public215_feature_contract_v2
--
-- WHAT THIS ADDS
--
-- Feature contract v2 (holdem-public-hist215-v2) for the R8 V31 playbook. R8's 100
-- cash cells use ROOT ranges, positions (UTG/HJ/CO) and the facing bucket 'mid'
-- that the frozen contract v1 (holdem-public-hist215-v1, 215 features, descriptor
-- 0ca054f9...) cannot encode. v2 keeps every v1 feature at its index with its
-- meaning and appends 31 one-hots (the 24 distinct ROOT range checksums of the R8
-- range bundle 7de4856b, hero/opponent UTG/HJ/CO, facing_size_bucket=mid): 246
-- features, descriptor c37e7aa2... (Club Arena GtoPublicHist215Contracts.ts and
-- GtoPublicHist215FeatureDescriptorV2.json; World Hub public_hist215.py derives the
-- same descriptor from v1 plus the block). A dataset declares exactly one version;
-- nothing is inferred.
--
-- Here the database admits v2 wherever it admits v1, with v2's own descriptor:
--   new  fn_gto_v31_public215_feature_schema(version)       -> descriptor sha
--        fn_gto_v31_public215_feature_contract_of_schema(sha) -> version
--        fn_gto_v31_public215_model_width(sha)              -> 246 for v2, else 215
--        fn_gto_v31_public215_template_valid_v2(t)          -> v1 validator, vocabulary
--                                                              widened by the v2 block only
--        fn_gto_v31_public215_template_valid_for(t,version) -> v1 or v2 validator
--   patched (exact-count anchors, md5-pinned pre- and postimages, ACL unchanged):
--        feature_identity, feature_request_valid, feature_key, hand_matrix_valid,
--        compact_matrices_valid, input_bundle_checksum, ca_..._approve_input_bundle,
--        public215_bundle_valid, public215_cell_model_valid, public215_model_valid,
--        public215_infer, public215_preparation_cell, prepare_model,
--        public215_selection_receipt
--   constraints: the feature_contract_version lists of input bundles, datasets and
--        runtime cells, the bundle numeric-identity check and the runtime-cell
--        payload check accept v2 exactly where they accept v1.
--
-- v1 IS UNCHANGED. For a v1 bundle, cell, program or model every patched function
-- returns what it returned before: the v1 descriptor and width are the same values
-- the literals were, and v1 templates are validated by the unchanged v1 validator.
-- No row is rewritten.
--
-- NOT CHANGED, ON PURPOSE: the independent SQL audit encoder (fn_gto_v31_public215_
-- features, _base181, _graph, _compile, _compiled_raw, _prepare_audit,
-- _audit_prediction, _required_audit). Their definitions are hashed into
-- fn_gto_v31_public215_encoding_implementation(), which R7's frozen programs, audits
-- and seal bind; editing any of them would change R7's sealed identity. They stay
-- v1 (215). A v2 dataset's heldout audits therefore need a separate v2 encoding
-- chain (new functions, version dispatch in audit and seal) before its seal stage;
-- capture, registration, model preparation and freeze do not use it.
--
-- Not a hot path: IMMUTABLE/STABLE validator functions and three small tables
-- (input bundles, datasets, runtime cells: a few hundred rows). Constraints are
-- replaced by supersets (every existing row satisfies the old one, hence the new).
--
-- @live-proof: md5(pg_get_functiondef('public.ca_gto_v31_approve_input_bundle(jsonb)'::regprocedure))='7ee8d66546306979b919baafd7cf501e' AND md5(pg_get_functiondef('public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure))='5cd5b1e9595700c73f7931b27e6d3189' AND md5(pg_get_functiondef('public.fn_gto_v31_feature_identity(text)'::regprocedure))='1d9d5f3c1847f328e839fa85e53313ee' AND md5(pg_get_functiondef('public.fn_gto_v31_feature_key(integer,text,text)'::regprocedure))='baf697018bb5f0ee8763eeac6363c0a7' AND md5(pg_get_functiondef('public.fn_gto_v31_feature_request_valid(jsonb)'::regprocedure))='32062f63cc21fec8331b3e11f27a4960' AND md5(pg_get_functiondef('public.fn_gto_v31_hand_matrix_valid(jsonb,text,text)'::regprocedure))='44039f9cc6eca89b8c48efd09ce685d0' AND md5(pg_get_functiondef('public.fn_gto_v31_input_bundle_checksum(jsonb)'::regprocedure))='5521c369ae46e18456804f71d38679bd' AND md5(pg_get_functiondef('public.fn_gto_v31_prepare_model(uuid,jsonb)'::regprocedure))='6edf5ac91a607b717075f89251fd4d18' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_bundle_valid(jsonb)'::regprocedure))='a7092080d9e7c8af9080bb0d13408a17' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_cell_model_valid(jsonb)'::regprocedure))='0786354a0288c663eb50df2847a2c81b' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_infer(jsonb,double precision[])'::regprocedure))='e474166ae8abab295a36b467e0ff6c59' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_model_valid(jsonb)'::regprocedure))='05276428b40b0dc868d6f1ef995c161a' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_preparation_cell(gto_v31_model_preparations)'::regprocedure))='9841d9c6229591b8c750ea6751391ca3' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_selection_receipt(jsonb,gto_v31_datasets,gto_v31_input_bundles,text)'::regprocedure))='aa69bb52bf9c9d549d6eac2b650774c0' AND md5(pg_get_functiondef('public.fn_gto_v31_public215_template_valid_v2(jsonb)'::regprocedure))='648e632f4932607e1601281ebeef0c4b'

BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog,public;

CREATE FUNCTION public.fn_gto_v31_public215_feature_schema(p_version text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $fn$
 SELECT CASE p_version WHEN 'holdem-public-hist215-v1' THEN '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f' WHEN 'holdem-public-hist215-v2' THEN 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4' END
$fn$;
CREATE FUNCTION public.fn_gto_v31_public215_feature_contract_of_schema(p_schema text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $fn$
 SELECT CASE p_schema WHEN '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f' THEN 'holdem-public-hist215-v1' WHEN 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4' THEN 'holdem-public-hist215-v2' END
$fn$;
-- Wire width of a model bound to a descriptor: v2 246; any other descriptor keeps
-- the v1 width 215 exactly as the v1 literal did (the descriptor itself is bound
-- to the dataset contract by cell_model_valid / prepare_model / bundle_valid).
CREATE FUNCTION public.fn_gto_v31_public215_model_width(p_schema text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $fn$
 SELECT CASE WHEN p_schema='c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4' THEN 246 ELSE 215 END
$fn$;
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
CREATE FUNCTION public.fn_gto_v31_public215_template_valid_for(p jsonb, p_version text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $fn$
 SELECT CASE p_version WHEN 'holdem-public-hist215-v1' THEN public.fn_gto_v31_public215_template_valid(p)
                       WHEN 'holdem-public-hist215-v2' THEN public.fn_gto_v31_public215_template_valid_v2(p) ELSE false END
$fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_feature_schema(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_feature_contract_of_schema(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_model_width(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_template_valid_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_public215_template_valid_for(jsonb,text) FROM PUBLIC, anon, authenticated, service_role;

DO $patch$
DECLARE patch record; anchor jsonb; def text; hits integer; acl text;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_feature_identity(text)'::regprocedure, '1252169c481e5cff964a16e84a1610c5', '[["IN(''rank-suit-count-v1'',''holdem-board-relative-v2'',''holdem-public-hist215-v1'')", "IN(''rank-suit-count-v1'',''holdem-board-relative-v2'',''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')"]]'::jsonb),
    ('public.fn_gto_v31_feature_request_valid(jsonb)'::regprocedure, '2cc987f4b0357472357e6e39816600b2', '[["IN(''rank-suit-count-v1'',''holdem-board-relative-v2'',''holdem-public-hist215-v1'')", "IN(''rank-suit-count-v1'',''holdem-board-relative-v2'',''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')"]]'::jsonb),
    ('public.fn_gto_v31_feature_key(integer,text,text)'::regprocedure, 'ccb9f80451d2eeeee3d3eb061b2ad3fc', '[["IF p_version=''holdem-public-hist215-v1'' THEN RAISE", "IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN RAISE"]]'::jsonb),
    ('public.fn_gto_v31_hand_matrix_valid(jsonb,text,text)'::regprocedure, '1542e7c78e62f90a5bd9237e7a065a04', '[["IF p_version = ''holdem-public-hist215-v1'' THEN", "IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN"]]'::jsonb),
    ('public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure, '9d772c7143c7a843e97d81d3d5474902', '[["IF p_version = ''holdem-public-hist215-v1'' THEN", "IF p_version IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'') THEN"]]'::jsonb),
    ('public.fn_gto_v31_input_bundle_checksum(jsonb)'::regprocedure, '8c011e85acad75217f42f7c5ed910436', '[["IF p_bundle->>''feature_contract_version''=''holdem-public-hist215-v1''AND", "IF p_bundle->>''feature_contract_version'' IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')AND"]]'::jsonb),
    ('public.ca_gto_v31_approve_input_bundle(jsonb)'::regprocedure, '01be10e3c34c3eea365089b21b2fba9c', '[["p_bundle,actor,''holdem-public-hist215-v1'',", "p_bundle,actor,p_bundle->>''feature_contract_version'',"]]'::jsonb),
    ('public.fn_gto_v31_public215_bundle_valid(jsonb)'::regprocedure, '9b027b1bd01d0e632f4e45d158178a14', '[["p->>''feature_contract_version''<>''holdem-public-hist215-v1''", "p->>''feature_contract_version'' NOT IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')"], ["IF public.fn_gto_v31_public215_digest(protocols->''feature_schema'')<>''0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f'' THEN", "IF public.fn_gto_v31_public215_digest(protocols->''feature_schema'') IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(p->>''feature_contract_version'') THEN"], ["context_entry->>''feature_schema_checksum''<>''0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f''", "context_entry->>''feature_schema_checksum'' IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(p->>''feature_contract_version'')"]]'::jsonb),
    ('public.fn_gto_v31_public215_cell_model_valid(jsonb)'::regprocedure, '3854a4d3309cca878a12ff6ea06e6399', '[["p->>''feature_contract_version'' IS DISTINCT FROM ''holdem-public-hist215-v1''", "p->>''feature_contract_version'' NOT IN(''holdem-public-hist215-v1'',''holdem-public-hist215-v2'')"], ["public.fn_gto_v31_public215_template_valid(t) IS NOT TRUE", "public.fn_gto_v31_public215_template_valid_for(t,p->>''feature_contract_version'') IS NOT TRUE"], ["p->>''feature_schema_checksum'' IS DISTINCT FROM ''0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f''", "p->>''feature_schema_checksum'' IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(p->>''feature_contract_version'')"]]'::jsonb),
    ('public.fn_gto_v31_public215_model_valid(jsonb)'::regprocedure, '2d43575417a3f847e9e8f719f863caf7', '[["f double precision;\nBEGIN\n", "f double precision;width integer;\nBEGIN\n width:=public.fn_gto_v31_public215_model_width(p->>''feature_schema_sha256'');\n"], ["p->''feature_count''<>''215''::jsonb", "p->''feature_count''<>to_jsonb(width)"], ["(node->>''feature'')::numeric>214", "(node->>''feature'')::numeric>=width"]]'::jsonb),
    ('public.fn_gto_v31_public215_infer(jsonb,double precision[])'::regprocedure, 'c0244365652cbd3b9687208a0a1f533d', '[["cardinality(p_x)<>215", "cardinality(p_x)<>public.fn_gto_v31_public215_model_width(p_model->>''feature_schema_sha256'')"]]'::jsonb),
    ('public.fn_gto_v31_public215_preparation_cell(gto_v31_model_preparations)'::regprocedure, '3fc3f09a4eb5c3497c4a49f5363b96f6', '[["''feature_contract_version'',''holdem-public-hist215-v1''", "''feature_contract_version'',public.fn_gto_v31_public215_feature_contract_of_schema(p.program->>''feature_schema_checksum'')"]]'::jsonb),
    ('public.fn_gto_v31_prepare_model(uuid,jsonb)'::regprocedure, '04f244517d103efb3eb532376a427eae', '[["public.fn_gto_v31_public215_template_valid(p_program->''public_template'')IS NOT TRUE", "public.fn_gto_v31_public215_template_valid_for(p_program->''public_template'',d.feature_contract_version)IS NOT TRUE"], ["p_program->>''feature_schema_checksum''IS DISTINCT FROM ''0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f''", "p_program->>''feature_schema_checksum''IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(d.feature_contract_version)"]]'::jsonb),
    ('public.fn_gto_v31_public215_selection_receipt(jsonb,gto_v31_datasets,gto_v31_input_bundles,text)'::regprocedure, 'c207293753bcf626743252050212ea0a', '[["p->>''feature_schema_checksum'' IS DISTINCT FROM ''0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f''", "p->>''feature_schema_checksum'' IS DISTINCT FROM public.fn_gto_v31_public215_feature_schema(d.feature_contract_version)"]]'::jsonb)
  ) AS p(fn,pre_md5,anchors) LOOP
    def:=pg_get_functiondef(patch.fn);
    IF md5(def) IS DISTINCT FROM patch.pre_md5 THEN
      RAISE EXCEPTION '% preimage changed (md5 %), refusing to patch', patch.fn, md5(def);
    END IF;
    acl:=(SELECT proacl::text FROM pg_proc WHERE oid=patch.fn);
    FOR anchor IN SELECT value FROM jsonb_array_elements(patch.anchors) LOOP
      hits:=(length(def)-length(replace(def,anchor->>0,'')))/length(anchor->>0);
      IF hits<>1 THEN RAISE EXCEPTION '% anchor found % times, expected exactly 1: %', patch.fn, hits, anchor->>0; END IF;
      def:=replace(def,anchor->>0,anchor->>1);
    END LOOP;
    EXECUTE def;
    IF (SELECT proacl::text FROM pg_proc WHERE oid=patch.fn) IS DISTINCT FROM acl THEN
      RAISE EXCEPTION '% ACL changed', patch.fn;
    END IF;
  END LOOP;
END
$patch$;

DO $postimage$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.ca_gto_v31_approve_input_bundle(jsonb)'::regprocedure,'7ee8d66546306979b919baafd7cf501e'),
    ('public.fn_gto_v31_compact_matrices_valid(jsonb,jsonb,jsonb,jsonb,text,text)'::regprocedure,'5cd5b1e9595700c73f7931b27e6d3189'),
    ('public.fn_gto_v31_feature_identity(text)'::regprocedure,'1d9d5f3c1847f328e839fa85e53313ee'),
    ('public.fn_gto_v31_feature_key(integer,text,text)'::regprocedure,'baf697018bb5f0ee8763eeac6363c0a7'),
    ('public.fn_gto_v31_feature_request_valid(jsonb)'::regprocedure,'32062f63cc21fec8331b3e11f27a4960'),
    ('public.fn_gto_v31_hand_matrix_valid(jsonb,text,text)'::regprocedure,'44039f9cc6eca89b8c48efd09ce685d0'),
    ('public.fn_gto_v31_input_bundle_checksum(jsonb)'::regprocedure,'5521c369ae46e18456804f71d38679bd'),
    ('public.fn_gto_v31_prepare_model(uuid,jsonb)'::regprocedure,'6edf5ac91a607b717075f89251fd4d18'),
    ('public.fn_gto_v31_public215_bundle_valid(jsonb)'::regprocedure,'a7092080d9e7c8af9080bb0d13408a17'),
    ('public.fn_gto_v31_public215_cell_model_valid(jsonb)'::regprocedure,'0786354a0288c663eb50df2847a2c81b'),
    ('public.fn_gto_v31_public215_infer(jsonb,double precision[])'::regprocedure,'e474166ae8abab295a36b467e0ff6c59'),
    ('public.fn_gto_v31_public215_model_valid(jsonb)'::regprocedure,'05276428b40b0dc868d6f1ef995c161a'),
    ('public.fn_gto_v31_public215_preparation_cell(gto_v31_model_preparations)'::regprocedure,'9841d9c6229591b8c750ea6751391ca3'),
    ('public.fn_gto_v31_public215_selection_receipt(jsonb,gto_v31_datasets,gto_v31_input_bundles,text)'::regprocedure,'aa69bb52bf9c9d549d6eac2b650774c0'),
    ('public.fn_gto_v31_public215_template_valid_v2(jsonb)'::regprocedure,'648e632f4932607e1601281ebeef0c4b')
  ) AS p(fn,post_md5) LOOP
    IF md5(pg_get_functiondef(r.fn)) IS DISTINCT FROM r.post_md5 THEN
      RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage', r.fn, md5(pg_get_functiondef(r.fn));
    END IF;
  END LOOP;
END
$postimage$;

-- Constraints: supersets that admit v2 exactly where v1 is admitted. Each live
-- definition is md5-pinned and rewritten by exact-count text replacement.
DO $constraints$
DECLARE r record; def text; e jsonb; hits integer;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.gto_v31_datasets'::regclass,'gto_v31_datasets_feature_contract_version_check','424a43e6c1f2a4250c187b03756d6462','[["''holdem-public-hist215-v1''::text]", "''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]"]]'::jsonb),
    ('public.gto_v31_datasets'::regclass,'gto_v31_datasets_numeric_representation_identity_chk','781ee388e368707fa9a7904932e309bc','[["(feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v1''::text)", "(feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v1''::text) AND (feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v2''::text)"], ["(feature_contract_version = ''holdem-public-hist215-v1''::text)", "(feature_contract_version = ANY (ARRAY[''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]))"]]'::jsonb),
    ('public.gto_v31_input_bundles'::regclass,'gto_v31_input_bundles_feature_contract_version_check','424a43e6c1f2a4250c187b03756d6462','[["''holdem-public-hist215-v1''::text]", "''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]"]]'::jsonb),
    ('public.gto_v31_input_bundles'::regclass,'gto_v31_input_bundles_numeric_representation_identity_chk','781ee388e368707fa9a7904932e309bc','[["(feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v1''::text)", "(feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v1''::text) AND (feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v2''::text)"], ["(feature_contract_version = ''holdem-public-hist215-v1''::text)", "(feature_contract_version = ANY (ARRAY[''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]))"]]'::jsonb),
    ('public.gto_v31_runtime_cells'::regclass,'gto_v31_runtime_cells_feature_contract_version_check','424a43e6c1f2a4250c187b03756d6462','[["''holdem-public-hist215-v1''::text]", "''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]"]]'::jsonb),
    ('public.gto_v31_runtime_cells'::regclass,'gto_v31_runtime_cells_numeric_representation_identity_chk','781ee388e368707fa9a7904932e309bc','[["(feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v1''::text)", "(feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v1''::text) AND (feature_contract_version IS DISTINCT FROM ''holdem-public-hist215-v2''::text)"], ["(feature_contract_version = ''holdem-public-hist215-v1''::text)", "(feature_contract_version = ANY (ARRAY[''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]))"]]'::jsonb),
    ('public.gto_v31_runtime_cells'::regclass,'gto_v31_runtime_cells_representation_payload_chk','b8e16eed9922915e733996bce332df1a','[["(feature_contract_version = ''holdem-public-hist215-v1''::text)", "(feature_contract_version = ANY (ARRAY[''holdem-public-hist215-v1''::text, ''holdem-public-hist215-v2''::text]))"]]'::jsonb)
  ) AS p(tbl,con,pre_md5,anchors) LOOP
    SELECT pg_get_constraintdef(c.oid) INTO STRICT def FROM pg_constraint c WHERE c.conrelid=r.tbl AND c.conname=r.con;
    IF md5(def) IS DISTINCT FROM r.pre_md5 THEN RAISE EXCEPTION '%.% preimage changed (md5 %)', r.tbl, r.con, md5(def); END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(r.anchors) LOOP
      hits:=(length(def)-length(replace(def,e->>0,'')))/length(e->>0);
      IF hits<>1 THEN RAISE EXCEPTION '%.% anchor found % times: %', r.tbl, r.con, hits, e->>0; END IF;
      def:=replace(def,e->>0,e->>1);
    END LOOP;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s', r.tbl, r.con, r.con, def);
  END LOOP;
END
$constraints$;

-- Self-test (inside the transaction: any failure rolls the whole migration back).
DO $selftest$
DECLARE t jsonb; t2 jsonb; c record; n integer:=0; ok boolean;
BEGIN
  IF public.fn_gto_v31_public215_feature_schema('holdem-public-hist215-v1') IS DISTINCT FROM '0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f'
     OR public.fn_gto_v31_public215_feature_schema('holdem-public-hist215-v2') IS DISTINCT FROM 'c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4'
     OR public.fn_gto_v31_public215_feature_schema('holdem-board-relative-v2') IS NOT NULL
     OR public.fn_gto_v31_public215_feature_contract_of_schema('c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4') IS DISTINCT FROM 'holdem-public-hist215-v2'
     OR public.fn_gto_v31_public215_feature_contract_of_schema('0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f') IS DISTINCT FROM 'holdem-public-hist215-v1'
     OR public.fn_gto_v31_public215_model_width('c37e7aa2b2dde3f71cde7d224594de637ab66c928c6dffd94661fec3f7ac80c4')<>246
     OR public.fn_gto_v31_public215_model_width('0ca054f9bb0463bf6a298a80a29cb4b6d9e6bffcc193e4af9d497e2936ec849f')<>215 THEN
    RAISE EXCEPTION 'selftest: descriptor/width mapping';
  END IF;
  IF public.fn_gto_v31_feature_identity('holdem-public-hist215-v2') IS NOT DISTINCT FROM public.fn_gto_v31_feature_identity('holdem-public-hist215-v1') THEN
    RAISE EXCEPTION 'selftest: v2 feature identity must differ from v1';
  END IF;
  -- v1 unchanged: every live public215 template, and the models of the first 8 cells
  -- (model_valid costs about 0.45 s per model; all of them would hold the lock for minutes).
  FOR c IN SELECT public_template, public_model FROM public.gto_v31_runtime_cells WHERE policy_representation='public_hist215_v1' LOOP
    n:=n+1;
    IF public.fn_gto_v31_public215_template_valid(c.public_template) IS NOT TRUE
       OR public.fn_gto_v31_public215_template_valid_for(c.public_template,'holdem-public-hist215-v1') IS NOT TRUE
       OR public.fn_gto_v31_public215_template_valid_v2(c.public_template) IS NOT TRUE
       OR (n<=8 AND public.fn_gto_v31_public215_model_valid(c.public_model) IS NOT TRUE) THEN
      RAISE EXCEPTION 'selftest: a live v1 cell no longer validates';
    END IF;
    IF n=1 THEN t:=c.public_template; PERFORM public.fn_gto_v31_public215_infer(c.public_model, array_fill(0::double precision,ARRAY[215])); END IF;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'selftest: no live public215 cells to prove v1 against'; END IF;
  -- v2 vocabulary: accepted by v2 only; nothing beyond the appended block.
  t2:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(t,'{context,hero_position}','"UTG"'),'{context,opponent_position}','"CO"'),'{context,facing_size_bucket}','"mid"'),'{scenario,ip_range_checksum}',to_jsonb('1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19'::text));
  IF public.fn_gto_v31_public215_template_valid(t2) OR public.fn_gto_v31_public215_template_valid_for(t2,'holdem-public-hist215-v1')
     OR public.fn_gto_v31_public215_template_valid_v2(t2) IS NOT TRUE OR public.fn_gto_v31_public215_template_valid_for(t2,'holdem-public-hist215-v2') IS NOT TRUE
     OR public.fn_gto_v31_public215_template_valid_for(t2,'holdem-board-relative-v2')
     OR public.fn_gto_v31_public215_template_valid_v2(jsonb_set(t2,'{context,hero_position}','"MP"'))
     OR public.fn_gto_v31_public215_template_valid_v2(jsonb_set(t2,'{context,facing_size_bucket}','"large"'))
     OR public.fn_gto_v31_public215_template_valid_v2(jsonb_set(t2,'{scenario,oop_range_checksum}','"1eff0dca52c74b86d77a314c3554cb7357e42e3979bda3970e306dd242e63b19"')) THEN
    RAISE EXCEPTION 'selftest: v2 template vocabulary';
  END IF;
  -- Width: a v1 model refuses a 246 vector.
  ok:=false;
  BEGIN
    PERFORM public.fn_gto_v31_public215_infer((SELECT public_model FROM public.gto_v31_runtime_cells WHERE policy_representation='public_hist215_v1' LIMIT 1), array_fill(0::double precision,ARRAY[246]));
  EXCEPTION WHEN OTHERS THEN ok:=true; END;
  IF NOT ok THEN RAISE EXCEPTION 'selftest: v1 model accepted a 246-wide vector'; END IF;
  RAISE NOTICE 'public215 v2 selftest ok: % live v1 cells unchanged', n;
END
$selftest$;

COMMIT;
