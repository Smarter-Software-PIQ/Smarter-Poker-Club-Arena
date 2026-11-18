-- A source transaction and a hand transaction can overlap even when both
-- wall-clock columns predate the hand. Keep visibility and same-transaction
-- order as original evidence. The prospective authority is sealed separately.
-- @live-proof: (to_regclass('public.ca_promo_source_observation_order') IS NOT NULL AND to_regclass('public.ca_promo_source_observation_cutover') IS NOT NULL AND to_regprocedure('public.fn_ca_promo_source_observation()') IS NOT NULL AND NOT has_function_privilege('authenticated','public.fn_ca_promo_source_observation()','execute') AND NOT has_function_privilege('service_role','public.fn_ca_promo_source_version_visible(xid8,bigint,xid8,bigint,pg_snapshot)','execute'))
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

CREATE SEQUENCE public.ca_promo_source_observation_order AS bigint START 1 CACHE 1 NO CYCLE;
REVOKE ALL ON SEQUENCE public.ca_promo_source_observation_order FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_source_observation()
RETURNS TABLE(observation_order bigint,writer_xid xid8,visible_xids pg_snapshot,observed_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='pg_catalog','public','pg_temp' AS $$
  SELECT nextval('public.ca_promo_source_observation_order'::regclass),
         pg_current_xact_id(),pg_current_snapshot(),clock_timestamp()
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_source_observation() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.fn_ca_promo_source_version_visible(
  source_xid xid8,source_order bigint,observer_xid xid8,observer_order bigint,observer_snapshot pg_snapshot)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='pg_catalog','pg_temp' AS $$
BEGIN
  IF source_xid IS NULL OR observer_xid IS NULL OR observer_snapshot IS NULL OR
     source_order IS NULL OR observer_order IS NULL OR source_order<1 OR observer_order<1 THEN
    RAISE EXCEPTION 'promo_source_visibility_evidence_incomplete' USING ERRCODE='23514';
  END IF;
  IF source_xid=observer_xid THEN RETURN source_order<observer_order; END IF;
  RETURN pg_visible_in_snapshot(source_xid,observer_snapshot);
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_source_version_visible(xid8,bigint,xid8,bigint,pg_snapshot)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.ca_promo_source_observation_cutover (
  id boolean PRIMARY KEY CHECK(id),
  observation_order bigint NOT NULL UNIQUE CHECK(observation_order>0),
  writer_xid xid8 NOT NULL,
  visible_xids pg_snapshot NOT NULL,
  observed_at timestamptz NOT NULL CHECK(isfinite(observed_at))
);
ALTER TABLE public.ca_promo_source_observation_cutover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_promo_source_observation_cutover FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ca_promo_source_cutover_immutable BEFORE UPDATE OR DELETE ON public.ca_promo_source_observation_cutover
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();
CREATE TRIGGER ca_promo_source_cutover_no_truncate BEFORE TRUNCATE ON public.ca_promo_source_observation_cutover
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_promo_integrity_immutable();

-- A later hand cannot qualify by wall time alone. The observation must be
-- newer than the immutable baseline and must see its sealing transaction.
CREATE FUNCTION public.fn_ca_promo_source_observation_is_qualified(
  p_order bigint,p_writer xid8,p_snapshot pg_snapshot)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','public','pg_temp' AS $$
 SELECT EXISTS(SELECT 1 FROM public.ca_promo_source_observation_cutover b WHERE b.id
   AND p_order>b.observation_order AND public.fn_ca_promo_source_version_visible(
     b.writer_xid,b.observation_order,p_writer,p_order,p_snapshot))
$$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_source_observation_is_qualified(bigint,xid8,pg_snapshot)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
