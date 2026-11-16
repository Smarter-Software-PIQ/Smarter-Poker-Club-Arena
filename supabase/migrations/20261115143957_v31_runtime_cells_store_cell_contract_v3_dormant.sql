-- 20261115143957_v31_runtime_cells_store_cell_contract_v3_dormant.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (FLOP-5 D6, V31 cell contract v3, DORMANT):
--
-- Cell contract v3 (merged in #10710: engine classifier and store, round
-- registration guard) keys a V31 cell by the 13 v2 context fields plus its
-- size-bucketed public line (line_class), adds the 200 bb depth bucket and the
-- role 'donk'. A v3 round can be registered, but gto_v31_runtime_cells could
-- not hold a v3 cell: no cell_contract_version or line_class column, depth
-- 10..150 only, no 'donk', and a unique key on the 13 fields that refuses two
-- lines of one spot. Here the table learns to store one, and the engine gets a
-- reader for it, with every existing answer unchanged:
--
--   gto_v31_runtime_cells
--     + cell_contract_version text  (NULL = v2, every existing row; 'v3' only)
--     + line_class text             (NULL on v2; on v3 the line grammar of
--                                    fn_gto_v31_cell_contract_v3_error, one '/'
--                                    per street after the flop)
--     depth 200 and role 'donk' (open node: facing none) only on a v3 row;
--     a v3 row may not declare holdem-public-hist215-v1 or -v2 (the coupling
--     rule of #10710). holdem-public-hist215-v3 model cells are NOT admitted
--     here: the feature-contract checks and the SQL encoding chain stay v1/v2,
--     so a v3 cell is a matrix cell until that separate change exists.
--     The unique key gains (cell_contract_version, line_class) NULLS NOT
--     DISTINCT under the same constraint name: identical for every v2 row.
--     cell_contract_version and line_class are immutable once written.
--   fn_gto_v31_active_cells / fn_gto_v31_evaluation_cells (the v2 readers)
--     never return a v3 cell (one added predicate, generated from the installed
--     text by exact-count anchors, md5-pinned before and after, ACL unchanged).
--     For every row that exists today the answer is identical.
--   + fn_gto_v31_active_cells_v3 / fn_gto_v31_evaluation_cells_v3: the same
--     readers plus the two new columns and line_class as the last sort key,
--     generated from the same installed text; same ACL (service_role).
--     Read by the engine only when its default-OFF switch
--     GTO_V31_CELL_CONTRACT_V3_SERVING is on.
--   + fn_gto_v31_registration_cell_contract(dataset_key): the cell contract a
--     dataset key's round registration declares ('v3' when every registered
--     cell is v3), for the World Hub solver gateway. service_role only.
--
-- Additive and safe with existing rows: two nullable columns (no rewrite),
-- every replaced constraint is a superset of the old one for v2 rows, no row
-- is changed, nothing is registered, promoted or bound. Not a hot table
-- (462 rows on 2026-11-15); no install-window header needed.
--
-- @live-proof: EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.gto_v31_runtime_cells'::regclass AND attname='line_class' AND NOT attisdropped) AND md5(pg_get_functiondef('public.fn_gto_v31_active_cells(integer,integer)'::regprocedure))='d491907b65b048dbee79e424dab2f509' AND md5(pg_get_functiondef('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)'::regprocedure))='5d64b066a508fc9f792e34b0268dedf9'

BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL search_path=pg_catalog,public;

-- 1. Preimages: refuse to run against anything but the reviewed live text.
DO $pin$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_active_cells(integer,integer)'::regprocedure, '917c8085678328fc74fe769e95c59190'),
    ('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)'::regprocedure, '41417b2db70833c68796610c296fb56b')
  ) AS p(fn, pre_md5) LOOP
    IF md5(pg_get_functiondef(r.fn)) IS DISTINCT FROM r.pre_md5 THEN
      RAISE EXCEPTION '% preimage changed (md5 %), refusing to patch', r.fn, md5(pg_get_functiondef(r.fn));
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
    ('gto_v31_runtime_cells_depth_bucket_check', 'cedf856b8fb44e4349195540e92d5920'),
    ('gto_v31_runtime_cells_node_role_check', '95bc518d9cbbdb61cb7658c1e7e0edf4'),
    ('gto_v31_runtime_cells_check4', 'c895ef2439525875343a366e4ee4b618'),
    ('gto_v31_runtime_cells_dataset_id_street_game_family_objecti_key', 'bf13c20c93535fd41d1450233fd3fb4e')
  ) AS p(con, pre_md5) LOOP
    IF (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c
         WHERE c.conrelid='public.gto_v31_runtime_cells'::regclass AND c.conname=r.con) IS DISTINCT FROM r.pre_md5 THEN
      RAISE EXCEPTION 'gto_v31_runtime_cells.% preimage changed, refusing to patch', r.con;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.gto_v31_runtime_cells'::regclass
              AND attname IN ('cell_contract_version','line_class') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'gto_v31_runtime_cells already has a cell contract column';
  END IF;
END
$pin$;

-- 2. The table: columns, v3-only checks, immutability, the line-aware key.
ALTER TABLE public.gto_v31_runtime_cells
  ADD COLUMN cell_contract_version text,
  ADD COLUMN line_class text,
  -- Every new check is "(...) IS TRUE": a NULL column must never let a row
  -- through by making the expression unknown.
  ADD CONSTRAINT gto_v31_runtime_cells_cell_contract_v3_chk CHECK ((
    (cell_contract_version IS NULL AND line_class IS NULL)
    OR (cell_contract_version = 'v3'
        AND line_class IS NOT NULL
        AND length(line_class) <= 256
        AND line_class ~ '^((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?(/((x|c|a|[br]-(small|mid|big))([.](x|c|a|[br]-(small|mid|big)))*)?){0,2}$'
        AND length(line_class) - length(replace(line_class, '/', '')) = CASE street WHEN 'flop' THEN 0 WHEN 'turn' THEN 1 WHEN 'river' THEN 2 END
        AND (feature_contract_version IS NULL
             OR feature_contract_version NOT IN ('holdem-public-hist215-v1', 'holdem-public-hist215-v2')))) IS TRUE),
  DROP CONSTRAINT gto_v31_runtime_cells_depth_bucket_check,
  ADD CONSTRAINT gto_v31_runtime_cells_depth_bucket_check CHECK ((
    depth_bucket = ANY (ARRAY[10, 20, 40, 80, 150])
    OR (cell_contract_version = 'v3' AND depth_bucket = 200)) IS TRUE),
  DROP CONSTRAINT gto_v31_runtime_cells_node_role_check,
  ADD CONSTRAINT gto_v31_runtime_cells_node_role_check CHECK ((
    node_role = ANY (ARRAY['open'::text, 'cbet'::text, 'probe'::text, 'delayed_cbet'::text, 'barrel'::text, 'facing_bet'::text, 'facing_raise'::text, 'check_raise'::text, 'bet_raise'::text, 'all_in'::text])
    OR (cell_contract_version = 'v3' AND node_role = 'donk')) IS TRUE),
  DROP CONSTRAINT gto_v31_runtime_cells_check4,
  ADD CONSTRAINT gto_v31_runtime_cells_check4 CHECK ((
    (((node_role = ANY (ARRAY['open'::text, 'cbet'::text, 'probe'::text, 'delayed_cbet'::text, 'barrel'::text])) AND (facing_kind = 'none'::text) AND (facing_size_bucket = 'none'::text)) OR ((node_role = 'all_in'::text) AND (facing_kind = 'all_in'::text) AND (facing_size_bucket = 'all_in'::text)) OR ((node_role = 'facing_bet'::text) AND (facing_kind = 'bet'::text) AND (facing_size_bucket = ANY (ARRAY['small'::text, 'mid'::text, 'big'::text]))) OR ((node_role = ANY (ARRAY['facing_raise'::text, 'check_raise'::text, 'bet_raise'::text])) AND (facing_kind = 'raise'::text) AND (facing_size_bucket = ANY (ARRAY['small'::text, 'mid'::text, 'big'::text]))))
    OR (cell_contract_version = 'v3' AND node_role = 'donk' AND facing_kind = 'none' AND facing_size_bucket = 'none')) IS TRUE),
  DROP CONSTRAINT gto_v31_runtime_cells_dataset_id_street_game_family_objecti_key,
  ADD CONSTRAINT gto_v31_runtime_cells_dataset_id_street_game_family_objecti_key UNIQUE NULLS NOT DISTINCT
    (dataset_id, street, game_family, objective, utility_context, table_size, pot_type, hero_position,
     opponent_position, depth_bucket, texture_class, node_role, facing_kind, facing_size_bucket,
     cell_contract_version, line_class);

CREATE FUNCTION public.fn_gto_v31_runtime_cell_contract_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $fn$
BEGIN
  IF NEW.cell_contract_version IS DISTINCT FROM OLD.cell_contract_version
     OR NEW.line_class IS DISTINCT FROM OLD.line_class THEN
    RAISE EXCEPTION 'a runtime cell''s cell contract and line class are immutable';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_runtime_cell_contract_immutable() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gto_v31_runtime_cells_cell_contract_immutable BEFORE UPDATE OF cell_contract_version, line_class
  ON public.gto_v31_runtime_cells FOR EACH ROW EXECUTE FUNCTION public.fn_gto_v31_runtime_cell_contract_immutable();

-- 3. The v3 readers, generated from the installed text before step 4 patches it,
-- with the source ACL (service_role).
DO $reader_absence$
BEGIN
  IF to_regprocedure('public.fn_gto_v31_active_cells_v3(integer,integer)') IS NOT NULL
     OR to_regprocedure('public.fn_gto_v31_evaluation_cells_v3(uuid,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'v3 reader already exists';
  END IF;
END $reader_absence$;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_active_cells_v3(p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(dataset_id uuid, dataset_key text, dataset_checksum text, solver_version text, solver_binary_checksum text, pipeline_commit text, pipeline_bundle_checksum text, manifest_version text, manifest_checksum text, source_artifact_checksum text, source_combo_order_checksum text, range_bundle_checksum text, icm_model_checksum text, input_bundle_checksum text, cell_key_checksum text, cell_payload_checksum text, lineage_checksum text, quality_status text, dataset_state text, dataset_cells bigint, source_rows bigint, train_source_rows bigint, holdout_source_rows bigint, invalid_rows bigint, audited_at timestamp with time zone, street text, game_family text, objective text, utility_context text, table_size smallint, pot_type text, hero_position text, opponent_position text, depth_bucket integer, texture_class text, node_role text, facing_kind text, facing_size_bucket text, hand_matrix jsonb, action_specs jsonb, policy_ev_matrix jsonb, action_ev_matrix jsonb, feature_contract_version text, policy_export_schema text, policy_representation text, public_model jsonb, public_template jsonb, public_training_provenance jsonb, public_model_build_receipt jsonb, model_checksum text, template_checksum text, feature_schema_checksum text, training_provenance_checksum text, model_build_receipt_checksum text, cell_contract_version text, line_class text)
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
         c.policy_ev_matrix,c.action_ev_matrix,d.feature_contract_version,d.policy_export_schema,c.policy_representation,c.public_model,c.public_template,c.public_training_provenance,c.public_model_build_receipt,c.model_checksum,c.template_checksum,c.feature_schema_checksum,c.training_provenance_checksum,c.model_build_receipt_checksum,c.cell_contract_version,c.line_class
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
            c.facing_kind, c.facing_size_bucket, c.line_class
   OFFSET greatest(COALESCE(p_offset,0),0)
   LIMIT greatest(1,least(COALESCE(p_limit,500),CASE WHEN EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE state='active' AND policy_representation='public_hist215_v1') THEN 1 ELSE 500 END));
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_evaluation_cells_v3(p_dataset_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(dataset_id uuid, dataset_key text, dataset_checksum text, solver_version text, solver_binary_checksum text, pipeline_commit text, pipeline_bundle_checksum text, manifest_version text, manifest_checksum text, source_artifact_checksum text, source_combo_order_checksum text, range_bundle_checksum text, icm_model_checksum text, input_bundle_checksum text, cell_key_checksum text, cell_payload_checksum text, lineage_checksum text, quality_status text, dataset_state text, dataset_cells bigint, source_rows bigint, train_source_rows bigint, holdout_source_rows bigint, invalid_rows bigint, audited_at timestamp with time zone, street text, game_family text, objective text, utility_context text, table_size smallint, pot_type text, hero_position text, opponent_position text, depth_bucket integer, texture_class text, node_role text, facing_kind text, facing_size_bucket text, hand_matrix jsonb, action_specs jsonb, policy_ev_matrix jsonb, action_ev_matrix jsonb, feature_contract_version text, policy_export_schema text, policy_representation text, public_model jsonb, public_template jsonb, public_training_provenance jsonb, public_model_build_receipt jsonb, model_checksum text, template_checksum text, feature_schema_checksum text, training_provenance_checksum text, model_build_receipt_checksum text, cell_contract_version text, line_class text)
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
         c.hand_matrix,c.action_specs,c.policy_ev_matrix,c.action_ev_matrix,d.feature_contract_version,d.policy_export_schema,c.policy_representation,c.public_model,c.public_template,c.public_training_provenance,c.public_model_build_receipt,c.model_checksum,c.template_checksum,c.feature_schema_checksum,c.training_provenance_checksum,c.model_build_receipt_checksum,c.cell_contract_version,c.line_class
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
     c.node_role,c.facing_kind,c.facing_size_bucket,c.line_class
   OFFSET greatest(COALESCE(p_offset,0),0)
   LIMIT greatest(1,least(COALESCE(p_limit,500),CASE WHEN EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1') THEN 1 ELSE 500 END));
$function$
;

DO $readers$
DECLARE r record; def text; e jsonb; hits integer; acl text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_active_cells(integer,integer)'::regprocedure,
     'public.fn_gto_v31_active_cells_v3(integer,integer)',
     '[["FUNCTION public.fn_gto_v31_active_cells(", "FUNCTION public.fn_gto_v31_active_cells_v3("],
       ["model_build_receipt_checksum text)\n LANGUAGE sql", "model_build_receipt_checksum text, cell_contract_version text, line_class text)\n LANGUAGE sql"],
       ["c.model_build_receipt_checksum\n    FROM", "c.model_build_receipt_checksum,c.cell_contract_version,c.line_class\n    FROM"],
       ["c.facing_kind, c.facing_size_bucket\n   OFFSET", "c.facing_kind, c.facing_size_bucket, c.line_class\n   OFFSET"]]'::jsonb),
    ('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)'::regprocedure,
     'public.fn_gto_v31_evaluation_cells_v3(uuid,integer,integer)',
     '[["FUNCTION public.fn_gto_v31_evaluation_cells(", "FUNCTION public.fn_gto_v31_evaluation_cells_v3("],
       ["model_build_receipt_checksum text)\n LANGUAGE sql", "model_build_receipt_checksum text, cell_contract_version text, line_class text)\n LANGUAGE sql"],
       ["c.model_build_receipt_checksum\n    FROM", "c.model_build_receipt_checksum,c.cell_contract_version,c.line_class\n    FROM"],
       ["c.node_role,c.facing_kind,c.facing_size_bucket\n   OFFSET", "c.node_role,c.facing_kind,c.facing_size_bucket,c.line_class\n   OFFSET"]]'::jsonb)
  ) AS p(src, dst, anchors) LOOP
    def := pg_get_functiondef(r.src);
    FOR e IN SELECT value FROM jsonb_array_elements(r.anchors) LOOP
      hits := (length(def) - length(replace(def, e->>0, ''))) / length(e->>0);
      IF hits <> 1 THEN RAISE EXCEPTION '% anchor found % times, expected exactly 1: %', r.src, hits, e->>0; END IF;
      def := replace(def, e->>0, e->>1);
    END LOOP;
    IF pg_get_functiondef(to_regprocedure(r.dst)) IS DISTINCT FROM def THEN
      RAISE EXCEPTION '% differs from its reviewed source transformation', r.dst;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.dst);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.dst);
    acl := (SELECT proacl::text FROM pg_proc WHERE oid = r.src);
    IF (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.dst)) IS DISTINCT FROM acl THEN
      RAISE EXCEPTION '% ACL % differs from its source ACL %', r.dst,
        (SELECT proacl::text FROM pg_proc WHERE oid = to_regprocedure(r.dst)), acl;
    END IF;
  END LOOP;
END
$readers$;

-- 4. The v2 readers never return a v3 cell.
DO $patch$
DECLARE r record; def text; hits integer; acl text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_active_cells(integer,integer)'::regprocedure,
     E'\n   WHERE d.state=''active'' AND', E'\n   WHERE c.cell_contract_version IS NULL AND d.state=''active'' AND'),
    ('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)'::regprocedure,
     E'\n   WHERE d.dataset_id=p_dataset_id AND', E'\n   WHERE c.cell_contract_version IS NULL AND d.dataset_id=p_dataset_id AND')
  ) AS p(fn, anchor, replacement) LOOP
    def := pg_get_functiondef(r.fn);
    acl := (SELECT proacl::text FROM pg_proc WHERE oid = r.fn);
    hits := (length(def) - length(replace(def, r.anchor, ''))) / length(r.anchor);
    IF hits <> 1 THEN RAISE EXCEPTION '% anchor found % times, expected exactly 1', r.fn, hits; END IF;
    EXECUTE replace(def, r.anchor, r.replacement);
    IF (SELECT proacl::text FROM pg_proc WHERE oid = r.fn) IS DISTINCT FROM acl THEN
      RAISE EXCEPTION '% ACL changed', r.fn;
    END IF;
  END LOOP;
END
$patch$;

-- 5. The registration's cell contract, for the solver gateway.
CREATE FUNCTION public.fn_gto_v31_registration_cell_contract(p_dataset_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'contract', 'smarter-poker.gto-v31-registration-cell-contract.v1',
      'dataset_key', r.dataset_key,
      'dataset_id', r.dataset_id,
      'cell_contract', CASE
        WHEN jsonb_typeof(r.cells) = 'array' AND jsonb_array_length(r.cells) > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.cells) c
                          WHERE jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'cell_contract' IS DISTINCT FROM 'v3')
        THEN 'v3' ELSE 'v2' END)
      FROM public.gto_v31_round_registrations r
     WHERE r.dataset_key = p_dataset_key);
END $fn$;
REVOKE ALL ON FUNCTION public.fn_gto_v31_registration_cell_contract(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_registration_cell_contract(text) TO service_role;

-- 6. Postimages: the four reader definitions are exactly the reviewed ones.
DO $postimage$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_active_cells(integer,integer)', 'd491907b65b048dbee79e424dab2f509'),
    ('public.fn_gto_v31_evaluation_cells(uuid,integer,integer)', '5d64b066a508fc9f792e34b0268dedf9'),
    ('public.fn_gto_v31_active_cells_v3(integer,integer)', '38acbadc37f41bb2cfe52849f54f8fc7'),
    ('public.fn_gto_v31_evaluation_cells_v3(uuid,integer,integer)', '8beeca04171d22c6b1d18b26ee9ad8b6')
  ) AS p(fn, post_md5) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.fn))) IS DISTINCT FROM r.post_md5 THEN
      RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage', r.fn, md5(pg_get_functiondef(to_regprocedure(r.fn)));
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.gto_v31_runtime_cells WHERE cell_contract_version IS NOT NULL OR line_class IS NOT NULL) THEN
    RAISE EXCEPTION 'existing runtime cells must all read as v2';
  END IF;
END
$postimage$;

COMMIT;
