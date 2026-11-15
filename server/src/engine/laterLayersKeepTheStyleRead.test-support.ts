/**
 * LATER LAYERS KEEP THE STYLE READ (2026-11-15): fixed hold'em spots and
 * synthetic villains for the regressions that pin how the opponent-style
 * options survive the decision layers that run after them. Synthetic inputs
 * only; no real player data. Built on the shared style contexts
 * (HorseOpponentStyle.contexts.test-support.ts) so every decision goes
 * through HorseLogic.decide exactly as those pinned contexts do.
 *
 * `pin` is the byte-level identity of a decision: the exact-replay identity
 * (HorseDecisionReplay.stableReceipt: every field, keys sorted, wall-clock
 * timings dropped) less the journal-only preflop read receipt, plus the random
 * stream position after the decision. The option-off arms of these tests
 * compare it against values captured on the commit before the change.
 */
import { createHash } from 'node:crypto';
import { HorseMind } from './HorseMind.js';
import { saveFastRandom } from './HorseEval.js';
import {
  cards,
  decide,
  HERO,
  VILLAIN,
  type Decided,
  type Spot,
  type Villain,
} from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';
import { stableReceipt } from './horseDecision/replay/HorseDecisionReplay.js';
import type { HorseDecision, SeatPlayer } from '../types.js';

export { HERO, VILLAIN };
export const FILL = [3, 4, 5, 6].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);

/** Post-release opportunities so a cash row counts as repaired memory. */
export const supply = (m = 120, size: 'hu' | 'short' | 'full' = 'full'): void => {
  for (const mode of ['cash', 'tournament'] as const)
    HorseMind.importPostReleaseObservations([
      {
        user_id: VILLAIN,
        variant: 'nlh',
        mode,
        size,
        opportunities: { foldToBet: m, riverCall: m, foldTo3Bet: m, betCheckedTo: m },
      },
    ]);
};

interface S {
  seat: number;
  id: string;
  stack: number;
  bet: number;
  invested: number;
  cards?: string;
  folded?: boolean;
  allIn?: boolean;
}
interface A {
  stage: string;
  seat: number;
  userId: string;
  action: string;
  amount: number;
  isFullRaise?: boolean;
}
function build(
  name: string,
  heroSeat: number,
  o: {
    stage: string;
    pot: number;
    currentBet: number;
    minRaise: number;
    dealerSeat: number;
    seats: S[];
    acts: A[];
    extra?: Record<string, unknown>;
  }
): Spot {
  const players = o.seats.map(
    (s) =>
      ({
        seat: s.seat,
        user_id: s.id,
        username: `p${s.seat}`,
        stack: s.stack,
        bet: s.bet,
        totalInvested: s.invested,
        cards: s.cards ? cards(s.cards) : [],
        is_folded: s.folded === true,
        is_all_in: s.allIn === true,
        is_sitting_out: false,
      }) as unknown as SeatPlayer
  );
  const gs: Record<string, unknown> = {
    players,
    communityCards: [],
    pot: o.pot,
    currentBet: o.currentBet,
    minRaise: o.minRaise,
    stage: o.stage,
    gameVariant: 'nlh',
    gameMode: 'cash',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: o.dealerSeat,
    actionHistory: o.acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 })),
    ...(o.extra ?? {}),
  };
  return { name, hero: players.find((p) => p.seat === heroSeat)!, gs };
}

/** Cash, 6 seats, blinds 1/2. Villain under the gun (seat 3) opens to 6; seats before hero fold; hero at heroSeat. */
export const openSpot = (
  heroSeat: number,
  h: string,
  extra: Record<string, unknown> = {},
  stack = 200
): Spot => {
  const ids: Record<number, string> = {};
  let f = 0;
  for (const s of [1, 2, 4, 5, 6]) ids[s] = s === heroSeat ? HERO : FILL[f++];
  const order = [4, 5, 6, 1, 2];
  const before = order.slice(0, order.indexOf(heroSeat));
  const blind = (s: number) => (s === 1 ? 1 : s === 2 ? 2 : 0);
  const seats: S[] = [1, 2, 3, 4, 5, 6].map((s) =>
    s === 3
      ? { seat: 3, id: VILLAIN, stack: stack - 6, bet: 6, invested: 6 }
      : {
          seat: s,
          id: ids[s],
          stack: stack - blind(s),
          bet: blind(s),
          invested: blind(s),
          folded: before.includes(s),
          ...(s === heroSeat ? { cards: h } : {}),
        }
  );
  const acts: A[] = [
    { stage: 'preflop', seat: 3, userId: VILLAIN, action: 'raise', amount: 6 },
    ...before.map((s) => ({
      stage: 'preflop',
      seat: s,
      userId: ids[s],
      action: 'fold',
      amount: 0,
    })),
  ];
  return build(`open_seat${heroSeat}_${h}`, heroSeat, {
    stage: 'preflop',
    pot: 9,
    currentBet: 6,
    minRaise: 4,
    dealerSeat: 6,
    seats,
    acts,
    extra,
  });
};

/** Cash, 6 seats, 100bb. Hero under the gun (seat 3) limped 2; seats 4, 5 fold; villain on the button iso-raises to 8; blinds fold. */
export const limpIsoSpot = (h: string, isoTo = 8, stack = 200): Spot => {
  const seats: S[] = [
    { seat: 1, id: FILL[0], stack: stack - 1, bet: 1, invested: 1, folded: true },
    { seat: 2, id: FILL[1], stack: stack - 2, bet: 2, invested: 2, folded: true },
    { seat: 3, id: HERO, stack: stack - 2, bet: 2, invested: 2, cards: h },
    { seat: 4, id: FILL[2], stack, bet: 0, invested: 0, folded: true },
    { seat: 5, id: FILL[3], stack, bet: 0, invested: 0, folded: true },
    { seat: 6, id: VILLAIN, stack: stack - isoTo, bet: isoTo, invested: isoTo },
  ];
  const acts: A[] = [
    { stage: 'preflop', seat: 3, userId: HERO, action: 'call', amount: 2 },
    { stage: 'preflop', seat: 4, userId: FILL[2], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 5, userId: FILL[3], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 6, userId: VILLAIN, action: 'raise', amount: isoTo },
    { stage: 'preflop', seat: 1, userId: FILL[0], action: 'fold', amount: 0 },
    { stage: 'preflop', seat: 2, userId: FILL[1], action: 'fold', amount: 0 },
  ];
  return build(`limp_iso_${h}_${isoTo}_${stack}`, 3, {
    stage: 'preflop',
    pot: 3 + 2 + isoTo,
    currentBet: isoTo,
    minRaise: isoTo - 2,
    dealerSeat: 6,
    seats,
    acts,
  });
};

/** Folds rivers (river call 3/30), bets for value: big bets shown 10, 9 strong; in-format large bucket 10 shown, 9 strong. */
export const riverFolderWhoBetsValue = (): Villain => {
  const c = counters({
    hands: 80,
    vpip: 0.2,
    pfr: 0.12,
    threeBetOpp: 20,
    threeBet: 1,
    betCheckedToOpp: 40,
    betCheckedTo: 12,
    foldToBetOpp: 30,
    foldToBet: 14,
  });
  c.riverCallOpp = 30;
  c.riverCall = 3;
  return {
    stats: {
      hands: 400,
      postAggr: 80,
      postPassive: 100,
      bigBetSD: 10,
      bigBetSDStrong: 9,
      rAggr: 3,
      rPassive: 6,
    },
    counters: c,
    complete: true,
  };
};
/** Same river folder whose big bets showed down as bluffs (2 strong of 10 shown). */
export const riverFolderWhoBluffs = (): Villain => {
  const c = counters({
    hands: 80,
    vpip: 0.2,
    pfr: 0.12,
    threeBetOpp: 20,
    threeBet: 1,
    betCheckedToOpp: 40,
    betCheckedTo: 12,
    foldToBetOpp: 30,
    foldToBet: 14,
  });
  c.riverCallOpp = 30;
  c.riverCall = 3;
  return {
    stats: {
      hands: 400,
      postAggr: 80,
      postPassive: 100,
      bigBetSD: 10,
      bigBetSDStrong: 2,
      rAggr: 3,
      rPassive: 6,
    },
    counters: c,
    complete: true,
  };
};
/** A tight value bettor whose lifetime aggression ratio is 3.75; bet-when-checked-to is `bct` of 40. */
export const valueBettor = (bct: number): Villain => ({
  stats: {
    hands: 400,
    aggr: 150,
    passive: 40,
    postAggr: 150,
    postPassive: 40,
    bigBetSD: 8,
    bigBetSDStrong: 7,
    rAggr: 3,
    rPassive: 6,
  },
  counters: counters({
    hands: 80,
    vpip: 0.13,
    pfr: 0.08,
    threeBetOpp: 20,
    threeBet: 0,
    betCheckedToOpp: 40,
    betCheckedTo: bct,
    foldToBetOpp: 30,
    foldToBet: 14,
  }),
  complete: true,
});
/** Neutral tallies; fold-to-bet `ftb` of 30. */
export const foldToBetVillain = (ftb: number): Villain => ({
  stats: {
    hands: 400,
    aggr: 90,
    passive: 100,
    postAggr: 90,
    postPassive: 100,
    bigBetSD: 0,
    bigBetSDStrong: 0,
    rAggr: 5,
    rPassive: 6,
  },
  counters: counters({
    hands: 80,
    vpip: 0.21,
    pfr: 0.14,
    threeBetOpp: 20,
    threeBet: 1,
    betCheckedToOpp: 40,
    betCheckedTo: 12,
    foldToBetOpp: 30,
    foldToBet: ftb,
  }),
  complete: true,
});
/** The in-format large-bet bucket: 10 bets, 10 shown, `strong` strong. */
export const largeBucket = (strong = 9): void => {
  HorseMind.importSizeBuckets([
    {
      user_id: VILLAIN,
      variant: 'nlh',
      mode: 'cash',
      size: 'full',
      buckets: { large: { bets: 10, shown: 10, strong } },
    } as never,
  ]);
};

/** The replay's own decision identity (volatile timings dropped), less the journal-only read receipt. */
const stable = (v: HorseDecision): unknown => {
  const { preflopReadReceipt: _receipt, ...rest } = v;
  return stableReceipt(rest);
};
/** Byte identity of a decision, less the journal-only preflop read receipt, plus the RNG position after it. */
export const pin = (d: Decided): string =>
  `${d.decision.action}:${d.decision.amount ?? ''}|${createHash('sha256')
    .update(JSON.stringify(stable(d.decision)))
    .digest('hex')
    .slice(0, 16)}|${d.digest.split('|')[1]}`;
/** One pinned string over many decisions. */
export const pinAll = (ds: Decided[]): string =>
  createHash('sha256').update(ds.map(pin).join('\n')).digest('hex').slice(0, 24);
/** Action counts of many decisions, e.g. { fold: 30, call: 10 }. */
export const tally = (
  ds: Decided[],
  key: (d: Decided) => string = (d) => d.decision.action
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const d of ds) out[key(d)] = (out[key(d)] ?? 0) + 1;
  return out;
};
export const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
export { decide, saveFastRandom };
