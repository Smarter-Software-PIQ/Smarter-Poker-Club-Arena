-- A miss in a worker cache cannot establish whether the accepted public-profile
-- store has a row. One statement takes a consistent snapshot and probes the
-- existing primary key, once by full context and once by its user_id prefix.
-- Exposes only public counters and lineage to the engine. Historical or in-flight participation is
-- outside the store's contract and is never inferred from a missing row.
-- @live-proof: (has_function_privilege('service_role','public.fn_horse_saved_profile_presence(text[],text,text,text,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_horse_saved_profile_presence(text[],text,text,text,jsonb)','EXECUTE'))
BEGIN;
CREATE FUNCTION public.fn_horse_saved_profile_presence(
  p_user_ids text[], p_variant text, p_mode text, p_size text, p_domain jsonb
) RETURNS TABLE(user_id text, presence text, exact_profile jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF cardinality(p_user_ids) IS NULL OR cardinality(p_user_ids) NOT BETWEEN 1 AND 10
    OR array_ndims(p_user_ids) IS DISTINCT FROM 1
    OR (SELECT count(DISTINCT u) FROM unnest(p_user_ids) u) <> cardinality(p_user_ids)
    OR EXISTS (SELECT FROM unnest(p_user_ids) u WHERE u !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR p_variant IS NULL OR p_variant NOT IN ('nlh','plo4','plo5','plo6','plo8','flh','flo8','short_deck','pineapple')
    OR p_mode IS NULL OR p_mode NOT IN ('cash','tournament')
    OR p_size IS NULL OR p_size NOT IN ('hu','short','full')
    OR public.fn_horse_public_domain_valid(p_domain) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid saved-profile presence request' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT ids.actor, CASE
      WHEN exact.user_id IS NOT NULL THEN 'exact'
      WHEN EXISTS (SELECT FROM public.horse_exact_profiles p WHERE p.user_id=ids.actor)
        THEN 'other_context'
      ELSE 'no_saved_row'
    END, CASE WHEN exact.user_id IS NOT NULL THEN jsonb_build_object(
      'user_id',exact.user_id,'variant',exact.variant,'mode',exact.mode,'size',exact.size,
      'public_memory_domain',exact.public_memory_domain,'observed_hands',exact.observed_hands,
      'initialized',exact.initialized,'last_accepted_hand_id',exact.last_accepted_hand_id,'counters',exact.counters
    ) END
    FROM unnest(p_user_ids) ids(actor) LEFT JOIN public.horse_exact_profiles exact
      ON exact.user_id=ids.actor AND exact.variant=p_variant AND exact.mode=p_mode
      AND exact.size=p_size AND exact.public_memory_domain=p_domain
    ORDER BY ids.actor COLLATE "C";
END $fn$;
REVOKE ALL ON FUNCTION public.fn_horse_saved_profile_presence(text[],text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_horse_saved_profile_presence(text[],text,text,text,jsonb)
  TO service_role;
COMMIT;
