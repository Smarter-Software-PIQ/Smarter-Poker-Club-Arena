/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE HAND CLASSES — the shape of the hand, which a percentile cannot see
 * (V46, 2026-09-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * From the deep audit, section 5.1: "NO SOLVER DATA EXISTS FOR ANY OF THESE
 * GAMES", covering 55% of cash seat-hands and 58% of tournament seat-hands.
 *
 * What exists today is right as far as it goes. HorseEval maps every variant
 * onto the hold em percentile ladder, so a bar selects the same QUALITY of
 * hand in every game, and HorseVariantProfile (V35) shifts that bar per
 * variant so PLO opens wider and 3-bets narrower. Both are blind to the same
 * thing:
 *
 *   IN OMAHA THE SHAPE OF THE FOUR CARDS DECIDES THE HAND, AND A PERCENTILE
 *   CANNOT SEE SHAPE.
 *
 * Three consequences, all of them visible in the review table:
 *
 *   - AAA-x READS STRONG. A percentile evaluator sees three aces as a
 *     monster. In Omaha it is close to unplayable: the third ace is dead, the
 *     hand has no redraw, and it flops an overpair and nothing else.
 *   - A RUNDOWN READS MEDIOCRE. JT98 double-suited is one of the best hands
 *     in the game multiway; on the hold em ladder it is a middling
 *     percentile.
 *   - 3-BETTING IS ANCHORED ON NOTHING. Published PLO strategy 3-bets around
 *     AAxx (double-suited most, rainbow least) and FLATS almost everything
 *     else, because a 3-bet gets called and then plays a pot-sized pot out of
 *     position with a hand that is 55/45 at best. The engine's 3-bet bar is
 *     one number for every shape.
 *
 * Short deck has its own version of the same problem: strip the deuces
 * through fives and suited connectors and suited aces gain enormously
 * (straights and flushes arrive far more often), while pairs LOSE value - a
 * set is no longer near-nuts when flushes beat full houses and everyone
 * connects with everything.
 *
 * THIS FILE IS NOT A SOLVER EXPORT AND DOES NOT PRETEND TO BE. It is the
 * published hand-class structure of these games, applied where the engine has
 * none, in the SAME BAR UNITS V35 already uses, behind an ablation flag with
 * a league matchup. When a real PLO or 6+ solver export arrives it replaces
 * these numbers and keeps this shape.
 *
 * Pure: no imports but the card type and the rank table, so the tests and the
 * league can load it without the engine.
 *
 * NEVER refer to the horses as "bots" - they are HORSES only.
 */

import { RANK_VALUES } from './PokerEngine.js';
import type { Card } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// CLASSES
// ─────────────────────────────────────────────────────────────────────────────

export type OmahaHandClass =
  /** a pair of aces, double-suited or with an ace suited - the 3-bet anchor */
  | 'aa_ds'
  /** a pair of aces, rainbow or one weak suit - equity without playability */
  | 'aa_dry'
  /** four broadway cards, double-suited */
  | 'broadway_ds'
  /** four connected or one-gap cards, nine-high or better */
  | 'rundown'
  /** kings or queens with real suit or connection support */
  | 'kk_plus'
  /** a big pair with two connected or suited side cards */
  | 'pair_support'
  /** three good cards and one disconnected low card */
  | 'dangler'
  /** three or four of a rank in hand - the percentile lies about this hand */
  | 'trips'
  /** double-paired low, disconnected rainbow, no ace */
  | 'trash'
  /** nothing the chart has an opinion about */
  | 'other';

export type ShortDeckHandClass =
  /** an ace with a suited card - the nut flush draw IS the hand */
  | 'sd_suited_ace'
  /** JJ+ : strong, but it stacks off less than its hold em twin */
  | 'sd_big_pair'
  /** suited connector or one-gapper */
  | 'sd_suited_conn'
  /** 66-TT : the value published theory takes away (sets lose to flushes) */
  | 'sd_small_pair'
  | 'sd_other';

export type HandClass = OmahaHandClass | ShortDeckHandClass;

/** The same shape V35's variant shift uses. Negative = wider. */
export interface HandClassShift {
  open: number;
  threeBet: number;
  fourBet: number;
  coldCall: number;
  bbDefend: number;
}

export interface HandClassRead {
  cls: HandClass;
  shift: HandClassShift;
  /**
   * The class flats instead of 3-betting. A bar cannot say this: a rundown
   * wants to SEE a flop cheaply and multiway, and widening its 3-bet bar
   * would do the opposite of what the hand wants.
   */
  neverThreeBet: boolean;
  /**
   * The percentile is lying and the hand is a fold. Only `trips` and `trash`
   * reach this: a hand the ladder rates highly that the game rates at zero.
   */
  foldAlways: boolean;
}

const ZERO: HandClassShift = { open: 0, threeBet: 0, fourBet: 0, coldCall: 0, bbDefend: 0 };

/**
 * The chart. Bars are on the hold em percentile ladder, so -0.04 on the
 * button's 0.27 open bar is about eight percentage points of range, and
 * +0.06 on a 3-bet bar of 0.74 is roughly halving the 3-bet frequency.
 *
 * The direction of every row is published PLO/6+ theory, and the magnitudes
 * are deliberately smaller than a solver would use: this is a first chart
 * with a league matchup behind it, not a claim to have solved the game.
 */
const OMAHA_CHART: Record<OmahaHandClass, HandClassShift> = {
  // Aces double-suited: the one hand that wants a big pot preflop.
  aa_ds: { open: -0.1, threeBet: -0.14, fourBet: -0.1, coldCall: -0.06, bbDefend: -0.08 },
  // Aces dry: raise it, but a 3-bet out of position with no redraw is how
  // aces lose a stack in this game.
  aa_dry: { open: -0.08, threeBet: -0.05, fourBet: -0.03, coldCall: -0.04, bbDefend: -0.06 },
  // Broadway double-suited: every flop it likes is a big one, and it wants
  // company.
  broadway_ds: { open: -0.06, threeBet: 0.04, fourBet: 0.03, coldCall: -0.06, bbDefend: -0.06 },
  // Rundowns: the multiway hand. Open in position, flat, do not bloat.
  rundown: { open: -0.05, threeBet: 0.06, fourBet: 0.04, coldCall: -0.05, bbDefend: -0.05 },
  kk_plus: { open: -0.04, threeBet: -0.01, fourBet: 0.01, coldCall: -0.02, bbDefend: -0.03 },
  pair_support: { open: -0.02, threeBet: 0.02, fourBet: 0.02, coldCall: -0.02, bbDefend: -0.02 },
  // A dangler is three cards and a passenger: it plays, but only cheaply and
  // in position.
  dangler: { open: 0.05, threeBet: 0.08, fourBet: 0.06, coldCall: 0.02, bbDefend: 0.0 },
  // Trips and trash: the bars are irrelevant, foldAlways carries them.
  trips: { open: 0.3, threeBet: 0.3, fourBet: 0.3, coldCall: 0.3, bbDefend: 0.15 },
  trash: { open: 0.12, threeBet: 0.12, fourBet: 0.1, coldCall: 0.1, bbDefend: 0.04 },
  other: ZERO,
};

const SHORT_DECK_CHART: Record<ShortDeckHandClass, HandClassShift> = {
  // The nut flush draw is the hand in 6+; an ace with a suit plays every pot.
  sd_suited_ace: { open: -0.08, threeBet: -0.06, fourBet: -0.04, coldCall: -0.06, bbDefend: -0.08 },
  // A big pair is still a big pair, but it is not hold em's big pair.
  sd_big_pair: { open: -0.05, threeBet: -0.03, fourBet: -0.02, coldCall: -0.02, bbDefend: -0.04 },
  sd_suited_conn: { open: -0.06, threeBet: 0.02, fourBet: 0.02, coldCall: -0.05, bbDefend: -0.06 },
  // Small pairs: the set is not the lock it is in hold em (a flush beats a
  // full house here), so set-mining loses its price.
  sd_small_pair: { open: 0.06, threeBet: 0.06, fourBet: 0.04, coldCall: 0.05, bbDefend: 0.02 },
  sd_other: ZERO,
};

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIERS
// ─────────────────────────────────────────────────────────────────────────────

const rv = (c: Card): number => RANK_VALUES[c.rank] ?? 0;

/** Rank -> how many of it are in the hand. */
function rankCounts(cards: Card[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cards) m.set(rv(c), (m.get(rv(c)) ?? 0) + 1);
  return m;
}

/** Suit -> how many of it are in the hand. */
function suitCounts(cards: Card[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) m.set(c.suit, (m.get(c.suit) ?? 0) + 1);
  return m;
}

/**
 * How connected are the four best cards: the span of the tightest four-card
 * window over the DISTINCT ranks. 3 = perfectly connected (JT98), 4-5 = one
 * or two gaps, 6+ = disconnected. The ace also plays low for a wheel
 * rundown.
 *
 * A HAND WITH A PAIR HAS FEWER THAN FOUR DISTINCT RANKS AND NO FOUR-CARD
 * WINDOW, so this returns UNCONNECTED for it, and every caller must treat
 * that as "the question does not apply" rather than "disconnected".
 *
 * Measured 2026-09-05, and the reason this comment exists: the first version
 * returned the same sentinel and the callers read it as a fact. `9932` and
 * `J733` came out as `trash`, which carries foldAlways - so 4.35% of every
 * PLO hand dealt was folded to any bet, set-mining hands included, and
 * `dangler` (which tightens the open bar) swallowed 42.9% of the deck. Both
 * shipped. The classifier below now asks for four distinct ranks BEFORE it
 * reads a span, and the distribution test pins the shape of the result.
 */
export const UNCONNECTED = 99;

export function connectedSpan(cards: Card[]): number {
  const uniq = [...new Set(cards.map(rv))].sort((a, b) => a - b);
  const withWheelAce = uniq.includes(14) ? [...new Set([1, ...uniq])].sort((a, b) => a - b) : uniq;
  if (withWheelAce.length < 4) return UNCONNECTED;
  let best = UNCONNECTED;
  for (let i = 0; i + 3 < withWheelAce.length; i++) {
    best = Math.min(best, withWheelAce[i + 3] - withWheelAce[i]);
  }
  return best;
}

/** Suited pairs present: 2 = double-suited, 1 = single-suited, 0 = rainbow. */
export function suitedness(cards: Card[]): number {
  let pairs = 0;
  for (const n of suitCounts(cards).values()) if (n >= 2) pairs++;
  return pairs;
}

/** True when an ace shares a suit with another card (the nut-flush shape). */
export function aceSuited(cards: Card[]): boolean {
  const sc = suitCounts(cards);
  return cards.some((c) => c.rank === 'A' && (sc.get(c.suit) ?? 0) >= 2);
}

/**
 * Classify an Omaha hand (4, 5 or 6 cards). Five- and six-card hands are read
 * on the same signals - a hand with more cards has more ways to make each
 * shape, which is exactly why PLO5 and PLO6 open wider, and V35 already
 * carries that part.
 */
export function omahaHandClass(
  cards: Card[] | undefined | null,
  legacyClamps = false
): OmahaHandClass {
  if (!Array.isArray(cards) || cards.length < 4) return 'other';
  const counts = rankCounts(cards);
  const maxOfARank = Math.max(...counts.values());
  const aces = counts.get(14) ?? 0;

  // THREE OF A RANK IS A FOLD, AND THE LADDER DISAGREES. AAA-x is the hand
  // the percentile most overrates: the third ace is dead, and the hand has
  // one pair and no redraw. Checked before the AA branch, deliberately.
  if (maxOfARank >= 3) return 'trips';

  const suits = suitedness(cards);
  const span = connectedSpan(cards);
  const highCards = [...counts.keys()].filter((r) => r >= 10).length;

  if (aces === 2) {
    // Double-suited, or the aces themselves bring a suit: this is the hand
    // that 3-bets and 4-bets.
    return suits >= 2 || aceSuited(cards) ? 'aa_ds' : 'aa_dry';
  }

  // Four broadway cards with two suits: opens wide, flats 3-bets, wants a
  // multiway flop.
  if (highCards >= 4 && suits >= 2) return 'broadway_ds';

  // A rundown: four DISTINCT cards inside a five-rank window, nine-high or
  // better. `span` is only meaningful with four distinct ranks, which
  // `maxOfARank === 1` guarantees for a four-card hand and the span check
  // guarantees for five and six.
  const topRank = Math.max(...counts.keys());
  const distinct = counts.size;
  if (span !== UNCONNECTED && span <= 4 && topRank >= 9 && maxOfARank === 1) return 'rundown';

  // Kings or queens with support.
  const hasKQPair = (counts.get(13) ?? 0) === 2 || (counts.get(12) ?? 0) === 2;
  if (hasKQPair && (suits >= 1 || span <= 5)) return 'kk_plus';

  // Any big pair with connected or suited side cards.
  const bigPairRank = [...counts.entries()].find(([r, n]) => n === 2 && r >= 10)?.[0];
  if (bigPairRank !== undefined && (suits >= 1 || span <= 5)) return 'pair_support';

  // TRASH IS RARE AND UNAMBIGUOUS, because it carries foldAlways. Two low
  // pairs, rainbow, no ace: the hand cannot make a nut flush, cannot make a
  // nut straight, and its two sets are both beaten by the sets above them.
  // ANY other weak hand is just a weak hand - the bars fold it at the right
  // price, and a hand with one pair can still flop a set, which is why
  // `9932` and `J733` must NOT land here (they did, and were folded to every
  // bet in production on 2026-09-05).
  const pairRanks = [...counts.entries()].filter(([, n]) => n === 2).map(([r]) => r);
  if (pairRanks.length >= 2 && Math.max(...pairRanks) <= 9 && suits === 0 && aces === 0) {
    return 'trash';
  }

  // A DANGLER IS THREE CARDS THAT WORK AND ONE THAT DOES NOT, which needs
  // four distinct ranks to even be a question. Requiring a real span (not the
  // sentinel) and a genuine gap keeps this a class rather than a bucket: it
  // was 42.9% of the deck when a paired hand's sentinel span counted as
  // "disconnected", and a class that broad silently tightened the fleet's
  // opening range in every Omaha game.
  if (
    legacyClamps || cards.length === 4
      ? distinct === 4 && span !== UNCONNECTED && span >= 6 && (highCards >= 2 || aces >= 1)
      : maxOfARank === 1 &&
        suits === 0 &&
        span !== UNCONNECTED &&
        span >= 7 &&
        (highCards >= 2 || aces >= 1)
  ) {
    return 'dangler';
  }

  return 'other';
}

export interface OmahaSuitAndCoreQuality {
  /** Number of suits containing exactly 2 cards (clean unblocked flush draws). */
  cleanTwoCardSuits: number;
  /** Number of suits containing 3+ cards (self-blocked flush outs). */
  overloadedSuits: number;
  /** Total redundant suit cards past 2 in any suit (sum of max(0, count - 2)). */
  wastedSuitCards: number;
  /** Number of Ace-high suited draws (suit count >= 2 containing the Ace of that suit). */
  nutSuits: number;
  /** Number of King-high suited draws (suit count >= 2 containing K and not A of that suit). */
  kingSuits: number;
  /** True in 6-card Omaha when hero holds three distinct 2-card suits (2-2-2 triple-suited). */
  tripleSuited: boolean;
  /**
   * True in 5/6-card Omaha when hero holds bare AA with no second suit, no
   * broadway side card (all side ranks <= 9), and disconnected side ranks:
   * strong short/medium-stack equity, but heavily reverse-implied >150bb deep.
   */
  bareDisconnectedAces: boolean;
}

/**
 * Multi-card (PLO4 / PLO5 / PLO6) suit efficiency, nut-suit domination,
 * Pigeonhole self-blocking, and bare-AA structural quality read.
 */
export function omahaSuitAndCoreQuality(cards: Card[] | undefined | null): OmahaSuitAndCoreQuality {
  if (!Array.isArray(cards) || cards.length < 4) {
    return {
      cleanTwoCardSuits: 0,
      overloadedSuits: 0,
      wastedSuitCards: 0,
      nutSuits: 0,
      kingSuits: 0,
      tripleSuited: false,
      bareDisconnectedAces: false,
    };
  }
  const sc = suitCounts(cards);
  const rc = rankCounts(cards);
  let cleanTwoCardSuits = 0;
  let overloadedSuits = 0;
  let wastedSuitCards = 0;
  let nutSuits = 0;
  let kingSuits = 0;
  for (const [suit, n] of sc.entries()) {
    if (n === 2) cleanTwoCardSuits++;
    else if (n >= 3) {
      overloadedSuits++;
      wastedSuitCards += n - 2;
    }
    if (n >= 2) {
      const hasAce = cards.some((c) => c.suit === suit && c.rank === 'A');
      const hasKing = cards.some((c) => c.suit === suit && c.rank === 'K');
      if (hasAce) nutSuits++;
      else if (hasKing) kingSuits++;
    }
  }
  const tripleSuited = cards.length >= 6 && [...sc.values()].filter((n) => n >= 2).length >= 3;
  const aces = rc.get(14) ?? 0;
  const sideCards = cards.filter((c) => c.rank !== 'A');
  const maxSideRank = sideCards.length > 0 ? Math.max(...sideCards.map(rv)) : 0;
  const sideSpan = sideCards.length >= 4 ? connectedSpan(sideCards) : UNCONNECTED;
  const suits = suitedness(cards);
  const bareDisconnectedAces =
    cards.length >= 5 &&
    aces === 2 &&
    suits <= 1 &&
    maxSideRank <= 9 &&
    (sideSpan === UNCONNECTED || sideSpan >= 6);

  return {
    cleanTwoCardSuits,
    overloadedSuits,
    wastedSuitCards,
    nutSuits,
    kingSuits,
    tripleSuited,
    bareDisconnectedAces,
  };
}

/**
 * In 5-card and 6-card Omaha, holding three of one rank alongside a strong
 * double-suited / connected 4-card sub-core (e.g. AAAKKds, AAAKQJds, KKKQJTds)
 * burns one blocker card rather than rendering the entire hand unplayable.
 * Evaluates all 4-card subsets with maxOfARank <= 2 to find a playable sub-core.
 */
function bestPlayableFiveOrSixCardTripsSubcore(cards: Card[]): OmahaHandClass | null {
  if (cards.length < 5) return null;
  const priority: readonly OmahaHandClass[] = ['aa_ds', 'broadway_ds', 'rundown', 'kk_plus'];
  let bestIdx = Infinity;
  const n = cards.length;
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          const sub = [cards[a], cards[b], cards[c], cards[d]];
          const subCounts = rankCounts(sub);
          if (Math.max(...subCounts.values()) >= 3) continue;
          const subCls = omahaHandClass(sub);
          if (subCls === 'kk_plus' && suitedness(sub) < 2) continue;
          if (subCls === 'aa_ds') {
            const side = sub.filter((x) => x.rank !== 'A');
            const strongSide =
              side.length === 2 &&
              (side.every((x) => rv(x) >= 10) || (rv(side[0]) === rv(side[1]) && rv(side[0]) >= 8));
            if (!strongSide || suitedness(sub) < 2) continue;
          }
          if (subCls === 'rundown' && (suitedness(sub) < 2 || Math.min(...sub.map(rv)) < 6)) {
            continue;
          }
          const idx = priority.indexOf(subCls);
          if (idx !== -1 && idx < bestIdx) bestIdx = idx;
        }
      }
    }
  }
  return bestIdx < priority.length ? priority[bestIdx] : null;
}

/** Classify a short-deck (36-card) hold em hand. */
export function shortDeckHandClass(cards: Card[] | undefined | null): ShortDeckHandClass {
  if (!Array.isArray(cards) || cards.length !== 2) return 'sd_other';
  const [a, b] = cards;
  const ra = rv(a);
  const rb = rv(b);
  const suited = a.suit === b.suit;
  if (ra === rb) return ra >= 11 ? 'sd_big_pair' : 'sd_small_pair';
  if (suited && (ra === 14 || rb === 14)) return 'sd_suited_ace';
  if (suited && Math.abs(ra - rb) <= 2) return 'sd_suited_conn';
  return 'sd_other';
}

// ─────────────────────────────────────────────────────────────────────────────
// THE READ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Only structurally defective shapes (danglers and small pairs in 6+ where
 * flushes beat full houses) carry a hard 3-bet block; double-suited broadways
 * (KQJTds, QQJTs-ds) and rundowns evaluate 3-bets/squeezes contextually by
 * position, dead money, nut-suitedness, and SPR in HorsePreflop.
 */
const NEVER_THREE_BET = new Set<HandClass>(['dangler', 'sd_small_pair']);

const LEGACY_NEVER_THREE_BET = new Set<HandClass>([
  'rundown',
  'broadway_ds',
  'dangler',
  'sd_small_pair',
]);

const FOLD_ALWAYS = new Set<HandClass>(['trips', 'trash']);

const NO_READ: HandClassRead = {
  cls: 'other',
  shift: ZERO,
  neverThreeBet: false,
  foldAlways: false,
};

/**
 * The class of the hand hero was dealt, and what it does to the bars.
 * `isOmaha` and `isShortDeck` come from HorseEval.variantInfo, so a hold em
 * hand returns the zero read and the caller is byte-identical to V35.
 * `legacyClamps` preserves the historical Oct 16 corpus clamps when true.
 */
export function handClassRead(
  cards: Card[] | undefined | null,
  isOmaha: boolean,
  isShortDeck: boolean,
  legacyClamps = false
): HandClassRead {
  if (!Array.isArray(cards) || cards.length === 0) return NO_READ;
  if (isOmaha) {
    const cls = omahaHandClass(cards, legacyClamps);
    if (legacyClamps) {
      return {
        cls,
        shift: OMAHA_CHART[cls],
        neverThreeBet: LEGACY_NEVER_THREE_BET.has(cls),
        foldAlways: FOLD_ALWAYS.has(cls),
      };
    }

    const counts = rankCounts(cards);
    const maxOfARank = Math.max(...counts.values());

    // 5/6-card Omaha trips with a strong 4-card sub-core (e.g. AAAKKds,
    // AAAKQJds, KKKQJTds) discount the dead blocker instead of auto-folding.
    if (cls === 'trips' && cards.length >= 5 && maxOfARank === 3) {
      const subCls = bestPlayableFiveOrSixCardTripsSubcore(cards);
      if (subCls !== null) {
        const s = OMAHA_CHART[subCls];
        return {
          cls,
          shift: {
            open: s.open + 0.03,
            threeBet: s.threeBet + 0.04,
            fourBet: s.fourBet + 0.04,
            coldCall: s.coldCall + 0.03,
            bbDefend: s.bbDefend + 0.02,
          },
          neverThreeBet: false,
          foldAlways: false,
        };
      }
    }

    let shift = OMAHA_CHART[cls];
    if (cls === 'broadway_ds') {
      const hasKQPair = (counts.get(13) ?? 0) === 2 || (counts.get(12) ?? 0) === 2;
      const nutAceSuit = aceSuited(cards);
      if (hasKQPair) {
        // KKQJTds / QQKJTds in PLO5/PLO6 combines high pair equity with
        // double-suited broadway wraps — stronger than either class alone.
        shift = { open: -0.08, threeBet: -0.05, fourBet: -0.02, coldCall: -0.06, bbDefend: -0.06 };
      } else if (nutAceSuit) {
        shift = { open: -0.07, threeBet: -0.02, fourBet: 0.01, coldCall: -0.06, bbDefend: -0.06 };
      } else {
        shift = { open: -0.06, threeBet: 0, fourBet: 0.02, coldCall: -0.06, bbDefend: -0.06 };
      }
    } else if (!FOLD_ALWAYS.has(cls) && cards.length >= 5) {
      const q = omahaSuitAndCoreQuality(cards);
      const wastePenalty = Math.min(0.04, q.wastedSuitCards * 0.015);
      const tripleBonus = q.tripleSuited ? 0.02 : 0;
      const nutBonus = q.nutSuits >= 2 ? 0.02 : q.nutSuits === 1 ? 0.01 : 0;
      const delta = wastePenalty - tripleBonus - nutBonus;
      if (delta !== 0) {
        shift = {
          open: shift.open + delta,
          threeBet: shift.threeBet + delta,
          fourBet: shift.fourBet + delta,
          coldCall: shift.coldCall + delta * 0.75,
          bbDefend: shift.bbDefend + delta * 0.5,
        };
      }
    }

    return {
      cls,
      shift,
      neverThreeBet: NEVER_THREE_BET.has(cls) || (cls === 'rundown' && suitedness(cards) === 0),
      foldAlways: FOLD_ALWAYS.has(cls),
    };
  }
  if (isShortDeck) {
    const cls = shortDeckHandClass(cards);
    return {
      cls,
      shift: SHORT_DECK_CHART[cls],
      neverThreeBet: (legacyClamps ? LEGACY_NEVER_THREE_BET : NEVER_THREE_BET).has(cls),
      foldAlways: false,
    };
  }
  return NO_READ;
}

/** Every class the chart knows, for the tests that pin them all. */
export const OMAHA_CLASSES = Object.keys(OMAHA_CHART) as OmahaHandClass[];
export const SHORT_DECK_CLASSES = Object.keys(SHORT_DECK_CHART) as ShortDeckHandClass[];

// ─────────────────────────────────────────────────────────────────────────────
// V86 ELITE PLO4 / PLO5 / PLO6 / PLO8 HAND-CLASS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export type OmahaEliteClass =
  | 'aa_ds'
  | 'aa_dry'
  | 'plo8_scoop'
  | 'broadway_conn_ds'
  | 'rundown_ds'
  | 'ax_nut_suited'
  | 'kk_ds'
  | 'rundown_ss'
  | 'pair_support'
  | 'dangler'
  | 'trips'
  | 'trash'
  | 'other';

export interface OmahaEliteClassRead {
  cls: OmahaEliteClass;
  /** Clean 2-card suits without 3+-of-a-suit self-blocking (0, 1, 2, or 3 in PLO6) */
  cleanSuits: number;
  /** Number of suits where hero holds 3+ cards (eats hero's own flush outs) */
  selfBlockedSuits: number;
  hasNutAceSuit: boolean;
  hasKingSuit: boolean;
  connectedWindowSpan: number;
  /** Eligible to 3-bet for value/playability (mixes IP & polarized OOP instead of AA-only) */
  canThreeBet: boolean;
  /** Eligible to 4-bet / commit preflop at shallow-to-mid SPR (effectiveStackBB <= 130) */
  canFourBetShallow: boolean;
  /** Eligible to pot-squeeze over an open + cold-caller(s) */
  canSqueeze: boolean;
  foldAlways: boolean;
  /** Bar deltas (negative = wider/more aggressive) */
  shift: HandClassShift;
}

const ELITE_NO_READ: OmahaEliteClassRead = {
  cls: 'other',
  cleanSuits: 0,
  selfBlockedSuits: 0,
  hasNutAceSuit: false,
  hasKingSuit: false,
  connectedWindowSpan: UNCONNECTED,
  canThreeBet: false,
  canFourBetShallow: false,
  canSqueeze: false,
  foldAlways: false,
  shift: ZERO,
};

/**
 * Best 4-card connected window high rank when a 4-card window with span <= maxSpan exists.
 * Returns 0 if fewer than 4 distinct ranks fall inside `maxSpan`.
 */
function bestConnectedWindowTop(cards: Card[], maxSpan: number): number {
  const uniq = [...new Set(cards.map(rv))].sort((a, b) => a - b);
  const ranks = uniq.includes(14) ? [...new Set([1, ...uniq])].sort((a, b) => a - b) : uniq;
  if (ranks.length < 4) return 0;
  let top = 0;
  for (let i = 0; i + 3 < ranks.length; i++) {
    if (ranks[i + 3] - ranks[i] <= maxSpan) {
      top = Math.max(top, ranks[i + 3]);
    }
  }
  return top;
}

/**
 * Variant-aware 4-, 5-, and 6-card Omaha (and PLO8 Hi-Lo) elite hand read.
 * Distinguishes clean double-suited rundowns (`JT98ds`, `T987ds`), double-suited
 * connected broadways (`AQJTds`, `KQJTds`), nut-suited `Ax` rundown bridges,
 * double-suited `KK`/`QQ` with side support, and two-way `PLO8` scoop hands
 * (`AA2x`, `AA3x`, `A23x` suited, `A2KQds`), while penalizing 3+-of-a-suit
 * self-blockers in PLO5 and PLO6.
 */
export function omahaEliteClassRead(
  cards: Card[] | undefined | null,
  isHiLo = false
): OmahaEliteClassRead {
  if (!Array.isArray(cards) || cards.length < 4) return ELITE_NO_READ;
  const counts = rankCounts(cards);
  const sc = suitCounts(cards);
  const maxOfARank = Math.max(...counts.values());
  const n = cards.length;

  let cleanSuits = 0;
  let anyTwoPlusSuits = 0;
  let selfBlockedSuits = 0;
  for (const cnt of sc.values()) {
    if (cnt >= 2) anyTwoPlusSuits++;
    if (cnt === 2) cleanSuits++;
    else if (cnt >= 3) selfBlockedSuits++;
  }
  // In PLO5/PLO6, 3 cards of a suit still makes a flush (using 2), though with 1 fewer out;
  // 4+ of a suit severely self-blocks. Count effective working suits accordingly.
  const workingSuits =
    cleanSuits + [...sc.values()].filter((cnt) => cnt === 3).length * (n >= 5 ? 0.5 : 0);
  const doubleSuited = cleanSuits >= 2 || (n >= 5 && anyTwoPlusSuits >= 2 && selfBlockedSuits <= 1);

  const hasNutAceSuit = cards.some(
    (c) => c.rank === 'A' && (sc.get(c.suit) ?? 0) >= 2 && (sc.get(c.suit) ?? 0) <= 3
  );
  const hasKingSuit = cards.some(
    (c) =>
      c.rank === 'K' &&
      (sc.get(c.suit) ?? 0) >= 2 &&
      (sc.get(c.suit) ?? 0) <= 3 &&
      !cards.some((a) => a.rank === 'A' && a.suit === c.suit)
  );

  const aces = counts.get(14) ?? 0;
  const span = connectedSpan(cards);

  // Trips/quads in hand: dead card + zero redraws in 4-card PLO (and 5/6-card without a strong 4-card sub-core).
  if (maxOfARank >= 3) {
    if (n >= 5 && maxOfARank === 3) {
      const subCls = bestPlayableFiveOrSixCardTripsSubcore(cards);
      if (subCls !== null) {
        const s = OMAHA_CHART[subCls];
        return {
          cls: 'trips',
          cleanSuits,
          selfBlockedSuits,
          hasNutAceSuit,
          hasKingSuit,
          connectedWindowSpan: span,
          canThreeBet: subCls === 'aa_ds' || subCls === 'broadway_ds' || subCls === 'kk_plus',
          canFourBetShallow: subCls === 'aa_ds',
          canSqueeze: subCls === 'aa_ds' || subCls === 'broadway_ds',
          foldAlways: false,
          shift: {
            open: s.open + 0.03,
            threeBet: s.threeBet + 0.04,
            fourBet: s.fourBet + 0.04,
            coldCall: s.coldCall + 0.03,
            bbDefend: s.bbDefend + 0.02,
          },
        };
      }
    }
    return {
      cls: 'trips',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: UNCONNECTED,
      canThreeBet: false,
      canFourBetShallow: false,
      canSqueeze: false,
      foldAlways: true,
      shift: OMAHA_CHART.trips,
    };
  }
  const tightTop = bestConnectedWindowTop(cards, 3); // 0-gap 4-card rundown top rank
  const oneGapTop = bestConnectedWindowTop(cards, 4); // <=1-gap 4-card rundown top rank
  const wheelCards = [...counts.keys()].filter((r) => r === 14 || r <= 5);
  const lowCardsEightOrUnder = [...counts.keys()].filter((r) => r === 14 || r <= 8);
  const hasDeuce = counts.has(2);
  const hasTrey = counts.has(3);

  // 1. PLO8 Two-Way Scoop Monsters (AA2x, AA3x, A23x suited, A2+broadway ds)
  if (isHiLo) {
    if (aces === 2 && (hasDeuce || hasTrey || lowCardsEightOrUnder.length >= 2)) {
      return {
        cls: doubleSuited || hasNutAceSuit ? 'aa_ds' : 'plo8_scoop',
        cleanSuits,
        selfBlockedSuits,
        hasNutAceSuit,
        hasKingSuit,
        connectedWindowSpan: span,
        canThreeBet: true,
        canFourBetShallow: true,
        canSqueeze: true,
        foldAlways: false,
        shift: { open: -0.14, threeBet: -0.16, fourBet: -0.12, coldCall: -0.08, bbDefend: -0.1 },
      };
    }
    const nutLowEngine = aces >= 1 && (hasDeuce || (hasTrey && wheelCards.length >= 3));
    const highPotential =
      hasNutAceSuit ||
      doubleSuited ||
      [...counts.keys()].filter((r) => r >= 10).length >= 2 ||
      wheelCards.length >= 3;
    if (nutLowEngine && highPotential && (anyTwoPlusSuits >= 1 || wheelCards.length >= 3)) {
      return {
        cls: 'plo8_scoop',
        cleanSuits,
        selfBlockedSuits,
        hasNutAceSuit,
        hasKingSuit,
        connectedWindowSpan: span,
        canThreeBet: hasNutAceSuit || doubleSuited || (hasDeuce && hasTrey),
        canFourBetShallow: doubleSuited && hasDeuce && hasNutAceSuit,
        canSqueeze: hasNutAceSuit || doubleSuited,
        foldAlways: false,
        shift: { open: -0.1, threeBet: -0.09, fourBet: -0.05, coldCall: -0.08, bbDefend: -0.09 },
      };
    }
  }

  // 2. AAxx
  if (aces === 2) {
    const eliteAA = doubleSuited || (hasNutAceSuit && (workingSuits >= 1.5 || span <= 5));
    return {
      cls: eliteAA ? 'aa_ds' : 'aa_dry',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: span,
      canThreeBet: true,
      canFourBetShallow: true,
      canSqueeze: true,
      foldAlways: false,
      shift: eliteAA
        ? { open: -0.12, threeBet: -0.16, fourBet: -0.12, coldCall: -0.07, bbDefend: -0.09 }
        : OMAHA_CHART.aa_dry,
    };
  }

  // 3. Connected Broadway Double-Suited (AQJTds, KQJTds, AJT9ds, KJT9ds, QJT9ds)
  const broadwayCount = [...counts.keys()].filter((r) => r >= 10).length;
  if (
    (broadwayCount >= 4 || (oneGapTop >= 12 && broadwayCount >= 3)) &&
    (doubleSuited || (hasNutAceSuit && workingSuits >= 1.5))
  ) {
    return {
      cls: 'broadway_conn_ds',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: span,
      canThreeBet: true,
      canFourBetShallow: doubleSuited && (tightTop >= 13 || hasNutAceSuit),
      canSqueeze: true,
      foldAlways: false,
      shift: { open: -0.1, threeBet: -0.09, fourBet: -0.05, coldCall: -0.08, bbDefend: -0.08 },
    };
  }

  // 4. Double-Suited Rundowns (JT98ds, T987ds, 9876ds, 8765ds, QT98ds, J987ds)
  // In 4-card PLO `doubleSuited` already guarantees `selfBlockedSuits === 0`;
  // in 5/6-card PLO it permits one 3-card suit alongside a clean 2-card suit (`3+2`).
  if (oneGapTop >= 8 && doubleSuited) {
    const zeroGap = tightTop >= 8;
    return {
      cls: 'rundown_ds',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: span,
      canThreeBet: true,
      canFourBetShallow: zeroGap || oneGapTop >= 10 || hasNutAceSuit,
      canSqueeze: true,
      foldAlways: false,
      shift: {
        open: zeroGap ? -0.1 : -0.08,
        threeBet: zeroGap ? -0.08 : -0.06,
        fourBet: zeroGap ? -0.05 : -0.03,
        coldCall: -0.08,
        bbDefend: -0.08,
      },
    };
  }

  // 5. Suited Ace Nut-Flush + Connected / Broadway Support (Axxsrundown, AKQxs, AJTxs, AT98s)
  const nonAceConnected =
    oneGapTop >= 9 ||
    broadwayCount >= 3 ||
    (() => {
      const others = [...counts.keys()].filter((r) => r !== 14).sort((a, b) => a - b);
      return (
        others.length >= 3 &&
        others[others.length - 1] - others[0] <= 4 &&
        others[others.length - 1] >= 8
      );
    })();
  if (hasNutAceSuit && nonAceConnected && selfBlockedSuits <= (n >= 6 ? 1 : 0)) {
    return {
      cls: 'ax_nut_suited',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: span,
      canThreeBet: true,
      canFourBetShallow: doubleSuited && (broadwayCount >= 3 || tightTop >= 9),
      canSqueeze: true,
      foldAlways: false,
      shift: {
        open: -0.08,
        threeBet: doubleSuited ? -0.07 : -0.05,
        fourBet: doubleSuited ? -0.03 : 0.01,
        coldCall: -0.07,
        bbDefend: -0.08,
      },
    };
  }

  // 6. KK / QQ Double-Suited or Double-Paired Connected (KKQQds, KKJTds, QQJTds)
  const hasKK = (counts.get(13) ?? 0) === 2;
  const hasQQ = (counts.get(12) ?? 0) === 2;
  const pairRanks = [...counts.entries()].filter(([, cnt]) => cnt === 2).map(([r]) => r);
  if (
    (hasKK || hasQQ) &&
    doubleSuited &&
    (pairRanks.length >= 2 || broadwayCount >= 3 || span <= 5 || hasNutAceSuit)
  ) {
    return {
      cls: 'kk_ds',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: span,
      canThreeBet: true,
      canFourBetShallow: hasKK && (hasNutAceSuit || pairRanks.length >= 2 || broadwayCount >= 3),
      canSqueeze: true,
      foldAlways: false,
      shift: { open: -0.07, threeBet: -0.06, fourBet: -0.03, coldCall: -0.05, bbDefend: -0.06 },
    };
  }

  // 7. Single-Suited Rundowns & Connected Broadways (KQJTs, JT98s, T987s, 9876s)
  if (oneGapTop >= 9 && anyTwoPlusSuits >= 1 && selfBlockedSuits <= (n >= 5 ? 1 : 0)) {
    const strongSS = tightTop >= 10 || hasKingSuit || broadwayCount >= 4;
    return {
      cls: 'rundown_ss',
      cleanSuits,
      selfBlockedSuits,
      hasNutAceSuit,
      hasKingSuit,
      connectedWindowSpan: span,
      canThreeBet: strongSS,
      canFourBetShallow: false,
      canSqueeze: strongSS,
      foldAlways: false,
      shift: {
        open: -0.06,
        threeBet: strongSS ? -0.03 : 0.02,
        fourBet: 0.03,
        coldCall: -0.06,
        bbDefend: -0.06,
      },
    };
  }

  // Fall back to legacy Omaha class semantics for remaining pair_support, dangler, trash, other
  const legacy = omahaHandClass(cards);
  const mapped: OmahaEliteClass =
    legacy === 'pair_support' || legacy === 'kk_plus'
      ? 'pair_support'
      : legacy === 'dangler'
        ? 'dangler'
        : legacy === 'trash'
          ? 'trash'
          : 'other';
  // Penalize 4-of-a-suit / severe self-blocked hands in PLO5/PLO6
  const selfBlockPenalty =
    selfBlockedSuits >= 2 || [...sc.values()].some((cnt) => cnt >= 4) ? 0.05 : 0;
  const baseShift = OMAHA_CHART[legacy];
  return {
    cls: mapped,
    cleanSuits,
    selfBlockedSuits,
    hasNutAceSuit,
    hasKingSuit,
    connectedWindowSpan: span,
    canThreeBet: false,
    canFourBetShallow: false,
    canSqueeze: false,
    foldAlways: FOLD_ALWAYS.has(legacy),
    shift:
      selfBlockPenalty > 0
        ? {
            open: baseShift.open + selfBlockPenalty,
            threeBet: baseShift.threeBet + selfBlockPenalty,
            fourBet: baseShift.fourBet + selfBlockPenalty,
            coldCall: baseShift.coldCall + selfBlockPenalty,
            bbDefend: baseShift.bbDefend + selfBlockPenalty * 0.5,
          }
        : baseShift,
  };
}
