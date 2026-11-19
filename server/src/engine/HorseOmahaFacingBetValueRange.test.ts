/**
 * omahaFacingBetValueIsRangeRelative (lane VALUE-REGION 2026-11-18, default OFF).
 *
 * The shape of hand 59993188 (PLO5 1/2 cash): the Horse re-raised before the
 * flop and called a 4-bet, called the flop and the turn, made the ace-high
 * flush on a river that paired the board, and faced a person's bet of 54% of
 * the pot at a price of 26.0%. The facing-bet verdict's value region is the
 * strongest share of ALL holdings, which on a paired board is only full
 * houses, so it folds. Against the bettor's measured betting range it is a
 * call. SYNTHETIC CARDS of the same shape (board and hole are not the hand's):
 * the public action line and the stacks are the hand's own record, with no
 * user ids and no person's cards.
 */
import { describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { scoreOmahaHiPartial, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import { expand, type RecordedFacingBet } from './HorseOmahaFacingBetEv.test-support.js';
import {
  OMAHA_VALUE_RANGE_BINS,
  OMAHA_VALUE_RANGE_FIT,
  omahaFacingBetValueRangeOver,
  omahaValueRangeDensity,
  omahaValueRangeDraw,
  omahaValueRangePercentile,
  omahaValueRangePreflopDepth,
  withOmahaValueRangeFit,
} from './HorseOmahaFacingBetValueRange.js';

/** The line of hand 59993188 with synthetic cards: an A-high flush on a river that pairs the board. */
const NUT_FLUSH_PAIRED_RIVER: RecordedFacingBet = {
  n: 1,
  held: 'nut flush, river paired the board (synthetic cards)',
  best: false,
  pl: '1H 2P 3H 4H 5H 6H',
  dealer: 6,
  a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|raise|8|h|1|0;1|p|raise|28|h|1|0;2|p|raise|94|p|1|0;6|p|fold|0|h|0|0;1|p|call|66|h|0|0;1|f|check|0|h|0|0;2|f|bet|149|p|1|0;1|f|call|149|h|0|0;1|t|check|0|h|0|0;2|t|bet|367|p|1|0;1|t|call|367|h|0|0;1|r|check|0|h|0|0;2|r|all_in|664.4|p|1|0;1|r|fold|0|h|0|0',
  boards: ['5c9d2hKh5h'],
  seat: 1,
  ord: 20,
  hole: 'AhAd7h6s8c',
  pot: 1894.4,
  bet: 664.4,
  min: null,
  max: null,
  seats: [
    [1, 686.75, 0, 610, 0, 0, 0],
    [2, 0, 664.4, 1276.4, 2, 0, 2],
    [3, 982.6, 0, 0, 0, 0, 1],
    [4, 339.4, 0, 0, 0, 0, 1],
    [5, 432, 0, 0, 0, 0, 1],
    [6, 398.4, 0, 8, 0, 0, 1],
  ],
};
/** The same spot with a genuinely beaten hand: a pair of jacks with fives on the board, no flush card. */
const BEATEN = { hole: 'JcJd8s7c6d', held: 'two pair, jacks and fives (synthetic)' };

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3];
/** The serving brain's two layers on this spot: the facing-bet EV and the paired-board fold with its price exception. */
const BASE: HorseDecideOpts = { omahaFacingBetEv: true, omahaPairedBoardFoldRespectsPrice: true };
const ON: HorseDecideOpts = { ...BASE, omahaFacingBetValueIsRangeRelative: true };

function at(change?: (r: RecordedFacingBet) => void) {
  const copy = JSON.parse(JSON.stringify(NUT_FLUSH_PAIRED_RIVER)) as RecordedFacingBet;
  change?.(copy);
  const { fx, node } = expand(copy);
  return stateAt(fx, node);
}
function play(opts: HorseDecideOpts, change?: (r: RecordedFacingBet) => void) {
  enableBrainTelemetry();
  const out = { bytes: [] as string[], actions: [] as string[] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => null);
    drainFires();
    seedFastRandom(seed);
    const st = at(change);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.actions.push(d.action);
    drainFires();
    vi.restoreAllMocks();
  }
  return out;
}
const every = (o: { actions: string[] }, ...a: string[]) => o.actions.every((x) => a.includes(x));
describe('omahaFacingBetValueIsRangeRelative: the nut flush on a paired river (shape of hand 59993188)', () => {
  it('fails before: the serving facing-bet verdict folds it at a price of 26%', () => {
    const st = at();
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    expect(spot.street).toBe('river');
    const price = spot.paid / (spot.winnable + spot.paid);
    expect(price).toBeGreaterThan(0.25);
    expect(price).toBeLessThan(0.27);
    expect(every(play(BASE), 'fold')).toBe(true);
  });

  it('passes after: with the option on the Horse continues (calls the all-in)', () => {
    expect(every(play(ON), 'call', 'all_in')).toBe(true);
  });

  it('the verdict is EV against his measured betting range, at the actual price', () => {
    const st = at();
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    const base = omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null)!;
    expect(base.call).toBe(false);
    const ranged = omahaFacingBetValueRangeOver(
      spot,
      base,
      st.hero.cards,
      st.gs.communityCards,
      [],
      st.gs.actionHistory,
      0
    )!;
    expect(ranged.call).toBe(true);
    expect(ranged.valueRange.pWin).toBeGreaterThan(ranged.valueRange.price);
    expect(ranged.margin).toBe(base.margin);
    // a 4-bettor: the preflop width narrows his range (engine's re-raise defence width)
    expect(ranged.valueRange.preflopWidth).toBeLessThan(0.5);
    // the same cards give the same answer
    const again = omahaFacingBetValueRangeOver(
      spot,
      base,
      st.hero.cards,
      st.gs.communityCards,
      [],
      st.gs.actionHistory,
      0
    )!;
    expect(again.ev).toBe(ranged.ev);
  });

  it('control: a genuinely beaten hand in the same spot still folds with the option on', () => {
    const change = (r: RecordedFacingBet) => {
      r.hole = BEATEN.hole;
      r.held = BEATEN.held;
    };
    expect(every(play(BASE, change), 'fold')).toBe(true);
    expect(every(play(ON, change), 'fold')).toBe(true);
  });

  it('control: the same price his range does not pay is still a fold (a bet four times the size into the same range)', () => {
    const st = at();
    const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
    const base = omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null)!;
    // the Horse wins the same share of his bets; only the price changes (call 4x for the same pot)
    const dear = { ...spot, paid: spot.paid * 4, winnable: spot.winnable };
    const ranged = omahaFacingBetValueRangeOver(
      dear,
      { ...base, margin: base.margin },
      st.hero.cards,
      st.gs.communityCards,
      [],
      st.gs.actionHistory,
      0
    )!;
    expect(ranged.valueRange.price).toBeGreaterThan(ranged.valueRange.pWin);
    expect(ranged.call).toBe(false);
  });

  it('unset and false are byte-identical; without omahaFacingBetEv the option does nothing', () => {
    const unset = play(BASE);
    const off = play({ ...BASE, omahaFacingBetValueIsRangeRelative: false });
    expect(off.bytes).toEqual(unset.bytes);
    const noEv = play({ omahaPairedBoardFoldRespectsPrice: true });
    const noEvOn = play({
      omahaPairedBoardFoldRespectsPrice: true,
      omahaFacingBetValueIsRangeRelative: true,
    });
    expect(noEvOn.bytes).toEqual(noEv.bytes);
  });

  it('a Horse bettor keeps the facing-bet verdict (the density is measured on people)', () => {
    const toHorse = (r: RecordedFacingBet) => {
      r.pl = '1H 2H 3H 4H 5H 6H';
      r.a = r.a
        .split(';')
        .map((row) => {
          const f = row.split('|');
          if (f[0] === '2' && f[4] === 'p') f[4] = 'h';
          return f.join('|');
        })
        .join(';');
    };
    expect(play(ON, toHorse).bytes).toEqual(play(BASE, toHorse).bytes);
  });
});

describe('the measured betting range', () => {
  it('the fit has three lines, four size centres and a density of mean 1 in each cell', () => {
    expect(OMAHA_VALUE_RANGE_FIT.byLine).toHaveLength(3);
    for (const line of OMAHA_VALUE_RANGE_FIT.byLine) {
      expect(line).toHaveLength(4);
      for (const row of line) {
        expect(row).toHaveLength(OMAHA_VALUE_RANGE_BINS);
        const mean = row.reduce((a, b) => a + b, 0) / row.length;
        expect(mean).toBeCloseTo(1, 2);
      }
    }
  });

  it('people bet their strongest holdings most: the density rises from the bottom decile to the top', () => {
    for (const a of [0, 1, 2])
      for (const x of [0.25, 0.55, 0.9, 1.5])
        expect(omahaValueRangeDensity(0.95, a, x)).toBeGreaterThan(
          omahaValueRangeDensity(0.05, a, x)
        );
  });

  it('the size is read continuously between the centres (no step)', () => {
    const lo = omahaValueRangeDensity(0.9, 1, 0.399);
    const hi = omahaValueRangeDensity(0.9, 1, 0.401);
    expect(Math.abs(hi - lo)).toBeLessThan(0.01);
  });

  it("the draw removes the Horse's cards (exact blockers) and the percentile is mid-rank", () => {
    const st = at();
    const draw = omahaValueRangeDraw(5, st.hero.cards, st.gs.communityCards, 3)!;
    expect(draw.scores.length).toBeGreaterThan(1000);
    const hero = scoreOmahaHiPartial(st.hero.cards, st.gs.communityCards);
    const r = omahaValueRangePercentile(draw.scores, hero);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(1);
    expect(omahaValueRangePercentile(new Float64Array([1, 2, 2, 3]), 2)).toBe(0.5);
  });

  it('his preflop depth is his deepest raise', () => {
    const st = at();
    expect(omahaValueRangePreflopDepth(st.gs.actionHistory as never, 2)).toBe(3);
    expect(omahaValueRangePreflopDepth(st.gs.actionHistory as never, 1)).toBe(2);
  });

  it('the evaluation seam puts another fit in force only inside its call', () => {
    const flat = { byLine: [0, 1, 2].map(() => [0, 1, 2, 3].map(() => new Array(10).fill(1))) };
    expect(withOmahaValueRangeFit(flat, () => omahaValueRangeDensity(0.95, 1, 0.5))).toBe(1);
    expect(omahaValueRangeDensity(0.95, 1, 0.5)).not.toBe(1);
  });
});
