/**
 * OMAHA RE-RAISED POT DISCIPLINE (owner ruling 2026-11-14 23:49 Chicago,
 * option omahaReraisedPotDiscipline, default OFF after its evaluation failed, 2026-11-15).
 *
 * The ruling, in substance: when a pot is 4-bet and 5-bet before the flop,
 * ace-high broadway hands without a pair of aces or a strong suited connected
 * structure go down a long way in value, and the Horse must not then call off
 * its stack after the flop with top-and-bottom pair or one pair because the
 * price looks cheap. In the reported PLO hand the Horse put its stack in
 * before the flop through a 4-bet and a 5-bet with such a hand, then called
 * all in on the turn with two pair that was not top two on "priced in" logic.
 *
 * Two cells, both public information plus hero's cards (Omaha high PLO4 and
 * PLO5 cash on one board; not hi-lo, not a bomb pot, not all-in-or-fold, not a
 * tournament):
 *
 * PREFLOP (omahaReraisedPreflopCell): hero faces a 4-bet or larger (three or
 * more preflop raises in the history, an all-in that moved the bet counting as
 * one) and the decision continues (call, raise or all-in). A hand without a
 * pair of aces and without a declared premium structure (omahaReraisedPremium:
 * kings double-suited, or a double-suited rundown of four ranks inside a span
 * of four, lowest card seven or higher) folds, unless the call already commits
 * the stack (all in, or less than the resulting pot left behind) AND the
 * hand's equity against a declared 4-bettor range (a random hand holding a
 * pair of aces) pays the direct price of the call.
 *
 * POSTFLOP (omahaReraisedPostflopCell): in a pot raised three or more times
 * before the flop, hero holds one pair or two pair below top two
 * (omahaMadeClass cls pair, low2p or board2p) and faces a wager whose call
 * (or hero's own raise over it) puts the stack in: the call is all in, or it
 * leaves less than the resulting pot behind. The continue folds unless the
 * hand's equity against a declared strong range pays the price: a random
 * opponent hand that holds a pair of aces or already makes top two pair or
 * better on this board (omahaMadeClass top2p, set, trips or any straight or
 * better).
 *
 * The equities are Monte Carlo estimates on a private generator seeded from
 * the cards, so a decision is reproducible and the brain's random stream is
 * never drawn. A sample that cannot be filled keeps today's decision.
 */
import type { Card } from '../types.js';
import {
  omahaCardId,
  omahaDrawQuality,
  omahaMadeClass,
  omahaPreflopPercentile,
  omahaPreflopScoreOfIds,
  omahaRunTriples,
  scoreOmahaHi,
  scoreOmahaHiOfIdsOnRun,
} from './HorseEval.js';
import { omahaStrategyGameInScope, omahaStrategyGameScopeNow } from './HorseOmahaStrategyGame.js';
import { PLO6_HOLE_CARDS, plo6ReraisedPremium } from './HorsePlo6StrategyCalibration.js';

export const RERAISED_POT_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** Preflop raises (open = 1) that make a pot "4-bet or more". */
export const RERAISED_MIN_PREFLOP_RAISES = 3;
/** Opponent holdings sampled for an equity estimate. */
export const RERAISED_EQUITY_SAMPLES = 400;
/** Lowest rank of a premium rundown (7). */
export const RERAISED_RUNDOWN_MIN_RANK = 7;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const RANK_VALUE: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const cardKey = (c: Card): string => `${c.rank}:${c.suit}`;

/** One public preflop action as the engine records it. */
export interface ReraisedAction {
  stage: string;
  action: string;
  isFullRaise?: boolean;
}

/**
 * Preflop raises in the history: a bet or raise, or an all-in that moved the
 * bet (isFullRaise defined), as the V28 preflop router counts them. Blinds,
 * antes and straddles are not raises.
 */
export function preflopRaiseCount(history: readonly ReraisedAction[] | undefined): number {
  let n = 0;
  for (const a of history ?? []) {
    if (a.stage !== 'preflop') continue;
    if (
      a.action === 'raise' ||
      a.action === 'bet' ||
      (a.action === 'all_in' && a.isFullRaise !== undefined)
    )
      n++;
  }
  return n;
}

function doubleSuited(hole: readonly Card[]): boolean {
  const n = new Map<string, number>();
  for (const c of hole) n.set(c.suit, (n.get(c.suit) ?? 0) + 1);
  return [...n.values()].filter((k) => k >= 2).length >= 2;
}

/**
 * The declared continue range facing a 4-bet or more: a pair of aces; kings
 * double-suited; or a double-suited rundown (four distinct ranks inside a
 * span of four, the lowest seven or higher). Everything else, including the
 * ace-high broadway hands of the ruling, is not premium here.
 *
 * PLO6 (six-card port, SPEC-B H27 and 3.22; only inside a decision whose
 * omahaStrategyInPlo6 gate is on): a six-card hand is judged by the PLO6
 * definition (plo6ReraisedPremium: the same structure required of the SAME
 * cards; 11.63% of six-card hands against 20.25% unchanged, N1). With the
 * gate off, and for four or five cards, the text above is unchanged.
 */
export function omahaReraisedPremium(hole: readonly Card[]): boolean {
  if (hole.length === PLO6_HOLE_CARDS && omahaStrategyGameScopeNow().plo6)
    return plo6ReraisedPremium(hole);
  const ranks = hole.map((c) => RANK_VALUE[c.rank] ?? 0);
  const count = (r: number) => ranks.filter((x) => x === r).length;
  if (count(14) >= 2) return true;
  if (!doubleSuited(hole)) return false;
  if (count(13) >= 2) return true;
  const distinct = [...new Set(ranks)].sort((a, b) => b - a);
  for (let i = 0; i + 3 < distinct.length; i++)
    if (distinct[i] - distinct[i + 3] <= 4 && distinct[i + 3] >= RERAISED_RUNDOWN_MIN_RANK)
      return true;
  return false;
}

/** The made classes the postflop cell covers: one pair, two pair below top two. */
export function omahaReraisedWeakMade(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length < 3) return false;
  const cls = omahaMadeClass([...hole], [...board]).cls;
  return cls === 'pair' || cls === 'low2p' || cls === 'board2p';
}

function seedOf(cards: readonly Card[]): number {
  let h = 2166136261;
  for (const c of cards)
    for (const ch of cardKey(c)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  return h >>> 0 || 1;
}

function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unseenDeck(seen: readonly Card[]): Card[] {
  const s = new Set(seen.map(cardKey));
  const out: Card[] = [];
  for (const rank of RANKS)
    for (const suit of SUITS) {
      const c = { rank, suit } as Card;
      if (!s.has(cardKey(c))) out.push(c);
    }
  return out;
}

function hasAces(h: readonly Card[]): boolean {
  return h.filter((c) => c.rank === 'A').length >= 2;
}

/** The declared strong range after the flop: aces, or top two pair or better now. */
export function omahaReraisedStrongHand(h: readonly Card[], board: readonly Card[]): boolean {
  if (hasAces(h)) return true;
  const made = omahaMadeClass([...h], [...board]);
  return made.category >= 4 || made.cls === 'top2p';
}

/**
 * Hero's share (ties half) against one opponent hand drawn from `inRange`,
 * the board run out at random. Null when fewer than half the samples could be
 * drawn inside the attempt budget.
 */
export function omahaReraisedEquity(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[],
  inRange: (h: readonly Card[], board: readonly Card[]) => boolean,
  samples: number = RERAISED_EQUITY_SAMPLES,
  /**
   * 2026-11-18 (the priced call-or-raise): told each accepted sample's
   * holding and hero's result on it (1 win, 0.5 tie, 0 loss), in order, so a
   * caller can split the SAME samples into bands of the range (common random
   * numbers). Absent: nothing changes; the samples and the answer are the same
   * with it or without it.
   */
  onSample?: (opp: readonly Card[], result: number) => void
): number | null {
  const deck = unseenDeck([...hole, ...board, ...dead]);
  const size = hole.length;
  const need = 5 - board.length;
  if (deck.length < size + need) return null;
  const rnd = generator(seedOf([...hole, ...board]));
  // THE SAME DRAWS, NO DECK COPY PER TRY (2026-11-26, PLO-OWNER lead-7; omahaOopReraiseRangeHoldsVsReraise cost):
  // each try used to shuffle a fresh copy of the deck (the opponent's cards: a partial Fisher-Yates over the whole
  // deck; the run-out: the same over the rest after them). The swaps are now made in one working deck and undone
  // after the try, so every try starts from the same order as a fresh copy, consumes the same draws and yields the
  // same cards: byte-identical answers, without allocating a deck for each of the (mostly rejected) tries.
  const work = deck.slice();
  const len = work.length;
  const swapAt = new Int32Array(size + need);
  const swapTo = new Int32Array(size + need);
  let swaps = 0;
  const swap = (i: number, j: number): void => {
    const t = work[i];
    work[i] = work[j];
    work[j] = t;
    swapAt[swaps] = i;
    swapTo[swaps] = j;
    swaps++;
  };
  const undo = (): void => {
    while (swaps > 0) {
      swaps--;
      const i = swapAt[swaps];
      const j = swapTo[swaps];
      const t = work[i];
      work[i] = work[j];
      work[j] = t;
    }
  };
  const heroHole = [...hole];
  let won = 0;
  let got = 0;
  const budget = samples * 200;
  for (let tries = 0; got < samples && tries < budget; tries++) {
    for (let i = 0; i < size; i++) swap(i, i + Math.floor(rnd() * (len - i)));
    const opp = work.slice(0, size);
    if (!inRange(opp, board)) {
      undo();
      continue;
    }
    const restLen = len - size;
    for (let i = 0; i < need; i++) swap(size + i, size + i + Math.floor(rnd() * (restLen - i)));
    const run = [...board, ...work.slice(size, size + need)];
    undo();
    const a = scoreOmahaHi(heroHole, run);
    const b = scoreOmahaHi(opp, run);
    const result = a > b ? 1 : a === b ? 0.5 : 0;
    won += result;
    got++;
    if (onSample) onSample(opp, result);
  }
  return got >= samples / 2 ? won / got : null;
}

/**
 * omahaReraisedEquity before the flop against the opponent hands whose preflop percentile
 * (omahaPreflopPercentile, high only) lies in [lo, hi]: THE SAME NUMBER, bit for bit (2026-11-26, PLO-OWNER
 * lead-7; law anOopReraiseRangeEquityIsUnchanged.law.test.ts), at a fraction of the cost.
 *
 * WHY. omahaOopReraiseRangeHoldsVsReraise prices three such equities per decision; live shadow (2026-11-26
 * 01:07-01:35Z, build d07cd7d7) re-decided it in 60-90 ms where it applied and its breaker tripped (3 over 50 ms in
 * 20). Profiled: the rejection draws (a deck copy, a preflop score and a reservoir search per drawn hand, most of
 * them rejected) and the showdowns on Card objects were all of it.
 *
 * WHAT. The same generator, seed, deck order and partial shuffles as omahaReraisedEquity, on card ids in one
 * working deck whose swaps are undone after each try; the band test reads the raw preflop score of the ids and the
 * percentile of each distinct score once (the percentile is a function of the raw score); the showdown scores both
 * hands on the run's ten precomputed triples (scoreOmahaHiOfIdsOnRun, the scoreOmahaHi value), the opponent's
 * stopping at the first combination that beats the Horse's. The draws, the accepted hands, the run-outs, the
 * results and their sum are the same, in the same order.
 */
export function omahaReraisedEquityInPercentileBand(
  hole: readonly Card[],
  dead: readonly Card[],
  lo: number,
  hi: number,
  samples: number = RERAISED_EQUITY_SAMPLES
): number | null {
  const deck = unseenDeck([...hole, ...dead]);
  const size = hole.length;
  const need = 5;
  if (deck.length < size + need) return null;
  // generator(seedOf(hole)), inlined (the same arithmetic, one draw per call of next())
  let state = seedOf([...hole]) >>> 0;
  const len = deck.length;
  const work = new Int32Array(len);
  const cardOfId: Card[] = [];
  for (let i = 0; i < len; i++) {
    work[i] = omahaCardId(deck[i]);
    cardOfId[work[i]] = deck[i];
  }
  const swapTo = new Int32Array(size + need);
  const heroIds = new Int32Array(size);
  for (let i = 0; i < size; i++) heroIds[i] = omahaCardId(hole[i]);
  const oppIds = new Int32Array(size);
  const runIds = new Int32Array(need);
  let insideMin = Infinity;
  let insideMax = -Infinity;
  let outsideBelow = -Infinity;
  let outsideAbove = Infinity;
  const restLen = len - size;
  let won = 0;
  let got = 0;
  const budget = samples * 200;
  for (let tries = 0; got < samples && tries < budget; tries++) {
    // the opponent's cards: the partial shuffle of a fresh deck copy, made in place (undone below)
    for (let i = 0; i < size; i++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let x = state;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      const j = i + Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * (len - i));
      swapTo[i] = j;
      const t = work[i];
      work[i] = work[j];
      work[j] = t;
    }
    const raw = omahaPreflopScoreOfIds(work, 0, size, false);
    // The percentile never falls as the raw score rises, so the scores whose percentile is in [lo, hi] are one
    // interval: a score inside the inside scores already seen is inside, one at or past an outside score already
    // seen (on the same side) is outside, and only a score between them is ranked (and narrows them).
    let inside: boolean;
    if (raw >= insideMin && raw <= insideMax) inside = true;
    else if (raw <= outsideBelow || raw >= outsideAbove) inside = false;
    else {
      const opp: Card[] = [];
      for (let i = 0; i < size; i++) opp.push(cardOfId[work[i]]);
      const p = omahaPreflopPercentile(opp, false);
      inside = p >= lo && p <= hi;
      if (inside) {
        if (raw < insideMin) insideMin = raw;
        if (raw > insideMax) insideMax = raw;
      } else if (p < lo) {
        if (raw > outsideBelow) outsideBelow = raw;
      } else if (raw < outsideAbove) outsideAbove = raw;
    }
    let made = size;
    if (inside) {
      for (let i = 0; i < size; i++) oppIds[i] = work[i];
      // the run-out: the partial shuffle of the rest of that copy after the opponent's cards
      for (let i = 0; i < need; i++) {
        const k = size + i;
        state = (state + 0x6d2b79f5) >>> 0;
        let x = state;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        const j = k + Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * (restLen - i));
        swapTo[k] = j;
        const t = work[k];
        work[k] = work[j];
        work[j] = t;
      }
      made = size + need;
      for (let i = 0; i < need; i++) runIds[i] = work[size + i];
    }
    // undo the swaps, last first: the working deck is the fresh order again
    for (let k = made - 1; k >= 0; k--) {
      const j = swapTo[k];
      const t = work[k];
      work[k] = work[j];
      work[j] = t;
    }
    if (!inside) continue;
    omahaRunTriples(runIds, 0);
    const a = scoreOmahaHiOfIdsOnRun(heroIds, 0, size, Infinity);
    const b = scoreOmahaHiOfIdsOnRun(oppIds, 0, size, a);
    won += a > b ? 1 : a === b ? 0.5 : 0;
    got++;
  }
  return got >= samples / 2 ? won / got : null;
}

/**
 * The same sampler against SEVERAL opponents at once (2026-11-18, the priced
 * call of a re-raise with other players already in for the price): hero's
 * share of one pot against one holding per range, drawn without replacement
 * from the unseen deck (each by rejection against its own range, in order),
 * over a random run-out; a tie splits among the tied hands. Side pots are not
 * modelled (every opponent contests the whole pot). Deterministic for given
 * cards; no draw from the brain's random stream. Null when too few samples
 * could be drawn.
 */
export function omahaReraisedEquityAgainst(
  hole: readonly Card[],
  dead: readonly Card[],
  ranges: readonly ((h: readonly Card[]) => boolean)[],
  samples: number = RERAISED_EQUITY_SAMPLES,
  /**
   * 2026-11-19 (the priced call-or-raise with other players in the hand): told
   * each accepted sample's showdown scores, hero's first and then one per range
   * in order, so a caller can price on the SAME samples who wins which part of
   * the pot when only some of them continue. Absent: nothing changes; the
   * samples and the answer are the same with it or without it.
   */
  onSample?: (heroScore: number, oppScores: readonly number[]) => void
): number | null {
  const size = hole.length;
  const deck = unseenDeck([...hole, ...dead]);
  if (ranges.length === 0 || deck.length < size * ranges.length + 5) return null;
  const rnd = generator(seedOf([...hole]) ^ (0x9e3779b9 * ranges.length));
  const draw = (n: number, from: Card[]): Card[] => {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (from.length - i));
      const t = from[i];
      from[i] = from[j];
      from[j] = t;
    }
    return from.splice(0, n);
  };
  let won = 0;
  let got = 0;
  const budget = samples * 200 * ranges.length;
  let tries = 0;
  while (got < samples && tries < budget) {
    const d = deck.slice();
    const opps: Card[][] = [];
    for (const inRange of ranges) {
      let found: Card[] | null = null;
      // each opponent by rejection against his own range, from what is left
      for (let k = 0; k < 200 && tries < budget && found === null; k++) {
        tries++;
        const probe = d.slice();
        const h = draw(size, probe);
        if (inRange(h)) {
          found = h;
          d.length = 0;
          d.push(...probe);
        }
      }
      if (found === null) break;
      opps.push(found);
    }
    if (opps.length !== ranges.length) continue;
    const run = draw(5, d);
    const mine = scoreOmahaHi([...hole], run);
    let best = mine;
    let tied = 1;
    const scores: number[] | null = onSample ? [] : null;
    for (const o of opps) {
      const s = scoreOmahaHi(o, run);
      if (scores) scores.push(s);
      if (s > best) {
        best = s;
        tied = 1;
      } else if (s === best) tied++;
    }
    if (mine === best) won += 1 / tied;
    got++;
    if (onSample && scores) onSample(mine, scores);
  }
  return got >= samples / 2 ? won / got : null;
}

/**
 * omahaReraisedEquityAgainst where every range is the top of the holdings by preflop percentile
 * (omahaPreflopPercentile >= floors[k], high only; a floor at or under 1e-9 admits every holding): THE SAME NUMBER
 * AND THE SAME onSample SCORES, bit for bit (2026-11-26, PLO-OWNER lead-7; law
 * anOmahaReraisedPotEquityIsUnchanged.law.test.ts), at a fraction of the cost.
 *
 * WHY. omahaReraisedPotCallIsPriced / omahaReraisedPotReraiseIsPriced price a re-raised-pot call on one joint
 * sample set against the re-raiser and every other player in (reraisedPotVerdict). With the out-of-position 3-bet
 * price already on card ids (#12034) they still took p50 12.8 / p95 27.6 / max 134 ms where they applied, 0.9% over
 * the shadow stage's 50 ms slow mark; 77% of it was this sampler: a deck copy per sample and per probe, a preflop
 * score and a reservoir search per probe, and showdowns on Card objects.
 *
 * WHAT. The same generator, seed, deck order and partial shuffles, on card ids: the sample's deck is the unseen
 * deck's ids copied into one working array; each probe shuffles the front of what is left and its swaps are undone
 * when it is rejected, and an accepted holding is taken off the front (the splice); the run-out is the next five.
 * Each floor's test reads the raw preflop score and ranks each distinct score once (the scores at or over a floor
 * are one upper interval). Every hand is scored on the run's ten precomputed triples (scoreOmahaHiOfIdsOnRun, the
 * scoreOmahaHi value). The draws, holdings, run-outs, scores, ties and their sum are the same, in the same order.
 */
export function omahaReraisedEquityAgainstPercentileFloors(
  hole: readonly Card[],
  dead: readonly Card[],
  floors: readonly number[],
  samples: number = RERAISED_EQUITY_SAMPLES,
  onSample?: (heroScore: number, oppScores: readonly number[]) => void
): number | null {
  const size = hole.length;
  const deck = unseenDeck([...hole, ...dead]);
  const nr = floors.length;
  if (nr === 0 || deck.length < size * nr + 5) return null;
  // generator(seedOf(hole) ^ (0x9e3779b9 * ranges)), inlined: the same arithmetic, one draw per next()
  let state = (seedOf([...hole]) ^ (0x9e3779b9 * nr)) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const len0 = deck.length;
  const deckIds = new Int32Array(len0);
  const cardOfId: Card[] = [];
  for (let i = 0; i < len0; i++) {
    deckIds[i] = omahaCardId(deck[i]);
    cardOfId[deckIds[i]] = deck[i];
  }
  const work = new Int32Array(len0);
  const swapTo = new Int32Array(size);
  const heroIds = new Int32Array(size);
  for (let i = 0; i < size; i++) heroIds[i] = omahaCardId(hole[i]);
  const oppIds = new Int32Array(size * nr);
  const runIds = new Int32Array(5);
  // per floor: every holding admitted (floor <= 1e-9), else the raw-score interval learnt so far
  const all = floors.map((f) => f <= 1e-9);
  const insideMin = floors.map(() => Infinity);
  const outsideMax = floors.map(() => -Infinity);
  const scores: number[] | null = onSample ? new Array<number>(nr).fill(0) : null;
  let won = 0;
  let got = 0;
  const budget = samples * 200 * nr;
  let tries = 0;
  while (got < samples && tries < budget) {
    work.set(deckIds);
    let off = 0;
    let len = len0;
    let drawn = 0;
    for (let r = 0; r < nr; r++) {
      let found = false;
      // each opponent by rejection against his own range, from what is left
      for (let k = 0; k < 200 && tries < budget && !found; k++) {
        tries++;
        for (let i = 0; i < size; i++) {
          const a = off + i;
          const j = a + Math.floor(next() * (len - i));
          swapTo[i] = j;
          const t = work[a];
          work[a] = work[j];
          work[j] = t;
        }
        let inside: boolean;
        if (all[r]) inside = true;
        else {
          const raw = omahaPreflopScoreOfIds(work, off, size, false);
          if (raw >= insideMin[r]) inside = true;
          else if (raw <= outsideMax[r]) inside = false;
          else {
            const h: Card[] = [];
            for (let i = 0; i < size; i++) h.push(cardOfId[work[off + i]]);
            inside = omahaPreflopPercentile(h, false) >= floors[r];
            if (inside) insideMin[r] = raw;
            else outsideMax[r] = raw;
          }
        }
        if (inside) {
          found = true;
          for (let i = 0; i < size; i++) oppIds[r * size + i] = work[off + i];
          off += size;
          len -= size;
        } else {
          for (let i = size - 1; i >= 0; i--) {
            const a = off + i;
            const j = swapTo[i];
            const t = work[a];
            work[a] = work[j];
            work[j] = t;
          }
        }
      }
      if (!found) break;
      drawn++;
    }
    if (drawn !== nr) continue;
    for (let i = 0; i < 5; i++) {
      const a = off + i;
      const j = a + Math.floor(next() * (len - i));
      const t = work[a];
      work[a] = work[j];
      work[j] = t;
      runIds[i] = work[a];
    }
    omahaRunTriples(runIds, 0);
    const mine = scoreOmahaHiOfIdsOnRun(heroIds, 0, size, Infinity);
    let best = mine;
    let tied = 1;
    for (let r = 0; r < nr; r++) {
      const sc = scoreOmahaHiOfIdsOnRun(oppIds, r * size, size, Infinity);
      if (scores) scores[r] = sc;
      if (sc > best) {
        best = sc;
        tied = 1;
      } else if (sc === best) tied++;
    }
    if (mine === best) won += 1 / tied;
    got++;
    if (onSample && scores) onSample(mine, scores.slice());
  }
  return got >= samples / 2 ? won / got : null;
}

export interface OmahaReraisedInput {
  variant: string;
  street: string;
  hole: readonly Card[];
  board: readonly Card[];
  dead?: readonly Card[];
  /** preflopRaiseCount of the hand's history */
  preflopRaises: number;
  /** the decision being judged */
  action: string;
  toCall: number;
  stack: number;
  /** the pot including every wager on the table (gs.pot) */
  pot: number;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
  allInOrFold: boolean;
}

export type OmahaReraisedVerdict =
  | { fold: true; cell: 'preflop' | 'postflop'; equity: number | null; price: number }
  | { fold: false; cell: 'preflop' | 'postflop'; equity: number; price: number };

/**
 * PLO6 (six-card port, SPEC-B H28 and 3.26): the PREFLOP cell also serves
 * PLO6 with six hole cards, only inside a decision whose omahaStrategyInPlo6
 * gate is on (omahaStrategyGameInScope). The postflop cell stays PLO4/PLO5:
 * its stack-off options are not in the PLO6 port catalogue.
 */
function plo6PreflopInScope(i: OmahaReraisedInput): boolean {
  return (
    String(i.variant).toLowerCase() === 'plo6' &&
    i.street === 'preflop' &&
    omahaStrategyGameInScope(RERAISED_POT_VARIANTS, { gameVariant: i.variant })
  );
}

function inScope(i: OmahaReraisedInput): boolean {
  const plo6 = plo6PreflopInScope(i);
  if (!plo6 && !RERAISED_POT_VARIANTS.has(i.variant)) return false;
  if (i.hiLo || i.multiBoard || i.bombPot || i.tournament || i.allInOrFold) return false;
  if (i.hole.length !== (plo6 ? PLO6_HOLE_CARDS : i.variant === 'plo4' ? 4 : 5)) return false;
  if (i.preflopRaises < RERAISED_MIN_PREFLOP_RAISES) return false;
  if (i.action !== 'call' && i.action !== 'raise' && i.action !== 'all_in') return false;
  return i.toCall > 0.005 && i.stack > 0 && Number.isFinite(i.pot) && i.pot > 0;
}

/** The call commits the stack: all in, or less than the resulting pot left behind. */
function commits(i: OmahaReraisedInput): { committed: boolean; price: number } {
  const call = Math.min(i.toCall, i.stack);
  const price = call / (i.pot + call);
  const behind = i.stack - call;
  return { committed: behind <= 0.005 || behind < i.pot + call, price };
}

/**
 * Null when the cell does not apply (the decision stands); otherwise the
 * verdict with the equity and price that decided it.
 */
export function omahaReraisedPreflopCell(i: OmahaReraisedInput): OmahaReraisedVerdict | null {
  if (i.street !== 'preflop' || !inScope(i) || i.board.length !== 0) return null;
  if (omahaReraisedPremium(i.hole)) return null;
  const { committed, price } = commits(i);
  if (!committed) return { fold: true, cell: 'preflop', equity: null, price };
  const eq = omahaReraisedEquity(i.hole, [], i.dead ?? [], (h) => hasAces(h));
  if (eq === null) return null;
  return eq >= price
    ? { fold: false, cell: 'preflop', equity: eq, price }
    : { fold: true, cell: 'preflop', equity: eq, price };
}

/**
 * The REALISTIC stack-off range in a re-raised pot (option
 * omahaReraisedPotStackOffRealistic, 2026-11-15): a development probe found
 * the aces-or-top-two range far stronger than what players actually put
 * their stacks in with here, so the calls the declared range folded were
 * winning ones. This range is every holding that would plausibly bet or
 * call off: a pair of aces or kings in the hand; any made hand at top-pair
 * level or better (a pair of the top board rank, a pocket overpair, two
 * pair of its own, a set, trips, a straight or better); and, before the
 * river, a nut flush draw or eight or more straight outs.
 */
export function omahaReraisedRealisticHand(h: readonly Card[], board: readonly Card[]): boolean {
  const ranks = h.map((c) => RANK_VALUE[c.rank] ?? 0);
  const pairOf = (r: number) => ranks.filter((x) => x === r).length >= 2;
  if (pairOf(14) || pairOf(13)) return true;
  const made = omahaMadeClass([...h], [...board]);
  if (made.category >= 4 || made.cls === 'top2p' || made.cls === 'low2p') return true;
  const top = Math.max(...board.map((c) => RANK_VALUE[c.rank] ?? 0));
  if (ranks.includes(top) && made.category >= 2) return true;
  if (ranks.some((r) => r > top && pairOf(r))) return true;
  if (board.length <= 4) {
    const dq = omahaDrawQuality([...h], [...board]);
    if (dq.nutFlushDraw || dq.straightOuts >= 8) return true;
  }
  return false;
}

export function omahaReraisedPostflopCell(
  i: OmahaReraisedInput & { bettorOverBluffs?: boolean },
  range: 'declared' | 'realistic' = 'declared'
): OmahaReraisedVerdict | null {
  const n = i.street === 'flop' ? 3 : i.street === 'turn' ? 4 : i.street === 'river' ? 5 : 0;
  if (n === 0 || i.board.length !== n || !inScope(i)) return null;
  if (range === 'realistic' && i.bettorOverBluffs === true) return null;
  if (!omahaReraisedWeakMade(i.hole, i.board)) return null;
  const { committed, price } = commits(i);
  if (!committed && i.action === 'call') return null;
  const eq = omahaReraisedEquity(
    i.hole,
    i.board,
    i.dead ?? [],
    range === 'realistic' ? omahaReraisedRealisticHand : omahaReraisedStrongHand
  );
  if (eq === null) return null;
  return eq >= price
    ? { fold: false, cell: 'postflop', equity: eq, price }
    : { fold: true, cell: 'postflop', equity: eq, price };
}
