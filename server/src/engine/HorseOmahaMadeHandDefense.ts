/**
 * OMAHA: A MADE HAND THAT A POSSIBLE STRAIGHT OR FLUSH BEATS PLAYS DEFENSE
 * (Dan 2026-11-14, hands 59401453, 59414191 and 59416584).
 *
 * Three PLO5 cash hands on one evening. A set raised a pot-sized turn lead on
 * the card that made two straights possible and then bet the river into the
 * player who had led; a set bet out of position into the card that made a
 * straight possible; top two pair moved all in over that bet. The owner's
 * rulings, in substance: Horses must know that straights beat two pair and
 * sets; they play defense when the straight card comes; raising there is a
 * call at most; they stop paying off value raises with hands that beat no
 * value hand; and when they do hold the nuts they stop betting fractions of
 * the pot.
 *
 * Why it happened: the engine's raise, bet and commitment branches compare an
 * equity estimate to a bar. The nut measure (omahaNutStatus) is read only for
 * made straights and flushes, so two pair and sets were never asked whether
 * the board already beats them.
 *
 * This file holds the public-information measures and the final rules. They
 * run in the policy graph's wager_rules node after every owner that can raise
 * or bet, and before the call-discipline folds, so nothing later turns the
 * answer back into a raise or a bet.
 *
 * BEATEN (omahaBeatenByBoard): the board allows a made straight or flush
 * (three ranks inside a five-rank window, or three of a suit) and hero holds
 * two pair, a set or trips, a straight that is not the nut straight or sits
 * under a possible flush, or a flush that is not the nut flush. A full house
 * or better is never "beaten" here (the river rule in
 * HorseOmahaRiverNutRaise.ts owns under-fulls on the river).
 *
 * Rule 1 (omahaBeatenNoRaise), turn, facing a wager: a beaten hand never
 * raises. The raise or the all-in for more than the call becomes a call; when
 * the reference decision was a fold and a later owner raised it, the fold
 * comes back. An all-in that is itself the call is left alone. The river half
 * of this rule is omahaRiverNutRaiseOnly, unchanged.
 *
 * Rule 2 (omahaBeatenNoBet), turn or river, facing no wager, a beaten hand:
 *   - the straight or flush became possible on THIS street's card and a live
 *     opponent still acts behind (out of position): check;
 *   - river: a live opponent bet or raised on an earlier street on which
 *     that straight or flush was already possible: check.
 * In position and checked to on the fresh card the hand may still bet (the
 * engine's own value and protection size; hand 59401453's turn).
 *
 * NUT CLASS (omahaNutClassNow): the exact nuts for the street
 * (omahaCurrentNuts on the flop and turn, hasRiverNuts on the river) or the
 * effective-nut classes the river rule licenses. Rule 5
 * (omahaNutClassValueSize): a PLO4/PLO5 bet or raise with a nut-class hand is
 * the full pot (the pot-limit maximum, or the whole stack when the stack is
 * smaller), on the flop, turn and river. A wager that already covers every
 * opponent who can still put chips in is left as it is.
 *
 * Out of scope, unchanged: Hi-Lo, more than one board, fixed limit,
 * all-in-or-fold tables, and every game that is not Omaha.
 *
 * Public information only: hero's cards, the board, the public actions. No
 * opponent read is consulted; the rules are the same against Horse and human.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { RANKS, SUITS } from './PokerEngine.js';
import { omahaBoardShape, omahaBoatsAbove, omahaNutStatus, variantInfo } from './HorseEval.js';
import { omahaCurrentNuts } from './HorseOmahaCurrentNuts.js';
import { riverNutWagerTarget } from './HorseRiverNuts.js';
import {
  OMAHA_RIVER_NUT_RAISE_VARIANTS,
  omahaRiverRaiseLicense,
} from './HorseOmahaRiverNutRaise.js';

export const OMAHA_NUT_VALUE_SIZE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

const STREET_BOARD: Record<string, number> = { flop: 3, turn: 4, river: 5 };

const toCallOf = (hero: SeatPlayer, gs: HorseGameStateV2): number =>
  Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));

/** The street the rules govern at this node, or null (variant, board, table). */
export function omahaMadeHandDefenseStreet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  variants: ReadonlySet<string> = OMAHA_RIVER_NUT_RAISE_VARIANTS
): 'flop' | 'turn' | 'river' | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!variants.has(variant)) return null;
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
  if ((gs.communityCards ?? []).length !== STREET_BOARD[stage]) return null;
  if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
  return stage;
}

export interface OmahaBoardThreat {
  /** Some two hole cards make a straight on this board. */
  straight: boolean;
  /** Some two hole cards make a flush on this board. */
  flush: boolean;
}

export function omahaBoardThreat(board: Card[]): OmahaBoardThreat {
  if (!Array.isArray(board) || board.length < 3) return { straight: false, flush: false };
  const shape = omahaBoardShape(board);
  return { straight: shape.straightPossible, flush: shape.flushPossible };
}

/** What the last board card made possible that was not possible before it. */
export function omahaFreshThreat(board: Card[]): OmahaBoardThreat {
  if (!Array.isArray(board) || board.length < 4) return { straight: false, flush: false };
  const now = omahaBoardThreat(board);
  const before = omahaBoardThreat(board.slice(0, -1));
  return { straight: now.straight && !before.straight, flush: now.flush && !before.flush };
}

/**
 * True when a made straight or flush is possible on the board and hero's made
 * hand (two pair up to a flush) does not beat it. One pair and less are not
 * "made hands" here; a full house or better is never beaten here.
 */
export function omahaBeatenByBoard(hole: Card[], board: Card[]): boolean {
  try {
    const threat = omahaBoardThreat(board);
    if (!threat.straight && !threat.flush) return false;
    const status = omahaNutStatus(hole, board);
    const cat = status.category;
    if (cat < 3 || cat >= 7) return false;
    if (cat === 6) return status.higherFlushRanks > 0;
    if (cat === 5) return !status.straightIsNut || status.flushPossible;
    return true;
  } catch {
    return false;
  }
}

/**
 * The nuts or an effective-nut hand for the street: the exact current nuts,
 * or a full house or better no bigger full house beats, the nut flush on an
 * unpaired board, the nut straight on an unpaired board with no possible
 * flush. An evaluator failure is "no".
 */
export function omahaNutClassNow(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    const hole: Card[] = hero.cards;
    const board: Card[] = gs.communityCards ?? [];
    if (board.length === 5) return omahaRiverRaiseLicense(hero, gs) !== null;
    if (board.length !== 3 && board.length !== 4) return false;
    const status = omahaNutStatus(hole, board);
    if (status.category < 4) return false;
    const paired = new Set(board.map((c) => c.rank)).size < board.length;
    if (status.category >= 7) {
      if (omahaBoatsAbove(hole, board).boats === 0) return true;
    } else if (status.category === 6) {
      if (status.higherFlushRanks === 0 && !paired) return true;
    } else if (status.category === 5) {
      if (status.straightIsNut && !status.flushPossible && !paired) return true;
    }
    return omahaCurrentNuts(hole, board, hero.knownDeadCards ?? [])?.nuts === true;
  } catch {
    return false;
  }
}

/**
 * The share of the unseen river cards that lift a beaten turn hand over the
 * straights and flushes: to a full house or better, or to the nut flush or
 * nut straight on the board that card makes. 0 when it cannot be computed.
 */
export function omahaTurnRedrawShare(hole: Card[], board: Card[], dead: Card[] = []): number {
  try {
    if (!Array.isArray(board) || board.length !== 4) return 0;
    const key = (c: Card) => `${c.rank}:${c.suit}`;
    const removed = new Set([...hole, ...board, ...dead].map(key));
    let unseen = 0;
    let outs = 0;
    for (const suit of SUITS)
      for (const rank of RANKS) {
        const card = { rank, suit } as Card;
        if (removed.has(key(card))) continue;
        unseen++;
        const river = [...board, card];
        const st = omahaNutStatus(hole, river);
        const paired = new Set(river.map((c) => c.rank)).size < river.length;
        if (
          st.category >= 7 ||
          (st.category === 6 && st.higherFlushRanks === 0 && !paired) ||
          (st.category === 5 && st.straightIsNut && !st.flushPossible && !paired)
        )
          outs++;
      }
    return unseen > 0 ? outs / unseen : 0;
  } catch {
    return 0;
  }
}

export interface OmahaDefenseResult {
  decision: HorseDecision;
  changed: 'flatted' | 'fold_restored' | 'fresh_card_check' | 'river_check' | 'pot_sized' | null;
}

/**
 * Rule 1, the turn: a beaten made hand facing a wager never raises.
 * `reference` is the decision the brain made before the later policy owners
 * ran; when it was a fold, the raise goes back to that fold.
 */
export function omahaBeatenNoRaise(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  enabled: boolean,
  reference?: HorseDecision | null
): OmahaDefenseResult {
  const same: OmahaDefenseResult = { decision, changed: null };
  if (!enabled) return same;
  if (decision.action !== 'raise' && decision.action !== 'all_in') return same;
  try {
    if (omahaMadeHandDefenseStreet(hero, gs) !== 'turn') return same;
    const toCall = toCallOf(hero, gs);
    if (!(toCall > 0.005)) return same;
    const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
    // A shove for no more than the call is a call, not a raise.
    if (decision.action === 'all_in' && stack <= toCall + 0.005) return same;
    if (!omahaBeatenByBoard(hero.cards, gs.communityCards ?? [])) return same;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    if (reference && reference.action === 'fold' && (!legal || legal.includes('fold'))) {
      const folded: HorseDecision = { ...decision, action: 'fold' };
      delete folded.amount;
      return { decision: folded, changed: 'fold_restored' };
    }
    if (legal && !legal.includes('call')) return same;
    return {
      decision: { ...decision, action: 'call', amount: Math.round(toCall * 100) / 100 },
      changed: 'flatted',
    };
  } catch {
    return same;
  }
}

const WAGERS = new Set(['bet', 'raise', 'all_in']);

/** Why a beaten hand facing no wager must check here, or null. */
export function omahaBeatenMustCheck(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): 'fresh_card_check' | 'river_check' | null {
  const street = omahaMadeHandDefenseStreet(hero, gs);
  if (street !== 'turn' && street !== 'river') return null;
  if (toCallOf(hero, gs) > 0.005) return null;
  const board: Card[] = gs.communityCards ?? [];
  if (!omahaBeatenByBoard(hero.cards, board)) return null;
  // The river rule's licensed hands are not beaten for this purpose either.
  if (street === 'river' && omahaRiverRaiseLicense(hero, gs) !== null) return null;
  const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
  );
  const fresh = omahaFreshThreat(board);
  if (fresh.straight || fresh.flush) {
    const acted = new Set(history.filter((a) => String(a.stage) === street).map((a) => a.seat));
    // Out of position by the button as well as by the record: a player acts
    // behind hero when it has not acted on the street and sits later in the
    // postflop order (the seat left of the button acts first).
    const dealer = Number.isFinite(gs.dealerSeat) ? (gs.dealerSeat as number) : null;
    const span = Math.max(hero.seat, dealer ?? 0, ...live.map((p) => p.seat)) + 1;
    const order = (seat: number) => (dealer === null ? 0 : (seat - dealer - 1 + 2 * span) % span);
    const behind = live.some(
      (p) =>
        !p.is_all_in &&
        (p.stack ?? 0) > 0 &&
        !acted.has(p.seat) &&
        (dealer === null || order(p.seat) > order(hero.seat))
    );
    if (behind) return 'fresh_card_check';
  }
  if (street === 'river') {
    const now = omahaBoardThreat(board);
    const liveSeats = new Set(live.map((p) => p.seat));
    for (const [stage, n] of [
      ['flop', 3],
      ['turn', 4],
    ] as const) {
      const then = omahaBoardThreat(board.slice(0, n));
      if (!((then.straight && now.straight) || (then.flush && now.flush))) continue;
      if (
        history.some(
          (a) => String(a.stage) === stage && liveSeats.has(a.seat) && WAGERS.has(String(a.action))
        )
      )
        return 'river_check';
    }
  }
  return null;
}

/** Rule 2: a beaten made hand facing no wager checks in the two spots above. */
export function omahaBeatenNoBet(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  enabled: boolean
): OmahaDefenseResult {
  const same: OmahaDefenseResult = { decision, changed: null };
  if (!enabled) return same;
  if (decision.action !== 'bet' && decision.action !== 'raise' && decision.action !== 'all_in')
    return same;
  try {
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return same;
    const why = omahaBeatenMustCheck(hero, gs);
    if (why === null) return same;
    const checked: HorseDecision = { ...decision, action: 'check' };
    delete checked.amount;
    return { decision: checked, changed: why };
  } catch {
    return same;
  }
}

/**
 * Rule 5: a PLO4/PLO5 bet or raise with a nut-class hand is the full pot.
 * Never sizes down, never turns a check or a call into a wager.
 */
export function omahaNutClassValueSize(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  enabled: boolean
): OmahaDefenseResult {
  const same: OmahaDefenseResult = { decision, changed: null };
  if (!enabled) return same;
  if (decision.action !== 'bet' && decision.action !== 'raise') return same;
  try {
    if (
      gs.stateSchemaVersion !== 1 ||
      gs.wagersCapped === true ||
      !Array.isArray(gs.legalActions) ||
      !gs.legalActions.includes(decision.action) ||
      !Number.isFinite(decision.amount) ||
      !Number.isFinite(hero.stack) ||
      !Number.isFinite(hero.bet) ||
      !Number.isFinite(gs.currentBet) ||
      !Number.isFinite(gs.minRaiseTo) ||
      !Number.isFinite(gs.maxRaiseTo)
    )
      return same;
    if (omahaMadeHandDefenseStreet(hero, gs, OMAHA_NUT_VALUE_SIZE_VARIANTS) === null) return same;
    if (decision.action === 'raise' && !(toCallOf(hero, gs) > 0.005)) return same;
    if (decision.action === 'bet' && toCallOf(hero, gs) > 0.005) return same;
    const total = Math.round((hero.bet + hero.stack) * 100) / 100;
    const max = gs.maxRaiseTo as number;
    // The wager already covers every opponent who can still put chips in: a
    // larger number wins nothing more (heads-up matched commitment).
    const covered = (gs.players ?? [])
      .filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out && !p.is_all_in)
      .map(
        (p) =>
          (Number.isFinite(p.bet) ? (p.bet ?? 0) : 0) + (Number.isFinite(p.stack) ? p.stack : 0)
      );
    if (covered.length === 0 || (decision.amount as number) >= Math.max(...covered) - 0.005)
      return same;
    // The pot wager is more than the stack: the whole stack is the wager.
    if (max > total + 0.005) {
      if (!gs.legalActions.includes('all_in') || !omahaNutClassNow(hero, gs)) return same;
      const shoved: HorseDecision = { ...decision, action: 'all_in' };
      delete shoved.amount;
      return { decision: shoved, changed: 'pot_sized' };
    }
    const target = riverNutWagerTarget(decision.action, hero, gs);
    if (target === null || !(target > (decision.amount as number) + 0.005)) return same;
    if (!omahaNutClassNow(hero, gs)) return same;
    if (target >= total - 0.005 && gs.legalActions.includes('all_in')) {
      const shoved: HorseDecision = { ...decision, action: 'all_in' };
      delete shoved.amount;
      return { decision: shoved, changed: 'pot_sized' };
    }
    return { decision: { ...decision, amount: target }, changed: 'pot_sized' };
  } catch {
    return same;
  }
}
