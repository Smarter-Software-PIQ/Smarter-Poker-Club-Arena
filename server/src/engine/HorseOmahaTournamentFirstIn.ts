/**
 * OMAHA TOURNAMENT SHORT-HANDED FIRST-IN (owner order, Dan 2026-11-12).
 *
 * A person won the PLO4 "Dinner Break" MTT of 2026-11-12 from two big
 * blinds. The audit of every PLO tournament a person entered that week (five
 * MTTs, 3,284 hands) found the table folding to the big blind in 51 to 63
 * percent of heads-up hands, 61 to 69 percent three-handed and 17 to 28
 * percent at six or more; heads-up the small blind folded its first action
 * 47 to 71 percent of the time at every stack depth.
 *
 * Cause: the first-in bars for short-handed and short-stacked tournament
 * play are written on the Hold'em strength scale (jam bar about 0.5, blind
 * against blind limp floor 0.22) and read against the Omaha strength value,
 * whose median is 0.22. They admit about the top fifth of Omaha hands.
 *
 * This module reads the hand's true percentile among Omaha hands and decides
 * the three short-handed first-in spots and the heads-up big blind's reply
 * from it. It only ever replaces a FOLD the existing preflop engine chose:
 * every raise, call and jam of the existing engine stands.
 *
 * Every share and depth below was measured in mirrored self-play matches
 * (the same deals played once from every seat, 3,000 hands per cell, PLO4,
 * PLO5 and PLO6) against the unchanged brain; the numbers are in
 * docs/changelog/2026-11-13-omaha-tournament-first-in.md.
 */
import type { PreflopIntent, PreflopPosition } from './HorsePreflop.js';

export interface OmahaTournamentFirstInParams {
  /** True heads-up, small blind first in: share of hands played. */
  headsUpShare: number;
  /** Small blind against the big blind alone at a larger table. */
  blindVsBlindShare: number;
  /** First in from a non-blind seat, indexed by live opponents. 0 = unchanged. */
  lateShareByOpponents: readonly number[];
  /** At or below this effective stack (big blinds) the play is a pot raise. */
  raiseMaxBB: number;
  /** Heads-up big blind closing against one raise: share defended. */
  bigBlindDefendShare: number;
  /** ... and the dearest price (call / final pot) it defends at. */
  bigBlindMaxPrice: number;
}

export const OMAHA_TOURNAMENT_FIRST_IN: OmahaTournamentFirstInParams = {
  headsUpShare: 1,
  blindVsBlindShare: 1,
  lateShareByOpponents: [0, 0, 0.8],
  raiseMaxBB: 30,
  bigBlindDefendShare: 0.75,
  bigBlindMaxPrice: 0.5,
};

export interface OmahaTournamentFirstInInput {
  /** The hand's percentile among Omaha hands of its size, 0 (worst) to 1. */
  percentile: number;
  position: PreflopPosition;
  /** Opponents still holding cards. */
  liveOpponents: number;
  /** Players dealt in at the table. */
  tableSize: number;
  effectiveStackBB: number;
  raises: number;
  limpers: number;
  callers: number;
  toCall: number;
  stack: number;
  pot: number;
  bigBlind: number;
  /** The engine's tournament risk premium for this decision (0 when there is no
   *  pay jump to protect). Outside true heads-up it narrows the first-in share. */
  riskPremium: number;
}

/**
 * The replacement for a fold, or null when the fold stands. Callers apply it
 * only to Omaha high tournaments and only when the existing engine folded.
 */
export function omahaTournamentFirstIn(
  i: OmahaTournamentFirstInInput,
  p: OmahaTournamentFirstInParams = OMAHA_TOURNAMENT_FIRST_IN
): PreflopIntent | null {
  if (!(i.toCall > 0) || !Number.isFinite(i.percentile)) return null;
  // Heads-up there is no pay jump left to protect. With more players the
  // engine's own risk premium narrows the share: two points of range for each
  // point of premium, never more than half the range.
  const headsUp = i.tableSize <= 2;
  const narrowed = headsUp ? 0 : Math.min(0.5, Math.max(0, i.riskPremium) * 2);
  const plays = (share: number) => share > 0 && i.percentile >= 1 - (share - narrowed);
  const bb = i.bigBlind > 0 ? i.bigBlind : 1;
  if (i.raises === 0 && i.limpers === 0) {
    if (i.position === 'sb' && i.liveOpponents === 1) {
      const share = headsUp ? p.headsUpShare : p.blindVsBlindShare;
      if (!plays(share)) return null;
      return i.effectiveStackBB <= p.raiseMaxBB ? { a: 'jam' } : { a: 'call' };
    }
    if (i.position !== 'sb' && i.position !== 'bb') {
      if (!plays(p.lateShareByOpponents[i.liveOpponents] ?? 0)) return null;
      return i.effectiveStackBB <= p.raiseMaxBB ? { a: 'jam' } : { a: 'raiseTo', to: 2.5 * bb };
    }
    return null;
  }
  if (
    i.position === 'bb' &&
    headsUp &&
    i.raises === 1 &&
    i.callers === 0 &&
    i.liveOpponents === 1
  ) {
    const call = Math.min(i.toCall, i.stack);
    const price = call / (i.pot + call);
    if (price <= p.bigBlindMaxPrice && plays(p.bigBlindDefendShare))
      return i.toCall >= i.stack * 0.4 ? { a: 'jam' } : { a: 'call' };
  }
  return null;
}
