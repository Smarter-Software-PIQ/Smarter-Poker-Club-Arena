/**
 * River lead and hi-lo bluff fixtures (2026-11-07). Shared by
 * HorseRiverLeadHiLo.law.test.ts.
 *
 * OUT-OF-POSITION LEAD (`line: 'lead'`): heads-up 1/2 cash, 100bb. The
 * opponent (seat 3) holds the button, raises to 6 and hero (seat 1, big
 * blind) calls (pot 12); flop: hero checks, opponent bets 8, hero calls (pot
 * 28); turn: hero checks, opponent bets 20, hero calls (pot 68). The river is
 * dealt and hero acts first with nothing to call.
 *
 * IN-POSITION HI-LO (`line: 'barrel'`): the V54 line - hero holds the
 * button, raises, bets flop and turn and is called, and the river is checked
 * to hero.
 */
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { DECISION_TIME_MS } from './HorseV54RiverBluff.test-support.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

export const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;

export interface LeadSpot {
  name: string;
  variant: 'nlh' | 'plo4' | 'plo5' | 'plo8';
  hole: Card[];
  board: Card[];
  behind: number;
  line: 'lead' | 'barrel';
  tournament?: boolean;
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

export function leadSpotState(spot: LeadSpot): { hero: SeatPlayer; gs: HorseGameStateV2 } {
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
      ...(action === 'raise' ? { isFullRaise: true } : {}),
    } as ActionRecord);
  const lead = spot.line === 'lead';
  // The aggressor raises preflop and bets flop and turn; the other calls.
  const aggr = lead ? 3 : 1;
  const caller = lead ? 1 : 3;
  push(aggr, 'raise', 6, 'preflop');
  push(caller, 'call', 6, 'preflop');
  for (const [stage, bet] of [
    ['flop', 8],
    ['turn', 20],
  ] as const) {
    if (lead) {
      push(1, 'check', 0, stage);
      push(3, 'bet', bet, stage);
      push(1, 'call', bet, stage);
    } else {
      push(3, 'check', 0, stage);
      push(1, 'bet', bet, stage);
      push(3, 'call', bet, stage);
    }
  }
  if (!lead) push(3, 'check', 0, 'river');
  const contributed = 34;
  const hero = seat(1, spot.hole, { stack: spot.behind, totalInvested: contributed });
  const opp = seat(3, [], { stack: spot.behind, totalInvested: contributed });
  const gs = {
    players: [hero, opp],
    communityCards: spot.board,
    pot: contributed * 2,
    currentBet: 0,
    minRaise: 2,
    lastRaise: 2,
    stage: 'river',
    gameVariant: spot.variant,
    bigBlind: 2,
    dealerSeat: lead ? 3 : 1,
    actionHistory: history,
    gameMode: spot.tournament ? 'tournament' : 'cash',
    format: spot.tournament ? 'mtt' : 'cash',
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

export function decideLeadSpot(spot: LeadSpot, seed: number, opts: HorseDecideOpts = {}) {
  const { hero, gs } = leadSpotState(spot);
  seedFastRandom(seed);
  return HorseLogic.decide(
    hero,
    gs,
    'balanced',
    {},
    { observeMind: false, decisionTimeMs: DECISION_TIME_MS, ...opts }
  );
}
