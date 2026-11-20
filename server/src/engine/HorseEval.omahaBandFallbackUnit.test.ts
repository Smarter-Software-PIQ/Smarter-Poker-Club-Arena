/**
 * AUDIT-FILES-B (2026-11-19): simulateEquity's Omaha band FALLBACK measures in
 * the band's own unit.
 *
 * A band is PERCENTILE-intent (placeOmahaBandCombo maps it through the
 * reservoir CDF). When the reservoir cannot place a hand in the window left
 * (24 misses: crowded multiway decks, many dead cards), simulateEquity falls
 * back to rejection on the hand's score. That fallback compared the RAW
 * omahaPreflopScore (median 0.24, p99 0.59) with the percentile band, so a
 * bottom band [0, 0.3] admitted almost any hand and a top band asked for a
 * score beyond p99 and kept the strongest miss. Here the deck is crowded with
 * dead cards so the fallback carries most samples, and the drawn opponent's
 * percentile must land in the band it was asked for.
 */
import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import {
  setOmahaBandFallbackInBandUnit,
  seedFastRandom,
  simulateEquity,
  variantInfo,
  omahaPreflopPercentile,
  omahaPreflopScore,
  type HorseEquityOutcomeCollector,
} from './HorseEval.js';
import type { Card } from '../types.js';

const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
const hero: Card[] = [
  c('A', 'spades'),
  c('K', 'spades'),
  c('Q', 'hearts'),
  c('J', 'hearts'),
  c('T', 'clubs'),
];
// 22 dead cards leave 25 unseen: the board takes 5, the opponent window holds 20,
// where a random reservoir PLO5 hand fits less than 1 time in 100 per attempt.
// Spread over every rank so the window keeps weak and strong hands alike.
const dead: Card[] = [];
const RANKS13 = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS4 = ['diamonds', 'clubs', 'hearts', 'spades'];
// every other card in rank-major order, alternating suits: two per rank
for (let i = 0; i < 52 && dead.length < 22; i += 2) {
  const card = c(RANKS13[Math.floor(i / 4)], SUITS4[(i % 4) + (Math.floor(i / 4) % 2)]);
  if (
    !hero.some((h) => h.rank === card.rank && h.suit === card.suit) &&
    !dead.some((d) => d.rank === card.rank && d.suit === card.suit)
  )
    dead.push(card);
}

/** Raw-score cut that sits at percentile q of PLO5 hands, from a private RNG over the full deck. */
function rawCutAt(q: number): number {
  const deck: Card[] = [];
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs'])
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'])
      deck.push(c(rank, suit));
  let seed = 424242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows: Array<[number, number]> = [];
  for (let i = 0; i < 3000; i++) {
    const d = deck.slice();
    for (let k = 0; k < 5; k++) {
      const j = k + Math.floor(rnd() * (52 - k));
      [d[k], d[j]] = [d[j], d[k]];
    }
    const h = d.slice(0, 5);
    rows.push([omahaPreflopPercentile(h, false), omahaPreflopScore(h, false)]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows[Math.floor(q * (rows.length - 1))][1];
}

/** Share of the drawn opponents (raw preflop score captured per sample) inside the percentile band. */
function shareInBand(band: [number, number]): number {
  seedFastRandom(20261119);
  const vi = variantInfo('plo5');
  const out: HorseEquityOutcomeCollector = { maxSamples: 400, samples: [] };
  simulateEquity(hero, [], 1, vi, 400, [band], false, undefined, undefined, out, dead);
  expect(out.samples.length).toBeGreaterThan(100);
  const lo = band[0] <= 0 ? -Infinity : rawCutAt(band[0]);
  const hi = band[1] >= 1 ? Infinity : rawCutAt(band[1]);
  const inside = out.samples.filter((x) => {
    const s = x.opponentDecisionStrength[0];
    return s >= lo && s <= hi;
  }).length;
  return inside / out.samples.length;
}

describe('simulateEquity Omaha band fallback (AUDIT-FILES-B; omahaBandFallbackInBandUnit on)', () => {
  afterEach(() => setOmahaBandFallbackInBandUnit(false));
  it('a bottom-30% read draws bottom-30% opponents, not almost any hand', () => {
    setOmahaBandFallbackInBandUnit(true);
    expect(shareInBand([0, 0.3])).toBeGreaterThan(0.7);
  });
  it('a top-30% read draws top-30% opponents', () => {
    setOmahaBandFallbackInBandUnit(true);
    expect(shareInBand([0.7, 1])).toBeGreaterThan(0.7);
  });
});

describe('omahaBandFallbackInBandUnit off (default): the live raw-score fallback', () => {
  // CORE-LAND 2026-11-20 (lane DEPTH-GRADE): hands 60178985 (turn) and 60167078 (flop) keep the value raise the
  // reference brain chose live only with the raw-score fallback; exact replay on the batch tree with the unit
  // change unconditional turned both into calls. Off, PLO5 and PLO4 measure the raw score exactly as live.
  it('PLO5 and PLO4 measure the raw score unless the option is on; PLO6 always does', async () => {
    const { omahaBandFallbackScore } = await import('./HorseEval.js');
    for (const v of ['plo5', 'plo4', 'plo6'] as const) {
      const hand =
        v === 'plo4' ? hero.slice(0, 4) : v === 'plo6' ? [...hero, c('9', 'diamonds')] : hero;
      expect(omahaBandFallbackScore(hand, variantInfo(v))).toBe(omahaPreflopScore(hand, false));
    }
    setOmahaBandFallbackInBandUnit(true);
    expect(omahaBandFallbackScore(hero, variantInfo('plo5'))).toBe(
      omahaPreflopPercentile(hero, false)
    );
    const six = [...hero, c('9', 'diamonds')];
    expect(omahaBandFallbackScore(six, variantInfo('plo6'))).toBe(omahaPreflopScore(six, false));
    setOmahaBandFallbackInBandUnit(false);
  });
});
