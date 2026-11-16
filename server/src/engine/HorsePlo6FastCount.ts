/**
 * HorsePlo6FastCount: the exact holdings count of the facing-bet EV rule for
 * SIX hole cards (PLO6 lane 2026-11-16, reached only with omahaStrategyInPlo6
 * on; default off and off-only).
 *
 * The question is the one HorseOmahaFacingBetEv.countHoldingsAmong answers:
 * how many n-card holdings, drawn from the allowed cards, contain NO barred
 * pair. The answer here is the same integer, reached another way, because
 * the walk there takes every pair-free set of up to n - 1 touched cards one
 * at a time, and with six cards on the turn (about 170 counts over 42 unseen
 * cards) that is about a second (TIMING-PLO6).
 *
 * Method: the barred pairs are the edges of a graph on the cards. The number
 * of pair-free sets of each size k <= n is the graph's independence
 * polynomial cut at degree n:
 *   - a card no barred pair touches multiplies the polynomial by (1 + x);
 *   - two parts of the graph no barred pair joins multiply (the suits and
 *     ranks a made hand needs fall into such parts);
 *   - inside one part, the card with the most barred partners is either left
 *     out (the part without it) or taken (x times the part without it and
 *     its partners).
 * Every coefficient is a whole number below 2^53, so the count is exact; no
 * sampling, no rounding.
 *
 * Pure: reads masks, returns a number.
 */

function popcount(v: number): number {
  let x = v >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const CHOOSE: number[][] = [];
for (let n = 0; n <= 52; n++) {
  const row = [1];
  for (let k = 1; k <= Math.min(n, 8); k++)
    row.push((CHOOSE[n - 1]?.[k - 1] ?? 0) + (CHOOSE[n - 1]?.[k] ?? 0));
  CHOOSE.push(row);
}
const choose = (n: number, k: number): number => (k < 0 || k > n ? 0 : (CHOOSE[n][k] ?? 0));

/** a * b cut at degree cap (both cut at cap already). */
function mul(a: Float64Array, b: Float64Array, cap: number): Float64Array {
  const out = new Float64Array(cap + 1);
  for (let i = 0; i <= cap; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    for (let j = 0; i + j <= cap; j++) out[i + j] += ai * b[j];
  }
  return out;
}

/** p * (1 + x)^r cut at degree cap, in place when r is 0. */
function mulFree(p: Float64Array, r: number, cap: number): Float64Array {
  if (r === 0) return p;
  const out = new Float64Array(cap + 1);
  for (let i = 0; i <= cap; i++) {
    const pi = p[i];
    if (pi === 0) continue;
    for (let j = 0; i + j <= cap; j++) out[i + j] += pi * choose(r, j);
  }
  return out;
}

/**
 * The pair-free sets of each size 0..cap among the cards of (lo, hi), where
 * adjLo/adjHi hold each card's barred partners (all of them; the mask cuts).
 */
function poly(
  adjLo: Int32Array,
  adjHi: Int32Array,
  lo: number,
  hi: number,
  cap: number
): Float64Array {
  if (cap === 0) {
    const one = new Float64Array(1);
    one[0] = 1;
    return one;
  }
  // Cards with a barred partner inside the mask (tied) and without (free).
  let tLo = 0;
  let tHi = 0;
  let free = 0;
  let f = lo;
  while (f !== 0) {
    const b = f & -f;
    const i = 31 - Math.clz32(b);
    f ^= b;
    if ((adjLo[i] & lo) !== 0 || (adjHi[i] & hi) !== 0) tLo |= b;
    else free++;
  }
  f = hi;
  while (f !== 0) {
    const b = f & -f;
    const i = 32 + 31 - Math.clz32(b);
    f ^= b;
    if ((adjLo[i] & lo) !== 0 || (adjHi[i] & hi) !== 0) tHi |= b;
    else free++;
  }
  if ((tLo | tHi) === 0) {
    const out = new Float64Array(cap + 1);
    for (let k = 0; k <= cap; k++) out[k] = choose(free, k);
    return out;
  }
  // One connected part of the tied cards.
  let cLo = 0;
  let cHi = 0;
  if (tLo !== 0) cLo = tLo & -tLo;
  else cHi = tHi & -tHi;
  let frontLo = cLo;
  let frontHi = cHi;
  while ((frontLo | frontHi) !== 0) {
    let nLo = 0;
    let nHi = 0;
    f = frontLo;
    while (f !== 0) {
      const b = f & -f;
      const i = 31 - Math.clz32(b);
      f ^= b;
      nLo |= adjLo[i];
      nHi |= adjHi[i];
    }
    f = frontHi;
    while (f !== 0) {
      const b = f & -f;
      const i = 32 + 31 - Math.clz32(b);
      f ^= b;
      nLo |= adjLo[i];
      nHi |= adjHi[i];
    }
    frontLo = nLo & tLo & ~cLo;
    frontHi = nHi & tHi & ~cHi;
    cLo |= frontLo;
    cHi |= frontHi;
  }
  let part: Float64Array;
  {
    // The card of this part with the most barred partners inside it.
    let best = -1;
    let bestDeg = -1;
    let full = true; // every card barred from every other: a clique gives 1 + size * x
    const size = popcount(cLo) + popcount(cHi);
    f = cLo;
    while (f !== 0) {
      const b = f & -f;
      const i = 31 - Math.clz32(b);
      f ^= b;
      const d = popcount(adjLo[i] & cLo) + popcount(adjHi[i] & cHi);
      if (d > bestDeg) {
        bestDeg = d;
        best = i;
      }
      if (d !== size - 1) full = false;
    }
    f = cHi;
    while (f !== 0) {
      const b = f & -f;
      const i = 32 + 31 - Math.clz32(b);
      f ^= b;
      const d = popcount(adjLo[i] & cLo) + popcount(adjHi[i] & cHi);
      if (d > bestDeg) {
        bestDeg = d;
        best = i;
      }
      if (d !== size - 1) full = false;
    }
    if (full) {
      part = new Float64Array(cap + 1);
      part[0] = 1;
      part[1] = size;
    } else {
      const bLo = best < 32 ? 1 << best : 0;
      const bHi = best < 32 ? 0 : 1 << (best - 32);
      const without = poly(adjLo, adjHi, cLo & ~bLo, cHi & ~bHi, cap);
      const taken = poly(
        adjLo,
        adjHi,
        cLo & ~bLo & ~adjLo[best],
        cHi & ~bHi & ~adjHi[best],
        cap - 1
      );
      part = without;
      for (let k = 1; k <= cap; k++) part[k] += taken[k - 1];
    }
  }
  const restLo = tLo & ~cLo;
  const restHi = tHi & ~cHi;
  if ((restLo | restHi) !== 0) part = mul(part, poly(adjLo, adjHi, restLo, restHi, cap), cap);
  return mulFree(part, free, cap);
}

/**
 * The number of n-card holdings among the cards of (allLo, allHi) with no
 * barred pair: the same integer as HorseOmahaFacingBetEv.countHoldingsAmong.
 */
export function plo6CountHoldingsAmong(
  n: number,
  barLo: Int32Array,
  barHi: Int32Array,
  allLo: number,
  allHi: number
): number {
  if (n === 0) return 1;
  return poly(barLo, barHi, allLo, allHi, n)[n];
}
