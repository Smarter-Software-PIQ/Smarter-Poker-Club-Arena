/**
 * LAW (PLO-OWNER lead-6 2026-11-24; plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4, Tests 1): against a bettor
 * with no record, the Horse's whole heads-up range facing a first wager of size s under 0.7 pot folds no more than
 * s / (1 + s) + 5 points in every game, street and size bucket, with the corrected price on
 * (omahaFacingBetRangeIsMeasuredByLine, omahaFacingBetIndifferenceCalls, omahaFacingBetMinimumDefencePrior,
 * omahaFlopRealizationIsPriced, omahaFacingBetFieldIsJoint, omahaMultiwayCallNeedsNutShare). Today's verdicts break
 * it (that is why this was built). A bettor whose measured record shows he almost never bets weak may be folded to
 * more, and only then. The state set is the committed PLO4/PLO5 cash league capture of the root-cause report
 * (heads-up, facing a first flop, turn or river wager under 0.7 pot; a raise the replay made stays a raise).
 * Bets of 0.7 pot or more are outside the law: there the measured weakest calls already lose (report section 2d).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  foldRates,
  loadPricedStates,
  type CellRate,
  type PricedState,
} from './HorseOmahaFacingBetPriced.test-support.js';

const MIN_N = 30;
let states: PricedState[] = [];
let today: Map<string, CellRate>;
let on: Map<string, CellRate>;
let withRecord: Map<string, CellRate>;

describe('an Omaha facing bet is defended at the price (no record: fold <= s / (1 + s) + 0.05)', () => {
  beforeAll(() => {
    states = loadPricedStates();
    today = foldRates(states, 'today');
    on = foldRates(states, 'on');
    withRecord = foldRates(states, 'onWithRecord');
  }, 600_000);

  it('the committed state set covers every street and both size buckets in both games', () => {
    for (const v of ['plo4', 'plo5'])
      for (const st of ['flop', 'turn', 'river'])
        for (const b of ['under40', 'mid'])
          expect(on.get(`${v}|${st}|${b}`)?.n ?? 0).toBeGreaterThanOrEqual(MIN_N);
  });

  it("today's verdicts fold above the bound on the flop and the river (the over-fold this build corrects)", () => {
    const over = [...today].filter(([k, c]) => c.n >= MIN_N && c.fold > c.bound).map(([k]) => k);
    for (const v of ['plo4', 'plo5']) {
      expect(over).toContain(`${v}|flop|mid`);
      expect(over).toContain(`${v}|river|mid`);
    }
  });

  it('with the options on, every cell folds at most s / (1 + s) + 0.05', () => {
    const broken = [...on]
      .filter(([, c]) => c.n >= MIN_N && c.fold > c.bound + 1e-9)
      .map(([k, c]) => `${k} fold ${c.fold.toFixed(3)} > ${c.bound.toFixed(3)} (n ${c.n})`);
    expect(broken).toEqual([]);
  });

  it('a measured record of value-only bets justifies folding more, and only a record does', () => {
    let more = 0;
    for (const [k, c] of withRecord) {
      const base = on.get(k);
      if (!base || c.n < MIN_N) continue;
      expect(c.fold).toBeGreaterThanOrEqual(base.fold - 1e-9);
      if (c.fold > c.bound) more++;
    }
    expect(more).toBeGreaterThan(0);
  });
});
