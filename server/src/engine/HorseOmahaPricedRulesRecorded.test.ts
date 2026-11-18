/**
 * THE OMAHA PRICED RULES ON REAL DECISIONS (regression, per rule family).
 *
 * HorseOmahaPricedRules.fixture.json holds real Horse decisions recorded from
 * production PLO5 cash hands of 2026-11-16 and 2026-11-17 (the audit in
 * archive plo-handoff-review-01a1cbbd/audit2-01BNteGZ, its DECISIONS file):
 * the public actions before each decision, the public node and the Horse's
 * own hole cards only. Each record carries the action this source takes at
 * seed 1 with the production options alone ('off'), with each priced option
 * added, and with all of them ('all'), on an empty opponent memory.
 *
 * The records were chosen so that every priced receipt and every kind of
 * changed action seen in the replay of all 2,950 recorded postflop decisions
 * is present (three records of each at most). This test pins them: a change
 * to a priced comparison that moves one of these decisions fails here and
 * must be made on purpose.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_PRICED_RAISE_GATE_OPTIONS,
  horseDecisionReceiptRefusal,
} from './horseDecision/responseValidation.js';
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
const FAMILIES = PRICED_OPTIONS.filter((o) => o !== 'omahaPricedMix');
const configOf = (tag: string): HorseDecideOpts =>
  tag === 'off'
    ? LIVE_OPTIONS
    : tag === 'all'
      ? { ...LIVE_OPTIONS, ...allPriced(true), omahaPricedMix: false }
      : ({ ...LIVE_OPTIONS, [tag]: true } as HorseDecideOpts);

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the recorded decisions', () => {
  it('the fixture is real decisions with the Horse own cards only, and covers every family', () => {
    expect(RECORDS.length).toBeGreaterThanOrEqual(40);
    for (const r of RECORDS) {
      expect(r.variant).toBe('plo5');
      expect(r.hole.length).toBe(10);
      expect(Object.keys(r.expect).sort()).toEqual(['all', 'off', ...FAMILIES].sort());
    }
    // On an empty opponent memory six families move recorded decisions. The other three do not:
    // omahaBluffShareFromBetRate needs a measured bet rate, and with the production options on
    // omahaBigBetCallsArePriced and omahaUnderpairMultiwayIsPriced reach the action the cells
    // and the facing-bet EV verdict already reach (their receipts fire; the law test reads them).
    const moves = FAMILIES.filter((f) => RECORDS.some((r) => r.expect[f].a !== r.expect.off.a));
    expect(moves.sort()).toEqual(
      [
        'omahaTurnRiverRaiseIsPriced',
        'omahaDrawRaiseIsPriced',
        'omahaOopTurnBarrelIsPriced',
        'omahaPairedBoardBetIsPriced',
        'omahaFacingBetRangeIsContinuous',
        'omahaPressureIsPriced',
      ].sort()
    );
  });
  for (const tag of ['off', ...FAMILIES, 'all'])
    it(`${tag}: every recorded decision is the recorded action, legal and admitted by the receipt validator`, () => {
      const changed: string[] = [];
      for (const r of RECORDS) {
        const { decision, state } = decideRecorded(r, configOf(tag), 1);
        const where = `hand ${r.n} seat ${r.seat} ${r.street}`;
        expect({ a: decision.action, amt: decision.amount ?? null }, where).toEqual(r.expect[tag]);
        expect(r.legal, where).toContain(decision.action);
        if (decision.policyGraph !== undefined)
          expect(
            horseDecisionReceiptRefusal(structuredClone(decision), r.variant, {
              player: state.hero,
              gameState: state.gs,
              // the decision's own priced-raise gate (the client builds it from the options it ran)
              omahaPricedRaise: OMAHA_PRICED_RAISE_GATE_OPTIONS.some(
                (name) => (configOf(tag) as Record<string, unknown>)[name] === true
              ),
            } as never),
            where
          ).toBeNull();
        if (decision.action !== r.expect.off.a)
          changed.push(`${r.n}:${r.street} ${r.expect.off.a}>${decision.action}`);
      }
      // eslint-disable-next-line no-console
      console.log(
        `[recorded, ${tag}] ${changed.length} of ${RECORDS.length} differ from off: ${changed.join(' ')}`
      );
    }, 300000);
});
