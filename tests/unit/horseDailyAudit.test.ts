import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPLOIT_MAX_SPLITS,
  boundarySql,
  formatSummary,
  overallExit,
  planRuns,
  planSplits,
  splitGroups,
} from '../../scripts/ops/horse-daily-audit-lib.mjs';
import { folderName, parseArgs, runDailyAudit } from '../../scripts/ops/horse-daily-audit.mjs';

const S = Date.parse('2026-11-25T05:00:00Z');
const U = Date.parse('2026-11-26T05:00:00Z');
const at = (h: number, m = 0) =>
  new Date(S + h * 3600_000 + m * 60_000).toISOString().replace('.000Z', '+00');

describe('horse daily audit runner (scripts/ops/horse-daily-audit.mjs)', () => {
  it('reads the boundaries with SELECTs only, scoped to the range', () => {
    const q = boundarySql(S, U);
    for (const sql of Object.values(q)) {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).toContain("'2026-11-25T05:00:00Z'::timestamptz");
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
    }
    expect(q.builds).toContain("game_variant IN ('nlh', 'plo4', 'plo5')");
  });

  it('splits at every switch change and every build that starts inside the range; merges a cutover pair; drops the edges', () => {
    const plan = planSplits(S, U, {
      switches: [
        { changed_at: at(20, 7), option: 'aIsPriced', old_state: null, new_state: 'shadow' },
        { changed_at: at(22, 6), option: 'aIsPriced', old_state: 'shadow', new_state: 'off' },
        { changed_at: at(0, 10), option: 'bIsPriced', old_state: 'off', new_state: 'on' },
      ],
      builds: [
        { build: 'old000000000', first_at: at(0), hands: 10 },
        { build: 'new111111111', first_at: at(2, 5), hands: 900 },
        { build: 'stby22222222', first_at: at(2, 12), hands: 40 },
      ],
    });
    expect(plan.splits.map((s) => s.at)).toEqual([
      '2026-11-25T07:05:00Z',
      '2026-11-26T01:07:00Z',
      '2026-11-26T03:06:00Z',
    ]);
    expect(plan.splits[0]!.why).toEqual([
      'engine build new111111111 first hand (900 hands in range)',
      'engine build stby22222222 first hand (40 hands in range)',
    ]);
    expect(plan.leftOut.map((s) => s.why[0])).toEqual(['switch bIsPriced off -> on']);
  });

  it('runs the exploit report in groups of at most 4 splits, each with its full window on both sides', () => {
    const splits = [1, 3, 5, 7, 9, 11].map((h) => S + h * 3600_000);
    const groups = splitGroups(
      S,
      U,
      splits.map((t) => ({ at: new Date(t).toISOString() })),
      EXPLOIT_MAX_SPLITS
    );
    expect(groups.map((g) => [g.since, g.until, g.splits.length])).toEqual([
      [S, splits[4], 4],
      [splits[3], U, 2],
    ]);
    const runs = planRuns(
      S,
      U,
      splits.map((t) => ({ at: new Date(t).toISOString() }))
    );
    expect(runs.map((r) => r.name)).toEqual([
      'holdem-audit',
      'omaha-audit',
      'exploit-report-1',
      'exploit-report-2',
      'person-vs-horse-1',
    ]);
    expect(runs[2]!.args).toContain('--gate=regression');
    expect(runs[4]!.args.join(' ')).toMatch(/--split-at (\S+,){5}\S+ --gate --json/);
    // no boundary: the exploit report gates absolute, people vs Horses reports
    const none = planRuns(S, U, []);
    expect(none.find((r) => r.name === 'exploit-report-1')!.args).toContain('--gate=absolute');
    expect(none.find((r) => r.name === 'person-vs-horse-1')!.args).not.toContain('--gate');
  });

  it('writes a dated folder and a one-page summary: tools, regressions, owner-rule breaches, top leaks', () => {
    const root = mkdtempSync(join(tmpdir(), 'daily-audit-'));
    const sqls: string[] = [];
    const calls: string[][] = [];
    const outputs: Record<string, { status: number; stdout: string }> = {
      'horse-hand-audit-holdem.mjs': {
        status: 0,
        stdout: JSON.stringify({
          leaks: [
            { fc: 'cash', street: 'river', type: 'river overfold', n: 30, bb: 12.5, per100: 4 },
          ],
          worse: [],
        }),
      },
      'horse-hand-audit-omaha.mjs': {
        status: 0,
        stdout: JSON.stringify({
          leaks: [
            {
              cls: 'OPPORTUNITY',
              type: 'missed bet',
              street: 'flop',
              pos: 'OOP',
              n: 50,
              bb: 400,
              per100: 27,
            },
            {
              cls: 'HARD',
              type: 'turn stab defence over-fold',
              street: 'turn',
              pos: 'IP',
              n: 12,
              bb: 40,
              per100: 3.2,
            },
          ],
          breaches: [
            {
              breach: 'non-nut raise turn/river',
              n: 3,
              vsPerson: 2,
              costBb: 7.5,
              examples: ['h1', 'h2'],
            },
          ],
        }),
      },
      'horse-exploit-report.mjs': {
        status: 1,
        stdout:
          JSON.stringify({
            gate: { line: 'GATE 1: 1 gating regression(s): plo5 cash river fold to bet' },
            findings: [
              { priority: 0, text: 'plo5 cash river fold to bet 61% vs 50% break-even' },
              { priority: 3, text: 'theory only' },
            ],
          }) + '\nGATE 1',
      },
      'person-vs-horse-results.mjs': { status: 0, stdout: '{}' },
    };
    const code = runDailyAudit(['--out-root', root, '--until', '2026-11-26T05:00:00Z'], {
      stdout: () => {},
      stderr: () => {},
      query: (sql: string) => {
        sqls.push(sql);
        return sql.includes('ca_horse_style_switch_audit')
          ? [{ changed_at: at(20, 7), option: 'aIsPriced', old_state: null, new_state: 'shadow' }]
          : [{ build: 'old000000000', first_at: at(0), hands: 1 }];
      },
      spawn: (_node: string, argv: string[]) => {
        calls.push(argv);
        const name = argv[0]!.split('/').at(-1)!;
        return { ...outputs[name]!, stderr: '' };
      },
    });
    expect(code).toBe(1);
    expect(sqls.every((s) => s.startsWith('SELECT '))).toBe(true);
    expect(calls.map((c) => c[0]!.split('/').at(-1))).toEqual([
      'horse-hand-audit-holdem.mjs',
      'horse-hand-audit-omaha.mjs',
      'horse-exploit-report.mjs',
      'person-vs-horse-results.mjs',
    ]);
    const dir = join(root, folderName(U));
    expect(folderName(U)).toBe('2026-11-26-0500Z');
    const summary = readFileSync(join(dir, 'SUMMARY.md'), 'utf8');
    expect(summary).toContain('- 2026-11-26T01:07:00Z: switch aIsPriced none -> shadow');
    expect(summary).toContain('| exploit-report-1 | 1 | FINDING (exploitable cell) |');
    expect(summary).toContain(
      '- exploit (exploit-report-1): GATE 1: 1 gating regression(s): plo5 cash river fold to bet'
    );
    expect(summary).toContain('- exploit: plo5 cash river fold to bet 61% vs 50% break-even');
    expect(summary).not.toContain('theory only');
    expect(summary).not.toContain('missed bet');
    expect(summary).toContain(
      '- PLO non-nut raise turn/river: 3 (2 versus a person, 7.5 bb); e.g. h1, h2'
    );
    expect(summary).toContain('- NLH cash river: river overfold (n 30, 12.5 bb, 4.0 bb/100)');
    expect(summary).toContain(
      '- PLO turn IP: turn stab defence over-fold (n 12, 40.0 bb, 3.2 bb/100 people)'
    );
    expect(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')).splits).toHaveLength(1);
  });

  it('a failed tool is exit 70 and named; a usage error is 64; no out-root is refused', () => {
    const runs = planRuns(S, U, []);
    const results = Object.fromEntries(runs.map((r) => [r.name, { code: 0, json: {} }]));
    expect(overallExit(runs, results)).toBe(0);
    results['holdem-audit'] = { code: 70, json: null };
    expect(overallExit(runs, results)).toBe(70);
    expect(
      formatSummary({
        sinceMs: S,
        untilMs: U,
        plan: { splits: [], leftOut: [] },
        runs,
        results,
        folder: 'f',
      })
    ).toContain('- holdem-audit: see holdem-audit.err');
    expect(() => parseArgs(['--until', '2026-11-26T05:00:00'])).toThrow(/zone/);
    expect(runDailyAudit([], { stdout: () => {}, stderr: () => {} })).toBe(64);
  });
});
