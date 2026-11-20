/**
 * Test support for omahaBluffIsPricedAgainstTheTarget: a decision spot rebuilt from one row of the
 * 48-hour audit of PLO5 Lightning cash against persons (archive plo-handoff-review-01a1cbbd/
 * hvh48-audit-01TLQer7J/A-plo5-lightning/decisions.csv): the Horse's exact cards, the board, the pot,
 * the price, the stacks, position and the action the Horse took, in big blinds. The opponents are
 * persons; WooWoo (69f2cefa) carries the decayed fold-to-bet record the audit read from his profile
 * (horse_exact_profiles: 13.9 folds of 40.8 faced first postflop bets), any other person no record.
 */
import type { CardRank, CardSuit, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type {
  OmahaTargetFoldRecord,
  OmahaTargetRecordOf,
} from './HorseOmahaBluffPricedAgainstTheTarget.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
export const auditCards = (spec: string) =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]!]! }));

/** One audit row: the columns the spot needs, as in decisions.csv. */
export interface AuditRow {
  hand: string;
  street: 'flop' | 'turn' | 'river';
  ip: boolean;
  /** live opponents; the first is the one the audit names first */
  opps: number;
  woowoo: boolean;
  cards: string;
  board: string;
  pot: number;
  toCall: number;
  stack: number;
  eff: number;
  /** the action the Horse took, its amount in chips as decisions.csv gives it (big blind 2 chips on every
   *  audited hand): 'bet:342', 'raise:608.43', 'call'. The pot, price and stacks are in big blinds. */
  action: string;
}

/** WooWoo's record (the audit's read of his decayed profile); no street cell is kept in production. */
export const WOOWOO_RECORD: OmahaTargetFoldRecord = Object.freeze({
  street: null,
  pooled: Object.freeze({ hit: 13.9, opp: 40.8 }),
});
export const auditRecordOf: OmahaTargetRecordOf = (userId) =>
  userId === 'woowoo' ? WOOWOO_RECORD : null;

/** Every audited hand: big blind 2.00 chips (hand_history.big_blind). */
export const AUDIT_CHIPS_PER_BB = 2;

export function auditSpot(r: AuditRow): {
  player: SeatPlayer;
  gs: HorseGameStateV2;
  decision: HorseDecision;
} {
  const heroSeat = 1;
  const player = {
    seat: heroSeat,
    user_id: 'horse',
    username: 'horse',
    cards: auditCards(r.cards),
    stack: r.stack,
    bet: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as unknown as SeatPlayer;
  const oppStack = r.stack > r.eff + 0.005 ? r.eff : Math.max(r.eff, r.stack) * 1.5;
  const opps = Array.from({ length: r.opps }, (_, i) => ({
    seat: 2 + i,
    user_id: i === 0 && r.woowoo ? 'woowoo' : `person${i}`,
    username: `p${i}`,
    cards: [],
    stack: Math.max(0, oppStack - (i === 0 ? r.toCall : 0)),
    bet: i === 0 ? r.toCall : 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
  })) as unknown as SeatPlayer[];
  const facing = r.toCall > 0;
  const gs = {
    gameVariant: 'plo5',
    gameMode: 'cash',
    bettingStructure: 'pot_limit',
    boardCount: 1,
    stage: r.street,
    communityCards: auditCards(r.board),
    pot: r.pot,
    toCall: r.toCall,
    currentBet: r.toCall,
    bigBlind: 1,
    smallBlind: 0.5,
    // in position: the hero is the dealer and acts after every opponent
    dealerSeat: r.ip ? heroSeat : 2 + r.opps - 1,
    minRaiseTo: facing ? 2 * r.toCall : 1,
    maxRaiseTo: facing ? r.toCall + (r.pot + r.toCall) : r.pot,
    legalActions: facing ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    players: [player, ...opps],
    humanUserIds: opps.map((p) => p.user_id),
    actionHistory: [],
    publicMemoryDomain: { version: 1, speed: 'lightning', ante: 'none' },
  } as unknown as HorseGameStateV2;
  const [act, amt] = r.action.split(':');
  const decision: HorseDecision =
    act === 'call'
      ? { action: 'call', amount: r.toCall, thinkTime: 0 }
      : ({ action: act, amount: Number(amt) / AUDIT_CHIPS_PER_BB, thinkTime: 0 } as HorseDecision);
  return { player, gs, decision };
}
