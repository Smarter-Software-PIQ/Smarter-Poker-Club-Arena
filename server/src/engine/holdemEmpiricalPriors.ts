/**
 * HOLD'EM EMPIRICAL POOL PRIORS & OPPONENT-HUD SHRINKAGE (2026-11-21, Horse Switch lane).
 *
 * Pure, side-effect-free empirical NLH pool priors measured directly from production
 * `public.hand_history` (read-only SELECTs, project kuklfnapbkmacvwxktbh) paired with
 * smooth Empirical-Bayes shrinkage against lifetime `OpponentHudStore` (`HudPacketOpponent`)
 * counts and/or `HorseMind` `ExploitCounters`.
 *
 * ZERO LIVE DECISION CHANGES: this module is NOT imported by HorseLogic.ts until a
 * priced option (`v64RiverRaiseNeedsTwoPairIsPriced`, `v51RiverFlatIsPriced`,
 * `holdemPersonaPostflopIsPriced`, etc.) explicitly adopts it under a declared grade
 * criteria file.
 *
 * WHY THIS EXISTS (audit of hs-river and hs-persona, 2026-11-21):
 *   1. `hs-river` (`v64`/`v51`) currently proxies fold-to-river-raise with
 *      `1 - envelope.riverCall` (fold to a river FIRST bet from Oct 16, 2026: 48-57%,
 *      scaled up linearly to 75-84% on raises), whereas live NLH bettors facing a river
 *      raise fold only 53.7% vs non-all-in raises (Humans: 26.7%) and 29.9% vs all-in
 *      jams (Humans: 20.0%). It also uses the textbook balanced river bluff share
 *      `s / (pot + 2s)` (25% half-pot, 33% pot, 38%+ overbet) instead of the measured
 *      showdown bluff share (12.3% medium, 23.5% pot, 5.8% overbet).
 *   2. `hs-persona` (`holdemPersonaPostflopIsPriced`) currently uses one pooled
 *      all-street `envelope.foldToBet` (38.9%-43.5% at reference price 0.337) scaled
 *      linearly, predicting 28.6%-32.0% fold on a 0.33x pot IP flop c-bet, whereas the
 *      live pool folds 37.9% (Horses 36.7%, Humans 42.2%) overall, 40.3% on paired
 *      boards, and only 23.8% on monotone boards / 26.5% at SPR < 3.
 *   3. `OpponentHudStore` (#11680) currently indexes `HUD_FAMILIES = ['plo4', 'plo5']`
 *      only (`opponent_hud_profiles` has 0 NLH rows today). Every estimator here reads
 *      `HudPacketOpponent` counts smoothly when available, optionally falls back to
 *      `ExploitCounters` where semantically valid, and degrades 100% cleanly to the
 *      measured NLH empirical pool prior when opponent HUD sample is 0 or unavailable.
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';

/**
 * Structural slice of `opponentHud/OpponentHud.ts#HudPacketOpponent` (`eff` / `lc` count maps).
 * Defined structurally so empirical priors carry zero import dependency on `opponentHud/`
 * (preserving `TheHudProviderChangesNoDecision.law.test.ts` while remaining 100% assignable
 * from `HudPacketOpponent`).
 */
export interface HoldemHudPacketOpponent {
  readonly eff?: Readonly<Record<string, readonly [number, number] | undefined>>;
  readonly lc?: Readonly<Record<string, readonly [number, number] | undefined>>;
}

export type HoldemEmpiricalStreet = 'flop' | 'turn' | 'river';
export type HoldemFlopTexture = 'unpaired_nonmono' | 'paired' | 'mono';
export type HoldemSprBand = 'low' | 'mid' | 'deep';
export type HoldemBetSizeBand = 'small' | 'medium' | 'large';
export type HoldemRiverSizeBand = 'le_33' | '34_67' | '67_100' | 'gt_100';
export type HoldemRiverRaiseKind = 'non_allin_raise' | 'all_in_raise';
export type HoldemPriorSource = 'hud_context' | 'hud_street' | 'exploit_counters' | 'pool_prior';

export interface EmpiricalRateCell {
  readonly n: number;
  readonly hits: number;
  readonly rate: number;
}

export interface RiverRaiseResponseCell {
  readonly n: number;
  readonly folds: number;
  readonly calls: number;
  readonly reraises: number;
  readonly foldRate: number;
  readonly callRate: number;
  readonly reraiseRate: number;
  readonly avgVillainCallPrice: number;
}

export interface RiverBluffShareCell {
  readonly upTo: number;
  readonly band: HoldemRiverSizeBand;
  readonly n: number;
  readonly bluffs: number;
  readonly weakOrMuck: number;
  readonly bluffShare: number;
  readonly weakOrMuckShare: number;
}

export interface EmpiricalShrinkEstimate {
  /** Posterior mean in [0, 1] (or [0, cap] for bluff share). */
  readonly mean: number;
  /** Measured NLH empirical pool prior before opponent shrinkage. */
  readonly prior: number;
  /** Empirical-Bayes shrinkage weight n / (n + k) in [0, 1]. 0 when no opponent data. */
  readonly weight: number;
  /** Effective opponent sample size contributing to the posterior. */
  readonly effectiveN: number;
  /** Prior pseudo-observation count k used for shrinkage. */
  readonly priorStrength: number;
  /** Which evidence tier supplied the opponent counts (or 'pool_prior' when none). */
  readonly source: HoldemPriorSource;
}

const EPS = 1e-9;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Provenance record for every measured empirical table in this module. */
export const HOLDEM_EMPIRICAL_PRIORS_PROVENANCE = Object.freeze({
  measuredDate: '2026-11-21',
  project: 'kuklfnapbkmacvwxktbh (production hand_history, read-only SELECT)',
  scope: 'game_variant = nlh, single board (community_cards2 IS NULL), bomb_pot IS NULL',
  windows: Object.freeze({
    flopAndTurnHasHuman: '2026-10-22T00:00:00Z..2026-11-21T18:00:00Z (has_human, H+P pooled)',
    flopTextureAndSprAllNlh: '2026-11-21T15:00:00Z..2026-11-21T18:00:00Z (all NLH, 3h)',
    betWhenCheckedToAllNlh: '2026-11-21T06:00:00Z..2026-11-21T18:00:00Z (all NLH, 12h)',
    riverFirstBetAndRaiseAllNlh: '2026-11-18T18:00:00Z..2026-11-21T18:00:00Z (all NLH, 72h)',
    riverHasHuman: '2026-10-22T00:00:00Z..2026-11-21T18:00:00Z (has_human, 30d)',
    riverBluffShareAllNlh: '2026-11-20T18:00:00Z..2026-11-21T18:00:00Z (all NLH, 24h)',
  }),
});

/** Default Empirical-Bayes prior strengths (pseudo-observations k), matching OpponentHud / HorseOpponentExploit. */
export const HOLDEM_PRIOR_STRENGTH = Object.freeze({
  flopCbetFold: 16,
  turnBetFold: 14,
  riverFoldToBet: 12,
  riverFoldToRaise: 12,
  riverBluffShare: 8,
  betWhenCheckedTo: 16,
  /** Prior strength when falling back to HorseMind ExploitCounters (matches EXPLOIT_PRIOR_STRENGTH = 6). */
  exploitCountersFallback: 6,
});

/** Maximum bluff share ever priced (a bettor always retains some value combinations). */
export const HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP = 0.95;

/**
 * Measured NLH flop first-bet / c-bet fold rates by bettor position and pot-fraction size band.
 * Source: 30d has_human NLH (2026-10-22..2026-11-21 18:00Z, n = 10,707; H + P pooled).
 * Cross-checked against 3h all-NLH (n = 1,745: IP small 36.87%, IP med 48.71%, IP large 64.08%).
 */
export const HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET: Readonly<
  Record<'ip' | 'oop', Readonly<Record<HoldemBetSizeBand, EmpiricalRateCell>>>
> = Object.freeze({
  ip: Object.freeze({
    small: Object.freeze({ n: 3869, hits: 1467, rate: 1467 / 3869 }),
    medium: Object.freeze({ n: 3091, hits: 1567, rate: 1567 / 3091 }),
    large: Object.freeze({ n: 1285, hits: 858, rate: 858 / 1285 }),
  }),
  oop: Object.freeze({
    small: Object.freeze({ n: 954, hits: 264, rate: 264 / 954 }),
    medium: Object.freeze({ n: 1043, hits: 365, rate: 365 / 1043 }),
    large: Object.freeze({ n: 465, hits: 224, rate: 224 / 465 }),
  }),
});

/**
 * Flop texture fold-rate multipliers relative to unpaired non-monotone boards.
 * Source: 3h all-NLH IP flop first-bets (2026-11-21T15:00..18:00Z, n = 1,354):
 *   unpaired_nonmono: 469 / 1,074 = 0.4367 (1.000x)
 *   paired:           111 /   233 = 0.4764 (1.091x)
 *   mono:              16 /    47 = 0.3404 (0.780x)
 */
export const HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT: Readonly<
  Record<HoldemFlopTexture, { readonly n: number; readonly folds: number; readonly mult: number }>
> = Object.freeze({
  unpaired_nonmono: Object.freeze({ n: 1074, folds: 469, mult: 1 }),
  paired: Object.freeze({
    n: 233,
    folds: 111,
    mult: 111 / 233 / (469 / 1074),
  }),
  mono: Object.freeze({
    n: 47,
    folds: 16,
    mult: 16 / 47 / (469 / 1074),
  }),
});

/**
 * Flop SPR fold-rate multipliers for small IP c-bets (f <= 0.40).
 * Source: 3h all-NLH IP small flop c-bets (2026-11-21T15:00..18:00Z, n = 670, mean 247/670 = 0.3687):
 *   low  (SPR < 3):    22 /  83 = 0.2651 (0.719x)
 *   mid  (3 <= SPR < 7): 69 / 164 = 0.4207 (1.141x)
 *   deep (SPR >= 7):  156 / 423 = 0.3688 (1.000x)
 */
export const HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT: Readonly<
  Record<HoldemSprBand, { readonly n: number; readonly folds: number; readonly mult: number }>
> = Object.freeze({
  low: Object.freeze({ n: 83, folds: 22, mult: 22 / 83 / (247 / 670) }),
  mid: Object.freeze({ n: 164, folds: 69, mult: 69 / 164 / (247 / 670) }),
  deep: Object.freeze({ n: 423, folds: 156, mult: 156 / 423 / (247 / 670) }),
});

/**
 * Measured NLH turn first-bet / takeaway fold rates by bettor position and pot-fraction size band.
 * Source: 30d has_human NLH (2026-10-22..2026-11-21 18:00Z, n = 6,807; H + P pooled).
 */
export const HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET: Readonly<
  Record<'ip' | 'oop', Readonly<Record<HoldemBetSizeBand, EmpiricalRateCell>>>
> = Object.freeze({
  ip: Object.freeze({
    small: Object.freeze({ n: 857, hits: 317, rate: 317 / 857 }),
    medium: Object.freeze({ n: 1695, hits: 792, rate: 792 / 1695 }),
    large: Object.freeze({ n: 1104, hits: 737, rate: 737 / 1104 }),
  }),
  oop: Object.freeze({
    small: Object.freeze({ n: 753, hits: 201, rate: 201 / 753 }),
    medium: Object.freeze({ n: 1510, hits: 583, rate: 583 / 1510 }),
    large: Object.freeze({ n: 888, hits: 458, rate: 458 / 888 }),
  }),
});

/**
 * Measured NLH river fold rates facing a river FIRST bet (for reference / contrast with river raises).
 * Source: 72h all-NLH Horse (n = 14,830) + 30d has_human Person (n = 793), pooled (n = 15,623).
 */
export const HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET: Readonly<
  Record<HoldemRiverSizeBand, EmpiricalRateCell>
> = Object.freeze({
  le_33: Object.freeze({ n: 2126, hits: 734, rate: 734 / 2126 }),
  '34_67': Object.freeze({ n: 6746, hits: 3690, rate: 3690 / 6746 }),
  '67_100': Object.freeze({ n: 4517, hits: 3286, rate: 3286 / 4517 }),
  gt_100: Object.freeze({ n: 2234, hits: 1770, rate: 1770 / 2234 }),
});

/**
 * Measured NLH river bettor response facing a river RAISE (the true v64/v51 prior).
 * Source: 72h all-NLH Horse (n = 749) + 30d has_human Person (n = 40), pooled (n = 789).
 * Note: Humans alone are materially stickier (non-all-in fold 8/30 = 26.7%, all-in fold 2/10 = 20.0%);
 * once OpponentHudStore covers NLH, per-opponent `r.fRaise` shrinkage pulls sticky opponents down cleanly.
 */
export const HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE: Readonly<
  Record<HoldemRiverRaiseKind, RiverRaiseResponseCell>
> = Object.freeze({
  non_allin_raise: Object.freeze({
    n: 495,
    folds: 266,
    calls: 205,
    reraises: 24,
    foldRate: 266 / 495,
    callRate: 205 / 495,
    reraiseRate: 24 / 495,
    avgVillainCallPrice: 0.2813,
  }),
  all_in_raise: Object.freeze({
    n: 294,
    folds: 88,
    calls: 197,
    reraises: 9,
    foldRate: 88 / 294,
    callRate: 197 / 294,
    reraiseRate: 9 / 294,
    avgVillainCallPrice: 0.1855,
  }),
});

/**
 * Measured NLH river bluff share at showdown across ALL callers (not restricted to one-pair callers).
 * Source: 24h all-NLH Horse bettors (n = 1,842) + 30d has_human Person bettors (n = 363), pooled (n = 2,205).
 * Bluff = bettor's shown hand is High Card or matches the board's own class alone.
 * Selection bias: only called river bets reach showdown, so these are upper bounds on all bets of each size.
 */
export const HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE: readonly RiverBluffShareCell[] =
  Object.freeze([
    Object.freeze({
      upTo: 1 / 3,
      band: 'le_33',
      n: 490,
      bluffs: 104,
      weakOrMuck: 223,
      bluffShare: 104 / 490,
      weakOrMuckShare: 223 / 490,
    }),
    Object.freeze({
      upTo: 2 / 3,
      band: '34_67',
      n: 1039,
      bluffs: 128,
      weakOrMuck: 297,
      bluffShare: 128 / 1039,
      weakOrMuckShare: 297 / 1039,
    }),
    Object.freeze({
      upTo: 1,
      band: '67_100',
      n: 435,
      bluffs: 102,
      weakOrMuck: 166,
      bluffShare: 102 / 435,
      weakOrMuckShare: 166 / 435,
    }),
    Object.freeze({
      upTo: Infinity,
      band: 'gt_100',
      n: 241,
      bluffs: 14,
      weakOrMuck: 46,
      bluffShare: 14 / 241,
      weakOrMuckShare: 46 / 241,
    }),
  ]);

/**
 * Measured NLH postflop bet-when-checked-to rate by street.
 * Source: 12h all-NLH (2026-11-21T06:00..18:00Z, n = 26,961 opportunities).
 */
export const HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO: Readonly<
  Record<HoldemEmpiricalStreet, EmpiricalRateCell>
> = Object.freeze({
  flop: Object.freeze({ n: 13575, hits: 4548, rate: 4548 / 13575 }),
  turn: Object.freeze({ n: 8206, hits: 3196, rate: 3196 / 8206 }),
  river: Object.freeze({ n: 5180, hits: 1619, rate: 1619 / 5180 }),
});

/** Classify a pot-relative bet fraction into small (<= 0.40), medium (<= 0.70), or large (> 0.70). */
export function holdemBetSizeBand(potFraction: number): HoldemBetSizeBand {
  const f = Number.isFinite(potFraction) ? Math.max(0, potFraction) : 0;
  if (f <= 0.4 + EPS) return 'small';
  if (f <= 0.7 + EPS) return 'medium';
  return 'large';
}

/** Classify effective SPR into low (< 3), mid (3..7), or deep (>= 7). */
export function holdemSprBand(spr: number): HoldemSprBand {
  if (!Number.isFinite(spr) || spr < 3) return 'low';
  if (spr < 7) return 'mid';
  return 'deep';
}

/** Lookup the empirical river bluff-share row for a pot-relative wager fraction. */
export function holdemRiverBluffShareCell(potFraction: number): RiverBluffShareCell {
  const f = Number.isFinite(potFraction) ? Math.max(0, potFraction) : 0;
  for (const row of HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE) {
    if (f <= row.upTo + EPS) return row;
  }
  return HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE[
    HOLDEM_EMPIRICAL_RIVER_BLUFF_SHARE_TABLE.length - 1
  ];
}

/**
 * Smooth Beta-binomial Empirical-Bayes shrinkage (no sample cliff, matching OpponentHud.ts):
 *   posterior = (hits + k * prior) / (n + k),   weight = n / (n + k)
 * When n <= 0 or non-finite, returns the exact pool prior with weight 0.
 */
export function empiricalBayesShrink(
  hits: number,
  opportunities: number,
  prior: number,
  priorStrength: number,
  source: HoldemPriorSource = 'hud_context'
): EmpiricalShrinkEstimate {
  const p = clamp01(prior);
  const k = Number.isFinite(priorStrength) && priorStrength > 0 ? priorStrength : 1;
  const n = Number.isFinite(opportunities) && opportunities > 0 ? opportunities : 0;
  if (!(n > 0)) {
    return { mean: p, prior: p, weight: 0, effectiveN: 0, priorStrength: k, source: 'pool_prior' };
  }
  const h = Number.isFinite(hits) ? Math.max(0, Math.min(n, hits)) : 0;
  const weight = n / (n + k);
  const mean = clamp01((h + k * p) / (n + k));
  return { mean, prior: p, weight, effectiveN: n, priorStrength: k, source };
}

/**
 * Read `[opportunities, hits]` from a `HudPacketOpponent` for a statistic key, checking the
 * blended recency/lifetime table (`eff`) first and falling back to raw lifetime counts (`lc`).
 * Returns null if the opponent has no packet or 0 opportunities for `stat`.
 */
export function readHudOpponentStat(
  hudOpp: HoldemHudPacketOpponent | null | undefined,
  stat: string
): { readonly opportunities: number; readonly hits: number } | null {
  if (!hudOpp) return null;
  const pair = hudOpp.eff?.[stat] ?? hudOpp.lc?.[stat];
  if (!pair || !Array.isArray(pair) || pair.length < 2) return null;
  const opportunities = Number(pair[0]);
  const hits = Number(pair[1]);
  if (!Number.isFinite(opportunities) || !(opportunities > 0) || !Number.isFinite(hits)) {
    return null;
  }
  return { opportunities, hits: Math.max(0, Math.min(opportunities, hits)) };
}

/**
 * Compute the villain's TRUE pot-odds price when facing hero's raise to `heroRaiseTo`:
 *   villainCall = min(heroRaiseTo - villainIn, villainStack)
 *   heroAdd     = min(heroRaiseTo - heroIn, heroStack)
 *   price       = villainCall / (potBeforeRaise + heroAdd + villainCall)
 *
 * Fixes the raise-pricing bias in `wagerValue` (which passes hero's `add` against `pot` instead
 * of villain's incremental call against `pot + heroAdd`).
 */
export function holdemVillainRaiseCallPrice(
  potBeforeRaise: number,
  heroRaiseTo: number,
  heroIn: number,
  villainIn: number,
  heroStack: number,
  villainStack: number
): number {
  const heroAdd = Math.max(0, Math.min(heroRaiseTo - heroIn, heroStack));
  const villainCall = Math.max(0, Math.min(heroRaiseTo - villainIn, villainStack));
  const potAfterHeroRaise = Math.max(0, potBeforeRaise) + heroAdd;
  if (!(villainCall > 0) || !(potAfterHeroRaise + villainCall > 0)) return 0;
  return clamp01(villainCall / (potAfterHeroRaise + villainCall));
}

/**
 * Measured NLH pool prior for flop c-bet fold frequency, conditioned on bettor position,
 * bet size, board texture, and (for small IP c-bets) effective SPR.
 */
export function holdemEmpiricalFlopCbetFoldPrior(ctx: {
  readonly bettorInPosition: boolean;
  readonly potFraction: number;
  readonly texture?: HoldemFlopTexture;
  readonly spr?: number;
}): number {
  const pos = ctx.bettorInPosition ? 'ip' : 'oop';
  const band = holdemBetSizeBand(ctx.potFraction);
  let rate = HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos][band].rate;
  if (ctx.texture) {
    rate *= HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT[ctx.texture].mult;
  }
  if (ctx.bettorInPosition && band === 'small' && ctx.spr !== undefined) {
    rate *= HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT[holdemSprBand(ctx.spr)].mult;
  }
  return clamp01(Math.min(0.95, rate));
}

/**
 * Empirical-Bayes estimator for opponent flop c-bet fold frequency (`hs-persona` range c-bet spot).
 * Preference order:
 *   1. `OpponentHud` context stat (`f.fb.sm.hu` for f <= 0.70, `f.fb.bg.hu` for f > 0.70),
 *   2. `OpponentHud` street stat (`f.fBet`),
 *   3. `HorseMind` `ExploitCounters` (`foldToBet` / `foldToBetOpp`, shrunk with k = 6),
 *   4. 100% measured NLH empirical pool prior (weight = 0).
 */
export function estimateHoldemFlopCbetFold(
  ctx: {
    readonly bettorInPosition: boolean;
    readonly potFraction: number;
    readonly texture?: HoldemFlopTexture;
    readonly spr?: number;
    readonly headsUp?: boolean;
  },
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'foldToBet' | 'foldToBetOpp'> | null
): EmpiricalShrinkEstimate {
  const prior = holdemEmpiricalFlopCbetFoldPrior(ctx);
  const pl = ctx.headsUp === false ? 'mw' : 'hu';
  const sz = ctx.potFraction > 0.7 + EPS ? 'bg' : 'sm';
  const ctxStat = readHudOpponentStat(hudOpp, `f.fb.${sz}.${pl}`);
  if (ctxStat) {
    return empiricalBayesShrink(
      ctxStat.hits,
      ctxStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.flopCbetFold,
      'hud_context'
    );
  }
  const streetStat = readHudOpponentStat(hudOpp, 'f.fBet');
  if (streetStat) {
    return empiricalBayesShrink(
      streetStat.hits,
      streetStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.flopCbetFold,
      'hud_street'
    );
  }
  if (exploitCounters && exploitCounters.foldToBetOpp > 0) {
    return empiricalBayesShrink(
      exploitCounters.foldToBet,
      exploitCounters.foldToBetOpp,
      prior,
      HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
      'exploit_counters'
    );
  }
  return empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.flopCbetFold, 'pool_prior');
}

/**
 * Empirical-Bayes estimator for opponent turn first-bet / takeaway fold frequency (`hs-persona` stab spot).
 * Falls back cleanly from `OpponentHud` (`t.fb.sm|bg.hu|mw` -> `t.fBet`) to `ExploitCounters` to pool prior.
 */
export function estimateHoldemTurnBetFold(
  ctx: {
    readonly bettorInPosition: boolean;
    readonly potFraction: number;
    readonly headsUp?: boolean;
  },
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'foldToBet' | 'foldToBetOpp'> | null
): EmpiricalShrinkEstimate {
  const pos = ctx.bettorInPosition ? 'ip' : 'oop';
  const band = holdemBetSizeBand(ctx.potFraction);
  const prior = HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos][band].rate;
  const pl = ctx.headsUp === false ? 'mw' : 'hu';
  const sz = ctx.potFraction > 0.7 + EPS ? 'bg' : 'sm';
  const ctxStat = readHudOpponentStat(hudOpp, `t.fb.${sz}.${pl}`);
  if (ctxStat) {
    return empiricalBayesShrink(
      ctxStat.hits,
      ctxStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.turnBetFold,
      'hud_context'
    );
  }
  const streetStat = readHudOpponentStat(hudOpp, 't.fBet');
  if (streetStat) {
    return empiricalBayesShrink(
      streetStat.hits,
      streetStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.turnBetFold,
      'hud_street'
    );
  }
  if (exploitCounters && exploitCounters.foldToBetOpp > 0) {
    return empiricalBayesShrink(
      exploitCounters.foldToBet,
      exploitCounters.foldToBetOpp,
      prior,
      HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
      'exploit_counters'
    );
  }
  return empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.turnBetFold, 'pool_prior');
}

/**
 * Smooth piecewise-linear NLH pool prior for villain fold frequency facing a RIVER FIRST BET
 * of pot-relative size `potFraction`, interpolated across the four measured empirical cells
 * in `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET` (n = 15,623 pooled NLH rivers).
 */
export function holdemEmpiricalRiverFoldToBetPrior(potFraction: number): number {
  const f = Number.isFinite(potFraction) ? Math.max(0, potFraction) : 0;
  const f0 = 0.25;
  const f1 = 0.5;
  const f2 = 0.83;
  const f3 = 1.25;
  const r0 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.le_33.rate;
  const r1 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  const r2 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate;
  const r3 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.gt_100.rate;
  let rate: number;
  if (f <= f0) {
    rate = r0 * (0.75 + 0.25 * (f / f0));
  } else if (f <= f1) {
    rate = r0 + ((r1 - r0) * (f - f0)) / (f1 - f0);
  } else if (f <= f2) {
    rate = r1 + ((r2 - r1) * (f - f1)) / (f2 - f1);
  } else if (f <= f3) {
    rate = r2 + ((r3 - r2) * (f - f2)) / (f3 - f2);
  } else {
    rate = r3 + Math.min(0.08, (f - f3) * 0.04);
  }
  return Math.max(0.1, Math.min(0.92, clamp01(rate)));
}

/**
 * Empirical-Bayes estimator for opponent fold frequency facing a RIVER FIRST BET
 * (`holdemRiverBluffIsPriced` and unopened / checked-to river pricing spots).
 *
 * Preference order:
 *   1. `OpponentHud` size-and-player-count context stat (`r.fb.sm|bg.hu|mw`),
 *   2. `OpponentHud` river street fold-to-bet stat (`r.fBet`), shrunk against the medium-bet
 *      pool prior and scaled proportionally to preserve bet-size elasticity,
 *   3. `HorseMind` `ExploitCounters` (`riverCall` / `riverCallOpp`, `foldHits = opp - call`),
 *      shrunk with k = 6 and scaled proportionally to preserve bet-size elasticity,
 *   4. 100% measured NLH empirical river first-bet pool prior (weight = 0).
 */
export function estimateHoldemRiverFoldToBet(
  ctx: {
    readonly potFraction: number;
    readonly headsUp?: boolean;
  },
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'riverCall' | 'riverCallOpp'> | null
): EmpiricalShrinkEstimate {
  const prior = holdemEmpiricalRiverFoldToBetPrior(ctx.potFraction);
  const pl = ctx.headsUp === false ? 'mw' : 'hu';
  const sz = ctx.potFraction > 0.7 + EPS ? 'bg' : 'sm';
  const ctxStat = readHudOpponentStat(hudOpp, `r.fb.${sz}.${pl}`);
  if (ctxStat) {
    return empiricalBayesShrink(
      ctxStat.hits,
      ctxStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.riverFoldToBet,
      'hud_context'
    );
  }

  const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  const scaleRelativeToMedium = (
    hits: number,
    opportunities: number,
    priorStrength: number,
    source: HoldemPriorSource
  ): EmpiricalShrinkEstimate => {
    const shrunk = empiricalBayesShrink(hits, opportunities, baseMedPrior, priorStrength, source);
    const ratio = baseMedPrior > EPS ? shrunk.mean / baseMedPrior : 1;
    const mean = Math.max(0.05, Math.min(0.92, clamp01(prior * ratio)));
    return {
      mean,
      prior,
      weight: shrunk.weight,
      effectiveN: shrunk.effectiveN,
      priorStrength: shrunk.priorStrength,
      source: shrunk.source,
    };
  };

  const streetStat = readHudOpponentStat(hudOpp, 'r.fBet');
  if (streetStat) {
    return scaleRelativeToMedium(
      streetStat.hits,
      streetStat.opportunities,
      HOLDEM_PRIOR_STRENGTH.riverFoldToBet,
      'hud_street'
    );
  }
  if (exploitCounters && exploitCounters.riverCallOpp > 0) {
    const foldHits = Math.max(0, exploitCounters.riverCallOpp - exploitCounters.riverCall);
    return scaleRelativeToMedium(
      foldHits,
      exploitCounters.riverCallOpp,
      HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
      'exploit_counters'
    );
  }
  return empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.riverFoldToBet, 'pool_prior');
}

/**
 * Empirical-Bayes estimator for opponent fold frequency facing a RIVER RAISE (`hs-river` v64 / v51 spots).
 *
 * Uses the measured NLH fold-to-river-raise prior (NOT `1 - riverCall` first-bet fold!), optionally
 * price-adjusted around the measured average villain call price (`0.2813` non-all-in, `0.1855` all-in)
 * with bounded elasticity (0.5x to 1.5x, capped at 0.90) so committed jams never extrapolate to 85% folds.
 *
 * Preference order:
 *   1. `OpponentHud` exact river-fold-to-raise stat (`r.fRaise`),
 *   2. `OpponentHud` river-fold-to-bet stat (`r.fBet`, attenuated toward the raise prior),
 *   3. 100% measured NLH river-raise pool prior (weight = 0). Note: `ExploitCounters.riverCall`
 *      measures calls vs first bets, NOT raises, so it is intentionally NOT substituted raw here.
 */
export function estimateHoldemRiverFoldToRaise(
  ctx: {
    readonly raiseKind: HoldemRiverRaiseKind;
    /** Optional villain pot-odds price `villainCall / (potAfterRaise + villainCall)` for gentle scaling. */
    readonly villainCallPrice?: number;
  },
  hudOpp?: HoldemHudPacketOpponent | null
): EmpiricalShrinkEstimate {
  const cell = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE[ctx.raiseKind];
  let prior = cell.foldRate;
  if (
    ctx.villainCallPrice !== undefined &&
    Number.isFinite(ctx.villainCallPrice) &&
    ctx.villainCallPrice > 0 &&
    cell.avgVillainCallPrice > 0
  ) {
    const ratio = Math.max(0.5, Math.min(1.5, ctx.villainCallPrice / cell.avgVillainCallPrice));
    prior = Math.min(0.9, clamp01(prior * ratio));
  }
  const raiseStat = readHudOpponentStat(hudOpp, 'r.fRaise');
  if (raiseStat) {
    return empiricalBayesShrink(
      raiseStat.hits,
      raiseStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
      'hud_context'
    );
  }
  const betStat = readHudOpponentStat(hudOpp, 'r.fBet');
  if (betStat) {
    // Attenuate first-bet river fold counts (half weight, k doubled) because facing a raise is stickier.
    return empiricalBayesShrink(
      betStat.hits,
      betStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.riverFoldToRaise * 2,
      'hud_street'
    );
  }
  return empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.riverFoldToRaise, 'pool_prior');
}

/**
 * Empirical-Bayes estimator for opponent river bluff share (`hs-river` line range construction).
 * Combines the measured all-callers NLH showdown bluff share with either:
 *   1. `OpponentHud` river value-at-showdown counts (`vs.r.lead.sm|bg` or `sd.strong.r`: weak = 1 - strong), OR
 *   2. `HorseMind` `styleSizeShown` `{ shown, strong }` tallies (matching #11656's proportional scaling),
 * falling back 100% to the measured NLH empirical pool bluff share when sample is 0.
 */
export function estimateHoldemRiverBluffShare(
  potFraction: number,
  hudOpp?: HoldemHudPacketOpponent | null,
  styleSizeShown?: { readonly shown: number; readonly strong: number } | null
): EmpiricalShrinkEstimate {
  const cell = holdemRiverBluffShareCell(potFraction);
  const prior = cell.bluffShare;
  const popWeak = cell.weakOrMuckShare;
  const sz = potFraction > 0.7 + EPS ? 'bg' : 'sm';

  const scaleFromWeak = (
    weakHits: number,
    opportunities: number,
    source: HoldemPriorSource
  ): EmpiricalShrinkEstimate => {
    const shrunkWeak = empiricalBayesShrink(
      weakHits,
      opportunities,
      popWeak,
      HOLDEM_PRIOR_STRENGTH.riverBluffShare,
      source
    );
    const scaled = popWeak > EPS ? (prior * shrunkWeak.mean) / popWeak : prior;
    return {
      mean: Math.max(0, Math.min(HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP, scaled)),
      prior,
      weight: shrunkWeak.weight,
      effectiveN: shrunkWeak.effectiveN,
      priorStrength: shrunkWeak.priorStrength,
      source: shrunkWeak.source,
    };
  };

  // OpponentHud tracks strong-hand share (`vs.r.lead.sm|bg` and `sd.strong.r`), so weak = n - hits.
  const hudCtx = readHudOpponentStat(hudOpp, `vs.r.lead.${sz}`);
  if (hudCtx) {
    return scaleFromWeak(
      Math.max(0, hudCtx.opportunities - hudCtx.hits),
      hudCtx.opportunities,
      'hud_context'
    );
  }
  const hudStreet = readHudOpponentStat(hudOpp, 'sd.strong.r');
  if (hudStreet) {
    return scaleFromWeak(
      Math.max(0, hudStreet.opportunities - hudStreet.hits),
      hudStreet.opportunities,
      'hud_street'
    );
  }
  const shown = Math.max(0, Number(styleSizeShown?.shown ?? 0));
  if (styleSizeShown && shown > 0) {
    const strong = Math.max(0, Math.min(shown, Number(styleSizeShown.strong ?? 0)));
    return scaleFromWeak(shown - strong, shown, 'exploit_counters');
  }
  return empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.riverBluffShare, 'pool_prior');
}

/**
 * Empirical-Bayes estimator for street-specific opponent `betWhenCheckedTo` (`hs-persona` trap & line range).
 * Uses measured street-specific NLH priors (flop 33.5%, turn 39.0%, river 31.3%) instead of one pooled rate.
 */
export function estimateHoldemBetWhenCheckedTo(
  street: HoldemEmpiricalStreet,
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'betCheckedTo' | 'betCheckedToOpp'> | null
): EmpiricalShrinkEstimate {
  const prior = HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO[street].rate;
  const key = street === 'flop' ? 'f.betCk' : street === 'turn' ? 't.betCk' : 'r.betCk';
  const hudStat = readHudOpponentStat(hudOpp, key);
  if (hudStat) {
    return empiricalBayesShrink(
      hudStat.hits,
      hudStat.opportunities,
      prior,
      HOLDEM_PRIOR_STRENGTH.betWhenCheckedTo,
      'hud_street'
    );
  }
  if (exploitCounters && exploitCounters.betCheckedToOpp > 0) {
    return empiricalBayesShrink(
      exploitCounters.betCheckedTo,
      exploitCounters.betCheckedToOpp,
      prior,
      HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
      'exploit_counters'
    );
  }
  return empiricalBayesShrink(0, 0, prior, HOLDEM_PRIOR_STRENGTH.betWhenCheckedTo, 'pool_prior');
}
