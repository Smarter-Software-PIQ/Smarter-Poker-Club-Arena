/**
 * Priced rebuild of two Hold'em Strategy items that could not land as written (Antigravity 633eec005d5
 * "Ace-High jamming gate, board discipline" and 6496e1610f0 "BB overfold fix", preserved locally as
 * archive/holdem-strategy/ace-high-jam-board-discipline-633eec0 and archive/heads-up/bb-overfold-6496e16).
 * Those commits keyed a forced all-in to a hand class and an unmeasured 0.40 pot fraction, and subtracted an
 * unmeasured flat 0.15 from equity on four-flush and four-straight boards. Owner order (2026-11-17 11:49 Chicago)
 * and Coordinator rule #4: no blanket rules and no unmeasured thresholds; every decision is priced by ranges,
 * equity, price and EV, with every empirical figure measured and cited beside its constant. Both options below
 * are default OFF (read strictly `=== true`).
 *
 * holdemCommittedNoPairIsPriced: no-limit hold'em cash, one board, heads-up, the Horse holds no pair and no real
 * hole draw (high card only) and the committed branch is deciding a bet it faces. The witness hands targeted
 * (#59784826, #59784258) were committed ace-high hands that jammed over or called a big flop bet. With the option
 * on, the branch takes the best of fold, call and jam by expected value:
 *
 *   EV(fold) = 0
 *   EV(call) = E   * (P + C) * (1 - r) - C
 *   EV(jam)  = f * P * (1 - r) + (1 - f) * (Ec * (P + 2R - C) * (1 - r) - R)
 *
 *   P   the pot including his bet (before hero's call), C hero's effective call, R the whole jam hero can put in
 *       (his stack behind plus the call, capped by hero's stack); no jam when R <= C (it would be a call)
 *   r   the rake fraction the engine prices calls at (callDeductionFraction, else the marginal rake)
 *   E   the engine's equity against the bettor's range (eq15, after every cap)
 *   f   the share of postflop bets a person folds when a Horse raises them, at the price the jam lays him,
 *       (R - C) / (P + 2R - C): MEASURED (HOLDEM_RAISE_FOLD_SHARE_BY_PRICE)
 *   Ec  hero's equity against the part of his range that continues: his range is the top share of the unseen
 *       two-card combos by made strength on this board that reproduces E (calibrated to the engine's own range
 *       read), and he continues with its strongest (1 - f) share (holdemCalledRangeEquity).
 *
 * holdemDangerBoardEquityIsPriced: no-limit hold'em cash, one board, heads-up, turn or river, a four-flush or
 * four-straight board, the Horse holds exactly one pair and faces a bet. The equity used for the decision is
 * hero's exact equity against the bettor's range on this board instead of the engine's range read, which prices
 * the bettor by his preflop line and board contact, not by "bet when the fourth card came". His range is the
 * unseen two-card combos split into three classes by what they make now (no pair, one pair, two pair or better),
 * weighted by what people who bet such boards showed down (HOLDEM_DANGER_BOARD_BETTOR_SHOWN). That replaces the
 * flat 0.15 haircut; card removal by hero's hand (a blocker) is exact.
 */
import type { Card } from '../types.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  holdemCardId,
  packHoldemBoardBits,
  scoreHoldem,
  scoreHoldemPlus2Ids,
  type HoldemBoardBits,
} from './HorseEval.js';
import { SUITS, RANKS, RANK_VALUES } from './PokerEngine.js';
import {
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemBetWhenCheckedTo,
  readHudOpponentStat,
  type HoldemEmpiricalStreet,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

/**
 * MEASURED 2026-11-19 (read-only SELECT on production hand_history, no-limit hold'em cash with a person seated,
 * no bomb pot, 2026-10-20 05:00Z to 2026-11-19 06:00Z, query in scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql):
 * a person bet on the flop, turn or river, a Horse raised (or jammed) over it, and the person answered. By the
 * price the raise laid him (his call over the pot after it): under 0.20, 0 folds of 5; 0.20 to 0.30, 24 of 55;
 * 0.30 and above, 28 of 64 (no raise laid 0.40 or more). Laplace posterior mean per price class. No per-player
 * counter of folds to a postflop raise exists, so every bettor is priced at the population class of his price
 * (stated in the authority file). Pooled over every price the same window gives 52 of 124.
 */
export const HOLDEM_RAISE_FOLD_SHARE_BY_PRICE: readonly {
  below: number;
  folds: number;
  answers: number;
}[] = [
  { below: 0.2, folds: 0, answers: 5 },
  { below: 0.3, folds: 24, answers: 55 },
  { below: Infinity, folds: 28, answers: 64 },
];

/** The measured fold share of a person laid `price` (his call / (pot + his call)) by a Horse raise. */
export function holdemRaiseFoldShare(price: number): number {
  const p = Number.isFinite(price) ? Math.max(0, price) : 0;
  for (const c of HOLDEM_RAISE_FOLD_SHARE_BY_PRICE)
    if (p < c.below) return (c.folds + 1) / (c.answers + 2);
  return 0;
}

/**
 * Smooth, zero-cliff empirical fold share facing a committed all-in jam, backed by
 * `holdemEmpiricalPriors.ts` (`HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise`:
 * n = 294, 88/294 = 29.93% at avgVillainCallPrice = 0.1855).
 *
 * Below `avgVillainCallPrice`, scales quadratically `(p / avg)^2` so `f'(0) = 0`: this matches the
 * measured 0/5 folds below price 0.20 in `HOLDEM_RAISE_FOLD_SHARE_BY_PRICE` and eliminates the
 * zero-price min-jam arbitrage (where any linear slope `k > 1` credits a 1-chip or 20-to-1 min-jam
 * with phantom fold equity exceeding the chips risked). Above `avgVillainCallPrice`, scales linearly
 * up to 1.5x (44.9%, matching the measured 24/55 = 43.6% and 28/64 = 43.8% ceiling).
 *
 * When a lifetime `hudOpp` packet is supplied (`r.fRaise` or street `fBet`), shrinks smoothly
 * via `empiricalBayesShrink` and applies the same low-price quadratic attenuation below the
 * reference call price so tiny min-jams never manufacture phantom fold equity.
 */
export function holdemCommittedJamFoldShare(
  villainCallPrice: number,
  street?: HoldemEmpiricalStreet,
  hudOpp?: HoldemHudPacketOpponent | null
): number {
  const p = Number.isFinite(villainCallPrice) ? Math.max(0, villainCallPrice) : 0;
  if (!(p > 0)) return 0;
  const cell = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise;
  const normPrice = p / cell.avgVillainCallPrice;
  const highPriceScale = normPrice >= 1 ? Math.min(1.5, normPrice) : 1;
  const smallPriceScale = normPrice < 1 ? normPrice * normPrice : 1;
  const unattenuatedPrior = Math.min(0.45, Math.max(0, cell.foldRate * highPriceScale));
  const prior = Math.min(0.45, Math.max(0, unattenuatedPrior * smallPriceScale));

  const raiseStat = readHudOpponentStat(hudOpp, 'r.fRaise');
  if (raiseStat) {
    const shrunk = empiricalBayesShrink(
      raiseStat.hits,
      raiseStat.opportunities,
      unattenuatedPrior,
      HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
      'hud_context'
    );
    return Math.min(0.9, Math.max(0, shrunk.mean * smallPriceScale));
  }
  if (street) {
    const key = street === 'flop' ? 'f.fBet' : street === 'turn' ? 't.fBet' : 'r.fBet';
    const betStat = readHudOpponentStat(hudOpp, key);
    if (betStat) {
      const shrunk = empiricalBayesShrink(
        betStat.hits,
        betStat.opportunities,
        unattenuatedPrior,
        HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 2,
        'hud_street'
      );
      return Math.min(0.9, Math.max(0, shrunk.mean * smallPriceScale));
    }
  }
  return prior;
}

/**
 * Measured probability that villain fires a continuation barrel on remaining street(s) after hero
 * calls with bare high card and chips behind (`remainingEff > 0`), backed by
 * `estimateHoldemBetWhenCheckedTo` in `holdemEmpiricalPriors.ts`:
 *  - river: 0 (no future streets; call closes action)
 *  - turn:  river bet-when-checked-to (measured 1,619 / 5,180 = 31.25%, shrunk with HUD/Mind)
 *  - flop:  1 - (1 - pTurn) * (1 - pRiver) (turn 38.95% + river 31.25% => 58.03% combined pressure)
 */
export function holdemCommittedContinuationBarrelShare(
  street: HoldemEmpiricalStreet,
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'betCheckedTo' | 'betCheckedToOpp'> | null
): number {
  if (street === 'river') return 0;
  const pRiver = estimateHoldemBetWhenCheckedTo('river', hudOpp, exploitCounters).mean;
  if (street === 'turn') return pRiver;
  const pTurn = estimateHoldemBetWhenCheckedTo('turn', hudOpp, exploitCounters).mean;
  return Math.min(1, Math.max(0, 1 - (1 - pTurn) * (1 - pRiver)));
}

/**
 * MEASURED 2026-11-19 (same 30-day NLH cash window and filter, query in
 * scripts/horse-measure/sql/nlh-vpip-floor-and-danger-baseline.sql): the last bet or raise of the turn or river
 * by a person, on a board that held four of one suit or four ranks inside one five-rank window on that street,
 * when that person showed down (n = 50: turn 8, river 42): no pair 3, one pair 5, two pair or better 42. Laplace
 * posterior means with one count per class (4/53, 6/53, 43/53). Shown hands only (a bettor who was called and
 * showed; bluffs that won uncalled are missing, which overstates the value share) and the shown hand is the
 * river hand (a turn bettor's hand can have improved).
 */
export const HOLDEM_DANGER_BOARD_BETTOR_SHOWN = {
  noPair: 3,
  onePair: 5,
  twoPairPlus: 42,
  shares: { noPair: 4 / 53, onePair: 6 / 53, twoPairPlus: 43 / 53 },
} as const;

const CAT = 0x100000;
/** Some states spell the ten '10'; the evaluator and the deck spell it 'T'. */
const norm = (c: Card): Card => (String(c.rank) === '10' ? ({ ...c, rank: 'T' } as Card) : c);
const cardKey = (c: Card): string => `${norm(c).rank}${c.suit}`;

/** Every card not in `known`. */
export function unseenCards(known: readonly Card[]): Card[] {
  const seen = new Set(known.map(cardKey));
  const out: Card[] = [];
  for (const s of SUITS)
    for (const r of RANKS) if (!seen.has(`${r}${s}`)) out.push({ rank: r, suit: s } as Card);
  return out;
}

/** Four (or more) board cards of one suit. */
export function boardHasFourFlush(board: readonly Card[]): boolean {
  const n = new Map<string, number>();
  for (const c of board) n.set(c.suit, (n.get(c.suit) ?? 0) + 1);
  for (const v of n.values()) if (v >= 4) return true;
  return false;
}

/** Four distinct board ranks inside one five-rank window (any one card makes a straight); the ace plays low too. */
export function boardHasFourStraight(board: readonly Card[]): boolean {
  const ranks = new Set<number>();
  for (const c of board) {
    const v = RANK_VALUES[norm(c).rank];
    ranks.add(v);
    if (v === 14) ranks.add(1);
  }
  for (let lo = 1; lo <= 10; lo++) {
    let k = 0;
    for (let r = lo; r < lo + 5; r++) if (ranks.has(r)) k++;
    if (k >= 4) return true;
  }
  return false;
}

const score = (cards: Card[]): number => scoreHoldem(cards, cards.length, false);

interface ComboRow {
  /** the combo's made score on the current board (his strength now) */
  strength: number;
  /** hero's showdown equity against this combo */
  eq: number;
}

/** At most this many runouts per combo on the flop (a fixed, evenly strided subset: no random number). */
const FLOP_RUNOUTS = 45;

/** All 52 card IDs in exact `(for s of SUITS) (for r of RANKS)` unseenCards order. */
const DECK_IDS_BY_SUIT_RANK = new Uint8Array(52);
{
  let k = 0;
  for (const s of SUITS) {
    for (const r of RANKS) {
      DECK_IDS_BY_SUIT_RANK[k++] = holdemCardId({ rank: r, suit: s } as Card);
    }
  }
}

/**
 * Hero's equity against every unseen two-card combo, with the combo's made strength now. River: exact. Turn: every
 * river card. Flop: a fixed stride over the turn-river pairs of the unseen deck. Draws no random number.
 */
export function holdemComboRows(
  holeIn: readonly Card[],
  boardIn: readonly Card[],
  dead: readonly Card[]
): ComboRow[] {
  const hole = holeIn.map(norm);
  const board = boardIn.map(norm);
  const toCome = 5 - board.length;
  if (toCome < 0 || toCome > 2) return [];

  // Fast bitmask path: hoist all runout 5-card board states & hero scores outside the ~1,081-combo loop.
  if (hole.length === 2) {
    const h0 = holdemCardId(hole[0]);
    const h1 = holdemCardId(hole[1]);
    if (h0 >= 0 && h1 >= 0) {
      const seen = new Uint8Array(64);
      seen[h0] = 1;
      seen[h1] = 1;
      const boardIds = new Uint8Array(5);
      let ok = true;
      for (let i = 0; i < board.length; i++) {
        const id = holdemCardId(board[i]);
        if (id < 0) {
          ok = false;
          break;
        }
        boardIds[i] = id;
        seen[id] = 1;
      }
      if (ok) {
        for (let i = 0; i < dead.length; i++) {
          const id = holdemCardId(norm(dead[i]));
          if (id >= 0) seen[id] = 1;
        }
        const deckIds = new Uint8Array(52);
        let deckLen = 0;
        for (let i = 0; i < 52; i++) {
          const id = DECK_IDS_BY_SUIT_RANK[i];
          if (seen[id] === 0) deckIds[deckLen++] = id;
        }

        const currBoardBits = packHoldemBoardBits(boardIds, board.length);
        const rows: ComboRow[] = [];

        if (toCome === 0) {
          const heroScore = scoreHoldemPlus2Ids(currBoardBits, h0, h1, false);
          for (let i = 0; i < deckLen; i++) {
            const a = deckIds[i];
            for (let j = i + 1; j < deckLen; j++) {
              const v = scoreHoldemPlus2Ids(currBoardBits, a, deckIds[j], false);
              rows.push({ strength: v, eq: heroScore > v ? 1 : heroScore === v ? 0.5 : 0 });
            }
          }
          return rows;
        }

        if (toCome === 1) {
          const rHeroScore = new Int32Array(deckLen);
          const rBoardBits: HoldemBoardBits[] = new Array(deckLen);
          for (let r = 0; r < deckLen; r++) {
            boardIds[4] = deckIds[r];
            const bb = packHoldemBoardBits(boardIds, 5);
            rBoardBits[r] = bb;
            rHeroScore[r] = scoreHoldemPlus2Ids(bb, h0, h1, false);
          }
          for (let i = 0; i < deckLen; i++) {
            const a = deckIds[i];
            for (let j = i + 1; j < deckLen; j++) {
              const b = deckIds[j];
              let won = 0;
              let n = 0;
              for (let r = 0; r < deckLen; r++) {
                const rc = deckIds[r];
                if (rc === a || rc === b) continue;
                const h = rHeroScore[r];
                const v = scoreHoldemPlus2Ids(rBoardBits[r], a, b, false);
                won += h > v ? 1 : h === v ? 0.5 : 0;
                n++;
              }
              if (n === 0) continue;
              rows.push({
                strength: scoreHoldemPlus2Ids(currBoardBits, a, b, false),
                eq: won / n,
              });
            }
          }
          return rows;
        }

        // toCome === 2 (flop): exact same stride over all (i < j) pairs in deckIds.
        const totalPairs = (deckLen * (deckLen - 1)) >> 1;
        const step = Math.max(1, Math.floor(totalPairs / FLOP_RUNOUTS));
        const rCard0: number[] = [];
        const rCard1: number[] = [];
        let pairIdx = 0;
        let nextTake = 0;
        for (let i = 0; i < deckLen; i++) {
          for (let j = i + 1; j < deckLen; j++) {
            if (pairIdx === nextTake) {
              rCard0.push(deckIds[i]);
              rCard1.push(deckIds[j]);
              nextTake += step;
            }
            pairIdx++;
          }
        }
        const numRunouts = rCard0.length;
        const rHeroScore = new Int32Array(numRunouts);
        const rBoardBits: HoldemBoardBits[] = new Array(numRunouts);
        for (let r = 0; r < numRunouts; r++) {
          boardIds[3] = rCard0[r];
          boardIds[4] = rCard1[r];
          const bb = packHoldemBoardBits(boardIds, 5);
          rBoardBits[r] = bb;
          rHeroScore[r] = scoreHoldemPlus2Ids(bb, h0, h1, false);
        }
        for (let i = 0; i < deckLen; i++) {
          const a = deckIds[i];
          for (let j = i + 1; j < deckLen; j++) {
            const b = deckIds[j];
            let won = 0;
            let n = 0;
            for (let r = 0; r < numRunouts; r++) {
              const c0 = rCard0[r];
              const c1 = rCard1[r];
              if (c0 === a || c0 === b || c1 === a || c1 === b) continue;
              const h = rHeroScore[r];
              const v = scoreHoldemPlus2Ids(rBoardBits[r], a, b, false);
              won += h > v ? 1 : h === v ? 0.5 : 0;
              n++;
            }
            if (n === 0) continue;
            rows.push({
              strength: scoreHoldemPlus2Ids(currBoardBits, a, b, false),
              eq: won / n,
            });
          }
        }
        return rows;
      }
    }
  }

  // Generic fallback for non-2-card or malformed test inputs.
  const known = [...hole, ...board, ...dead.map(norm)];
  const deck = unseenCards(known);
  const rows: ComboRow[] = [];
  let runouts: Card[][] = [[]];
  if (toCome === 1) runouts = deck.map((c) => [c]);
  else if (toCome === 2) {
    const all: Card[][] = [];
    for (let i = 0; i < deck.length; i++)
      for (let j = i + 1; j < deck.length; j++) all.push([deck[i], deck[j]]);
    const step = Math.max(1, Math.floor(all.length / FLOP_RUNOUTS));
    runouts = [];
    for (let i = 0; i < all.length; i += step) runouts.push(all[i]);
  }
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const a = deck[i];
      const b = deck[j];
      const ka = cardKey(a);
      const kb = cardKey(b);
      let won = 0;
      let n = 0;
      for (const ro of runouts) {
        if (ro.some((c) => cardKey(c) === ka || cardKey(c) === kb)) continue;
        const full = [...board, ...ro];
        const h = score([...hole, ...full]);
        const v = score([a, b, ...full]);
        won += h > v ? 1 : h === v ? 0.5 : 0;
        n++;
      }
      if (n === 0) continue;
      rows.push({ strength: score([a, b, ...board]), eq: won / n });
    }
  }
  return rows;
}

/**
 * Hero's equity against the part of the bettor's range that continues against a jam. His range is the strongest
 * prefix of the combos (by made strength now) whose mean hero equity first reaches `equity` (the engine's figure);
 * he continues with the strongest (1 - foldShare) of it. Null when nothing can be enumerated.
 */
export function holdemCalledRangeEquity(
  rows: readonly ComboRow[],
  equity: number,
  foldShare: number
): { equityCalled: number; rangeShare: number } | null {
  if (rows.length === 0 || !Number.isFinite(equity) || !Number.isFinite(foldShare)) return null;
  const sorted = [...rows].sort((x, y) => y.strength - x.strength || x.eq - y.eq);
  const prefix: number[] = [0];
  for (const r of sorted) prefix.push(prefix[prefix.length - 1] + r.eq);
  let k = sorted.length;
  for (let i = 1; i <= sorted.length; i++)
    if (prefix[i] / i >= equity) {
      k = i;
      break;
    }
  const f = Math.min(1, Math.max(0, foldShare));
  const m = Math.max(1, Math.round((1 - f) * k));
  return { equityCalled: prefix[m] / m, rangeShare: k / sorted.length };
}

export interface HoldemCommittedNoPairPriceInput {
  pot: number;
  toCall: number;
  jamTotal: number;
  equity: number;
  equityCalled: number;
  foldShare: number;
  rake: number;
  /**
   * Optional effective chips remaining behind both players after hero calls (`min(stack - toCall, oppBehind)`).
   * When positive together with `barrelShare > 0` on flop or turn, EV(call) prices future-street barrel
   * pressure by backward induction instead of assuming 100% free showdown realization.
   */
  remainingEff?: number;
  /** Measured probability villain barrels on remaining street(s) when hero calls with chips behind. */
  barrelShare?: number;
  /** Hero's equity against the strongest `barrelShare` portion of villain's betting range. */
  equityVsBarrel?: number;
}
export interface HoldemCommittedNoPairPrice {
  evCall: number;
  evJam: number | null;
  action: 'fold' | 'call' | 'all_in';
}

/** The fold / call / jam comparison above; null when an input is not a usable number. */
export function holdemCommittedNoPairPrice(
  i: HoldemCommittedNoPairPriceInput
): HoldemCommittedNoPairPrice | null {
  const nums = [i.pot, i.toCall, i.jamTotal, i.equity, i.equityCalled, i.foldShare, i.rake];
  if (!nums.every(Number.isFinite) || !(i.pot > 0) || !(i.toCall > 0)) return null;
  const keep = 1 - Math.min(1, Math.max(0, i.rake));
  const e = Math.min(1, Math.max(0, i.equity));
  const ec = Math.min(1, Math.max(0, i.equityCalled));
  const f = Math.min(1, Math.max(0, i.foldShare));
  const potAfterCall = i.pot + i.toCall;
  const rem =
    typeof i.remainingEff === 'number' && Number.isFinite(i.remainingEff) && i.remainingEff > 0
      ? i.remainingEff
      : 0;
  const pBar =
    typeof i.barrelShare === 'number' && Number.isFinite(i.barrelShare)
      ? Math.min(1, Math.max(0, i.barrelShare))
      : 0;
  let evCall: number;
  if (rem > 0 && pBar > 0) {
    const nextBet = Math.min(rem, potAfterCall);
    const eBar =
      typeof i.equityVsBarrel === 'number' && Number.isFinite(i.equityVsBarrel)
        ? Math.min(e, Math.max(0, i.equityVsBarrel))
        : e;
    const evCheckBranch = Math.max(0, e - pBar * eBar) * potAfterCall * keep;
    const evBarrelBranch = pBar * Math.max(0, eBar * (potAfterCall + 2 * nextBet) * keep - nextBet);
    evCall = evCheckBranch + evBarrelBranch - i.toCall;
  } else {
    evCall = e * potAfterCall * keep - i.toCall;
  }
  const r = i.jamTotal;
  const evJam =
    r > i.toCall ? f * i.pot * keep + (1 - f) * (ec * (i.pot + 2 * r - i.toCall) * keep - r) : null;
  let action: HoldemCommittedNoPairPrice['action'] = 'fold';
  let best = 0;
  if (evCall > best) {
    best = evCall;
    action = 'call';
  }
  if (evJam !== null && evJam > best) action = 'all_in';
  return { evCall, evJam, action };
}

/**
 * Hero's equity against the bettor's range on a four-flush or four-straight board: the class-weighted mean of the
 * exact per-combo equities (classes by what the combo makes now; an empty class gives its weight to the rest).
 */
export function holdemDangerBoardBettorEquity(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[]
): number | null {
  const rows = holdemComboRows(hole, board, dead);
  const sum = [0, 0, 0];
  const n = [0, 0, 0];
  for (const r of rows) {
    const c = Math.floor(r.strength / CAT);
    const k = c <= 1 ? 0 : c === 2 ? 1 : 2;
    sum[k] += r.eq;
    n[k]++;
  }
  const w = HOLDEM_DANGER_BOARD_BETTOR_SHOWN.shares;
  const weights = [w.noPair, w.onePair, w.twoPairPlus];
  let num = 0;
  let den = 0;
  for (let k = 0; k < 3; k++) {
    if (n[k] === 0) continue;
    num += weights[k] * (sum[k] / n[k]);
    den += weights[k];
  }
  return den > 0 ? num / den : null;
}

/**
 * holdemCommittedNoPairIsPriced end to end: enumerate the combos, calibrate his range to the engine's equity,
 * price his continuing range at the smooth empirical all-in fold share (`holdemCommittedJamFoldShare`),
 * price future-street continuation barrel pressure when calling non-all-in on flop/turn, and compare fold,
 * call and jam. Null: nothing priced.
 */
export function holdemCommittedNoPairDecision(i: {
  hole: readonly Card[];
  board: readonly Card[];
  dead: readonly Card[];
  pot: number;
  toCall: number;
  jamTotal: number;
  equity: number;
  rake: number;
  street?: HoldemEmpiricalStreet;
  remainingEff?: number;
  hudOpp?: HoldemHudPacketOpponent | null;
  exploitCounters?: Pick<ExploitCounters, 'betCheckedTo' | 'betCheckedToOpp'> | null;
}):
  | (HoldemCommittedNoPairPrice & {
      equityCalled: number;
      rangeShare: number;
      foldShare: number;
      barrelShare: number;
      equityVsBarrel: number | null;
    })
  | null {
  const rows = holdemComboRows(i.hole, i.board, i.dead);
  const raise = i.jamTotal - i.toCall;
  const street: HoldemEmpiricalStreet =
    i.street ?? (i.board.length >= 5 ? 'river' : i.board.length === 4 ? 'turn' : 'flop');
  const foldShare =
    raise > 0
      ? holdemCommittedJamFoldShare(raise / (i.pot + i.jamTotal + raise), street, i.hudOpp)
      : 0;
  const called = holdemCalledRangeEquity(rows, i.equity, foldShare);
  if (called === null) return null;
  const rem =
    typeof i.remainingEff === 'number' && Number.isFinite(i.remainingEff) && i.remainingEff > 0
      ? i.remainingEff
      : 0;
  let barrelShare = 0;
  let equityVsBarrel: number | null = null;
  if (street !== 'river' && rem > 0) {
    barrelShare = holdemCommittedContinuationBarrelShare(street, i.hudOpp, i.exploitCounters);
    if (barrelShare > 0) {
      const vsBarrel = holdemCalledRangeEquity(rows, i.equity, 1 - barrelShare);
      equityVsBarrel = vsBarrel ? vsBarrel.equityCalled : null;
    }
  }
  const price = holdemCommittedNoPairPrice({
    pot: i.pot,
    toCall: i.toCall,
    jamTotal: i.jamTotal,
    equity: i.equity,
    equityCalled: called.equityCalled,
    foldShare,
    rake: i.rake,
    remainingEff: rem,
    barrelShare,
    equityVsBarrel: equityVsBarrel ?? undefined,
  });
  return price === null ? null : { ...price, ...called, foldShare, barrelShare, equityVsBarrel };
}
