/**
 * omahaPreflopReraiseDefencePricedInPosition (THREEBET-2 lane 2026-11-19, default OFF): the in-position heads-up
 * scope of the priced preflop re-raise defence, on synthetic PLO5/PLO4 cash spots (synthetic cards, no recorded
 * player, no id of anyone).
 *
 *  - THE SPOT (omahaPreflopReraiseDefenceHeadsUpInPosition): the Horse opened, faces exactly one 3-bet, everyone
 *    else folded, and it acts after the 3-bettor on every later street. One seat-order definition on table cash and
 *    fast-table cash (the fast-table pricing keeps an older reading of position for multiway pots,
 *    HorseLogic.omahaReraisedLaneUntouched; heads-up the spot does not read it). Out of position, multiway, a 4-bet,
 *    a cold 3-bet, a tournament: not the spot.
 *  - THE DECISION: in the spot, with the option on, the decision is byte-identical to the one with
 *    omahaPreflopReraiseDefencePriced on (the same priced decision, the same receipts); a fold of the brain against a
 *    wide measured 3-bettor becomes the priced call. Out of the spot (out of position above all), on, unset and false
 *    are byte-identical to off, on table cash and fast-table cash alike; a tournament is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { replayProfiles } from './HorseComplaintReplay.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { omahaPreflopReraiseDefenceHeadsUpInPosition } from './HorseOmahaPreflopReraiseDefenceRule.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((t) => ({
    rank: (t[0] === 'T' ? '10' : t[0]) as CardRank,
    suit: SUIT[t[1]!]!,
  }));

const HERO = '86000001-0000-4000-8000-0000000000a1';
const VILLAIN = '40000000-0000-4000-8000-0000000000b2';
const OTHER = (n: number) => `4000000${n}-0000-4000-8000-0000000000c${n}`;

interface SpotOpts {
  variant?: 'plo4' | 'plo5';
  /** hero opens from here */
  heroSeat: number;
  /** the 3-bettor */
  raiserSeat: number;
  /** a third player who called the open and has not answered the 3-bet (multiway) */
  callerSeat?: number;
  /** the Horse did not open: this seat did, hero called cold-or-faces a cold 3-bet */
  openerSeat?: number;
  /** a 4-bet: hero opened, raiser 3-bet, hero 4-bet, raiser 5-bet */
  fourBet?: boolean;
  speed?: 'table' | 'lightning';
  tournament?: boolean;
}

/** Six-handed cash, blinds 1/2, dealer seat 6, hero opens to 7, one player 3-bets to 22. */
function spot(hole: string, o: SpotOpts): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const variant = o.variant ?? 'plo5';
  const opener = o.openerSeat ?? o.heroSeat;
  const bet: Record<number, number> = { 1: 1, 2: 2, 3: 0, 4: 0, 5: 0, 6: 0 };
  const hist: Array<Record<string, unknown>> = [];
  let t = 0;
  const act = (seat: number, action: string, amount: number) =>
    hist.push({
      stage: 'preflop',
      seat,
      userId: seat === o.heroSeat ? HERO : seat === o.raiserSeat ? VILLAIN : OTHER(seat),
      action,
      amount,
      ...(action === 'raise' ? { isFullRaise: true } : {}),
      timestamp: ++t,
    });
  act(1, 'sb', 1);
  act(2, 'bb', 2);
  const inHand = new Set([
    o.heroSeat,
    o.raiserSeat,
    opener,
    ...(o.callerSeat ? [o.callerSeat] : []),
  ]);
  for (const s of [3, 4, 5, 6, 1, 2]) {
    if (s === opener) {
      act(s, 'raise', 7);
      bet[s] = 7;
    } else if (s === o.callerSeat) {
      act(s, 'call', 7);
      bet[s] = 7;
    } else if (s === o.raiserSeat) {
      act(s, 'raise', 22);
      bet[s] = 22;
    } else if (s === o.heroSeat) {
      // the Horse did not open: it is asked cold after the 3-bet
    } else if (!inHand.has(s)) act(s, 'fold', 0);
  }
  let currentBet = 22;
  if (o.fourBet) {
    act(o.heroSeat, 'raise', 70);
    bet[o.heroSeat] = 70;
    act(o.raiserSeat, 'raise', 190);
    bet[o.raiserSeat] = 190;
    currentBet = 190;
  }
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: n === o.heroSeat ? HERO : n === o.raiserSeat ? VILLAIN : OTHER(n),
        username: `P${n}`,
        stack: 400 - bet[n]!,
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === o.heroSeat ? cards(hole) : [],
        is_folded: !inHand.has(n),
        is_all_in: false,
        is_sitting_out: false,
      }) as SeatPlayer
  );
  const heroBet = bet[o.heroSeat]!;
  const pot = Object.values(bet).reduce((a, b) => a + b, 0);
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    toCall: currentBet - heroBet,
    minRaise: 15,
    minRaiseTo: currentBet + 15,
    maxRaiseTo: currentBet + pot + (currentBet - heroBet),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 6,
    gameMode: o.tournament ? 'tournament' : 'cash',
    ...(o.tournament ? { tournamentId: 't-1' } : {}),
    publicMemoryDomain: { speed: o.speed ?? 'table' },
    actionHistory: hist,
  } as unknown as HorseGameStateV2;
  return { hero: players[o.heroSeat - 1]!, gs };
}

/** The button opens, the big blind 3-bets: the Horse acts after him on every later street. */
const IP: SpotOpts = { heroSeat: 6, raiserSeat: 2 };
/** The cutoff opens, the button 3-bets: the Horse acts before him on every later street. */
const OOP: SpotOpts = { heroSeat: 5, raiserSeat: 6 };

/** A wide measured 3-bettor (6 of 15 opportunities; never folds to a 3-bet). */
function wideRow(): ExploitCounters {
  const c = freshExploitCounters();
  Object.assign(c, {
    hands: 40,
    vpip: 30,
    pfr: 22,
    rfiOpp: 20,
    rfi: 16,
    threeBetOpp: 15,
    threeBet: 7,
    foldTo3BetOpp: 8,
    foldTo3Bet: 0,
  });
  return c;
}
function setRead(variant: string): void {
  HorseMind.reset();
  const map = (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> })
    .exploitCounters;
  for (const size of [2, 4, 6]) map.set(`${readScopeOf(variant, size)}|${VILLAIN}`, wideRow());
}

const PROFILE = replayProfiles('cash').find((p) => p.live)!;
const bytes = (d: unknown) =>
  JSON.stringify(withoutMeasurements(d), (k, v) => (k === 'thinkTime' ? 0 : v));

function decide(hole: string, o: SpotOpts, opts: Record<string, unknown>, seed: number) {
  const { hero, gs } = spot(hole, o);
  setRead(o.variant ?? 'plo5');
  drainFires();
  seedFastRandom(seed);
  const d = HorseLogic.decide(hero, gs, PROFILE.style, PROFILE.mods, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  // upgradeNN_*_seen receipts fire once per process (the first decision that reaches them), so they
  // follow test order, not the decision: left out of the comparison.
  const fires = drainFires()
    .map((f) => f.feature)
    .filter((f) => !/^upgrade\d+_.*_seen$/.test(f))
    .sort();
  return { d, fires, key: bytes(d) + '|' + fires.join(',') };
}

/** Synthetic five-card hands across the strength range (no recorded holding). */
const HANDS5 = [
  'KhQh9c8c3d',
  'JsTs9h7h2c',
  'AdJc8s7d4h',
  'QcJd9d8s5c',
  'Th9h8c6c2s',
  'KsJs7h6h3c',
  'AhTd9s5c4h',
  'QsQd8h7c2d',
  '9c8d7h6s4c',
  'KdTc8h6s5d',
  'JhTh8d7d3s',
  'AsKd6c5h2h',
];
const HANDS4 = ['KhQh9c8c', 'JsTs9h7h', 'AdJc8s7d', 'QsQd8h7c', '9c8d7h6s', 'KdTc8h6s'];
const SEEDS = [1, 42];
const RDP_ON = { omahaPreflopReraiseDefencePriced: true };
const IN_POS_ON = { omahaPreflopReraiseDefencePricedInPosition: true };

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('the spot: opener, one 3-bet, heads-up, acts after the 3-bettor', () => {
  it('in position heads-up is the spot; out of position is not', () => {
    const a = spot('KhQh9c8c3d', IP);
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(a.hero, a.gs)).toBe(true);
    const b = spot('KhQh9c8c3d', OOP);
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(b.hero, b.gs)).toBe(false);
    // the small blind 3-bets the button: in position again
    const c = spot('KhQh9c8c3d', { heroSeat: 6, raiserSeat: 1 });
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(c.hero, c.gs)).toBe(true);
    // the small blind opens (the Horse), the big blind 3-bets: out of position
    const d = spot('KhQh9c8c3d', { heroSeat: 1, raiserSeat: 2 });
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(d.hero, d.gs)).toBe(false);
  });

  it('one definition on table cash and fast-table cash; a tournament is never the spot', () => {
    for (const o of [IP, OOP, { heroSeat: 6, raiserSeat: 1 }, { heroSeat: 1, raiserSeat: 2 }]) {
      const table = spot('KhQh9c8c3d', { ...o, speed: 'table' });
      const fast = spot('KhQh9c8c3d', { ...o, speed: 'lightning' });
      expect(omahaPreflopReraiseDefenceHeadsUpInPosition(fast.hero, fast.gs)).toBe(
        omahaPreflopReraiseDefenceHeadsUpInPosition(table.hero, table.gs)
      );
      const t = spot('KhQh9c8c3d', { ...o, tournament: true });
      expect(omahaPreflopReraiseDefenceHeadsUpInPosition(t.hero, t.gs)).toBe(false);
    }
  });

  it('multiway, a 4-bet, a cold 3-bet, PLO6, the flop: not the spot', () => {
    const multi = spot('KhQh9c8c3d', { ...IP, callerSeat: 1 });
    // the small blind called the open and has not answered the 3-bet: still in the hand
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(multi.hero, multi.gs)).toBe(false);
    const four = spot('KhQh9c8c3d', { ...IP, fourBet: true });
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(four.hero, four.gs)).toBe(false);
    const cold = spot('KhQh9c8c3d', { heroSeat: 6, raiserSeat: 2, openerSeat: 4 });
    expect(omahaPreflopReraiseDefenceHeadsUpInPosition(cold.hero, cold.gs)).toBe(false);
    const a = spot('KhQh9c8c3d', IP);
    expect(
      omahaPreflopReraiseDefenceHeadsUpInPosition(a.hero, { ...a.gs, gameVariant: 'plo6' } as never)
    ).toBe(false);
    expect(
      omahaPreflopReraiseDefenceHeadsUpInPosition(a.hero, { ...a.gs, stage: 'flop' } as never)
    ).toBe(false);
  });
});

describe('the decision', () => {
  enableBrainTelemetry();

  for (const speed of ['table', 'lightning'] as const) {
    const label = speed === 'table' ? 'table cash' : 'fast-table cash';

    it(`${label}, in position heads-up: on is byte-identical to the priced option, and it changes folds`, () => {
      let changedFoldToContinue = 0;
      let foldsOff = 0;
      for (const [variant, hands] of [
        ['plo5', HANDS5],
        ['plo4', HANDS4],
      ] as const)
        for (const hole of hands)
          for (const seed of SEEDS) {
            const o = { ...IP, variant, speed };
            const off = decide(hole, o, {}, seed);
            const rdp = decide(hole, o, RDP_ON, seed);
            const on = decide(hole, o, IN_POS_ON, seed);
            expect(on.key).toBe(rdp.key);
            if (off.d.action === 'fold') {
              foldsOff++;
              if (on.d.action !== 'fold') changedFoldToContinue++;
            }
          }
      expect(foldsOff).toBeGreaterThan(0);
      expect(changedFoldToContinue).toBeGreaterThan(0);
    });

    it(`${label}, out of position: on, unset and false are byte-identical to off (where the priced option would change it)`, () => {
      let pricedWouldChange = 0;
      for (const [variant, hands] of [
        ['plo5', HANDS5],
        ['plo4', HANDS4],
      ] as const)
        for (const hole of hands)
          for (const seed of SEEDS) {
            const o = { ...OOP, variant, speed };
            const off = decide(
              hole,
              o,
              { omahaPreflopReraiseDefencePricedInPosition: false },
              seed
            );
            expect(decide(hole, o, {}, seed).key).toBe(off.key);
            expect(decide(hole, o, IN_POS_ON, seed).key).toBe(off.key);
            if (decide(hole, o, RDP_ON, seed).d.action !== off.d.action) pricedWouldChange++;
            // the small blind opener against the big blind: out of position too
            const sb = { heroSeat: 1, raiserSeat: 2, variant, speed };
            expect(decide(hole, sb, IN_POS_ON, seed).key).toBe(decide(hole, sb, {}, seed).key);
          }
      // not vacuous: the priced option itself changes some of these out-of-position decisions
      expect(pricedWouldChange).toBeGreaterThan(0);
    });

    it(`${label}, multiway and a 4-bet: on is byte-identical to off`, () => {
      for (const hole of HANDS5.slice(0, 6))
        for (const seed of SEEDS)
          for (const o of [
            { ...IP, callerSeat: 1, speed },
            { ...IP, fourBet: true, speed },
          ]) {
            expect(decide(hole, o, IN_POS_ON, seed).key).toBe(decide(hole, o, {}, seed).key);
          }
    });
  }

  it('a tournament in position heads-up: on is byte-identical to off', () => {
    for (const hole of HANDS5)
      for (const seed of SEEDS) {
        const o = { ...IP, tournament: true };
        expect(decide(hole, o, IN_POS_ON, seed).key).toBe(decide(hole, o, {}, seed).key);
      }
  });
});
