/**
 * River bluff fixtures for the game types #9803 excluded (2026-11-07):
 * fixed limit, short deck, bomb pots and multi-board pots. Shared by
 * HorseRiverBluffOtherGames.law.test.ts.
 *
 * Every spot is a heads-up river checked to hero (seat 1, the button, last to
 * act). Hero bet the flop and the turn and was called (the default line), so
 * the river bluff tells the barrel story.
 *  - fixed limit (flh / flo8): 1/2 blinds, small bet 2 and big bet 4. Preflop
 *    raise to 4 and a call (pot 8), flop bet 2 called (12), turn bet 4
 *    called (20); the river's one legal bet is 4 (0.2 pot, the production
 *    average).
 *  - no limit and pot limit (short_deck, bomb pots): the #9803 1/2 line,
 *    raise to 6 and a call, flop 8 and turn 20 barrels called (pot 68).
 *  - bomb pots: no preflop street at all; every seat anted 10 (pot 20), then
 *    the same flop 8 and turn 20 barrels (pot 76).
 */
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

export const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
export const DECISION_TIME_MS = Date.UTC(2026, 10, 7, 21, 0, 0);

export interface OtherGameSpot {
  name: string;
  variant: 'nlh' | 'flh' | 'flo8' | 'short_deck' | 'plo4' | 'plo5';
  hole: Card[];
  board: Card[];
  board2?: Card[];
  bombPot?: boolean;
  /** 'barrel' bets flop and turn (default); 'passive' checks both behind */
  line?: 'barrel' | 'passive';
  behind?: number;
  extraOpponents?: number;
}

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

export function otherGameState(spot: OtherGameSpot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const fixed = spot.variant === 'flh' || spot.variant === 'flo8';
  const potLimit = spot.variant === 'plo4' || spot.variant === 'plo5';
  const opps = [3, ...Array.from({ length: spot.extraOpponents ?? 0 }, (_, i) => 5 + i)];
  const history: ActionRecord[] = [];
  let ts = 1;
  const push = (seatN: number, action: ActionRecord['action'], amount: number, stage: string) =>
    history.push({
      seat: seatN,
      userId: seatN === 1 ? 'hero' : `opp${seatN}`,
      action,
      amount,
      timestamp: ts++,
      stage,
    } as ActionRecord);
  let contributed: number;
  if (spot.bombPot) {
    contributed = 10; // the ante: no preflop actions are recorded
  } else {
    const open = fixed ? 4 : 6;
    push(1, 'raise', open, 'preflop');
    for (const o of opps) push(o, 'call', open, 'preflop');
    contributed = open;
  }
  const passive = spot.line === 'passive';
  const flopBet = passive ? 0 : fixed ? 2 : 8;
  const turnBet = passive ? 0 : fixed ? 4 : 20;
  for (const [stage, bet] of [
    ['flop', flopBet],
    ['turn', turnBet],
  ] as const) {
    for (const o of opps) push(o, 'check', 0, stage);
    if (bet > 0) {
      push(1, 'bet', bet, stage);
      for (const o of opps) push(o, 'call', bet, stage);
    } else push(1, 'check', 0, stage);
  }
  contributed += flopBet + turnBet;
  const pot = contributed * (opps.length + 1);
  for (const o of opps) push(o, 'check', 0, 'river');
  const behind = spot.behind ?? (fixed ? 190 : 166);
  const hero = seat(1, spot.hole, { stack: behind, totalInvested: contributed });
  const others = opps.map((o) => seat(o, [], { stack: behind, totalInvested: contributed }));
  const gs = {
    players: [hero, ...others],
    communityCards: spot.board,
    ...(spot.board2 ? { communityCards2: spot.board2 } : {}),
    pot,
    currentBet: 0,
    minRaise: fixed ? 4 : 2,
    lastRaise: fixed ? 4 : 2,
    stage: 'river',
    gameVariant: spot.variant,
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 1,
    actionHistory: history,
    gameMode: 'cash',
    format: 'cash',
    bettingStructure: fixed ? 'fixed_limit' : potLimit ? 'pot_limit' : 'no_limit',
    ...(fixed ? { fixedBetSize: 4, fixedLimitSmallBet: 2 } : {}),
    ...(spot.bombPot ? { bombPot: true } : {}),
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

export function decideOtherGame(spot: OtherGameSpot, seed: number, opts: HorseDecideOpts = {}) {
  const { hero, gs } = otherGameState(spot);
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {},
    { observeMind: false, decisionTimeMs: DECISION_TIME_MS, ...opts }
  );
}

/** Opponent memory for seat 3: how often it folds to a river bet. */
export function seedOpponentRiverRead(riverFolds: number, riverOpps: number): void {
  HorseMind.reset();
  HorseMind.importStats([
    {
      user_id: 'opp3',
      hands: 300,
      vpip: 75,
      pfr: 40,
      threeBet: 10,
      aggr: 120,
      passive: 120,
      folds: Math.round((100 * riverFolds) / riverOpps),
      facedAggr: 100,
      riverBetOpps: riverOpps,
      riverBetFolds: riverFolds,
    },
  ]);
}
