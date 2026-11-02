/**
 * Horse release verification kit (scripts/horse-measure/horse-release-verify.py):
 * every template renders to read-only SQL with literal bounds, refuses bad
 * input, and the V79 combiner computes the hand-clustered mean / CI exactly.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const KIT = resolve(ROOT, 'scripts/horse-measure/horse-release-verify.py');
const run = (...args: string[]) => {
  const r = spawnSync('python3', [KIT, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const WRITE = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy)\b/i;
const body = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.split('--')[0])
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");

describe('horse release verification kit', () => {
  it('self-check passes: every template is read-only', () => {
    const r = run('check');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('ok');
  });

  it.each(['ladder', 'seat-jams', 'v78', 'v79'])(
    '%s renders one read-only statement with literal window bounds',
    (mode) => {
      const r = run('sql', mode, '2026-11-03T00:00:00Z', '2026-11-03T04:00:00Z');
      expect(r.status, r.err).toBe(0);
      expect(r.out).not.toMatch(/:START|:END/);
      expect(r.out).toContain("'2026-11-03T00:00:00Z'::timestamptz");
      expect(r.out).toContain("'2026-11-03T04:00:00Z'::timestamptz");
      expect(WRITE.test(body(r.out))).toBe(false);
      const statements = body(r.out)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/^(with|select)\b/i);
    }
  );

  it('activation renders with the liveness control and every upgrade receipt', () => {
    const r = run('sql', 'activation', '2026-11-03');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain("'2026-11-03'::date");
    for (const f of [
      'decide_nlh',
      'v74_nlh_open_size',
      'v76_retired_four_bet_bluff',
      'v77_seat_jam',
      'v78_no_committing_bluff_raise',
      'v79_top_pair_weak_kicker',
      'v62_river_bettor_polarity',
    ])
      expect(r.out).toContain(`'${f}'`);
  });

  it('refuses malformed bounds and unknown modes', () => {
    expect(run('sql', 'v79', '2026-11-03', 'not-a-time').status).not.toBe(0);
    expect(run('sql', 'activation', '2026-11-03T00:00:00Z').status).not.toBe(0);
    expect(run('sql', 'nope', '2026-11-03T00:00:00Z', '2026-11-03T01:00:00Z').status).not.toBe(0);
  });

  it('slices a window into bounded calls', () => {
    const r = run('slices', '2026-11-03T00:00:00Z', '2026-11-03T10:00:00Z', '4');
    expect(r.out.trim().split('\n')).toEqual([
      '2026-11-03T00:00:00Z 2026-11-03T04:00:00Z',
      '2026-11-03T04:00:00Z 2026-11-03T08:00:00Z',
      '2026-11-03T08:00:00Z 2026-11-03T10:00:00Z',
    ]);
  });

  it('combine-v79 sums slices and computes the hand-clustered mean and CI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'v79-combine-'));
    try {
      const grid = new Array(22).fill(0).join(',');
      // Two slices of one cell: hands with sums -10 (n 1), -30 (n 2), -20 (n 1).
      // Totals: n 4, hands 3, S -60, S2 100+900+400 = 1400, SN -10-60-20 = -90, N2 1+4+1 = 6.
      writeFileSync(join(dir, 'a.txt'), `A|weak_2_9|3|2|-40|1000|-70|5|0|0|${grid}\n`);
      writeFileSync(join(dir, 'b.txt'), `A|weak_2_9|1|1|-20|400|-20|1|0|0|${grid}\n`);
      const r = run('combine-v79', join(dir, 'a.txt'), join(dir, 'b.txt'));
      expect(r.status, r.err).toBe(0);
      const line = r.out.split('\n').find((l) => l.startsWith('A '))!;
      // mean = -60 / 4 = -15; ss = 1400 - 2(-15)(-90) + 225*6 = 50; se = sqrt(50*3/2)/4
      const se = Math.sqrt((50 * 3) / 2) / 4;
      expect(line).toContain('-15.00');
      expect(line).toContain((-15 - 1.96 * se).toFixed(2));
      expect(line).toContain((-15 + 1.96 * se).toFixed(2));
      expect(line).toContain('below 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
