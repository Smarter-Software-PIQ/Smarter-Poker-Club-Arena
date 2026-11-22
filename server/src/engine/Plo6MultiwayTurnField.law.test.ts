/**
 * LAW (E8 — PLO6 Multiway Turn Caller Field-Factor, 2026-11-20, PLO6 lane;
 * wired under plo6FacingBetIsPriced, default OFF, read `=== true`):
 *
 * Replaces `HorseOmahaFacingBetEv`'s static 4-card turn `field` multiplier
 * (`heroNow` without river cards + un-translated 4-card `behind = 0.25`) on
 * multiway PLO6 cash turns (`callers + allIns + behind > 0`) with a
 * deterministic six-card joint river-runout evaluator
 * (`HorsePlo6MultiwayTurnField.plo6MultiwayTurnVerdict`):
 *
 *   1. Improving multiway turn hands (nut flush draw + wrap / set with nut
 *      redraws) facing a bet and a caller are scored across ALL `m` unseen
 *      river cards on disjoint six-card holdings rather than zeroed out by
 *      their static 4-card turn score (`heroNow < callerBar` -> `pWin = 0` in
 *      `omahaFacingBetEvVerdict`).
 *   2. Dead non-improving underboats / weak two-pair hands facing multiway
 *      action (`callers` or `behind` players continuing with six-card
 *      strength-translated ranges across all river cards) fold instead of
 *      calling on the weak `1 - 0.25 * (1 - holds)` four-card factor.
 *   3. Recorded multiway turn spot #59973455 (trips + KK full-house redraws)
 *      and heads-up turn spot #60040999 fold off and call on at every seed,
 *      passing `horseDecisionReceiptRefusal`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HorseLogic, plo6FacingBetPricedVerdictOf, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  OMAHA_EV_CALLER_SHARE,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import { plo6MultiwayTurnJoint, plo6MultiwayTurnVerdict } from './HorsePlo6MultiwayTurnField.js';
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

function syntheticMultiwayTurn(opts: {
  hole: string;
  board: string;
  pot: number;
  wager: number;
  heroStack: number;
  oppStack: number;
  callers: number;
  behind: number;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero: SeatPlayer = {
    seat: 2,
    user_id: '00000000-0000-4000-8000-000000000002',
    name: 'hero',
    stack: opts.heroStack,
    bet: 0,
    totalInvested: 10,
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
      stack: opts.oppStack,
      bet: opts.wager,
      totalInvested: 10 + opts.wager,
      cards: [],
      is_folded: false,
      is_all_in: opts.oppStack <= 0.005,
      is_sitting_out: false,
    } as unknown as SeatPlayer,
    hero,
  ];

  const history: NonNullable<HorseGameStateV2['actionHistory']> = [
    { userId: 'u1', seat: 1, stage: 'preflop', action: 'call', amount: 2, timestamp: 1 },
    { userId: 'u2', seat: 2, stage: 'preflop', action: 'check', amount: 0, timestamp: 2 },
    { userId: 'u1', seat: 1, stage: 'turn', action: 'bet', amount: opts.wager, timestamp: 3 },
  ];

  let nextSeat = 3;
  for (let i = 0; i < opts.callers; i++) {
    const s = nextSeat++;
    players.push({
      seat: s,
      user_id: `00000000-0000-4000-8000-00000000000${s}`,
      name: `caller${i}`,
      stack: opts.oppStack,
      bet: opts.wager,
      totalInvested: 10 + opts.wager,
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
      stage: 'turn',
      action: 'call',
      amount: opts.wager,
      timestamp: 4,
    });
  }
  for (let i = 0; i < opts.behind; i++) {
    const s = nextSeat++;
    players.push({
      seat: s,
      user_id: `00000000-0000-4000-8000-00000000000${s}`,
      name: `behind${i}`,
      stack: opts.oppStack,
      bet: 0,
      totalInvested: 10,
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
    stage: 'turn',
    boardCount: 1,
    bombPot: false,
    allInOrFold: false,
    wagersCapped: false,
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 2,
    pot: opts.pot + opts.wager * (1 + opts.callers),
    currentBet: opts.wager,
    toCall: Math.min(opts.wager, opts.heroStack),
    minRaiseTo: opts.wager * 2,
    maxRaiseTo: opts.pot + opts.wager * (2 + opts.callers),
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

describe('LAW (E8): PLO6 multiway turn field evaluator walks disjoint six-card river runouts instead of static turn board scores', () => {
  it('rescues a high-card monster nut-flush + wrap combo draw facing a turn bet + call that static turn field pricing zeroes out', () => {
    // Board Ks 9s 8d 2c: hero holds As Qs Js Td 7h 6c (nut spade flush draw + QJT76 monster wrap, currently high-card Ace!).
    // Facing a small 8-chip bet + 1 caller into a 40-chip pot (pot=56, toCall=8, price=12.5%):
    // Static 4-card turn `counted.top(0.45)` scores `heroNow` as Ace-high -> `field = 0` -> `pWin = 0` -> FOLD!
    // Joint river-runout E8 walks all 42 river cards on disjoint 6-card hands -> ~40% multiway river equity -> CALL!
    const { hero, gs } = syntheticMultiwayTurn({
      hole: 'As Qs Js Td 7h 6c',
      board: 'Ks 9s 8d 2c',
      pot: 40,
      wager: 8,
      heroStack: 150,
      oppStack: 150,
      callers: 1,
      behind: 0,
    });

    const spot = omahaFacingBetEvSpot(hero, gs, { plo6Priced: true })!;
    const brokenStatic = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], null, {
      rake: 0,
      realization: 0.92,
      sixCardTurn: true,
      plo6RiverNuts: false,
      plo6RiverUnpaired: false,
    })!;
    expect(brokenStatic.field).toBe(0);
    expect(brokenStatic.pWin).toBe(0);
    expect(brokenStatic.call).toBe(false);

    const e8 = plo6MultiwayTurnVerdict(hero, gs, { rake: 0, inPosition: true });
    expect(e8).not.toBeNull();
    expect(e8!.klass).toBe('nut_combo_draw');
    expect(e8!.callerShareSix).toBeLessThan(OMAHA_EV_CALLER_SHARE.turn);
    expect(e8!.equity).toBeGreaterThan(0.3);
    expect(e8!.call).toBe(true);

    const wired = plo6FacingBetPricedVerdictOf(hero, gs);
    expect(wired).not.toBeNull();
    expect(wired!.callPriced).toBe(true);
    expect(wired!.action).toBe('call');
  });

  it('folds a dominated bottom underboat on a trips turn board with players behind (d7806 #60070472: 33 on 8666) that static behind=0.25 over-called', () => {
    // Board 8s 6c 6d 6h: hero holds 3c 3d Kh Qs Jd 9c (6s full of 3s — crushed by 8x, any pocket pair > 33, or quads 6).
    const { hero, gs } = syntheticMultiwayTurn({
      hole: '3c 3d Kh Qs Jd 9c',
      board: '8s 6c 6d 6h',
      pot: 30,
      wager: 18,
      heroStack: 140,
      oppStack: 140,
      callers: 0,
      behind: 2,
    });
    const joint = plo6MultiwayTurnJoint(hero.cards, gs.communityCards, [], 0.5, [], 2, 0.65);
    expect(joint).not.toBeNull();
    expect(joint!.rivers).toBe(42);

    const e8 = plo6MultiwayTurnVerdict(hero, gs, { rake: 0, inPosition: false });
    expect(e8).not.toBeNull();
    expect(e8!.call).toBe(false);
    expect(plo6FacingBetPricedVerdictOf(hero, gs)!.action).toBe('fold');
  });

  it('calls recorded multiway turn spot #59973455 (trips + KK boat redraws) and heads-up turn spot #60040999 at every seed and passes receipt validation', () => {
    for (const hn of [59973455, 60040999]) {
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
