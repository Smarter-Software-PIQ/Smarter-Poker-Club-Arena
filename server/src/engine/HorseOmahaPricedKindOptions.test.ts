/**
 * THE PRICED2 OPTIONS ARE OPT-IN (2026-11-18, lead ruling on review R2 B1/B2 of priced2 54d47a6a706).
 *
 * priced2 changed every priced family: the priors by opponent kind, the fall-closed handling of an
 * unpriceable spot (removed by ROWFIX 2026-11-18: an unpriceable spot keeps the decision given), the ownership of omahaTurnRiverRaiseIsPriced and the re-raisers' losses counted once.
 * Those changes now sit behind two default-OFF options, omahaPricedPriorsByOpponentKind and
 * omahaRaiseEvCountsLossesOnce (off-only). The recorded decisions of HorseOmahaPricedRules.fixture.json
 * know every seat's kind (person or Horse, the seat rows), so:
 *  - with both options off every family is the #11212 (main) answer on every record: the fixture holds
 *    main's expectations and HorseOmahaPricedRulesRecorded.test.ts pins them; here the records priced2
 *    moved are pinned explicitly, among them the raise verdict's three consumers (omahaTurnRiverRaiseIsPriced,
 *    omahaPressureIsPriced, omahaBigBetCallsArePriced) and record 59804454 (fixture :578: call 88 with the
 *    turn/river raise priced);
 *  - with both on, each record is priced2's own recorded answer (priced2 54d47a6a706's fixture).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  LIVE_OPTIONS,
  PRICED_OPTIONS,
  allPriced,
  decideRecorded,
  type RecordedDecision,
} from './HorseOmahaPricedRules.test-support.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';

const RECORDS = RECORDED as unknown as RecordedDecision[];
const configOf = (tag: string, priced2: boolean): HorseDecideOpts => ({
  ...(tag === 'all'
    ? { ...LIVE_OPTIONS, ...allPriced(true), omahaPricedMix: false }
    : ({ ...LIVE_OPTIONS, [tag]: true } as HorseDecideOpts)),
  omahaPricedPriorsByOpponentKind: priced2,
  omahaRaiseEvCountsLossesOnce: priced2,
});
type Act = { a: string; amt: number | null };
/** [record index, hand, street, tag, main (#11212) answer, priced2 answer] */
const MOVED: ReadonlyArray<readonly [number, number, string, string, Act, Act]> = [
  [
    9,
    59852691,
    'river',
    'omahaFacingBetRangeIsContinuous',
    { a: 'call', amt: 94 },
    { a: 'fold', amt: null },
  ],
  [9, 59852691, 'river', 'all', { a: 'call', amt: 94 }, { a: 'fold', amt: null }],
  [
    13,
    59804454,
    'river',
    'omahaTurnRiverRaiseIsPriced',
    { a: 'call', amt: 88 },
    { a: 'raise', amt: 440 },
  ],
  [13, 59804454, 'river', 'all', { a: 'call', amt: 88 }, { a: 'raise', amt: 440 }],
  // ROWFIX 2026-11-18: priced2 moved this record only by falling closed (the turn barrel could not be priced,
  // omaha_priced_oop_turn_barrel_unpriced_kept, and the categorical check decided). No family falls closed
  // any more, so with both on it is main's answer; kept here as the pin of that change.
  [
    14,
    59852287,
    'turn',
    'omahaOopTurnBarrelIsPriced',
    { a: 'all_in', amt: null },
    { a: 'all_in', amt: null },
  ],
  [14, 59852287, 'turn', 'all', { a: 'all_in', amt: null }, { a: 'all_in', amt: null }],
  [24, 59821219, 'turn', 'all', { a: 'call', amt: 102 }, { a: 'raise', amt: 204 }],
  [
    25,
    59833314,
    'turn',
    'omahaTurnRiverRaiseIsPriced',
    { a: 'fold', amt: null },
    { a: 'raise', amt: 94 },
  ],
  [25, 59833314, 'turn', 'all', { a: 'fold', amt: null }, { a: 'raise', amt: 141 }],
  [
    26,
    59781626,
    'turn',
    'omahaTurnRiverRaiseIsPriced',
    { a: 'call', amt: 54 },
    { a: 'raise', amt: 189 },
  ],
  [26, 59781626, 'turn', 'all', { a: 'call', amt: 54 }, { a: 'raise', amt: 208 }],
  [
    36,
    59872331,
    'turn',
    'omahaTurnRiverRaiseIsPriced',
    { a: 'call', amt: 36 },
    { a: 'raise', amt: 72 },
  ],
  [36, 59872331, 'turn', 'all', { a: 'call', amt: 36 }, { a: 'raise', amt: 114 }],
  [
    40,
    59798752,
    'turn',
    'omahaTurnRiverRaiseIsPriced',
    { a: 'call', amt: 48 },
    { a: 'raise', amt: 96 },
  ],
];

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the priced2 options (omahaPricedPriorsByOpponentKind, omahaRaiseEvCountsLossesOnce)', () => {
  it('the records priced2 moved know every seat kind and include the raise verdict consumers', () => {
    expect(MOVED.length).toBeGreaterThan(0);
    expect(
      MOVED.some(([, n, , tag]) => n === 59804454 && tag === 'omahaTurnRiverRaiseIsPriced')
    ).toBe(true);
    for (const [i, n] of MOVED) expect(RECORDS[i].n).toBe(n);
    for (const tag of ['omahaPressureIsPriced', 'omahaBigBetCallsArePriced'])
      expect(PRICED_OPTIONS as readonly string[]).toContain(tag);
  });
  it('both off: every moved record is the #11212 answer (byte-identical to main)', () => {
    for (const [i, n, street, tag, main] of MOVED) {
      const { decision } = decideRecorded(RECORDS[i], configOf(tag, false), 1);
      expect({ a: decision.action, amt: decision.amount ?? null }, `${n} ${street} ${tag}`).toEqual(
        main
      );
    }
  }, 300000);
  it('both off: the three raise-verdict consumers are the #11212 answer on every record', () => {
    for (const tag of [
      'omahaTurnRiverRaiseIsPriced',
      'omahaPressureIsPriced',
      'omahaBigBetCallsArePriced',
    ])
      for (const r of RECORDS) {
        const { decision } = decideRecorded(r, configOf(tag, false), 1);
        expect(
          { a: decision.action, amt: decision.amount ?? null },
          `${r.n} ${r.street} ${tag}`
        ).toEqual((r.expect as Record<string, Act>)[tag]);
      }
  }, 300000);
  it('unset and a truthy non-boolean read as off: every moved record is the #11212 answer', () => {
    for (const value of [undefined, 1, 'true'] as const)
      for (const [i, n, street, tag, main] of MOVED) {
        const opts = configOf(tag, false) as Record<string, unknown>;
        if (value === undefined) {
          delete opts.omahaPricedPriorsByOpponentKind;
          delete opts.omahaRaiseEvCountsLossesOnce;
        } else {
          opts.omahaPricedPriorsByOpponentKind = value;
          opts.omahaRaiseEvCountsLossesOnce = value;
        }
        const { decision } = decideRecorded(RECORDS[i], opts as HorseDecideOpts, 1);
        expect(
          { a: decision.action, amt: decision.amount ?? null },
          `${n} ${street} ${tag} ${String(value)}`
        ).toEqual(main);
      }
  }, 300000);
  it('both on: every moved record is priced2 own answer', () => {
    for (const [i, n, street, tag, , priced2] of MOVED) {
      const { decision } = decideRecorded(RECORDS[i], configOf(tag, true), 1);
      expect({ a: decision.action, amt: decision.amount ?? null }, `${n} ${street} ${tag}`).toEqual(
        priced2
      );
    }
  }, 300000);
});
