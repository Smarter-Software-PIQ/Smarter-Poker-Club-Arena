/**
 * OMAHA: THREE BETS THAT BECOME CHECKS (owner 2026-11-15, hand 59517323; three
 * options, each default OFF and read `=== true`).
 *
 * One PLO5 cash hand. A Horse 4-bet aces, was called by one player who had
 * position, bet the flop 5-8-9 two-tone with the bare overpair and backdoor
 * draws, was called, bet the turn with the overpair and a flush draw it had
 * picked up, was called, and on the river that paired the board bet a quarter
 * of the pot with aces up into the player who had called both streets. That
 * player moved all in with a full house and the Horse paid it off. The owner's
 * rulings, in substance: out of position that flop is a check; called on the
 * flop and not improved, the turn is a check; the river was a terrible card
 * and defence should have been played.
 *
 * Why it happened: each street's bet came from an equity bar (the flop EV
 * comparator, the turn value/barrel branches, the river out-of-position block
 * bet). Position enters those only as a realisation or frequency factor, and
 * none asks what the hands that called are. The 2026-11-06 paired-board river
 * check needs the board paired by the turn; the made-hand defence's river
 * check needs an opponent who bet or raised earlier, not one who called.
 *
 * This file holds the three public-information spots. HorseLogic
 * (omahaOopCheckRules, wager_rules node, after the paired-board river check)
 * turns a bet in such a spot into a check:
 *
 *  - omahaBareOverpairOopFlopCheck: flop, an opponent still acts behind, one
 *    pair only, no flush draw and under eight straight outs, the flop two-tone
 *    or connected. No opponent read: heads-up and multiway.
 *  - omahaOverpairNoOopBarrelVsValueLeader: turn, heads-up, the opponent acts
 *    behind and called the Horse's flop bet, one pair only (a draw picked up,
 *    the nut flush draw included, is not an improved made hand), a straight
 *    possible on the board; only against a MEASURED postflop value leader.
 *  - omahaPairedRiverNoThinLeadVsValueLeader: river, the final board paired,
 *    less than a full house, a live opponent called the Horse's flop or turn
 *    bet; only when every live opponent is a MEASURED postflop value leader.
 *
 * Scope of all three: PLO4 and PLO5 cash, pot limit, one board, high only,
 * nothing to call, check legal. A call or fold facing a bet is never touched.
 * The spots read hero's cards, the board and the public actions; the value
 * leader read (HorseOmahaReadConditional, never a presumed read) is applied by
 * HorseLogic.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaBoardShape, omahaDrawQuality, omahaMadeClass, variantInfo } from './HorseEval.js';

export const OMAHA_OOP_CHECK_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

const STREET_BOARD: Record<string, number> = { flop: 3, turn: 4, river: 5 };
const ONE_PAIR = 2;
const FULL_HOUSE = 7;
/** Eight straight outs is the open-ended draw; fewer is a gutshot or a backdoor. */
export const OMAHA_OOP_CHECK_STRAIGHT_DRAW_OUTS = 8;

type Street = 'flop' | 'turn' | 'river';

/** The street at this node when all three options' common scope holds, else null. */
export function omahaOopCheckStreet(hero: SeatPlayer, gs: HorseGameStateV2): Street | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_OOP_CHECK_VARIANTS.has(variant)) return null;
  const stage = String(gs.stage ?? '');
  if (stage !== 'flop' && stage !== 'turn' && stage !== 'river') return null;
  const vi = variantInfo(variant);
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
  if (
    (gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0
  )
    return null;
  if (gs.allInOrFold === true) return null;
  // Cash only (HorseLogic.isTournamentMode's own reading).
  if (
    gs.gameMode ? gs.gameMode === 'tournament' : gs.tournament != null || (gs.bigBlind ?? 0) >= 10
  )
    return null;
  if ((gs.communityCards ?? []).length !== STREET_BOARD[stage]) return null;
  if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
  if (toCall > 0.005) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
  return stage;
}

const liveOpponents = (hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer[] =>
  (gs.players ?? []).filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out);

/**
 * Out of position: a live opponent with chips has not acted on this street
 * and sits later in the postflop order (the seat left of the button acts
 * first). The made-hand defence's own reading.
 */
export function omahaOpponentActsBehind(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  const street = String(gs.stage ?? '');
  const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
  const live = liveOpponents(hero, gs);
  const acted = new Set(history.filter((a) => String(a.stage) === street).map((a) => a.seat));
  const dealer = Number.isFinite(gs.dealerSeat) ? (gs.dealerSeat as number) : null;
  if (dealer === null) return false;
  const span = Math.max(hero.seat, dealer, ...live.map((p) => p.seat)) + 1;
  const order = (seat: number) => (seat - dealer - 1 + 2 * span) % span;
  return live.some(
    (p) =>
      !p.is_all_in && (p.stack ?? 0) > 0 && !acted.has(p.seat) && order(p.seat) > order(hero.seat)
  );
}

/** The seats that called hero's own last bet or raise on `stage` (empty when hero was not the last aggressor). */
export function omahaCallersOfHeroBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  stage: 'flop' | 'turn'
): Set<number> {
  let lastAggressor: number | null = null;
  let callers = new Set<number>();
  for (const a of gs.actionHistory ?? []) {
    if (String(a.stage) !== stage) continue;
    const act = String(a.action);
    if (act === 'bet' || act === 'raise' || act === 'all_in') {
      // An all-in that does not raise is a call of the standing wager.
      if (act === 'all_in' && lastAggressor !== null && a.isFullRaise !== true) {
        callers.add(a.seat);
        continue;
      }
      lastAggressor = a.seat;
      callers = new Set<number>();
    } else if (act === 'call' && a.seat !== lastAggressor) {
      callers.add(a.seat);
    }
  }
  return lastAggressor === hero.seat ? callers : new Set<number>();
}

const category = (hole: Card[], board: Card[]): number => omahaMadeClass(hole, board).category;

/**
 * omahaBareOverpairOopFlopCheck: flop, an opponent acts behind, exactly one
 * pair, no flush draw, fewer than eight straight outs, and the flop is
 * two-tone (two or more of a suit) or allows a straight.
 */
export function omahaBareOverpairOopFlopSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'flop') return false;
    const board: Card[] = gs.communityCards ?? [];
    if (category(hero.cards, board) !== ONE_PAIR) return false;
    const suits = new Map<string, number>();
    for (const c of board) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
    const twoTone = Array.from(suits.values()).some((n) => n >= 2);
    if (!twoTone && !omahaBoardShape(board).straightPossible) return false;
    const draw = omahaDrawQuality(hero.cards, board, false);
    if (draw.nutFlushDraw || draw.dominatedFlushDraw) return false;
    if (draw.straightOuts >= OMAHA_OOP_CHECK_STRAIGHT_DRAW_OUTS) return false;
    return omahaOpponentActsBehind(hero, gs);
  } catch {
    return false;
  }
}

/**
 * omahaOverpairNoOopBarrelVsValueLeader, the public half: turn, exactly one
 * live opponent, who acts behind and called hero's flop bet; exactly one pair
 * (draws are not read); a straight is possible on the board.
 */
export function omahaOverpairOopTurnBarrelSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'turn') return false;
    const live = liveOpponents(hero, gs);
    if (live.length !== 1) return false;
    const board: Card[] = gs.communityCards ?? [];
    if (!omahaBoardShape(board).straightPossible) return false;
    if (category(hero.cards, board) !== ONE_PAIR) return false;
    if (!omahaCallersOfHeroBet(hero, gs, 'flop').has(live[0].seat)) return false;
    return omahaOpponentActsBehind(hero, gs);
  } catch {
    return false;
  }
}

/**
 * omahaPairedRiverNoThinLeadVsValueLeader, the public half: river, the final
 * board paired (on any street), less than a full house, and a live opponent
 * called hero's own flop or turn bet.
 */
export function omahaPairedRiverThinLeadSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'river') return false;
    const board: Card[] = gs.communityCards ?? [];
    if (!omahaBoardShape(board).paired) return false;
    const cat = category(hero.cards, board);
    if (!(cat > 0) || cat >= FULL_HOUSE) return false;
    const live = new Set(liveOpponents(hero, gs).map((p) => p.seat));
    if (live.size === 0) return false;
    for (const stage of ['flop', 'turn'] as const)
      for (const seat of omahaCallersOfHeroBet(hero, gs, stage)) if (live.has(seat)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Any of the three spots: what the worker receipt validator admits as a bet turned into a check. */
export function omahaOopCheckSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  return (
    omahaBareOverpairOopFlopSpot(hero, gs) ||
    omahaOverpairOopTurnBarrelSpot(hero, gs) ||
    omahaPairedRiverThinLeadSpot(hero, gs)
  );
}
