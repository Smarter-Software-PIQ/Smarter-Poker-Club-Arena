// The over-fold alarm, every cell (scripts/ops/horse-plo-overfold-gate*.mjs) and its place in the Horse daily audit.
// Fixtures are counts and actions only: no hole cards anywhere.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { correctedZ } from '../../scripts/ops/horse-audit-multiple-tests.mjs';
import {
  BUCKETS,
  FIELDS,
  GATE_Z,
  GROUPS,
  MIN_N,
  PEOPLE_MIN_N,
  STREETS,
  balancedBluff,
  breakEvenFold,
  cellTable,
  fixClassOf,
  foldCeiling,
  gateCells,
  minimumDefenceFold,
  overfoldSpots,
  ownerOf,
  ownerState,
  peoplePriorCell,
} from '../../scripts/ops/horse-plo-overfold-gate-lib.mjs';
import {
  loadOwnerMap,
  overfoldSql,
  readFrom,
  runOverfoldGate,
  spotsOf,
  switchSql,
  switchesOf,
} from '../../scripts/ops/horse-plo-overfold-gate.mjs';
import { parseHand } from '../../scripts/ops/horse-hand-audit-omaha-lib/hand.mjs';
import {
  OVERFOLD_HEADING,
  formatSummary,
  overallExit,
  planRuns,
  regressionsMarked,
  previousListing,
} from '../../scripts/ops/horse-daily-audit-lib.mjs';

type Spot = {
  gv: string;
  mtt: boolean;
  street: string;
  field: string;
  opponents: number;
  bucket: string;
  s: number;
  fold: boolean;
  who: string;
};
const S_OF: Record<string, number> = { small: 0.3, mid: 0.5, large: 0.75 };
/** n decisions in one cell, `folds` of them folds. group: a GROUPS key that is one game (not the pooled one). */
function cell(
  group: string,
  street: string,
  field: string,
  bucket: string,
  n: number,
  folds: number,
  who = 'horse'
): Spot[] {
  const g = GROUPS.find((x) => x.key === group)!;
  return Array.from({ length: n }, (_, i) => ({
    gv: g.gv[0]!,
    mtt: g.mtt,
    street,
    field,
    opponents: field === 'hu' ? 1 : 2,
    bucket,
    s: S_OF[bucket]!,
    fold: i < folds,
    who,
  }));
}
const bluffCells = (share: number, n: number) => ({
  under40: { n, share },
  mid: { n, share },
  big: { n, share },
  over: { n: 0, share: null },
});
const PEOPLE = (share: number, n = 150, flop = false) => ({
  source: 'people-only',
  bluff: {
    river: { hu: bluffCells(share, n), mw: bluffCells(share, n) },
    turn: { hu: bluffCells(share, n), mw: bluffCells(share, n) },
  },
  ...(flop ? { flop: { hu: bluffCells(share, n), mw: bluffCells(share, n) } } : {}),
});
const OWNER_MAP = loadOwnerMap().ownerMap!;
const SINGLE_GROUPS = GROUPS.filter((g) => g.gv.length === 1);

describe('the fold ceiling', () => {
  it('is the minimum-defence fold s/(1+s) without a people cell, and while people bluff at least the balanced share', () => {
    expect(foldCeiling(0.75)).toBeCloseTo(0.75 / 1.75, 12);
    expect(foldCeiling(0.5, balancedBluff(0.5))).toBeCloseTo(breakEvenFold(0.5), 12);
    expect(foldCeiling(0.5, 0.4)).toBeCloseTo(breakEvenFold(0.5), 12);
  });
  it('multiway the k players left share one fold budget: each may fold (s/(1+s))^(1/k), so all folding together is s/(1+s)', () => {
    for (const s of [0.3, 0.5, 0.75, 1]) {
      expect(minimumDefenceFold(s, 1)).toBeCloseTo(s / (1 + s), 12);
      for (const k of [2, 3, 4]) {
        const each = minimumDefenceFold(s, k);
        expect(Math.pow(each, k)).toBeCloseTo(s / (1 + s), 12);
        expect(each).toBeGreaterThan(minimumDefenceFold(s, k - 1));
        expect(foldCeiling(s, null, k)).toBeCloseTo(each, 12);
      }
    }
  });
  it('rises from the minimum-defence fold to 1 as people bluff less than the balanced share (monotone)', () => {
    expect(foldCeiling(0.5, 0)).toBe(1);
    let last = breakEvenFold(0.5);
    for (const b of [0.24, 0.2, 0.15, 0.1, 0.05, 0]) {
      const c = foldCeiling(0.5, b);
      expect(c).toBeGreaterThan(last);
      last = c;
    }
  });
  it('uses a people prior cell only when it says people-only and has enough people bets; 0.7+ pools big and over; the flop is read where the table has it', () => {
    expect(
      peoplePriorCell({ ...PEOPLE(0.2), source: 'population' }, 'river', 'hu', 'large')
    ).toBeNull();
    expect(peoplePriorCell(PEOPLE(0.2, 10), 'river', 'hu', 'large')).toBeNull();
    const p = PEOPLE(0.2);
    p.bluff.river.hu.over = { n: 50, share: 0.4 } as never;
    expect(peoplePriorCell(p, 'river', 'hu', 'large')).toEqual({
      n: 200,
      share: (150 * 0.2 + 50 * 0.4) / 200,
    });
    expect(peoplePriorCell(p, 'turn', 'mw', 'small')).toEqual({ n: 150, share: 0.2 });
    // no flop cells in the table (main before the flop fit): absent, not an error
    expect(peoplePriorCell(p, 'flop', 'hu', 'large')).toBeNull();
    expect(peoplePriorCell(PEOPLE(0.3, 150, true), 'flop', 'mw', 'mid')).toEqual({
      n: 150,
      share: 0.3,
    });
  });
});

describe('the gate, every cell (counts only)', () => {
  const all = gateCells({});
  it('has every cell: 5 game groups x 3 streets x heads-up and multiway x 3 sizes and an all-sizes row, each naming its ceiling source', () => {
    expect(all.cells).toHaveLength(
      GROUPS.length * STREETS.length * FIELDS.length * (BUCKETS.length + 1)
    );
    expect(all.cells).toHaveLength(120);
    expect(new Set(all.cells.map((c) => c.key)).size).toBe(120);
    for (const g of ['plo5', 'plo4', 'plo', 'nlh-cash', 'nlh-mtt'])
      for (const street of ['flop', 'turn', 'river'])
        for (const f of ['hu', 'mw'])
          for (const b of ['small', 'mid', 'large', 'all'])
            expect(all.cells.some((c) => c.key === `overfold|${g}|${street}|${f}|${b}`)).toBe(true);
    for (const c of all.cells) {
      expect(c.ceilingSource).toMatch(
        c.bucket === 'all'
          ? /^each decision against its size cell: (people prior table|people's own folds|minimum-defence)/
          : /^(people prior table|people's own folds|minimum-defence)/
      );
      for (const t of c.ceilingTier.split('+'))
        expect(['people-prior', 'people-14d', 'minimum-defence']).toContain(t);
    }
    expect(all.exitCode).toBe(2);
    // with the prior, people's folds and neither, every cell of a run still names one of the three
    const rich = gateCells({
      prior: PEOPLE(0.3, 150, true),
      people: SINGLE_GROUPS.flatMap((g) => cell(g.key, 'turn', 'mw', 'mid', 60, 30, 'person')),
    });
    for (const c of rich.cells) expect(c.ceilingSource.length).toBeGreaterThan(10);
    expect(rich.cells.find((c) => c.key === 'overfold|nlh-cash|turn|mw|mid')!.ceilingTier).toBe(
      'people-14d'
    );
    expect(rich.cells.find((c) => c.key === 'overfold|plo5|turn|mw|mid')!.ceilingTier).toBe(
      'people-prior'
    );
    expect(rich.cells.find((c) => c.key === 'overfold|nlh-mtt|flop|hu|small')!.ceilingTier).toBe(
      'minimum-defence'
    );
  });

  it('fires on a synthetic over-fold in EVERY cell and stays quiet at the ceiling, under each of the three ceilings', () => {
    const prior = PEOPLE(0.45, 150, true); // people bluff over the balanced share: ceiling = minimum defence
    for (const withPeople of [false, true])
      for (const g of SINGLE_GROUPS)
        for (const street of STREETS)
          for (const f of FIELDS)
            for (const b of BUCKETS) {
              const key = `overfold|${g.key}|${street}|${f.key}|${b.key}`;
              const k = f.key === 'hu' ? 1 : 2;
              const anchor = minimumDefenceFold(S_OF[b.key]!, k);
              // people fold at the anchor + 5 points: that is the ceiling where people's own folds are used
              const peopleFolds = Math.round(200 * Math.min(0.97, anchor + 0.05));
              const people = withPeople
                ? cell(g.key, street, f.key, b.key, 200, peopleFolds, 'person')
                : [];
              const base = {
                people,
                prior: g.prior ? prior : null,
                ownerMap: OWNER_MAP,
                switches: {},
              };
              const over = gateCells({
                ...base,
                current: cell(g.key, street, f.key, b.key, 200, 200),
              });
              expect(over.gating, key).toContain(key);
              expect(over.exitCode, key).toBe(1);
              const c = over.cells.find((x) => x.key === key)!;
              expect(c.ceilingTier, key).toBe(
                g.prior ? 'people-prior' : withPeople ? 'people-14d' : 'minimum-defence'
              );
              expect(c.line, key).toContain('OVER ITS CEILING');
              // at the ceiling (folds = the ceiling's share of 200, rounded down): quiet
              const ceil = c.ceilingTier === 'people-14d' ? peopleFolds / 200 : anchor;
              const at = gateCells({
                ...base,
                current: cell(g.key, street, f.key, b.key, 200, Math.floor(200 * ceil)),
              });
              expect(at.gating, key).toEqual([]);
              expect(at.exitCode, key).toBe(0);
            }
  });

  it('a leak spread thin over the three sizes (each under MIN_N) fires on the all-sizes row of every game, street and players', () => {
    for (const g of SINGLE_GROUPS)
      for (const street of STREETS)
        for (const f of FIELDS) {
          const current = BUCKETS.flatMap((b) =>
            cell(g.key, street, f.key, b.key, MIN_N - 5, MIN_N - 5)
          );
          const r = gateCells({ current });
          const key = `overfold|${g.key}|${street}|${f.key}|all`;
          expect(r.gating, key).toContain(key);
          for (const b of BUCKETS) {
            const c = r.cells.find(
              (x) => x.key === `overfold|${g.key}|${street}|${f.key}|${b.key}`
            )!;
            expect(c.tested, key).toBe(false);
            expect(c.gating, key).toBe(false);
          }
          const all = r.cells.find((x) => x.key === key)!;
          expect(all.n).toBe(3 * (MIN_N - 5));
          // its ceiling is the mean of the decisions' own size-cell ceilings
          const k = f.key === 'hu' ? 1 : 2;
          const mean = BUCKETS.reduce((a, b) => a + minimumDefenceFold(S_OF[b.key]!, k), 0) / 3;
          expect(all.ceiling!, key).toBeCloseTo(mean, 9);
          // and at that ceiling it is quiet
          const quiet = gateCells({
            current: BUCKETS.flatMap((b) =>
              cell(
                g.key,
                street,
                f.key,
                b.key,
                MIN_N - 5,
                Math.floor((MIN_N - 5) * minimumDefenceFold(S_OF[b.key]!, k))
              )
            ),
          });
          expect(quiet.gating, key).toEqual([]);
        }
  });

  it('the pooled PLO4+PLO5 cell fires when both games over-fold, and a tournament hand never lands in a cash cell', () => {
    const g = gateCells({
      current: [
        ...cell('plo4', 'flop', 'mw', 'mid', 40, 40),
        ...cell('plo5', 'flop', 'mw', 'mid', 40, 40),
      ],
    });
    expect(g.gating).toEqual(
      expect.arrayContaining([
        'overfold|plo|flop|mw|mid',
        'overfold|plo4|flop|mw|mid',
        'overfold|plo5|flop|mw|mid',
        'overfold|plo|flop|mw|all',
      ])
    );
    expect(g.cells.find((c) => c.key === 'overfold|plo|flop|mw|mid')!.n).toBe(80);
    const t = gateCells({ current: cell('nlh-mtt', 'river', 'hu', 'large', 60, 60) });
    expect(t.gating).toEqual(['overfold|nlh-mtt|river|hu|large', 'overfold|nlh-mtt|river|hu|all']);
    expect(t.cells.find((c) => c.key === 'overfold|nlh-cash|river|hu|large')!.n).toBe(0);
  });

  it('keeps the statistics: the corrected bar counts every test of the run, a cell needs MIN_N, the previous days never gate alone but pool', () => {
    const current = [
      ...cell('plo5', 'river', 'hu', 'large', 60, 50),
      ...cell('plo5', 'turn', 'hu', 'mid', 40, 12),
    ];
    const previous = cell('plo5', 'river', 'hu', 'large', 90, 54);
    const g = gateCells({ current, previous });
    // plo5 and pooled plo: 2 cells each on the range, and the river cell again pooled with the previous days
    // and each again on its all-sizes row
    expect(g.tests).toBe(12);
    expect(g.zBar).toBeCloseTo(correctedZ(GATE_Z, 12), 9);
    expect(g.gating).toEqual(
      expect.arrayContaining(['overfold|plo5|river|hu|large', 'overfold|plo|river|hu|large'])
    );
    const c = g.cells.find((x) => x.key === 'overfold|plo5|river|hu|large')!;
    expect(c.n).toBe(60);
    expect(c.rate).toBeCloseTo(50 / 60, 12);
    expect(c.ceiling).toBeCloseTo(0.75 / 1.75, 12);
    expect(c.previousRate).toBeCloseTo(0.6, 12);
    expect(c.zPrevious).toBeGreaterThan(0);
    expect(c.pooledN).toBe(150);
    expect(c.pooledRate).toBeCloseTo(104 / 150, 12);
    expect(c.line).toMatch(
      /^Over-fold PLO5 cash river heads-up 0\.7\+ pot \(facing a person's first bet\): n 60, Horse folds 83\.3% vs ceiling 42\.9% \(minimum-defence s\/\(1\+s\) \(no people prior cell; people n 0 < 30\)\), z \d+\.\d\d; with the previous 3 days n 150, 69\.3% vs 42\.9%, z \d+\.\d\d \(range against previous z \d\.\d\d\); OVER ITS CEILING on the range bar \d\.\d\d \(12 tests\); no owner yet$/
    );
    // below the bar, under MIN_N, and previous days alone
    const quiet = gateCells({
      current: [
        ...cell('plo5', 'river', 'hu', 'large', 60, 28),
        ...cell('plo5', 'turn', 'hu', 'small', MIN_N - 1, MIN_N - 1),
      ],
    });
    expect(quiet.gating).toEqual([]);
    expect(quiet.exitCode).toBe(0);
    expect(quiet.cells.find((x) => x.key === 'overfold|plo5|turn|hu|small')!.tested).toBe(false);
    expect(gateCells({ current: cell('plo5', 'river', 'hu', 'large', 5, 5) }).exitCode).toBe(2);
    expect(gateCells({ previous: cell('plo5', 'river', 'hu', 'large', 300, 290) }).gating).toEqual(
      []
    );
    // a drift too small for one day is seen on the pooled window
    const drift = gateCells({
      current: cell('nlh-cash', 'turn', 'hu', 'mid', 30, 14),
      previous: cell('nlh-cash', 'turn', 'hu', 'mid', 170, 108),
    });
    const d = drift.cells.find((x) => x.key === 'overfold|nlh-cash|turn|hu|mid')!;
    expect(d.zCeiling!).toBeLessThan(drift.zBar);
    expect(d.gatingWindow).toBe('pooled');
    expect(d.line).toContain('OVER ITS CEILING on the pooled window');
  });

  it('ceiling order: the people prior cell, else people own folds over 14 days (with n, never under minimum defence), else minimum defence', () => {
    const current = cell('plo5', 'river', 'hu', 'large', 60, 40);
    const key = 'overfold|plo5|river|hu|large';
    const find = (g: ReturnType<typeof gateCells>) => g.cells.find((x) => x.key === key)!;
    // 3: nothing measured
    expect(find(gateCells({ current })).ceilingTier).toBe('minimum-defence');
    expect(gateCells({ current }).gating).toContain(key);
    // 2: people's own folds (65%): 66.7% is not over it; the source carries the rate and n
    const people = cell('plo5', 'river', 'hu', 'large', 200, 130, 'person');
    const two = find(gateCells({ current, people }));
    expect(two.ceilingSource).toBe("people's own folds, trailing 14 days (65.0%, n 200)");
    expect(two.ceiling).toBeCloseTo(0.65, 12);
    expect(two.gating).toBe(false);
    // too few people decisions: back to minimum defence, and it says why
    const thin = find(
      gateCells({
        current,
        people: cell('plo5', 'river', 'hu', 'large', PEOPLE_MIN_N - 1, 20, 'person'),
      })
    );
    expect(thin.ceilingSource).toBe(
      `minimum-defence s/(1+s) (no people prior cell; people n ${PEOPLE_MIN_N - 1} < ${PEOPLE_MIN_N})`
    );
    // sticky people (fold 20%, under the minimum defence 42.9%): the measured people cell still comes first
    const sticky = find(
      gateCells({ current, people: cell('plo5', 'river', 'hu', 'large', 200, 40, 'person') })
    );
    expect(sticky.ceiling).toBeCloseTo(0.2, 12);
    expect(sticky.ceilingTier).toBe('people-14d');
    expect(sticky.ceilingSource).toBe("people's own folds, trailing 14 days (20.0%, n 200)");
    // 1: the prior cell wins over people's own folds; an under-bluffing people cell lets the Horse fold more
    const one = find(gateCells({ current, people, prior: PEOPLE(0.1) }));
    expect(one.ceilingSource).toBe('people prior table (bluff share 10.0%, n 150)');
    expect(one.gating).toBe(false);
    expect(gateCells({ current, prior: PEOPLE(0.45) }).gating).toContain(key);
    // the prior is PLO's: a Hold'em cell never reads it
    expect(
      gateCells({ prior: PEOPLE(0.1) }).cells.find(
        (x) => x.key === 'overfold|nlh-cash|river|hu|large'
      )!.ceilingTier
    ).toBe('minimum-defence');
    // a small people sample widens the test: the same folds gate against 2,000 people decisions, not against 40
    const cur2 = cell('nlh-cash', 'turn', 'mw', 'mid', 60, 52);
    const k2 = 'overfold|nlh-cash|turn|mw|mid';
    const big = gateCells({
      current: cur2,
      people: cell('nlh-cash', 'turn', 'mw', 'mid', 2000, 1300, 'person'),
    });
    const small = gateCells({
      current: cur2,
      people: cell('nlh-cash', 'turn', 'mw', 'mid', 40, 26, 'person'),
    });
    expect(big.gating).toContain(k2);
    expect(small.gating).toEqual([]);
  });
});

describe('the fix signal: over the ceiling with the fix ON is a regression, listed first', () => {
  const since = Date.parse('2026-11-26T05:00:00Z');
  const previousSince = since - 3 * 86400_000;
  const current = [
    ...cell('plo5', 'turn', 'hu', 'large', 60, 55),
    ...cell('plo5', 'flop', 'hu', 'large', 60, 55),
    ...cell('plo5', 'turn', 'mw', 'mid', 60, 59),
    ...cell('plo5', 'flop', 'mw', 'mid', 60, 59),
    ...cell('nlh-cash', 'river', 'hu', 'large', 60, 55),
  ];
  const run = (switches: Record<string, { state: string; since: string | null }> | null) =>
    gateCells({
      current,
      ownerMap: OWNER_MAP,
      switches,
      sinceMs: since,
      previousSinceMs: previousSince,
    });
  const cls = (g: ReturnType<typeof gateCells>, key: string) =>
    g.cells.find((c) => c.key === key)!.fixClass;

  it('the owner map: heads-up turn/river, heads-up flop big bets, multiway turn/river; everything else has no owner yet', () => {
    const o = (g: string, s: string, f: string, b: string) =>
      ownerOf(OWNER_MAP, g, s, f, b)?.option ?? null;
    for (const g of ['plo4', 'plo5', 'plo']) {
      for (const b of ['small', 'mid', 'large']) {
        expect(o(g, 'turn', 'hu', b)).toBe('omahaFacingBetPriorIsPeopleMeasured');
        expect(o(g, 'river', 'hu', b)).toBe('omahaFacingBetPriorIsPeopleMeasured');
        expect(o(g, 'turn', 'mw', b)).toBe('omahaMultiwayFieldIsPeopleMeasured');
        expect(o(g, 'river', 'mw', b)).toBe('omahaMultiwayFieldIsPeopleMeasured');
        expect(o(g, 'flop', 'mw', b)).toBeNull();
      }
      expect(o(g, 'flop', 'hu', 'large')).toBe('omahaFlopPressureCapIsPriced');
      expect(o(g, 'flop', 'hu', 'mid')).toBeNull();
      expect(o(g, 'flop', 'hu', 'small')).toBeNull();
      // the all-sizes row has an owner only where one option owns every size
      expect(o(g, 'turn', 'hu', 'all')).toBe('omahaFacingBetPriorIsPeopleMeasured');
      expect(o(g, 'river', 'mw', 'all')).toBe('omahaMultiwayFieldIsPeopleMeasured');
      expect(o(g, 'flop', 'hu', 'all')).toBeNull();
    }
    for (const g of ['nlh-cash', 'nlh-mtt'])
      for (const s of STREETS)
        for (const f of ['hu', 'mw'])
          for (const b of ['small', 'mid', 'large']) expect(o(g, s, f, b)).toBeNull();
  });

  it('fix OFF (no row, off, shadow, not registered yet), fix ON, ON for part of the window, switch not read', () => {
    const off = run({});
    expect(cls(off, 'overfold|plo5|turn|hu|large')).toBe('fix-off');
    expect(cls(off, 'overfold|plo5|flop|mw|mid')).toBe('no-owner');
    expect(cls(off, 'overfold|nlh-cash|river|hu|large')).toBe('no-owner');
    expect(off.fixOn).toEqual([]);
    expect(off.cells.find((c) => c.key === 'overfold|plo5|turn|hu|large')!.ownerState).toBe(
      'OFF (no switch row: release default)'
    );
    expect(off.cells.find((c) => c.key === 'overfold|plo5|flop|hu|large')!.ownerState).toBe(
      'OFF (not registered yet: PR #12184)'
    );
    expect(off.line).toMatch(
      /^Over-fold: \d+ cell\(s\) over their ceiling: 0 WITH ITS FIX ON \(regression, breach-class\), 0 with the fix ON for part of the window, \d+ while the fix is OFF, \d+ with no owner yet/
    );
    expect(
      cls(
        run({ omahaFacingBetPriorIsPeopleMeasured: { state: 'shadow', since: null } }),
        'overfold|plo5|turn|hu|large'
      )
    ).toBe('fix-off');

    const on = run({
      omahaFacingBetPriorIsPeopleMeasured: { state: 'on', since: '2026-11-20T00:00:00Z' },
      omahaMultiwayFieldIsPeopleMeasured: { state: 'on_shadow', since: '2026-11-20T00:00:00Z' },
    });
    expect(cls(on, 'overfold|plo5|turn|hu|large')).toBe('fix-on');
    expect(cls(on, 'overfold|plo5|turn|mw|mid')).toBe('fix-on');
    expect(cls(on, 'overfold|plo5|flop|hu|large')).toBe('fix-off');
    expect(on.fixOn).toEqual(
      expect.arrayContaining(['overfold|plo5|turn|hu|large', 'overfold|plo5|turn|mw|mid'])
    );
    // the regression is listed first, and the line says so
    const firstOff = on.gating.findIndex((k) => !on.fixOn.includes(k));
    expect(on.gating.slice(0, firstOff).sort()).toEqual([...on.fixOn].sort());
    expect(on.lines[0]).toContain(
      'WITH ITS FIX ON (omahaFacingBetPriorIsPeopleMeasured ON since 2026-11-20T00:00:00Z): REGRESSION, breach-class'
    );
    expect(on.line).toMatch(/: [1-9]\d* WITH ITS FIX ON \(regression, breach-class\)/);

    // switched on inside the range: the window holds decisions from before the fix
    const part = run({
      omahaFacingBetPriorIsPeopleMeasured: { state: 'on', since: '2026-11-26T12:00:00Z' },
    });
    expect(cls(part, 'overfold|plo5|turn|hu|large')).toBe('fix-on-partial');
    expect(part.fixOn).toEqual([]);
    expect(fixClassOf({ state: 'canary' }, since)).toBe('fix-on-partial');
    expect(cls(run(null), 'overfold|plo5|turn|hu|large')).toBe('fix-unknown');
    expect(ownerState(OWNER_MAP, null, {})).toBeNull();
  });

  it('a cell that gates only on the pooled window is a regression only when the fix was ON before the pooled window began', () => {
    const cur = cell('plo5', 'river', 'hu', 'mid', 30, 14);
    const prev = cell('plo5', 'river', 'hu', 'mid', 170, 110);
    const g = (sinceIso: string) =>
      gateCells({
        current: cur,
        previous: prev,
        ownerMap: OWNER_MAP,
        switches: { omahaFacingBetPriorIsPeopleMeasured: { state: 'on', since: sinceIso } },
        sinceMs: since,
        previousSinceMs: previousSince,
      }).cells.find((c) => c.key === 'overfold|plo5|river|hu|mid')!;
    expect(g('2026-11-20T00:00:00Z').gatingWindow).toBe('pooled');
    expect(g('2026-11-20T00:00:00Z').fixClass).toBe('fix-on');
    // on since the day before the range: inside the pooled window
    expect(g('2026-11-25T00:00:00Z').fixClass).toBe('fix-on-partial');
  });
});

/** A hand row as the gate's SQL selects it: seats, Horse flags, profile found, actions; no hole cards. */
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
  gv?: string;
  mtt?: boolean;
  street?: string;
  unknownPerson?: boolean;
  respOrigin?: string;
}) {
  const bettor = opts.bettor ?? P;
  const responder = opts.responder ?? H;
  const street = opts.street ?? 'river';
  const pl: unknown[] = [
    [1, P, 500, null, false, opts.unknownPerson ? false : true],
    [2, H, 500, null, true, true],
  ];
  if (opts.third) pl.push([3, V, 500, null, true, true]);
  const ac: unknown[] = [];
  if (opts.raiseFirst) ac.push([1, street, 'bet', 20, 'player', false, 100, 0, responder]);
  ac.push([
    bettor === P ? 1 : 2,
    street,
    opts.raiseFirst ? 'raise' : 'bet',
    75,
    opts.origin ?? (bettor === H ? 'horse_policy' : 'player'),
    false,
    100,
    0,
    bettor,
  ]);
  ac.push([
    responder === H ? 2 : 1,
    street,
    opts.act ?? 'fold',
    0,
    opts.respOrigin ?? (responder === H ? 'horse_policy' : 'player'),
    false,
    175,
    75,
    responder,
  ]);
  return {
    id: opts.id ?? '44444444-4444-4444-8444-444444444444',
    created_at: opts.created ?? '2026-11-26 01:00:00+00',
    gv: opts.gv ?? 'plo5',
    bb: 2,
    btn: 2,
    pot: 100,
    bomb: false,
    cc2: null,
    mtt: opts.mtt ?? false,
    pl,
    ac,
  };
}
const spots = (r: ReturnType<typeof row>) => {
  const h = parseHand(r) as ReturnType<typeof parseHand> & { mtt?: boolean };
  h.mtt = r.mtt === true;
  const known = new Set(
    (r.pl as unknown[][]).filter((p) => p[5] !== false).map((p) => p[1] as string)
  );
  return overfoldSpots(h, { known });
};

describe("the spots: a player facing the street's first bet", () => {
  it("counts the Horse facing a person's first bet on the flop, turn and river, heads-up and multiway, with size and fold", () => {
    for (const street of ['flop', 'turn', 'river']) {
      const s = spots(row({ street }));
      expect(s).toHaveLength(1);
      expect(s[0]).toMatchObject({
        street,
        field: 'hu',
        opponents: 1,
        bucket: 'large',
        fold: true,
        who: 'horse',
        gv: 'plo5',
        mtt: false,
      });
      expect(s[0]!.s).toBeCloseTo(0.75, 12);
    }
    expect(spots(row({ act: 'call' }))[0]!.fold).toBe(false);
    expect(spots(row({ third: true }))[0]).toMatchObject({ field: 'mw', opponents: 2 });
    expect(spots(row({ gv: 'nlh' }))[0]).toMatchObject({ gv: 'nlh', mtt: false });
    expect(spots(row({ gv: 'nlh', mtt: true }))[0]).toMatchObject({ gv: 'nlh', mtt: true });
  });
  it('leaves out a Horse bettor for the Horse, a person on Horse policy, a raise, a PLO tournament, preflop, and a seat with no profile', () => {
    expect(spots(row({ origin: 'horse_policy' }))).toEqual([]);
    expect(spots(row({ raiseFirst: true }))).toEqual([]);
    expect(spots(row({ gv: 'plo5', mtt: true }))).toEqual([]);
    expect(spots(row({ gv: 'plo6' }))).toEqual([]);
    expect(spots(row({ street: 'preflop' }))).toEqual([]);
    expect(spots(row({ unknownPerson: true }))).toEqual([]);
  });
  it("people's own folds: a person (not on Horse policy, profile found) facing a first bet is a 'person' spot, never a gated one", () => {
    const s = spots(row({ bettor: H, responder: P }));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ who: 'person', fold: true, field: 'hu' });
    expect(spots(row({ bettor: H, responder: P, respOrigin: 'horse_policy' }))).toEqual([]);
    expect(spots(row({ bettor: H, responder: P, unknownPerson: true }))).toEqual([]);
    // a person spot given as "current" is never counted as a Horse decision
    const g = gateCells({ current: cell('plo5', 'river', 'hu', 'large', 60, 60, 'person') });
    expect(g.exitCode).toBe(2);
  });
});

describe("the tool (read-only, no hole cards, people from profiles and never a HUD '*' row)", () => {
  const sql = overfoldSql({
    from: Date.parse('2026-11-25T00:00:00Z'),
    to: Date.parse('2026-11-26T00:00:00Z'),
  });
  const sw = switchSql(OWNER_MAP.owners.map((o: { option: string }) => o.option))!;
  it("selects no hole-card, showdown or winner column, only reads, and reads Hold'em cash and tournaments but PLO cash only", () => {
    for (const q of [sql, sw]) {
      expect(q).toMatch(/^select /);
      expect(q).not.toMatch(/hole_cards|showdown|winners/);
      expect(q).not.toMatch(
        /\b(insert|update|delete|drop|alter|truncate|grant|create|merge|copy|call|do)\b/i
      );
      expect(q).not.toContain(';');
    }
    expect(sql).toContain("h.game_variant in ('plo4','plo5','nlh')");
    expect(sql).toContain("(h.game_variant = 'nlh' or h.tournament_id is null)");
    expect(sw).toContain('from public.ca_horse_style_switch s');
    expect(switchSql(["x'; drop table y; --"])).toBeNull();
  });
  it("measures people from profiles.is_horse = false; no HUD table and no '*' row anywhere in the gate", () => {
    expect(sql).toContain('pr2.is_horse = false');
    const src = ['horse-plo-overfold-gate.mjs', 'horse-plo-overfold-gate-lib.mjs']
      .map((f) => readFileSync(join(__dirname, '..', '..', 'scripts', 'ops', f), 'utf8'))
      .join('\n');
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/'\*'|"\*"/);
    expect(code).not.toMatch(/hud|ca_hand_player_stat|player_stats/i);
    // every database read goes through the read-only runner (SELECT behind SET TRANSACTION READ ONLY)
    expect(code).toContain("import { queryReadOnly } from './horse-hand-audit-omaha.mjs'");
    expect(code).not.toMatch(/spawn|execFile|execSync|fetch\(|createClient/);
    expect(code.match(/\bq\(|query\(/g)!.length).toBeGreaterThan(0);
  });
  it("reads from the earlier of the previous 3 days and people's trailing 14 days", () => {
    const u = Date.parse('2026-11-26T05:00:00Z');
    expect(readFrom(u - 86400_000, u)).toBe(u - 14 * 86400_000);
    expect(readFrom(u - 13 * 86400_000, u)).toBe(u - 16 * 86400_000);
    expect(
      switchesOf([{ option: 'a', state: 'ON', since: '2026-11-20 00:00:00+00' }, { nope: 1 }])
    ).toEqual({ a: { state: 'on', since: '2026-11-20T00:00:00Z' } });
  });
  it("splits the range, the previous 3 days and people's 14 days, reads the switch, and exits on the gate", () => {
    const mk = (n: number, created: string, tag: string, o: Parameters<typeof row>[0] = {}) =>
      Array.from({ length: n }, (_, i) =>
        row({ ...o, id: `${tag}-4444-4444-8444-${String(i).padStart(12, '0')}`, created })
      );
    const rows = [
      ...mk(30, '2026-11-26 01:00:00+00', '44444444'),
      ...mk(10, '2026-11-24 01:00:00+00', '55555555', { act: 'call' }),
      // people's own folds, 10 days back: outside the previous window, inside the 14 days
      ...mk(40, '2026-11-16 01:00:00+00', '66666666', { bettor: H, responder: P, act: 'call' }),
      // 20 days back: never read
      ...mk(5, '2026-11-06 01:00:00+00', '77777777'),
    ];
    const since = Date.parse('2026-11-25T05:00:00Z');
    const until = Date.parse('2026-11-26T05:00:00Z');
    const split = spotsOf(rows, since, until);
    expect(split.current).toHaveLength(30);
    expect(split.previous).toHaveLength(10);
    expect(split.people).toHaveLength(40);
    const out: string[] = [];
    const sqls: string[] = [];
    const code = runOverfoldGate(
      ['--since', '2026-11-25T05:00:00Z', '--until', '2026-11-26T05:00:00Z', '--json'],
      {
        stdout: (s: string) => out.push(s),
        stderr: () => {},
        prior: null,
        query: (q: string) => {
          sqls.push(q);
          if (q.includes('ca_horse_style_switch'))
            return [
              {
                option: 'omahaFacingBetPriorIsPeopleMeasured',
                state: 'on',
                since: '2026-11-20 00:00:00+00',
              },
            ];
          const [, a, b] = q.match(/created_at >= '([^']+)' and h\.created_at < '([^']+)'/)!;
          return rows.filter((r) => {
            const t = Date.parse(r.created_at.replace(' ', 'T').replace('+00', 'Z'));
            return t >= Date.parse(a!) && t < Date.parse(b!);
          });
        },
      }
    );
    expect(code).toBe(1);
    expect(sqls.length).toBe(15); // 14 daily chunks and the switch read
    expect(sqls.every((q) => q.startsWith('select '))).toBe(true);
    const j = JSON.parse(out[0]!);
    expect(j.previousSince).toBe('2026-11-22T05:00:00Z');
    expect(j.peopleSince).toBe('2026-11-12T05:00:00Z');
    expect(j.cells).toHaveLength(120);
    // the Horse folds 30 of 30 with its fix ON since before the window: a regression, listed in fixOn
    expect([...j.gating].sort()).toEqual(
      [
        'overfold|plo5|river|hu|large',
        'overfold|plo5|river|hu|all',
        'overfold|plo|river|hu|large',
        'overfold|plo|river|hu|all',
      ].sort()
    );
    expect(j.fixOn).toEqual(j.gating);
    expect(out.at(-1)).toMatch(/^Over-fold: 4 cell\(s\) over their ceiling: 4 WITH ITS FIX ON/);
    const c = j.cells.find((x: { key: string }) => x.key === 'overfold|plo5|river|hu|large');
    // people never fold here (0 of 40): the test still has an error to work with
    expect(c.ceilingSource).toBe("people's own folds, trailing 14 days (0.0%, n 40)");
    expect(c.owner).toBe('omahaFacingBetPriorIsPeopleMeasured');
    expect(c.ownerState).toBe('ON');
    expect(runOverfoldGate([], { stdout: () => {}, stderr: () => {} })).toBe(64);
  });
});

describe('in the daily audit', () => {
  const S = Date.parse('2026-11-25T05:00:00Z');
  const U = Date.parse('2026-11-26T05:00:00Z');
  const current = [
    ...cell('plo5', 'river', 'hu', 'large', 60, 50),
    ...cell('nlh-cash', 'flop', 'mw', 'mid', 60, 59),
  ];
  const gate = gateCells({ current, ownerMap: OWNER_MAP, switches: {} });
  const gateOn = gateCells({
    current,
    ownerMap: OWNER_MAP,
    switches: {
      omahaFacingBetPriorIsPeopleMeasured: { state: 'on', since: '2026-11-20T00:00:00Z' },
    },
    sinceMs: S,
    previousSinceMs: S - 3 * 86400_000,
  });
  const res = (g: ReturnType<typeof gateCells>) => ({
    'plo-overfold': { code: 1, json: { cells: g.cells, gate: g, prior: 'no people prior' } },
  });
  const runs = planRuns(S, U, []);
  const all = Object.fromEntries(runs.map((r) => [r.name, { code: 0, json: {} }]));

  it('a gating cell is a regression (exit 1) named by game, street, players and size; the same cell in an overlapping run before is a repeat', () => {
    const m = regressionsMarked(res(gate));
    expect(m.count).toBe(6); // plo5, pooled plo, nlh-cash: each its size row and its all-sizes row
    expect(m.lines.join('\n')).toContain('Over-fold PLO5 cash river heads-up 0.7+ pot');
    expect(m.lines.join('\n')).toContain("Over-fold Hold'em cash flop multiway 0.4-0.7 pot");
    expect(overallExit(runs, { ...all, ...res(gate) })).toBe(1);
    const prev = (g: ReturnType<typeof gateCells>) =>
      previousListing(
        {
          folder: '2026-11-25-1700Z',
          sinceMs: S - 12 * 3600_000,
          untilMs: U - 12 * 3600_000,
          results: { 'plo-overfold': { code: null, json: { cells: g.cells } } },
        },
        S
      );
    const again = regressionsMarked(res(gate), prev(gate));
    expect(again.count).toBe(0);
    expect(again.lines[0]).toContain('repeat (already reported 2026-11-25-1700Z)');
    // the same cell, now with its fix ON, is a new finding (never a repeat of the fix-OFF one) and comes first
    const on = regressionsMarked(res(gateOn), prev(gate));
    expect(on.count).toBe(4);
    for (const i of [0, 1, 2, 3])
      expect(on.lines[i]).toMatch(/^BREACH-CLASS \(over-fold with the fix ON\): Over-fold PLO/);
    expect(on.lines[4]).toContain("Hold'em cash");
    expect(on.lines[4]).toContain('repeat (already reported 2026-11-25-1700Z)');
    // and it comes before another tool's regression
    const mixed = regressionsMarked({
      'holdem-audit': {
        code: 1,
        json: { worse: [{ key: 'cash|river|x', z: 5, zBar: 3, tests: 2 }] },
      },
      ...res(gateOn),
    });
    expect(mixed.lines[0]).toMatch(/^BREACH-CLASS/);
    expect(mixed.lines.at(-1)).not.toMatch(/^BREACH-CLASS/);
  });

  it('the summary lists the fix-ON cells first, then fix OFF, then no owner, then the table of every cell with decisions', () => {
    const summary = formatSummary({
      sinceMs: S,
      untilMs: U,
      plan: { splits: [], leftOut: [] },
      runs,
      results: { ...all, ...res(gateOn) },
      folder: 'f',
    });
    expect(summary).toContain(OVERFOLD_HEADING);
    const iOn = summary.indexOf('**Over its ceiling WITH ITS FIX ON (regression, breach-class)**');
    const iNo = summary.indexOf('**Over its ceiling, no owner yet**');
    expect(iOn).toBeGreaterThan(0);
    expect(iNo).toBeGreaterThan(iOn);
    expect(summary).not.toContain('**Over its ceiling while its fix is OFF**');
    expect(summary).toMatch(
      /\| PLO5 cash \| river \| heads-up \| 0\.7\+ pot \| 60 \| 83\.3% \| 42\.9% \| minimum-defence s\/\(1\+s\) \(no people prior cell; people n 0 < 30\) \| \d+\.\d\d \| - \(0\) \| - \| 60 \| 83\.3% \| \d+\.\d\d \| omahaFacingBetPriorIsPeopleMeasured \(ON\) \| OVER, FIX ON \(regression\) \|/
    );
    expect(summary).toMatch(
      /\| Hold'em cash \| flop \| multiway \| 0\.4-0\.7 pot \| 60 \|.*\| no owner yet \| OVER, no owner \|/
    );
    expect(summary).toContain('114 of 120 cells had no decision in either window (not shown).');
    expect(cellTable(gate.cells, { all: true })).toHaveLength(122);
    const off = formatSummary({
      sinceMs: S,
      untilMs: U,
      plan: { splits: [], leftOut: [] },
      runs,
      results: { ...all, ...res(gate) },
      folder: 'f',
    });
    expect(off).toContain('**Over its ceiling while its fix is OFF**');
    expect(off).not.toContain('WITH ITS FIX ON (regression, breach-class)**');
  });
});
