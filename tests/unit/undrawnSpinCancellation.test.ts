import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const base = 'scripts/ci/fixtures/undrawn-spin-cancellation/';
const migration =
  'supabase/migrations/20261103064259_undrawn_spin_cancellation_returns_booked_fees_before_gross_r.sql';

describe('Undrawn Spin cancellation native qualification', () => {
  it('executes the real financial proof in required accounting qualification for every owned input', () => {
    const ci = parse(read('.github/workflows/ci.yml'));
    const steps = ci.jobs.accounting_postgres.steps.filter((step: { run?: string }) =>
      step.run?.includes('test-undrawn-spin-cancellation.py')
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].if).toBe('matrix.shard == 4');
    expect(steps[0]['continue-on-error']).toBeUndefined();
    for (const path of [
      migration,
      'scripts/ci/test-undrawn-spin-cancellation.py',
      'tests/unit/undrawnSpinCancellation.test.ts',
      ...[
        'current-owners.json',
        'current-dependencies.json',
        'current-terminal-owners.json',
        'current-receipt-owners.json',
      ].map((x) => base + x),
    ]) {
      expect(classifyChangedPaths([path]).server, path).toBe(true);
      expect(classifyChangedPaths([path]).tests, path).toBe(true);
    }
  });

  it('retains exact baseline definitions and preserves append-only receipt authority', () => {
    for (const file of [
      'current-owners.json',
      'current-dependencies.json',
      'current-terminal-owners.json',
      'current-receipt-owners.json',
    ]) {
      for (const row of JSON.parse(read(base + file))) {
        expect(createHash('md5').update(row.definition).digest('hex')).toBe(row.definition_md5);
      }
    }
    const sql = read(migration);
    expect(sql).toContain("'7c1d581b3e0b2454f0bfb83d75df82ff'");
    expect(sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.fn_spin_reserve_receipt_is_immutable/
    );
    expect(sql).not.toMatch(
      /DISABLE TRIGGER|session_replication_role|INSERT INTO public\.tournaments/i
    );
    expect(sql).toContain('-- @live-proof: ');
  });
});
