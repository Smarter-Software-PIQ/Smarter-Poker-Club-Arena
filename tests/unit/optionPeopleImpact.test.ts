import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from '../../scripts/ops/holdem-blanket-scoreboard-lib.mjs';
import {
  ALL_VARIANTS,
  buildEvents,
  buildImpactReport,
  buildImpactSql,
  compareWindows,
  formatImpactMarkdown,
  normalizeBuckets,
  parseOverrideScopes,
  resolveOptionScope,
  scopeFromName,
  scopeFromText,
  scopesOverlap,
  unwrapImpactRow,
  windowStats,
} from '../../scripts/ops/option-people-impact-lib.mjs';
import { parseArgs, reportFromQueryOutput } from '../../scripts/ops/option-people-impact.mjs';

const T0 = Date.parse('2026-11-22T12:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;

/** n hands of people result `bb` each in one bucket at `atMs`. */
function bucket(atMs, v, t, n, bb, hu = false) {
  return { m: Math.floor(atMs / 1000), v, t, hu, n, s: n * bb, ss: n * bb * bb };
}

describe('option people impact', () => {
  describe('scope', () => {
    it('declared options resolve exactly', () => {
      expect(resolveOptionScope('holdemValueAndCallsArePriced')).toMatchObject({
        variants: ['nlh'],
        mode: 'cash',
        hu: false,
        basis: 'declared',
      });
      expect(resolveOptionScope('holdemTournamentAllInCallIsPriced')).toMatchObject({
        variants: ['nlh'],
        mode: 'tournament',
      });
      expect(resolveOptionScope('huBbDefendsUnreadToPrice').hu).toBe(true);
    });

    it('reads recorded scope text, then the name', () => {
      expect(scopeFromText('Fixed limit (flh, flo8) preflop, cash tables only')).toEqual({
        variants: ['flh', 'flo8'],
        mode: 'cash',
        hu: false,
      });
      expect(scopeFromText('All (dead by precedence under V38)')).toBeNull();
      expect(scopeFromName('omahaStabDefenceIsPriced')).toMatchObject({
        variants: ['plo4', 'plo5'],
      });
      expect(scopeFromName('plo6FacingBetIsPricedV2').variants).toEqual(['plo6']);
      expect(scopeFromName('somethingUnknown').variants).toEqual(ALL_VARIANTS);
      expect(scopeFromName('v46ShortDeck').variants).toEqual(['short_deck']);
      expect(scopeFromName('v58Plo6RiverNuts').variants).toEqual(['plo6']);
      expect(scopeFromName('v24PloDefense').variants).toEqual(['plo4', 'plo5']);
      expect(scopeFromName('v79TopPairWeakKicker').variants).toEqual(['nlh']);
      expect(
        resolveOptionScope('fixedLimitX', { fixedLimitX: 'Fixed limit (flh) cash' }).basis
      ).toBe('scope text');
    });

    it('parses OVERRIDES scope sentences from HorseOptionSwitch.ts', () => {
      const src = [
        'const OVERRIDES = {',
        '  holdemTournamentAllInCallIsPriced: [',
        '    HOLDEM,',
        '    "Hold\'em tournaments: preflop all-in calls",',
        "    'desc',",
        '  ],',
        "  v16Hu: ['Heads Up', 'Heads-up postflop', 'overlay'],",
        '};',
      ].join('\n');
      const scopes = parseOverrideScopes(src);
      expect(scopes.holdemTournamentAllInCallIsPriced).toBe(
        "Hold'em tournaments: preflop all-in calls"
      );
      expect(scopes.v16Hu).toBe('Heads-up postflop');
    });

    it('the real HorseOptionSwitch.ts yields scope sentences', () => {
      const src = readFileSync(
        path.resolve(__dirname, '../../server/src/engine/HorseOptionSwitch.ts'),
        'utf8'
      );
      const scopes = parseOverrideScopes(src);
      expect(scopes.holdemValueAndCallsArePriced).toMatch(/NLH cash/);
    });

    it('overlap needs a shared game and compatible mode', () => {
      const cash = resolveOptionScope('holdemValueAndCallsArePriced');
      const tourn = resolveOptionScope('holdemTournamentAllInCallIsPriced');
      const plo = resolveOptionScope('omahaBlanketRowsOffInPlo45Cash');
      expect(scopesOverlap(cash, tourn)).toBe(false);
      expect(scopesOverlap(cash, plo)).toBe(false);
      expect(scopesOverlap(cash, resolveOptionScope('vpipFloorLimpOnly'))).toBe(true);
    });
  });

  describe('events', () => {
    it('drops reconfirmations and turns settings versions into PLO4/PLO5 cash events', () => {
      const events = buildEvents({
        audit: [
          {
            id: 1,
            option: 'holdemValueAndCallsArePriced',
            old_state: null,
            new_state: 'on',
            changed_at: '2026-11-22T12:00:00Z',
          },
          {
            id: 2,
            option: 'holdemValueAndCallsArePriced',
            old_state: 'on',
            new_state: 'on',
            changed_at: '2026-11-22T13:00:00Z',
          },
        ],
        settings: [
          { version: 1, created_at: '2026-11-20T00:00:00Z' },
          { version: 13, rolled_back_from: 2, note: 'reset', created_at: '2026-11-22T14:00:00Z' },
        ],
      });
      expect(events.map((e) => e.key)).toEqual(['audit #1', 'settings v13']);
      expect(events[1].scope).toMatchObject({ variants: ['plo4', 'plo5'], mode: 'cash' });
      expect(events[1].to).toBe('v13 (= v2)');
    });
  });

  describe('statistics', () => {
    const buckets = normalizeBuckets([
      bucket(T0 - 2 * HOUR, 'nlh', false, 300, -1),
      bucket(T0 - 2 * HOUR + MIN, 'nlh', false, 100, 1),
      bucket(T0 + HOUR, 'nlh', false, 400, -3),
      bucket(T0 + HOUR, 'nlh', true, 999, 50),
      bucket(T0 + HOUR, 'plo5', false, 999, 50),
    ]);
    const scope = resolveOptionScope('holdemValueAndCallsArePriced');

    it('sums only in-scope buckets inside the window', () => {
      const before = windowStats(buckets, scope, T0 - 24 * HOUR, T0);
      expect(before.hands).toBe(400);
      expect(before.peopleNetBb).toBe(-200);
      expect(before.peopleBbPer100).toBe(-50);
      expect(before.se100).toBeGreaterThan(0);
      const after = windowStats(buckets, scope, T0, T0 + 24 * HOUR);
      expect(after).toMatchObject({
        hands: 400,
        peopleNetBb: -1200,
        peopleBbPer100: -300,
        se100: 0,
      });
    });

    it('people losing more after the change reads as the horses doing better', () => {
      const before = windowStats(buckets, scope, T0 - 24 * HOUR, T0);
      const after = windowStats(buckets, scope, T0, T0 + 24 * HOUR);
      const c = compareWindows(before, after, { minHands: 200 });
      expect(c.delta100).toBe(-250);
      expect(c.z).toBeLessThan(-2);
      expect(c.verdict).toBe('horses doing better');
      expect(compareWindows(after, before, { minHands: 200 }).verdict).toBe('horses doing worse');
    });

    it('refuses a verdict on too few hands and calls noise noise', () => {
      const small = { hands: 50, peopleNetBb: 10, peopleBbPer100: 20, se100: 30 };
      expect(compareWindows(small, small, { minHands: 200 }).verdict).toBe('too few hands');
      const a = { hands: 500, peopleNetBb: 0, peopleBbPer100: 0, se100: 100 };
      const b = { hands: 500, peopleNetBb: 500, peopleBbPer100: 100, se100: 100 };
      expect(compareWindows(a, b, { minHands: 200 }).verdict).toBe('no clear change');
    });
  });

  describe('report', () => {
    it('counts other overlapping changes as confounders and caps the after window at the read time', () => {
      const events = buildEvents({
        audit: [
          {
            id: 1,
            option: 'holdemValueAndCallsArePriced',
            old_state: null,
            new_state: 'on',
            changed_at: new Date(T0).toISOString(),
          },
          {
            id: 2,
            option: 'vpipFloorLimpOnly',
            old_state: 'on',
            new_state: 'off',
            changed_at: new Date(T0 + HOUR).toISOString(),
          },
          {
            id: 3,
            option: 'holdemTournamentAllInCallIsPriced',
            old_state: 'off',
            new_state: 'on',
            changed_at: new Date(T0 + HOUR).toISOString(),
          },
        ],
      });
      const report = buildImpactReport({
        events,
        buckets: normalizeBuckets([
          bucket(T0 - HOUR, 'nlh', false, 300, -1),
          bucket(T0 + MIN, 'nlh', false, 300, 1),
        ]),
        readAtMs: T0 + 6 * HOUR,
        windowHours: 24,
        minHands: 200,
      });
      const row = report.rows.find((r) => r.key === 'audit #1');
      expect(row.confounders).toBe(1);
      expect(row.afterHours).toBe(6);
      expect(row.verdict).toBe('horses doing worse');
      const md = formatImpactMarkdown(report, { focus: ['holdemValueAndCallsArePriced'] });
      expect(md).toMatch(/## Changes under review/);
      expect(md).toMatch(/\(6h so far\)/);
      expect(md).not.toMatch(/[\u2013\u2014]/);
    });

    it('builds the report from the CLI output shape', () => {
      const raw = [
        {
          report: {
            read_at: new Date(T0 + 2 * HOUR).toISOString(),
            buckets: [bucket(T0 - HOUR, 'nlh', true, 10, 1)],
            audit: [
              {
                id: 9,
                option: 'holdemTournamentAllInCallIsPriced',
                old_state: 'off',
                new_state: 'on',
                changed_at: new Date(T0).toISOString(),
              },
            ],
            settings: [],
          },
        },
      ];
      expect(unwrapImpactRow(raw).buckets).toHaveLength(1);
      const report = reportFromQueryOutput(raw, { windowHours: 24, minHands: 200 });
      expect(report.rows[0]).toMatchObject({ key: 'audit #9', verdict: 'too few hands' });
      expect(report.rows[0].before.hands).toBe(10);
    });
  });

  describe('query', () => {
    it('is one read-only statement and returns aggregates only', () => {
      const sql = buildImpactSql({ lookbackDays: 14, windowHours: 24 });
      expect(() => assertReadOnlySql(sql)).not.toThrow();
      expect(sql).toMatch(/profiles WHERE is_horse = false/);
      expect(sql).toMatch(/humans < dealt/);
      const select = sql.slice(sql.lastIndexOf('SELECT jsonb_build_object'));
      expect(select).not.toMatch(/hand_id|user_id|username|hole_cards|cards/);
    });

    it('rejects out-of-range windows and unknown flags', () => {
      expect(() => buildImpactSql({ lookbackDays: 15 })).toThrow();
      expect(() => buildImpactSql({ windowHours: 0 })).toThrow();
      expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
      expect(
        parseArgs(['--focus', 'a', '--focus', 'settings', '--window-hours', '12'])
      ).toMatchObject({
        focus: ['a', 'settings'],
        windowHours: 12,
      });
    });
  });
});
