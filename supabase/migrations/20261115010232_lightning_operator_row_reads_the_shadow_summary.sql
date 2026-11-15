-- 20261115010232_lightning_operator_row_reads_the_shadow_summary
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 01:02:32 UTC.
--
-- WHAT WAS WRONG:
--
-- Lightning > Operator answered HTTP 500 (statement timeout, 8 s) at
-- 2026-11-14 12:21:45Z (8,088 ms) and 22:04:51Z (8,103 ms) for the club
-- fade0000-0000-0000-0000-000000000001 (79 clusters). The overview builds one
-- row per cluster; for a cluster with a shadow comparison in the last week the
-- row called fn_lightning_shadow_report and kept only the first version pair's
-- verdict, comparison count, mean and versions. The report averages fourteen
-- metrics per pair and unpacks each comparison's metrics document about fifty
-- times (live_metrics and shadow_metrics are TOASTed). Measured read-only on
-- production 2026-11-15 (warm cache): the 77 rows without shadow data cost
-- 17,373 buffers and 194 ms; the two shadow rows cost 318,832 buffers and
-- 912 ms. A cold cache pushes the same work past the 8 s limit.
--
-- WHAT THIS CHANGES:
--
-- The row reads that summary itself: same window (LEAST(now, p_now) and
-- the report's 7-day / 90-day bounds), same current snapshot binding
-- (fn_lightning_matcher_binding), same seated filters, same first pair
-- (calibration pairs last, most comparisons first, then versions), the same
-- verdict rules, and the same output keys. Each JSON document is unpacked once
-- with jsonb_to_record. Measured the same way: 63,606 buffers and 212 ms for
-- both shadow clusters, with output equal to the report's first pair on both.
-- One difference, on malformed data only: the report casts every metric and
-- errors on a non-numeric one; this row no longer reads those metrics.
--
-- A patch of the installed source under its md5 (dc81e3aa...): two anchors,
-- each required to match exactly once. Owner, grants, SECURITY DEFINER and
-- search_path are kept (CREATE OR REPLACE). fn_lightning_shadow_report, the
-- operator gate (fn_lightning_operator_may) and the overview are unchanged.
-- Function-only change: no DDL on a live table, no rows written.
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_lightning_operator_cluster_row(uuid,timestamptz)'::regprocedure) LIKE '%jsonb_to_record(x.live_metrics)%' AND pg_get_functiondef('public.fn_lightning_operator_cluster_row(uuid,timestamptz)'::regprocedure) NOT LIKE '%public.fn_lightning_shadow_report(%')

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION pg_temp.ca_patch(p_fn regprocedure, p_md5 text, p_pairs text[])
 RETURNS void LANGUAGE plpgsql AS $patch$
DECLARE
  d text := pg_get_functiondef(p_fn);
  i int;
BEGIN
  IF md5(d) <> p_md5 THEN RAISE EXCEPTION 'Source Changed: %', p_fn; END IF;
  FOR i IN 1 .. array_length(p_pairs, 1) BY 2 LOOP
    IF (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]) <> 1 THEN
      RAISE EXCEPTION 'Anchor Not Unique In %: %', p_fn, p_pairs[i];
    END IF;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
  END LOOP;
  EXECUTE d;
END
$patch$;

SELECT pg_temp.ca_patch(
  'public.fn_lightning_operator_cluster_row(uuid,timestamptz)'::regprocedure,
  'dc81e3aa94d6994c11e3894e733cacac',
  ARRAY[
    -- 1. The report's result variable becomes the summary's window and binding.
    $a$  v_sr     jsonb;
$a$,
    $a$  v_sr_from timestamptz;
  v_sr_to   timestamptz;
  v_bind    text;
$a$,
    -- 2. The report call becomes the summary.
    $a$    v_sr := public.fn_lightning_shadow_report(g.id, v_now - interval '7 days', v_now);
    IF jsonb_array_length(coalesce(v_sr -> 'version_pairs', '[]'::jsonb)) > 0 THEN
      v_shadow := jsonb_build_object(
        'verdict', v_sr -> 'version_pairs' -> 0 ->> 'verdict',
        'comparisons', (v_sr -> 'version_pairs' -> 0 ->> 'comparisons')::integer,
        'delta_mean', (v_sr -> 'version_pairs' -> 0 ->> 'quality_delta_mean')::numeric,
        'live_matcher_version', v_sr -> 'version_pairs' -> 0 ->> 'live_matcher_version',
        'shadow_matcher_version', v_sr -> 'version_pairs' -> 0 ->> 'shadow_matcher_version');
    END IF;
$a$,
    $a$    -- THE SHADOW SUMMARY IS READ HERE, NOT FROM THE FULL REPORT (2026-11-15).
    -- fn_lightning_shadow_report builds fourteen averaged metrics per version
    -- pair and unpacks every comparison's metrics document about fifty times;
    -- this row keeps only the first pair's verdict, count, mean and versions.
    -- Same window, same current-snapshot binding, same seated filters, same
    -- first pair and the same verdict rules as that report; each document is
    -- unpacked once. The full report is unchanged for its own readers.
    v_sr_to := LEAST(v_now, now());
    v_sr_from := GREATEST(v_now - interval '7 days', v_sr_to - interval '90 days');
    v_bind := public.fn_lightning_matcher_binding(g.id);
    SELECT jsonb_build_object(
             'verdict', CASE
               WHEN r.n < 30 THEN 'insufficient_evidence'
               WHEN r.sv = r.lv || '-port' THEN
                 CASE WHEN abs(r.d_mean) <= 1 THEN 'calibrated' ELSE 'calibration_bias' END
               WHEN r.d_mean > 0 AND r.d_fail <= 0 THEN 'shadow_leads'
               WHEN r.d_mean < 0 THEN 'live_leads'
               ELSE 'no_clear_winner' END,
             'comparisons', r.n::integer,
             'delta_mean', round(r.d_mean, 2),
             'live_matcher_version', r.lv,
             'shadow_matcher_version', r.sv)
      INTO v_shadow
      FROM (SELECT x.live_matcher_version AS lv, x.shadow_matcher_version AS sv,
                   count(*) FILTER (WHERE x.live_quality_score IS NOT NULL
                                      AND x.shadow_quality_score IS NOT NULL) AS n,
                   avg(x.shadow_quality_score - x.live_quality_score) AS d_mean,
                   coalesce(avg((lc.reliability #>> '{}')::numeric
                                - (sc.reliability #>> '{}')::numeric), 0) AS d_fail
              FROM public.lightning_matcher_shadow_comparison x
             CROSS JOIN LATERAL jsonb_to_record(x.live_metrics) AS lm(snapshot_binding jsonb, seated jsonb)
             CROSS JOIN LATERAL jsonb_to_record(x.shadow_metrics) AS sm(snapshot_binding jsonb, seated jsonb)
             CROSS JOIN LATERAL jsonb_to_record(x.live_components) AS lc(reliability jsonb)
             CROSS JOIN LATERAL jsonb_to_record(x.shadow_components) AS sc(reliability jsonb)
             WHERE x.cluster_id = g.id
               AND x.window_to > v_sr_from AND x.window_to <= v_sr_to
               AND lm.snapshot_binding #>> '{}' = v_bind
               AND sm.snapshot_binding #>> '{}' = lm.snapshot_binding #>> '{}'
               AND CASE WHEN jsonb_typeof(lm.seated) = 'number'
                        THEN (lm.seated #>> '{}')::numeric ELSE 0 END > 0
               AND CASE WHEN jsonb_typeof(sm.seated) = 'number'
                        THEN (sm.seated #>> '{}')::numeric ELSE 0 END > 0
             GROUP BY 1, 2) r
     ORDER BY (r.sv = r.lv || '-port'), r.n DESC, r.lv, r.sv
     LIMIT 1;
$a$
  ]);

DROP FUNCTION pg_temp.ca_patch(regprocedure, text, text[]);

COMMIT;
