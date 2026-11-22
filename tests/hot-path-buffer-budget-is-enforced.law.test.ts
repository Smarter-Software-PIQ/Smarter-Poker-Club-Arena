import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LAW: Hot-path tournament and hand-settlement SQL is guarded by a native
 * PostgreSQL 17 EXPLAIN (ANALYZE, BUFFERS) budget gate with negative self-tests
 * wired into CI (.github/workflows/tournament-event-lane.yml).
 *
 * Guardrail #3 (Permanent Anti-Regression Guardrails):
 * Prevents accidental sequential scans or shared-buffer explosions over large
 * history tables (hand_state_snapshots, chip_transactions, tournament_bounties,
 * tournament_players, etc.) from silently landing on the hot hand-commit,
 * hand-retain, rebuy, or bounty-collect paths.
 */

const ROOT = join(__dirname, '..');
const SCRIPT_PATH = join(ROOT, 'scripts', 'ci', 'test-hot-path-buffer-budget.py');
const WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'tournament-event-lane.yml');

describe('Hot-path EXPLAIN (ANALYZE, BUFFERS) PostgreSQL 17 budget gate', () => {
  it('exists and enforces strict buffer, zero-Seq-Scan, and execution-time budgets on PG17', () => {
    expect(existsSync(SCRIPT_PATH), 'missing scripts/ci/test-hot-path-buffer-budget.py').toBe(true);
    const script = readFileSync(SCRIPT_PATH, 'utf8');

    // PG17 cluster support for ubuntu-latest CI and macOS local runs
    expect(script).toContain('/usr/lib/postgresql/17/bin');
    expect(script).toContain('/opt/homebrew/opt/postgresql@17/bin');
    expect(script).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)');

    // Realistic 5,000+ historical row seeding across hot tables
    expect(script).toMatch(/SEED_SNAPSHOT_ROWS\s*=\s*[5-9]\d{3,}/);
    expect(script).toMatch(/SEED_CHIP_TX_ROWS\s*=\s*[5-9]\d{3,}/);
    expect(script).toMatch(/SEED_HISTORY_ROWS\s*=\s*[5-9]\d{3,}/);
    for (const table of [
      'hand_state_snapshots',
      'chip_transactions',
      'tournament_bounties',
      'tournament_players',
    ]) {
      expect(script).toContain(`'${table}'`);
    }

    // Hard budget assertions (shared buffers, forbidden Seq Scan, execution time)
    expect(script).toContain('def evaluate_explain_budget(');
    expect(script).toContain('total_buffers > max_shared_buffers');
    expect(script).toContain("ntype == 'Seq Scan'");
    expect(script).toContain('execution_ms > max_execution_ms');
    expect(script).toContain('BUDGET VIOLATION');

    // Exercises authoritative hot-path functions
    for (const fnName of [
      'fn_ca_commit_hand_settlement_exact_before_obligations',
      'fn_ca_retain_hand_submission',
      'fn_ca_lock_tournament_rebuy_acquisition',
      'fn_collect_bounty',
    ]) {
      expect(script).toContain(fnName);
    }
  });

  it('includes negative self-tests proving unindexed Seq Scans and buffer explosions fail the gate', () => {
    const script = readFileSync(SCRIPT_PATH, 'utf8');
    expect(script).toContain('def check_negative(');
    expect(script).toContain('NEGATIVE SELF-TEST');
    expect(script).toContain('unindexed JSONB scan on 6,000-row hand_state_snapshots');
    expect(script).toContain('unindexed JSONB scan on 6,000-row chip_transactions');
    expect(script).toContain('budget checker unexpectedly PASSED');
  });

  it('is wired into .github/workflows/tournament-event-lane.yml paths and PG17 job steps', () => {
    expect(existsSync(WORKFLOW_PATH), 'missing .github/workflows/tournament-event-lane.yml').toBe(true);
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('- scripts/ci/test-hot-path-buffer-budget.py');
    expect(workflow).toContain('PG_BIN: /usr/lib/postgresql/17/bin');
    expect(workflow).toContain('python3 scripts/ci/test-hot-path-buffer-budget.py');
  });
});
