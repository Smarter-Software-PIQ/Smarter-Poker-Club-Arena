/**
 * THE FLOP PRESSURE CAP, PRICED (omahaFlopPressureCapIsPriced; PLO-OWNER lead-7 2026-11-26; default OFF, read
 * `=== true`). Pure: no telemetry, no opponent memory of its own (the caller passes the bettor's record), no draw from
 * the brain's random stream.
 *
 * WHY. Heads-up on the PLO4/PLO5 cash flop, facing one bet over 0.8 pot, Horses fold 72.9% where people fold 49.4%
 * (plo-lead7 plo4-audit, n 144 / 81). The replay of the 445 audited heads-up flop facing-bet decisions on the live
 * switch rows puts 75 of 76 of those folds against people on the reference brain's call-or-fold check (receipt
 * v38_ev_fold), with the V40 Omaha pressure cap (v40_omaha_pressure_cap) cutting the equity in 53 of them. That cap
 * is a fixed ceiling per made-hand class (one pair or air 0.28, board two pair 0.30, low two pair 0.32 / 0.36, top
 * two 0.34 / 0.50, weak trips 0.50, a set 0.62, lowered 0.05 per extra pressure signal, lifted 0.10 on the flop): a
 * number per class, not an equity against the range that bet.
 *
 * WHAT IT DOES. In exactly the spots where that cap is evaluated (the same gate: a weak made class under pressure),
 * and only there: PLO4/PLO5 cash (one board, high only, no bomb pot; table and Lightning), the FLOP, HEADS-UP,
 * facing a single bet (not a raise), the equity the reference brain's call-or-fold check reads is the Horse's
 * equity against the bettor's range instead of the capped number:
 *   range   his value region (the strongest OMAHA_FLOP_EV_VALUE_SHARE x line of holdings on the flop: the flop
 *           verdict's own spot, HorseOmahaFlopFacingBetEv.omahaFlopFacingBetEvSpot) plus a share q of every other
 *           holding;
 *   q       the PEOPLE-ONLY measured flop share for this size (HorseOmahaFacingBetPeoplePrior.omahaFlopPeoplePriorShare:
 *           people's shown flop bets in the same value unit, blended toward the balanced share for the price at 30
 *           pseudo-bets), moved by HIS own shown flop bets where he has them (HorseOmahaBetRead's per-opponent cell);
 *   equity  (1 - q) x his share against the value region + q x his share against the rest, at showdown over two-card
 *           runouts, sampled by the flop verdict's own deterministic count (omahaFlopEvCounts, seed from the cards).
 * The check itself is unchanged: the same realization, rake, margin and read shift act on this equity. The number
 * read is min(equity before the cap, priced equity): it replaces the ceiling, never lifts the hand above its own
 * Monte Carlo read. Every other consumer of the capped equity (raise bars, the draw raise, later streets) reads the
 * cap exactly as before, so the option only changes a call into a fold or a fold into a call; a draw that the check
 * would price as a raise (comboRaise38) is left alone.
 *
 * Identity never enters: the same arithmetic for every bettor; only the population data is people-only.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaFlopEvCounts,
  omahaFlopFacingBetEvSpot,
  type OmahaFlopFacingBetEvSpot,
} from './HorseOmahaFlopFacingBetEv.js';
import {
  omahaFlopPeoplePriorShare,
  type OmahaPeoplePriorShare,
} from './HorseOmahaFacingBetPeoplePrior.js';

/**
 * River cards sampled per turn card of the flop count (the verdict's own count samples 12 heads-up). Measured on the
 * 445 audited heads-up flop decisions (flop-pp/BUILD.md, speed): 12 rivers p95 9.9 ms per count, 6 rivers 5.2 ms with
 * a mean equity difference from 12 of 0.012 (max 0.051), 3 rivers 2.9 ms with 0.017 (max 0.066). 6 keeps the whole
 * decision inside the live speed limit and the equity within about a point of the full count.
 */
export const OMAHA_FLOP_PRESSURE_CAP_RIVERS = 6;

/** The made classes the V40 pressure cap prices (HorseLogic, `switch (made40.cls)`). */
export const OMAHA_FLOP_PRESSURE_CAP_CLASSES: ReadonlySet<string> = new Set([
  'air',
  'pair',
  'board2p',
  'low2p',
  'top2p',
  'weaktrips',
  'set',
]);

/** The V40 gate, as HorseLogic reads it heads-up with no raise behind the Horse's bet: an extra pressure signal or a bet of 0.6 pot. */
export function omahaFlopPressureCapGate(g: {
  barrels: number;
  potFrac: number;
  pressure: number;
  cls: string | null | undefined;
  weak: boolean;
}): boolean {
  if (!g.weak || !g.cls || !OMAHA_FLOP_PRESSURE_CAP_CLASSES.has(g.cls)) return false;
  const heat = g.barrels + (g.potFrac >= 0.85 ? 1 : 0) + g.pressure;
  return heat >= 1 || g.potFrac >= 0.6;
}

/**
 * The spot, or null outside it: the flop verdict's own spot (PLO4/PLO5 cash, one board, high only, no bomb pot,
 * not all-in-or-fold, wagers not capped, facing a wager with fold and call legal), heads-up, a single bet.
 */
export function omahaFlopPressureCapPricedSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaFlopFacingBetEvSpot | null {
  const n = (player.cards ?? []).length;
  if (n !== 4 && n !== 5) return null;
  const spot = omahaFlopFacingBetEvSpot(player, gs);
  if (!spot || spot.isRaise) return null;
  if (spot.callers + spot.allIns + spot.behind !== 0) return null;
  return spot;
}

export interface OmahaFlopPressureCapPricedEquity {
  /** the equity against his range (showdown share, ties halved) */
  equity: number;
  /** the non-value share priced, and how it was built */
  prior: OmahaPeoplePriorShare;
  /** the value region sampled, and the shares against it and against the rest */
  valueShare: number;
  vsValue: number;
  vsOther: number;
}

/** The Horse's equity against the bettor's range on this flop: null when it cannot be priced. */
export function omahaFlopPressureCapPricedEquity(
  spot: OmahaFlopFacingBetEvSpot,
  hole: Card[],
  board: Card[],
  dead: Card[],
  rake: number,
  record: { shown: number; value: number } | null
): OmahaFlopPressureCapPricedEquity | null {
  const prior = omahaFlopPeoplePriorShare({
    potFrac: spot.potFrac,
    isRaise: false,
    multiway: false,
    paid: spot.paid,
    winnable: spot.winnable,
    rake,
    final: spot.final,
    record,
  });
  if (!prior) return null;
  const counts = omahaFlopEvCounts(
    hole,
    board,
    dead,
    spot.valueShare,
    undefined,
    0,
    OMAHA_FLOP_PRESSURE_CAP_RIVERS
  );
  if (!counts) return null;
  const vsValue = counts.value.win + counts.value.tie / 2;
  const vsOther = counts.other.win + counts.other.tie / 2;
  const q = prior.share;
  const equity = (1 - q) * vsValue + q * vsOther;
  if (!Number.isFinite(equity)) return null;
  return {
    equity: Math.max(0, Math.min(1, equity)),
    prior,
    valueShare: counts.valueShare,
    vsValue,
    vsOther,
  };
}
