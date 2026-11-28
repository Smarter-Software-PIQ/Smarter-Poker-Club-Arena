/**
 * THE DAILY GRADE'S FLAG RULE (2026-11-28): a flag must mean a real Horse mistake.
 *
 * Until this date a row flagged at mean > 1 SE with n >= 10. About 100 rows a day reach
 * n >= 10, each clears that bar about 16% of the time with no leak at all, so most daily
 * flags were chance. These tests pin the rule that replaced it (declared in
 * HorseDailyDecisionGrade.ts): a false-discovery-controlled bar across the rows tested
 * that day, or the same row beyond about 2 SE two reports running; "one person" on the
 * same bar; "watch" for everything beyond the earlier bar that does not flag.
 * Every test here fails on the code before the rule.
 */
import { describe, expect, it } from 'vitest';
import {
  FLAG_FDR_Q,
  FLAG_MIN_EFFECT_BB,
  FLAG_MIN_N,
  FLAG_REPEAT_LOOKBACK_REPORTS,
  FLAG_REPEAT_MAX_GAP_HOURS,
  FLAG_REPEAT_P,
  ONE_PERSON_SHARE,
  SKEW_CORRECTION_MAX,
  WATCH_SE,
  applyFlagRule,
  buildReport,
  classTable,
  decideFlags,
  fdrCutoff,
  flagRuleText,
  oneSidedP,
  renderMarkdown,
  rangeSection,
  renderRangeSection,
  repeatBasis,
  rollupKey,
  seededRng,
  type ClassRow,
  type GradedDecision,
  type RangeSection,
  type Report,
  type Section,
} from './HorseDailyDecisionGrade.js';
import { insuranceEquity } from '../engine/InsuranceEquity.js';

const d = (
  hand: string,
  lossBb: number,
  person: string,
  over: Partial<GradedDecision> = {}
): GradedDecision => ({
  hand,
  game: 'nlh',
  pool: 'table',
  street: 'turn',
  situation: 'facing 67-100% pot',
  action: 'call',
  cls: 'pair',
  headsUp: true,
  persons: [person],
  lossBb,
  basis: 'realised',
  ungraded: null,
  ...over,
});

/** The earlier rule, written out: mean beyond 1 SE at n >= 10. */
const earlierBar = (r: ClassRow): boolean => r.n >= 10 && r.se !== null && r.mean - r.se > 0;

/** n decisions of one class, one hand each, losses from `draw`, people spread evenly. */
const cls = (name: string, n: number, draw: (i: number) => number, tag = ''): GradedDecision[] =>
  Array.from({ length: n }, (_, i) =>
    d(`${tag}${name}-${i}`, draw(i), `person${i % 7}`, { cls: name })
  );

/** A fixed, exactly reproducible sample: mean `mean`, per-hand spread `sd` (n even). */
const fixed =
  (mean: number, sd: number) =>
  (i: number): number =>
    mean + (i % 2 ? sd : -sd);

const section = (name: Section['name'], ds: GradedDecision[]): Section => ({
  name,
  decisions: ds.length,
  graded: ds.length,
  ungraded: {},
  byBasis: {},
  headsUpFoldsUngraded: 0,
  gradedOnChipsInCards: 0,
  classes: classTable(ds),
  topPerson: null,
  classesExcludingTopPerson: [],
  rollup: classTable(ds, rollupKey),
  rollupExcludingTopPerson: [],
});

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-26T11:00:00Z');
const reportOf = (sections: Section[], startMs: number, range?: RangeSection): Report =>
  ({
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + DAY).toISOString(),
    sections,
    ...(range ? { range } : {}),
  }) as unknown as Report;

describe('the rule is declared in one place and printed', () => {
  it('declares the bar as named constants', () => {
    expect({
      FLAG_FDR_Q,
      FLAG_MIN_N,
      FLAG_MIN_EFFECT_BB,
      FLAG_REPEAT_P,
      FLAG_REPEAT_MAX_GAP_HOURS,
      FLAG_REPEAT_LOOKBACK_REPORTS,
      ONE_PERSON_SHARE,
      SKEW_CORRECTION_MAX,
      WATCH_SE,
    }).toEqual({
      FLAG_FDR_Q: 0.05,
      FLAG_MIN_N: 10,
      FLAG_MIN_EFFECT_BB: 0.5,
      FLAG_REPEAT_P: 0.025,
      FLAG_REPEAT_MAX_GAP_HOURS: 48,
      FLAG_REPEAT_LOOKBACK_REPORTS: 2,
      ONE_PERSON_SHARE: 0.8,
      SKEW_CORRECTION_MAX: 0.5,
      WATCH_SE: 1,
    });
  });

  it('prints the rule, its constants and what was tested in the report header', () => {
    const report = buildReport({
      command: 'test',
      startMs: T0,
      endMs: T0 + DAY,
      hands: [],
      equity: insuranceEquity,
    });
    const md = renderMarkdown(report, null, null);
    expect(md).toContain('**What a flag means.**');
    expect(md).toContain(flagRuleText());
    expect(flagRuleText()).toContain('false-discovery rate of 5%');
    expect(flagRuleText()).toContain('at least 0.5 bb per decision');
    expect(flagRuleText()).toContain('p <= 0.025');
    expect(flagRuleText()).toContain('no more than 48 h');
    expect(flagRuleText()).toContain('in one of the 2 reports before it');
    expect(flagRuleText()).toContain('n >= 10');
    expect(md).toContain('- spot classes: 0 tested, the false-discovery bar rejects none');
    expect(md).toContain('no earlier report was read, so no row can flag as a repeat day');
    expect(md).toContain('What the flag rule can miss: a small real leak.');
    expect(report.flagRule).toMatchObject({ fdrQ: 0.05, minEffectBb: 0.5, repeatP: 0.025 });
  });
});

describe('the p-value and the false-discovery bar', () => {
  it("is Student's t on mean / SE with hands - 1 degrees of freedom", () => {
    // t quantiles at one-sided 0.025: 2.093 (19 df), 2.228 (10 df), 4.303 (2 df)
    expect(oneSidedP({ n: 20, clusters: 20, mean: 2.093, se: 1 })).toBeCloseTo(0.025, 4);
    expect(oneSidedP({ n: 11, clusters: 11, mean: 2.228, se: 1 })).toBeCloseTo(0.025, 4);
    expect(oneSidedP({ n: 10, clusters: 3, mean: 4.303, se: 1 })).toBeCloseTo(0.025, 4);
    expect(oneSidedP({ n: 20, clusters: 20, mean: -2.093, se: 1 })).toBeCloseTo(0.975, 4);
    // not tested: under 10 decisions, or no standard error
    expect(oneSidedP({ n: 9, clusters: 9, mean: 9, se: 1 })).toBeNull();
    expect(oneSidedP({ n: 12, clusters: 1, mean: 9, se: null })).toBeNull();
  });

  it('corrects for skew only toward less significant', () => {
    const row = { n: 30, clusters: 30, mean: 2.5, se: 1 };
    const plain = oneSidedP(row)!;
    // many small losses and a few big wins (a call): less significant than the plain t
    expect(oneSidedP({ ...row, skew: -2 })!).toBeGreaterThan(plain * 2);
    // the opposite shape is never made more significant
    expect(oneSidedP({ ...row, skew: 2 })).toBe(plain);
    // whatever the skew, the row is never more significant than its plain t, and the
    // correction never takes more than half of the t (SKEW_CORRECTION_MAX)
    const half = oneSidedP({ ...row, mean: row.mean * (1 - SKEW_CORRECTION_MAX) })!;
    for (const skew of [-0.5, -1, -2, -5, -20, -50]) {
      const p = oneSidedP({ ...row, skew })!;
      expect(p).toBeGreaterThanOrEqual(plain);
      expect(p).toBeLessThanOrEqual(half);
    }
    expect(oneSidedP({ ...row, skew: -5 })).toBe(half);
  });

  it('does not test a row with no spread: every hand lost the same amount', () => {
    // twelve calls that each lost exactly 3 bb: a t-test would call any such sample certain
    const [row] = classTable(cls('SAME', 12, () => 3));
    expect(row).toMatchObject({ n: 12, mean: 3, se: 0, p: null, flagged: false, watch: true });
  });

  it('applies Benjamini-Hochberg across the tests of the day', () => {
    // the textbook case: ten p-values at 5%; ranks 1 and 2 pass (0.005, 0.010), rank 3 does not
    const ps = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
    expect(fdrCutoff(ps, 0.05)).toBeCloseTo(0.01, 12);
    expect(fdrCutoff([0.02, 0.3, 0.5, 0.9], 0.05)).toBe(-1);
    // a later rank can carry earlier ones: 0.03 fails rank 1 alone (0.025) but passes at rank 2
    expect(fdrCutoff([0.03, 0.04], 0.05)).toBeCloseTo(0.05, 12);
    expect(fdrCutoff([], 0.05)).toBe(-1);
  });
});

describe('a day with no leak anywhere', () => {
  // 257 spot classes a day (the Nov 27 report had 257): 30 reach n >= 10, 227 do not.
  const shapes: Record<string, (rng: () => number) => number> = {
    'bell-shaped': (rng) => 5 * Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()),
    'heavy-tailed': (rng) =>
      (rng() < 0.1 ? 40 : 2) * Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()),
    // a call: lose about 3 bb two hands in three, win about 6 bb one hand in three (true mean 0)
    'call-shaped': (rng) => (rng() < 2 / 3 ? 3 : -6) * (0.5 + rng()),
  };
  const DAYS = 300;
  const day = (rng: () => number, draw: (rng: () => number) => number, tag: string) => {
    const ds: GradedDecision[] = [];
    for (let c = 0; c < 257; c++) {
      const n = c < 30 ? 10 + Math.floor(rng() * 51) : 1 + Math.floor(rng() * 9);
      ds.push(...cls(`class${c}`, n, () => draw(rng), tag));
    }
    return classTable(ds);
  };

  for (const [shape, draw] of Object.entries(shapes))
    it(`flags under 0.1 rows a day by chance (${shape} results), where the earlier rule flagged over 3`, () => {
      const rng = seededRng(`null ${shape}`);
      let alone = 0;
      let withRepeat = 0;
      let earlier = 0;
      let hidden = 0;
      const reports: ClassRow[][] = [];
      for (let i = 0; i < DAYS; i++) {
        const rows = day(rng, draw, `d${i}-`);
        earlier += rows.filter(earlierBar).length;
        // the table decided on its own: the false-discovery bar only
        alone += rows.filter((r) => r.flagged).length;
        // and as the daily run decides it: against the two reports before it too
        const family = applyFlagRule('spot classes', [{ rows, previous: reports.slice(0, 2) }]);
        expect(family.tested).toBe(30);
        withRepeat += family.flagged;
        // nothing beyond the earlier bar disappears: it is flagged, one person or watch
        hidden += rows.filter(
          (r) => earlierBar(r) && !(r.flagged || r.onePerson || r.watch)
        ).length;
        reports.unshift(rows);
      }
      expect(earlier / DAYS).toBeGreaterThan(3);
      expect(alone / DAYS).toBeLessThan(0.1);
      expect(withRepeat / DAYS).toBeLessThan(0.1);
      expect(hidden).toBe(0);
    });
});

describe('a real leak', () => {
  const nullDay = (seed: string, tag: string): GradedDecision[] => {
    const rng = seededRng(seed);
    const ds: GradedDecision[] = [];
    for (let c = 0; c < 257; c++) {
      const n = c < 30 ? 10 + Math.floor(rng() * 51) : 1 + Math.floor(rng() * 9);
      ds.push(...cls(`class${c}`, n, () => 10 * (rng() - 0.5), tag));
    }
    return ds;
  };

  it('a large planted leak is flagged on its first day among 257 classes with none', () => {
    // 40 calls losing 4 bb each on average (spread 5 bb): t = 5.1
    const rows = classTable([...nullDay('planted', 'a-'), ...cls('LEAK', 40, fixed(4, 5))]);
    const leak = rows.find((r) => r.key.endsWith('LEAK'))!;
    expect(leak).toMatchObject({ n: 40, flagged: true, flaggedBy: 'fdr', watch: false });
    expect(leak.p).toBeLessThan(0.0001);
    expect(rows.filter((r) => r.flagged).map((r) => r.key)).toEqual([leak.key]);
  });

  it('a certain but tiny loss is watch, not a flag (minimum effect)', () => {
    const tiny = classTable(cls('TINY', 40, fixed(0.3, 0.2)))[0];
    expect(tiny.p).toBeLessThan(0.0001);
    expect(tiny).toMatchObject({ flagged: false, watch: true });
    const enough = classTable(cls('ENOUGH', 40, fixed(0.6, 0.2)))[0];
    expect(enough).toMatchObject({ flagged: true, flaggedBy: 'fdr' });
  });

  it('a 2 SE loss is watch on its first day and a flag when the next report repeats it', () => {
    // 30 calls, mean 2.4 bb, spread 5.6 bb: t = 2.3, p = 0.014. Alone among 31 tested rows
    // the false-discovery bar needs p <= 0.0016, so one day cannot call it.
    const leak = (tag: string) => cls('SMALL', 30, fixed(2.4, 5.6), tag);
    const today = section('cash', [...nullDay('a', 't-'), ...leak('t-')]);
    const yesterday = section('cash', [...nullDay('repeat yesterday', 'y-'), ...leak('y-')]);
    const find = (s: Section) => s.classes.find((r) => r.key.endsWith('SMALL'))!;

    expect(find(today).p).toBeGreaterThan(0.005);
    expect(find(today).p).toBeLessThan(FLAG_REPEAT_P);
    const first = decideFlags([today], null, null, T0);
    expect(find(today)).toMatchObject({ flagged: false, watch: true });
    expect(first.families[0]).toMatchObject({ name: 'spot classes', tested: 31, flagged: 0 });

    const second = decideFlags([today], null, reportOf([yesterday], T0 - DAY), T0);
    expect(find(today)).toMatchObject({ flagged: true, flaggedBy: 'repeat', watch: false });
    expect(second.families[0]).toMatchObject({ flagged: 1, repeat: 1 });
    expect(second.repeatAgainst).toContain('the report for Nov 25, 2026, 5:00 AM Chicago to');
    // the roll-up row of the same decisions is not carried by it: the leak is one class of many
    expect(today.rollup.filter((r) => r.flagged)).toEqual([]);

    // a report written before the rule (no p, no skew, the earlier flag) still confirms a repeat
    const old = structuredClone(yesterday);
    for (const r of old.classes) {
      delete r.p;
      delete r.skew;
      delete r.watch;
      delete r.flaggedBy;
      delete r.onePerson;
      r.flagged = earlierBar(r);
    }
    decideFlags([today], null, reportOf([old], T0 - DAY), T0);
    expect(find(today)).toMatchObject({ flagged: true, flaggedBy: 'repeat' });

    // not a repeat: the row was under the bar yesterday
    const quiet = section('cash', [
      ...nullDay('repeat yesterday', 'y-'),
      ...cls('SMALL', 30, fixed(0.6, 5.6), 'y-'),
    ]);
    decideFlags([today], null, reportOf([quiet], T0 - DAY), T0);
    expect(find(today)).toMatchObject({ flagged: false, watch: true });
  });

  it('confirms a repeat only against a different, recent window', () => {
    const leak = (tag: string) => cls('SMALL', 30, fixed(2.4, 5.6), tag);
    const today = section('cash', [...nullDay('gap today', 't-'), ...leak('t-')]);
    const before = section('cash', [...nullDay('gap before', 'y-'), ...leak('y-')]);
    const find = () => today.classes.find((r) => r.key.endsWith('SMALL'))!;
    // an overlapping window shares hands: it is the same evidence, not a second day
    const overlap = decideFlags([today], null, reportOf([before], T0 - DAY / 2), T0);
    expect(find().flagged).toBe(false);
    expect(overlap.repeatAgainst).toContain('overlaps this window');
    // ended 49 hours before this window starts: too old
    const stale = decideFlags([today], null, reportOf([before], T0 - DAY - 49 * 3_600_000), T0);
    expect(find().flagged).toBe(false);
    expect(stale.repeatAgainst).toContain('more than 48 h before');
    // ended 47 hours before: still the previous report day
    decideFlags([today], null, reportOf([before], T0 - DAY - 47 * 3_600_000), T0);
    expect(find().flagged).toBe(true);
    expect(repeatBasis(null, T0)).toMatchObject({ report: null });
  });

  it('a quiet day between two losing days does not break the repeat (two reports are read)', () => {
    // Nov 24 to 26: a range-grade fold row lost on the 24th and the 26th; on the 25th it was
    // one person's folds. With one report read it never flagged.
    const leak = (tag: string) => cls('SMALL', 30, fixed(2.4, 5.6), tag);
    const quietRow = (tag: string) => cls('SMALL', 30, fixed(0.6, 5.6), tag);
    const today = section('cash', [...nullDay('a', 't-'), ...leak('t-')]);
    const yesterday = section('cash', [...nullDay('b', 'y-'), ...quietRow('y-')]);
    const dayBefore = section('cash', [...nullDay('c', 'x-'), ...leak('x-')]);
    const older = section('cash', [...nullDay('c', 'w-'), ...quietRow('w-')]);
    const find = () => today.classes.find((r) => r.key.endsWith('SMALL'))!;
    const y = reportOf([yesterday], T0 - DAY);
    const x = reportOf([dayBefore], T0 - 2 * DAY);
    decideFlags([today], null, [y], T0);
    expect(find()).toMatchObject({ flagged: false, watch: true });
    const note = decideFlags([today], null, [y, x], T0);
    expect(find()).toMatchObject({ flagged: true, flaggedBy: 'repeat' });
    expect(note.repeatAgainst.match(/the report for /g)).toHaveLength(2);
    // only the two newest are read: a third, older report confirms nothing
    decideFlags([today], null, [y, reportOf([older], T0 - 2 * DAY), x], T0);
    expect(find()).toMatchObject({ flagged: false, watch: true });
  });
});

describe('one person, on the same bar', () => {
  const vera = (n: number, tag = '') =>
    Array.from({ length: n }, (_, i) => d(`${tag}v${i}`, fixed(6, 4)(i), 'vera'));
  const others = (n: number, draw: (i: number) => number, tag = '') =>
    Array.from({ length: n }, (_, i) => d(`${tag}o${i}`, draw(i), `other${i}`));

  it('a class against one person does not flag on a re-test that only clears the earlier bar', () => {
    // 90 calls against vera losing 6 bb + 10 against others: mean 3.0, spread 5.3 (t = 1.8).
    // The earlier rule's re-test (1 SE without vera) passes, so before 2026-11-28 this flagged.
    const [row] = classTable([...vera(90), ...others(10, fixed(3, 5.3))]);
    expect(row.topPersonShare).toBe(0.9);
    expect(row.p).toBeLessThan(0.0001);
    expect(earlierBar({ ...row, ...row.withoutTopPerson! } as ClassRow)).toBe(true);
    expect(row).toMatchObject({ flagged: false, onePerson: true, watch: false });
    expect(row.withoutTopPerson).toMatchObject({ n: 10, clusters: 10 });
  });

  it('flags when the class clears the same bar without that person, and leaves a lone person out', () => {
    const [still] = classTable([...vera(90), ...others(20, fixed(6, 4))]);
    expect(still.topPersonShare).toBeGreaterThan(ONE_PERSON_SHARE);
    expect(still).toMatchObject({ flagged: true, flaggedBy: 'fdr', onePerson: false });
    const [lone] = classTable(vera(40));
    expect(lone).toMatchObject({ flagged: false, onePerson: true, topPersonShare: 1 });
  });

  it('a repeat day needs both days to hold without the person', () => {
    // each day: 60 against vera + 12 others at mean 4, spread 5 (t = 2.65 without vera, p = 0.011):
    // short of the day's false-discovery bar among 31 tested rows, inside the repeat bar
    const rng = seededRng('one person repeat');
    const filler = (tag: string) => {
      const ds: GradedDecision[] = [];
      for (let c = 0; c < 30; c++) ds.push(...cls(`class${c}`, 20, () => 10 * (rng() - 0.5), tag));
      return ds;
    };
    const mine = (tag: string, o: (i: number) => number) =>
      [...vera(60, tag), ...others(12, o, tag)].map((x) => ({ ...x, cls: 'VERA' }));
    const find = (s: Section) => s.classes.find((r) => r.key.endsWith('VERA'))!;
    const today = section('cash', [...filler('t-'), ...mine('t-', fixed(4, 5))]);
    const held = section('cash', [...filler('y-'), ...mine('y-', fixed(4, 5))]);
    const notHeld = section('cash', [...filler('z-'), ...mine('z-', fixed(0.2, 5))]);

    decideFlags([today], null, null, T0);
    expect(find(today).topPersonShare).toBeGreaterThan(ONE_PERSON_SHARE);
    expect(find(today)).toMatchObject({ flagged: false, onePerson: true });

    decideFlags([today], null, reportOf([held], T0 - DAY), T0);
    expect(find(today)).toMatchObject({ flagged: true, flaggedBy: 'repeat', onePerson: false });

    // yesterday the class was vera alone: no confirmation
    decideFlags([today], null, reportOf([notHeld], T0 - DAY), T0);
    expect(find(today)).toMatchObject({ flagged: false, onePerson: true });

    // a report written before the rule did not keep the person-excluded numbers: it cannot
    // show the class held without that person, so it confirms nothing for a one-person class
    const old = structuredClone(held);
    for (const r of old.classes) delete r.withoutTopPerson;
    decideFlags([today], null, reportOf([old], T0 - DAY), T0);
    expect(find(today)).toMatchObject({ flagged: false, onePerson: true });
  });
});

describe('watch: nothing beyond the earlier bar disappears', () => {
  it('lists every flagged, one-person and watch row, whatever its rank by total loss', () => {
    const report = buildReport({
      command: 'test',
      startMs: T0,
      endMs: T0 + DAY,
      hands: [],
      equity: insuranceEquity,
    });
    // 20 classes with a bigger total loss than the watch row, so it is outside the top 15
    const big: GradedDecision[] = [];
    for (let c = 0; c < 20; c++) big.push(...cls(`big${c}`, 4, () => 200));
    const watch = cls('WATCHED', 12, (i) => (i % 2 ? 9 : -3));
    report.sections[0] = section('cash', [...big, ...watch, ...cls('LEAK', 40, fixed(4, 5))]);
    report.flagRule = decideFlags(report.sections, null, null, T0);
    const row = report.sections[0].classes.find((r) => r.key.endsWith('WATCHED'))!;
    expect(earlierBar(row)).toBe(true);
    expect(row).toMatchObject({ flagged: false, watch: true });
    const md = renderMarkdown(report, null, null);
    expect(md).toContain('### Every flagged, one-person and watch row');
    expect(md).toMatch(
      /\| spot class \| nlh table \| turn \| facing 67-100% pot \| call \| WATCHED \| 12 \| 12 \| \+3\.00 \| 1\.81 \| 0\.0\d+ \| 17% \| watch \|/
    );
    expect(md).toMatch(/\| spot class \| nlh table .* LEAK \| 40 \| 40 \| \+4\.00 .* \| YES \|/);
    expect(md).toContain('watch (beyond the earlier 1 SE bar, not flagged): 1.');
    // the top-15 table no longer says "no" for it either way: the row is absent there
    expect(md).not.toMatch(/\| \d+ \| nlh table .* WATCHED .* \| no \|/);
  });
});

describe('the range grade roll-up follows the same rule', () => {
  const rows = (ds: GradedDecision[]) => classTable(ds, rollupKey);
  const range = (g1: ClassRow[], g2: ClassRow[], g2Verdict: 'PASS' | 'FAIL'): RangeSection => {
    // a well-formed empty section from the real builder, then the rows and verdicts under test
    const s = rangeSection([]);
    s.validation[0].verdict = 'PASS';
    s.validation[1].verdict = g2Verdict;
    s.rollupG1 = g1;
    s.rollupG2 = g2;
    return s;
  };
  // a 2.3 SE row (p = 0.014) and 30 rows of other games with no leak
  const leak = (tag: string, action: GradedDecision['action']) =>
    cls('X', 30, fixed(2.4, 5.6), tag).map((x) => ({ ...x, action }));
  const crowd = (seed: string, tag: string): GradedDecision[] => {
    const rng = seededRng(seed);
    const ds: GradedDecision[] = [];
    for (let c = 0; c < 30; c++)
      ds.push(
        ...cls('X', 20, () => 10 * (rng() - 0.5), `${tag}c${c}-`).map((x) => ({
          ...x,
          game: `g${c}`,
        }))
      );
    return ds;
  };
  const g1 = (seed: string, tag: string) => rows([...leak(tag, 'call'), ...crowd(seed, tag)]);
  const mine = (rs: ClassRow[]) => rs.find((r) => r.key.startsWith('nlh'))!;
  const family = (note: { families: Array<{ name: string }> }) =>
    note.families.find((f) => f.name.startsWith('range grade roll-up rows ('));

  it('a group that did not pass validation is not tested and confirms no repeat', () => {
    const today = range(g1('range today', 't-'), rows(leak('t-', 'fold')), 'PASS');
    const failedToday = range(g1('range today', 't-'), rows(leak('t-', 'fold')), 'FAIL');
    const prev = (g2: 'PASS' | 'FAIL') =>
      reportOf([], T0 - DAY, range(g1('range yesterday', 'y-'), rows(leak('y-', 'fold')), g2));

    // one day alone: 32 rows tested, the 2.3 SE rows are watch
    const alone = decideFlags([], today, null, T0);
    expect(family(alone)).toMatchObject({ tested: 32, flagged: 0 });
    expect(mine(today.rollupG1)).toMatchObject({ flagged: false, watch: true });

    // both groups passed on both days: each row repeats and flags
    const both = decideFlags([], today, prev('PASS'), T0);
    expect(mine(today.rollupG1)).toMatchObject({ flagged: true, flaggedBy: 'repeat' });
    expect(mine(today.rollupG2)).toMatchObject({ flagged: true, flaggedBy: 'repeat' });
    expect(family(both)).toMatchObject({ tested: 32, flagged: 2, repeat: 2 });

    // yesterday's G2 was NOT GRADED: its rows confirm nothing; G2 today is watch, G1 still flags
    decideFlags([], today, prev('FAIL'), T0);
    expect(mine(today.rollupG1)).toMatchObject({ flagged: true, flaggedBy: 'repeat' });
    expect(mine(today.rollupG2)).toMatchObject({ flagged: false, watch: true });

    // today's G2 is NOT GRADED: no flag, no watch, no p-value, and it is not in the family
    const failed = decideFlags([], failedToday, prev('PASS'), T0);
    expect(mine(failedToday.rollupG2)).toMatchObject({ flagged: false, watch: false, p: null });
    expect(family(failed)).toMatchObject({ tested: 31, flagged: 1 });
    expect(renderRangeSection(failedToday).join('\n')).toMatch(
      /\| nlh table \/ turn \/ fold \| 30 \| 30 \| \+2\.40 \| 1\.04 \| not graded \|/
    );
  });

  it('marks a range row FLAGGED only under the rule, and a row beyond the earlier bar as watch', () => {
    // before 2026-11-28 this 2.3 SE row printed "FLAGGED >2 SE" on its first day
    const s = range(g1('range today', 't-'), [], 'PASS');
    decideFlags([], s, null, T0);
    const md = renderRangeSection(s).join('\n');
    expect(md).toMatch(
      /\| nlh table \/ turn \/ call \| 30 \| 30 \| \+2\.40 \| 1\.04 \| watch >2 SE \|/
    );
    expect(md).not.toContain('FLAGGED');
    // repeated the next day it is a flag, marked as a repeat day
    decideFlags([], s, reportOf([], T0 - DAY, range(g1('range yesterday', 'y-'), [], 'PASS')), T0);
    expect(renderRangeSection(s).join('\n')).toMatch(
      /\| nlh table \/ turn \/ call \| 30 \| 30 \| \+2\.40 \| 1\.04 \| FLAGGED \(repeat day\) \|/
    );
  });
});
