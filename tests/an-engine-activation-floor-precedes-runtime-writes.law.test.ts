import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';

const suite = 'tests/operations/engine-activation-floor.test.py';
// The unpartitioned real-Git suite reached the unchanged 90s child budget.
// Bound each logical group independently; preserve every Python assertion and
// the original child/case deadlines rather than increasing either deadline.
const groups = [
  {
    name: 'certified owner duration and durable reservation',
    cases: [
      'test_certified_owner_requires_exact_profile_and_entire_900_second_cycle',
      'test_certified_reservation_is_durable_exact_and_never_reannounced',
      'test_certified_reservation_refuses_mismatch_and_late_new_cycle_without_writes',
      'test_certified_completion_waits_for_900_seconds_and_original_terminal_receipt',
      'test_certified_diagnostic_bounds_are_profile_and_predecessor_scoped',
    ],
  },
  {
    name: 'Phase1 admission and prior-owner preservation',
    cases: [
      'test_phase1_policy_owns_fresh_admission_without_retargeting_prior_owner',
      'test_nov7_exception_binds_the_exact_order_and_current_deadline',
      'test_current_owner_reservation_reaches_countdown_and_refuses_replay',
      'test_provenance_worker_and_database_windows_bind_the_same_corrective_release',
      'test_provenance_archive_gate_refuses_absent_and_unreadable_catalogs',
      'test_receipt_successor_binds_a_fresh_floor_and_preserves_single_use_custody',
      'test_clone_clock_successor_binds_a_fresh_floor_and_preserves_consumed_receipt_order',
      'test_realtime_10454_binds_fresh_authority_and_preserves_consumed_clock_order',
      'test_corrections_10525_binds_fresh_authority_and_preserves_unconsumed_realtime_order',
      'test_rebooked_corrections_bind_fresh_authority_and_preserve_expired_orders',
      'test_missed_engine_takeover_binds_fresh_authority_and_separate_prerequisites',
      'test_owner_now_55_break_binds_fresh_authority_to_the_serving_predecessor',
      'test_owner_now_rebooking_binds_the_next_55_break_after_the_schema_moved',
      'test_owner_asap_booking_binds_the_earliest_certifiable_admission_after_two_lapses',
      'test_owner_offcycle_booking_binds_fresh_authority_to_the_new_serving_predecessor',
      'test_cash_room_realism_window_binds_the_live_floor_and_keeps_the_provenance_entry',
      'test_explicit_later_owner_window_precedes_fresh_phase1_but_keeps_original_entries',
      'test_earliest_certified_owner_policy_requires_explicit_unambiguous_authority',
      'test_later_owner_transaction_preserves_custody_without_reserving_hourly_cycle',
    ],
  },
  {
    name: 'immutable policy and source admission',
    cases: [
      'test_exact_feature_witness_survives_squash_and_shared_base_release',
      'test_preparation_and_admission_boundaries',
      'test_malformed_unknown_and_duplicate_metadata_refuse',
      'test_old_control_or_changed_parser_cannot_ignore_target',
      'test_control_must_share_exact_policy_and_preinstall_guard',
      'test_changed_owner_history_only_falls_through_after_both_exact_orders_expire',
      'test_missing_manifest_is_explicit_legacy_removal_not_expiry',
    ],
  },
  {
    name: 'owner authorization and reservation custody',
    cases: [
      'test_owner_window_is_exact_bounded_and_needs_full_lead',
      'test_new_continuation_preserves_old_target_expiry_and_control_identity',
      'test_census_continuation_keeps_failed_operation_window_immutable',
      'test_bounded_census_delivery_preserves_prior_floor_and_fixed_expiry',
      'test_qualified_capacity_preserves_previous_floor_and_expiry',
      'test_phase1_plo_55_window_preserves_qualified_capacity_floor',
      'test_process_actor_continuation_preserves_prior_floor_and_expiry',
      'test_manager_serial_continuation_preserves_prior_floor_and_expiry',
      'test_census_suffix_continuation_preserves_prior_floor_and_expiry',
      'test_creation_qualification_continuation_preserves_prior_floor_and_expiry',
      'test_original_retirement_continuation_preserves_prior_floor_and_expiry',
      'test_owned_renewal_observation_preserves_prior_floor_and_fixed_expiry',
      'test_canonical_source_continuation_preserves_prior_floor_and_fixed_expiry',
      'test_immediate_relaunch_continuation_preserves_history_and_full_reserves',
      'test_hybrid_phase1_55_window_binds_its_own_floor_and_the_hybrid_merge',
      'test_hybrid_earliest_safe_window_binds_the_live_floor_and_keeps_the_expired_minute53_entry',
      'test_lightning_always_runs_window_binds_the_live_floor_and_keeps_the_hybrid_entry',
      'test_cash_styles_window_binds_the_live_floor_and_keeps_the_lightning_entry',
      'test_cutover_recovery_window_binds_the_live_floor_and_keeps_the_cash_styles_entry',
      'test_owner_reservation_binds_run_target_cause_and_full_window',
      'test_actual_owner_certificate_binds_existing_window_and_refuses_shortcut',
      'test_actual_reservation_entry_survives_unknown_ack_and_checkpoint_no_action',
      'test_known_no_reservation_retires_only_new_intent_and_foreign_owner_refuses',
    ],
  },
  {
    name: 'client publication, expiry and durable entry',
    cases: [
      'test_client_floor_is_independent_of_backlog_and_engine_expiry',
      'test_actual_daily_certificate_guards_refuse_emergency_and_expiry',
      'test_expired_floor_reads_as_no_floor_on_every_fresh_read',
      'test_runtime_entry_is_durable_and_expiry_never_creates_it',
    ],
  },
  {
    name: 'actual intake, runtime and recovery callers',
    cases: [
      'test_actual_floor_reads_share_legacy_entry_budget_and_retain_announcement',
      'test_actual_intake_refuses_before_installer_even_for_emergency_signals',
      'test_receiver_gate_precedes_all_control_installation_and_failure_cleanup',
      'test_installed_v1_templates_accept_current_per_run_entrypoint',
      'test_actual_recovery_skips_runtime_only_for_proved_never_entered',
      'test_expired_original_announcement_finishes_only_through_its_failed_receipt',
      'test_fresh_prework_cannot_restore_live_engine_and_entry_is_after_certificate',
      'test_actual_confirmed_checkpoint_no_action_retires_only_fresh_entry',
    ],
  },
];

// Hang guards only. Each group is a unittest run against fixed fixture clocks;
// nothing it asserts depends on host speed. 90 s was exceeded by a passing
// 23-case group at load 69 (2026-11-07). The child's guard stays below each
// test's 420 s budget so a hang reports the child's own diagnostics.
const CHILD_HANG_GUARD_MS = 400_000;

function python(args: string[]) {
  return spawnSync('python3', ['-B', ...args], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    timeout: CHILD_HANG_GUARD_MS,
  });
}

beforeAll(() => {
  // Ask unittest for its runtime collection. A new, removed, duplicated or
  // omitted method must fail before any selected group can claim coverage.
  const result = python([
    '-c',
    'import json,runpy,sys,unittest; module=runpy.run_path(sys.argv[1]); ' +
      'print(json.dumps(unittest.defaultTestLoader.getTestCaseNames(module["ActivationFloor"])))',
    suite,
  ]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const selected = groups.flatMap((group) => group.cases);
  expect(selected).toHaveLength(66);
  expect(new Set(selected).size).toBe(selected.length);
  expect(JSON.parse(result.stdout)).toEqual([...selected].sort());
}, 420_000);

for (const group of groups) {
  it(`qualifies ${group.name} without runtime writes`, () => {
    const result = python([suite, ...group.cases.map((name) => `ActivationFloor.${name}`)]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain(
      `Ran ${group.cases.length} test${group.cases.length === 1 ? '' : 's'}`
    );
    expect(result.stderr).not.toMatch(/skipped=/);
  }, 420_000);
}
