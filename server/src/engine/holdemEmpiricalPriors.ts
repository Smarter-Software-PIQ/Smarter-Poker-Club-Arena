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
 *   3. `OpponentHudStore` indexes `HUD_FAMILIES = ['plo4', 'plo5', 'nlh']` (#11680, #11722),
 *      while individual opponents or fresh NLH pools may still have sparse or zero HUD samples.
 *      Every estimator here reads `HudPacketOpponent` counts smoothly when available, optionally
 *      falls back to `ExploitCounters` where semantically valid, and degrades 100% cleanly to the
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
 * Compute the villain's TRUE pot-odds price when facing hero's raise to `heroRaiseTo`,
 * capping both hero's raise and villain's call to effective stacks so uncalled excess
 * chips from either side never distort the contested pot:
 *   actualRaiseTo     = min(heroRaiseTo, heroIn + max(0, heroStack))
 *   villainCall       = max(0, min(actualRaiseTo - villainIn, max(0, villainStack)))
 *   matchedHeroAdd    = max(0, min(max(0, heroStack), villainIn + villainCall - heroIn))
 *   potAfterHeroRaise = max(0, potBeforeRaise) + matchedHeroAdd
 *   price             = villainCall / (potAfterHeroRaise + villainCall)
 *
 * Fixes the raise-pricing bias in `wagerValue` (which passes hero's `add` against `pot` instead
 * of villain's incremental call against `pot + matchedHeroAdd`).
 */
export function holdemVillainRaiseCallPrice(
  potBeforeRaise: number,
  heroRaiseTo: number,
  heroIn: number,
  villainIn: number,
  heroStack: number,
  villainStack: number
): number {
  const actualRaiseTo = Math.min(heroRaiseTo, heroIn + Math.max(0, heroStack));
  const villainCall = Math.max(0, Math.min(actualRaiseTo - villainIn, Math.max(0, villainStack)));
  const matchedHeroAdd = Math.max(
    0,
    Math.min(Math.max(0, heroStack), villainIn + villainCall - heroIn)
  );
  const potAfterHeroRaise = Math.max(0, potBeforeRaise) + matchedHeroAdd;
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

// ---------------------------------------------------------------------------
// WAVE 5.4 ADDITIVE EXPORTS: NLH FLOP/TURN/RIVER FOLD-TO-RAISE PRIORS,
// VILLAIN RAISE-CONTINUING RANGE EQUITY CONDITIONING, AND RAISE EV PRICING.
// 100% additive; zero changes to any existing export or live default-ON path.
// ---------------------------------------------------------------------------

export type HoldemRaisePriorSource = HoldemPriorSource | 'opponent_sample';

export interface HoldemStreetFoldToRaiseCell {
  /** Reference fold-to-raise probability (HU, 3x raise / 0.75x pot, SPR 6, uncommitted). */
  readonly baseFoldRate: number;
  /** Reference villain 3-bet/reraise response probability on this street. */
  readonly baseReraiseRate: number;
  /** Default Beta-Binomial prior strength k for opponent sample shrinkage. */
  readonly priorStrength: number;
  /** Provenance / empirical anchor description. */
  readonly derivation: string;
}

export interface HoldemFoldToRaiseOpponentSample {
  readonly folds: number;
  readonly opportunities: number;
}

export interface HoldemFoldToRaisePriorParams {
  readonly street: HoldemEmpiricalStreet;
  /** Raise-to-bet ratio (`raiseTo / villainBet`, reference = 3.0). */
  readonly raiseToBetRatio?: number;
  /** Raise-to-pot ratio (`heroAdded / potBeforeRaise`, reference = 0.75). */
  readonly raiseToPotRatio?: number;
  /** Active opponents in the pot facing hero's raise (1 = heads-up, 2 = 3-way, ...). Default 1. */
  readonly opponentsInPot?: number;
  /** Effective stack-to-pot ratio before hero's raise (higher = deeper, less committed; reference = 6.0). */
  readonly spr?: number;
  /** Optional villain commitment factor in [0, 1] (0 = uncommitted, 1 = fully pot-committed). */
  readonly commitmentFactor?: number;
  /** Whether hero's raise is an all-in jam (empirically called substantially more often than non-all-in raises). */
  readonly isAllInRaise?: boolean;
  /** Optional public fold-to-raise sample for the bettor (strictly action counts; zero hole cards). */
  readonly opponentSample?: HoldemFoldToRaiseOpponentSample | null;
  /** Optional OpponentHud packet (`f.fRaise` / `t.fRaise` / `r.fRaise`, fallback `f/t/r.fBet`). */
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional Bayesian Beta-Binomial prior strength k override (> 0). */
  readonly priorStrength?: number;
}

export interface HoldemFoldToRaisePriorEstimate {
  /** Posterior effective probability that all active opponents fold to hero's raise, in [0, 1]. */
  readonly mean: number;
  /** Empirical NLH pool prior (after street, raise-size, SPR, commitment, and multiway adjustments). */
  readonly prior: number;
  /** Bettor-specific fold prior before multiplying by extra multiway opponents' fold retention. */
  readonly bettorPrior: number;
  /** Bettor-specific posterior fold probability before multiplying by extra multiway opponents' fold retention. */
  readonly bettorMean: number;
  /** Multiway retention factor `extraOpponentFoldRetention^(opponentsInPot - 1)` in (0, 1]. */
  readonly multiwayRetention: number;
  /** Empirical-Bayes shrinkage weight `n / (n + k)` in [0, 1]. 0 when no opponent data. */
  readonly weight: number;
  /** Effective opponent sample size contributing to the posterior. */
  readonly effectiveN: number;
  /** Prior pseudo-observation count k used for Beta-Binomial shrinkage. */
  readonly priorStrength: number;
  /** Which public evidence tier supplied opponent counts (or 'pool_prior' when none). */
  readonly source: HoldemRaisePriorSource;
}

export interface HoldemEquityConditioningOptions {
  /** Optional street selecting default truncation sharpness (flop 0.65 < turn 0.85 < river 1.0). */
  readonly street?: HoldemEmpiricalStreet;
  /** Explicit positive sharpness override (> 0). Higher = stronger adverse selection when called. */
  readonly sharpness?: number;
  /**
   * 'smooth' (default): exact Bayes power-law continuation kernel `e^(1 + kappa * f / (1 - f))`.
   * 'sharp': deterministic river range truncation `max(0, (e - f) / (1 - f))`.
   */
  readonly mode?: 'smooth' | 'sharp';
}

export interface HoldemVillainReraiseResponse {
  /** Unconditional probability villain 3-bets/jams over hero's raise, clamped to [0, 1 - foldToRaiseProb]. */
  readonly reraiseProb: number;
  /** Additional chips hero must call if villain 3-bets/jams (omit or <= 0 to assume hero folds to 3-bet). */
  readonly reraiseToCall?: number;
  /** Final showdown pot if hero calls villain's 3-bet/jam (defaults to `finalPot + 2 * reraiseToCall`). */
  readonly potAfterReraiseCall?: number;
  /** Optional explicit equity vs villain's 3-bet/jam range (defaults to conditioned top `reraiseProb` slice). */
  readonly eqVsReraise?: number;
  /** Force hero to fold vs 3-bet (`EV = -effectiveHeroAdded`) even if `reraiseToCall` is provided. */
  readonly assumeFoldToReraise?: boolean;
}

export interface HoldemRaiseEvParams {
  /** Total pot currently in the middle before hero acts, including villain's bet. */
  readonly pot: number;
  /** Additional chips hero must put in to call villain's bet. */
  readonly toCall: number;
  /** Additional chips hero puts in to raise (for a call-equivalent boundary test, `heroAdded === toCall`). */
  readonly heroAdded: number;
  /** Hero's unconditioned showdown equity in [0, 1] against villain's betting range. */
  readonly rawEquity: number;
  /** Additional chips villain puts in to call hero's raise (defaults to `Math.max(0, heroAdded - toCall)`). */
  readonly villainCall?: number;
  /** Rake / fee deduction fraction in [0, 1). Default 0. */
  readonly rakeFraction?: number;
  /** Explicit fold-to-raise probability in [0, 1]. When omitted, derived from `priorParams` (or 0 if absent). */
  readonly foldToRaiseProb?: number;
  /** Optional parameters passed to `estimateHoldemFoldToRaisePrior` when `foldToRaiseProb` is omitted. */
  readonly priorParams?: HoldemFoldToRaisePriorParams;
  /** Options passed to `conditionEquityAgainstRaiseCallRange`. Defaults `street` from `priorParams?.street`. */
  readonly equityConditioning?: HoldemEquityConditioningOptions;
  /** Optional explicit conditioned equity when called (e.g. from exact combo enumeration), clamped to [0, 1]. */
  readonly eqWhenCalledOverride?: number;
  /** Optional villain 3-bet / jam response term. When omitted or `reraiseProb === 0`, uses pure fold/call EV. */
  readonly reraiseResponse?: HoldemVillainReraiseResponse | null;
}

export interface HoldemRaiseEvResult {
  readonly evFold: number;
  readonly evCall: number;
  readonly evRaise: number;
  readonly bestAction: 'fold' | 'call' | 'raise';
  readonly raiseEdgeOverBestPassive: number;
  readonly foldToRaiseProb: number;
  readonly callProb: number;
  readonly reraiseProb: number;
  readonly eqWhenCalled: number;
  readonly eqVsReraise: number | null;
  readonly evOnReraise: number | null;
  readonly effectiveHeroAdded: number;
  readonly villainCall: number;
  readonly finalPot: number;
  readonly foldPriorEstimate: HoldemFoldToRaisePriorEstimate | null;
}

function logit(p: number): number {
  const c = Math.max(EPS, Math.min(1 - EPS, p));
  return Math.log(c / (1 - c));
}

function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/**
 * Street-specific NLH fold-to-raise empirical priors at reference geometry
 * (heads-up, 3x raise / 0.75x pot raise, SPR = 6, uncommitted).
 *
 * Anchored to production NLH measurements already recorded in this repository:
 *   - River (`266 / 495 = 0.5374`, reraise `24 / 495 = 0.0485`): exact `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise`
 *     (2026-11-21, 72h all-NLH + 30d has_human, n = 495). Zero draws remain -> highest non-committed fold rate.
 *   - Turn (`0.44`, reraise `0.08`): anchored to 30d NLH cash mid-price raise response `24 / 55 = 0.4364`
 *     (`HOLDEM_RAISE_FOLD_SHARE_BY_PRICE` in `HorseHoldemCommittedPricing.ts`, 2026-11-19). One card to come.
 *   - Flop (`0.36`, reraise `0.11`): conservative shrinkage below 30d NLH pooled postflop raise fold rate
 *     `52 / 124 = 0.4194` because two cards remain and bettors continue widely with draws, pairs, and floats.
 *
 * Strictly ordered: `flop (0.36) < turn (0.44) < river (0.5374)`.
 */
export const HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE: Readonly<
  Record<HoldemEmpiricalStreet, HoldemStreetFoldToRaiseCell>
> = Object.freeze({
  flop: Object.freeze({
    baseFoldRate: 0.36,
    baseReraiseRate: 0.11,
    priorStrength: 14,
    derivation:
      'Conservative NLH flop fold-to-raise prior below 30d pooled postflop human rate (52/124 = 0.4194); 2 cards to come -> widest draw/pair peel share',
  }),
  turn: Object.freeze({
    baseFoldRate: 0.44,
    baseReraiseRate: 0.08,
    priorStrength: 14,
    derivation:
      'Anchored to 30d NLH mid-price (0.20-0.30) raise fold rate (24/55 = 0.4364, HorseHoldemCommittedPricing.ts); 1 card to come',
  }),
  river: Object.freeze({
    baseFoldRate: HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise.foldRate,
    baseReraiseRate: HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise.reraiseRate,
    priorStrength: HOLDEM_PRIOR_STRENGTH.riverFoldToRaise,
    derivation:
      'Exact HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise (266/495 = 0.5374, 72h all-NLH + 30d has_human); 0 cards to come',
  }),
});

/**
 * Calibrated log-odds elasticity and multiway retention constants for `estimateHoldemFoldToRaisePrior`.
 * Chosen so that:
 *   - Reference geometry (3x raise, 0.75x pot, SPR 6, HU, uncommitted) reproduces the exact street base rate.
 *   - River all-in jam without explicit SPR reproduces `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate` (88/294 = 0.2993).
 *   - River at committed SPR = 0.5 lands at ~0.296 (matching measured all-in jam fold rate 0.2993).
 *   - Every continuous axis (`raiseToBetRatio`, `raiseToPotRatio`, `spr`, `commitmentFactor`, `opponentsInPot`) is strictly monotonic.
 */
export const HOLDEM_RAISE_PRIOR_MODEL_PARAMS = Object.freeze({
  referenceRaiseToBet: 3.0,
  referenceRaiseToPot: 0.75,
  referenceSpr: 6.0,
  raiseToBetLogitWeight: 0.35,
  raiseToPotLogitWeight: 0.45,
  sprLogitWeight: 0.48,
  sprLogOffset: 0.25,
  commitmentLogitWeight: -1.1,
  allInLogitShiftWithSpr: -0.5,
  allInLogitShiftUnconditioned:
    logit(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.all_in_raise.foldRate) -
    logit(HOLDEM_EMPIRICAL_RIVER_FOLD_TO_RAISE.non_allin_raise.foldRate),
  multiwayBettorTightenLogitWeight: -0.3,
  extraOpponentFoldRetention: 0.82,
});

/**
 * Default range-truncation sharpness `kappa` by street for `conditionEquityAgainstRaiseCallRange`.
 * Flop (2 cards to come) retains more live draw/out equity when called than turn (1 card) than river (0 cards).
 */
export const HOLDEM_RAISE_RANGE_TRUNCATION_SHARPNESS: Readonly<
  Record<HoldemEmpiricalStreet, number>
> = Object.freeze({
  flop: 0.65,
  turn: 0.85,
  river: 1.0,
});

/**
 * Dedicated NLH flop/turn/river fold-to-raise prior estimator with smooth log-odds adjustments
 * for raise geometry (`raiseToBetRatio`, `raiseToPotRatio`), stack commitment (`spr`,
 * `commitmentFactor`, `isAllInRaise`), multiway pot size (`opponentsInPot`), and Bayesian
 * Beta-Binomial shrinkage toward optional public opponent fold-to-raise counts.
 *
 * Strictly public-state & public-action-count only: never accepts or inspects hole cards or
 * player identities.
 */
export function estimateHoldemFoldToRaisePrior(
  params: HoldemFoldToRaisePriorParams
): HoldemFoldToRaisePriorEstimate {
  const cell = HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE[params.street];
  const cfg = HOLDEM_RAISE_PRIOR_MODEL_PARAMS;
  let z = logit(cell.baseFoldRate);

  if (
    params.raiseToBetRatio !== undefined &&
    Number.isFinite(params.raiseToBetRatio) &&
    params.raiseToBetRatio > 0
  ) {
    z +=
      cfg.raiseToBetLogitWeight *
      (Math.log(1 + params.raiseToBetRatio) - Math.log(1 + cfg.referenceRaiseToBet));
  }

  if (params.raiseToPotRatio !== undefined && Number.isFinite(params.raiseToPotRatio)) {
    const rPot = Math.max(0, params.raiseToPotRatio);
    z +=
      cfg.raiseToPotLogitWeight * (Math.log(0.5 + rPot) - Math.log(0.5 + cfg.referenceRaiseToPot));
  }

  const hasSpr = params.spr !== undefined && Number.isFinite(params.spr);
  if (hasSpr) {
    const spr = Math.max(0, params.spr!);
    z +=
      cfg.sprLogitWeight *
      (Math.log(cfg.sprLogOffset + spr) - Math.log(cfg.sprLogOffset + cfg.referenceSpr));
  }

  const hasCommitment =
    params.commitmentFactor !== undefined && Number.isFinite(params.commitmentFactor);
  if (hasCommitment) {
    z += cfg.commitmentLogitWeight * clamp01(params.commitmentFactor!);
  }

  if (params.isAllInRaise === true) {
    z += hasSpr || hasCommitment ? cfg.allInLogitShiftWithSpr : cfg.allInLogitShiftUnconditioned;
  }

  const oppCount =
    params.opponentsInPot !== undefined && Number.isFinite(params.opponentsInPot)
      ? Math.max(1, params.opponentsInPot)
      : 1;
  const extraOpponents = oppCount - 1;
  if (extraOpponents > 0) {
    z += cfg.multiwayBettorTightenLogitWeight * Math.log(1 + extraOpponents);
  }

  const bettorPrior = clamp01(sigmoid(z));
  const multiwayRetention =
    extraOpponents > 0 ? Math.pow(cfg.extraOpponentFoldRetention, extraOpponents) : 1;
  const prior = clamp01(bettorPrior * multiwayRetention);

  const defaultK =
    params.priorStrength !== undefined &&
    Number.isFinite(params.priorStrength) &&
    params.priorStrength > 0
      ? params.priorStrength
      : cell.priorStrength;

  const finalize = (
    hits: number,
    opportunities: number,
    k: number,
    source: HoldemRaisePriorSource
  ): HoldemFoldToRaisePriorEstimate => {
    const n = Number.isFinite(opportunities) && opportunities > 0 ? opportunities : 0;
    if (!(n > 0)) {
      return {
        mean: prior,
        prior,
        bettorPrior,
        bettorMean: bettorPrior,
        multiwayRetention,
        weight: 0,
        effectiveN: 0,
        priorStrength: k,
        source: 'pool_prior',
      };
    }
    const h = Number.isFinite(hits) ? Math.max(0, Math.min(n, hits)) : 0;
    const weight = n / (n + k);
    const bettorMean = clamp01((h + k * bettorPrior) / (n + k));
    const mean = clamp01(bettorMean * multiwayRetention);
    return {
      mean,
      prior,
      bettorPrior,
      bettorMean,
      multiwayRetention,
      weight,
      effectiveN: n,
      priorStrength: k,
      source,
    };
  };

  if (
    params.opponentSample &&
    Number.isFinite(params.opponentSample.opportunities) &&
    params.opponentSample.opportunities > 0
  ) {
    return finalize(
      params.opponentSample.folds,
      params.opponentSample.opportunities,
      defaultK,
      'opponent_sample'
    );
  }

  const prefix = params.street === 'flop' ? 'f' : params.street === 'turn' ? 't' : 'r';
  const hudRaise = readHudOpponentStat(params.hudOpp, `${prefix}.fRaise`);
  if (hudRaise) {
    return finalize(hudRaise.hits, hudRaise.opportunities, defaultK, 'hud_context');
  }

  const hudBet = readHudOpponentStat(params.hudOpp, `${prefix}.fBet`);
  if (hudBet) {
    // Attenuate first-bet fold counts (doubled k) because facing a raise is stickier than a first bet.
    return finalize(hudBet.hits, hudBet.opportunities, defaultK * 2, 'hud_street');
  }

  return finalize(0, 0, defaultK, 'pool_prior');
}

/**
 * Condition hero's raw showdown equity (`rawEquity` vs villain's betting range) on villain
 * continuing (calling or 3-betting) after folding their weakest `foldToRaiseProb` fraction.
 *
 * Derivation (exact Bayes power-law continuation model, mode = 'smooth'):
 *   Model villain's betting range strength as `U ~ Uniform(0, 1)` where hero beats `U < e`.
 *   Villain continues with hand strength `u` at smooth monotone rate `c(u) = u^gamma` with
 *   `gamma = f / (1 - f)`, yielding exact continuation share `integral_0^1 u^gamma du = 1 - f`.
 *   By Bayes' rule, hero's equity when villain continues is:
 *     `P(U < e | continue) = e^(1 + kappa * f / (1 - f))`
 *   where `kappa > 0` (`sharpness`, default 1.0 or street-specific `flop 0.65 < turn 0.85 < river 1.0`)
 *   captures how tightly villain's fold decision correlates with final river showdown ordering.
 *
 * Optional `mode = 'sharp'` applies exact deterministic truncation `max(0, (e - f) / (1 - f))`.
 *
 * Invariants guaranteed across both modes:
 *   - Bounded in `[0, 1]`, finite for all inputs.
 *   - Exact boundaries: `f = 0 => rawEquity`, `rawEquity = 0 => 0`, `rawEquity = 1 => 1`.
 *   - Strictly `< rawEquity` for every interior `f in (0, 1)` and `rawEquity in (0, 1)`.
 *   - Monotonically non-increasing (strictly decreasing on smooth interior) in `foldToRaiseProb`.
 *   - Monotonically increasing in `rawEquity`.
 */
export function conditionEquityAgainstRaiseCallRange(
  rawEquity: number,
  foldToRaiseProb: number,
  opts?: HoldemEquityConditioningOptions
): number {
  const e = clamp01(rawEquity);
  if (e <= 0) return 0;
  if (e >= 1) return 1;
  const f = clamp01(foldToRaiseProb);
  if (f <= 0) return e;
  if (f >= 1) return 0;

  if (opts?.mode === 'sharp') {
    return clamp01((e - f) / (1 - f));
  }

  const kappa =
    opts?.sharpness !== undefined && Number.isFinite(opts.sharpness) && opts.sharpness > 0
      ? opts.sharpness
      : opts?.street
        ? HOLDEM_RAISE_RANGE_TRUNCATION_SHARPNESS[opts.street]
        : 1.0;

  const exponent = 1 + kappa * (f / (1 - f));
  return clamp01(Math.pow(e, exponent));
}

/**
 * Reusable Hold'em raise EV pricer comparing `EV(raise)`, `EV(call)`, and `EV(fold) = 0`
 * using villain fold-to-raise priors and conditioned continuing-range equity.
 *
 * Base algebraic identity (zero reraise response, rake `r`, `keep = 1 - r`):
 *   `EV(fold)  = 0`
 *   `EV(call)  = rawEquity * (pot + toCall) * keep - toCall`
 *   `EV(raise) = f * pot * keep + (1 - f) * (eqWhenCalled * finalPot * keep - effectiveHeroAdded)`
 * where `villainCall = params.villainCall ?? Math.max(0, heroAdded - toCall)`,
 * `effectiveHeroAdded = toCall + villainCall`, and `finalPot = pot + effectiveHeroAdded + villainCall`.
 *
 * When `reraiseResponse` is provided with `r3 = clamp(reraiseProb, 0, 1 - f) > 0`:
 *   `callProb = 1 - f - r3`
 *   `EV(raise) = f * pot * keep + callProb * (eqWhenCalled * finalPot * keep - effectiveHeroAdded) + r3 * EV(vs 3-bet)`
 * where `EV(vs 3-bet) = max(-effectiveHeroAdded, eqVsReraise * potAfterReraiseCall * keep - (effectiveHeroAdded + reraiseToCall))`
 * (or `-effectiveHeroAdded` when hero folds to a 3-bet / `reraiseToCall` is omitted).
 */
export function priceHoldemRaiseEv(params: HoldemRaiseEvParams): HoldemRaiseEvResult {
  const pot = Number.isFinite(params.pot) ? Math.max(0, params.pot) : 0;
  const toCall = Number.isFinite(params.toCall) ? Math.max(0, params.toCall) : 0;
  const heroAddedRaw = Number.isFinite(params.heroAdded) ? Math.max(0, params.heroAdded) : 0;
  const e = clamp01(params.rawEquity);
  const keep = 1 - clamp01(params.rakeFraction ?? 0);

  const inferredVillainCall = Math.max(0, heroAddedRaw - toCall);
  const villainCall =
    params.villainCall !== undefined && Number.isFinite(params.villainCall)
      ? Math.max(0, params.villainCall)
      : inferredVillainCall;
  // Uncalled excess above `toCall + villainCall` is returned to hero when villain is short-stacked.
  const effectiveHeroAdded = Math.min(heroAddedRaw, toCall + villainCall);
  const finalPot = pot + effectiveHeroAdded + villainCall;

  let foldPriorEstimate: HoldemFoldToRaisePriorEstimate | null = null;
  let f: number;
  if (params.foldToRaiseProb !== undefined && Number.isFinite(params.foldToRaiseProb)) {
    f = clamp01(params.foldToRaiseProb);
  } else if (params.priorParams) {
    foldPriorEstimate = estimateHoldemFoldToRaisePrior(params.priorParams);
    f = foldPriorEstimate.mean;
  } else {
    f = 0;
  }

  const conditioningOpts: HoldemEquityConditioningOptions | undefined =
    params.equityConditioning ??
    (params.priorParams ? { street: params.priorParams.street } : undefined);

  const eqWhenCalled =
    params.eqWhenCalledOverride !== undefined && Number.isFinite(params.eqWhenCalledOverride)
      ? clamp01(params.eqWhenCalledOverride)
      : conditionEquityAgainstRaiseCallRange(e, f, conditioningOpts);

  const evFold = 0;
  const evCall = e * (pot + toCall) * keep - toCall;

  const reraiseSpec = params.reraiseResponse;
  const r3 =
    reraiseSpec && Number.isFinite(reraiseSpec.reraiseProb)
      ? Math.min(1 - f, clamp01(reraiseSpec.reraiseProb))
      : 0;
  const callProb = Math.max(0, 1 - f - r3);

  let eqVsReraise: number | null = null;
  let evOnReraise: number | null = null;
  if (r3 > 0 && reraiseSpec) {
    eqVsReraise =
      reraiseSpec.eqVsReraise !== undefined && Number.isFinite(reraiseSpec.eqVsReraise)
        ? clamp01(reraiseSpec.eqVsReraise)
        : conditionEquityAgainstRaiseCallRange(e, 1 - r3, conditioningOpts);

    const evFoldVsReraise = -effectiveHeroAdded;
    if (
      !reraiseSpec.assumeFoldToReraise &&
      reraiseSpec.reraiseToCall !== undefined &&
      Number.isFinite(reraiseSpec.reraiseToCall) &&
      reraiseSpec.reraiseToCall > 0
    ) {
      const reraiseToCall = reraiseSpec.reraiseToCall;
      const potAfterReraiseCall =
        reraiseSpec.potAfterReraiseCall !== undefined &&
        Number.isFinite(reraiseSpec.potAfterReraiseCall) &&
        reraiseSpec.potAfterReraiseCall > 0
          ? reraiseSpec.potAfterReraiseCall
          : finalPot + 2 * reraiseToCall;
      const evCallVsReraise =
        eqVsReraise * potAfterReraiseCall * keep - (effectiveHeroAdded + reraiseToCall);
      evOnReraise = Math.max(evFoldVsReraise, evCallVsReraise);
    } else {
      evOnReraise = evFoldVsReraise;
    }
  }

  const evWhenCalled = eqWhenCalled * finalPot * keep - effectiveHeroAdded;
  const evRaise =
    f * pot * keep +
    callProb * evWhenCalled +
    (r3 > 0 && evOnReraise !== null ? r3 * evOnReraise : 0);

  const bestPassive = Math.max(evFold, evCall);
  const raiseEdgeOverBestPassive = evRaise - bestPassive;
  const bestAction: HoldemRaiseEvResult['bestAction'] =
    evRaise > bestPassive ? 'raise' : evCall > evFold ? 'call' : 'fold';

  return {
    evFold,
    evCall,
    evRaise,
    bestAction,
    raiseEdgeOverBestPassive,
    foldToRaiseProb: f,
    callProb,
    reraiseProb: r3,
    eqWhenCalled,
    eqVsReraise,
    evOnReraise,
    effectiveHeroAdded,
    villainCall,
    finalPot,
    foldPriorEstimate,
  };
}
