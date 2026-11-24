/**
 * omahaMultiwayFieldDrawsAreIndependent (default OFF): one independent seeded stream per player of the field.
 *
 * THE DEFECT IT FIXES. The two joint multiway samplers of PLO4/PLO5 facing-bet pricing
 * (HorseOmahaFlopFacingBetEv.omahaFlopEvCounts, the flop verdict omahaFlopFacingBetEv, and
 * HorseOmahaFacingBetEvShownField.omahaShownJoint, the turn/river verdict omahaFacingBetEvShownField) draw the
 * bettor's holding and every other player's holding (a caller, an earlier all-in, a player still to act) each by an
 * additive walk with the SAME golden-ratio step. Walks with one step differ by a constant: every other player's
 * position in his range is a fixed function of the bettor's (in the turn/river sampler exactly 2x + c), and two
 * players of the field always sit a fixed distance apart. So within one decision the field is never strong and weak
 * at random against the bettor's sampled strength: it is strong exactly at some bettor strengths and weak at others,
 * and which ones depends only on the walk offsets of that hand. The joint equity of a multiway call is then off by
 * an amount that varies from hand to hand.
 *
 * THE FIX. With the option on, each player of the field draws his position in his range from his own stream
 * (mulberry32), seeded from the decision's sample seed (a function of the cards and the measurement salt, as before)
 * and a tag naming his role and slot ("in:k" for the k-th player already in, "behind:k" for the k-th player still to
 * act). Deterministic per decision; independent of the bettor's draw and of each other. The bettor's own walks
 * (value region, other holdings) are unchanged, so a heads-up count (no field) is the same number on and off.
 *
 * No hidden card is read, nothing is keyed to who a player is (person or Horse), and nothing here is a threshold.
 */

/** The tag of the f-th player of the field: the first `inCount` are already in, the rest are still to act. */
export function omahaFieldDrawTag(f: number, inCount: number): string {
  return f < inCount ? `in:${f}` : `behind:${f - inCount}`;
}

/** A sub-seed from the decision's sample seed and a role tag (FNV-1a over the tag, murmur3 finalizer). */
export function omahaFieldDrawSubSeed(seed: number, tag: string): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  const t = `field-draw|${tag}`;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193);
  h ^= seed >>> 16;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0 || 1;
}

/** mulberry32 on a sub-seed: numbers in [0, 1). */
export function omahaFieldDrawStream(subSeed: number): () => number {
  let a = subSeed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One stream per player of the field, in field order (players already in first). */
export function omahaFieldDrawStreams(
  seed: number,
  fieldSize: number,
  inCount: number
): Array<() => number> {
  return Array.from({ length: Math.max(0, fieldSize) }, (_, f) =>
    omahaFieldDrawStream(omahaFieldDrawSubSeed(seed, omahaFieldDrawTag(f, inCount)))
  );
}

/**
 * Test seam (measurement only; no rule sets it): when set, each joint sampler reports every scored showdown set:
 * the bettor's holding as its position in the whole pool (0 strongest .. 1 weakest), whether it came from his value
 * region, and each field player's position inside his own range (0 strongest .. 1 weakest).
 */
export type OmahaFieldDrawTrace = (
  source: 'flop' | 'shown',
  bettorPct: number,
  bettorIsValue: boolean,
  fieldPct: readonly number[]
) => void;
let trace: OmahaFieldDrawTrace | null = null;
export function omahaFieldDrawTraceSet(t: OmahaFieldDrawTrace | null): void {
  trace = t;
}
export function omahaFieldDrawTraceOf(): OmahaFieldDrawTrace | null {
  return trace;
}
