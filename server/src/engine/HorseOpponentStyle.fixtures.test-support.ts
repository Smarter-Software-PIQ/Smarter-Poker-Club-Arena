/** Shared rebuild of the 80 audit fixtures (DEVELOPMENT data) for the fixture test and its diagnosis. */
import { readFileSync } from 'node:fs';
import { HorseMind } from './HorseMind.js';
import { HERO, VILLAIN, cards, decide, install, type Spot, type Villain } from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';
import type { SeatPlayer } from '../types.js';

export interface Fx {
  id: string; category: string; format: 'cash' | 'tournament'; street: 'flop' | 'turn' | 'river'; board: string; heroCards: string;
  heroStrength: string; potAtDecisionBB: number; amountToCallBB: number; opponentActionType: 'bet' | 'raise';
  opponentChipsAddedBB: number; sizePotFraction: number; facedBetBeforeRaiseBB: number; heroBehindBeforeCallBB: number;
  opponentBehindAfterBetBB: number; heroAction: string;
  counters: { hands: number; vpipPct: number; pfrPct: number; threeBetOpportunities: number; threeBets: number; bigRiverBetsCalled: number; bigRiverBetsCalledWon: number; credibleSample: boolean };
}
export const FX: Fx[] = JSON.parse(readFileSync(new URL('./fixtures/horse-opponent-style-fixtures.json', import.meta.url), 'utf8')).fixtures;
const BB = 2;
const STREETS = ['flop', 'turn', 'river'] as const;
const FILL = [3, 4, 5, 6].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);

/** third: a third live player (FILL[0], seat 3) who called preflop, checked every street (on this one before the wager)
 *  and is still to act behind hero; the price hero faces is the fixture's own. */
export const THIRD = 'cccccccc-0000-4000-8000-000000000003';
export function spotOf(f: Fx, third = false): Spot {
  const heroBet = f.opponentActionType === 'raise' ? f.facedBetBeforeRaiseBB * BB : 0;
  const villainTotal = heroBet + f.amountToCallBB * BB;
  const seat = (s: number, id: string, stack: number, bet: number, c = ''): SeatPlayer =>
    ({ seat: s, user_id: id, username: `p${s}`, stack, bet, totalInvested: bet, cards: c ? cards(c) : [], is_folded: !c && id !== VILLAIN, is_all_in: id === VILLAIN && stack <= 0, is_sitting_out: false }) as unknown as SeatPlayer;
  const players = [
    seat(1, HERO, Math.max(BB, f.heroBehindBeforeCallBB * BB), heroBet, f.heroCards),
    seat(2, VILLAIN, Math.max(0, f.opponentBehindAfterBetBB * BB), villainTotal),
    ...FILL.map((id, i) => seat(i + 3, id, 200, 0)),
  ];
  if (third) players[2] = { ...players[2], stack: 400, bet: 0, totalInvested: 6, is_folded: false } as SeatPlayer;
  const T3 = (stage: string, action: string, amount: number) => (third ? [{ stage, seat: 3, userId: THIRD, action, amount }] : []);
  const acts: Array<Record<string, unknown>> = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6 },
    { stage: 'preflop', seat: 1, userId: HERO, action: 'call', amount: 4 },
    ...T3('preflop', 'call', 6),
  ];
  for (const st of STREETS) {
    if (st === f.street) {
      if (f.opponentActionType === 'raise') {
        acts.push({ stage: st, seat: 1, userId: HERO, action: 'bet', amount: heroBet });
        acts.push({ stage: st, seat: 2, userId: VILLAIN, action: 'raise', amount: villainTotal });
      } else {
        acts.push({ stage: st, seat: 1, userId: HERO, action: 'check', amount: 0 });
        acts.push(...T3(st, 'check', 0));
        acts.push({ stage: st, seat: 2, userId: VILLAIN, action: 'bet', amount: villainTotal });
      }
      break;
    }
    acts.push({ stage: st, seat: 1, userId: HERO, action: 'check', amount: 0 }, { stage: st, seat: 2, userId: VILLAIN, action: 'check', amount: 0 }, ...T3(st, 'check', 0));
  }
  const n = { flop: 6, turn: 8, river: 10 }[f.street];
  const gs = {
    players, communityCards: cards(f.board.slice(0, n)), pot: f.potAtDecisionBB * BB + (third ? 6 : 0), currentBet: villainTotal,
    minRaise: Math.max(BB, villainTotal - heroBet), stage: f.street, gameVariant: 'nlh', gameMode: f.format,
    ...(f.format === 'tournament' ? { tournament: { entrants: 100, playersLeft: 40, spotsPaid: 15, inMoney: true, nearBubble: false } } : {}),
    bigBlind: BB, smallBlind: 1, dealerSeat: 1, actionHistory: acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 })),
  };
  return { name: third ? `${f.id}_3way` : f.id, hero: players[0], gs };
}

export function villainOf(f: Fx, extraShownBluff = 0): Villain {
  const c = f.counters;
  const hands = Math.min(Math.max(c.hands, 0), 120);
  const k = c.hands > 0 ? hands / c.hands : 0;
  return {
    stats: { hands: c.hands, bigBetSD: c.bigRiverBetsCalled + extraShownBluff, bigBetSDStrong: c.bigRiverBetsCalledWon },
    counters: counters({ hands, vpip: c.vpipPct / 100, pfr: c.pfrPct / 100, threeBetOpp: c.threeBetOpportunities * k, threeBet: c.threeBets * k, fast: { hands: 0 } }),
    complete: true,
  };
}
export const supply = (mode: 'cash' | 'tournament') =>
  HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode, size: 'full', opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 } }]);
export const ON = { styleValueBettorNotManiac: true, styleBigBetHonesty: true, styleRaiseRespect: true, styleFoldBluff: true };
export const RANK: Record<string, number> = { fold: 0, check: 0, call: 1, raise: 2, bet: 2, all_in: 3 };
/**
 * Install a fixture's read on `who`, in its own format: the exploit counters, the post-release count and the IN-FORMAT
 * shown strength (H1: the fixture's called big river bets, all of half the pot or more, as that context's 'large'
 * size bucket). Lifetime tallies are installed too but, at carry-over weight 0, the style read does not use them.
 */
export function installFixture(f: Fx, who: string = VILLAIN): void {
  const v = villainOf(f);
  HorseMind.reset();
  HorseMind.importStats([{ user_id: who, ...v.stats }]);
  HorseMind.importDurableOpponentProfiles([{ user_id: who, variant: 'nlh', mode: f.format, size: 'full', observed_hands: 80, initialized: true, public_memory_domain: { version: 1, speed: 'table', ante: 'none' }, counters: v.counters } as never]);
  HorseMind.importPostReleaseObservations([{ user_id: who, variant: 'nlh', mode: f.format, size: 'full', opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 } }]);
  const n = f.counters.bigRiverBetsCalled;
  if (n > 0) HorseMind.importSizeBuckets([{ user_id: who, variant: 'nlh', mode: f.format, size: 'full', buckets: { large: { bets: n, shown: n, strong: f.counters.bigRiverBetsCalledWon } } }]);
}

export function run(f: Fx, opts: Record<string, unknown> = ON) {
  const spot = spotOf(f);
  installFixture(f);
  const off = decide(spot);
  installFixture(f);
  const on = decide(spot, opts);
  return { off, on };
}

