/**
 * Fixtures for AHoldemTournamentAllInCallIsPriced.law.test.ts: the Horse Decisions audit E hands
 * (decisions.csv, archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/E-nlh-tournament), rebuilt as
 * decision requests. The audit's export of the hands (hands.jsonl) was not archived, so each request is
 * rebuilt from the row's own fields: the Horse's cards, the board, the big blind, the effective stack, the
 * pot and the call in big blinds, the seat kind, the players dealt, the players left and paid. The public
 * action that makes those numbers is stated per fixture; nothing else is invented. The base request (the
 * tournament context, the style and the mods) is the anonymised production All-In-Or-Fold request
 * bigBlindKingQueenOffsuit of AnAofClosingSeatCallsFromTheNashTable.fixture.json, re-dealt.
 */
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { readFileSync } from 'node:fs';

// Read, not imported, and typed here rather than with typeof import(...): this module is not a test file, so a
// value or type import of the JSON puts it in the full typechecked build (tsconfig.runtime.json emits it into
// dist) while the engine image compile (tsconfig.emit.json, noResolve) does not; engine-build-resource-proof
// refuses that difference ("runtime emission differs from the full typechecked CI build").
interface NashTableCase {
  decisionTimeMs: number;
  style: string;
  mods: Record<string, unknown>;
  gameState: { players: unknown[] } & Record<string, unknown>;
}
const FIXTURE = JSON.parse(
  readFileSync(
    new URL('./AnAofClosingSeatCallsFromTheNashTable.fixture.json', import.meta.url),
    'utf8'
  )
) as { cases: Record<'bigBlindKingQueenOffsuit', NashTableCase> };

const BASE = FIXTURE.cases.bigBlindKingQueenOffsuit;
export const BASE_STYLE = BASE.style;
export const BASE_MODS = BASE.mods;
export const BASE_DECISION_TIME_MS = BASE.decisionTimeMs;

const SUIT: Record<string, CardSuit> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
/** 'TsKh' -> two engine cards; '' -> none. */
export function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUIT[text[i + 1]] });
  return out;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
/** [seat, action, street total the action makes (bet or raise to; a call's total; 0 for a fold or check)]. */
export type Act = readonly [number, 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in', number];

export interface SpotSpec {
  /** Big blind in chips; small blind half, big-blind ante of one big blind (the base tournament's structure). */
  bb: number;
  /** Seats dealt (1..9 in order); the dealer; the small blind and the big blind follow it. */
  seats: number[];
  dealer: number;
  hero: number;
  heroCards: string;
  /** Each seat's chips when the hand started. */
  stacks: Record<number, number>;
  /** The hand's public action, street by street, after the blinds and the ante. */
  streets: Partial<Record<Street, readonly Act[]>>;
  board?: string;
  aof?: boolean;
  playersLeft: number;
  spotsPaid: number;
}

/** A payout ladder of `paid` places summing to 100 (weights 1 / place^0.9, two decimals, the first takes the rounding). */
export function payoutLadder(paid: number): number[] {
  const w = Array.from({ length: paid }, (_, i) => 1 / Math.pow(i + 1, 0.9));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.max(0.01, Math.floor((10000 * x) / sum) / 100));
  out[0] = Math.round((out[0] + 100 - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  return out;
}

const ID = (seat: number) => `00000000-0000-4000-8066-0000000000${String(seat).padStart(2, '0')}`;

/** The decision request at the hero's turn after the stated action. */
export function buildSpot(spec: SpotSpec): { gs: HorseGameStateV2; player: SeatPlayer } {
  const gs = structuredClone(BASE.gameState) as unknown as HorseGameStateV2;
  const order = spec.seats;
  const at = (k: number) => order[(order.indexOf(spec.dealer) + k) % order.length];
  const sbSeat = order.length === 2 ? spec.dealer : at(1);
  const bbSeat = order.length === 2 ? at(1) : at(2);
  const bb = spec.bb;
  type P = SeatPlayer & { _street: number };
  const template = BASE.gameState.players[0] as unknown as SeatPlayer;
  const players: P[] = order.map((seat) => ({
    ...structuredClone(template),
    seat,
    user_id: ID(seat),
    username: 'seat',
    stack: spec.stacks[seat],
    bet: 0,
    totalInvested: 0,
    deadInvested: 0,
    individualAnteInvested: 0,
    returnedUncalled: 0,
    cards: seat === spec.hero ? cards(spec.heroCards) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    _street: 0,
  }));
  const bySeat = (s: number) => players.find((p) => p.seat === s)!;
  const put = (p: P, chips: number, dead = false) => {
    const c = Math.min(chips, p.stack);
    p.stack -= c;
    p.totalInvested += c;
    if (dead) p.deadInvested = (p.deadInvested ?? 0) + c;
    else p.bet += c;
    if (p.stack <= 0) p.is_all_in = true;
  };
  let pot = 0;
  // Big-blind ante (dead), then the blinds.
  put(bySeat(bbSeat), bb, true);
  put(bySeat(sbSeat), bb / 2);
  put(bySeat(bbSeat), bb);
  const history: HorseGameStateV2['actionHistory'] = [];
  let currentBet = bb;
  let lastRaise = bb;
  let stage: Street = 'preflop';
  const streets: Street[] = ['preflop', 'flop', 'turn', 'river'];
  for (const street of streets) {
    const acts = spec.streets[street];
    if (!acts) continue;
    if (street !== 'preflop') {
      for (const p of players) {
        pot += p.bet;
        p.bet = 0;
      }
      currentBet = 0;
      lastRaise = bb;
    }
    stage = street;
    for (const [seat, action, total] of acts) {
      const p = bySeat(seat);
      if (action === 'fold') p.is_folded = true;
      else if (action === 'call') put(p, Math.min(currentBet, p.bet + p.stack) - p.bet);
      else if (action === 'bet' || action === 'raise' || action === 'all_in') {
        const to = action === 'all_in' ? p.bet + p.stack : total;
        put(p, to - p.bet);
        if (to > currentBet) {
          lastRaise = Math.max(lastRaise, to - currentBet);
          currentBet = to;
        }
      }
      history!.push({
        seat,
        userId: ID(seat),
        action: action as never,
        amount: action === 'fold' || action === 'check' ? 0 : p.bet,
        timestamp: 1794437500000 + history!.length * 1000,
        stage: street as never,
        origin: 'horse_policy',
      } as never);
    }
  }
  const hero = bySeat(spec.hero);
  const live = players.filter((p) => !p.is_folded);
  const streetBets = players.reduce((a, p) => a + p.bet, 0);
  const deadAnte = players.reduce((a, p) => a + (p.deadInvested ?? 0), 0);
  const totalPot = pot + streetBets + (stage === 'preflop' ? deadAnte : 0);
  const toCall = Math.max(0, currentBet - hero.bet);
  const matched = hero.bet + Math.min(toCall, hero.stack);
  const excess = players
    .filter((p) => p.seat !== hero.seat)
    .reduce((a, p) => a + Math.max(0, p.bet - matched), 0);
  const potWithAnte = stage === 'preflop' ? totalPot : totalPot + deadAnte;
  gs.players = players.map(({ _street, ...p }) => p) as never;
  gs.dealerSeat = spec.dealer;
  gs.blindSeats = { smallBlind: sbSeat, bigBlind: bbSeat } as never;
  gs.dealtSeatIds = [...order] as never;
  gs.heroSeat = spec.hero as never;
  gs.currentPlayerSeat = spec.hero as never;
  gs.bigBlind = bb;
  gs.smallBlind = bb / 2;
  gs.ante = bb;
  gs.bigBlindAnte = true;
  gs.stage = stage as never;
  gs.communityCards = cards(spec.board ?? '') as never;
  gs.currentBet = currentBet;
  gs.lastRaise = lastRaise as never;
  gs.minRaise = lastRaise as never;
  gs.pot = potWithAnte;
  gs.contestablePot = potWithAnte - excess;
  gs.toCall = toCall as never;
  gs.actionHistory = history;
  gs.allInOrFold = spec.aof === true;
  const canRaise = hero.stack + hero.bet > currentBet + lastRaise && !spec.aof;
  gs.legalActions = (
    spec.aof
      ? ['fold', 'all_in']
      : toCall === 0
        ? ['check', 'bet', 'all_in']
        : hero.stack > toCall
          ? canRaise
            ? ['fold', 'call', 'raise', 'all_in']
            : ['fold', 'call', 'all_in']
          : ['fold', 'call']
  ) as never;
  gs.minRaiseTo = (canRaise ? currentBet + lastRaise : null) as never;
  gs.maxRaiseTo = (canRaise ? hero.stack + hero.bet : null) as never;
  gs.pots = [{ amount: potWithAnte, eligiblePlayers: live.map((p) => p.user_id) }] as never;
  gs.humanUserIds = [] as never;
  const t = gs.tournament as unknown as Record<string, unknown>;
  t.playersLeft = spec.playersLeft;
  t.payoutPct = payoutLadder(Math.min(spec.spotsPaid, spec.playersLeft));
  const baseStacks = (t.stacks as number[]).slice();
  t.stacks = Array.from({ length: spec.playersLeft }, (_, i) =>
    i < order.length
      ? players[i].stack + players[i].totalInvested
      : baseStacks[i % baseStacks.length]
  );
  t.spotsPaid = spec.spotsPaid;
  t.inMoney = spec.playersLeft <= spec.spotsPaid;
  t.nearBubble = false;
  t.handForHand = false;
  t.handForHandExpected = false;
  t.currentBigBlind = bb;
  t.currentSmallBlind = bb / 2;
  t.currentAnte = bb;
  t.playersAtTable = order.length;
  t.stackByUser = Object.fromEntries(players.map((p) => [p.user_id, p.stack + p.totalInvested]));
  const player = structuredClone(gs.players.find((p) => p.seat === spec.hero)!) as SeatPlayer;
  return { gs, player };
}
