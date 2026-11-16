/**
 * Generates LIGHTNING_CHEAP_ENTRY_EQUITY in src/engine/HorseLightningCheapEntry.ts:
 * for NLH, PLO4 and PLO5, the hands of the variant sorted by the brain's own
 * preflop strength (the scale the preflop engine decides on, no jitter:
 * holdemPreflopScore for hold'em, omahaElitePreflopStrength for Omaha), cut
 * into BINS bins of equal hand share, and for each bin the strength of its
 * weakest hand and the mean all-in equity of its hands against 1 to 5 random
 * hands (ties split). Monte Carlo with a fixed seed, so the table is
 * reproducible:
 *
 *   cd server && npx tsx scripts/generate-lightning-cheap-entry-equity.ts <family> [hands] [trials]
 *   cd server && npx tsx scripts/generate-lightning-cheap-entry-equity.ts --check
 *
 * family: holdem | plo4 | plo5. Hold'em enumerates the 169 classes, weighted
 * by combos (hands is ignored); Omaha samples `hands` random hands (default
 * 6,000, matching LIGHTNING_CHEAP_ENTRY_EQUITY). `--check` regenerates all
 * three families and asserts exact agreement with LIGHTNING_CHEAP_ENTRY_EQUITY.
 */
import type { Card, CardRank, CardSuit } from '../src/types.js';
import {
  holdemPreflopScore,
  omahaElitePreflopStrength,
  scoreHoldem,
  scoreOmahaHi,
} from '../src/engine/HorseEval.js';
import { HAND_CLASSES } from '../src/engine/HorseGtoOpeningRanges.js';
import {
  LIGHTNING_CHEAP_ENTRY_EQUITY,
  type LightningCheapEntryCtx,
} from '../src/engine/HorseLightningCheapEntry.js';

type Family = LightningCheapEntryCtx['family'];

const BINS = 40;
const MAX_OPP = 5;
const SUITS: CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const DECK: Card[] = SUITS.flatMap((s) => RANKS.map((r) => ({ rank: r, suit: s }) as Card));
const key = (c: Card) => RANKS.indexOf(c.rank) * 4 + SUITS.indexOf(c.suit);

export function generateLightningCheapEntryRows(
  family: Family,
  handsCount = 6000,
  trials = family === 'holdem' ? 6000 : 250
): number[][] {
  let state = 0x2c1b3c6d;
  const rnd = (): number => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  const holeCount = family === 'holdem' ? 2 : family === 'plo4' ? 4 : 5;
  const score = (hole: Card[], board: Card[]): number =>
    family === 'holdem' ? scoreHoldem([...hole, ...board], 7, false) : scoreOmahaHi(hole, board);

  const equities = (hole: Card[]): number[] => {
    const used = new Set(hole.map(key));
    const rest = DECK.filter((c) => !used.has(key(c)));
    const acc = new Array<number>(MAX_OPP).fill(0);
    const need = MAX_OPP * holeCount + 5;
    for (let t = 0; t < trials; t++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rnd() * (rest.length - i));
        const tmp = rest[i]!;
        rest[i] = rest[j]!;
        rest[j] = tmp;
      }
      const board = rest.slice(0, 5);
      const hero = score(hole, board);
      let beaten = false;
      let ties = 0;
      for (let k = 1; k <= MAX_OPP; k++) {
        const s = score(rest.slice(5 + (k - 1) * holeCount, 5 + k * holeCount), board);
        if (s > hero) beaten = true;
        else if (s === hero) ties++;
        if (!beaten) acc[k - 1] += 1 / (1 + ties);
      }
    }
    return acc.map((a) => a / trials);
  };

  interface Hand {
    s: number;
    w: number;
    e: number[];
  }
  const hands: Hand[] = [];
  if (family === 'holdem') {
    for (const h of HAND_CLASSES) {
      const r0 = h.cls[0] as CardRank;
      const r1 = h.cls[1] as CardRank;
      const suited = h.cls.length === 3 && h.cls[2] === 's';
      const a = { rank: r0, suit: 'spades' } as Card;
      const b = { rank: r1, suit: suited ? 'spades' : 'hearts' } as Card;
      hands.push({ s: holdemPreflopScore(a, b, false), w: h.combos, e: equities([a, b]) });
    }
  } else {
    for (let n = 0; n < handsCount; n++) {
      const d = [...DECK];
      for (let i = 0; i < holeCount; i++) {
        const j = i + Math.floor(rnd() * (d.length - i));
        const tmp = d[i]!;
        d[i] = d[j]!;
        d[j] = tmp;
      }
      const hole = d.slice(0, holeCount);
      hands.push({ s: omahaElitePreflopStrength(hole, false), w: 1, e: equities(hole) });
    }
  }
  hands.sort((x, y) => y.s - x.s);
  const total = hands.reduce((n, h) => n + h.w, 0);
  const out: number[][] = [];
  let cum = 0;
  let bin = 0;
  let wSum = 0;
  let eSum = new Array<number>(MAX_OPP).fill(0);
  let minS = Infinity;
  for (const h of hands) {
    let w = h.w;
    while (w > 1e-12) {
      const edge = ((bin + 1) / BINS) * total;
      const take = Math.min(w, edge - cum);
      wSum += take;
      for (let k = 0; k < MAX_OPP; k++) eSum[k] += take * h.e[k]!;
      minS = Math.min(minS, h.s);
      cum += take;
      w -= take;
      if (cum >= edge - 1e-9) {
        const e = eSum.map((x) => Math.round((x / wSum) * 1000));
        out.push([Number(minS.toFixed(4)), Number(((bin + 1) / BINS).toFixed(3)), ...e]);
        bin++;
        wSum = 0;
        eSum = new Array<number>(MAX_OPP).fill(0);
        minS = Infinity;
        if (bin >= BINS) break;
      }
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('generate-lightning-cheap-entry-equity.ts')) {
  if (process.argv[2] === '--check') {
    for (const fam of ['holdem', 'plo4', 'plo5'] as const) {
      const generated = generateLightningCheapEntryRows(fam);
      const shipped = LIGHTNING_CHEAP_ENTRY_EQUITY[fam];
      if (JSON.stringify(generated) !== JSON.stringify(shipped)) {
        console.error(`LIGHTNING_CHEAP_ENTRY_EQUITY.${fam} drifted from generator!`);
        process.exit(1);
      }
    }
    console.log('OK: LIGHTNING_CHEAP_ENTRY_EQUITY matches generator for holdem, plo4 and plo5.');
  } else {
    const FAMILY = (process.argv[2] ?? 'holdem') as Family;
    const HANDS = Number(process.argv[3] ?? 6000);
    const TRIALS = Number(process.argv[4] ?? (FAMILY === 'holdem' ? 6000 : 250));
    const rows = generateLightningCheapEntryRows(FAMILY, HANDS, TRIALS).map(
      ([minS, share, ...e]) => `    [${minS!.toFixed(4)}, ${share!.toFixed(3)}, ${e.join(', ')}],`
    );
    console.log(
      `  // ${FAMILY}: ${FAMILY === 'holdem' ? '169 classes by combos' : `${HANDS} random hands`}, ${TRIALS} trials each, seed 0x2c1b3c6d\n  ${FAMILY}: [\n${rows.join('\n')}\n  ],`
    );
  }
}
