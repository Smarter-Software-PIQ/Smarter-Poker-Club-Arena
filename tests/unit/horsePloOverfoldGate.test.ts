// The PLO over-fold alarm (scripts/ops/horse-plo-overfold-gate*.mjs) and its place in the Horse daily audit.
// Fixtures are counts and actions only: no hole cards anywhere.
import { describe, expect, it } from 'vitest';
import { correctedZ } from '../../scripts/ops/horse-audit-multiple-tests.mjs';
import {
  GATE_Z,
  MIN_N,
  balancedBluff,
  breakEvenFold,
  foldCeiling,
  gateCells,
  overfoldSpots,
  peoplePriorCell,
} from '../../scripts/ops/horse-plo-overfold-gate-lib.mjs';
import {
  overfoldSql,
  runOverfoldGate,
  spotsOf,
} from '../../scripts/ops/horse-plo-overfold-gate.mjs';
import { parseHand } from '../../scripts/ops/horse-hand-audit-omaha-lib/hand.mjs';
import {
  formatSummary,
  overallExit,
  planRuns,
  regressionsMarked,
  previousListing,
} from '../../scripts/ops/horse-daily-audit-lib.mjs';

type Spot = { street: string; bucket: string; s: number; fold: boolean };
/** n decisions in one cell at bet share s, `folds` of them folds. */
const cell = (street: string, s: number, n: number, folds: number): Spot[] =>
  Array.from({ length: n }, (_, i) => ({
    street,
    bucket: s < 0.4 ? 'small' : s < 0.7 ? 'mid' : 'large',
    s,
    fold: i < folds,
  }));
const PEOPLE = (share: number, n = 150) => ({
  source: 'people-only',
  bluff: {
    river: {
      hu: {
        under40: { n, share },
        mid: { n, share },
        big: { n, share },
        over: { n: 0, share: null },
      },
    },
    turn: {
      hu: {
        under40: { n, share },
        mid: { n, share },
        big: { n, share },
        over: { n: 0, share: null },
      },
    },
  },
});

describe('the fold ceiling', () => {
  it('is the break-even fold s/(1+s) without a people cell, and while people bluff at least the balanced share', () => {
    expect(foldCeiling(0.75)).toBeCloseTo(0.75 / 1.75, 12);
    expect(foldCeiling(0.5, balancedBluff(0.5))).toBeCloseTo(breakEvenFold(0.5), 12);
    expect(foldCeiling(0.5, 0.4)).toBeCloseTo(breakEvenFold(0.5), 12);
  });
  it('rises from the break-even fold to 1 as people bluff less than the balanced share (monotone)', () => {
    expect(foldCeiling(0.5, 0)).toBe(1);
    let last = breakEvenFold(0.5);
    for (const b of [0.24, 0.2, 0.15, 0.1, 0.05, 0]) {
      const c = foldCeiling(0.5, b);
      expect(c).toBeGreaterThan(last);
      last = c;
    }
  });
  it('uses a people prior only when it says people-only and the cell has enough people bets; 0.7+ pools big and over', () => {
    expect(peoplePriorCell({ ...PEOPLE(0.2), source: 'population' }, 'river', 'large')).toBeNull();
    expect(peoplePriorCell(PEOPLE(0.2, 10), 'river', 'large')).toBeNull();
    const p = PEOPLE(0.2);
    p.bluff.river.hu.over = { n: 50, share: 0.4 } as never;
    expect(peoplePriorCell(p, 'river', 'large')).toEqual({
      n: 200,
      share: (150 * 0.2 + 50 * 0.4) / 200,
    });
    expect(peoplePriorCell(p, 'turn', 'small')).toEqual({ n: 150, share: 0.2 });
  });
});

describe('the gate (counts only)', () => {
  it('gates a cell whose folds are above the ceiling by the corrected z; names the cell, n, rates and z', () => {
    const current = [...cell('river', 0.75, 60, 50), ...cell('turn', 0.5, 40, 12)];
    const g = gateCells({ current, previous: cell('river', 0.75, 90, 54) });
    expect(g.tests).toBe(2);
    expect(g.zBar).toBeCloseTo(correctedZ(GATE_Z, 2), 9);
    expect(g.gating).toEqual(['overfold|river|large']);
    expect(g.exitCode).toBe(1);
    const c = g.cells.find((x) => x.key === 'overfold|river|large')!;
    expect(c.n).toBe(60);
    expect(c.rate).toBeCloseTo(50 / 60, 12);
    expect(c.ceiling).toBeCloseTo(0.75 / 1.75, 12);
    expect(c.previousRate).toBeCloseTo(0.6, 12);
    expect(c.zPrevious).toBeGreaterThan(0);
    expect(g.line).toMatch(
      /^PLO over-fold river 0\.7\+ pot \(heads-up, facing a person's first bet\): n 60, Horse folds 83\.3% vs ceiling 42\.9% \(break-even s\/\(1\+s\)\), previous 3 days 60\.0% \(n 90, z \d\.\d\d\); z \d+\.\d\d >= bar \d\.\d\d \(2 cells tested\)$/
    );
  });
  it('does not gate below the bar, on a cell under MIN_N, or on the previous days alone', () => {
    const g = gateCells({
      current: [...cell('river', 0.75, 60, 28), ...cell('turn', 0.3, MIN_N - 1, MIN_N - 1)],
      previous: cell('river', 0.75, 300, 290),
    });
    expect(g.gating).toEqual([]);
    expect(g.exitCode).toBe(0);
    expect(g.cells.find((x) => x.key === 'overfold|turn|small')!.tested).toBe(false);
    expect(gateCells({ current: cell('river', 0.75, 5, 5) }).exitCode).toBe(2);
  });
  it('the people-measured ceiling replaces the break-even fold: an under-bluffing people cell lets the Horse fold more', () => {
    const current = cell('river', 0.75, 60, 40);
    expect(gateCells({ current }).gating).toEqual(['overfold|river|large']);
    const withPeople = gateCells({ current, prior: PEOPLE(0.1) });
    expect(withPeople.gating).toEqual([]);
    expect(withPeople.cells.find((x) => x.key === 'overfold|river|large')!.ceilingSource).toBe(
      'people-measured (bluff share 10.0%, n 150)'
    );
    // people who over-bluff keep the break-even ceiling: still gates
    expect(gateCells({ current, prior: PEOPLE(0.45) }).gating).toEqual(['overfold|river|large']);
  });
});

/** A hand row as the gate's SQL selects it: seats, Horse flags and actions; no hole cards. */
const P = '11111111-1111-4111-8111-111111111111';
const H = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';
function row(opts: {
  bettor?: string;
  origin?: string;
  responder?: string;
  act?: string;
  third?: boolean;
  raiseFirst?: boolean;
  created?: string;
  id?: string;
}) {
  const bettor = opts.bettor ?? P;
  const responder = opts.responder ?? H;
  const pl: unknown[] = [
    [1, P, 500, null, false],
    [2, H, 500, null, true],
  ];
  if (opts.third) pl.push([3, V, 500, null, true]);
  const ac: unknown[] = [];
  if (opts.raiseFirst) ac.push([1, 'river', 'bet', 20, 'player', false, 100, 0, responder]);
  ac.push([
    bettor === P ? 1 : 2,
    'river',
    opts.raiseFirst ? 'raise' : 'bet',
    75,
    opts.origin ?? 'player',
    false,
    100,
    0,
    bettor,
  ]);
  ac.push([
    responder === H ? 2 : 1,
    'river',
    opts.act ?? 'fold',
    0,
    'horse_policy',
    false,
    175,
    75,
    responder,
  ]);
  return {
    id: opts.id ?? '44444444-4444-4444-8444-444444444444',
    created_at: opts.created ?? '2026-11-26 01:00:00+00',
    gv: 'plo5',
    bb: 2,
    btn: 2,
    pot: 100,
    bomb: false,
    cc2: null,
    pl,
    ac,
  };
}

describe("the spots: a Horse, heads-up on the turn or river, facing a person's first bet", () => {
  it("counts the Horse facing a person's first river bet, with its size and fold", () => {
    const spots = overfoldSpots(parseHand(row({})));
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ street: 'river', bucket: 'large', fold: true });
    expect(spots[0]!.s).toBeCloseTo(0.75, 12);
    expect(overfoldSpots(parseHand(row({ act: 'call' })))[0]!.fold).toBe(false);
  });
  it('leaves out a Horse bettor, a person acting on Horse policy, a person responding, multiway, and a raise', () => {
    expect(overfoldSpots(parseHand(row({ bettor: H, responder: P })))).toEqual([]);
    expect(overfoldSpots(parseHand(row({ origin: 'horse_policy' })))).toEqual([]);
    expect(overfoldSpots(parseHand(row({ third: true })))).toEqual([]);
    expect(overfoldSpots(parseHand(row({ raiseFirst: true })))).toEqual([]);
  });
});

describe('the tool (read-only, no hole cards)', () => {
  it('selects no hole-card, showdown or winner column, and only reads', () => {
    const sql = overfoldSql({
      from: Date.parse('2026-11-25T00:00:00Z'),
      to: Date.parse('2026-11-26T00:00:00Z'),
    });
    expect(sql).toMatch(/^select /);
    expect(sql).not.toMatch(/hole_cards|showdown|winners/);
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
    expect(sql).toContain('pr2.is_horse = false');
  });
  it('splits the range from the previous 3 days and exits on the gate', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) =>
        row({
          id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
          created: '2026-11-26 01:00:00+00',
        })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        row({
          id: `55555555-4444-4444-8444-${String(i).padStart(12, '0')}`,
          created: '2026-11-24 01:00:00+00',
          act: 'call',
        })
      ),
    ];
    const since = Date.parse('2026-11-25T05:00:00Z');
    const until = Date.parse('2026-11-26T05:00:00Z');
    const split = spotsOf(rows, since, until);
    expect(split.current).toHaveLength(30);
    expect(split.previous).toHaveLength(10);
    const out: string[] = [];
    const sqls: string[] = [];
    const code = runOverfoldGate(
      ['--since', '2026-11-25T05:00:00Z', '--until', '2026-11-26T05:00:00Z', '--json'],
      {
        stdout: (s: string) => out.push(s),
        stderr: () => {},
        prior: null,
        query: (sql: string) => {
          sqls.push(sql);
          const [, a, b] = sql.match(/created_at >= '([^']+)' and h\.created_at < '([^']+)'/)!;
          return rows.filter((r) => {
            const t = Date.parse(r.created_at.replace(' ', 'T').replace('+00', 'Z'));
            return t >= Date.parse(a!) && t < Date.parse(b!);
          });
        },
      }
    );
    expect(code).toBe(1);
    expect(sqls.length).toBe(4);
    const j = JSON.parse(out[0]!);
    expect(j.previousSince).toBe('2026-11-22T05:00:00Z');
    expect(j.gating).toEqual(['overfold|river|large']);
    expect(out.at(-1)).toMatch(/^PLO over-fold river 0\.7\+ pot .*n 30, Horse folds 100\.0%/);
    expect(runOverfoldGate([], { stdout: () => {}, stderr: () => {} })).toBe(64);
  });
});

describe('in the daily audit', () => {
  const S = Date.parse('2026-11-25T05:00:00Z');
  const U = Date.parse('2026-11-26T05:00:00Z');
  const gate = gateCells({ current: cell('river', 0.75, 60, 50) });
  const results = {
    'plo-overfold': { code: 1, json: { cells: gate.cells, gate, prior: 'no people prior' } },
  };
  it('a gating cell is a regression (exit 1) named by street and size; the same cell in an overlapping run before is a repeat', () => {
    const m = regressionsMarked(results);
    expect(m.count).toBe(1);
    expect(m.lines[0]).toContain('PLO over-fold river 0.7+ pot');
    const runs = planRuns(S, U, []);
    const all = Object.fromEntries(runs.map((r) => [r.name, { code: 0, json: {} }]));
    expect(overallExit(runs, { ...all, ...results })).toBe(1);
    const listing = previousListing(
      {
        folder: '2026-11-25-1700Z',
        sinceMs: S - 12 * 3600_000,
        untilMs: U - 12 * 3600_000,
        results: { 'plo-overfold': { code: null, json: { cells: gate.cells } } },
      },
      S
    );
    const again = regressionsMarked(results, listing);
    expect(again.count).toBe(0);
    expect(again.lines[0]).toContain('repeat (already reported 2026-11-25-1700Z)');
    const summary = formatSummary({
      sinceMs: S,
      untilMs: U,
      plan: { splits: [], leftOut: [] },
      runs,
      results: { ...all, ...results },
      folder: 'f',
    });
    expect(summary).toContain(
      "## PLO Over-Fold Gate (heads-up turn and river, facing a person's first bet)"
    );
    expect(summary).toMatch(
      /\| river \| 0\.7\+ pot \| 60 \| 83\.3% \| 42\.9% \| break-even s\/\(1\+s\) \| - \(0\) \| - \| \d+\.\d\d \| GATES \|/
    );
  });
});
