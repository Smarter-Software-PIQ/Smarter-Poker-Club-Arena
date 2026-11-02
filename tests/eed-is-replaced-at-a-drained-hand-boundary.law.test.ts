import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Owner, 2026-10-31: eed06fe5 is replaced at a drained hand boundary, never by
 * a full-heap legacy census that cannot fit its allowance, and that census is
 * refused before any notice. docs/changelog/2026-10-31-eed-cutover-at-a-drained-hand-boundary.md
 */
const ROOT = process.cwd();
const transaction = readFileSync(
  join(ROOT, 'server/scripts/engine-release-transaction.sh'),
  'utf8'
);
const helper = readFileSync(join(ROOT, 'server/scripts/engine-release-inflight-hands.py'), 'utf8');
const migration = readFileSync(
  join(ROOT, 'supabase/migrations/20261031212432_release_drained_predecessor_witness.sql'),
  'utf8'
);

describe('eed06fe5 is replaced at a drained hand boundary', () => {
  it('executes the real queue, census-fit, strict-certificate and witness cases', () => {
    const result = spawnSync(
      'python3',
      [join(ROOT, 'tests/operations/eed-drained-cutover.test.py')],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('Ran 33 tests');
  }, 70_000);

  it('keeps the conservative census estimate within the exact EED allocation', () => {
    expect(transaction).toContain('LEGACY_CENSUS_MS_PER_HEAP_MB=12\n');
    expect(transaction).toContain('LEGACY_CENSUS_ALLOWANCE_MS=59000\n');
    expect(transaction).toContain("LEGACY_CHECKPOINT_PROFILE='eed-80s-v1'");
    expect(80_000 - 15_000 - 5_000 - 1_000).toBe(59_000);
  });

  it('decides the census before the wait loop, where no notice can yet exist', () => {
    const gate = transaction.indexOf(
      'if ! legacy_census_fits; then\n    switch_to_drained_predecessor_cutover'
    );
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(transaction.indexOf('while :; do', gate));
    expect(transaction).toContain('refusing before any notice so no break is spent');
  });

  it('never opens the census intent without a fresh fit, and never coerces an unreadable heap', () => {
    const intent = transaction.indexOf(
      '    record_floor_runtime_entry\n    LEGACY_CHECKPOINT_ATTEMPTED=1'
    );
    const recheck = transaction.lastIndexOf(
      'if [ "$CHECKPOINT_PREDECESSOR_SHA" = "$CHECKPOINT_EED_SHA" ] && ! legacy_census_fits; then',
      intent
    );
    expect(recheck).toBeGreaterThan(0);
    expect(transaction.slice(recheck, intent)).toContain('switch_to_drained_predecessor_cutover');
    const fit = transaction.slice(transaction.indexOf('legacy_census_fits() {'));
    expect(fit.slice(0, fit.indexOf('\n}\n'))).toContain('raise SystemExit(3)');
  });

  it('re-reads the census in both directions, because eed06fe5 restarts itself on the same image', () => {
    // 2026-11-01: a run that met a large heap once stayed drained for ever,
    // including at the 10:00 daily break 18 minutes after a self-restart.
    const loop = transaction.slice(
      transaction.indexOf(
        'while :; do',
        transaction.indexOf('NEXT_FRESHNESS_CHECK=$(( $(date +%s) + 60 ))')
      )
    );
    const reread = loop.slice(0, loop.indexOf('  # A drained boundary needs Lightning'));
    expect(reread).toContain('switch_to_drained_predecessor_cutover');
    expect(reread).toContain('return_to_legacy_census_route');
    expect(reread).toContain('[ "$LEGACY_CHECKPOINT_ATTEMPTED" = 0 ]');
    expect(reread).toContain(
      '[ "$CHECKPOINT_PREDECESSOR_SHA" = "$CHECKPOINT_EED_SHA" ] && legacy_census_fits'
    );
    expect(reread).not.toContain('The heap only grows');
  });

  it('admits only the strict certificate and reads the witness before the locked certificate', () => {
    expect(transaction).toContain('STRICT_RESTART_CERTIFICATE="${DRAINED_PREDECESSOR_CUTOVER:-0}"');
    expect(transaction).toContain(
      'if os.environ.get("STRICT_RESTART_CERTIFICATE")=="1": raise SystemExit(1)'
    );
    const witness = transaction.indexOf('        if ! drained_predecessor_witness; then');
    const locked = transaction.indexOf(
      'BREAK_REMAINING_MS="$(maintenance_certificate "$BREAK_LOCKED_MIN_BREAK_MS")"'
    );
    expect(witness).toBeGreaterThan(0);
    expect(witness).toBeLessThan(locked);
  });

  it('judges movement, never existence, and reads both halves before judging', () => {
    expect(helper).toContain('"moving_tournament_hands"');
    expect(helper).toContain('if moving or lightning or rows:');
    expect(migration).toContain("'contract', 'drained-predecessor-witness-v1'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_release_drained_predecessor_witness\(integer, integer\) FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toContain('TO service_role;');
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});
