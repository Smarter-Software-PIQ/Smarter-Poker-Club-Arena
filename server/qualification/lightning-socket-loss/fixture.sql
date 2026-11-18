CREATE ROLE engine_lightning_lane LOGIN PASSWORD 'lane';
CREATE ROLE engine_lightning_fold LOGIN PASSWORD 'fold';
CREATE SCHEMA smarter_private;
GRANT USAGE ON SCHEMA smarter_private TO engine_lightning_lane, engine_lightning_fold;
-- attempts is a sequence: it advances even when the calling transaction dies, so it counts every arrival
CREATE SEQUENCE smarter_private.attempts;
CREATE TABLE smarter_private.ctl (sleep_ms int NOT NULL);
INSERT INTO smarter_private.ctl VALUES (0);
-- the durable effect, keyed by the caller's own request id
CREATE TABLE smarter_private.effects (request_id text PRIMARY KEY, op text NOT NULL, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION smarter_private.fn_engine_lightning_lane(p_op text, p_args jsonb, p_headers jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = smarter_private, pg_catalog AS $$
DECLARE s int;
BEGIN
  PERFORM nextval('smarter_private.attempts');
  SELECT sleep_ms INTO s FROM smarter_private.ctl;
  IF s > 0 THEN PERFORM pg_sleep(s / 1000.0); END IF;
  INSERT INTO smarter_private.effects (request_id, op) VALUES (p_args->>'p_request_id', p_op) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'request_id', p_args->>'p_request_id');
END $$;
CREATE FUNCTION smarter_private.fn_engine_lightning_fast_fold(p_hand uuid, p_player uuid, p_request uuid, p_type text, p_committed numeric, p_headers jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = smarter_private, pg_catalog AS $$
DECLARE s int;
BEGIN
  PERFORM nextval('smarter_private.attempts');
  SELECT sleep_ms INTO s FROM smarter_private.ctl;
  IF s > 0 THEN PERFORM pg_sleep(s / 1000.0); END IF;
  INSERT INTO smarter_private.effects (request_id, op) VALUES (p_request::text, 'fast_fold') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'request_id', p_request);
END $$;
REVOKE ALL ON FUNCTION smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb), smarter_private.fn_engine_lightning_fast_fold(uuid,uuid,uuid,text,numeric,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb) TO engine_lightning_lane;
GRANT EXECUTE ON FUNCTION smarter_private.fn_engine_lightning_fast_fold(uuid,uuid,uuid,text,numeric,jsonb) TO engine_lightning_fold;
