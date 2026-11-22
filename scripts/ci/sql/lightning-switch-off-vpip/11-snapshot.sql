\set ON_ERROR_STOP on
-- Every answer the floor gives, for every seated player of every fixture
-- table, recorded under a tag. fn_nit_enforce writes warnings, so the
-- warnings are put back exactly as they were after each table is judged:
-- this records what the boundary WOULD do, and changes nothing.
CREATE OR REPLACE FUNCTION public.proof_snapshot(p_tag text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE r record; t uuid; v text;
BEGIN
  DELETE FROM public.proof_baseline WHERE k LIKE p_tag || '|%';
  FOR r IN SELECT ts.table_id, ts.user_id, ts.joined_at, tt.cluster_id
             FROM public.table_seats ts JOIN public.tables tt ON tt.id = ts.table_id
            WHERE ts.left_at IS NULL AND ts.table_id::text LIKE 'e%'
  LOOP
    INSERT INTO public.proof_baseline VALUES
      (p_tag || '|since|' || r.table_id || '|' || r.user_id,
       public.fn_nit_sitting_since(r.cluster_id, r.user_id, r.joined_at)::text),
      (p_tag || '|check|' || r.table_id || '|' || r.user_id,
       public.fn_nit_check(r.table_id, r.user_id, r.joined_at)::text);
  END LOOP;
  FOR t IN SELECT DISTINCT ts.table_id FROM public.table_seats ts
            WHERE ts.left_at IS NULL AND ts.table_id::text LIKE 'e%'
  LOOP
    SELECT coalesce(json_agg(row_to_json(s) ORDER BY s.user_id)::text, '[]') INTO v
      FROM public.fn_nit_status(t) s;
    INSERT INTO public.proof_baseline VALUES (p_tag || '|status|' || t, v);

    CREATE TEMP TABLE IF NOT EXISTS proof_w_save AS SELECT * FROM public.ca_nit_warnings WITH NO DATA;
    DELETE FROM proof_w_save;
    INSERT INTO proof_w_save SELECT * FROM public.ca_nit_warnings;
    SELECT coalesce(json_agg(row_to_json(e) ORDER BY e.user_id)::text, '[]') INTO v
      FROM public.fn_nit_enforce(t) e;
    INSERT INTO public.proof_baseline VALUES (p_tag || '|enforce|' || t, v);
    SELECT coalesce(json_agg(json_build_object('user', w.user_id, 'open', w.cleared_at IS NULL,
                                               'reason', w.cleared_reason) ORDER BY w.user_id, w.id)::text, '[]')
      INTO v FROM public.ca_nit_warnings w WHERE w.table_id = t;
    INSERT INTO public.proof_baseline VALUES (p_tag || '|warnings|' || t, v);
    DELETE FROM public.ca_nit_warnings;
    INSERT INTO public.ca_nit_warnings OVERRIDING SYSTEM VALUE SELECT * FROM proof_w_save;
  END LOOP;
END $f$;

-- How many seats a table's boundary would stand up, under a tag.
CREATE OR REPLACE FUNCTION public.proof_evictions(p_tag text, p_table uuid) RETURNS int
LANGUAGE sql STABLE AS $f$
  SELECT json_array_length(v::json) FROM public.proof_baseline
   WHERE k = p_tag || '|enforce|' || p_table;
$f$;

SELECT public.proof_snapshot('before');

-- THE DEFECT, REPRODUCED on the old window: the switch-off judges the pool.
DO $$
BEGIN
  IF public.proof_evictions('before', 'e1100000-0000-0000-0000-000000000001') <> 4 THEN
    RAISE EXCEPTION 'T0a the old window did not reproduce the switch-off eviction on L1 (% seats)',
      public.proof_evictions('before', 'e1100000-0000-0000-0000-000000000001'); END IF;
  IF public.proof_evictions('before', 'e7100000-0000-0000-0000-000000000007') <> 2 THEN
    RAISE EXCEPTION 'T0b the old window did not reproduce the rejoin eviction on L7'; END IF;
  IF public.proof_evictions('before', 'e6100000-0000-0000-0000-000000000006') <> 2 THEN
    RAISE EXCEPTION 'T0c the old window did not reproduce the grace-spent-in-the-pool eviction on L6'; END IF;
  IF public.proof_evictions('before', 'e3100000-0000-0000-0000-000000000003') <> 2 THEN
    RAISE EXCEPTION 'T0d the old window did not reproduce the second switch-off eviction on L3'; END IF;
  RAISE NOTICE 'T0 PASS  the old window reproduces the defect: L1 4 seats, L7 2, L6 2, L3 2 stood up at the switch-off';
END $$;
