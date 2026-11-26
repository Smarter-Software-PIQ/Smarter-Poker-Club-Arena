import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPLOIT_MAX_SPLITS,
  boundarySql,
  formatSummary,
  overallExit,
  ownerRuleBreachesMarked,
  planRuns,
  planSplits,
  previousListing,
  regressionsMarked,
  splitGroups,
} from '../../scripts/ops/horse-daily-audit-lib.mjs';
import {
  folderName,
  loadPrevious,
  parseArgs,
  runDailyAudit,
} from '../../scripts/ops/horse-daily-audit.mjs';

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

  describe('a breach hand or a finding the run before already listed is a repeat (2026-11-26: 05:00Z and 13:33Z overlapped by 15.5 hours)', () => {
    const HAND = '0bf48e08-b5d8-412c-a63c-3e6e7d8667f9';
    const breach = (hands: string[], n = hands.length) => ({
      'omaha-audit': {
        code: 0,
        json: {
          breaches: [
            {
              breach: 'non-nut raise turn/river',
              n,
              vsPerson: n,
              costBb: 2.8,
              examples: hands.slice(0, 8),
            },
          ],
        },
      },
    });
    const prevOf = (results: Record<string, unknown>, untilMs = U, breachHands: string[] = []) => ({
      folder: '2026-11-26-0500Z',
      sinceMs: S,
      untilMs,
      results,
      breachHands,
    });
    const S2 = S + 8.55 * 3600_000; // 13:33Z the day before
    const U2 = U + 8.55 * 3600_000;

    it('the same breach hand in the next overlapping run is marked repeat and does not count again', () => {
      const listing = previousListing(prevOf(breach([HAND])), S2);
      const marked = ownerRuleBreachesMarked(breach([HAND]), listing);
      expect(marked.count).toBe(0);
      expect(marked.lines).toEqual([
        `PLO non-nut raise turn/river: 1 (1 versus a person, 2.8 bb); e.g. ${HAND} -- repeat (already reported 2026-11-26-0500Z)`,
      ]);
      const runs = planRuns(S2, U2, []);
      const results = {
        ...Object.fromEntries(runs.map((r) => [r.name, { code: 0, json: {} }])),
        ...breach([HAND]),
      };
      expect(overallExit(runs, results)).toBe(1);
      expect(overallExit(runs, results, prevOf(breach([HAND])), S2)).toBe(0);
      const text = formatSummary({
        sinceMs: S2,
        untilMs: U2,
        plan: { splits: [], leftOut: [] },
        runs,
        results,
        folder: 'f',
        previous: prevOf(breach([HAND])),
      });
      expect(text).toContain('Run before: 2026-11-26-0500Z (its range overlaps this one)');
      expect(text).toContain('-- repeat (already reported 2026-11-26-0500Z)');
    });
    it('a new breach hand beside an old one still counts, and says which is which', () => {
      const listing = previousListing(prevOf(breach([HAND])), S2);
      const marked = ownerRuleBreachesMarked(breach(['new-hand', HAND]), listing);
      expect(marked.count).toBe(1);
      expect(marked.lines[0]).toContain(
        'e.g. new-hand -- 1 new, 1 repeat (already reported 2026-11-26-0500Z)'
      );
      // hands the run before listed only in its decisions.csv count as listed too
      const viaCsv = previousListing(prevOf({}, U, ['new-hand', HAND]), S2);
      expect(ownerRuleBreachesMarked(breach(['new-hand', HAND]), viaCsv).count).toBe(0);
      // more cases than hands listed by id: never assumed to be repeats
      expect(ownerRuleBreachesMarked(breach([HAND], 3), listing).count).toBe(1);
    });
    it('a finding is a repeat only when the run before listed the same one and its range overlaps', () => {
      const KEY = 'tournament | preflop | vsJam | - | SB | all-in | MW | <10 | horse';
      const finding = (key: string, splitAt: string) => ({
        'holdem-audit': { code: 1, json: { worse: [{ key }] } },
        'exploit-report-1': {
          code: 1,
          out: 'exploit-report-1.json',
          json: {
            gate: { exitCode: 1, line: 'GATE 1: 1 gating regression(s)' },
            findings: [
              { key: 'plo4|cash||fold_to_bet|turn|lead|all|hu||', gating: true, splitAt },
              { key: 'other', gating: false, splitAt: null },
            ],
          },
        },
      });
      const now = finding(KEY, '2026-11-26T10:05:20Z');
      const same = previousListing(prevOf(finding(KEY, '2026-11-26T10:05:20Z')), S2);
      expect(regressionsMarked(now, same).count).toBe(0);
      expect(
        regressionsMarked(now, same).lines.every((l) => l.includes('-- repeat (already reported'))
      ).toBe(true);
      // the same cell at another split is a new finding
      const otherSplit = previousListing(
        prevOf(finding('another node', '2026-11-26T01:07:51Z')),
        S2
      );
      expect(regressionsMarked(now, otherSplit).count).toBe(2);
      // no overlap: the same node flagging again is a second measurement, reported in full
      const noOverlap = previousListing(prevOf(finding(KEY, '2026-11-26T10:05:20Z'), S2), S2);
      expect(noOverlap!.overlaps).toBe(false);
      expect(regressionsMarked(now, noOverlap).count).toBe(2);
      expect(regressionsMarked(now, null).count).toBe(2);
    });
    it('the runner finds the run before under --out-root (or --previous) and reads its outputs and decisions.csv', () => {
      const root = mkdtempSync(join(tmpdir(), 'horse-daily-prev-'));
      const prev = join(root, '2026-11-26-0500Z');
      mkdirSync(join(prev, 'omaha-audit-csv'), { recursive: true });
      writeFileSync(
        join(prev, 'plan.json'),
        JSON.stringify({
          since: '2026-11-25T05:00:00Z',
          until: '2026-11-26T05:00:00Z',
          runs: [
            { name: 'omaha-audit', out: 'omaha-audit.json' },
            { name: 'exploit-report-1', out: 'exploit-report-1.json' },
          ],
        })
      );
      writeFileSync(
        join(prev, 'omaha-audit.json'),
        JSON.stringify(breach([HAND])['omaha-audit'].json)
      );
      writeFileSync(
        join(prev, 'exploit-report-1.json'),
        `${JSON.stringify({ gate: { exitCode: 1, line: 'GATE 1' }, findings: [] })}\nGATE 1`
      );
      writeFileSync(
        join(prev, 'omaha-audit-csv', 'decisions.csv'),
        'hand_id,street,options,breach,nuts\nh-a,turn,"a:1,b:2",non-nut raise turn/river,false\nh-b,turn,x,,true\n'
      );
      mkdirSync(join(root, '2026-11-26-1333Z'));
      mkdirSync(join(root, 'notes'));
      const got = loadPrevious(root, '2026-11-26-1333Z')!;
      expect(got.folder).toBe('2026-11-26-0500Z');
      expect(got.untilMs).toBe(U);
      expect(got.breachHands).toEqual(['h-a']);
      expect(got.results['exploit-report-1'].code).toBe(1);
      const listing = previousListing(got, S2)!;
      expect([...listing.hands].sort()).toEqual([HAND, 'h-a'].sort());
      expect(loadPrevious(root, '2026-11-26-0500Z')).toBeNull(); // nothing earlier
      expect(loadPrevious(join(root, 'missing'), 'x')).toBeNull();
      expect(loadPrevious(null, 'x', prev)!.folder).toBe('2026-11-26-0500Z');
      expect(parseArgs(['--previous', prev]).previous).toBe(prev);
    });
  });
});
