/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE PERSONA v2 — what the tuner may never overwrite (V48, 2026-09-05)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * From the deep audit, section 5.6: "Persona is three numbers." Every horse
 * in production carries `style`, `tightness`, `aggression`, `bluffFreq`,
 * `sizingMultiplier`, `lane`, `stakeBand` - and `horse_personality` (100 rows
 * with gto_adherence, risk_tolerance, preferred_game_types, archetype_name)
 * has no reader anywhere.
 *
 * There is a second problem underneath that one, and it is the reason this
 * file exists rather than four more dials. THE NIGHTLY TUNER WRITES THE SAME
 * KEYS AN AUTHOR WRITES. `tightness`, `aggression` and `bluffFreq` are
 * rewritten every night from measured frequencies, so an authored
 * personality is one night away from being averaged into the fleet - and on
 * 2026-09-04 the regression rule halved all three on 221 of 383 horses in a
 * single run.
 *
 * So persona v2 is a SEPARATE, TYPED, BOUNDED namespace under
 * `profiles.horse_profile.persona`:
 *
 *   - written by an author, by onboarding, or by the seeding migration;
 *   - NEVER written by HorseSelfTuner (ThePersonaSurvivesTheTuner.law.test.ts
 *     reads the tuner's source and fails if it ever writes a persona key);
 *   - every field bounded at the read boundary, like the dials, so a bad row
 *     degrades to the default instead of reaching a decision;
 *   - deterministic defaults from the horse id, so a horse with no persona
 *     row is still an individual and the fleet is diverse from first boot.
 *
 * Pure: no imports at all. NEVER refer to the horses as "bots" - they are
 * HORSES only.
 */

/** The authored persona. Every field is a rate or a bounded scalar. */
export interface HorsePersonaV2 {
  /**
   * How often this horse posts a VOLUNTARY straddle at a straddle-enabled
   * table, per hand it is under the gun. 0 = never (the nit), 0.35 = the
   * table's action player. Read by ServerTableEngineDealing before the
   * straddle round.
   */
  straddleRate: number;
  /**
   * How closely this horse follows the solver line when one exists, 0..1.
   * 1 = takes the chart every time; 0.7 = deviates on a third of the spots
   * where its own read disagrees. Read by HorseLogic at the solver consult.
   */
  gtoAdherence: number;
}

/*
 * WHAT IS DELIBERATELY NOT HERE (2026-09-05).
 *
 * `preferredDepthBB` was drafted and removed in the same session. The buy-in
 * is now the table maximum by owner instruction (October 26);
 * persona does not override cash entry size - reading a persona there means
 * a database read inside the seating path for a field no horse has authored
 * yet. A registered field with no reader is precisely the dead data this
 * estate's ledger exists to prevent, so it waits for the seating path to
 * carry the profile it already loads elsewhere.
 *
 * Same reason for `tilt`, `showBluffRate` and `sitOutAfterLossRate`: their
 * hooks (session memory, the show-cards path) are not in this branch. They
 * go in with the hooks, not before them.
 */

export const PERSONA_DEFAULT: HorsePersonaV2 = {
  straddleRate: 0,
  gtoAdherence: 1,
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Deterministic 32-bit hash with a real avalanche step.
 *
 * NOT the `h * 31 + c` scheme HorseBehavior uses, and the tests are why. That
 * hash barely mixes: `horse-a` and `horse-b` differ in one character and land
 * in the same persona bucket, and hashing `id|straddle|N` over sequential N
 * cycles its low bits, so a rate of 0.3 straddled 66% of hands. Both were
 * caught by the distribution assertions in
 * ThePersonaSurvivesTheTuner.law.test.ts before this ever reached a table.
 *
 * FNV-1a plus the murmur3 finalizer: one character changes every output bit,
 * and consecutive inputs are independent. Still pure and deterministic, which
 * is the only thing the engine requires (Math.random is banned in a decision
 * path, and a replayed hand must answer the same way twice).
 *
 * Exported 2026-10-06 for HorseTableTalk, which picks a seated horse's chat
 * line by the same rule: a hash of (horse, hand, event), never a roll.
 */
export function personaHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The persona a horse with no authored row gets: deterministic in its id, so
 * the fleet is diverse without anybody choosing, and stable across deploys.
 *
 * The straddle rate is deliberately skewed: most players never straddle, a
 * few always do. A flat spread would put every seat at the table in the
 * middle, which is the least human distribution there is.
 */
export function defaultPersonaFor(horseId: string): HorsePersonaV2 {
  // One independently mixed hash per field: slices of a single hash share
  // structure, and three fields drawn from one 32-bit value is exactly how
  // two horses end up with the same personality.
  const hs = personaHash(`${horseId}|straddle`);
  const bucket = hs % 100;
  const straddleRate =
    bucket < 60 ? 0 : bucket < 85 ? 0.08 + ((hs >>> 8) % 8) / 100 : 0.25 + ((hs >>> 16) % 15) / 100;
  return {
    straddleRate: Math.round(straddleRate * 100) / 100,
    // G4 (2026-10-16): 1 - the default horse takes the solver line wherever
    // one exists. It was 0.80..1.00 by id hash, which declined the chart on
    // up to a fifth of solved spots for 95.3% of live decisions and threw away
    // 10.4% of open-jam chart answers; the charts' own mixed strategies
    // already give the fleet its variety. An AUTHORED persona may still set
    // less (resolvePersona bounds it to 0.5..1).
    gtoAdherence: 1,
  };
}

/**
 * Read a persona out of a `profiles.horse_profile` value. Anything missing,
 * out of range or the wrong type falls back to the deterministic default for
 * that field - the same boundary discipline resolveHorseStyle applies to the
 * dials, and for the same reason: a bad row must degrade, never reach a
 * decision.
 */
export function resolvePersona(profile: unknown, horseId: string): HorsePersonaV2 {
  if (!profile || typeof profile !== 'object') return defaultPersonaFor(horseId);
  return personaFromValue((profile as Record<string, unknown>).persona, horseId);
}

/**
 * The same read, given the persona VALUE rather than the whole profile.
 * resolveHorseStyle has already unwrapped `horse_profile` by the time it
 * reaches the persona, and reading `obj.persona` there is what makes the
 * ledger's "every registered profile key is parsed at the boundary" test
 * able to see it.
 */
export function personaFromValue(raw: unknown, horseId: string): HorsePersonaV2 {
  const base = defaultPersonaFor(horseId);
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const straddle = num(p.straddleRate);
  const adherence = num(p.gtoAdherence);
  return {
    straddleRate: straddle === undefined ? base.straddleRate : clamp(straddle, 0, 0.6),
    gtoAdherence: adherence === undefined ? base.gtoAdherence : clamp(adherence, 0.5, 1),
  };
}

/**
 * Does this horse straddle THIS hand? Deterministic in (horse, hand): a
 * replayed hand must answer the same way twice, `Math.random` is banned in
 * the engine's decision paths, and a test must be able to assert the
 * distribution. The hand number is the only thing that moves.
 */
export function wantsStraddle(horseId: string, handNumber: number, rate: number): boolean {
  if (!(rate > 0)) return false;
  const h = personaHash(`${horseId}|straddle|${Math.max(0, Math.floor(handNumber))}`);
  return (h % 1000) / 1000 < Math.min(0.6, rate);
}

/**
 * Does this horse take the solver line here? Deterministic in (horse, hand,
 * spot) for the same reason. `spot` is any stable label for the decision -
 * the street plus the node key - so one hand can deviate on the flop and
 * follow the chart on the turn, which is what a person does.
 */
export function followsSolver(
  horseId: string,
  handNumber: number,
  spot: string,
  adherence: number
): boolean {
  if (adherence >= 1) return true;
  const h = personaHash(`${horseId}|gto|${Math.max(0, Math.floor(handNumber))}|${spot}`);
  return (h % 1000) / 1000 < Math.max(0, Math.min(1, adherence));
}

/**
 * Maximum EV indifference band (in big blinds) within which per-horse style
 * seeds may differentiate close sizings or tie-break indifferent frequencies.
 * The selected action may trail the highest estimated EV by at most 0.12 BB.
 */
export const HORSE_INDIFFERENCE_EV_BAND_BB = 0.12;

export interface HorseIndifferenceStyleSeeds {
  /** Deterministic sizing-mix bias within [-0.12, +0.12] BB (negative favors geometric smaller size, positive favors polarized larger size when EVs are within ±0.12 BB). */
  readonly sizingMixBias: number;
  /** Deterministic aggression tie-breaker within [-0.12, +0.12] BB when aggressive vs passive EV gap is inside ±0.12 BB. */
  readonly indifferenceAggressionBias: number;
  /** Deterministic Run-It-Twice variance preference in [0, 1] (0 = always run once, 1 = prefers RIT in large close-equity all-in pots). */
  readonly runItTwicePreference: number;
  /** Hard EV floor cap in BB (0.12 BB). */
  readonly maxEvBandBB: number;
}

/**
 * Deterministic EV-bounded individuality seeds per (horseId, mode).
 * Every horse keeps gtoAdherence = 1 (100% solver floor, zero blocked actions)
 * while expressing stable human-like style differences strictly inside estimated
 * EV indifference bands (at most 0.12 BB below the best candidate).
 */
export function indifferenceStyleSeedsFor(
  horseId: string,
  mode: 'cash' | 'tournament' = 'cash'
): HorseIndifferenceStyleSeeds {
  const id = String(horseId || 'default-horse');
  const hSize = personaHash(`${id}|indiff-sizing|${mode}`);
  const hAgg = personaHash(`${id}|indiff-aggression|${mode}`);
  const hRit = personaHash(`${id}|indiff-rit`);
  const centered = (u32: number): number => {
    const unit = ((u32 % 2401) - 1200) / 10000; // [-0.1200, +0.1200]
    return (
      Math.round(
        clamp(unit, -HORSE_INDIFFERENCE_EV_BAND_BB, HORSE_INDIFFERENCE_EV_BAND_BB) * 10000
      ) / 10000
    );
  };
  const ritBucket = (hRit % 1000) / 1000;
  return Object.freeze({
    sizingMixBias: centered(hSize),
    indifferenceAggressionBias: centered(hAgg),
    runItTwicePreference: Math.round(ritBucket * 1000) / 1000,
    maxEvBandBB: HORSE_INDIFFERENCE_EV_BAND_BB,
  });
}

/**
 * Evaluates a close-EV tie-break strictly inside ±HORSE_INDIFFERENCE_EV_BAND_BB.
 * - If candidate out-EVs reference by > +0.12 BB, always returns true.
 * - If candidate trails reference by > 0.12 BB (`evGapBB < -0.12`), always returns false.
 * - Inside [-0.12, +0.12] BB, applies the bounded per-horse style bias.
 */
export interface IndifferenceSpotContext {
  potBB?: number;
  bubbleFactor?: number;
  handKey?: string | number;
  street?: string;
}

export function resolveIndifferenceTieBreak(
  evGapBB: number,
  biasBB: number,
  spot?: IndifferenceSpotContext
): boolean {
  if (!Number.isFinite(evGapBB)) return false;
  const bf =
    spot?.bubbleFactor !== undefined && Number.isFinite(spot.bubbleFactor) && spot.bubbleFactor > 1
      ? spot.bubbleFactor
      : 1;
  const effectiveBand = HORSE_INDIFFERENCE_EV_BAND_BB / Math.min(2, Math.sqrt(bf));
  if (evGapBB > effectiveBand) return true;
  if (evGapBB < -effectiveBand) return false;
  let jitter = 0;
  if (spot && (spot.handKey !== undefined || spot.street !== undefined)) {
    const h = personaHash(`${String(spot.handKey ?? 0)}|${spot.street ?? ''}|indiff`);
    jitter =
      (((h % 401) - 200) / 10000) * Math.min(1, effectiveBand / HORSE_INDIFFERENCE_EV_BAND_BB);
  }
  const boundedBias = clamp(
    (Number.isFinite(biasBB) ? biasBB : 0) + jitter,
    -effectiveBand,
    effectiveBand
  );
  return evGapBB + boundedBias >= 0;
}

/**
 * Deterministic variance-reduction Run-It-Twice preference when offered at zero rake penalty.
 * Never accepts negative-EV surcharges; in zero-fee close-equity large pots, decides
 * deterministically from the horse's RIT persona preference, pot size (in BB), and equity closeness.
 */
export function prefersRunItTwice(
  horseId: string,
  potBB: number,
  equity = 0.5,
  extraRakeFeeBB = 0
): boolean {
  if (extraRakeFeeBB > 0) return false;
  if (!Number.isFinite(potBB) || potBB < 40) return false;
  const seeds = indifferenceStyleSeedsFor(horseId, 'cash');
  // Horses with low RIT preference (< 0.35) always run once ("gamble / max pressure").
  if (seeds.runItTwicePreference < 0.35) return false;
  const eq = clamp(Number.isFinite(equity) ? equity : 0.5, 0, 1);
  // Variance peaks near 50% equity (4 * eq * (1 - eq) in [0, 1]).
  const varianceFactor = 4 * eq * (1 - eq);
  if (varianceFactor < 0.45) return false;
  const potFactor = clamp((potBB - 40) / 160, 0, 1);
  const score = seeds.runItTwicePreference * 0.65 + varianceFactor * 0.2 + potFactor * 0.15;
  return score >= 0.58;
}

// -----------------------------------------------------------------------------
// V86 PLO & BIG-BET PERSONA ARCHETYPES - Deterministic, Tuner-Immune
// -----------------------------------------------------------------------------

export type HorsePloArchetype = 'lag_shark' | 'tricky_trap' | 'tag_crusher' | 'nit_hunter';

/**
 * Deterministic PLO and multi-street style axes derived purely from `horseId`.
 * Kept separate from `HorsePersonaV2` (`profiles.horse_profile.persona`) so
 * `ThePersonaSurvivesTheTuner.law.test.ts` and existing JSON shapes remain
 * unchanged while giving every Horse a distinct, persistent, tuner-immune
 * identity across PLO4, PLO5, PLO6, PLO8, and Bomb Pots.
 */
export interface HorsePloPersona {
  archetype: HorsePloArchetype;
  /** Frequency of non-AA 3-bets, squeezes, and shallow 4-bets with elite rundowns / ds broadways / nut-Ax (0.18..0.68) */
  plo3BetMix: number;
  /** Aggression with 16+ out / nut-wrap + nut-flush-draw combo draws postflop (0.35..0.88) */
  comboDrawAggro: number;
  /** OOP check-raise trap and IP dry-flop nutted check-back trap frequency (0.20..0.56) */
  trapFrequency: number;
  /** Turn probe and nut-changing scare-card takeaway frequency (0.28..0.66) */
  probeRate: number;
  /** River nut-blocker bluff and block-bet nut-trap mix (0.22..0.64) */
  riverBluffGear: number;
}

export function ploPersonaFor(horseId: string): HorsePloPersona {
  const id = horseId || 'default-horse';
  const hArch = personaHash(`${id}|plo_arch`) % 100;
  const h1 = (personaHash(`${id}|plo_3bet`) % 1000) / 1000;
  const h2 = (personaHash(`${id}|plo_combo`) % 1000) / 1000;
  const h3 = (personaHash(`${id}|plo_trap`) % 1000) / 1000;
  const h4 = (personaHash(`${id}|plo_probe`) % 1000) / 1000;
  const h5 = (personaHash(`${id}|plo_river`) % 1000) / 1000;

  if (hArch < 28) {
    // LAG Shark: relentless 3-bettor, combo-draw pumper, high turn probe pressure
    return {
      archetype: 'lag_shark',
      plo3BetMix: Math.round((0.46 + h1 * 0.22) * 100) / 100,
      comboDrawAggro: Math.round((0.68 + h2 * 0.2) * 100) / 100,
      trapFrequency: Math.round((0.24 + h3 * 0.14) * 100) / 100,
      probeRate: Math.round((0.48 + h4 * 0.18) * 100) / 100,
      riverBluffGear: Math.round((0.42 + h5 * 0.22) * 100) / 100,
    };
  }
  if (hArch < 52) {
    // Tricky Trap: deceptive check-raiser, slowplays dry sets IP, mixes nut river block-bets
    return {
      archetype: 'tricky_trap',
      plo3BetMix: Math.round((0.3 + h1 * 0.16) * 100) / 100,
      comboDrawAggro: Math.round((0.52 + h2 * 0.18) * 100) / 100,
      trapFrequency: Math.round((0.42 + h3 * 0.14) * 100) / 100,
      probeRate: Math.round((0.36 + h4 * 0.14) * 100) / 100,
      riverBluffGear: Math.round((0.36 + h5 * 0.18) * 100) / 100,
    };
  }
  if (hArch < 82) {
    // TAG Crusher: balanced nut-suit 3-bets, disciplined SPR commitment, clinical thin value
    return {
      archetype: 'tag_crusher',
      plo3BetMix: Math.round((0.34 + h1 * 0.16) * 100) / 100,
      comboDrawAggro: Math.round((0.58 + h2 * 0.18) * 100) / 100,
      trapFrequency: Math.round((0.28 + h3 * 0.14) * 100) / 100,
      probeRate: Math.round((0.38 + h4 * 0.14) * 100) / 100,
      riverBluffGear: Math.round((0.3 + h5 * 0.16) * 100) / 100,
    };
  }
  // Nit Hunter: punishes loose limpers/openers and over-stabs capped ranges while staying nutted
  return {
    archetype: 'nit_hunter',
    plo3BetMix: Math.round((0.2 + h1 * 0.14) * 100) / 100,
    comboDrawAggro: Math.round((0.42 + h2 * 0.16) * 100) / 100,
    trapFrequency: Math.round((0.32 + h3 * 0.14) * 100) / 100,
    probeRate: Math.round((0.42 + h4 * 0.16) * 100) / 100,
    riverBluffGear: Math.round((0.24 + h5 * 0.14) * 100) / 100,
  };
}

// -----------------------------------------------------------------------------
// V87 HOLD'EM PERSONA ARCHETYPES - Deterministic, Tuner-Immune
// -----------------------------------------------------------------------------

export type HorseHoldemArchetype = 'lag_shark' | 'tricky_trap' | 'tag_crusher' | 'nit_hunter';

/**
 * Deterministic Hold'em cash and tournament style axes derived purely from
 * `horseId`. Separate from `HorsePersonaV2` so nightly self-tuner updates never
 * overwrite or homogenize individual Hold'em table identities.
 */
export interface HorseHoldemPersona {
  archetype: HorseHoldemArchetype;
  /** Frequency of polarized/linear 3-bets, squeezes, and shallow 4-bet reshoves (0.22..0.64) */
  nlh3BetMix: number;
  /** Early-position open-limp trap and suited-connector limp mix rate (0.10..0.28) */
  epLimpTrapMix: number;
  /** Aggression with 12+ out combo draws postflop (0.38..0.86) */
  comboDrawAggro: number;
  /** OOP check-raise trap, dry IP check-back trap, and river nut block-bet mix (0.18..0.52) */
  trapFrequency: number;
  /** Turn probe and scare-card takeaway frequency after checked-back flops (0.28..0.64) */
  probeRate: number;
  /** River nut-blocker bluff and polar pressure gear (0.20..0.58) */
  riverBluffGear: number;
}

export function holdemPersonaFor(horseId: string): HorseHoldemPersona {
  const id = horseId || 'default-horse';
  const hArch = personaHash(`${id}|nlh_arch`) % 100;
  const h1 = (personaHash(`${id}|nlh_3bet`) % 1000) / 1000;
  const h2 = (personaHash(`${id}|nlh_limptrap`) % 1000) / 1000;
  const h3 = (personaHash(`${id}|nlh_combo`) % 1000) / 1000;
  const h4 = (personaHash(`${id}|nlh_trap`) % 1000) / 1000;
  const h5 = (personaHash(`${id}|nlh_probe`) % 1000) / 1000;
  const h6 = (personaHash(`${id}|nlh_river`) % 1000) / 1000;

  if (hArch < 25) {
    // 25% LAG Shark: high 3-bet pressure, aggressive combo-draw raises, relentless probes
    return {
      archetype: 'lag_shark',
      nlh3BetMix: Math.round((0.46 + h1 * 0.18) * 100) / 100,
      epLimpTrapMix: Math.round((0.14 + h2 * 0.08) * 100) / 100,
      comboDrawAggro: Math.round((0.68 + h3 * 0.18) * 100) / 100,
      trapFrequency: Math.round((0.2 + h4 * 0.12) * 100) / 100,
      probeRate: Math.round((0.48 + h5 * 0.16) * 100) / 100,
      riverBluffGear: Math.round((0.42 + h6 * 0.16) * 100) / 100,
    };
  }
  if (hArch < 45) {
    // 20% Tricky Trap: elevated EP limp-reraise traps, check-raises, and river block-bet traps
    return {
      archetype: 'tricky_trap',
      nlh3BetMix: Math.round((0.3 + h1 * 0.14) * 100) / 100,
      epLimpTrapMix: Math.round((0.2 + h2 * 0.08) * 100) / 100,
      comboDrawAggro: Math.round((0.52 + h3 * 0.16) * 100) / 100,
      trapFrequency: Math.round((0.38 + h4 * 0.14) * 100) / 100,
      probeRate: Math.round((0.34 + h5 * 0.14) * 100) / 100,
      riverBluffGear: Math.round((0.34 + h6 * 0.14) * 100) / 100,
    };
  }
  if (hArch < 85) {
    // 40% TAG Crusher: balanced preflop 3-bets, disciplined SPR control, clinical thin value
    return {
      archetype: 'tag_crusher',
      nlh3BetMix: Math.round((0.34 + h1 * 0.16) * 100) / 100,
      epLimpTrapMix: Math.round((0.12 + h2 * 0.08) * 100) / 100,
      comboDrawAggro: Math.round((0.56 + h3 * 0.18) * 100) / 100,
      trapFrequency: Math.round((0.24 + h4 * 0.12) * 100) / 100,
      probeRate: Math.round((0.38 + h5 * 0.14) * 100) / 100,
      riverBluffGear: Math.round((0.28 + h6 * 0.14) * 100) / 100,
    };
  }
  // 15% Nit Hunter: punishes loose openers/limpers and stabs capped checked ranges
  return {
    archetype: 'nit_hunter',
    nlh3BetMix: Math.round((0.22 + h1 * 0.12) * 100) / 100,
    epLimpTrapMix: Math.round((0.1 + h2 * 0.06) * 100) / 100,
    comboDrawAggro: Math.round((0.38 + h3 * 0.16) * 100) / 100,
    trapFrequency: Math.round((0.18 + h4 * 0.12) * 100) / 100,
    probeRate: Math.round((0.28 + h5 * 0.14) * 100) / 100,
    riverBluffGear: Math.round((0.2 + h6 * 0.12) * 100) / 100,
  };
}
