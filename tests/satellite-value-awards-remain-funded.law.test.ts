import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Prospective satellite value-ticket financial qualification', () => {
  it('keeps the refused legacy migration limited to its collusion budget', () => {
    const sql = readFileSync(
      'supabase/migrations/20261109163346_settle_capped_satellites_and_nov08_digest_v2.sql',
      'utf8'
    );
    const executable = sql.replace(/^--.*$/gm, '').trim();
    expect(executable).toBe(
      "BEGIN;\nSET LOCAL lock_timeout = '1s';\nSET LOCAL statement_timeout = '15s';\nALTER FUNCTION public.fn_ca_collusion_scan(integer) SET statement_timeout TO '120s';\nCOMMIT;"
    );
  });
  it('runs the actual isolated money proof in the required accounting aggregate', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const start = ci.indexOf(
      '      - name: Satellite awards retain reusable same-value ticket backing'
    );
    expect(start).toBeGreaterThan(0);
    const step = ci.slice(
      start,
      ci.indexOf('      - name: Retain reusable satellite ticket financial proof', start)
    );
    expect(step).toContain('if: matrix.shard == 4');
    expect(step).toContain('python3 -B scripts/ci/test-satellite-value-awards.py');
    expect(step).not.toContain('continue-on-error');
    expect(ci).toContain('name: Retain reusable satellite ticket financial proof');
    expect(ci).toContain('needs.accounting_postgres.result');
  });
});
