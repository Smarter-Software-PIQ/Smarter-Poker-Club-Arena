/**
 * LAW: A DEADLOCKED HAND SETTLEMENT IS RETRIED IN THE LIVE PATH (2026-11-19).
 *
 * Production alerts 258600 (2026-10-19, table 596f82eb #39888785) and 267092
 * (2026-10-22, table 1aa2ab60 #44324262): "atomic hand commit refused
 * (rolled_back): deadlock detected", attempts 1. The stack settlement caught
 * its own 40P01 and RETURNED it; the hand commit core passed that object up
 * unchanged, and the engine retries only the canonical
 * atomic_hand_rolled_back envelope, so the hand was parked for the resume door
 * (16 minutes for #39888785) instead of being retried at once.
 *
 * What this pins:
 *   1. 20261119141104 re-raises a transient inner refusal (40001 / 40P01 /
 *      55P03) inside the block whose handler builds the canonical envelope,
 *      leaves every other inner refusal unchanged, and checks its preimage;
 *   2. the engine's retry predicate still names that envelope and exactly those
 *      three SQLSTATEs, so the two halves keep agreeing;
 *   3. the native proof (scripts/ci/test-a-deadlocked-hand-settlement-is-retried.sh)
 *      exists, reproduces the defect before installing, and runs on every pull
 *      request touching this path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20261119141104_a_deadlocked_hand_settlement_is_the_retryable_rolled_back_en.sql'
);
const SQL = MIGRATION.replace(/--[^\n]*/g, ' ');
const ENGINE = read('server/src/services/supabase/handHistory.ts');
const PROOF = read('scripts/ci/test-a-deadlocked-hand-settlement-is-retried.sh');
const WORKFLOW = read('.github/workflows/hand-settlement-deadlock-proof.yml');

const newBlock = (() => {
  const start = MIGRATION.indexOf('v_new constant text := $new$');
  const end = MIGRATION.indexOf('$new$;', start);
  return MIGRATION.slice(start, end);
})();

describe('a deadlocked hand settlement is retried in the live path', () => {
  it('is one transaction with a bounded lock wait', () => {
    expect(MIGRATION.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(MIGRATION.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toMatch(/SET LOCAL lock_timeout = '3s';/);
    expect(MIGRATION).not.toMatch(/@install-window/);
  });

  it('patches only the production preimage, exactly once', () => {
    expect(SQL).toContain("md5(v_def) <> 'b49192e78f472d7a931bcf20de46a702'");
    expect(SQL).toContain('<> 1 THEN');
    expect(SQL).toContain('EXECUTE replace(v_def, v_old, v_new);');
  });

  it('re-raises exactly the transient inner refusals with their own SQLSTATE', () => {
    expect(newBlock).toContain("v_stack_result->>'reason' = 'rolled_back'");
    expect(newBlock).toContain("v_stack_result->>'sqlstate' IN ('40001','40P01','55P03')");
    expect(newBlock).toMatch(/RAISE EXCEPTION USING\s+ERRCODE = v_stack_result->>'sqlstate'/);
    // Any other refusal keeps its old shape.
    expect(newBlock).toContain(
      "RETURN v_stack_result || jsonb_build_object('atomic_hand_commit',false);"
    );
    expect(newBlock.indexOf('RAISE EXCEPTION')).toBeLessThan(newBlock.indexOf('RETURN v_stack_result'));
  });

  it('carries a live proof the merge route can read', () => {
    expect(MIGRATION).toMatch(
      /^-- @live-proof: position\('HAND_SETTLEMENT_TRANSIENT_INNER_REFUSAL' IN pg_get_functiondef\('public\.fn_ca_commit_hand_settlement_before_lease_generation\(/m
    );
    expect(newBlock).toContain('HAND_SETTLEMENT_TRANSIENT_INNER_REFUSAL');
  });

  it('agrees with the engine retry predicate', () => {
    expect(ENGINE).toContain("result.reason === 'atomic_hand_rolled_back'");
    expect(ENGINE).toMatch(
      /result\.sqlstate === '40001' \|\|\s+result\.sqlstate === '40P01' \|\|\s+result\.sqlstate === '55P03'/
    );
    expect(ENGINE).toContain('/^[0-9a-f]{64}$/.test(result.commit_hash)');
  });

  it('is proved natively on every pull request that touches it', () => {
    expect(PROOF).toContain("[ \"$(field \"$R\" reason)\" = rolled_back ] || fail \"preimage did not reproduce the defect");
    expect(PROOF).toContain('-f "$MIGRATION"');
    expect(PROOF).toMatch(/for code in 40P01 40001 55P03/);
    expect(WORKFLOW).toContain('bash scripts/ci/test-a-deadlocked-hand-settlement-is-retried.sh');
    expect(WORKFLOW).toContain('pull_request:');
    expect(WORKFLOW).toContain(
      "'supabase/migrations/20261119141104_a_deadlocked_hand_settlement_is_the_retryable_rolled_back_en.sql'"
    );
    expect(WORKFLOW).toContain("'server/src/services/supabase/handHistory.ts'");
  });
});
