-- 20261110213713_lightning_matcher_and_settlement_use_a_separate_restricted_s.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (Dan 2026-11-10, item 2 of the Lightning
-- follow-ups: "isolate Lightning's database connections"):
--
-- On 2026-11-10 a tournament settlement lock storm (#10361) pinned the shared
-- PostgREST connection pool. Every Lightning call queued behind it: settlement
-- averaged 979 ms against 141 ms, matching 130 ms against 59 ms, and
-- fold-to-next-hand p50 reached 13 s. The original Lightning fast fold already
-- has its own restricted login (20261020160107, engine_lightning_fold) and was
-- unaffected. This gives the rest of the per-hand path the same treatment:
--
--   fn_lightning_match_and_form          (the matcher's writer)
--   fn_lightning_instance_begin_dealing  (a formed hand starts dealing)
--   fn_lightning_bind_hand_number        (the hand gets its number)
--   fn_lightning_settle_hand             (the hand settles)
--
-- The same proven shape as the fold lane, nothing new:
--   * a separate LOGIN role, engine_lightning_lane, with no table privileges,
--     no membership of service_role or postgres, and only EXECUTE on one
--     fixed private wrapper;
--   * its connection URL generated and stored in Vault inside this
--     transaction (no agent, workflow, host file or report sees it), read by
--     the engine through a service_role-only function;
--   * the wrapper, owned by service_role and SECURITY DEFINER, admits only
--     that session, establishes exactly the authority a PostgREST service
--     request has (role claims, the data-actor headers and the request path),
--     runs the ordinary data-API pre-request guard in the same transaction,
--     and then calls ONE of the four functions above by a fixed name with
--     typed arguments. It is not a generic SQL interface: any other operation
--     name, or any argument key the function does not take, is refused.
--
-- The entry big blind request header (x-smarter-lightning-entry-bb, read by
-- the matcher's inner functions) is accepted when the engine sends it, as
-- PostgREST passes it today.
--
-- An engine that cannot reach this lane (role absent, Vault answer missing,
-- pool busy) keeps calling the same functions through PostgREST exactly as
-- before. This migration needs no hot-table lock: one role, one secret, two
-- functions and grants.

BEGIN;

SET LOCAL lock_timeout = '3s';

DO $preconditions$
BEGIN
  IF md5(pg_get_functiondef('smarter_private.fn_smarter_data_api_pre_request()'::regprocedure)) <> 'b799597b6f91d7e59688bff5d1fa9c5a' THEN
    RAISE EXCEPTION 'Lightning lane dependency changed: data API pre-request guard';
  END IF;
  IF to_regprocedure('public.fn_lightning_match_and_form(uuid,timestamp with time zone,uuid[],integer,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.fn_lightning_instance_begin_dealing(uuid,interval,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.fn_lightning_bind_hand_number(uuid,bigint)') IS NULL
     OR to_regprocedure('public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Lightning lane dependency changed: a per-hand function signature';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='engine_lightning_lane')
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name='engine_lightning_lane_url') THEN
    RAISE EXCEPTION 'Lightning lane already exists; do not rotate or replay';
  END IF;
END $preconditions$;

-- The password is generated and stored inside this transaction.
DO $login$
DECLARE password_value text := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
BEGIN
  -- Six pooled sockets per engine process; sixteen covers a restart overlap.
  CREATE ROLE engine_lightning_lane LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 16;
  EXECUTE format('ALTER ROLE engine_lightning_lane PASSWORD %L',password_value);
  PERFORM vault.create_secret(
    format('postgresql://engine_lightning_lane.kuklfnapbkmacvwxktbh:%s@aws-0-us-west-2.pooler.supabase.com:5432/postgres',password_value),
    'engine_lightning_lane_url','Lightning per-hand lane only; separate Supavisor session-mode login');
END $login$;
-- The same budget a PostgREST service request has (service_role: 8s).
ALTER ROLE engine_lightning_lane SET statement_timeout='8s';
ALTER ROLE engine_lightning_lane SET lock_timeout='4s';
ALTER ROLE engine_lightning_lane SET idle_in_transaction_session_timeout='10s';
ALTER ROLE engine_lightning_lane SET synchronous_commit='on';
ALTER ROLE engine_lightning_lane SET search_path='pg_catalog';
GRANT USAGE ON SCHEMA smarter_private TO engine_lightning_lane;

CREATE FUNCTION smarter_private.fn_engine_lightning_lane(
  p_operation text, p_args jsonb, p_actor_headers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $function$
DECLARE
  actor text; protocol text; entry_bb text; key_count integer;
  fn text; allowed text[];
  disconnected uuid[];
BEGIN
  IF session_user <> 'engine_lightning_lane' OR current_user <> 'service_role' THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_SESSION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF current_setting('synchronous_commit') <> 'on' THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_DURABLE_COMMIT_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF p_args IS NULL OR jsonb_typeof(p_args) <> 'object' THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_ARGS_INVALID' USING ERRCODE='22023';
  END IF;

  fn := CASE p_operation
    WHEN 'match_and_form' THEN 'fn_lightning_match_and_form'
    WHEN 'begin_dealing' THEN 'fn_lightning_instance_begin_dealing'
    WHEN 'bind_hand_number' THEN 'fn_lightning_bind_hand_number'
    WHEN 'settle_hand' THEN 'fn_lightning_settle_hand'
  END;
  allowed := CASE p_operation
    WHEN 'match_and_form' THEN ARRAY['p_cluster_id','p_now','p_disconnected','p_max_hands','p_request_id','p_player_platforms']
    WHEN 'begin_dealing' THEN ARRAY['p_instance_id','p_deal_window','p_now']
    WHEN 'bind_hand_number' THEN ARRAY['p_instance_id','p_hand_number']
    WHEN 'settle_hand' THEN ARRAY['p_hand_id','p_request_id','p_host_table_id','p_lease_instance','p_lease_generation','p_results','p_rake','p_bbj','p_hand_row']
  END;
  IF fn IS NULL THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_OPERATION_INVALID' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_args) k WHERE k <> ALL (allowed)) THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_ARGS_INVALID' USING ERRCODE='22023';
  END IF;

  -- The actor headers PostgREST would carry, plus the optional entry big blind.
  IF p_actor_headers IS NULL OR jsonb_typeof(p_actor_headers) <> 'object' THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_ACTOR_INVALID' USING ERRCODE='22023';
  END IF;
  actor := p_actor_headers->>'x-smarter-data-actor';
  protocol := p_actor_headers->>'x-smarter-data-protocol';
  entry_bb := p_actor_headers->>'x-smarter-lightning-entry-bb';
  SELECT count(*) INTO key_count FROM jsonb_object_keys(p_actor_headers);
  IF entry_bb IS NOT NULL THEN
    IF entry_bb <> '1' THEN
      RAISE EXCEPTION 'LIGHTNING_LANE_ACTOR_INVALID' USING ERRCODE='22023';
    END IF;
    key_count := key_count - 1;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_actor_headers) e
    WHERE e.key NOT IN ('x-smarter-data-actor','x-smarter-data-protocol','x-smarter-tournament-id',
                        'x-smarter-tournament-lease-generation','x-smarter-lightning-entry-bb')
       OR jsonb_typeof(e.value) <> 'string')
     OR NOT ((actor='service' AND protocol='1' AND key_count=2)
          OR (actor='tournament-manager' AND protocol='2' AND key_count=4
              AND p_actor_headers ? 'x-smarter-tournament-id'
              AND p_actor_headers ? 'x-smarter-tournament-lease-generation'))
     OR actor IS NULL OR protocol IS NULL THEN
    RAISE EXCEPTION 'LIGHTNING_LANE_ACTOR_INVALID' USING ERRCODE='22023';
  END IF;

  -- Only this fixed, session-bound wrapper establishes service authority; the
  -- ordinary hook then checks the actor protocol inside this transaction.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  PERFORM set_config('request.headers',p_actor_headers::text,true);
  PERFORM set_config('request.method','POST',true);
  PERFORM set_config('request.path','rpc/'||fn,true);
  PERFORM smarter_private.fn_smarter_data_api_pre_request();

  IF p_operation = 'match_and_form' THEN
    IF jsonb_typeof(p_args->'p_disconnected') = 'array' THEN
      disconnected := COALESCE(
        (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(p_args->'p_disconnected') x),
        '{}'::uuid[]);
    END IF;
    RETURN public.fn_lightning_match_and_form(
      (p_args->>'p_cluster_id')::uuid,
      (p_args->>'p_now')::timestamptz,
      disconnected,
      (p_args->>'p_max_hands')::integer,
      (p_args->>'p_request_id')::uuid,
      NULLIF(p_args->'p_player_platforms','null'::jsonb));
  ELSIF p_operation = 'begin_dealing' THEN
    RETURN public.fn_lightning_instance_begin_dealing(
      (p_args->>'p_instance_id')::uuid,
      (p_args->>'p_deal_window')::interval,
      (p_args->>'p_now')::timestamptz);
  ELSIF p_operation = 'bind_hand_number' THEN
    RETURN public.fn_lightning_bind_hand_number(
      (p_args->>'p_instance_id')::uuid,
      (p_args->>'p_hand_number')::bigint);
  ELSE
    RETURN public.fn_lightning_settle_hand(
      (p_args->>'p_hand_id')::uuid,
      (p_args->>'p_request_id')::uuid,
      (p_args->>'p_host_table_id')::uuid,
      p_args->>'p_lease_instance',
      (p_args->>'p_lease_generation')::uuid,
      NULLIF(p_args->'p_results','null'::jsonb),
      (p_args->>'p_rake')::numeric,
      (p_args->>'p_bbj')::numeric,
      NULLIF(p_args->'p_hand_row','null'::jsonb));
  END IF;
END $function$;
REVOKE ALL ON FUNCTION smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

-- Same temporary CREATE grant the fold lane used for the ownership transfer,
-- restored to its prior value before commit.
DO $owner$
DECLARE already_allowed boolean := has_schema_privilege('service_role','smarter_private','CREATE');
BEGIN
  IF NOT already_allowed THEN GRANT CREATE ON SCHEMA smarter_private TO service_role; END IF;
  ALTER FUNCTION smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb) OWNER TO service_role;
  IF NOT already_allowed THEN REVOKE CREATE ON SCHEMA smarter_private FROM service_role; END IF;
END $owner$;
GRANT EXECUTE ON FUNCTION smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb) TO engine_lightning_lane;

CREATE FUNCTION public.fn_engine_lightning_lane_session_url() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='engine_lightning_lane_url' LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.fn_engine_lightning_lane_session_url() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_engine_lightning_lane_session_url() TO service_role;

DO $verify$
BEGIN
  IF pg_has_role('engine_lightning_lane','service_role','MEMBER')
     OR pg_has_role('engine_lightning_lane','postgres','MEMBER')
     OR has_function_privilege('engine_lightning_lane','public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)','EXECUTE')
     OR has_function_privilege('engine_lightning_lane','public.fn_lightning_match_and_form(uuid,timestamp with time zone,uuid[],integer,uuid,jsonb)','EXECUTE')
     OR has_function_privilege('engine_lightning_lane','public.fn_engine_lightning_lane_session_url()','EXECUTE')
     OR has_schema_privilege('engine_lightning_lane','smarter_private','CREATE')
     OR NOT has_function_privilege('engine_lightning_lane','smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Lightning lane privilege verification failed';
  END IF;
END $verify$;
-- @live-proof: (SELECT pg_get_userbyid(proowner)='service_role' AND prosecdef FROM pg_proc WHERE oid='smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb)'::regprocedure)
-- @live-proof: (SELECT has_function_privilege('engine_lightning_lane','smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb)','EXECUTE') AND NOT has_function_privilege('engine_lightning_lane','public.fn_lightning_settle_hand(uuid,uuid,uuid,text,uuid,jsonb,numeric,numeric,jsonb)','EXECUTE'))
-- @live-proof: (to_regprocedure('public.fn_engine_lightning_lane_session_url()') IS NOT NULL)

COMMIT;
