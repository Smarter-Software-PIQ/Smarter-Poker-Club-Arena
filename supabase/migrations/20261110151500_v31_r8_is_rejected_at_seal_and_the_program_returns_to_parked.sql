-- ════════════════════════════════════════════════════════════════════════
-- V31 R8 IS REJECTED AT ITS SEAL; THE PROGRAM RETURNS TO PARKED (2026-11-10)
-- ════════════════════════════════════════════════════════════════════════
--
-- R8 (dataset 1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b, key
-- horse-v31-public215-cash-r8-20261107) completed every stage: 5,700 M1 and
-- 800 M2 held-out solves, training, 100 preparations, Linux parity on the
-- serving engine, 100 freezes, 100 cell builds, 800 held-out physics audits,
-- 100 seal preparations, and was sealed on 2026-11-10 14:59:55Z with
-- dataset_checksum 7a93303140d8f9ffd145a28dd84b9e315b8f37f53558705b7f55477e28b347b6.
--
-- The seal applied the registered held-out quality gates to the 800 sealed
-- held-out boards (386,419 policy-EV observations, 0 missing):
--     sizing_mae            0.0428 <= 0.05   pass
--     frequency_mae         0.0482 <= 0.05   pass
--     regret_coverage       1.000  >= 0.95   pass
--     mean_action_regret_bb 0.0148 <= 0.05   pass
--     policy_ev_mae_bb      0.0983 >  0.05   FAIL
-- so fn_gto_v31_seal_build recorded the dataset as state 'rejected',
-- quality_status 'rejected'. No evaluation epoch was opened, nothing was
-- evaluated, promoted or bound, and the serving engine is unaffected.
--
-- The 2026-11-07 reopen condition said: RETURN TO PARKED, by a dated
-- migration carrying the receipts, if R8 fails. A held-out quality rejection
-- at the seal is that failure. This migration records it and returns the
-- program to 'parked', so the nightly audit reports the deliberate state as
-- 'info' again instead of paging a stalled rebuild. It decides nothing about
-- a successor round; that is the owner's.
--
-- Also on record: the 2026-11-07 density pre-flight approved "100 cells
-- (70 flop, 23 turn, 7 river)"; the dataset actually built carried 67 turn
-- and 33 river cells and no flop (no flop texture had board capacity for the
-- 57 + 8 board design), which required migration 20261110050500 to redefine
-- v3 breadth as the streets a playbook carries before the seal could run.

-- @live-proof: EXISTS (SELECT 1 FROM public.gto_v31_program_state p WHERE p.id AND p.state='parked' AND p.evidence->>'r8_state'='rejected' AND p.evidence->>'r8_dataset_checksum'='7a93303140d8f9ffd145a28dd84b9e315b8f37f53558705b7f55477e28b347b6')

BEGIN;

DO $guard$
DECLARE d public.gto_v31_datasets%ROWTYPE; p public.gto_v31_program_state%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.gto_v31_datasets WHERE dataset_id='1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b';
  IF NOT FOUND OR d.state<>'rejected' OR d.quality_status<>'rejected' OR d.sealed_at IS NULL
     OR d.dataset_checksum<>'7a93303140d8f9ffd145a28dd84b9e315b8f37f53558705b7f55477e28b347b6'
     OR (d.heldout_metrics->>'validated')::boolean IS DISTINCT FROM false
     OR (d.heldout_metrics->>'policy_ev_mae_bb')::numeric <= (d.quality_gates->>'max_policy_ev_mae_bb')::numeric THEN
    RAISE EXCEPTION 'R8 is not the sealed, rejected dataset this migration records; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_evaluation_epochs WHERE dataset_id=d.dataset_id)
     OR EXISTS (SELECT 1 FROM public.gto_v31_serving_bindings WHERE revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.gto_v31_datasets WHERE state='active') THEN
    RAISE EXCEPTION 'R8 has evaluation or serving state; this migration only records a seal rejection';
  END IF;
  SELECT * INTO p FROM public.gto_v31_program_state WHERE id;
  IF NOT FOUND OR p.state<>'rebuilding' THEN
    RAISE EXCEPTION 'program state is % not rebuilding; refusing to park over it', p.state;
  END IF;
END
$guard$;

UPDATE public.gto_v31_program_state
   SET state = 'parked',
       decided_at = now(),
       decided_by = 'claude R8 owner (session_01BNteGYFjTvhFx4rY4YyM4o), recording the seal verdict under the 2026-11-07 reopen condition; Dan directed R8 to finish on 2026-11-09 22:56 CST and the seal ran on 2026-11-10',
       rationale = 'R8 completed every stage and was sealed on 2026-11-10 14:59:55Z, then rejected by its own registered held-out quality gates: policy_ev_mae_bb 0.0983 against a maximum of 0.05 (sizing 0.0428, frequency 0.0482, regret coverage 1.000 and action regret 0.0148 all passed). The models are not accurate enough on unseen boards to certify. No evaluation epoch was opened and nothing was promoted or bound; the horses keep the current brain. The program returns to parked as the reopen condition required.',
       evidence = evidence || jsonb_build_object(
         'r8_dataset_id', '1dc9a1b8-a78b-46c9-86f6-9b9bfa0d8c3b',
         'r8_dataset_key', 'horse-v31-public215-cash-r8-20261107',
         'r8_dataset_checksum', '7a93303140d8f9ffd145a28dd84b9e315b8f37f53558705b7f55477e28b347b6',
         'r8_sealed_at', '2026-11-10T14:59:55.501524Z',
         'r8_state', 'rejected',
         'r8_cells', jsonb_build_object('total',100,'flop',0,'turn',67,'river',33,'approved_preflight','70 flop, 23 turn, 7 river'),
         'r8_sources', jsonb_build_object('m1_train',5700,'m2_holdout',800,'invalid',0),
         'r8_heldout_quality', jsonb_build_object('policy_ev_mae_bb',0.0983405373334037,'max_policy_ev_mae_bb',0.05,'sizing_mae',0.0428261580262671,'frequency_mae',0.048244730238456,'regret_coverage',1.0,'mean_action_regret_bb',0.0147685502916074,'policy_ev_observations',386419,'validated',false),
         'r8_qualification_fingerprint', 'e5165ded2b02bea3a04e9001f6c327831bbe32449fd33733ef3df331fe4cde41',
         'r8_breadth_rule', 'migration 20261110050500 (PR #10316): v3 breadth is the streets the playbook carries',
         'r8_serving_engine_at_seal', '840429a332ecb536d19b3b719fa6809e7bc63ca7',
         'r8_evaluation_epochs', 0, 'r8_promoted', false,
         'r8_rejected_recorded_at', to_jsonb(now())),
       reopen_condition = 'Parked after R8 was rejected at its seal (held-out policy EV error above the registered gate). Reopen only by an owner decision for a successor round whose plan meets the registered quality gates and the v3 breadth rule; nothing is served until such a round passes every contract v3 run.',
       stall_after = interval '72 hours'
 WHERE id;

DO $verify$
DECLARE p public.gto_v31_program_state%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.gto_v31_program_state WHERE id;
  IF p.state<>'parked' OR p.evidence->>'r8_state'<>'rejected' OR p.evidence->>'r8_dataset_checksum'<>'7a93303140d8f9ffd145a28dd84b9e315b8f37f53558705b7f55477e28b347b6' THEN
    RAISE EXCEPTION 'program state was not parked with the R8 receipts';
  END IF;
END
$verify$;

COMMIT;
