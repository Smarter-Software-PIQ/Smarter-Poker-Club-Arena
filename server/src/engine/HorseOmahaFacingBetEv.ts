/**
 * OMAHA FACING A BET: ONE EXPECTED-VALUE DECISION (2026-11-15, PLO Strategy
 * lane; option omahaFacingBetEv, default OFF, read `=== true`).
 *
 * Owner, 2026-11-15 11:39 Chicago: the fold-or-call decision facing a turn or
 * river bet "needs to be hand and player dependant and pot size to value
 * dependant", based on the real decision, not "always fold to a big bet".
 *
 * Today that decision is an equity estimate with caps on it and a stack of
 * rules that veto its answer (archive plo-handoff-review-01a1cbbd/
 * facingbet-rewrite-20261115/DESIGN.md lists every one with its line): the
 * range read marks any wager of 20 big blinds a big bet whatever share of the
 * pot it is, the aggressor tier then samples the bettor as 81 to 88 percent
 * trips or better, the committed-call bar stacks margins on that number, and
 * the paired-board fold and the big-bet cells fold whatever the price. None
 * counts the holdings that beat the Horse's actual hand.
 *
 * This module is the replacement, for PLO4 / PLO5 cash, one board, high only,
 * on the turn and the river, when the Horse faces a bet or a raise:
 *
 *  HAND    Every two-card pair of the unseen cards (the Horse's own cards,
 *          the board and known dead cards removed) is scored on the board
 *          with the engine's evaluator; an opponent holding is worth its best
 *          pair. The number of holdings that contain no pair from a given set
 *          is counted exactly (countHoldingsWithout), so "holdings that beat
 *          / tie / lose to this hand", inside any strength region, are exact
 *          counts. Nothing is sampled and no random number is drawn. On the
 *          turn the same counts are taken for every river card.
 *  PLAYER  The bettor's range is a VALUE region (the strongest share V of
 *          all holdings on this board) and a BLUFF share q of other holdings.
 *          V comes from the bet's share of the pot and his line this hand
 *          (never absolute chips); q from the share of the pot, moved by his
 *          measured tendencies and, when the memory carries it, by how often
 *          his bets of this size were shown down as the best hand.
 *          The bluff-share prior is the measured population figure, not the
 *          balanced one (OMAHA_EV_PRIOR_BLUFF).
 *  PRICE   EV(call) = P(win) x what the call can win + P(tie) x the split
 *          - P(lose) x the call, on the actual pot and call. The call is made
 *          when the EV exceeds ONE margin (2 percent of the final pot). A
 *          river call, a whole-stack call and a call that leaves a trivial
 *          amount behind are final; a turn call with chips behind takes the
 *          engine's realization factor, the only other term.
 *  FIELD   Every other player in the hand must be beaten too: one who already
 *          called this bet (a strong range), one all in from an earlier
 *          street, and one still to act behind the Horse.
 *
 * Pure: no random draws, no telemetry, no opponent memory; the only state is
 * a memo of exact counts for the last few hands (the same cards give the
 * same counts). The caller (HorseLogic) supplies the measured read.
 */
import { omahaBetReadBluffShare, type OmahaBetRead } from './HorseOmahaBetRead.js';
import {
  omahaShownFieldVerdict,
  type OmahaShownFieldVerdict,
} from './HorseOmahaFacingBetEvShownField.js';
import {
  omahaRiverBluffCatchVerdict,
  type OmahaRiverBluffCatchVerdict,
  type OmahaRiverRow,
} from './HorseOmahaRiverBluffCatch.js';
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaDrawQuality, scoreOmahaHiPartial } from './HorseEval.js';
import { omahaTurnRiverTables } from './HorseOmahaRiverTables.js';
import { RANK_VALUES } from './PokerEngine.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaCashOnlyExcludes } from './HorseOmahaTournamentScope.js';
import { omahaStrategyGameInScope, omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { plo6EvFoldStands, plo6PricingExcludes } from './HorsePlo6PricingPort.js';
import { plo6CountHoldingsAmong } from './HorsePlo6FastCount.js';
import { plo6ValueShareAtSameStrength } from './HorsePlo6ValueShare.js';
import {
  omahaOpponentKindOf,
  omahaPricedBluffFactor,
  omahaPricedKindPrior,
  omahaPricedLegacyBluffReferenceRatio,
  omahaPricedFacingRange,
  type OmahaOpponentKind,
  omahaPricedModeNow,
  omahaPricedRealizationCap,
} from './HorseOmahaPricedMode.js';
import { OMAHA_RUNOUT_ROW, omahaRunoutRealization } from './HorseOmahaRunoutRealization.js';

export const OMAHA_FACING_BET_EV_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** The one safety margin: EV(call) must exceed this share of the final pot (pot + call). */
export const OMAHA_FACING_BET_EV_MARGIN = 0.02;
/**
 * Whether the facing-bet EV rule answers a SIX-card hand on the TURN
 * (omahaEvHandCounts, omahaFacingBetEvSpot). FALSE, and not because of cost.
 *
 * Cost is no longer the reason: the exact six-card turn count was measured on
 * 2026-11-16 at a median of about 3 ms and a worst of 13 ms over 2,000 seeded
 * turn hands (16 ms with the four/five-card walk), on a machine at load 20;
 * TIMING-PLO6's "about a second" was taken before the counter was rewritten.
 *
 * It stays false because SPEC-A 3.12 defines the six-card rule for the river
 * only: its guard (the measured river fold test, item 4) is a river
 * measurement, the turn realization factors are hold'em-origin and unmeasured
 * for six cards (H23), and the turn interaction with plo6TopSetNutRealization
 * is left outside the first cut (item 7). Admitting the turn needs a measured
 * turn guard first; then this constant and one test change.
 */
export const PLO6_FACING_BET_EV_TURN: boolean = false;
/** A call that leaves at most this share of the final pot behind is the stack decision. */
export const OMAHA_FACING_BET_EV_TRIVIAL_BEHIND = 0.1;

/** Size buckets, as a share of the pot before the bet (lane brief 2026-11-15). */
export type OmahaBetSizeBucket = 'under40' | 'mid' | 'big' | 'over';
export function omahaBetSizeBucket(potFrac: number): OmahaBetSizeBucket {
  return potFrac < 0.4 ? 'under40' : potFrac < 0.7 ? 'mid' : potFrac <= 1.1 ? 'big' : 'over';
}

/**
 * VALUE REGION: the share of all holdings (strongest first) the bettor bets
 * for value at this size. Smaller bets are thinner value; a raise is the
 * narrowest. Turn bets are wider than river bets.
 */
export const OMAHA_EV_VALUE_SHARE: Readonly<
  Record<'turn' | 'river', Readonly<Record<OmahaBetSizeBucket | 'raise', number>>>
> = {
  river: { under40: 0.45, mid: 0.3, big: 0.2, over: 0.12, raise: 0.1 },
  turn: { under40: 0.5, mid: 0.38, big: 0.28, over: 0.18, raise: 0.14 },
};
/** His arriving range is stronger for each earlier postflop street he bet or raised / only called. */
export const OMAHA_EV_LINE_AGGRESSOR = 0.8;
export const OMAHA_EV_LINE_CALLER = 0.9;
/**
 * The value region has a soft edge on the river: the next half-share of
 * holdings below it (thin value) is in the range at half weight, so the
 * verdict does not turn on which side of a hard line one hand class falls.
 */
export const OMAHA_EV_THIN_VALUE_BAND = 0.5;
export const OMAHA_EV_THIN_VALUE_WEIGHT = 0.5;
/**
 * POPULATION PRIOR for the share of a bet that is not value (river: a bluff
 * or a worse hand; turn: a draw, a worse hand or air), by the bet's share of
 * the pot. Measured, not assumed: full sweep 2026-11-15 (archive
 * plo-handoff-review-01a1cbbd/full-sweep-20261115; 4,573 PLO4/PLO5 cash hands
 * with a person seated, Nov 10 to 15), heads-up, a Horse holding a hand that 3
 * to 45 percent of two-card holdings beat, facing a person's bet: the Horse
 * was ahead of the bettor's actual cards on the river 13.4% (n 41) under 40
 * percent of the pot, 14.8% (n 61) at 40 to 70, 19.5% (n 118) at 70 to 110;
 * on the turn 34.4% (n 61), 42.6% (n 54), 18.7% (n 179). The balanced share
 * (bet / (pot + 2 bet): 0.25 at half the pot) is NOT what this population
 * does: it under-bluffs the river at every size. A raise has no measured row
 * here; it keeps a stated low share.
 */
export const OMAHA_EV_PRIOR_BLUFF: Readonly<
  Record<'turn' | 'river', Readonly<Record<OmahaBetSizeBucket | 'raise', number>>>
> = {
  river: { under40: 0.13, mid: 0.15, big: 0.19, over: 0.19, raise: 0.08 },
  turn: { under40: 0.34, mid: 0.4, big: 0.22, over: 0.22, raise: 0.15 },
};
/** River bluffs come from the weakest share of the holdings. */
export const OMAHA_EV_BLUFF_POOL = 0.5;
/** Pseudo-observations behind the prior when the size-bucketed shown-down read moves it. */
export const OMAHA_EV_SIZE_READ_PRIOR = 8;
export const OMAHA_EV_SIZE_READ_MIN_SHOWN = 4;
/** The field: a caller of this bet, an earlier all-in, a player still to act (who continues with this share). */
export const OMAHA_EV_CALLER_SHARE: Readonly<Record<'turn' | 'river', number>> = {
  river: 0.35,
  turn: 0.45,
};
export const OMAHA_EV_ALL_IN_SHARE = 0.5;
export const OMAHA_EV_BEHIND_SHARE = 0.25;

/** The population prior for this bet (OMAHA_EV_PRIOR_BLUFF). */
export function omahaEvPriorBluffShare(
  street: 'turn' | 'river',
  potFrac: number,
  isRaise: boolean
): number {
  return OMAHA_EV_PRIOR_BLUFF[street][isRaise ? 'raise' : omahaBetSizeBucket(potFrac)];
}

/** What the caller knows about the bettor, from public play only. Null fields = not measured. */
export interface OmahaFacingBetEvRead {
  /** HorseMind.omahaReadConditionalOf(...).measured */
  measured: boolean;
  /** his bet-when-checked-to posterior mean over the Horse mean of this game and table size */
  betCheckedToRatio: number | null;
  /** his bet-when-checked-to posterior mean itself, when the priced read supplies it (omahaBluffShareFromBetRate) */
  betCheckedTo?: number | null;
  /** who he is (HorseOmahaPricedMode.omahaOpponentKindOf), when the priced read supplies it; with a kind,
   *  betCheckedToRatio is his rate over his KIND's reference (omahaPricedBluffReferenceRatio) */
  kind?: OmahaOpponentKind | null;
  /** isPostflopManiac on his measured read */
  postflopManiac: boolean;
  /** measured postflop value leader (bets <= mean when checked to, folds >= mean, calls rivers <= mean) */
  valueLeader?: boolean;
  /** his river bets of this size that reached showdown, those that were the best hand and, when known, those
   *  that showed a strong hand and did not win (thin value: half a bluff). Null: the memory has no such read
   *  (today always: see HorseMind.omahaFacingBetEvReadOf) */
  sizeShown: { shown: number; best: number; second?: number } | null;
  /** omahaBetReadIsPerOpponent (default off): his per-street, per-size bet read (HorseOmahaBetRead). When
   *  present it alone moves the prior (omahaBetReadBluffShare: the population prior exactly below its minimum
   *  sample); absent = the reads above, as before */
  betRead?: OmahaBetRead | null;
  /** omahaStabDefenceIsPriced (default off): the non-value share of this bet priced from his own public bet
   *  frequency (HorseOmahaStabDefence.omahaStabDefenceShare). When present it IS the share used; absent = the
   *  reads above, as before */
  pricedShare?: number | null;
}
export const OMAHA_EV_UNKNOWN_READ: OmahaFacingBetEvRead = Object.freeze({
  measured: false,
  betCheckedToRatio: null,
  postflopManiac: false,
  valueLeader: false,
  sizeShown: null,
});

/** The bluff share used: the prior, moved by the measured read. */
export function omahaEvBluffShare(
  prior: number,
  read: OmahaFacingBetEvRead | null,
  street?: 'turn' | 'river'
): number {
  // omahaStabDefenceIsPriced (default off): the share priced from his public bet frequency, as given.
  if (typeof read?.pricedShare === 'number' && Number.isFinite(read.pricedShare))
    return Math.max(0.02, Math.min(0.98, read.pricedShare));
  // omahaBetReadIsPerOpponent (default off): ONE rule for every bettor, his measured composition of this street
  // and size (HorseOmahaBetRead), the population prior exactly while his sample is below the minimum.
  if (read?.betRead)
    return Math.max(0.02, Math.min(0.65, omahaBetReadBluffShare(prior, read.betRead)));
  let q = prior;
  // omahaBluffShareFromBetRate (default off): his bet rate beside the population moves the prior
  // continuously; the value-leader and maniac labels do not act (HorseOmahaPricedMode).
  // His rate is read against his KIND's reference rate (HorseOmahaPricedMode.omahaPricedBluffReferenceRatio,
  // computed once by the priced read) with his kind's measured elasticity; the prior itself is his kind's
  // (omahaFacingBetEvSpot). A read with no kind keeps the merged reference (omahaPricedLegacyBluffReferenceRatio).
  if (omahaPricedModeNow().bluffShareFromBetRate)
    q *=
      read?.kind === 'person' || read?.kind === 'horse'
        ? omahaPricedBluffFactor(read.betCheckedToRatio, read.kind)
        : omahaPricedBluffFactor(
            omahaPricedLegacyBluffReferenceRatio(
              read?.betCheckedTo,
              read?.betCheckedToRatio,
              street
            )
          );
  else if (read?.measured) {
    let k = 1;
    if (read.betCheckedToRatio !== null && Number.isFinite(read.betCheckedToRatio))
      k = Math.max(0.7, Math.min(1.5, read.betCheckedToRatio));
    if (read.postflopManiac) k = Math.max(k, 1.3);
    else if (read.valueLeader === true) k = Math.min(k, 0.65);
    q *= k;
  }
  const s = read?.sizeShown;
  if (
    s &&
    Number.isFinite(s.shown) &&
    Number.isFinite(s.best) &&
    s.shown >= OMAHA_EV_SIZE_READ_MIN_SHOWN &&
    s.best >= 0 &&
    s.best <= s.shown
  ) {
    const second = Math.max(0, Math.min(s.shown - s.best, Number(s.second) || 0));
    q =
      (q * OMAHA_EV_SIZE_READ_PRIOR + (s.shown - s.best - 0.5 * second)) /
      (OMAHA_EV_SIZE_READ_PRIOR + s.shown);
  }
  return Math.max(0.02, Math.min(0.65, q));
}

// ───────────────────────── exact holdings counter ─────────────────────────

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

/** A set of two-card pairs over m cards (m <= 48), as per-card bit masks in two 32-bit halves. */
export class PairSet {
  readonly lo: Int32Array;
  readonly hi: Int32Array;
  constructor(readonly m: number) {
    this.lo = new Int32Array(m);
    this.hi = new Int32Array(m);
  }
  add(i: number, j: number): void {
    if (j < 32) this.lo[i] |= 1 << j;
    else this.hi[i] |= 1 << (j - 32);
    if (i < 32) this.lo[j] |= 1 << i;
    else this.hi[j] |= 1 << (i - 32);
  }
  union(o: PairSet): PairSet {
    const u = new PairSet(this.m);
    for (let i = 0; i < this.m; i++) {
      u.lo[i] = this.lo[i] | o.lo[i];
      u.hi[i] = this.hi[i] | o.hi[i];
    }
    return u;
  }
}

/**
 * The number of n-card holdings drawn from m cards that contain NO pair of
 * `bar` (and not the card `skip`, when given). Exact.
 *
 * A card no barred pair touches combines freely with every other card, so
 * only the cards a barred pair touches are walked: the holdings with k of
 * those cards and no barred pair are counted for every k (cards taken in
 * rising order, the cards barred by those already taken dropped from the
 * mask, the last card counted, not walked), and each is completed from the
 * untouched cards by the binomial.
 */
export function countHoldingsWithout(m: number, n: number, bar: PairSet, skip = -1): number {
  let allLo = m >= 32 ? -1 : (1 << m) - 1;
  let allHi = m > 32 ? (1 << (m - 32)) - 1 : 0;
  if (skip >= 0 && skip < 32) allLo &= ~(1 << skip);
  else if (skip >= 32) allHi &= ~(1 << (skip - 32));
  return countHoldingsAmong(m, n, bar, allLo, allHi);
}

/**
 * True while evHandCounts answers for SIX hole cards (and the fast count is
 * not switched off by the test seam): countHoldingsAmong then uses
 * plo6CountHoldingsAmong. False for four and five cards, always.
 */
let sixCardCount = false;
let sixCardFastCount = true;
/** Test and benchmark seam, process-wide, exported from this production module because the flag it sets lives
 *  here: false makes a six-card count take the four/five-card walk. It changes the speed of a six-card count,
 *  never a number (the two counters are equal on every tested hand), and no production code calls it. */
export function omahaEvSixCardFastCount(on: boolean): void {
  sixCardFastCount = on === true;
}

/** The same count over the cards of the mask (allLo, allHi) only. */
function countHoldingsAmong(
  m: number,
  n: number,
  bar: PairSet,
  allLo: number,
  allHi: number
): number {
  if (n === 0) return 1;
  // Six hole cards only (sixCardCount is set by evHandCounts for a six-card
  // hand): the same integer by the independence polynomial of the barred
  // pairs (HorsePlo6FastCount). Four and five cards never take this line.
  if (sixCardCount) return plo6CountHoldingsAmong(n, bar.lo, bar.hi, allLo, allHi);
  const lo = bar.lo;
  const hi = bar.hi;
  // The cards a barred pair touches, with the barred partners each has among the cards allowed.
  const nbLo = new Int32Array(m);
  const nbHi = new Int32Array(m);
  const touched: number[] = [];
  let tiedLo = 0;
  let tiedHi = 0;
  let loose = 0;
  for (let i = 0; i < m; i++) {
    if (((i < 32 ? allLo >>> i : allHi >>> (i - 32)) & 1) === 0) continue;
    const l = lo[i] & allLo;
    const h = hi[i] & allHi;
    if (l === 0 && h === 0) {
      loose++;
      continue;
    }
    nbLo[i] = l;
    nbHi[i] = h;
    touched.push(i);
    if (i < 32) tiedLo |= 1 << i;
    else tiedHi |= 1 << (i - 32);
  }
  // sets[k]: the holdings of k touched cards with no barred pair
  const sets = new Float64Array(n + 1);
  sets[0] = 1;
  if (touched.length > 0) {
    // Cards with the same barred partners are interchangeable (the cards of
    // one rank outside a flush suit are): a group whose members are not
    // barred from each other gives any number of its cards, a group whose
    // members are all barred from each other gives one. Walking groups
    // instead of cards counts the same holdings in far fewer steps.
    const rep: number[] = [];
    const size: number[] = [];
    /** 0 one card, 1 members not barred from each other, 2 members all barred from each other */
    const kind: number[] = [];
    for (const u of touched) {
      const ul = nbLo[u];
      const uh = nbHi[u];
      const ubl = u < 32 ? 1 << u : 0;
      const ubh = u < 32 ? 0 : 1 << (u - 32);
      let joined = false;
      for (let c = 0; c < rep.length && !joined; c++) {
        const r = rep[c];
        if (kind[c] !== 2 && ul === nbLo[r] && uh === nbHi[r]) {
          kind[c] = 1;
          size[c]++;
          joined = true;
        } else if (kind[c] !== 1) {
          const rbl = r < 32 ? 1 << r : 0;
          const rbh = r < 32 ? 0 : 1 << (r - 32);
          if ((ul | ubl) === (nbLo[r] | rbl) && (uh | ubh) === (nbHi[r] | rbh)) {
            kind[c] = 2;
            size[c]++;
            joined = true;
          }
        }
      }
      if (!joined) {
        rep.push(u);
        size.push(1);
        kind.push(0);
      }
    }
    const groups = rep.length;
    if (groups * 10 <= touched.length * 7) {
      const ways: number[][] = size.map((sz, c) => {
        const row = [0];
        if (kind[c] === 2) row.push(sz);
        else for (let k = 1; k <= Math.min(sz, n); k++) row.push(choose(sz, k));
        return row;
      });
      const walkGroups = (
        start: number,
        freeLo: number,
        freeHi: number,
        taken: number,
        weight: number
      ): void => {
        for (let c = start; c < groups; c++) {
          const r = rep[c];
          if (((r < 32 ? freeLo >>> r : freeHi >>> (r - 32)) & 1) === 0) continue;
          const row = ways[c];
          const nl = freeLo & ~nbLo[r];
          const nh = freeHi & ~nbHi[r];
          for (let k = 1; k < row.length && taken + k <= n; k++) {
            const w = weight * row[k];
            sets[taken + k] += w;
            if (taken + k < n && c + 1 < groups) walkGroups(c + 1, nl, nh, taken + k, w);
          }
        }
      };
      walkGroups(0, tiedLo, tiedHi, 0, 1);
    } else {
      // Few interchangeable cards: the cards themselves, in rising order,
      // the cards barred by those already taken dropped from the mask, the
      // last card counted, not walked.
      const walk = (freeLo: number, freeHi: number, taken: number): void => {
        const c = popcount(freeLo) + popcount(freeHi);
        if (c === 0) return;
        sets[taken + 1] += c;
        if (taken + 1 >= n) return;
        const last = taken + 2 >= n;
        let f = freeLo;
        while (f !== 0) {
          const b = f & -f;
          const i = 31 - Math.clz32(b);
          f ^= b;
          const nl = f & ~lo[i];
          const nh = freeHi & ~hi[i];
          if (last) sets[n] += popcount(nl) + popcount(nh);
          else if ((nl | nh) !== 0) walk(nl, nh, taken + 1);
        }
        f = freeHi;
        while (f !== 0) {
          const b = f & -f;
          const i = 31 - Math.clz32(b);
          f ^= b;
          const nh = f & ~hi[32 + i];
          if (last) sets[n] += popcount(nh);
          else if (nh !== 0) walk(0, nh, taken + 1);
        }
      };
      walk(tiedLo, tiedHi, 0);
    }
  }
  let total = 0;
  for (let k = 0; k <= n; k++) if (sets[k] > 0) total += sets[k] * choose(loose, n - k);
  return total;
}

function unseenCards(hole: Card[], board: Card[], dead: Card[]): Card[] | null {
  const known = [...hole, ...board, ...dead];
  if (known.some((c) => !c || !RANKS.includes(c.rank as never) || !SUITS.includes(c.suit as never)))
    return null;
  if (new Set([...hole, ...board].map(key)).size !== hole.length + board.length) return null;
  const removed = new Set(known.map(key));
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) unseen.push(card);
    }
  return unseen;
}

/** Every unseen pair's score on the board, flat [i * m + j] for i < j. */
function pairScores(unseen: Card[], board: Card[]): Float64Array {
  const m = unseen.length;
  const out = new Float64Array(m * m);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < m; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < m; j++) {
      two[1] = unseen[j];
      out[i * m + j] = scoreOmahaHiPartial(two, board);
    }
  }
  return out;
}

/** The two sets hold the same pairs. */
function samePairs(a: PairSet, b: PairSet): boolean {
  for (let i = 0; i < a.m; i++) if (a.lo[i] !== b.lo[i] || a.hi[i] !== b.hi[i]) return false;
  return true;
}

/** Pairs with score above `t` (strict) or at least `t`. */
function pairsAbove(scores: Float64Array, m: number, t: number, orEqual: boolean): PairSet {
  const set = new PairSet(m);
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      const s = scores[i * m + j];
      if (orEqual ? s >= t : s > t) set.add(i, j);
    }
  return set;
}

/** One river card of a turn hand: the Horse's score on it and the pairs that beat / at least tie it. */
interface EvRiver {
  B: PairSet;
  BT: PairSet;
}

/**
 * What one hand (hole, board, dead cards) fixes whatever the value share
 * asked: the pair scores, and every exact count already taken, by name. The
 * counts are pure functions of the cards, so a second question about the same
 * hand (the facing-bet verdict, the raise rule's verdict, the strong-hand
 * raise sizes, the deep look's replays) takes none of them again.
 */
interface EvCore {
  id: string;
  m: number;
  n: number;
  total: number;
  scores: Float64Array;
  sorted: Float64Array;
  /** holdings above the threshold at a sorted index */
  above: Map<number, number>;
  /** exact counts by name */
  counted: Map<string, number>;
  /** turn only, built on first use */
  rivers: EvRiver[] | null;
}

const EV_CORES: EvCore[] = [];
const EV_CORES_MAX = 6;
const EV_CORE_COUNTS_MAX = 6000;

function evCore(hole: Card[], board: Card[], dead: Card[], unseen: Card[]): EvCore {
  const id = `${hole.map(key).join(',')}|${board.map(key).join(',')}|${dead.map(key).join(',')}`;
  const at = EV_CORES.findIndex((c) => c.id === id);
  if (at >= 0) {
    const hit = EV_CORES[at];
    if (at > 0) {
      EV_CORES.splice(at, 1);
      EV_CORES.unshift(hit);
    }
    if (hit.counted.size > EV_CORE_COUNTS_MAX) hit.counted.clear();
    return hit;
  }
  const m = unseen.length;
  const scores = pairScores(unseen, board);
  const distinct = new Set<number>();
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) distinct.add(scores[i * m + j]);
  const core: EvCore = {
    id,
    m,
    n: hole.length,
    total: choose(m, hole.length),
    scores,
    sorted: Float64Array.from([...distinct].sort((a, b) => a - b)),
    above: new Map(),
    counted: new Map(),
    rivers: null,
  };
  EV_CORES.unshift(core);
  if (EV_CORES.length > EV_CORES_MAX) EV_CORES.length = EV_CORES_MAX;
  return core;
}

/** Test seam: forget the remembered hands. */
export function omahaEvHandCountsResetCache(): void {
  EV_CORES.length = 0;
}

const RANK_OF_VALUE: string[] = [];
for (const r of RANKS) RANK_OF_VALUE[RANK_VALUES[r]] = r;

/**
 * Every river card of a turn hand. A pair's river score is the better of its
 * turn score and its best five with the river card (the six board pairs that
 * go with it). Those fives depend on the pair's two ranks and on whether all
 * five cards share a suit, so each river card is scored once per rank pair
 * (and once more per rank pair in the river card's suit when two board cards
 * share it) with the engine's own evaluator, and every pair reads its score from
 * that table.
 */
function evRivers(
  core: EvCore,
  hole: Card[],
  board: Card[],
  unseen: Card[],
  dead: Card[]
): EvRiver[] {
  const { m, scores } = core;
  // The decision's shared exact count (HorseOmahaRiverTables, built the same
  // way): each river's pair scores are read from it when it serves these cards.
  // Its card order (SUITS x RANKS of PokerEngine) is not this module's: each
  // unseen card is mapped to its index there.
  const tables = omahaTurnRiverTables(hole, board, dead);
  const shared = tables !== null && tables.n === m ? tables : null;
  const at = new Int32Array(m);
  if (shared !== null) {
    const where = new Map<string, number>();
    shared.unseen.forEach((c, i) => where.set(key(c), i));
    for (let i = 0; i < m; i++) at[i] = where.get(key(unseen[i])) ?? -1;
  }
  const mapped = shared !== null && at.every((x) => x >= 0) ? shared : null;
  const rv = new Int32Array(m);
  for (let i = 0; i < m; i++) rv[i] = RANK_VALUES[unseen[i].rank];
  const five: Card[] = [board[0], board[1], board[2], board[3], board[0]];
  const pair: Card[] = [board[0], board[0]];
  const three: Card[] = [board[0], board[0], board[0]];
  const W = 16;
  const plain = new Float64Array(W * W);
  const suited = new Float64Array(W * W);
  const rivers: EvRiver[] = [];
  for (let k = 0; k < m; k++) {
    const rc = unseen[k];
    five[4] = rc;
    const hero = scoreOmahaHiPartial(hole, five);
    if (mapped !== null) {
      const t = mapped.river[at[k]];
      const n = mapped.n;
      const B = new PairSet(m);
      const BT = new PairSet(m);
      for (let i = 0; i < m; i++) {
        if (i === k) continue;
        for (let j = i + 1; j < m; j++) {
          if (j === k) continue;
          const s = t[at[i] * n + at[j]];
          if (s >= hero) {
            BT.add(i, j);
            if (s > hero) B.add(i, j);
          }
        }
      }
      rivers.push({ B, BT });
      continue;
    }
    plain.fill(0);
    suited.fill(0);
    let flushSuit: string | null = null;
    three[2] = rc;
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++) {
        const x = board[a];
        const y = board[b];
        three[0] = x;
        three[1] = y;
        const mono = x.suit === rc.suit && y.suit === rc.suit;
        // Not a flush: one of the pair in a suit the board card is not.
        const off = SUITS.find((s) => s !== x.suit)!;
        for (let p = 2; p <= 14; p++) {
          pair[0] = { rank: RANK_OF_VALUE[p], suit: off } as Card;
          for (let q = p; q <= 14; q++) {
            pair[1] = { rank: RANK_OF_VALUE[q], suit: rc.suit } as Card;
            const s = scoreOmahaHiPartial(pair, three);
            if (s > plain[p * W + q]) plain[p * W + q] = s;
          }
        }
        if (!mono) continue;
        flushSuit = rc.suit;
        for (let p = 2; p <= 14; p++) {
          pair[0] = { rank: RANK_OF_VALUE[p], suit: rc.suit } as Card;
          for (let q = p + 1; q <= 14; q++) {
            pair[1] = { rank: RANK_OF_VALUE[q], suit: rc.suit } as Card;
            const s = scoreOmahaHiPartial(pair, three);
            if (s > suited[p * W + q]) suited[p * W + q] = s;
          }
        }
      }
    const B = new PairSet(m);
    const BT = new PairSet(m);
    for (let i = 0; i < m; i++) {
      if (i === k) continue;
      const ri = rv[i];
      const flushI = flushSuit !== null && unseen[i].suit === flushSuit;
      for (let j = i + 1; j < m; j++) {
        if (j === k) continue;
        const rj = rv[j];
        const at = ri <= rj ? ri * W + rj : rj * W + ri;
        let s = scores[i * m + j];
        const t = plain[at];
        if (t > s) s = t;
        if (flushI && unseen[j].suit === flushSuit) {
          const u = suited[at];
          if (u > s) s = u;
        }
        if (s >= hero) {
          BT.add(i, j);
          if (s > hero) B.add(i, j);
        }
      }
    }
    rivers.push({ B, BT });
  }
  return rivers;
}

/**
 * The score threshold t such that the holdings whose best pair scores ABOVE t
 * are, as nearly as the pair scores allow, the strongest `share` of all
 * holdings. Bisection on the distinct pair scores; each step is one exact
 * count. Returns the threshold and the exact number of holdings above it.
 */
function topShareThreshold(
  core: EvCore,
  share: number,
  memo: Map<number, number>
): { t: number; above: number } {
  const { scores, sorted, m, n, total } = core;
  const aboveOf = (idx: number): number => {
    let v = memo.get(idx);
    if (v === undefined) {
      v = core.above.get(idx);
      if (v === undefined) {
        v = total - countHoldingsWithout(m, n, pairsAbove(scores, m, sorted[idx], false));
        core.above.set(idx, v);
      }
      memo.set(idx, v);
    }
    return v;
  };
  const want = share * total;
  // sorted ascending; above(idx) falls as idx rises. Find the lowest idx with above <= want.
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (aboveOf(mid) <= want) hi = mid;
    else lo = mid + 1;
  }
  // The nearer of the two neighbours to the wanted share.
  let pick = lo;
  if (lo > 0 && Math.abs(aboveOf(lo - 1) - want) < Math.abs(aboveOf(lo) - want)) pick = lo - 1;
  return { t: sorted[pick], above: aboveOf(pick) };
}

export interface OmahaEvShares {
  win: number;
  tie: number;
}

export interface OmahaEvHandCounts {
  street: 'turn' | 'river';
  /** unseen cards, hole count, all opponent holdings */
  unseen: number;
  holeCount: number;
  holdings: number;
  /** two-card pairs and exact counts the answer rests on (the size of the question) */
  pairsScored: number;
  counts: number;
  /** against every holding (uniform): the Horse wins / ties */
  all: OmahaEvShares;
  /** against the value region and the other (bluff) region */
  value: OmahaEvShares;
  other: OmahaEvShares;
  /** the value region's exact share of all holdings */
  valueShare: number;
  /** against the strongest share of holdings, by share: used for the field */
  top: (share: number) => OmahaEvShares & { share: number };
  /** turn only: OMAHA_RUNOUT_ROW numbers per river card (HorseOmahaRunoutRealization) */
  runout?: Float64Array;
}

/**
 * The exact counts for one hand: the Horse's win and tie shares against the
 * bettor's value region (the strongest `valueShare` of holdings on the
 * CURRENT board) and against his other holdings. River: other = the weakest
 * OMAHA_EV_BLUFF_POOL of holdings. Turn: other = every non-value holding, and
 * each share is the average over every river card of the showdown result.
 * Null when the cards do not form an Omaha turn or river hand.
 *
 * The last few hands are remembered (EvCore): a count is a pure function of
 * the cards, so asking again returns the same numbers without counting again.
 */
export function omahaEvHandCounts(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number
): OmahaEvHandCounts | null {
  return evHandCountsGuarded(hole, board, dead, valueShare, PLO6_FACING_BET_EV_TURN);
}

/**
 * Test and benchmark seam: the six-card TURN count, whatever
 * PLO6_FACING_BET_EV_TURN says. No rule calls it.
 */
export function omahaEvHandCountsSixCardTurn(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number
): OmahaEvHandCounts | null {
  return evHandCountsGuarded(hole, board, dead, valueShare, true);
}

function evHandCountsGuarded(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number,
  sixCardTurn: boolean
): OmahaEvHandCounts | null {
  const six = Array.isArray(hole) && hole.length === 6;
  if (!six) return evHandCounts(hole, board, dead, valueShare, sixCardTurn);
  // Six cards: every count of this hand, the ones the returned object takes
  // later included (top, counts), goes through the six-card counter.
  const on = (): void => {
    sixCardCount = sixCardFastCount;
  };
  const off = (): void => {
    sixCardCount = false;
  };
  on();
  try {
    const out = evHandCounts(hole, board, dead, valueShare, sixCardTurn);
    if (out === null) return null;
    const top = out.top;
    return {
      ...out,
      get counts() {
        return out.counts;
      },
      top: (s: number) => {
        on();
        try {
          return top(s);
        } finally {
          off();
        }
      },
    } as OmahaEvHandCounts;
  } finally {
    off();
  }
}

function evHandCounts(
  hole: Card[],
  board: Card[],
  dead: Card[],
  valueShare: number,
  sixCardTurn: boolean
): OmahaEvHandCounts | null {
  if (!Array.isArray(hole) || !Array.isArray(board)) return null;
  // Six cards: the river; the turn only where PLO6_FACING_BET_EV_TURN admits
  // it (SPEC-A 3.12 item 5, TIMING-PLO6).
  if (
    hole.length !== 4 &&
    hole.length !== 5 &&
    !(hole.length === 6 && (board.length === 5 || (sixCardTurn && board.length === 4)))
  )
    return null;
  if (board.length !== 4 && board.length !== 5) return null;
  const deadCards = Array.isArray(dead) ? dead : [];
  const unseen = unseenCards(hole, board, deadCards);
  if (!unseen) return null;
  const m = unseen.length;
  const n = hole.length;
  if (m < n + 1 || m > 48) return null;
  const core = evCore(hole, board, deadCards, unseen);
  const { total, scores } = core;
  const memo = new Map<number, number>();
  let counts = 0;
  let pairsScored = (m * (m - 1)) / 2;
  const cnt = (name: string, bar: () => PairSet, skip = -1): number => {
    counts++;
    let c = core.counted.get(name);
    if (c === undefined) {
      c = countHoldingsWithout(m, n, bar(), skip);
      core.counted.set(name, c);
    }
    return c;
  };
  const share = Math.max(0.01, Math.min(0.95, valueShare));
  const v = topShareThreshold(core, share, memo);

  if (board.length === 5) {
    const hero = scoreOmahaHiPartial(hole, board);
    if (!(hero > 0)) return null;
    const B = pairsAbove(scores, m, hero, false);
    const BT = pairsAbove(scores, m, hero, true);
    const noB = cnt('B', () => B);
    const noBT = cnt('BT', () => BT);
    /** Win / tie shares against the holdings whose best pair is ABOVE t (count `above`). */
    const againstAbove = (t: number, above: number): OmahaEvShares => {
      if (!(above > 0)) return { win: 0, tie: 0 };
      if (hero <= t) return { win: 0, tie: 0 }; // every holding above t beats the hand
      const S = pairsAbove(scores, m, t, false);
      const winIn = noBT - cnt(`BT+${t}`, () => BT.union(S));
      const notBeatenIn = noB - cnt(`B+${t}`, () => B.union(S));
      return { win: winIn / above, tie: (notBeatenIn - winIn) / above };
    };
    /** Win / tie shares against the holdings whose best pair is AT OR BELOW t. */
    const againstBelow = (t: number, above: number): OmahaEvShares => {
      const below = total - above;
      if (!(below > 0)) return { win: 0, tie: 0 };
      const S = pairsAbove(scores, m, t, false);
      const winIn = cnt(`BT+${t}`, () => BT.union(S));
      const notBeatenIn = cnt(`B+${t}`, () => B.union(S));
      return { win: winIn / below, tie: (notBeatenIn - winIn) / below };
    };
    const pool = topShareThreshold(core, 1 - OMAHA_EV_BLUFF_POOL, memo);
    const topMemo = new Map<number, OmahaEvShares & { share: number }>();
    return {
      street: 'river',
      unseen: m,
      holeCount: n,
      holdings: total,
      pairsScored,
      get counts() {
        return counts + memo.size;
      },
      all: { win: noBT / total, tie: (noB - noBT) / total },
      value: (() => {
        // top V at full weight, the thin-value band under it at half weight
        const core0 = againstAbove(v.t, v.above);
        const wide = topShareThreshold(
          core,
          Math.min(0.97, share * (1 + OMAHA_EV_THIN_VALUE_BAND)),
          memo
        );
        const band = wide.above - v.above;
        if (!(band > 0)) return core0;
        const all = againstAbove(wide.t, wide.above);
        const w = OMAHA_EV_THIN_VALUE_WEIGHT;
        const weight = v.above + w * band;
        const part = (c: number, a: number): number =>
          (c * v.above + w * (a * wide.above - c * v.above)) / weight;
        return { win: part(core0.win, all.win), tie: part(core0.tie, all.tie) };
      })(),
      other: againstBelow(pool.t, pool.above),
      valueShare: v.above / total,
      top: (s: number) => {
        const k = Math.round(s * 1000);
        let r = topMemo.get(k);
        if (!r) {
          const th = topShareThreshold(core, s, memo);
          r = { ...againstAbove(th.t, th.above), share: th.above / total };
          topMemo.set(k, r);
        }
        return r;
      },
    } as OmahaEvHandCounts;
  }

  // TURN: every river card (evRivers).
  if (core.rivers === null) core.rivers = evRivers(core, hole, board, unseen, deadCards);
  const rivers = core.rivers;
  let V: PairSet | null = null;
  const valueSet = (): PairSet => (V ??= pairsAbove(scores, m, v.t, false));
  let allWin = 0;
  let allTie = 0;
  let valWin = 0;
  let valTie = 0;
  let othWin = 0;
  let othTie = 0;
  let allN = 0;
  let valN = 0;
  let othN = 0;
  const perRiver = choose(m - 1, n);
  const runout = new Float64Array(m * OMAHA_RUNOUT_ROW);
  // The holdings with no value pair, over every card: one count. Without
  // the river card k it is that less the holdings that contain k, which are
  // k with a smaller holding of the cards no value pair joins to k.
  let noVAny = -1;
  const noValueWithout = (k: number): number => {
    counts++;
    const name = `${k}:V${v.t}`;
    let c = core.counted.get(name);
    if (c === undefined) {
      const set = valueSet();
      if (noVAny < 0) {
        const all = `V${v.t}`;
        const known = core.counted.get(all);
        noVAny = known === undefined ? countHoldingsWithout(m, n, set) : known;
        if (known === undefined) core.counted.set(all, noVAny);
      }
      let lo = (m >= 32 ? -1 : (1 << m) - 1) & ~set.lo[k];
      let hi = (m > 32 ? (1 << (m - 32)) - 1 : 0) & ~set.hi[k];
      if (k < 32) lo &= ~(1 << k);
      else hi &= ~(1 << (k - 32));
      c = noVAny - countHoldingsAmong(m, n - 1, set, lo, hi);
      core.counted.set(name, c);
    }
    return c;
  };
  for (let k = 0; k < m; k++) {
    const { B, BT } = rivers[k];
    pairsScored += ((m - 1) * (m - 2)) / 2;
    // Two sets with the same pairs have the same count: taken once.
    const taken: Array<[PairSet, number]> = [];
    const cntK = (name: string, bar: () => PairSet): number => {
      counts++;
      let c = core.counted.get(name);
      if (c === undefined) {
        const set = bar();
        for (const [other, n0] of taken)
          if (samePairs(other, set)) {
            c = n0;
            break;
          }
        if (c === undefined) {
          c = countHoldingsWithout(m, n, set, k);
          taken.push([set, c]);
        }
        core.counted.set(name, c);
      }
      return c;
    };
    const noB = cntK(`${k}:B`, () => B);
    const noBT = cntK(`${k}:BT`, () => BT);
    const noV = noValueWithout(k);
    const noBV = cntK(`${k}:B+${v.t}`, () => B.union(valueSet()));
    const noBTV = cntK(`${k}:BT+${v.t}`, () => BT.union(valueSet()));
    allN += perRiver;
    allWin += noBT;
    allTie += noB - noBT;
    othN += noV;
    othWin += noBTV;
    othTie += noBV - noBTV;
    valN += perRiver - noV;
    valWin += noBT - noBTV;
    valTie += noB - noBT - (noBV - noBTV);
    runout[k * OMAHA_RUNOUT_ROW] = noBT - noBTV + 0.5 * (noB - noBT - (noBV - noBTV));
    runout[k * OMAHA_RUNOUT_ROW + 1] = perRiver - noV;
    runout[k * OMAHA_RUNOUT_ROW + 2] = noBTV + 0.5 * (noBV - noBTV);
    runout[k * OMAHA_RUNOUT_ROW + 3] = noV;
  }
  // The field on the turn is read on the turn board as it stands (not per river card).
  const heroNow = scoreOmahaHiPartial(hole, board);
  const BTnow = pairsAbove(scores, m, heroNow, true);
  const Bnow = pairsAbove(scores, m, heroNow, false);
  const noBnow = cnt('B', () => Bnow);
  const noBTnow = cnt('BT', () => BTnow);
  const topMemo = new Map<number, OmahaEvShares & { share: number }>();
  return {
    street: 'turn',
    unseen: m,
    holeCount: n,
    holdings: total,
    pairsScored,
    get counts() {
      return counts + memo.size;
    },
    all: { win: allWin / allN, tie: allTie / allN },
    value: valN > 0 ? { win: valWin / valN, tie: valTie / valN } : { win: 0, tie: 0 },
    other: othN > 0 ? { win: othWin / othN, tie: othTie / othN } : { win: 0, tie: 0 },
    valueShare: v.above / total,
    runout,
    top: (s: number) => {
      const kk = Math.round(s * 1000);
      let r = topMemo.get(kk);
      if (!r) {
        const th = topShareThreshold(core, s, memo);
        if (!(th.above > 0) || heroNow <= th.t) r = { win: 0, tie: 0, share: th.above / total };
        else {
          const S = pairsAbove(scores, m, th.t, false);
          const winIn = noBTnow - cnt(`BT+${th.t}`, () => BTnow.union(S));
          const nb = noBnow - cnt(`B+${th.t}`, () => Bnow.union(S));
          r = { win: winIn / th.above, tie: (nb - winIn) / th.above, share: th.above / total };
        }
        topMemo.set(kk, r);
      }
      return r;
    },
  } as OmahaEvHandCounts;
}

// ───────────────────────────── the spot ─────────────────────────────

export interface OmahaFacingBetEvSpot {
  street: 'turn' | 'river';
  /** The seat whose bet or raise the Horse faces. */
  bettorSeat: number;
  /** The wager as a share of the pot before it (heads-up: the part of it the Horse can call). */
  potFrac: number;
  bucket: OmahaBetSizeBucket;
  /** The wager is a raise over an earlier wager on the street. */
  isRaise: boolean;
  /** Earlier postflop streets on which the bettor bet or raised / only called a bet. */
  aggressorStreets: number;
  callerStreets: number;
  /** Other players in the hand: called this wager, all in from an earlier street, still to act. */
  callers: number;
  allIns: number;
  behind: number;
  /** The seats of the players who called this wager (for their learned call read). */
  callerSeats: number[];
  /** Chips the call puts in, and the chips it can win. */
  paid: number;
  winnable: number;
  /** The call is for the whole stack. */
  allIn: boolean;
  /** No chips of consequence are left after the call (or it is the river): no later decision. */
  final: boolean;
  /** On a non-final turn, whether the bettor keeps enough stack behind (>25% final pot) to barrel the river. */
  bettorCanBarrelRiver?: boolean;
  /** The value share used for this bet and line. */
  valueShare: number;
  /** The population-prior bluff share for this bet. */
  priorBluff: number;
}

/** Who asks for the spot: absent for every PLO4/PLO5 caller. */
export interface OmahaFacingBetEvSpotScope {
  /** plo6FacingBetIsPriced's own caller: a PLO6 cash turn or river spot (HorsePlo6FacingBetIsPriced.ts). */
  plo6Priced?: boolean;
}

/**
 * The spot the decision covers, with its public numbers, or null outside it.
 * It does not look at the Horse's hand or the legacy decision.
 */
export function omahaFacingBetEvSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  scope?: OmahaFacingBetEvSpotScope
): OmahaFacingBetEvSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    // plo6FacingBetIsPriced (HorsePlo6FacingBetIsPriced.ts): the six-card spot is opened by that option's own
    // caller only, on the turn and the river, without the PLO4/PLO5 strategy scope and without the
    // continuous range (its verdict is the stated model, re-run by the receipt validator).
    const plo6Priced = scope?.plo6Priced === true && variant === 'plo6';
    if (!plo6Priced && !omahaStrategyGameInScope(OMAHA_FACING_BET_EV_VARIANTS, gs)) return null;
    // Cash only, read as HorseLogic.isTournamentMode reads it;
    // omahaStrategyInTournaments (HorseOmahaTournamentScope) opens its public tournament scope.
    if (omahaCashOnlyExcludes(player, gs)) return null;
    const street = gs.stage === 'turn' ? 'turn' : gs.stage === 'river' ? 'river' : null;
    if (
      street === null ||
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.allInOrFold ||
      gs.wagersCapped === true
    )
      return null;
    const board = gs.communityCards ?? [];
    const hole = player.cards ?? [];
    if (board.length !== (street === 'turn' ? 4 : 5) || hole.length !== Number(variant.at(-1)))
      return null;
    // PLO6 (SPEC-A 3.12 items 5 and 6): the river only, cash only; the six-card
    // turn stays with today's brain while PLO6_FACING_BET_EV_TURN is false.
    if (
      hole.length === 6 &&
      ((street !== 'river' && !PLO6_FACING_BET_EV_TURN && !plo6Priced) || plo6PricingExcludes(gs))
    )
      return null;
    // The league and offline states carry no toCall: it is the current bet less the Horse's own.
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Number.isFinite(gs.currentBet) && Number.isFinite(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (
      !Number.isFinite(toCall) ||
      !(toCall > 0.005) ||
      !Number.isFinite(gs.currentBet) ||
      !Number.isFinite(gs.pot) ||
      !(gs.pot > 0) ||
      !Number.isFinite(player.stack) ||
      !(player.stack > 0) ||
      !Number.isFinite(player.bet) ||
      player.is_folded ||
      player.is_all_in ||
      player.is_sitting_out
    )
      return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
    const allIn = player.stack <= toCall + 0.005;
    const paid = Math.min(player.stack, toCall);
    if (
      Array.isArray(gs.legalActions) &&
      !gs.legalActions.includes(allIn ? 'all_in' : 'call') &&
      !gs.legalActions.includes('call')
    )
      return null;

    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, street, bets, gs.pot);
    if (!faced || faced.bettorSeat === player.seat) return null;
    const bettor = gs.players.find((p) => p.seat === faced.bettorSeat);
    if (!bettor || bettor.is_folded || bettor.is_sitting_out) return null;
    // Heads-up, a wager the Horse cannot cover is a bet of what the Horse can
    // call: the size the bettor chose is the effective one.
    // (Nobody else can call it or has called it: all in on an earlier street at most.)
    const onlyBettorLive = gs.players.every(
      (p) =>
        p.seat === player.seat ||
        p.seat === faced.bettorSeat ||
        p.is_folded ||
        p.is_sitting_out ||
        (p.is_all_in && !(p.bet > 0.005))
    );
    const cover = Math.max(0, gs.currentBet - (player.bet + paid));
    const effectiveWager = onlyBettorLive ? Math.max(0, faced.wager - cover) : faced.wager;
    const potFrac = effectiveWager / faced.potBefore;
    if (!Number.isFinite(potFrac) || !(potFrac > 0)) return null;

    /** Per street: did `seat` raise the level (bet or raise), or only call. */
    const lineOn = (
      st: string,
      seat: number
    ): { wagers: number; aggr: boolean; raised: boolean; called: boolean } => {
      let level = 0;
      let wagers = 0;
      let aggr = false;
      let raised = false;
      let called = false;
      const totals = new Map<number, number>();
      for (const a of gs.actionHistory ?? []) {
        if (String(a.stage) !== st) continue;
        const prev = totals.get(a.seat) ?? 0;
        const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
        if (a.action === 'call') {
          totals.set(a.seat, prev + amt);
          if (a.seat === seat && amt > 0) called = true;
        } else if (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') {
          const now = Math.max(prev, amt);
          totals.set(a.seat, now);
          if (now > level + 0.005) {
            level = now;
            wagers++;
            if (a.seat === seat) {
              aggr = true;
              if (wagers >= 2) raised = true;
            }
          } else if (a.seat === seat && now > prev) called = true;
        }
      }
      return { wagers, aggr, raised, called };
    };
    const isRaise = lineOn(street, faced.bettorSeat).wagers >= 2;
    let aggressorStreets = 0;
    let callerStreets = 0;
    let earlierRaised = false;
    for (const st of street === 'river' ? ['flop', 'turn'] : ['flop']) {
      const l = lineOn(st, faced.bettorSeat);
      if (l.aggr) {
        aggressorStreets++;
        if (l.raised) earlierRaised = true;
      } else if (l.called) callerStreets++;
    }

    // The field.
    let callers = 0;
    const callerSeats: number[] = [];
    let allIns = 0;
    let behind = 0;
    let uncovered = 0;
    const heroTotal = player.bet + paid;
    for (const p of gs.players) {
      if (p.seat === player.seat || p.is_folded || p.is_sitting_out) continue;
      const bet = Number.isFinite(p.bet) ? Math.max(0, p.bet) : 0;
      // What a short call cannot win from this player's street wager.
      uncovered += Math.max(0, Math.min(bet, gs.currentBet) - heroTotal);
      if (p.seat === faced.bettorSeat) continue;
      if (p.is_all_in && bet <= 0.005) allIns++;
      else if (p.is_all_in || bet + 0.011 >= gs.currentBet) {
        callers++;
        callerSeats.push(p.seat);
      } else behind++;
    }
    const winnable = gs.pot - uncovered;
    if (!(winnable > 0)) return null;
    const leftBehind = player.stack - paid;
    const final =
      street === 'river' ||
      allIn ||
      leftBehind <= OMAHA_FACING_BET_EV_TRIVIAL_BEHIND * (winnable + paid);
    const bettorCanBarrelRiver =
      street === 'turn' &&
      !bettor.is_all_in &&
      Number.isFinite(bettor.stack) &&
      bettor.stack > 0.25 * (winnable + paid);
    const bucket = omahaBetSizeBucket(potFrac);
    const boardPaired = new Set(board.map((c) => c.rank)).size < board.length;
    // Hand #59730132: a defender who only called earlier postflop street(s) and
    // donk-leads >= 40% pot on a paired river directly into the turn aggressor is
    // at least as polarized to full houses / quads as a river raise (never leading
    // second-nut flushes or bare trips for thin value into an uncapped aggressor).
    const pairedRiverDonkIntoAggressor =
      street === 'river' &&
      !isRaise &&
      boardPaired &&
      potFrac >= 0.4 &&
      aggressorStreets === 0 &&
      callerStreets >= 1 &&
      lineOn('turn', player.seat).aggr;
    // Hands #59770288, #59740955, #59768596: when an opponent who already bet or
    // raised an earlier postflop street puts hero's capped remaining stack all-in
    // on an unpaired board, effectiveWager is truncated by hero's remaining stack
    // rather than chosen as a thin <40%/mid block bet.
    const unpairedMultiStreetAllIn =
      !isRaise &&
      !boardPaired &&
      allIn &&
      aggressorStreets >= 1 &&
      (bucket === 'under40' || bucket === 'mid');
    // Hand #59775543: betting >= 25% pot into multiple opponents on a paired
    // river is polarized to trips or full houses, never thin two-pair/one-pair value.
    const pairedRiverMultiwayValue =
      street === 'river' && !isRaise && boardPaired && potFrac >= 0.25 && callers + behind >= 1;
    // Hand #59755179: raising an earlier postflop street and barreling every
    // street into a >= 70%-pot river bet represents a raise-narrowed nutted range.
    const earlierRaisedBigRiverBarrel =
      street === 'river' && !isRaise && earlierRaised && aggressorStreets >= 2 && potFrac >= 0.7;
    let valueShare = pairedRiverDonkIntoAggressor
      ? OMAHA_EV_VALUE_SHARE.river.raise * OMAHA_EV_LINE_AGGRESSOR ** callerStreets
      : OMAHA_EV_VALUE_SHARE[street][
          isRaise ? 'raise' : unpairedMultiStreetAllIn || pairedRiverMultiwayValue ? 'big' : bucket
        ] *
        OMAHA_EV_LINE_AGGRESSOR ** aggressorStreets *
        OMAHA_EV_LINE_CALLER ** callerStreets;
    let priorBluff = pairedRiverDonkIntoAggressor
      ? OMAHA_EV_PRIOR_BLUFF.river.raise
      : unpairedMultiStreetAllIn
        ? Math.min(
            omahaEvPriorBluffShare(street, potFrac, false),
            OMAHA_EV_PRIOR_BLUFF[street].big
          ) *
          OMAHA_EV_LINE_AGGRESSOR ** aggressorStreets
        : omahaEvPriorBluffShare(street, potFrac, isRaise);
    if (earlierRaisedBigRiverBarrel) {
      valueShare *= 0.7;
      priorBluff = Math.min(priorBluff, OMAHA_EV_PRIOR_BLUFF.river.raise);
    }
    // omahaFacingBetRangeIsContinuous (default off): the same range knowledge with the size as a
    // continuous input, never a trigger (HorseOmahaPricedMode.omahaPricedFacingRange).
    if (!plo6Priced && omahaPricedModeNow().rangeContinuous) {
      const continuous = omahaPricedFacingRange({
        street,
        isRaise,
        chosenFrac: faced.wager / faced.potBefore,
        potFrac,
        aggressorStreets,
        callerStreets,
        earlierRaised,
        boardPaired,
        heroBetTurn: street === 'river' && lineOn('turn', player.seat).aggr,
        others: callers + behind,
        behindShare: Math.max(0, leftBehind) / (winnable + paid),
        value: OMAHA_EV_VALUE_SHARE[street],
        // the measured prior of the bettor's KIND (a person's bluffs for a person, a Horse's for a
        // Horse: HorseOmahaPricedMode.omahaPricedKindPrior), not the stepped table
        // (omahaPricedPriorsByOpponentKind on; off: the #11212 person-measured table for every bettor)
        bluff: omahaPricedKindPrior(
          omahaPricedModeNow().priorsByKind === true
            ? omahaOpponentKindOf(
                gs,
                (gs.players ?? []).find((p) => p.seat === faced.bettorSeat)?.user_id
              )
            : null
        ).bluff[street],
        lineAggressor: OMAHA_EV_LINE_AGGRESSOR,
        lineCaller: OMAHA_EV_LINE_CALLER,
      });
      valueShare = continuous.valueShare;
      priorBluff = continuous.priorBluff;
    }
    // plo6FacingBetIsPriced: the value share was set on four- and five-card holdings; for six cards the
    // region is taken at the same hand strength on this board (HorsePlo6ValueShare).
    if (plo6Priced)
      valueShare = plo6ValueShareAtSameStrength(
        hole,
        board,
        player.knownDeadCards ?? [],
        valueShare
      );
    return {
      street,
      bettorSeat: faced.bettorSeat,
      potFrac,
      bucket,
      isRaise,
      aggressorStreets,
      callerStreets,
      callers,
      allIns,
      behind,
      callerSeats,
      paid,
      winnable,
      allIn,
      final,
      ...(street === 'turn' ? { bettorCanBarrelRiver } : {}),
      valueShare,
      priorBluff,
    };
  } catch {
    return null;
  }
}

// ───────────────────────────── the verdict ─────────────────────────────

export interface OmahaFacingBetEvVerdict {
  call: boolean;
  /** PLO6 only, present when true: the M1 river fold test holds, so `call` is false whatever the EV. */
  plo6FoldStands?: true;
  /** EV of the call in chips, and the margin it had to exceed. */
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  /** the bluff share used and the value share counted */
  bluffShare: number;
  valueShare: number;
  /** the Horse's win share against the value region / the other region, before the field */
  vsValue: number;
  vsOther: number;
  /** the product of the field factors (1 heads-up) */
  field: number;
  /** the realization factor applied (1 when final) */
  realization: number;
  /** omahaFacingBetEvShownField: the C3 verdict, when it decided */
  shownField?: OmahaShownFieldVerdict;
  /** omahaRiverBluffCatchIsPriced: the river bluff-catch verdict, when it decided */
  riverBluffCatch?: OmahaRiverBluffCatchVerdict;
  /** omahaTurnCallRealizationByRunout: the runout factor, when it was the one read */
  runoutRealization?: number;
  /** pot odds of the call, for the record */
  price: number;
  /** omahaPairedBoardRiverIsPriced: present when call, ev, pWin and pTie were priced on the bettor's
   *  line-conditioned range (HorseOmahaPairedRiverPriced); the other numbers are the uniform count's */
  pairedRiverPriced?: { boatShare: number; preflopWidth: number; samples: number };
  /** work done */
  pairsScored: number;
  counts: number;
}

export interface OmahaFacingBetEvContext {
  /** the marginal rake on the pot, as a fraction (0 when capped or none) */
  rake?: number;
  /**
   * omahaStrategyInTournaments: the tournament survival premium on this call
   * (HorseOmahaTournamentScope.omahaTournamentIcmPremium), in equity. It is
   * added to the one margin: EV(call) must exceed (margin + premium) x the
   * final pot, which is the engine's tournament call bar (equity above the
   * price plus the premium). 0 or absent: the cash arithmetic exactly.
   */
  riskPremium?: number;
  /**
   * PLO6 only (six cards): the decision's v58Plo6RiverNuts and
   * v59Plo6RiverUnpaired, read `!== false`. With one off, the six-card guard
   * does not apply that board's river fold test. Absent: on.
   */
  plo6RiverNuts?: boolean;
  plo6RiverUnpaired?: boolean;
  /** the engine's realization factor for a turn call with chips behind */
  realization?: number;
  /**
   * plo6FacingBetIsPriced only (HorsePlo6FacingBetIsPriced.ts): count a six-card TURN hand exactly
   * (omahaEvHandCountsSixCardTurn) whatever PLO6_FACING_BET_EV_TURN says. Absent: as before.
   */
  sixCardTurn?: boolean;
  /**
   * omahaTurnCallRealizationByRunout: present only with the option on. The
   * non-final turn call's factor is then read from the hand's per-river
   * counts (HorseOmahaRunoutRealization) instead of `realization`.
   */
  runoutRealization?: { inPosition: boolean };
  /**
   * omahaFacingBetEvShownField (WooWoo F-04/F-11 C3): present only with the
   * option on. A turn or river call with another player in the hand is then
   * priced by HorseOmahaFacingBetEvShownField (joint field in the flop form,
   * measured turn realization, close calls mixed on a public-state draw).
   * `continueRate` is the rate a player still to act continues; `mixUnit` a
   * number in [0, 1) drawn from public state only.
   */
  shownField?: { inPosition: boolean; continueRate: number; mixUnit: number };
  /**
   * omahaRiverBluffCatchIsPriced (WooWoo RIVER-FACING): present only with the
   * option on. A heads-up first river bet (not a raise) is then priced on the
   * bettor's measured range composition with the Horse's blockers
   * (HorseOmahaRiverBluffCatch). `mixUnit` from public state only.
   */
  riverBluffCatch?: { mixUnit: number; rows?: readonly OmahaRiverRow[] };
}

/**
 * PLO6 only: the six-card guard alone, on the request's own cards (pure: no
 * read, no option). True when the river fold test stands, so the EV rule
 * cannot have turned the fold into a call; false when it does not stand; null
 * when the hand is not a six-card river hand that can be counted. The receipt
 * validator re-runs it (both tests on: it does not know V58/V59).
 */
export function omahaPlo6FacingBetEvFoldStands(
  spot: OmahaFacingBetEvSpot,
  hole: Card[],
  board: Card[],
  dead: Card[]
): boolean | null {
  if (!Array.isArray(hole) || hole.length !== 6 || !Array.isArray(board) || board.length !== 5)
    return null;
  let counted: OmahaEvHandCounts | null;
  try {
    counted = omahaEvHandCounts(hole, board, dead, spot.valueShare);
  } catch {
    counted = null;
  }
  if (!counted) return null;
  const price = spot.paid / (spot.winnable + spot.paid);
  return plo6EvFoldStands(1 - counted.all.win - counted.all.tie, board, price);
}

/** The decision: call when EV(call) exceeds the one margin. Null when the hand cannot be counted. */
export function omahaFacingBetEvVerdict(
  spot: OmahaFacingBetEvSpot,
  hole: Card[],
  board: Card[],
  dead: Card[],
  read: OmahaFacingBetEvRead | null,
  ctx: OmahaFacingBetEvContext = {}
): OmahaFacingBetEvVerdict | null {
  let hand: OmahaEvHandCounts | null;
  try {
    hand =
      ctx.sixCardTurn === true
        ? omahaEvHandCountsSixCardTurn(hole, board, dead, spot.valueShare)
        : omahaEvHandCounts(hole, board, dead, spot.valueShare);
  } catch {
    hand = null;
  }
  if (!hand) return null;
  const counted = hand;
  const q = omahaEvBluffShare(spot.priorBluff, read, spot.street);
  let pWin = q * counted.other.win + (1 - q) * counted.value.win;
  let pTie = q * counted.other.tie + (1 - q) * counted.value.tie;
  // The field: each must be beaten too. A player already in is always there;
  // a player still to act is there only with the share he continues with.
  let field = 1;
  const need = (share: number, alwaysIn: boolean): number => {
    const s = counted.top(share);
    const holds = s.win + s.tie * 0.5;
    return alwaysIn ? holds : 1 - share * (1 - holds);
  };
  // Every caller is modelled on the population share: the opponent memory
  // keeps no showdown record of a player's calls by wager size, so there is
  // no per-caller read to move it (audit 2026-11-15, item 8: the unfed
  // callerShown input was removed).
  const baseCallerShare = OMAHA_EV_CALLER_SHARE[spot.street];
  const callerShare =
    spot.potFrac < 0.25 ? 1 - (1 - baseCallerShare) * (spot.potFrac / 0.25) : baseCallerShare;
  if (spot.callers > 0) field *= need(callerShare, true) ** spot.callers;
  if (spot.allIns > 0) field *= need(OMAHA_EV_ALL_IN_SHARE, true) ** spot.allIns;
  if (spot.behind > 0) field *= need(OMAHA_EV_BEHIND_SHARE, false) ** spot.behind;
  pWin *= field;
  pTie *= field;
  let realization = spot.final
    ? 1
    : Math.max(0.5, Math.min(1, Number.isFinite(ctx.realization) ? ctx.realization! : 0.85));
  let runoutRealization: number | undefined;
  if (!spot.final && ctx.runoutRealization && hole.length !== 6) {
    const r = omahaRunoutRealization(counted.runout, q, ctx.runoutRealization.inPosition === true);
    if (r) realization = runoutRealization = r.realization;
  }
  if (!spot.final && spot.behind > 0) realization = Math.min(realization, 0.85);
  // omahaFacingBetRangeIsContinuous (default off): the two size lines below are weights, not steps.
  const continuousSize = omahaPricedModeNow().rangeContinuous;
  // Hand #59725321: on an already-paired turn facing a >= 40%-pot wager with
  // river barrel stacks still behind, a non-boat hand with zero full-house/quad
  // river outs draws dead against every boat in the bettor's range and folds
  // blank rivers when the aggressor barrels again, realizing equity only on
  // river check-downs.
  if (
    spot.street === 'turn' &&
    !spot.final &&
    (continuousSize || spot.potFrac >= 0.4) &&
    spot.bettorCanBarrelRiver !== false &&
    board.length === 4 &&
    new Set(board.map((c) => c.rank)).size < 4 &&
    scoreOmahaHiPartial(hole, board) < 7 * 0x100000
  ) {
    const seen = new Set([...hole, ...board, ...dead].map(key));
    let boatOuts = 0;
    for (const s of SUITS) {
      for (const r of RANKS) {
        const k = `${r}:${s}`;
        if (seen.has(k)) continue;
        if (scoreOmahaHiPartial(hole, [...board, { rank: r, suit: s }]) >= 7 * 0x100000) {
          boatOuts++;
          break;
        }
      }
      if (boatOuts > 0) break;
    }
    if (boatOuts === 0)
      realization = Math.min(
        realization,
        continuousSize ? omahaPricedRealizationCap(spot.potFrac, 0.2, 0.6, 0.42) : 0.42
      );
  }
  // Hand #59749333: on a non-final turn facing a >= 70%-pot barrel from an
  // earlier-street aggressor with river barrel stacks behind, an unimproved
  // one-pair or two-pair hand (< trips) without a nut flush draw, nut straight
  // outs, or an >= 8-out straight draw folds most river barrels (a baby flush
  // draw like 7d3d wins rarely when completed against a multi-street pot barrel)
  // and cannot realize IP check-down equity.
  if (
    spot.street === 'turn' &&
    !spot.final &&
    (continuousSize || spot.potFrac >= 0.7) &&
    spot.aggressorStreets >= 1 &&
    spot.bettorCanBarrelRiver !== false &&
    board.length === 4 &&
    scoreOmahaHiPartial(hole, board) < 4 * 0x100000
  ) {
    const draw = omahaDrawQuality(hole, board, false);
    if (!draw.nutFlushDraw && draw.nutStraightOuts === 0 && draw.straightOuts < 8) {
      realization = Math.min(
        realization,
        continuousSize ? omahaPricedRealizationCap(spot.potFrac, 0.45, 0.95, 0.65) : 0.65
      );
    }
  }
  pWin *= realization;
  pTie *= realization;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? ctx.rake! : 0));
  const win = spot.winnable * (1 - rake);
  const pLose = Math.max(0, 1 - pWin - pTie);
  const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
  const premium =
    Number.isFinite(ctx.riskPremium) && (ctx.riskPremium as number) > 0
      ? Math.min(0.5, ctx.riskPremium as number)
      : 0;
  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: `plo${hole.length}` }) *
    (spot.winnable + spot.paid);
  const cashMargin =
    continuousSize || spot.potFrac < 0.1 ? Math.min(baseMargin, 0.5 * spot.paid) : baseMargin;
  const margin = cashMargin + premium * (spot.winnable + spot.paid);
  // PLO6 (SPEC-A 3.12 item 4, K1): where the M1 river fold test holds, the
  // verdict is never a call, whatever the EV says. Against every holding
  // (uniform) the hand is beaten 1 - win - tie of the time: the exact form of
  // M1's beat probability (H17).
  const price = spot.paid / (spot.winnable + spot.paid);
  const plo6FoldStands =
    hole.length === 6 &&
    // plo6FacingBetIsPriced's own caller (sixCardTurn) asks for the price alone: no random-hand guard.
    ctx.sixCardTurn !== true &&
    plo6EvFoldStands(1 - counted.all.win - counted.all.tie, board, price, {
      paired: ctx.plo6RiverNuts !== false,
      unpaired: ctx.plo6RiverUnpaired !== false,
    });
  // omahaRiverBluffCatchIsPriced (default off): a heads-up first river bet priced on the bettor's measured range.
  if (
    ctx.riverBluffCatch &&
    spot.street === 'river' &&
    !spot.isRaise &&
    hole.length !== 6 &&
    spot.callers + spot.allIns + spot.behind === 0 &&
    !(premium > 0)
  ) {
    let bc: OmahaRiverBluffCatchVerdict | null = null;
    try {
      bc = omahaRiverBluffCatchVerdict(hole, board, dead, {
        potFrac: spot.potFrac,
        paid: spot.paid,
        winnable: spot.winnable,
        rake,
        margin,
        readFactor: spot.priorBluff > 0 ? q / spot.priorBluff : 1,
        mixUnit: ctx.riverBluffCatch.mixUnit,
        ...(ctx.riverBluffCatch.rows ? { rows: ctx.riverBluffCatch.rows } : {}),
      });
    } catch {
      bc = null;
    }
    if (bc)
      return {
        call: bc.call,
        ev: bc.ev,
        margin,
        pWin: bc.equity,
        pTie: 0,
        bluffShare: q,
        valueShare: counted.valueShare,
        vsValue: counted.value.win,
        vsOther: counted.other.win,
        field,
        realization: 1,
        riverBluffCatch: bc,
        price,
        pairsScored: counted.pairsScored,
        counts: counted.counts,
      };
  }
  // omahaFacingBetEvShownField (default off): the field priced jointly, realization measured, close calls mixed.
  let shown: OmahaShownFieldVerdict | null = null;
  if (
    ctx.shownField &&
    hole.length !== 6 &&
    spot.callers + spot.allIns + spot.behind > 0 &&
    !(premium > 0)
  ) {
    try {
      shown = omahaShownFieldVerdict(hole, board, dead, spot.valueShare, {
        street: spot.street,
        paid: spot.paid,
        winnable: spot.winnable,
        rake,
        final: spot.final,
        bluff: q,
        always: [
          ...Array.from({ length: spot.callers }, () => callerShare),
          ...Array.from({ length: spot.allIns }, () => OMAHA_EV_ALL_IN_SHARE),
        ],
        behind: spot.behind,
        behindShare: callerShare,
        continueRate: ctx.shownField.continueRate,
        inPosition: ctx.shownField.inPosition === true,
        margin,
        mixUnit: ctx.shownField.mixUnit,
      });
    } catch {
      shown = null;
    }
  }
  if (shown) {
    return {
      call: shown.call,
      ev: shown.ev,
      margin,
      pWin: shown.equity,
      pTie: 0,
      bluffShare: q,
      valueShare: counted.valueShare,
      vsValue: counted.value.win,
      vsOther: counted.other.win,
      field,
      realization: shown.realization,
      shownField: shown,
      price,
      pairsScored: counted.pairsScored,
      counts: counted.counts,
    };
  }
  return {
    call: ev > margin && !plo6FoldStands,
    ...(plo6FoldStands ? { plo6FoldStands: true } : {}),
    ev,
    margin,
    pWin,
    pTie,
    bluffShare: q,
    valueShare: counted.valueShare,
    vsValue: counted.value.win,
    vsOther: counted.other.win,
    field,
    realization,
    ...(runoutRealization !== undefined ? { runoutRealization } : {}),
    price: spot.paid / (spot.winnable + spot.paid),
    pairsScored: counted.pairsScored,
    counts: counted.counts,
  };
}
