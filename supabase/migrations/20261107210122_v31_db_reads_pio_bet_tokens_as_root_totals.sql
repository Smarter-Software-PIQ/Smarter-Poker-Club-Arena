-- 20261107210122_v31_db_reads_pio_bet_tokens_as_root_totals
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 21:01:22 UTC.
--
-- WHAT WAS WRONG
--
-- A PioSOLVER wager token `bN` in a node id names the acting player's TOTAL
-- chips committed since the root (the flop), across streets, not the amount
-- on the current street. Confirmed 2026-11-07 on the approved Pio 3.8.0
-- binary on M1: add_line 0 250 250 250 500 500 500 500 on a 500 pot names a
-- 250-chip turn bet after a 250-chip flop call `r:0:c:b250:c:7d:c:b500`, and
-- show_node reports spent OOP 250 / IP 500. World Hub PR #2705 (merged
-- 2026-11-07 20:57 UTC) corrected the Python pipeline (pio_upi.py
-- analyze_node / complete_node_state / _action_spec subtract the chips each
-- player spent on earlier streets). The database's own derivations still read
-- the token as a street amount:
--
--   public.fn_gto_v31_node_line_proof        v_target := N
--   public.fn_gto_v31_complete_public_state  target   := N
--   public.fn_gto_v31_source_node_v3_fields_valid
--        requires node_context.facing_target_chips = N for a facing node
--
-- so for any source node whose path holds a wager after money went in on an
-- earlier street the DB derived a different street target, pot, facing
-- bucket and complete public state than Pio solved (and than the corrected
-- exporter now writes), and ingest (fn_gto_v31_source_node_valid via the v3
-- and v4 validators) refused the node or would have admitted a mis-derived
-- one. A cumulative turn/river jam (N = effective stack) was refused outright
-- as exceeding the stack. These are the only V31 ingest/validator functions
-- that read a wager amount out of a Pio action path (pg_proc prosrc searched
-- 2026-11-07: fn_gto_v31_action_specs_valid, _scalar_types_valid,
-- _public215_bundle_valid and the agreement deciders match the token shape
-- only; fn_training_solver_artifact_servable_v2, the legacy V2 door, already
-- reads tokens as cumulative).
--
-- WHAT THIS CHANGES (exact-count textual patch of the live definitions)
--
--   fn_gto_v31_node_line_proof:  street target = N - (spent - contribution)
--     of the acting player, i.e. minus what that player spent on earlier
--     streets, exactly pio_upi.py `int(token[1:]) - street_start[actor]`.
--   fn_gto_v31_complete_public_state: the same subtraction, so the projected
--     public state (pot, contributions, total spent, to-call, min-raise,
--     public_history target_chips) is the street-level state Pio solved.
--   fn_gto_v31_source_node_v3_fields_valid: facing_target_chips must equal
--     N minus the facing player's earlier-street spend, which is exactly
--     effective_stack - facing_actor_total_chips (both already proven equal
--     to the derived line above it).
--
-- Single-street paths (every flop node, and later-street nodes with no wager
-- on any earlier street) are unchanged: the subtracted amount is 0 there. A
-- token at or below the actor's earlier-street spend is no wager and is
-- refused (it was a legal small wager under the old reading).
--
-- STORED ROWS (R7 and earlier). Measured on production 2026-11-07, read-only,
-- over every node of every stored V4 source artifact of R7
-- (187815b1-3701-46c8-8514-93db3cdb6d07, 6,955 rows) and R6
-- (f6e5781c-..., 382 rows): 0 nodes have a wager after earlier-street money,
-- so the new reading derives byte-identical line proofs and complete public
-- states for every stored node (the dry run below re-derives all of them
-- under both readings and compares). The old reading refused exactly the
-- nodes that would have needed it, so none were stored. What R7 DID get
-- wrong is outside SQL: 715 R7 source rows carry later-street bet CHILDREN
-- after flop money whose action_specs size_value the old exporter computed
-- from the cumulative token (R7's turn barrel `b500` recorded as 0.50 pot
-- where Pio solved 0.25). The DB stores those child specs as signed source
-- data and does not recompute child pot fractions, so this migration neither
-- detects nor changes them. R7 is closed; no historical row is rewritten.
-- R8 sources come from the corrected exporter.
--
-- Not a hot table change: three IMMUTABLE functions, no table lock. Each
-- function is guarded by the md5 of its live pg_get_functiondef (read
-- 2026-11-07) and asserted against its exact postimage md5. ACLs are
-- re-stated explicitly and asserted equal to the live ACL
-- {postgres=X/postgres,service_role=X/postgres}. The DO block at the end
-- exercises the Pio-verified line, a cumulative jam, a bucket change, the
-- refused non-wager and single-street controls inside this transaction.
-- Native proof: scripts/ci/test-v31-pio-bet-totals.py (PostgreSQL 17,
-- byte-exact production preimages, fail-before / pass-after, mutations).
--
-- @live-proof: md5(pg_get_functiondef('public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric)'::regprocedure))='2485aad34b89fbf1118ca2f102a82f55' AND md5(pg_get_functiondef('public.fn_gto_v31_complete_public_state(jsonb)'::regprocedure))='8f16c1aa9dbe2e69a3d072e02314caf3' AND md5(pg_get_functiondef('public.fn_gto_v31_source_node_v3_fields_valid(jsonb)'::regprocedure))='e430900de30df4844860e12985e1727d' AND public.fn_gto_v31_node_line_proof('r:0:c:b250:c:7d:c:b500',1,500,8000)->>'facing_target_chips'='250'

BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;

DO $patch$
DECLARE
  live_acl constant text:='{postgres=X/postgres,service_role=X/postgres}';
  patch record; def text; hits integer;
BEGIN
  FOR patch IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric)'::regprocedure,
     'e9b86de252bc516c4661c2692178e458',
     'v_target:=substring(v_token FROM 2)::numeric;',
     'v_target:=substring(v_token FROM 2)::numeric'
       ||chr(10)||'          -(v_spent[v_actor+1]-v_contributions[v_actor+1]); -- Pio bN: total since root'),
    ('public.fn_gto_v31_complete_public_state(jsonb)'::regprocedure,
     '7696a9230d4681ff75dd203d33140381',
     'target:=substring(token FROM 2)::numeric;',
     'target:=substring(token FROM 2)::numeric-(spent[actor+1]-contribution[actor+1]); -- Pio bN: total since root'),
    ('public.fn_gto_v31_source_node_v3_fields_valid(jsonb)'::regprocedure,
     '7e6ff79ee50bea0ca0f4b7826652f9f8',
     'OR v_facing_target <> substring(v_last_token FROM 2)::numeric'||chr(10),
     'OR v_facing_target <> substring(v_last_token FROM 2)::numeric'
       ||'-(v_effective_stack_chips-v_facing_actor_total) -- Pio bN: total since root'||chr(10))
  ) AS p(fn,pre_md5,old_text,new_text) LOOP
    def:=pg_get_functiondef(patch.fn);
    IF md5(def) IS DISTINCT FROM patch.pre_md5 THEN
      RAISE EXCEPTION '% preimage changed (md5 %), refusing to patch', patch.fn, md5(def);
    END IF;
    IF (SELECT proacl::text FROM pg_proc WHERE oid=patch.fn) IS DISTINCT FROM live_acl THEN
      RAISE EXCEPTION '% ACL is not the live ACL', patch.fn;
    END IF;
    hits:=(length(def)-length(replace(def,patch.old_text,'')))/length(patch.old_text);
    IF hits<>1 THEN
      RAISE EXCEPTION '% patch anchor found % times, expected exactly 1', patch.fn, hits;
    END IF;
    EXECUTE replace(def,patch.old_text,patch.new_text);
  END LOOP;
END
$patch$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_complete_public_state(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_complete_public_state(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_gto_v31_source_node_v3_fields_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_source_node_v3_fields_valid(jsonb) TO service_role;

DO $postimage$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_gto_v31_node_line_proof(text,integer,numeric,numeric)'::regprocedure,'2485aad34b89fbf1118ca2f102a82f55'),
    ('public.fn_gto_v31_complete_public_state(jsonb)'::regprocedure,'8f16c1aa9dbe2e69a3d072e02314caf3'),
    ('public.fn_gto_v31_source_node_v3_fields_valid(jsonb)'::regprocedure,'e430900de30df4844860e12985e1727d')
  ) AS p(fn,post_md5) LOOP
    IF md5(pg_get_functiondef(r.fn)) IS DISTINCT FROM r.post_md5 THEN
      RAISE EXCEPTION '% postimage md5 % is not the reviewed postimage', r.fn, md5(pg_get_functiondef(r.fn));
    END IF;
    IF (SELECT proacl::text FROM pg_proc WHERE oid=r.fn) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
       OR (SELECT provolatile FROM pg_proc WHERE oid=r.fn)<>'i'
       OR (SELECT prosecdef FROM pg_proc WHERE oid=r.fn) THEN
      RAISE EXCEPTION '% ACL, volatility or security changed', r.fn;
    END IF;
  END LOOP;
END
$postimage$;

-- Self-test of the new reading, inside this transaction.
DO $selftest$
DECLARE
  lp jsonb; st jsonb; node jsonb; zeros jsonb; nulls jsonb;
  board constant text:='QsJh2c7d';
BEGIN
  -- 1. The Pio-verified line: 250-chip turn bet into 1000 after a 250 flop call.
  lp:=public.fn_gto_v31_node_line_proof('r:0:c:b250:c:7d:c:b500',1,500,8000);
  IF lp IS DISTINCT FROM jsonb_build_object('street','turn','current_actor_solver_player',0,
      'derived_node_role','facing_bet','derived_facing_kind','bet','derived_facing_size_bucket','small',
      'facing_target_chips',250,'facing_actor_total_chips',7750,
      'previous_street_aggressor_solver_player',null,'previous_street_checked_through',false,
      'older_street_aggressor_solver_player',null) THEN
    RAISE EXCEPTION 'self-test 1 (Pio total since root) failed: %', lp;
  END IF;
  -- 2. A cumulative turn jam (N = effective stack) is an all-in of the rest.
  lp:=public.fn_gto_v31_node_line_proof('r:0:b100:b300:c:2d:c:b1000',NULL,100,1000);
  IF lp->>'derived_node_role' IS DISTINCT FROM 'all_in' OR (lp->>'facing_target_chips')::numeric<>700
     OR (lp->>'facing_actor_total_chips')::numeric<>700 THEN
    RAISE EXCEPTION 'self-test 2 (cumulative jam) failed: %', lp;
  END IF;
  -- 3. The facing bucket uses the street bet: 750 into 1500 is small, not 1250 (mid).
  lp:=public.fn_gto_v31_node_line_proof('r:0:b500:c:7d:c:b1250',1,500,8000);
  IF lp->>'derived_facing_size_bucket' IS DISTINCT FROM 'small' OR (lp->>'facing_target_chips')::numeric<>750 THEN
    RAISE EXCEPTION 'self-test 3 (street bucket) failed: %', lp;
  END IF;
  -- 4. A total at or below earlier-street spending is no wager.
  IF public.fn_gto_v31_node_line_proof('r:0:c:b250:c:7d:c:b250',1,500,8000) IS NOT NULL THEN
    RAISE EXCEPTION 'self-test 4 (non-advancing total) was admitted';
  END IF;
  -- 5. Controls: single-street wagers read exactly as before.
  lp:=public.fn_gto_v31_node_line_proof('r:0:c:b250',1,500,8000);
  IF lp->>'derived_node_role' IS DISTINCT FROM 'facing_bet' OR (lp->>'facing_target_chips')::numeric<>250
     OR (lp->>'facing_actor_total_chips')::numeric<>8000 THEN
    RAISE EXCEPTION 'self-test 5a (flop control) failed: %', lp;
  END IF;
  lp:=public.fn_gto_v31_node_line_proof('r:0:c:c:7d:c:b300:b900',NULL,500,8000);
  IF lp->>'derived_node_role' IS DISTINCT FROM 'check_raise' OR (lp->>'facing_target_chips')::numeric<>900
     OR (lp->>'current_actor_solver_player')::integer<>1 THEN
    RAISE EXCEPTION 'self-test 5b (checked-flop turn control) failed: %', lp;
  END IF;
  -- 6. Complete public state and the v3 field validator on the Pio-verified line.
  zeros:=(SELECT jsonb_agg(0) FROM generate_series(1,1326));
  nulls:=(SELECT jsonb_agg(NULL::numeric) FROM generate_series(1,1326));
  node:=jsonb_build_object('schema','smarter-poker.pio-policy.v3','node','r:0:c:b250:c:7d:c:b500',
    'node_checksum',repeat('1',64),'source_combo_order_checksum',repeat('2',64),'range_bundle_checksum',repeat('3',64),
    'node_context',jsonb_build_object('street','turn','game_family','cash','objective','cash_ev',
      'utility_context','cash_ev','table_size',2,'pot_type','srp','hero_position','BB','opponent_position','SB',
      'depth_bucket',80,'texture_class',public.fn_gto_texture_class_any(board),'node_role','facing_bet',
      'facing_kind','bet','facing_size_bucket','small','board',board,
      'facing_target_chips',250,'facing_actor_total_chips',7750),
    'line_proof',jsonb_build_object('schema','smarter-poker.pio-line-proof.v1','manifest_checksum',repeat('a',64),
      'hero_solver_player',0,'preflop_aggressor_solver_player',1,'root_pot_chips',500,
      'effective_stack_chips',8000,'chips_per_bb',100),
    'action_specs',jsonb_build_object(
      'c',jsonb_build_object('family','call','size_unit','none','size_value',null,'all_in',false),
      'f',jsonb_build_object('family','fold','size_unit','none','size_value',null,'all_in',false)),
    'frequencies',jsonb_build_object('c',zeros,'f',zeros),'action_evs_bb',jsonb_build_object('c',nulls,'f',nulls),
    'policy_evs_bb',nulls,'matchups',zeros);
  IF NOT public.fn_gto_v31_source_node_v3_fields_valid(node) THEN
    RAISE EXCEPTION 'self-test 6a: the v3 validator refused the Pio-verified street target';
  END IF;
  IF public.fn_gto_v31_source_node_v3_fields_valid(jsonb_set(node,'{node_context,facing_target_chips}','500')) THEN
    RAISE EXCEPTION 'self-test 6b: the v3 validator admitted the cumulative token as the street target';
  END IF;
  st:=public.fn_gto_v31_complete_public_state(node||jsonb_build_object('complete_public_state',
       jsonb_build_object('utility','{}'::jsonb)));
  IF st IS NULL OR st->'pot_chips' IS DISTINCT FROM '1250'::jsonb
     OR st->'total_spent_chips' IS DISTINCT FROM '[250,500]'::jsonb
     OR st->'contributions_chips' IS DISTINCT FROM '[0,250]'::jsonb
     OR st->'to_call_chips' IS DISTINCT FROM '250'::jsonb
     OR st->'minimum_raise_target_chips' IS DISTINCT FROM '500'::jsonb
     OR st#>'{public_history,-1}' IS DISTINCT FROM
        '{"street":"turn","solver_player":1,"position":"SB","family":"bet","target_chips":250}'::jsonb THEN
    RAISE EXCEPTION 'self-test 6c (complete public state) failed: %', st;
  END IF;
  RAISE NOTICE 'V31_PIO_BET_TOTALS_SELFTEST_OK';
END
$selftest$;

COMMIT;
