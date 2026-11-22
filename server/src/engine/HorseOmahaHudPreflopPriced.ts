/**
 * OPPONENT HUD: THE PRICED PREFLOP COMPARISON AT THE MANIAC-PRESSURE SITE (2026-11-21, lane OPPONENT-HUD; lead order
 * after the river_raise trace: the lifetime read removed the maniac-pressure width and 914 of 4,491 preflop decisions
 * turned into raises). With omahaOpponentLifetimeHud on, where the lifetime read alone would widen the Horse's preflop
 * play (the width the decayed read with the PLO presumption gives is gone), the widening stands only when the raise is
 * priced above the call and the fold on the read-adjusted response of the players left:
 *   - each opponent's response from his lifetime public counts shrunk n / (n + k) to the population prior (hudStat):
 *     an opener facing the raise folds at his fold-to-3-bet rate and continues with the top of his open range; a
 *     player not yet in folds at 1 - VPIP and continues with his VPIP range;
 *   - hero's equity against the continuing ranges (omahaReraisedEquityAgainst, the measured preflop percentile);
 *   - realization from the measured re-raised-pot table (omahaReraisedCallRealization: position, depth, players in).
 *     MEASURED 2026-11-21 (lane OPPONENT-HUD-2, CRITERIA-OPPONENT-HUD-2-MEASURED sha 3cba1dd5): a Horse's realized
 *     share of a raised pot (return minus postflop investment over the pot at the flop; 25,050 fit rows before
 *     Nov 17, 4,463 check rows Nov 18-20) shows no held-out dependence on the opponents' lifetime turn / river
 *     first-wager, raise or check-raise rates in any cell (raiser heads-up slope 0.51 +- 0.53, raiser multiway
 *     -0.13 +- 0.61, both caller cells chose no feature), so the multiplier is 1: the earlier modelled term
 *     (stab excess over 0.35) is removed and no opponent-aggression read is consumed in this price.
 * Pure: no state, no telemetry, no draw from the brain's random stream. Null when the equity cannot be sampled.
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile } from './HorseEval.js';
import { omahaReraisedEquityAgainst } from './HorseOmahaReraisedPot.js';
import { omahaReraisedCallRealization } from './HorseOmahaOopReraisedPot.js';

export const HUD_PREFLOP_EQUITY_SAMPLES = 300;

export interface HudPreflopOpponent {
  stack: number;
  bet: number;
  /** shrunk lifetime rates */
  vpip: number;
  pfr: number;
  f3bet: number;
  /** he made the last raise (the opener / raiser hero faces) */
  raised: boolean;
}
export interface HudPreflopSpot {
  hole: readonly Card[];
  dead: readonly Card[];
  pot: number;
  toCall: number;
  heroBet: number;
  stack: number;
  raiseTo: number;
  inPosition: boolean;
  canCall: boolean;
  canRaise: boolean;
  opponents: HudPreflopOpponent[];
}
export interface HudPreflopVerdict {
  action: 'fold' | 'call' | 'raise';
  evCall: number | null;
  evRaise: number | null;
  equityCall: number | null;
  equityRaise: number | null;
  foldAll: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const top = (w: number) => {
  const lo = 1 - clamp(w, 0.02, 1);
  return (h: readonly Card[]) => omahaPreflopPercentile([...h], false) >= lo;
};

export function omahaHudPreflopPriced(s: HudPreflopSpot): HudPreflopVerdict | null {
  if (!(s.pot > 0) || !(s.stack > 0) || s.opponents.length === 0) return null;
  const opps = s.opponents;
  const real = (potAfter: number, behind: number, othersIn: number) =>
    omahaReraisedCallRealization(s.inPosition, behind / Math.max(1e-9, potAfter), othersIn);
  // the call: against each opponent's present range (the raiser's open range, the others' VPIP range)
  let evCall: number | null = null;
  let equityCall: number | null = null;
  if (s.canCall || s.toCall <= 0.005) {
    // facing no bet the 'call' is the check: the same arithmetic with nothing to put in
    const call = Math.max(0, Math.min(s.toCall, s.stack));
    const eq = omahaReraisedEquityAgainst(
      s.hole,
      s.dead,
      opps.map((o) => top(o.raised ? o.pfr : o.vpip)),
      HUD_PREFLOP_EQUITY_SAMPLES
    );
    if (eq === null) return null;
    const potAfter = s.pot + call;
    const behind = Math.max(0, Math.min(s.stack - call, Math.max(...opps.map((o) => o.stack))));
    equityCall = eq;
    evCall = real(potAfter, behind, opps.length - 1) * eq * potAfter - call;
  }
  // the raise: each folds at his rate; the continuing ranges are the top of his range
  let evRaise: number | null = null;
  let equityRaise: number | null = null;
  let foldAll = 0;
  if (s.canRaise && s.raiseTo > s.heroBet + s.toCall + 0.005) {
    const invest = Math.min(s.raiseTo - s.heroBet, s.stack);
    const folds = opps.map((o) => clamp(o.raised ? o.f3bet : 1 - o.vpip, 0, 0.98));
    foldAll = folds.reduce((a, f) => a * f, 1);
    const eq = omahaReraisedEquityAgainst(
      s.hole,
      s.dead,
      opps.map((o, i) => top(o.raised ? o.pfr * (1 - folds[i]) : o.vpip)),
      HUD_PREFLOP_EQUITY_SAMPLES
    );
    if (eq === null) return null;
    const to = s.heroBet + invest;
    const matched = opps.reduce((a, o) => a + Math.max(0, Math.min(to - o.bet, o.stack)), 0);
    const potAfter = s.pot + invest + matched;
    const behind = Math.max(
      0,
      Math.min(s.stack - invest, Math.max(...opps.map((o) => o.stack - Math.max(0, to - o.bet))))
    );
    equityRaise = eq;
    evRaise =
      foldAll * s.pot +
      (1 - foldAll) * (real(potAfter, behind, opps.length - 1) * eq * potAfter - invest);
  }
  const best: [HudPreflopVerdict['action'], number][] = s.toCall > 0.005 ? [['fold', 0]] : [];
  if (evCall !== null) best.push(['call', evCall]);
  if (evRaise !== null) best.push(['raise', evRaise]);
  if (!best.length) return null;
  best.sort((a, b) => b[1] - a[1]);
  return { action: best[0][0], evCall, evRaise, equityCall, equityRaise, foldAll };
}
