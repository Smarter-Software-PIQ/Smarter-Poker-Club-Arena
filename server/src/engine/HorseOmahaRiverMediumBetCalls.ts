/**
 * OMAHA RIVER: A STRONG MADE HAND CALLS A MEDIUM BET (2026-11-15, PLO Strategy
 * lane; option omahaRiverMediumBetStrongHandCalls, default OFF, read
 * `=== true`).
 *
 * Evidence (archive plo-handoff-review-01a1cbbd/winner-exploit-20261115 and
 * rivercall-20261115): against one PLO5 cash player, on the river, facing a
 * bet of 40 to 70 percent of the pot, heads-up or closing the action, Horses
 * holding two pair or better folded 11 of 15 times; five of those folds were
 * the best hand, and every folded set, trips or better was. His bets of that
 * size were behind 7 times in 16; his bets of 70 percent or more were ahead
 * 19 times in 24 and the folds to them were right; his bets under 40 percent
 * were ahead 6 times in 6.
 *
 * Why the brain folded (the eleven folds replayed through HorseLogic.decide
 * with the opponent memory on, with or without a row for the bettor):
 *  1. the range read marks any wager of 20 big blinds or more as a "big bet"
 *     whatever share of the pot it is (HorseMind band read, readOut.bigBet);
 *  2. the Omaha aggressor tier (HorseEval.omahaAggressorTier) adds a tier for
 *     that mark exactly as it does for a bet of 70 percent of the pot or more,
 *     and the river tier requirement (omahaTierRequirement) then samples the
 *     bettor as 81 to 88 percent value of at least trips, a straight or a full
 *     house, and V56 holds weak trips to the strictest form of it;
 *  3. so a set is priced at 6 to 7 percent, trips at 13 and two pair at 6 to
 *     26 percent against a price of 25 to 27, and the committed-call bar and
 *     the river call verdict fold them (HorseLogic decidePostflop);
 *  4. on a paired board the paired-board fold (HorsePloPairedBoardFold) folds
 *     a flush or trips whose call is a quarter of the stack, at any price.
 * None of the four looks at the size of the bet as a share of the pot.
 *
 * The rule: PLO4 / PLO5 cash, high only, one board, the river. The Horse
 * faces the street's opening bet (no raise, none of its own chips in on the
 * street) of 40 to 70 percent of the pot, heads-up or with nobody left to act
 * behind it, and holds two pair or better in the engine's own classes (two
 * pair on a paired board is the one-pair class, as V51 / V61 read it, and is
 * out). A FOLD becomes a CALL when the price-based requirement is met: the
 * exact share of all the holdings the bettor could have that do NOT beat the
 * Horse's hand is at least RANGE_FACTOR times the price of the call
 * (to call / (pot + to call)). The factor is the margin for a betting range
 * being stronger than a random holding. Nothing else is changed: never a
 * raise, never a bet above 70 percent or under 40, never one pair, never a
 * fold that carries a continuation guard.
 *
 * Pure: no state, no random draws, no telemetry, no opponent read. The
 * caller (HorseLogic) withholds the call against a measured postflop value
 * leader (HorseOmahaReadConditional).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaMadeClass, scoreOmahaHiPartial } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaCashOnlyExcludes, omahaTournamentIcmPremium } from './HorseOmahaTournamentScope.js';
import { omahaStrategyGameInScope, omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { plo6MediumBetPriced, plo6PricingExcludes } from './HorsePlo6PricingPort.js';

export const OMAHA_RIVER_MEDIUM_BET_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** The bet's share of the pot before it: the measured band, both ends included. */
export const OMAHA_RIVER_MEDIUM_BET_MIN_POT_FRAC = 0.4;
export const OMAHA_RIVER_MEDIUM_BET_MAX_POT_FRAC = 0.7;
/** The engine's two-pair category (scoreOmahaHiPartial / 0x100000). */
const TWO_PAIR = 3;
/**
 * A betting range is stronger than a random holding: the Horse's hand must
 * hold up against a random holding this many times as often as the price asks.
 * 1.5 at half the pot (price 0.25) is 37.5 percent; at 70 percent of the pot
 * (price 0.29) 43.75 percent.
 */
export const OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR = 1.5;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;

function popcount(v: number): number {
  let x = v >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return Math.round(out);
}

/**
 * The exact share of the opponent holdings (as many hole cards as the Horse
 * holds, drawn from the cards the Horse cannot see) in which no two cards make
 * a better hand than the Horse's on this river board. A holding that ties
 * counts as not beating it. Null when the cards do not form a river hand.
 */
export function omahaRiverHoldsShare(
  hole: Card[],
  board: Card[],
  dead: Card[] = []
): number | null {
  if (!Array.isArray(hole) || !Array.isArray(board) || board.length !== 5) return null;
  // Six cards (SPEC-A 3.13, helper H17): the count is exact for any hole size.
  if (hole.length !== 4 && hole.length !== 5 && hole.length !== 6) return null;
  const known = [...hole, ...board, ...(Array.isArray(dead) ? dead : [])];
  if (known.some((c) => !c || !RANKS.includes(c.rank as never) || !SUITS.includes(c.suit as never)))
    return null;
  if (new Set([...hole, ...board].map(key)).size !== hole.length + 5) return null;
  const removed = new Set(known.map(key));
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) unseen.push(card);
    }
  const m = unseen.length;
  const n = hole.length;
  if (m < n || m > 47) return null;
  let hero: number;
  try {
    hero = scoreOmahaHiPartial(hole, board);
  } catch {
    return null;
  }
  if (!(hero > 0)) return null;
  // beats[i]: the unseen cards that, with card i, make a better hand (two 32-bit halves).
  const lo = new Int32Array(m);
  const hi = new Int32Array(m);
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      let s: number;
      try {
        s = scoreOmahaHiPartial([unseen[i], unseen[j]], board);
      } catch {
        return null;
      }
      if (s > hero) {
        if (j < 32) lo[i] |= 1 << j;
        else hi[i] |= 1 << (j - 32);
        if (i < 32) lo[j] |= 1 << i;
        else hi[j] |= 1 << (i - 32);
      }
    }
  const allLo = m >= 32 ? -1 : (1 << m) - 1;
  const allHi = m > 32 ? (1 << (m - 32)) - 1 : 0;
  // Holdings of n unseen cards with no beating pair inside: cards in rising
  // order, the cards barred by those already taken carried as a mask; the
  // last card is counted, not walked.
  const count = (start: number, left: number, barLo: number, barHi: number): number => {
    const fromLo = start >= 32 ? 0 : start === 0 ? -1 : ~((1 << start) - 1);
    const fromHi = start <= 32 ? -1 : ~((1 << (start - 32)) - 1);
    const freeLo = ~barLo & allLo & fromLo;
    const freeHi = ~barHi & allHi & fromHi;
    if (left === 1) return popcount(freeLo) + popcount(freeHi);
    let total = 0;
    for (let i = start; i <= m - left; i++) {
      const free = i < 32 ? (freeLo >>> i) & 1 : (freeHi >>> (i - 32)) & 1;
      if (!free) continue;
      total += count(i + 1, left - 1, barLo | lo[i], barHi | hi[i]);
    }
    return total;
  };
  const holdings = choose(m, n);
  if (!(holdings > 0)) return null;
  return count(0, n, 0, 0) / holdings;
}

export interface OmahaRiverMediumBetSpot {
  /** The seat whose river bet the Horse faces. */
  bettorSeat: number;
  /** The bet as a share of the pot before it. */
  potFrac: number;
  /** Chips the call puts in (the stack when smaller than the bet). */
  paid: number;
  /** paid / (the pot the call can win + paid). */
  price: number;
  /** The engine's made category (3 two pair ... 9 straight flush). */
  category: number;
  /** omahaRiverHoldsShare of the Horse's hand. */
  holds: number;
  /** holds >= RANGE_FACTOR * price. */
  priced: boolean;
  /** The call is for the whole stack (recorded as an all-in). */
  allIn: boolean;
}

/**
 * The spot the rule covers, with its numbers, or null outside it. It does not
 * look at the decision: the same function serves the rule, its receipts and
 * the worker's receipt validator.
 */
export function omahaRiverMediumBetSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverMediumBetSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!omahaStrategyGameInScope(OMAHA_RIVER_MEDIUM_BET_VARIANTS, gs)) return null;
    // Cash only, read as HorseLogic.isTournamentMode reads it;
    // omahaStrategyInTournaments (HorseOmahaTournamentScope) opens its public tournament scope.
    if (omahaCashOnlyExcludes(player, gs)) return null;
    if (
      gs.stage !== 'river' ||
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.allInOrFold ||
      gs.wagersCapped === true
    )
      return null;
    const board = gs.communityCards ?? [];
    const hole = player.cards ?? [];
    if (board.length !== 5 || hole.length !== Number(variant.at(-1))) return null;
    // PLO6 (SPEC-A 3.13 item 6): cash only, no bomb pot.
    if (hole.length === 6 && plo6PricingExcludes(gs)) return null;
    if (!Number.isFinite(player.bet) || !Number.isFinite(gs.currentBet)) return null;
    // What the Horse owes: gs.toCall, or the current bet less its own chips
    // when the state carries no toCall (the league; audit 2026-11-15, item 3).
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Math.max(0, gs.currentBet - player.bet);
    if (
      !(toCall > 0.005) ||
      !Number.isFinite(gs.pot) ||
      !Number.isFinite(player.stack) ||
      !(player.stack > 0) ||
      !Number.isFinite(player.bet) ||
      // none of the Horse's own chips in on the river: a bet, not a raise of its bet
      Math.abs(player.bet) > 0.005 ||
      player.is_folded ||
      player.is_all_in ||
      player.is_sitting_out
    )
      return null;
    if (Math.abs(gs.currentBet - toCall) > 0.011) return null;

    // The street's opening bet and nothing over it.
    const wagers = (gs.actionHistory ?? []).filter(
      (a) => a.stage === 'river' && ['bet', 'raise', 'all_in'].includes(a.action)
    );
    const opener = wagers[0];
    if (!opener || opener.seat === player.seat) return null;
    if (opener.action === 'raise') return null;
    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, 'river', bets, gs.pot);
    if (
      !faced ||
      faced.bettorSeat !== opener.seat ||
      Math.abs(faced.wager - opener.amount) > 0.011 ||
      Math.abs(opener.amount - gs.currentBet) > 0.011
    )
      return null;
    // Any later all-in must be a call for less, never a raise over the bet.
    if (wagers.some((a) => a !== opener && a.amount > opener.amount + 0.011)) return null;
    const potFrac = faced.wager / faced.potBefore;
    if (
      potFrac + 1e-9 < OMAHA_RIVER_MEDIUM_BET_MIN_POT_FRAC ||
      potFrac - 1e-9 > OMAHA_RIVER_MEDIUM_BET_MAX_POT_FRAC
    )
      return null;

    // Heads-up, or closing the action: nobody left to act behind the Horse.
    const others = gs.players.filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (others.length === 0) return null;
    if (others.some((p) => !p.is_all_in && p.bet + 0.011 < gs.currentBet)) return null;

    // Two pair or better in the engine's classes; two pair on a paired board
    // is its one-pair class. Kept for six cards too (pre-review finding 11):
    // the PLO6 calibration records the class bar as dropped because under its
    // beaten-share bars the bar never binds (SPEC-A 3.13); keeping it is the
    // stricter reading and costs nothing.
    const made = omahaMadeClass(hole, board);
    if (made.category < TWO_PAIR) return null;
    if (made.category === TWO_PAIR && (made.boardPaired || made.cls === 'board2p')) return null;

    const allIn = player.stack <= toCall + 0.005;
    const paid = Math.min(player.stack, toCall);
    // A state without a menu (the league) allows the call, as the sibling rules read it.
    if (
      Array.isArray(gs.legalActions) &&
      (allIn ? !gs.legalActions.includes('all_in') : !gs.legalActions.includes('call'))
    )
      return null;
    // A short call wins only what it covers of the bet it faces.
    const winnable = gs.pot - (others.length === 1 ? toCall - paid : 0);
    if (!(winnable > 0)) return null;
    const price = paid / (winnable + paid);
    const holds = omahaRiverHoldsShare(hole, board, player.knownDeadCards ?? []);
    if (holds === null) return null;
    return {
      bettorSeat: opener.seat,
      potFrac,
      paid,
      price,
      category: made.category,
      holds,
      // omahaStrategyInTournaments: a tournament call also pays the survival premium.
      // PLO6 (SPEC-A 3.13): the PLO5 "1.5 x price" class is not ported; the
      // fold becomes a call only under the M1 beaten bars.
      priced:
        hole.length === 6
          ? plo6MediumBetPriced(holds, board, price)
          : holds + 1e-12 >=
            omahaStrategyConstant('riverMediumBetRangeFactor', gs) * price +
              omahaTournamentIcmPremium(player, gs, paid),
      allIn,
    };
  } catch {
    return null;
  }
}

export interface OmahaRiverMediumBetResult {
  decision: HorseDecision;
  /** 'called': a fold became the call. 'unpriced': in the spot, the requirement not met. */
  changed: 'called' | 'unpriced' | null;
  spot: OmahaRiverMediumBetSpot | null;
}

/** A fold in the spot becomes the call when the price-based requirement is met. */
export function omahaRiverMediumBetCall(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  enabled: boolean
): OmahaRiverMediumBetResult {
  if (!enabled || decision.action !== 'fold') return { decision, changed: null, spot: null };
  // A guarded fold (a commitment floor or cold flush pressure refused the
  // continuation on the action itself) is never reopened.
  if (decision.continuationGuard !== undefined) return { decision, changed: null, spot: null };
  const spot = omahaRiverMediumBetSpot(player, gs);
  if (!spot) return { decision, changed: null, spot: null };
  if (!spot.priced) return { decision, changed: 'unpriced', spot };
  const called: HorseDecision = spot.allIn
    ? { ...decision, action: 'all_in' }
    : { ...decision, action: 'call', amount: spot.paid };
  // the whole-stack call carries no amount key at all
  if (spot.allIn) delete called.amount;
  return { decision: called, changed: 'called', spot };
}
