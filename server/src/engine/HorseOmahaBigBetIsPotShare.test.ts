/**
 * IN OMAHA A BIG BET IS A SHARE OF THE POT, NOT A NUMBER OF BIG BLINDS
 * (option omahaBigBetIsPotShare, default OFF).
 *
 * The range read marks any wager of 20 big blinds or more as a big bet, and
 * the Omaha aggressor tier counted that mark like a wager of 70 percent of
 * the pot. With the option on, in PLO4/PLO5 cash, a turn or river wager under
 * 70 percent of the pot is tiered by its pot share. The nodes are the
 * recorded river folds of HorseOmahaRiverMediumBetCalls.test-support.ts
 * (opponent memory on, no row for the bettor).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, OMAHA_BIG_BET_POT_SHARE, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { omahaAggressorTier, seedFastRandom, type OppPostflopRead } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  RECORDED_RIVER_FOLDS,
  expand,
  type RecordedRiverFold,
} from './HorseOmahaRiverMediumBetCalls.test-support.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const ON: HorseDecideOpts = { omahaBigBetIsPotShare: true };
const RECEIPT = 'omaha_big_bet_by_pot_share';
const rec = (n: number): RecordedRiverFold => RECORDED_RIVER_FOLDS.find((r) => r.n === n)!;

function play(
  r: RecordedRiverFold,
  opts: HorseDecideOpts,
  change?: (r: RecordedRiverFold) => void
) {
  enableBrainTelemetry();
  const out = { bytes: [] as string[], actions: [] as string[], fires: [] as string[][] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    const copy = JSON.parse(JSON.stringify(r)) as RecordedRiverFold;
    change?.(copy);
    const { fx, node } = expand(copy);
    const st = stateAt(fx, node);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      ...opts,
    } as never);
    out.bytes.push(JSON.stringify(withoutMeasurements(d)));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
type Outcome = ReturnType<typeof play>;
const folds = (o: Outcome) => o.actions.filter((a) => a === 'fold').length;
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the aggressor tier', () => {
  const read = (over: Partial<OppPostflopRead>): OppPostflopRead => ({
    aggrW: 0.1,
    checked: 0,
    streets: 1,
    ...over,
  });
  it('the line is 70 percent of the pot', () => {
    expect(OMAHA_BIG_BET_POT_SHARE).toBe(0.7);
  });
  it('without the pot-share mark the tier is today’s: 20 big blinds counts like 70 percent of the pot', () => {
    expect(omahaAggressorTier(read({ lastFrac: 0.5 }))).toBe(1);
    expect(omahaAggressorTier(read({ lastFrac: 0.5, bigBet: true }))).toBe(2);
    expect(omahaAggressorTier(read({ lastFrac: 0.7 }))).toBe(2);
    expect(omahaAggressorTier(read({ lastFrac: 0.5, bigBet: true, streets: 2 }))).toBe(3);
  });
  it('with it a half-pot wager is tiered by its pot share; streets, a raise and a full bet still count', () => {
    const m = { tierByPotShare: true, bigBet: true, lastFrac: 0.5 };
    expect(omahaAggressorTier(read(m))).toBe(1);
    expect(omahaAggressorTier(read({ ...m, streets: 2 }))).toBe(2);
    expect(omahaAggressorTier(read({ ...m, streets: 3 }))).toBe(3);
    expect(omahaAggressorTier(read({ ...m, raised: true }))).toBe(2);
    expect(omahaAggressorTier(read({ ...m, fullBet: true }))).toBe(2);
    // a wager of 70 percent or more is tiered exactly as today whatever the mark says
    expect(omahaAggressorTier(read({ ...m, lastFrac: 0.7 }))).toBe(2);
    expect(omahaAggressorTier(read({ ...m, lastFrac: 1 }))).toBe(2);
  });
});

describe('omahaBigBetIsPotShare in the decision', () => {
  it('off: unset, false and a truthy non-boolean decide byte-identically at every recorded node', () => {
    for (const r of RECORDED_RIVER_FOLDS) {
      const unset = play(r, {});
      for (const opts of [
        { omahaBigBetIsPotShare: false },
        { omahaBigBetIsPotShare: 1 as unknown as boolean },
      ])
        expect(play(r, opts).bytes).toEqual(unset.bytes);
    }
  });

  it('a bet of 70 percent of the pot or more is read exactly as today', () => {
    // the recorded 85 percent bet
    const big = rec(59422360);
    expect(play(big, ON).bytes).toEqual(play(big, {}).bytes);
    expect(fired(play(big, ON), RECEIPT)).toBe(0);
    // the half-pot bets raised to 75 percent of the pot
    for (const [n, old] of [
      [59402247, '1|r|bet|60|p|1|0'],
      [59407493, '6|r|bet|211|p|1|0'],
    ] as const) {
      const r = rec(n);
      const seat = Number(old[0]);
      const sized = (x: RecordedRiverFold) => {
        const bet = Math.round((r.pot - r.bet) * 0.75);
        x.a = x.a.replace(old, `${seat}|r|bet|${bet}|p|1|0`);
        x.pot = x.pot - x.bet + bet;
        x.seats.find((s) => s[0] === seat)![2] = bet;
        x.bet = bet;
        x.min = bet * 2;
      };
      const on = play(r, ON, sized);
      expect(on.bytes).toEqual(play(r, {}, sized).bytes);
      expect(fired(on, RECEIPT)).toBe(0);
    }
  });

  it('half-pot river bets of 30 to 120 big blinds after one earlier street: the tier drops, the receipt fires, two pair calls', () => {
    // 59402247 is the best hand; the other three were beaten.
    for (const n of [59402247, 59455656, 59467641, 59484612]) {
      const off = play(rec(n), {});
      expect(folds(off)).toBeGreaterThan(0);
      const on = play(rec(n), ON);
      expect(fired(on, RECEIPT)).toBe(SEEDS.length);
      expect(folds(on)).toBe(0);
    }
  });

  it('what it does not reach: a third barrel is tier 3 on its streets alone, and the paired-board fold is its own rule', () => {
    // trips facing flop, turn and river bets: the tier does not differ, nothing changes
    const trips = play(rec(59458558), ON);
    expect(trips.bytes).toEqual(play(rec(59458558), {}).bytes);
    expect(fired(trips, RECEIPT)).toBe(0);
    // the flush on the paired board still folds by the paired-board fold
    const flush = play(rec(59480782), ON);
    expect(folds(flush)).toBe(SEEDS.length);
    expect(fired(flush, 'plo_paired_board_fold')).toBe(SEEDS.length);
    // the sets facing a second barrel: the tier drops from 3 to 2 and they still mostly fold
    for (const n of [59407493, 59446815]) {
      const on = play(rec(n), ON);
      expect(fired(on, RECEIPT)).toBe(SEEDS.length);
      expect(folds(on)).toBeGreaterThan(SEEDS.length / 2);
    }
  });

  it('another game and the opponent memory off are untouched', () => {
    const r = rec(59402247);
    expect(play(r, { mind: false, ...ON }).bytes).toEqual(play(r, { mind: false }).bytes);
    const asPlo6 = (x: RecordedRiverFold) => {
      x.hole = `${x.hole}2c`;
    };
    for (const variant of ['plo6'] as const) {
      const run = (opts: HorseDecideOpts) => {
        enableBrainTelemetry();
        const bytes: string[] = [];
        for (const seed of SEEDS) {
          HorseMind.reset();
          drainFires();
          seedFastRandom(seed);
          const copy = JSON.parse(JSON.stringify(r)) as RecordedRiverFold;
          asPlo6(copy);
          const { fx, node } = expand(copy);
          node.publicNode!.variant = variant;
          fx.variant = variant;
          const st = stateAt(fx, node);
          const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
            observeMind: false,
            ...opts,
          } as never);
          bytes.push(JSON.stringify(withoutMeasurements(d)));
        }
        return bytes;
      };
      expect(run(ON)).toEqual(run({}));
    }
  });
});
