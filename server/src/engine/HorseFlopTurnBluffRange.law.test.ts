/**
 * LAW: a qualified flop or turn bluff or semi-bluff candidate bets or raises,
 * in Hold'em and in PLO4, and nothing switches that off; an unqualified hand
 * is never made to bluff by this layer.
 *
 * The owner instruction behind the river baseline (Dan, 2026-11-06: "CHECK
 * THAT THERE IS NOTHING THAT IS EVER BLOCKING OR PRENENTING, OR 'SHUTTING
 * OFF' ... BLUFFS FOR QUALIFIED CANDITATES OR SITUATIONS") applies to every
 * street. Every rate drives the real HorseLogic.decide on a 1/2 cash,
 * 100bb single-raised pot (HorseFlopTurnBluff.test-support.ts) against an
 * opponent memory has never seen. It pins:
 *  1. Hold'em: a flop c-bet with an open-ender, a turn barrel with a draw or
 *     two overcards, a turn probe with a draw, and a check-raise with a flush
 *     draw happen at a non-zero, bounded rate, owned by the baseline.
 *  2. PLO4: a wrap barrels and probes a blank turn (it bet 0 of 200 times
 *     before the baseline) and check-raises the flop; nut flush draws c-bet;
 *     no PLO bet exceeds the pot.
 *  3. Unqualified hands are not touched: junk, showdown value, an all-in
 *     opponent and a four-way pot without a draw get no baseline bluff, and
 *     junk decides exactly as it did without the layer.
 *  4. Reads reshape, never switch off: a station gets fewer semi-bluffs, never
 *     zero. Tournaments still semi-bluff on the bubble, no more than cash.
 *  5. Dan's PLO paired-board rule: a draw never semi-bluff raises a paired
 *     Omaha board, and bets one at half the frequency.
 * A red law means a flop or turn bluff is again shut off for a qualified
 * candidate, or a hand that should check is being made to bluff.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedOpponentRiverRead } from './HorseV54RiverBluff.test-support.js';
import {
  c,
  decideFlopTurn,
  flopTurnState,
  type FlopTurnSpot,
} from './HorseFlopTurnBluff.test-support.js';
import {
  FT_BLUFF_MAX_PROBABILITY,
  FT_RAISE_MAX_PROBABILITY,
  flopTurnBluffEligibility,
  flopTurnBluffProbability,
  holdemDrawRead,
  type FlopTurnBluffSpot,
} from './HorseFlopTurnBluffRange.js';
import type { HorseDecideOpts } from './HorseLogic.js';

const TIMEOUT = 300_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
const SEEDS = Array.from({ length: 240 }, (_, i) => 104_729 + i * 15_485_863);
const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

interface Run {
  rate: number;
  owned: number;
  amounts: number[];
  actions: string[];
}

function run(
  spot: FlopTurnSpot,
  opts: HorseDecideOpts = {},
  prepare: () => void = () => HorseMind.reset()
): Run {
  prepare();
  drainFires();
  let n = 0;
  const amounts: number[] = [];
  const actions: string[] = [];
  for (const seed of SEEDS) {
    const d = decideFlopTurn(spot, seed, { telemetry: true, ...opts });
    actions.push(`${d.action}:${d.amount ?? ''}`);
    if (d.action === 'bet' || d.action === 'raise' || d.action === 'all_in') {
      n++;
      if (typeof d.amount === 'number') amounts.push(d.amount);
    }
  }
  const owned = drainFires()
    .filter((r) =>
      /^ft_(bluff_baseline_(cbet|barrel|delayed|probe|stab)_|semibluff_raise_(strongDraw|pairDraw|weakDraw)$)/.test(
        r.feature
      )
    )
    .reduce((s, r) => s + r.fires, 0);
  return { rate: n / SEEDS.length, owned, amounts, actions };
}

// ── Hold'em spots ───────────────────────────────────────────────────────────
const NLH_CBET_OESD: FlopTurnSpot = {
  name: 'nlh_cbet_oesd',
  variant: 'nlh',
  hole: [c('9', S), c('8', D)],
  board: [c('T', H), c('7', C), c('2', S)],
  line: 'cbet',
};
const NLH_BARREL_OESD: FlopTurnSpot = {
  ...NLH_CBET_OESD,
  name: 'nlh_barrel_oesd',
  board: [c('T', H), c('7', C), c('2', S), c('3', H)],
  line: 'barrel',
};
const NLH_BARREL_OVERCARDS: FlopTurnSpot = {
  name: 'nlh_barrel_overcards',
  variant: 'nlh',
  hole: [c('A', C), c('Q', D)],
  board: [c('8', H), c('5', C), c('2', S), c('J', D)],
  line: 'barrel',
};
const NLH_PROBE_OESD: FlopTurnSpot = { ...NLH_BARREL_OESD, name: 'nlh_probe_oesd', line: 'probe' };
const NLH_CHECK_RAISE_FD: FlopTurnSpot = {
  name: 'nlh_check_raise_fd',
  variant: 'nlh',
  hole: [c('Q', H), c('J', H)],
  board: [c('K', H), c('7', H), c('2', S)],
  line: 'checkRaise',
};
const NLH_BARREL_JUNK: FlopTurnSpot = {
  name: 'nlh_barrel_junk',
  variant: 'nlh',
  hole: [c('6', C), c('4', D)],
  board: [c('K', H), c('Q', S), c('9', D), c('3', C)],
  line: 'barrel',
};
const NLH_FOUR_WAY_JUNK: FlopTurnSpot = {
  ...NLH_BARREL_JUNK,
  name: 'nlh_four_way_junk',
  line: 'delayed',
  extraOpponents: 2,
};
const NLH_OPP_ALL_IN: FlopTurnSpot = {
  ...NLH_BARREL_OESD,
  name: 'nlh_opp_all_in',
  oppAllIn: true,
};
const NLH_BUBBLE_OESD: FlopTurnSpot = {
  ...NLH_BARREL_OESD,
  name: 'nlh_bubble_oesd',
  tournament: true,
};

// ── PLO4 spots ──────────────────────────────────────────────────────────────
const PLO4_BARREL_WRAP: FlopTurnSpot = {
  name: 'plo4_barrel_wrap',
  variant: 'plo4',
  hole: [c('9', S), c('8', D), c('6', C), c('J', H)],
  board: [c('T', H), c('7', C), c('2', S), c('3', D)],
  line: 'barrel',
};
const PLO4_PROBE_WRAP: FlopTurnSpot = {
  ...PLO4_BARREL_WRAP,
  name: 'plo4_probe_wrap',
  line: 'probe',
};
const PLO4_CHECK_RAISE_WRAP: FlopTurnSpot = {
  ...PLO4_BARREL_WRAP,
  name: 'plo4_check_raise_wrap',
  board: [c('T', H), c('7', C), c('2', S)],
  line: 'checkRaise',
};
const PLO4_CBET_NUT_FD: FlopTurnSpot = {
  name: 'plo4_cbet_nut_fd',
  variant: 'plo4',
  hole: [c('A', H), c('5', H), c('9', C), c('8', D)],
  board: [c('K', H), c('7', H), c('2', S)],
  line: 'cbet',
};
const PLO4_PAIRED_CHECK_RAISE: FlopTurnSpot = {
  ...PLO4_CHECK_RAISE_WRAP,
  name: 'plo4_paired_check_raise',
  board: [c('T', H), c('7', C), c('7', S)],
};
const PLO4_JUNK: FlopTurnSpot = {
  name: 'plo4_junk',
  variant: 'plo4',
  // No flush draw, no straight draw, an underpair: nothing to represent.
  hole: [c('Q', S), c('8', D), c('3', C), c('3', H)],
  board: [c('9', H), c('6', C), c('2', S), c('K', D)],
  line: 'barrel',
};

describe("LAW: Hold'em qualified candidates bluff on the flop and turn", () => {
  it(
    'a c-bet with an open-ender, a barrel with a draw or overcards and a probe with a draw',
    () => {
      for (const [spot, lo, hi] of [
        [NLH_CBET_OESD, 0.45, FT_BLUFF_MAX_PROBABILITY + 0.08],
        [NLH_BARREL_OESD, 0.45, FT_BLUFF_MAX_PROBABILITY + 0.08],
        [NLH_BARREL_OVERCARDS, 0.15, 0.65],
        [NLH_PROBE_OESD, 0.4, FT_BLUFF_MAX_PROBABILITY + 0.08],
      ] as const) {
        const r = run(spot);
        expect(r.rate, spot.name).toBeGreaterThan(lo);
        expect(r.rate, spot.name).toBeLessThan(hi);
        expect(r.owned, spot.name).toBeGreaterThan(0);
      }
    },
    TIMEOUT
  );

  it(
    'the turn barrel with an open-ender is no longer given up (it bet 38% without the baseline)',
    () => {
      const on = run(NLH_BARREL_OESD).rate;
      const off = run(NLH_BARREL_OESD, { flopTurnBluffBaseline: false }).rate;
      expect(on).toBeGreaterThan(off + 0.15);
    },
    TIMEOUT
  );

  it(
    'a flush draw check-raises the flop at a bounded rate (it raised 6% without the baseline)',
    () => {
      const on = run(NLH_CHECK_RAISE_FD);
      const off = run(NLH_CHECK_RAISE_FD, { flopTurnBluffBaseline: false });
      expect(on.rate).toBeGreaterThan(0.2);
      expect(on.rate).toBeLessThan(FT_RAISE_MAX_PROBABILITY + 0.08);
      expect(on.rate).toBeGreaterThan(off.rate + 0.1);
      expect(on.owned).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

describe('LAW: PLO4 qualified candidates bluff on the flop and turn', () => {
  it(
    'a wrap barrels and probes a blank turn; it bet zero times without the baseline',
    () => {
      const off = run(PLO4_BARREL_WRAP, { flopTurnBluffBaseline: false }).rate;
      for (const spot of [PLO4_BARREL_WRAP, PLO4_PROBE_WRAP]) {
        const r = run(spot);
        expect(r.rate, spot.name).toBeGreaterThan(0.4);
        expect(r.rate, spot.name).toBeLessThan(FT_BLUFF_MAX_PROBABILITY + 0.08);
        expect(r.owned, spot.name).toBeGreaterThan(0);
        expect(r.rate, spot.name).toBeGreaterThan(off + 0.3);
      }
    },
    TIMEOUT
  );

  it(
    'a wrap check-raises the flop and a nut flush draw c-bets, never above the pot',
    () => {
      const cr = run(PLO4_CHECK_RAISE_WRAP);
      expect(cr.rate).toBeGreaterThan(0.25);
      expect(cr.rate).toBeLessThan(FT_RAISE_MAX_PROBABILITY + 0.08);
      expect(cr.owned).toBeGreaterThan(0);
      const cb = run(PLO4_CBET_NUT_FD);
      expect(cb.rate).toBeGreaterThan(0.45);
      const { gs } = flopTurnState(PLO4_BARREL_WRAP);
      for (const a of run(PLO4_BARREL_WRAP).amounts) expect(a).toBeLessThanOrEqual(gs.pot + 1e-6);
    },
    TIMEOUT
  );

  it(
    "Dan's paired-board rule: a draw never semi-bluff raises a paired Omaha board",
    () => {
      const r = run(PLO4_PAIRED_CHECK_RAISE);
      expect(r.owned).toBe(0);
      const spot = baseSpot(PLO4_BARREL_WRAP);
      const paired = { ...spot, board: [c('T', H), c('7', C), c('2', S), c('7', D)] };
      const pUnpaired = probability(spot);
      const pPaired = probability(paired);
      expect(pPaired).toBeGreaterThan(0);
      expect(pPaired).toBeLessThanOrEqual(pUnpaired * 0.5 + 1e-9);
    },
    TIMEOUT
  );
});

describe('LAW: unqualified hands are not made to bluff', () => {
  it(
    'junk is untouched: no baseline bluff, and the same decisions as without the layer',
    () => {
      for (const spot of [NLH_BARREL_JUNK, PLO4_JUNK]) {
        const on = run(spot);
        const off = run(spot, { flopTurnBluffBaseline: false });
        expect(on.owned, spot.name).toBe(0);
        expect(on.actions, spot.name).toEqual(off.actions);
      }
    },
    TIMEOUT
  );

  it(
    'a four-way pot without a draw and an all-in opponent are never bluffed',
    () => {
      expect(run(NLH_FOUR_WAY_JUNK).rate).toBe(0);
      const allIn = run(NLH_OPP_ALL_IN);
      expect(allIn.owned).toBe(0);
    },
    TIMEOUT
  );

  it('showdown value, junk, a locked satellite seat and five-way pots are not qualified', () => {
    const middlePair = baseSpot({ ...NLH_BARREL_OESD, hole: [c('7', D), c('5', S)] });
    expect(flopTurnBluffEligibility(middlePair).reason).toBe('showdown_value');
    expect(flopTurnBluffEligibility(baseSpot(NLH_BARREL_JUNK)).reason).toBe('unqualified');
    expect(
      flopTurnBluffEligibility({ ...baseSpot(NLH_BARREL_OESD), satelliteLocked: true }).eligible
    ).toBe(false);
    expect(
      flopTurnBluffEligibility({
        ...baseSpot(NLH_BARREL_OESD),
        opponentIds: ['a', 'b', 'c', 'd'],
      }).reason
    ).toBe('multiway');
    // Three-handed, a hand without a draw is not a bluff.
    expect(
      flopTurnBluffEligibility({
        ...baseSpot(NLH_BARREL_OVERCARDS),
        opponentIds: ['opp3', 'opp5'],
      }).reason
    ).toBe('multiway');
  });

  it('the draw reader sees the draw the class-mean cell cannot', () => {
    const r = holdemDrawRead([c('9', S), c('8', D)], [c('T', H), c('7', C), c('2', S)]);
    expect(r.straightRanks).toBe(2);
    const fd = holdemDrawRead([c('Q', H), c('J', H)], [c('K', H), c('7', H), c('2', S)]);
    expect(fd.flushDraw).toBe(true);
    expect(fd.nutFlushDraw).toBe(false);
    const none = holdemDrawRead([c('6', C), c('4', D)], [c('K', H), c('Q', S), c('9', D)]);
    expect(none.flushDraw || none.straightRanks > 0 || none.overcards > 0).toBe(false);
  });
});

describe('LAW: reads reshape, tournaments scale, nothing switches it off', () => {
  it(
    'a station gets fewer semi-bluffs than an unknown, never zero',
    () => {
      const unknown = run(NLH_BARREL_OESD).rate;
      const station = run(NLH_BARREL_OESD, {}, () => seedOpponentRiverRead(3, 30)).rate;
      expect(station).toBeGreaterThan(0.1);
      expect(station).toBeLessThan(unknown);
    },
    TIMEOUT
  );

  it(
    'a tournament bubble still semi-bluffs, no more than cash',
    () => {
      const cash = run(NLH_BARREL_OESD).rate;
      const bubble = run(NLH_BUBBLE_OESD);
      expect(bubble.rate).toBeGreaterThan(0.2);
      expect(bubble.rate).toBeLessThanOrEqual(cash + 0.05);
      expect(bubble.owned).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

/** The pure spot the baseline reads, built from a fixture. */
function baseSpot(spot: FlopTurnSpot): FlopTurnBluffSpot {
  const { hero, gs } = flopTurnState(spot);
  const omaha = spot.variant !== 'nlh';
  const opps = gs.players.filter((p) => p.seat !== hero.seat && !p.is_folded);
  return {
    omaha,
    potLimit: omaha,
    hiLo: false,
    fixedLimit: false,
    shortDeck: false,
    multiBoard: false,
    bombPot: false,
    satelliteLocked: false,
    holeCount: hero.cards.length,
    hole: hero.cards,
    board: gs.communityCards,
    history: gs.actionHistory ?? [],
    heroId: hero.user_id,
    opponentIds: opps.map((o) => o.user_id),
    opponentsCanRespond: opps.every((o) => !o.is_all_in && o.stack > 0),
    equity: 0.3,
    category: 1,
    inPosition: spot.line === 'barrel' || spot.line === 'cbet' || spot.line === 'delayed',
    initiative: spot.line === 'probe' ? 'opp' : 'hero',
    omahaDraw: omaha
      ? {
          nutFlushDraw: false,
          dominatedFlushDraw: false,
          straightOuts: 13,
          nutStraightOuts: 13,
          bigWrap: true,
          nutLowDraw: false,
          nutty: true,
        }
      : null,
  };
}

function probability(spot: FlopTurnBluffSpot): number {
  return flopTurnBluffProbability({
    eligibility: flopTurnBluffEligibility(spot),
    omaha: spot.omaha,
    opponents: spot.opponentIds.length,
    inPosition: spot.inPosition,
    rangesFavorOpponent: false,
    rangeAdvantage: false,
    scareUnblocked: false,
    stackToPot: 5,
    reads: { station: false, foldToCbet: null, bluffMod: 1 },
    icmRisk: 0,
  });
}
