/**
 * Flop and turn bluff fixtures (2026-11-07). Shared by
 * HorseFlopTurnBluffRange.law.test.ts and the measurement recorded in
 * docs/changelog/2026-11-07-horse-flop-turn-bluff-range.md.
 *
 * Every spot is a single-raised pot, 1/2 cash (or a tournament on the
 * bubble), 100bb deep. Preflop the raiser opens to 6 and the other players
 * call (pot 12 heads-up). The `line` names the decision hero faces:
 *
 *  cbet          hero raised in position; the flop is checked to hero
 *  cbetOop       hero raised out of position and acts first on the flop
 *  barrel        hero bet 8 on the flop and was called; the turn checks to hero
 *  delayed       hero raised; the flop checked through; the turn checks to hero
 *  probe         hero called out of position; the raiser checked the flop
 *                back; hero acts first on the turn
 *  stab          hero called in position; the raiser checks the flop to hero
 *  facingCbet    hero called in position; the raiser bets 8 into 12
 *  checkRaise    hero called out of position, checked, and faces a bet of 8
 *  facingBarrel  hero called the flop bet in position; the raiser bets 20 on
 *                the turn
 */
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

export const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;

export const DECISION_TIME_MS = Date.UTC(2026, 10, 7, 21, 0, 0);

export type FlopTurnLine =
  | 'cbet'
  | 'cbetOop'
  | 'barrel'
  | 'delayed'
  | 'probe'
  | 'stab'
  | 'facingCbet'
  | 'checkRaise'
  | 'facingBarrel';

export interface FlopTurnSpot {
  name: string;
  variant: 'nlh' | 'plo4' | 'plo5' | 'plo6';
  hole: Card[];
  /** three cards for a flop line, four for a turn line */
  board: Card[];
  line: FlopTurnLine;
  /** extra live opponents, all of whom call preflop and check or call */
  extraOpponents?: number;
  /** behind per player at the start of the flop (default 194) */
  behind?: number;
  oppAllIn?: boolean;
  tournament?: boolean;
}

const HERO_RAISES: Record<FlopTurnLine, boolean> = {
  cbet: true,
  cbetOop: true,
  barrel: true,
  delayed: true,
  probe: false,
  stab: false,
  facingCbet: false,
  checkRaise: false,
  facingBarrel: false,
};
/** Hero acts last postflop (holds the button). */
const HERO_IP: Record<FlopTurnLine, boolean> = {
  cbet: true,
  cbetOop: false,
  barrel: true,
  delayed: true,
  probe: false,
  stab: true,
  facingCbet: true,
  checkRaise: false,
  facingBarrel: true,
};

function seat(n: number, cards: Card[], over: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    seat: n,
    user_id: n === 1 ? 'hero' : `opp${n}`,
    username: n === 1 ? 'hero' : `opp${n}`,
    stack: 0,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    cards,
    ...over,
  } as SeatPlayer;
}

export function flopTurnState(spot: FlopTurnSpot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const line = spot.line;
  const street = spot.board.length === 3 ? 'flop' : 'turn';
  const opps = [3, ...Array.from({ length: spot.extraOpponents ?? 0 }, (_, i) => 5 + i)];
  const raiser = HERO_RAISES[line] ? 1 : 3;
  const ip = HERO_IP[line];
  // Postflop order: the non-button seats first, the button (dealer) last.
  const order = ip ? [...opps, 1] : [1, ...opps];
  const history: ActionRecord[] = [];
  let ts = 1;
  const push = (s: number, action: ActionRecord['action'], amount: number, stage: string) =>
    history.push({
      seat: s,
      userId: s === 1 ? 'hero' : `opp${s}`,
      action,
      amount,
      timestamp: ts++,
      stage,
    } as ActionRecord);
  push(raiser, 'raise', 6, 'preflop');
  for (const s of [1, ...opps]) if (s !== raiser) push(s, 'call', 6, 'preflop');
  const n = opps.length + 1;
  let contributed = 6;
  let pot = 6 * n;
  let currentBet = 0;
  const behind = spot.behind ?? 194;
  let oppBet = 0;
  // ── the flop ─────────────────────────────────────────────────────────────
  const flopBetBy: number | null =
    line === 'barrel'
      ? 1
      : line === 'facingCbet' || line === 'checkRaise' || line === 'facingBarrel'
        ? 3
        : null;
  if (street === 'flop') {
    // play the flop up to hero's decision
    for (const s of order) {
      if (s === 1) break;
      if (flopBetBy === s) {
        push(s, 'bet', 8, 'flop');
        oppBet = 8;
        currentBet = 8;
        pot += 8;
        // later opponents (multiway) call before hero acts in position
      } else if (oppBet > 0) {
        push(s, 'call', 8, 'flop');
        pot += 8;
      } else push(s, 'check', 0, 'flop');
    }
  } else {
    // the flop is complete
    if (flopBetBy !== null) {
      for (const s of order) {
        if (s === flopBetBy) push(s, 'bet', 8, 'flop');
        else if (order.indexOf(s) < order.indexOf(flopBetBy)) push(s, 'check', 0, 'flop');
      }
      for (const s of order) {
        if (s === flopBetBy) continue;
        push(s, 'call', 8, 'flop');
      }
      contributed += 8;
      pot += 8 * n;
    } else {
      for (const s of order) push(s, 'check', 0, 'flop');
    }
    for (const s of order) {
      if (s === 1) break;
      if (line === 'facingBarrel' && s === 3) {
        push(s, 'bet', 20, 'turn');
        oppBet = 20;
        currentBet = 20;
        pot += 20;
      } else if (oppBet > 0) {
        push(s, 'call', oppBet, 'turn');
        pot += oppBet;
      } else push(s, 'check', 0, 'turn');
    }
  }
  if (line === 'checkRaise') {
    // Hero (out of position) checked, the raiser bet 8 behind it.
    push(1, 'check', 0, street);
    for (const s of opps) {
      if (s === 3) {
        push(s, 'bet', 8, street);
        oppBet = 8;
        currentBet = 8;
        pot += 8;
      } else if (oppBet > 0) {
        push(s, 'call', 8, street);
        pot += 8;
      } else push(s, 'check', 0, street);
    }
  }
  const hero = seat(1, spot.hole, {
    stack: behind - (contributed - 6),
    totalInvested: contributed,
  });
  const others = opps.map((o, i) =>
    seat(o, [], {
      stack: i === 0 && spot.oppAllIn ? 0 : behind - (contributed - 6) - oppBet,
      bet: oppBet,
      is_all_in: i === 0 && spot.oppAllIn === true,
      totalInvested: contributed + oppBet,
    })
  );
  const gs = {
    players: [hero, ...others],
    communityCards: spot.board,
    pot,
    currentBet,
    minRaise: currentBet > 0 ? currentBet : 2,
    lastRaise: currentBet > 0 ? currentBet : 2,
    stage: street,
    gameVariant: spot.variant,
    bigBlind: 2,
    dealerSeat: ip ? 1 : 3,
    actionHistory: history,
    gameMode: spot.tournament ? 'tournament' : 'cash',
    format: spot.tournament ? 'mtt' : 'cash',
    ...(spot.tournament
      ? { tournament: { playersLeft: 10, spotsPaid: 9, inMoney: false, avgStackChips: 200 } }
      : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

/** One decision at a pinned RNG seed and decision clock. */
export function decideFlopTurn(spot: FlopTurnSpot, seed: number, opts: HorseDecideOpts = {}) {
  const { hero, gs } = flopTurnState(spot);
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {},
    { observeMind: false, decisionTimeMs: DECISION_TIME_MS, ...opts }
  );
}

export const FT_SEEDS = Array.from({ length: 300 }, (_, i) => 104_729 + i * 15_485_863);

/** Share of seeds whose decision puts chips in by choice (bet, raise, all in). */
export function aggressionRate(
  spot: FlopTurnSpot,
  opts: HorseDecideOpts = {},
  seeds: number[] = FT_SEEDS
): { rate: number; actions: Record<string, number> } {
  const actions: Record<string, number> = {};
  let n = 0;
  for (const s of seeds) {
    const d = decideFlopTurn(spot, s, opts);
    actions[d.action] = (actions[d.action] ?? 0) + 1;
    if (d.action === 'bet' || d.action === 'raise' || d.action === 'all_in') n++;
  }
  return { rate: n / seeds.length, actions };
}
