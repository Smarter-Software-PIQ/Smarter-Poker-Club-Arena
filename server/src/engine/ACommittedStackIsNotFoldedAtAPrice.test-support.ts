/**
 * Test support for ACommittedStackIsNotFoldedAtAPrice.law.test.ts: rebuilds a
 * decision-time request from a public packet row on an anonymised tournament
 * body. Not production code and not imported by any.
 *
 * What a public row holds is used as recorded (seats, stacks, commitments,
 * blinds, ante, button, action order, legal actions, stage flags). What it
 * does not hold is ASSUMED, and stated here so nobody reads these as replays:
 *  - style, mods and the field layout come from the anonymised body of
 *    ABluffRaiseNeedsSomeoneWhoCanFold.fixture.json;
 *  - the other tables' stacks are that body's field scaled to this table's
 *    average stack;
 *  - the payout table is that body's (a standard nine-place table when nine
 *    or fewer places are paid);
 *  - six minutes to the next level, blinds up by a quarter;
 *  - the prize pool is entrants x 3,500 x 0.9, the way the pool is priced
 *    since #10612 ("priced"), or 100 with the rebuy open ("mispriced", the
 *    feed before #10612);
 *  - bounties off; opponent memory empty.
 */
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { buildTournamentMState } from './HorseTournamentPreflop.js';
import { calculateContestablePot } from './PokerEngine.js';
import type { SeatPlayer } from '../types.js';
import { readFileSync } from 'node:fs';

// Test data, read from disk rather than imported: a non-test module that
// imports JSON must be listed in tsconfig.emit.json (engine-build-resource-proof),
// and these fixtures are not runtime resources.
const readFixture = (name: string): any =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const TEMPLATE = readFixture('./ABluffRaiseNeedsSomeoneWhoCanFold.fixture.json');
const FIXTURE = readFixture('./ACommittedStackIsNotFoldedAtAPrice.fixture.json');

export interface Spot {
  name: string;
  handClass: string;
  bigBlind: number;
  ante: number;
  /** [seat, stack behind, street bet, total invested, dead invested, unused, state]. */
  seats: number[][];
  hero: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  dealer: number;
  humanSeats: number[];
  pot: number;
  toCall: number;
  currentBet: number;
  legal: string[];
  /** [seat, action, amount, isFullRaise]. */
  history: (number | string | boolean | null)[][];
  stage: Record<string, number | boolean>;
  cards: { rank: string; suit: string }[];
}

export type Pool = 'priced' | 'mispriced';

export interface Built {
  player: SeatPlayer & { totalInvested: number; stack: number };
  gameState: HorseGameStateV2 & { toCall: number; contestablePot: number; bigBlind: number };
}

export interface Decided {
  action: string;
  preflopAuthority?: { referenceAction?: string; intent?: { a: string } };
  tournamentUtility?: {
    baselineAction: string;
    selectedAction: string;
    baselineRetainedForUncertainty?: boolean;
  };
  tournamentUtilityRefusal?: unknown;
  tournamentPreflopAttribution?: { lookup?: { policy?: { branch?: string } } };
}

export const SPOTS = FIXTURE.spots as unknown as Spot[];

export function spotNamed(name: string): Spot {
  const spot = SPOTS.find((s) => s.name === name);
  if (!spot) throw new Error(`no spot named ${name}`);
  return structuredClone(spot);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function sidePots(players: any[]): { amount: number; eligiblePlayers: string[] }[] {
  const live = players.filter((p) => !p.is_folded);
  const levels = [...new Set<number>(live.map((p) => p.totalInvested))].sort((a, b) => a - b);
  const pots: { amount: number; eligiblePlayers: string[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = players.reduce(
      (sum, p) => sum + Math.max(0, Math.min(p.totalInvested, level) - prev),
      0
    );
    if (amount > 0) {
      pots.push({
        amount,
        eligiblePlayers: live.filter((p) => p.totalInvested >= level).map((p) => p.user_id),
      });
    }
    prev = level;
  }
  return pots;
}

export function build(spot: Spot, pool: Pool = 'priced'): Built {
  const gs: any = structuredClone(TEMPLATE.gameState);
  const t: any = gs.tournament;
  const templatePlayers = [...gs.players].sort((a: any, b: any) => a.seat - b.seat);
  const heroTemplate = templatePlayers.find((p: any) => p.user_id === TEMPLATE.player.user_id);
  const others = templatePlayers.filter((p: any) => p !== heroTemplate);
  const players = spot.seats.map((s) => {
    const base = s[0] === spot.hero ? heroTemplate : others.shift();
    return {
      ...base,
      seat: s[0],
      stack: s[1],
      bet: s[2],
      totalInvested: s[3],
      deadInvested: s[4],
      individualAnteInvested: 0,
      returnedUncalled: 0,
      is_folded: s[6] === 1,
      is_all_in: s[6] === 2,
      is_sitting_out: false,
      is_horse: !spot.humanSeats.includes(s[0]),
    };
  });
  const bySeat = new Map<number, any>(players.map((p) => [p.seat, p]));
  const hero = bySeat.get(spot.hero);
  const player = {
    ...structuredClone(TEMPLATE.player),
    ...hero,
    cards: structuredClone(spot.cards),
    knownDeadCards: [],
  };
  const bb = spot.bigBlind;
  const sb = bb / 2;
  let lastBet = bb;
  let lastRaise = bb;
  const t0 = 1794450200000;
  const actionHistory = spot.history.map((h, i) => {
    const [seat, action, amount, full] = h as [number, string, number, boolean | null];
    const p = bySeat.get(seat);
    const entry: any = {
      action,
      amount,
      seat,
      stage: 'preflop',
      timestamp: t0 + i * 2500,
      userId: p.user_id,
    };
    if (p.is_horse) entry.origin = 'horse_policy';
    if (full !== null && full !== undefined) entry.isFullRaise = full;
    if ((action === 'raise' || action === 'all_in') && amount > lastBet) {
      lastRaise = Math.max(lastRaise, amount - lastBet);
      lastBet = amount;
    }
    return entry;
  });
  Object.assign(gs, {
    players,
    ante: spot.ante,
    bigBlind: bb,
    smallBlind: sb,
    bigBlindAnte: spot.ante > 0,
    pot: spot.pot,
    currentBet: spot.currentBet,
    toCall: spot.toCall,
    currentPlayerSeat: spot.hero,
    heroSeat: spot.hero,
    dealerSeat: spot.dealer,
    blindSeats: { bigBlind: spot.bigBlindSeat, smallBlind: spot.smallBlindSeat },
    dealtSeatIds: spot.seats.map((s) => s[0]),
    legalActions: spot.legal,
    lastRaise,
    minRaise: lastRaise,
    minRaiseTo: null,
    maxRaiseTo: null,
    pots: sidePots(players),
    humanUserIds: players.filter((p) => !p.is_horse).map((p) => p.user_id),
    actionHistory,
  });
  // What the hero can win after its largest legal call.
  gs.contestablePot = calculateContestablePot(players as never, hero.user_id, spot.toCall);

  const st = spot.stage;
  const start = players.map((p) => p.stack + p.totalInvested);
  const tableMean = start.reduce((a, b) => a + b, 0) / start.length;
  const fillCount = Math.max(0, Number(st.playersLeft ?? players.length) - players.length);
  const field: number[] = t.stacks ?? [];
  const fieldMean = field.reduce((a, b) => a + b, 0) / Math.max(1, field.length);
  const filler = Array.from({ length: fillCount }, (_, i) =>
    Math.max(
      1,
      Math.round(
        ((field[Math.floor(((i + 0.5) * field.length) / Math.max(1, fillCount))] ?? fieldMean) *
          tableMean) /
          fieldMean
      )
    )
  );
  const stacks = [...start, ...filler].sort((a, b) => b - a);
  const nextBB = Math.round(bb * 1.25);
  const paid = Number(st.spotsPaid ?? t.spotsPaid);
  let payout: number[] = (t.payoutPct ?? []).slice(0, paid);
  while (payout.length < paid) payout.push(payout[payout.length - 1] ?? 1);
  if (paid <= 9) payout = [30, 20, 14, 10.5, 8, 6.5, 5, 3.5, 2.5].slice(0, paid);
  const payoutSum = payout.reduce((a, b) => a + b, 0);
  payout = payout.map((x) => +((100 * x) / payoutSum).toFixed(4));
  const entrants = Number(st.entrants ?? t.entrants);
  Object.assign(t, {
    currentBigBlind: bb,
    currentSmallBlind: sb,
    currentAnte: spot.ante,
    nextBigBlind: nextBB,
    nextSmallBlind: nextBB / 2,
    nextAnte: nextBB,
    nextBlindInMin: 6,
    nextBlindMult: 1.25,
    levelElapsedMin: 4,
    nearBubble: !!st.nearBubble,
    inMoney: !!st.inMoney,
    finalTable: !!st.finalTable,
    rebuyOpen: !!st.rebuyOpen,
    reentryOpen: !!st.reentryOpen,
    registrationOpen: !!st.registrationOpen,
    lateRegistrationOpen: !!st.lateRegistrationOpen,
    addOnPeriodOpen: !!st.addOnPeriodOpen,
    handForHand: !!st.handForHand,
    handForHandExpected: !!st.handForHand,
    satellite: false,
    rebuyAllowed: !!st.rebuyOpen,
    rebuyAffordable: !!st.rebuyOpen,
    reentryAllowed: !!st.reentryOpen,
    currentLevel: st.currentLevel ?? t.currentLevel,
    playersLeft: st.playersLeft,
    entrants,
    spotsPaid: paid,
    playersAtTable: players.length,
    stackByUser: Object.fromEntries(players.map((p, i) => [p.user_id, start[i]])),
    stacks,
    avgStackChips: stacks.reduce((a, b) => a + b, 0) / stacks.length,
    medianStackChips: stacks[Math.floor(stacks.length / 2)],
    payoutPct: payout,
    prizePoolCents: Math.round(3500 * entrants * 0.9),
    prizePoolFinalized: !st.rebuyOpen && !st.registrationOpen,
    m: buildTournamentMState({
      stackChips: hero.stack,
      smallBlind: sb,
      bigBlind: bb,
      ante: spot.ante,
      anteType: 'big_blind',
      playersAtTable: players.length,
      nextSmallBlind: nextBB / 2,
      nextBigBlind: nextBB,
      nextAnte: nextBB,
      minutesToNextLevel: 6,
      opponentStacks: players
        .filter((p) => p !== hero)
        .map((p) => ({ userId: p.user_id, stackChips: p.stack })),
      previousZone: null,
    } as never),
  });
  if (t.contextProvenance?.projection) {
    Object.assign(t.contextProvenance.projection, {
      actorId: hero.user_id,
      actorSeat: spot.hero,
      ante: spot.ante,
      bigBlind: bb,
      smallBlind: sb,
      dealerSeat: spot.dealer,
      dealtSeatIds: gs.dealtSeatIds,
    });
  }
  if (pool === 'mispriced') {
    Object.assign(t, {
      prizePoolCents: 100,
      rebuyOpen: true,
      rebuyAllowed: true,
      rebuyAffordable: true,
      rebuyPrizeContributionCents: 0,
      prizePoolFinalized: false,
    });
  }
  return { player, gameState: gs };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Flag committedStackPricedIn: true (default here, the rule under test), false
 *  (explicit off) or 'absent' (no key at all, the production default). */
export type Arm = boolean | 'absent';

export function decideBuilt(rq: Built, seed: number, arm: Arm = true): Decided {
  HorseMind.reset();
  seedFastRandom(seed);
  return HorseLogic.decide(
    structuredClone(rq.player),
    structuredClone(rq.gameState),
    TEMPLATE.style as never,
    TEMPLATE.mods as never,
    {
      decisionTimeMs: TEMPLATE.decisionTimeMs,
      telemetry: true,
      ...(arm === 'absent' ? {} : { committedStackPricedIn: arm }),
    } as never
  ) as unknown as Decided;
}

export function decide(spot: Spot, seed: number, pool: Pool = 'priced', arm: Arm = true): Decided {
  return decideBuilt(build(spot, pool), seed, arm);
}
