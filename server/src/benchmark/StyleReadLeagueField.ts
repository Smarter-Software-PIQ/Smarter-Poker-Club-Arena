/**
 * STYLE READ LEAGUE FIELD (2026-11-13): scripted opponents shaped on the human
 * label study (HUMAN-STYLE-LABELS.md, Hold'em cash aggregates of the labelled
 * cells, the DEVELOPMENT set; medians over cells with 30+ hands): loose-passive
 * (VPIP 0.56, PFR 0.11, bet when checked to 0.23), enters wide and bets
 * selectively (VPIP 0.49, PFR 0.13, bet when checked to 0.27), maniac (VPIP
 * 0.59, PFR 0.37, bet when checked to 0.33), a time-shifter that alternates
 * between the selective and the maniac gear every 200 hands, a tight-image
 * exploiter (tight value-only for 150 hands, then barrels and raises rivers
 * with air), a frequent bluffer, and two opponents that NEVER change gear
 * (2026-11-13, owner instruction that Horses tell a tight player from a
 * maniac): a tight player (the tight-image shape for good) and a value-heavy
 * passive player shaped on the audited grinder (VPIP 0.31, PFR 0.15, bets for
 * value only, raises only near the nuts). They run through ExploiterLeague's cell
 * (ExploiterCellSpec.policy) against production horses, so a style option can
 * be compared ON versus OFF on the same deals. Measurement plumbing only: no
 * production caller, no database, no writer. Draws use hashRand and equity on
 * a saved stream, so both arms see the same cards. Not tuned on: report only.
 */
import { exploiterSpotHelpers as H, type ExploiterPolicy } from './ExploiterLeague.js';
import type { LeagueSeatSpot } from './HorseLeague.js';

type D = { action: string; amount?: number };
interface Shape {
  vpip: number;
  pfr: number;
  /** postflop: bet when checked to with equity at least this, or as a bluff with this frequency */
  valueEq: number;
  bluffFreq: number;
  betFrac: number;
  /** facing a bet: fold below this equity, raise at or above raiseEq */
  foldEq: number;
  raiseEq: number;
}

function shaped(s: LeagueSeatSpot, k: Shape): D {
  if (s.stage === 'preflop') {
    const p = H.prePct(s);
    const raises = H.streetRaises(s);
    if (p >= 1 - k.pfr && raises <= 1)
      return H.wager(s, raises === 0 ? 3 * s.bigBlind : 3 * s.currentBet);
    if (s.toCall <= 0) return H.check(s);
    if (raises === 0) return p >= 1 - k.vpip ? H.call(s) : H.check(s);
    return p >= 1 - k.vpip * (raises === 1 ? 0.6 : 0.3) ? H.call(s) : H.check(s);
  }
  const eq = H.quietEquity(s);
  if (s.toCall <= 0) {
    if (eq >= k.valueEq || (eq < 0.3 && H.hashRand(s, 41) < k.bluffFreq))
      return H.potWager(s, k.betFrac);
    return H.check(s);
  }
  if (eq >= k.raiseEq) return H.potWager(s, 1);
  return eq >= k.foldEq ? H.call(s) : H.check(s);
}

const LOOSE_PASSIVE: Shape = {
  vpip: 0.56,
  pfr: 0.11,
  valueEq: 0.7,
  bluffFreq: 0.03,
  betFrac: 0.5,
  foldEq: 0.25,
  raiseEq: 0.93,
};
const WIDE_SELECTIVE: Shape = {
  vpip: 0.49,
  pfr: 0.13,
  valueEq: 0.66,
  bluffFreq: 0.05,
  betFrac: 0.66,
  foldEq: 0.38,
  raiseEq: 0.9,
};
const MANIAC: Shape = {
  vpip: 0.59,
  pfr: 0.37,
  valueEq: 0.45,
  bluffFreq: 0.45,
  betFrac: 1,
  foldEq: 0.3,
  raiseEq: 0.6,
};
const TIGHT: Shape = {
  vpip: 0.15,
  pfr: 0.12,
  valueEq: 0.72,
  bluffFreq: 0,
  betFrac: 0.75,
  foldEq: 0.45,
  raiseEq: 0.88,
};
/** The audited grinder: ordinary entry width, few raises, no bluffs, raises only near the nuts. */
const VALUE_HEAVY_PASSIVE: Shape = {
  vpip: 0.31,
  pfr: 0.15,
  valueEq: 0.72,
  bluffFreq: 0,
  betFrac: 0.75,
  foldEq: 0.42,
  raiseEq: 0.95,
};
const BLUFFER: Shape = {
  vpip: 0.3,
  pfr: 0.22,
  valueEq: 0.62,
  bluffFreq: 0.55,
  betFrac: 0.8,
  foldEq: 0.4,
  raiseEq: 0.85,
};

/** Counts hands this policy has started (its first preflop decision of a hand). */
function handClock(): (s: LeagueSeatSpot) => number {
  let hands = 0;
  return (s) => {
    if (s.stage === 'preflop' && !H.iActedThisStreet(s)) hands++;
    return hands;
  };
}

export function styleLeagueField(): Record<string, ExploiterPolicy> {
  const shiftClock = handClock();
  const imageClock = handClock();
  return {
    lp_loose_passive: (s) => shaped(s, LOOSE_PASSIVE),
    lp_wide_selective: (s) => shaped(s, WIDE_SELECTIVE),
    lp_maniac: (s) => shaped(s, MANIAC),
    lp_time_shifter: (s) =>
      shaped(s, Math.floor(shiftClock(s) / 200) % 2 === 0 ? WIDE_SELECTIVE : MANIAC),
    lp_tight_image: (s) => {
      const n = imageClock(s);
      if (n <= 150) return shaped(s, TIGHT);
      if ((s.stage === 'turn' || s.stage === 'river') && s.toCall <= 0 && H.quietEquity(s) < 0.3)
        return H.potWager(s, 0.9);
      if (s.stage === 'river' && s.toCall > 0 && H.hashRand(s, 53) < 0.35) return H.potWager(s, 1);
      return shaped(s, TIGHT);
    },
    lp_frequent_bluffer: (s) => shaped(s, BLUFFER),
    lp_tight: (s) => shaped(s, TIGHT),
    lp_value_heavy_passive: (s) => shaped(s, VALUE_HEAVY_PASSIVE),
  };
}
export const STYLE_LEAGUE_NAMES = Object.keys(styleLeagueField());
