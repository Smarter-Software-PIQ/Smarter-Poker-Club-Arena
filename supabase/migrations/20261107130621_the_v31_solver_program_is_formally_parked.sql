-- ═══════════════════════════════════════════════════════════════════════════
-- THE V31 SOLVER PROGRAM IS FORMALLY PARKED (2026-11-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Dan asked for a decision between restarting and parking the V31 solver
-- pipeline, and delegated the call. The decision is PARK, on the measured
-- evidence of the 2026-11-06 league card and the live serving state:
--
--   * The only statistically meaningful V31 league signal is NEGATIVE:
--     gto_v31_league_cash ... epoch4 read -3.575 bb/100 with stderr 1.768
--     over 10,000 hands, about two sigma below zero.
--   * The tournament paired-replay arms read exactly 0.0 +/- 0.0 over 10,000
--     hands each (tourney_ev and tourney_icm). Zero divergent pairs means
--     V31 is not changing tournament decisions at all, so there is no
--     tournament upside being given up by parking it.
--   * The league arm that would decide the suit-aware layer,
--     v31_gto_suit_aware, is formally REFUSED as unmeasurable: live
--     telemetry put v31_gto_open at 195 fires against 924,871 decides, so a
--     6,000-pair matchup expects about TWO firings. The league can never
--     produce a promotion verdict for it.
--   * Nothing is served: gto_v31_serving_bindings holds zero rows, and no
--     dataset is in state 'active'. The standing promotion rule (a pack goes
--     on only when it beats the current brain on its locked held-out
--     contract alone) is therefore not met.
--   * Both solver hosts are idle - solver_status M1 last wrote 2026-10-24
--     ('bounded-canary-complete'), M2 2026-08-16 ('no work found') - so a
--     restart means spending the farm's compute to re-measure a layer whose
--     one clear measurement is a loss.
--
-- Parking is the status quo made HONEST, not a change of behaviour: V31 was
-- already serving nothing. What changes is the instrument. Today
-- fn_audit_gto_v31_certified raises a CRITICAL 'certified_v31_missing' every
-- single night for as long as no dataset is active, which is a permanent
-- false alarm for a deliberate state - exactly the crying-wolf that made the
-- 2026-11-06 audit's three "Critical" flaws two-thirds noise and buried an
-- 82% cash-volume collapse under them. A parked program reports as 'info'
-- and carries its decision, its evidence and its re-open condition with it.
--
-- Two things stay CRITICAL, because they are real:
--   * a dataset active but not fully sealed (unchanged);
--   * anything being SERVED while the program is parked. That is a
--     contradiction between the decision and the floor, and it is louder
--     than the original missing-dataset finding ever was.

CREATE TABLE IF NOT EXISTS public.gto_v31_program_state (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  state            text        NOT NULL CHECK (state IN ('active','parked')),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       text        NOT NULL,
  rationale        text        NOT NULL,
  evidence         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reopen_condition text        NOT NULL
);

-- One row, read by the nightly audit through SECURITY DEFINER functions.
-- Nothing may write it but a reviewed migration, and no client role may read
-- it directly: RLS on with no policy, and only the explicit grant below.
ALTER TABLE public.gto_v31_program_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gto_v31_program_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.gto_v31_program_state TO service_role;

COMMENT ON TABLE public.gto_v31_program_state IS
  'Singleton: whether the V31 solver program is being pursued (active) or parked. Read by fn_audit_gto_v31_certified so a deliberate park does not raise a nightly Critical. A park never implies anything may be served - serving while parked is itself a Critical.';

INSERT INTO public.gto_v31_program_state
  (id, state, decided_by, rationale, evidence, reopen_condition)
VALUES (
  true,
  'parked',
  'claude-opus-5 (delegated by Dan, 2026-11-07: "YOU CAN DECIDE ON THE V31 SOLVER PIPELINE")',
  'Parked. The only significant league measurement of V31 is negative (cash -3.575 +/- 1.768 bb/100 over 10,000 hands, ~2 sigma). The tournament paired replays show exactly zero divergence over 10,000 hands each, so no tournament edge is being forgone. The arm that would decide the suit-aware layer is refused as unmeasurable (~2 expected firings per 6,000 pairs). Nothing is served and no dataset is active, so the promotion rule is unmet. Both solver hosts have been idle since 2026-10-24 and 2026-08-16, so restarting spends compute to re-measure a measured loss.',
  jsonb_build_object(
    'league_cash_bb100', -3.575,
    'league_cash_stderr', 1.7679632388154833,
    'league_cash_hands', 10000,
    'league_tourney_ev_bb100', 0.5658333333333334,
    'league_tourney_ev_stderr', 0.25776810178051063,
    'paired_replay_tourney_ev_bb100', 0,
    'paired_replay_tourney_icm_bb100', 0,
    'paired_replay_tourney_hands', 10000,
    'serving_bindings', 0,
    'active_datasets', 0,
    'suit_aware_arm_status', 'refused: too rare for any sample the league can afford',
    'solver_status_m1_last', '2026-10-24T05:32:26Z',
    'solver_status_m2_last', '2026-08-16T00:38:44Z',
    'card_run_date', '2026-11-06'
  ),
  'Re-open when EITHER a sealed candidate dataset passes its locked held-out contract AND a paired replay shows non-zero divergence with a non-negative cash arm, OR a deliberate one-off runs the suit-aware arm with a large temporary pairs bump (or a seeded scenario matrix forcing suit-aware nodes) and returns a significant positive. Until then the legacy response inference stays labelled derived and V31 serves nothing.'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_audit_gto_v31_certified(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_latest jsonb;
  v_park public.gto_v31_program_state%ROWTYPE;
  v_served bigint := 0;
BEGIN
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE state='active' LIMIT 1;
  IF NOT FOUND THEN
    SELECT jsonb_build_object(
      'dataset_key',d.dataset_key,'state',d.state,'quality_status',d.quality_status,
      'source_rows',d.source_rows,'train_source_rows',d.train_source_rows,
      'holdout_source_rows',d.holdout_source_rows,'invalid_rows',d.invalid_rows,
      'runtime_cells',(SELECT count(*) FROM public.gto_v31_runtime_cells c
        WHERE c.dataset_id=d.dataset_id),
      'declared_cells',jsonb_array_length(d.declared_coverage),
      'coverage',d.coverage,'heldout_metrics',d.heldout_metrics,
      'input_approval_status',b.approval_status,
      'evaluation_receipts',(SELECT count(*) FROM public.gto_v31_release_evaluations e
        WHERE e.dataset_id=d.dataset_id),
      'passing_release_receipts',(SELECT count(*) FROM public.gto_v31_release_evaluations e
        WHERE e.dataset_id=d.dataset_id AND e.verdict IN ('pass','win','tie')),
      'created_at',d.created_at,'sealed_at',d.sealed_at,'candidate_at',d.candidate_at
    ) INTO v_latest
      FROM public.gto_v31_datasets d
      JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
     ORDER BY d.created_at DESC LIMIT 1;

    -- 2026-11-07: a parked program is a decision, not a defect. Without this
    -- branch the audit raised the same Critical every night for a state
    -- somebody chose on the evidence, which is how a Critical list stops
    -- being read.
    SELECT * INTO v_park FROM public.gto_v31_program_state WHERE state='parked' LIMIT 1;
    IF FOUND THEN
      SELECT count(*) INTO v_served FROM public.gto_v31_serving_bindings;
      IF v_served > 0 THEN
        RETURN jsonb_build_array(jsonb_build_object(
          'severity','critical','category','gto','code','certified_v31_parked_but_serving',
          'title','The V31 program is PARKED but ' || v_served || ' serving binding(s) exist',
          'evidence',jsonb_build_object('day',p_day,'serving_bindings',v_served,
            'parked_at',v_park.decided_at,'parked_by',v_park.decided_by),
          'recommendation','The decision on record is that V31 serves nothing, and something is bound to serve. Resolve the contradiction before the next deal: either retire the bindings or revoke the park with a dated decision.'
        ));
      END IF;
      RETURN jsonb_build_array(jsonb_build_object(
        'severity','info','category','gto','code','certified_v31_parked',
        'title','No certified V31 dataset is active, and that is the decision on record (parked)',
        'evidence',jsonb_build_object('day',p_day,'latest_dataset',v_latest,
          'decided_at',v_park.decided_at,'decided_by',v_park.decided_by,
          'park_evidence',v_park.evidence),
        'recommendation',v_park.rationale || ' RE-OPEN CONDITION: ' || v_park.reopen_condition
      ));
    END IF;

    RETURN jsonb_build_array(jsonb_build_object(
      'severity','critical','category','gto','code','certified_v31_missing',
      'title','No certified V31 solver dataset is active',
      'evidence',jsonb_build_object('day',p_day,'latest_dataset',v_latest),
      'recommendation','Keep the legacy response inference labeled derived. Restore both solver hosts, generate sealed source rows, pass held-out, paired replay and league gates, then promote exactly one dataset. If the program is being deliberately stood down instead, record it in gto_v31_program_state so this stops reporting as a defect.'
    ));
  END IF;
  IF v_dataset.invalid_rows <> 0 OR v_dataset.quality_status <> 'validated'
     OR v_dataset.dataset_checksum IS NULL OR v_dataset.source_artifact_checksum IS NULL THEN
    v_result := v_result || jsonb_build_object(
      'severity','critical','category','gto','code','certified_v31_invalid',
      'title','The active V31 dataset is not fully sealed',
      'evidence',jsonb_build_object('dataset',v_dataset.dataset_key,'invalid_rows',v_dataset.invalid_rows,'quality',v_dataset.quality_status),
      'recommendation','Retire the dataset and fall back. An active cell may never be served without complete source and dataset checksums.'
    );
  ELSE
    v_result := v_result || jsonb_build_object(
      'severity','info','category','gto','code','certified_v31_active',
      'title','Certified V31 dataset is active',
      'evidence',jsonb_build_object('dataset',v_dataset.dataset_key,'checksum',v_dataset.dataset_checksum,'coverage',v_dataset.coverage,'heldout',v_dataset.heldout_metrics),
      'recommendation','Continue daily decision-level agreement and worker-liveness checks.'
    );
  END IF;
  RETURN v_result;
END;
$function$;

-- An audit read is not a public endpoint. This function is SECURITY DEFINER,
-- so it runs as the owner and past RLS; it is called only by
-- fn_run_horse_daily_audit (itself SECURITY DEFINER) and by operators. Nothing
-- without an account has any business executing it.
REVOKE ALL ON FUNCTION public.fn_audit_gto_v31_certified(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_gto_v31_certified(date) TO service_role;