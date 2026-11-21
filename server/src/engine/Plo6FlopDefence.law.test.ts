/**
 * LAW (E6 — PLO6 Flop Defence, 2026-11-20, PLO6 lane; wired under
 * plo6FacingBetIsPriced, default OFF, read `=== true`):
 *
 * 1. Heads-up facing the first flop bet with chips behind, a PLO6 cash call is
 *    priced as the two-street barrel tree (`HorsePlo6FlopDefence` ->
 *    `omahaFlopDefenceTreeEv`, `PLO6_FLOP_DEFENCE_TREE_INPUTS`) on the hand's
 *    sampled six-card runouts rather than flat `equity x realization`:
 *      - A vulnerable bare one-pair flop hand whose flat one-street realization
 *        looks marginally positive folds inside the two-street tree because it
 *        cannot stand a 0.73-pot turn barrel across non-improving turns.
 *      - Strong made hands and overpairs with nut redraws (#60060560 flop trips,
 *        #60093920 paired-flop trips, #60067736 nut flush + straight + AA all-in)
 *        call on every seed and pass `horseDecisionReceiptRefusal`.
 * 2. Multiway on the flop (`callers + allIns + behind > 0`), each caller,
 *    all-in, and continuing player behind has its range share translated from
 *    four-card holdings to six-card holdings at the same flop strength
 *    (`plo6ValueShareAtSameStrength`), preventing bare one-pair hands from
 *    over-calling multiway against underestimated four-card shares.
 * 3. Removal-sensitive: removing either the heads-up two-street tree or the
 *    six-card multiway caller-share translation fails this law test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HorseLogic, plo6FacingBetPricedVerdictOf, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { plo6FlopDefenceVerdict } from './HorsePlo6FlopDefence.js';
import {
  OMAHA_FLOP_EV_CALLER_SHARE,
  omahaFlopFacingBetEvSpot,
  omahaFlopFacingBetEvVerdict,
} from './HorseOmahaFlopFacingBetEv.js';
import {
  actionKind,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Plo6FacingBetIsPriced.fixture.json'),
    'utf8'
  )
) as { hands: { hand: ExtractedHand; ords: number[]; ids: Record<string, string> }[] };

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42];
const ON: HorseDecideOpts = { plo6FacingBetIsPriced: true };

const card = (s: string): Card => {
  const map: Record<string, Card['suit']> = {
    c: 'clubs',
    d: 'diamonds',
    h: 'hearts',
    s: 'spades',
  };
  return { rank: s[0] as Card['rank'], suit: map[s[1]]! };
};
const cards = (spec: string): Card[] => spec.trim().split(/\s+/).map(card);

function byHand(handNumber: number): { hand: ExtractedHand; node: ComplaintAction } {
  const entry = FIXTURE.hands.find(
    (h) => Number((h.hand as unknown as { handNumber: number }).handNumber) === handNumber
  );
  if (!entry) throw new Error(`missing fixture hand ${handNumber}`);
  const ord = entry.ords[0]!;
  const node = entry.hand.actions.find((a) => (a as unknown as { ord: number }).ord === ord)!;
  return { hand: entry.hand, node };
}

function syntheticFlopState(opts: {
  hole: string;
  board: string;
  pot: number;
  wager: number;
  heroStack: number;
  bettorStack: number;
  callers?: number;
  behind?: number;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const callers = opts.callers ?? 0;
  const behind = opts.behind ?? 0;
  const hero: SeatPlayer = {
    seat: 2,
    user_id: '00000000-0000-4000-8000-000000000002',
    name: 'hero',
    stack: opts.heroStack,
    bet: 0,
    totalInvested: 2,
    cards: cards(opts.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as unknown as SeatPlayer;

  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: '00000000-0000-4000-8000-000000000001',
      name: 'bettor',
      stack: opts.bettorStack,
      bet: opts.wager,
      totalInvested: 2 + opts.wager,
      cards: [],
      is_folded: false,
      is_all_in: opts.bettorStack <= 0.005,
      is_sitting_out: false,
    } as unknown as SeatPlayer,
    hero,
  ];

  const history: NonNullable<HorseGameStateV2['actionHistory']> = [
    { userId: 'u1', seat: 1, stage: 'preflop', action: 'call', amount: 2, timestamp: 1 },
    { userId: 'u2', seat: 2, stage: 'preflop', action: 'check', amount: 0, timestamp: 2 },
    { userId: 'u1', seat: 1, stage: 'flop', action: 'bet', amount: opts.wager, timestamp: 3 },
  ];

  let nextSeat = 3;
  for (let i = 0; i < callers; i++) {
    const s = nextSeat++;
    players.push({
      seat: s,
      user_id: `00000000-0000-4000-8000-00000000000${s}`,
      name: `caller${i}`,
      stack: opts.bettorStack,
      bet: opts.wager,
      totalInvested: 2 + opts.wager,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer);
    history.splice(1, 0, {
      userId: `u${s}`,
      seat: s,
      stage: 'preflop',
      action: 'call',
      amount: 2,
      timestamp: 1,
    });
    history.push({
      userId: `u${s}`,
      seat: s,
      stage: 'flop',
      action: 'call',
      amount: opts.wager,
      timestamp: 4,
    });
  }
  for (let i = 0; i < behind; i++) {
    const s = nextSeat++;
    players.push({
      seat: s,
      user_id: `00000000-0000-4000-8000-00000000000${s}`,
      name: `behind${i}`,
      stack: opts.bettorStack,
      bet: 0,
      totalInvested: 2,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer);
    history.splice(1, 0, {
      userId: `u${s}`,
      seat: s,
      stage: 'preflop',
      action: 'call',
      amount: 2,
      timestamp: 1,
    });
  }

  const gs: HorseGameStateV2 = {
    gameVariant: 'plo6',
    gameMode: 'cash',
    bettingStructure: 'pot_limit',
    stage: 'flop',
    boardCount: 1,
    bombPot: false,
    allInOrFold: false,
    wagersCapped: false,
    rakeConfig: { percent: 0, cap: 0 },
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2,
    pot: opts.pot + opts.wager * (1 + callers),
    currentBet: opts.wager,
    toCall: Math.min(opts.wager, opts.heroStack),
    minRaiseTo: opts.wager * 2,
    maxRaiseTo: opts.pot + opts.wager * (2 + callers),
    communityCards: cards(opts.board),
    players,
    legalActions:
      opts.heroStack <= opts.wager ? ['fold', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
    actionHistory: history,
  } as unknown as HorseGameStateV2;

  return { hero, gs };
}

afterEach(() => {
  HorseMind.reset();
});

describe('LAW (E6): PLO6 flop defence prices the two-street tree heads-up and translates six-card caller strength multiway', () => {
  it('heads-up first flop bet with stacks behind attaches the fitted two-street defence tree and requires clearing both fitted realization and the barrel tree', () => {
    // Recorded spot #59973046 (d2790): short-SPR overpair KK on Qc 2h 3h (`stack = 66.2`, `toCall = 31`, `pot = 170.5`, `left = 35.2`):
    // Fitted two-street barrel tree (`fittedTreeEv`) sits strictly below flat `omahaFlopFacingBetEvVerdict`!
    const shortSpr = syntheticFlopState({
      hole: 'Jc 9d 8d Ks 5c Kd',
      board: 'Qc 2h 3h',
      pot: 139.5,
      wager: 31,
      heroStack: 66.2,
      bettorStack: 200,
    });
    const e6Short = plo6FlopDefenceVerdict(shortSpr.hero, shortSpr.gs, {
      rake: 0,
      inPosition: true,
    })!;
    const rawShort = omahaFlopFacingBetEvVerdict(
      omahaFlopFacingBetEvSpot(shortSpr.hero, shortSpr.gs, { plo6Priced: true })!,
      shortSpr.hero.cards,
      shortSpr.gs.communityCards,
      [],
      null,
      { rake: 0, inPosition: true, sixCards: true }
    )!;
    expect(rawShort.tree).toBeUndefined();
    expect(e6Short.tree).not.toBeNull();
    expect(e6Short.tree!.turnCards).toBeGreaterThanOrEqual(40);
    expect(e6Short.ev).toBeLessThan(rawShort.ev);

    // Conversely, on a deep bare one-pair hand (`2c 7s Qs 4h Kd 3s` on `9c Kc 8s`, OOP), fitted `pair` realization
    // (`0.518 OOP`) caps static-bucket tree optimism via `Math.min(fittedEv, fittedTreeEv)` and folds!
    const { hero, gs } = syntheticFlopState({
      hole: '2c 7s Qs 4h Kd 3s',
      board: '9c Kc 8s',
      pot: 18,
      wager: 18,
      heroStack: 180,
      bettorStack: 180,
    });
    const e6Pair = plo6FlopDefenceVerdict(hero, gs, { rake: 0, inPosition: false })!;
    expect(e6Pair.tree).not.toBeNull();
    expect(e6Pair.ev).toBeLessThan(e6Pair.tree!.ev);
    expect(e6Pair.call).toBe(false);

    // And plo6FacingBetPricedVerdictOf returns the exact E6 verdict (rake=0).
    const wired = plo6FacingBetPricedVerdictOf(shortSpr.hero, shortSpr.gs);
    expect(wired).not.toBeNull();
    expect(wired!.evCall).toBeCloseTo(e6Short.ev, 9);
  });

  it('multiway flop concentrates caller and behind shares by 6/15 and classifies non-nut flush draws as pair realization', () => {
    // Multiway flop with a caller and a player behind: six-card caller concentration (0.55 * 6/15 = 0.22) is tighter than the 4-card 0.55 share.
    const { hero, gs } = syntheticFlopState({
      hole: '2c As Kh Qd 8s 3h',
      board: '9d 8h 4d',
      pot: 16,
      wager: 12,
      heroStack: 150,
      bettorStack: 150,
      callers: 1,
      behind: 1,
    });
    const e6 = plo6FlopDefenceVerdict(hero, gs, { rake: 0, inPosition: false });
    expect(e6).not.toBeNull();
    expect(e6!.klass).toBe('pair');
    expect(e6!.callerShareSix).toBeLessThan(OMAHA_FLOP_EV_CALLER_SHARE);
    expect(e6!.tree).toBeNull(); // multiway uses the joint six-card field, never the HU tree
    expect(e6!.call).toBe(false);

    // Recorded multiway trap d1672 (#59964962): 4-way flop 3c 8c Th, hero holds 9c 6d Qh 4c 2s Ts (non-nut 9-high club flush draw + top pair T).
    // Un-repaired 4-card `omahaFlopFacingBetEvVerdict` classifies 9c4c as `'draw'` (`1.027 OOP` realization) and calls (`E = 0.215 < price = 0.333`),
    // while E6 requires nut-quality multiway draw (`hasNutQualityMultiwayDraw`), classifies as `'pair'`, and folds!
    const nonNutFdMw = syntheticFlopState({
      hole: '9c 6d Qh 4c 2s Ts',
      board: '3c 8c Th',
      pot: 39,
      wager: 15,
      heroStack: 150,
      bettorStack: 150,
      callers: 1,
      behind: 1,
    });
    const rawMw = omahaFlopFacingBetEvVerdict(
      omahaFlopFacingBetEvSpot(nonNutFdMw.hero, nonNutFdMw.gs, { plo6Priced: true })!,
      nonNutFdMw.hero.cards,
      nonNutFdMw.gs.communityCards,
      [],
      null,
      { rake: 0, inPosition: false, sixCards: true }
    )!;
    expect(rawMw.klass).toBe('draw');
    expect(rawMw.call).toBe(true);

    const e6Mw = plo6FlopDefenceVerdict(nonNutFdMw.hero, nonNutFdMw.gs, {
      rake: 0,
      inPosition: false,
    })!;
    expect(e6Mw.klass).toBe('pair');
    expect(e6Mw.call).toBe(false);
  });

  it('calls recorded profitable PLO6 flop spots (#60060560 trips, #60093920 paired-flop trips, #60067736 AA+NFD+GS all-in) and passes receipt validation', () => {
    for (const hn of [60060560, 60093920, 60067736]) {
      const { hand, node } = byHand(hn);
      for (const seed of SEEDS) {
        seedFastRandom(seed);
        HorseMind.reset();
        const stOff = stateAt(hand, node);
        const off = HorseLogic.decide(stOff.hero, stOff.gs, LIVE.style, LIVE.mods, {
          mind: false,
        });
        expect(actionKind(off.action, off.amount, stOff.pn)).toBe('fold');

        seedFastRandom(seed);
        HorseMind.reset();
        const stOn = stateAt(hand, node);
        const on = HorseLogic.decide(stOn.hero, stOn.gs, LIVE.style, LIVE.mods, {
          mind: false,
          ...ON,
        });
        expect(actionKind(on.action, on.amount, stOn.pn)).toBe('call');
        expect(
          horseDecisionReceiptRefusal(structuredClone(on), 'plo6', {
            player: stOn.hero,
            gameState: stOn.gs,
            plo6FacingBetIsPriced: true,
          })
        ).toBeNull();
      }
    }
  });
});
