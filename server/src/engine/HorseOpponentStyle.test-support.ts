/**
 * Synthetic opponents for the style read tests (2026-11-13): counters built from
 * stated rates, so every archetype is explicit and no real player is involved.
 * Rates are chosen against the hold'em full-ring Horse envelope (vpip 0.213,
 * pfr 0.137, three-bet 0.044 per opportunity, bet-when-checked-to 0.306).
 */
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import type { StyleTallies } from './HorseOpponentStyle.js';

export interface ProfileSpec {
  hands: number;
  vpip: number;
  pfr: number;
  threeBetOpp?: number;
  threeBet?: number;
  betCheckedToOpp?: number;
  betCheckedTo?: number;
  foldToBetOpp?: number;
  foldToBet?: number;
  /** fast window: defaults to the same rates over min(hands, 10) hands */
  fast?: { hands: number; pfr?: number; threeBetOpp?: number; threeBet?: number; betCheckedToOpp?: number; betCheckedTo?: number };
}

/** Counters from rates (a rate is a share of hands, or of the stated opportunities). */
export function counters(spec: ProfileSpec): ExploitCounters {
  const c = freshExploitCounters();
  c.hands = spec.hands;
  c.vpip = spec.hands * spec.vpip;
  c.pfr = spec.hands * spec.pfr;
  c.threeBetOpp = spec.threeBetOpp ?? 0;
  c.threeBet = spec.threeBet ?? 0;
  c.betCheckedToOpp = spec.betCheckedToOpp ?? 0;
  c.betCheckedTo = spec.betCheckedTo ?? 0;
  c.foldToBetOpp = spec.foldToBetOpp ?? 0;
  c.foldToBet = spec.foldToBet ?? 0;
  const fh = spec.fast?.hands ?? Math.min(spec.hands, 10);
  c.fHands = fh;
  c.fPfr = spec.fast?.pfr ?? fh * spec.pfr;
  c.fThreeBetOpp = spec.fast?.threeBetOpp ?? 0;
  c.fThreeBet = spec.fast?.threeBet ?? 0;
  c.fBetCheckedToOpp = spec.fast?.betCheckedToOpp ?? 0;
  c.fBetCheckedTo = spec.fast?.betCheckedTo ?? 0;
  return c;
}

export interface Archetype {
  counters: ExploitCounters;
  tallies: StyleTallies;
}

/** The reference case: a passive, value-heavy, consistently winning grinder. */
export const valueHeavyGrinder = (): Archetype => ({
  counters: counters({
    hands: 80,
    vpip: 0.13,
    pfr: 0.07,
    threeBetOpp: 20,
    threeBet: 0,
    betCheckedToOpp: 40,
    betCheckedTo: 6,
    foldToBetOpp: 30,
    foldToBet: 14,
  }),
  tallies: { hands: 400, postAggr: 60, postPassive: 100, bigBetSD: 10, bigBetSDStrong: 9, rAggr: 3, rPassive: 6 },
});

/** Raises far more than any Horse, enters most pots, bets everything. */
export const maniac = (): Archetype => ({
  counters: counters({
    hands: 80,
    vpip: 0.75,
    pfr: 0.55,
    threeBetOpp: 25,
    threeBet: 9,
    betCheckedToOpp: 40,
    betCheckedTo: 34,
    foldToBetOpp: 30,
    foldToBet: 5,
  }),
  tallies: { hands: 400, postAggr: 300, postPassive: 60, bigBetSD: 12, bigBetSDStrong: 3, rAggr: 40, rPassive: 10 },
});

/** Enters many pots and rarely bets or raises. */
export const callingStation = (): Archetype => ({
  counters: counters({
    hands: 80,
    vpip: 0.55,
    pfr: 0.05,
    threeBetOpp: 20,
    threeBet: 0,
    betCheckedToOpp: 40,
    betCheckedTo: 5,
    foldToBetOpp: 30,
    foldToBet: 6,
  }),
  tallies: { hands: 400, postAggr: 40, postPassive: 160, bigBetSD: 0, bigBetSDStrong: 0, rAggr: 2, rPassive: 10 },
});

/** A player who bets big and bluffs: big river bets shown down mostly weak. */
export const frequentBluffer = (): Archetype => ({
  counters: counters({
    hands: 80,
    vpip: 0.3,
    pfr: 0.24,
    threeBetOpp: 20,
    threeBet: 4,
    betCheckedToOpp: 40,
    betCheckedTo: 28,
    foldToBetOpp: 30,
    foldToBet: 11,
  }),
  tallies: { hands: 400, postAggr: 220, postPassive: 90, bigBetSD: 12, bigBetSDStrong: 3, rAggr: 24, rPassive: 10 },
});

/** A tight-aggressive regular: tight entry, raises and 3-bets above the Horse mean. */
export const tightAggressive = (): Archetype => ({
  counters: counters({
    hands: 80,
    vpip: 0.15,
    pfr: 0.13,
    threeBetOpp: 20,
    threeBet: 2,
    betCheckedToOpp: 40,
    betCheckedTo: 22,
    foldToBetOpp: 30,
    foldToBet: 13,
  }),
  tallies: { hands: 400, postAggr: 150, postPassive: 90, bigBetSD: 0, bigBetSDStrong: 0, rAggr: 10, rPassive: 8 },
});
