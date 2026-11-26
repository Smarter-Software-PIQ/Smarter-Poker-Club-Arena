// scripts/ops/horse-audit-multiple-tests.mjs
// The z bar of a family of comparisons (2026-11-26). An audit that tests many nodes or cells at a fixed z raises a
// false alarm in most runs: 47 nodes at z >= 2 give one by chance about two runs in three, and 519 cell comparisons
// at |z| >= 3 about one run in two. correctedZ keeps the chance of ANY false alarm in one run at what the stated z
// gives for a single comparison (Bonferroni: the one-sided tail of z divided by the number of comparisons).
// Pure, no I/O.

/** One-sided upper tail of the standard normal, P(Z >= z) (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function upperTail(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erfc =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
    Math.exp(-x * x);
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}

/** The z whose one-sided upper tail is p (bisection on upperTail; p in (0, 0.5]). */
export function zOfUpperTail(p) {
  if (!(p > 0)) return Infinity;
  if (p >= 0.5) return 0;
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (upperTail(mid) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The z bar for `tests` comparisons that keeps the run-wide false alarm rate at the single-comparison rate of z. */
export function correctedZ(z, tests) {
  const m = Math.max(1, Math.floor(Number(tests) || 0));
  return m === 1 ? z : zOfUpperTail(upperTail(z) / m);
}
