import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';

const suite = 'tests/operations/engine-activation-floor.test.py';
// The full real-Git suite exceeded the 90s child budget (114.472s locally).
// Bound each logical group independently; preserve every Python assertion and
// the original child/case deadlines rather than increasing either deadline.
const groups = [
  {
    name: 'immutable policy and source admission',
    cases: [
      'test_exact_feature_witness_survives_squash_and_shared_base_release',
      'test_preparation_and_admission_boundaries',
      'test_malformed_unknown_and_duplicate_metadata_refuse',
      'test_old_control_or_changed_parser_cannot_ignore_target',
      'test_control_must_share_exact_policy_and_preinstall_guard',
      'test_missing_manifest_is_explicit_legacy_removal_not_expiry',
    ],
  },
  {
    name: 'owner authorization and reservation custody',
    cases: [
      'test_owner_window_is_exact_bounded_and_needs_full_lead',
      'test_new_continuation_preserves_old_target_expiry_and_control_identity',
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
      'test_fresh_prework_cannot_restore_live_engine_and_entry_is_after_certificate',
      'test_actual_confirmed_checkpoint_no_action_retires_only_fresh_entry',
    ],
  },
];

function python(args: string[]) {
  return spawnSync('python3', ['-B', ...args], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    encoding: 'utf8',
    timeout: 90000,
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
  expect(selected).toHaveLength(23);
  expect(new Set(selected).size).toBe(selected.length);
  expect(JSON.parse(result.stdout)).toEqual([...selected].sort());
}, 95000);

for (const group of groups) {
  it(`qualifies ${group.name} without runtime writes`, () => {
    const result = python([suite, ...group.cases.map((name) => `ActivationFloor.${name}`)]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain(`Ran ${group.cases.length} tests`);
    expect(result.stderr).not.toMatch(/skipped=/);
  }, 95000);
}
