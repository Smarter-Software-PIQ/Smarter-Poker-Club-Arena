/**
 * omahaPairedBoardRiverIsPriced (lane PAIRED-RIVER 2026-11-18, default OFF).
 *
 * Recorded spots, each a hand's own public record at the Horse's river
 * decision with that Horse's own cards (no user ids, no person's cards):
 * hand 59993188 (the nut flush folded on a river that paired the board at a
 * price of 26.0%), hand 59730132 (the lead into the turn aggressor the
 * facing-bet rule reviewed) and hand 59521326 (from the facing-bet fixtures:
 * the nut straight, the rest of the stack at 21%).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import {
  RECORDED_FACING_BETS,
  cardsOf,
  expand,
  type RecordedFacingBet,
} from './HorseOmahaFacingBetEv.test-support.js';
import {
  OMAHA_PAIRED_RIVER_FIT,
  omahaPairedRiverBetWeights,
  omahaPairedRiverCells,
  omahaPairedRiverLineOf,
  omahaPairedRiverNutClass,
  omahaPairedRiverPricedOver,
  omahaPairedRiverRange,
  omahaPairedRiverRangeOf,
  omahaPairedRiverVerdict,
} from './HorseOmahaPairedRiverPriced.js';

/** Hand 59993188: aces re-raised, a 4-bet called, flop and turn called, the nut flush on the river that paired the board. */
const HAND_59993188: RecordedFacingBet = {
  n: 59993188,
  held: 'nut flush, river paired the board',
  best: false,
  pl: '1H 2P 3H 4H 5H 6H',
  dealer: 6,
  a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|raise|8|h|1|0;1|p|raise|28|h|1|0;2|p|raise|94|p|1|0;6|p|fold|0|h|0|0;1|p|call|66|h|0|0;1|f|check|0|h|0|0;2|f|bet|149|p|1|0;1|f|call|149|h|0|0;1|t|check|0|h|0|0;2|t|bet|367|p|1|0;1|t|call|367|h|0|0;1|r|check|0|h|0|0;2|r|all_in|664.4|p|1|0;1|r|fold|0|h|0|0',
  boards: ['3cTd2sQs3s'],
  seat: 1,
  ord: 20,
  hole: '6hAdAs4s8h',
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
/** Hand 59730132: a player who called the flop and the turn leads half the pot into the Horse that bet both. */
const HAND_59730132: RecordedFacingBet = {
  n: 59730132,
  did: 'call',
  held: 'nut flush, river paired the board',
  best: false,
  pl: '1H 2H 3P 4H 5H 6H',
  dealer: 2,
  a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;5|p|raise|8|h|1|0;6|p|fold|0|h|0|0;1|p|fold|0|h|0|0;2|p|call|8|h|0|0;3|p|call|7|p|0|0;4|p|raise|42|h|1|0;5|p|call|34|h|0|0;2|p|call|34|h|0|0;3|p|call|34|p|0|0;3|f|check|0|p|0|0;4|f|bet|96|h|1|0;5|f|fold|0|h|0|0;2|f|fold|0|h|0|0;3|f|call|96|p|0|0;3|t|check|0|p|0|0;4|t|bet|234|h|1|0;3|t|call|234|p|0|0;3|r|bet|415|p|1|0;4|r|call|415|h|0|0',
  boards: ['8cKc2c5d5h'],
  seat: 4,
  ord: 22,
  hole: 'QsTdAcJd5c',
  pot: 1245,
  bet: 415,
  min: null,
  max: null,
  seats: [
    [1, 400, 0, 0, 0, 0, 1],
    [2, 431.1, 0, 42, 0, 0, 1],
    [3, 319.5, 415, 787, 0, 0, 0],
    [4, 559.25, 0, 374, 2, 0, 0],
    [5, 1546.75, 0, 42, 0, 0, 1],
    [6, 1336.85, 0, 0, 0, 0, 1],
  ],
};
const HAND_59521326 = RECORDED_FACING_BETS.find((r) => r.n === 59521326)!;

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3];
/** The serving brain's two layers on this spot: the facing-bet EV and the paired-board fold with its price exception. */
const BASE: HorseDecideOpts = { omahaFacingBetEv: true, omahaPairedBoardFoldRespectsPrice: true };
const ON: HorseDecideOpts = { ...BASE, omahaPairedBoardRiverIsPriced: true };

function at(r: RecordedFacingBet, change?: (r: RecordedFacingBet) => void) {
  const copy = JSON.parse(JSON.stringify(r)) as RecordedFacingBet;
  change?.(copy);
  const { fx, node } = expand(copy);
  return stateAt(fx, node);
}
function play(
  r: RecordedFacingBet,
  opts: HorseDecideOpts,
  change?: (r: RecordedFacingBet) => void
) {
  enableBrainTelemetry();
  const out = { bytes: [] as string[], actions: [] as string[], fires: [] as string[][] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => null);
    drainFires();
    seedFastRandom(seed);
    const st = at(r, change);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const every = (o: { actions: string[] }, ...a: string[]) => o.actions.every((x) => a.includes(x));
function pricedOf(r: RecordedFacingBet) {
  const st = at(r);
  const spot = omahaFacingBetEvSpot(st.hero, st.gs as never)!;
  const base = omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null)!;
  const priced = omahaPairedRiverPricedOver(
    spot,
    base,
    st.hero.cards,
    st.gs.communityCards,
    [],
    st.gs.actionHistory,
    st.gs.pot,
    0,
    st.hero.seat
  );
  return { st, spot, base, priced };
}

afterEach(() => vi.restoreAllMocks());

describe('the spot: a straight or flush only a full house or quads beats, on a paired river', () => {
  const board = cardsOf('3cTd2sQs3s');
  it('the ace-high flush is in; a lower flush, a full house, an unpaired board and six cards are out', () => {
    expect(omahaPairedRiverNutClass(cardsOf('6hAdAs4s8h'), board)).toBe(true);
    expect(omahaPairedRiverNutClass(cardsOf('6hKdKs4s8h'), board)).toBe(false);
    expect(omahaPairedRiverNutClass(cardsOf('6hTdTs4s8h'), board)).toBe(false);
    expect(omahaPairedRiverNutClass(cardsOf('6hAdAs4s8h'), cardsOf('3cTd2sQs7s'))).toBe(false);
    expect(omahaPairedRiverNutClass(cardsOf('6hAdAs4s8h9d'), board)).toBe(false);
    // the nut straight where no flush is possible; the same straight when a flush is possible
    expect(omahaPairedRiverNutClass(cardsOf('6sKhAs3hQs'), cardsOf('2d4h5s4dAh'))).toBe(true);
    expect(omahaPairedRiverNutClass(cardsOf('6sKcAs3cQs'), cardsOf('2h4h5s4dAh'))).toBe(false);
  });
});

describe("the bettor's line from the public history", () => {
  it('hand 59993188: a 4-bet, three quarters of the pot on the flop and on the turn', () => {
    const st = at(HAND_59993188);
    const line = omahaPairedRiverLineOf(st.gs.actionHistory, 2, st.gs.pot);
    expect(line.preflopDepth).toBe(3);
    expect(line.flop.kind).toBe('aggr');
    expect(line.turn.kind).toBe('aggr');
    if (line.flop.kind === 'aggr') expect(line.flop.potFrac).toBeCloseTo(149 / 198, 6);
    if (line.turn.kind === 'aggr') expect(line.turn.potFrac).toBeCloseTo(367 / 496, 6);
  });
  it('hand 59730132: he called before the flop, on the flop and on the turn', () => {
    const st = at(HAND_59730132);
    expect(omahaPairedRiverLineOf(st.gs.actionHistory, 3, st.gs.pot)).toEqual({
      preflopDepth: 0,
      flop: { kind: 'call' },
      turn: { kind: 'call' },
    });
    expect(omahaPairedRiverLineOf(st.gs.actionHistory, 4, st.gs.pot).turn.kind).toBe('aggr');
  });
});

describe('the range and the verdict', () => {
  it('the same cards give the same count; the masses sum to one; blockers are exact (no holding uses a seen card)', () => {
    const st = at(HAND_59993188);
    const line = omahaPairedRiverLineOf(st.gs.actionHistory, 2, st.gs.pot);
    const a = omahaPairedRiverCells(st.hero.cards, st.gs.communityCards, [], line)!;
    const b = omahaPairedRiverCells(st.hero.cards, st.gs.communityCards, [], line)!;
    expect(a).toEqual(b);
    expect(a.cells.reduce((x, y) => x + y, 0)).toBe(a.samples);
    const r = omahaPairedRiverRangeOf(a)!;
    expect(r.mass.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    // the Horse holds the ace of spades: no holding of his beats it with a flush, so it wins or ties every class but the first
    expect(r.win[0] + r.tie[0]).toBe(0);
    expect(r.win[1] + r.tie[1]).toBeCloseTo(r.mass[1], 9);
    expect(r.win[2]).toBeCloseTo(r.mass[2], 9);
    // a 4-bettor's range is cut by the engine's preflop width
    expect(a.reraised).toBe(true);
    expect(a.preflopWidth).toBeGreaterThan(0.2);
    expect(a.preflopWidth).toBeLessThan(0.5);
  });
  it('his full houses are a smaller share of a bigger bet-for-value range than of every holding he could hold', () => {
    const w = omahaPairedRiverBetWeights(0.54);
    expect(w[0]).toBe(1);
    // the fit: people bet a flush or straight on a paired river less often than a full house, and less the bigger the bet
    expect(w[1]).toBeLessThan(1);
    expect(omahaPairedRiverBetWeights(1)[1]).toBeLessThan(w[1]);
    expect(OMAHA_PAIRED_RIVER_FIT.fs[1]).toBeLessThan(0);
  });
  it('the verdict is the EV formula at the actual price: a worse price can only lower it', () => {
    const st = at(HAND_59993188);
    const line = omahaPairedRiverLineOf(st.gs.actionHistory, 2, st.gs.pot);
    const range = omahaPairedRiverRange(st.hero.cards, st.gs.communityCards, [], line)!;
    const v = omahaPairedRiverVerdict(
      range,
      { potFrac: 0.54, paid: 664.4, winnable: 1894.4 },
      { margin: 0 }
    );
    expect(v.ev).toBeCloseTo(
      v.pWin * 1894.4 + v.pTie * ((1894.4 - 664.4) / 2) - (1 - v.pWin - v.pTie) * 664.4,
      6
    );
    const dearer = omahaPairedRiverVerdict(
      range,
      { potFrac: 0.54, paid: 664.4, winnable: 1000 },
      { margin: 0 }
    );
    expect(dearer.ev).toBeLessThan(v.ev);
    const raked = omahaPairedRiverVerdict(
      range,
      { potFrac: 0.54, paid: 664.4, winnable: 1894.4 },
      { margin: 0, rake: 0.05 }
    );
    expect(raked.ev).toBeLessThan(v.ev);
  });
});

describe('hand 59993188: the nut flush on a paired river at a price of 26.0%', () => {
  it('before: the serving layers fold it (the facing-bet EV over every holding, and the paired-board fold)', () => {
    const { spot, base } = pricedOf(HAND_59993188);
    expect(spot.paid / (spot.winnable + spot.paid)).toBeCloseTo(0.2597, 3);
    expect(base.call).toBe(false);
    const off = play(HAND_59993188, BASE);
    expect(every(off, 'fold')).toBe(true);
    expect(off.fires.every((f) => f.includes('omaha_facing_bet_ev_fold'))).toBe(true);
  });
  it('after: priced on his range it is a call; the facing-bet receipt records the change', () => {
    const { priced, base } = pricedOf(HAND_59993188);
    expect(priced).not.toBeNull();
    expect(priced!.call).toBe(true);
    expect(priced!.pWin).toBeGreaterThan(0.26 + 0.02);
    expect(priced!.margin).toBe(base.margin);
    expect(priced!.pairedRiverPriced!.boatShare).toBeGreaterThan(0.3);
    expect(priced!.pairedRiverPriced!.boatShare).toBeLessThan(0.8);
    const on = play(HAND_59993188, ON);
    expect(every(on, 'call', 'all_in')).toBe(true);
    expect(on.fires.every((f) => f.includes('omaha_facing_bet_ev_call'))).toBe(true);
    expect(on.fires.every((f) => f.includes('omaha_facing_bet_ev_changed'))).toBe(true);
  });
  it('it is priced, not waved through: the same hand at a price his range does not pay folds', () => {
    const { st, spot, base } = pricedOf(HAND_59993188);
    const dear = { ...spot, winnable: spot.paid * 1.05 };
    const v = omahaPairedRiverPricedOver(
      dear,
      { ...base, margin: 0.02 * (dear.winnable + dear.paid) },
      st.hero.cards,
      st.gs.communityCards,
      [],
      st.gs.actionHistory,
      st.gs.pot,
      0,
      st.hero.seat
    )!;
    expect(v.call).toBe(false);
  });
  it("a king-high flush in the same spot is not the option's: the decision is the one it was", () => {
    const lower = (r: RecordedFacingBet) => {
      r.hole = '6hKdKs4s8h';
    };
    expect(pricedOf({ ...HAND_59993188, hole: '6hKdKs4s8h' }).priced).toBeNull();
    expect(play(HAND_59993188, ON, lower).bytes).toEqual(play(HAND_59993188, BASE, lower).bytes);
  });
  it("a Horse's bet is not priced here (the frequencies are measured on people): the decision is the one it was", () => {
    const horseBets = (r: RecordedFacingBet) => {
      r.pl = '1H 2H 3H 4H 5H 6H';
      r.a = r.a
        .split(';')
        .map((row) => {
          const f = row.split('|');
          if (f[4] === 'p') f[4] = 'h';
          return f.join('|');
        })
        .join(';');
    };
    expect(play(HAND_59993188, ON, horseBets).bytes).toEqual(
      play(HAND_59993188, BASE, horseBets).bytes
    );
  });
  it('without omahaFacingBetEv the option does nothing', () => {
    expect(play(HAND_59993188, { omahaPairedBoardRiverIsPriced: true }).bytes).toEqual(
      play(HAND_59993188, {}).bytes
    );
  });
  it('unset and false are the same decision, byte for byte', () => {
    expect(play(HAND_59993188, { ...BASE, omahaPairedBoardRiverIsPriced: false }).bytes).toEqual(
      play(HAND_59993188, BASE).bytes
    );
  });
});

describe('the two controls', () => {
  it('hand 59521326 stays a call (the rest of the stack with the nut straight)', () => {
    expect(every(play(HAND_59521326, BASE), 'all_in', 'call')).toBe(true);
    expect(pricedOf(HAND_59521326).priced!.call).toBe(true);
    expect(every(play(HAND_59521326, ON), 'all_in', 'call')).toBe(true);
  });
  it('hand 59730132 stays a fold: the reviewed lead into the turn aggressor is not priced here', () => {
    expect(pricedOf(HAND_59730132).priced).toBeNull();
    const off = play(HAND_59730132, BASE);
    expect(every(off, 'fold')).toBe(true);
    expect(play(HAND_59730132, ON).bytes).toEqual(off.bytes);
  });
});

describe('nothing else moves', () => {
  it('every recorded facing-bet decision outside the spot is the same with the option on', () => {
    let inSpot = 0;
    for (const r of RECORDED_FACING_BETS) {
      const st = at(r);
      const spot = omahaFacingBetEvSpot(st.hero, st.gs as never);
      const base = spot
        ? omahaFacingBetEvVerdict(spot, st.hero.cards, st.gs.communityCards, [], null)
        : null;
      const priced =
        spot && base
          ? omahaPairedRiverPricedOver(
              spot,
              base,
              st.hero.cards,
              st.gs.communityCards,
              [],
              st.gs.actionHistory,
              st.gs.pot,
              0,
              st.hero.seat
            )
          : null;
      if (priced) {
        inSpot++;
        // a straight or a flush, never less
        expect([r.n, omahaPairedRiverNutClass(st.hero.cards, st.gs.communityCards)]).toEqual([
          r.n,
          true,
        ]);
        continue;
      }
      expect([r.n, r.seat, play(r, ON).bytes]).toEqual([r.n, r.seat, play(r, BASE).bytes]);
    }
    expect(inSpot).toBeGreaterThan(0);
  }, 900000);
});
