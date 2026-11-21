/**
 * OMAHA RIVER CHECKED-TO BET IS MEASURED (EMERG lane OFFENCE-BUILD, PLO-OWNER lead-2, 2026-11-20; option
 * omahaRiverCheckedToBetIsMeasured, default OFF, read `=== true`; scopable per game with horse.omahaGameScope).
 *
 * Replaces, in its heads-up river spot, the kind-keyed omahaCheckedToBetIsPriced family (it read the opponent's KIND in
 * the decision: HorseOmahaCheckedToBet.ts showdown fit and prior read; retired by OFFENCE-BUILD 2026-11-20). Same machinery
 * as HorseOmahaRiverFirstToActBet.ts (graded PASS), applied where the opponent CHECKED the river heads-up and the Horse
 * closes the action.
 *
 * THE MEASUREMENT (OFFENCE-BUILD.md step 2; hands with a person seated, Nov 13-17, every player pooled, no responder above
 * 20% of a cell): a heads-up river bet made after the opponent checked is folded to 54% at about a quarter of the pot, 67%
 * at four tenths, 75% at two thirds and 87% at the pot (n 41 / 128 / 161 / 253).
 *
 *   EV(bet B) = fold x pot x (1 - rake) + call x (e x (pot + 2B) x (1 - rake) - B) - raise x B
 *     e = the lower of the model's equity against the hands that continue and its production calibration (the exact
 *     current nuts keep the model's figure).
 *   EV(check) = pot x the HIGHER of the model's showdown share and its kind-free production calibration (the check ends
 *     the hand; the model is over-confident at both ends).
 * The best bet replaces the check only when it beats it by more than the comparison's standard error. It changes only a
 * check into a bet. No identity, no hand class, no size rule; PLO6, PLO8, hold'em, tournaments, multiway pots, the flop
 * and the turn are untouched.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  omahaCardImpactScope,
  OMAHA_CARD_IMPACT_PRIOR,
  type OmahaCardImpactOption,
  type OmahaCardImpactRead,
  type OmahaCardImpactResponseCurve,
} from './HorseOmahaCardImpact.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';
import { omahaCheckedToContinueCalibrated } from './HorseOmahaCheckedToBet.js';
import { hasRiverNuts } from './HorseRiverNuts.js';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (n: number) => Math.round(n * 100) / 100;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const MODEL_ROUNDING = 0.005;

/** One measured point: at a bet of `share` of the pot, the share of answers that continue and that raise. */
export interface OmahaRiverCheckedToPoint {
  share: number;
  cont: number;
  raise: number;
  /** binomial standard error of the fold share on the cell's effective size */
  foldSe: number;
  n: number;
}

/**
 * GENERATED from the OFFENCE-BUILD measurement (work/m5.py, const-fit.json; sha256 in OMAHA_RIVER_CHECKED_TO_SOURCE_SHA256):
 * river, heads-up, the bettor acted first (out of position), first answer of the opponent; PLO4/PLO5 cash hands with a
 * person seated, fit window before 2026-11-18 00:00Z; every player pooled, responders capped at 20% of a cell; bands
 * <0.34, 0.34-0.55, 0.55-0.8, >=0.8 of the pot at centres 0.27, 0.42, 0.65, 1.0.
 */
export const OMAHA_RIVER_CHECKED_TO_SOURCE_SHA256 =
  'dd826f449ba5fc1e4d66d490a2322f9b7447d411348778b9df756004ba573739';
export const OMAHA_RIVER_CHECKED_TO_RESPONSE: Readonly<
  Record<'plo4' | 'plo5' | 'pooled', readonly OmahaRiverCheckedToPoint[]>
> = Object.freeze({
  plo4: [
    { share: 0.27, cont: 0.5789, raise: 0.1053, foldSe: 0.1133, n: 19 },
    { share: 0.42, cont: 0.3594, raise: 0.0469, foldSe: 0.06, n: 64 },
    { share: 0.65, cont: 0.2727, raise: 0.0303, foldSe: 0.0548, n: 66 },
    { share: 1.0, cont: 0.186, raise: 0.0089, foldSe: 0.0362, n: 116 },
  ],
  plo5: [
    { share: 0.27, cont: 0.3929, raise: 0.0, foldSe: 0.11, n: 20 },
    { share: 0.42, cont: 0.3209, raise: 0.0364, foldSe: 0.0601, n: 60 },
    { share: 0.65, cont: 0.2243, raise: 0.0358, foldSe: 0.0437, n: 91 },
    { share: 1.0, cont: 0.0833, raise: 0.0, foldSe: 0.024, n: 133 },
  ],
  pooled: [
    { share: 0.27, cont: 0.4634, raise: 0.0488, foldSe: 0.0779, n: 41 },
    { share: 0.42, cont: 0.3281, raise: 0.0391, foldSe: 0.0415, n: 128 },
    { share: 0.65, cont: 0.2484, raise: 0.0311, foldSe: 0.0341, n: 161 },
    { share: 1.0, cont: 0.1304, raise: 0.004, foldSe: 0.0212, n: 253 },
  ],
});
/** After the first actor checks the river heads-up, the in-position player bets this share of the time (same data). */
export const OMAHA_RIVER_CHECKED_TO_BET_CHECKED_TO = 0.4771;
/** The kind-free showdown calibration (THREEBET-POT refit of OMAHA_CHECKED_TO_SHOWDOWN_FIT on null-kind model shares). */
export const OMAHA_RIVER_CHECKED_TO_SHOWDOWN_FIT = Object.freeze({ a: -0.0983, b: 0.3552, n: 814 });
/** A variant cell is used alone when its effective size is at least this; otherwise the pooled cell. */
export const OMAHA_RIVER_CHECKED_TO_MIN_CELL = 30;

/** The curve this decision is priced with (the variant's points where measured well enough, else the pooled ones). */
export function omahaRiverCheckedToCurve(variant: string): readonly OmahaRiverCheckedToPoint[] {
  const pooled = OMAHA_RIVER_CHECKED_TO_RESPONSE.pooled;
  const own =
    variant === 'plo4' || variant === 'plo5' ? OMAHA_RIVER_CHECKED_TO_RESPONSE[variant] : [];
  return pooled.map((p) => {
    const v = own.find((x) => Math.abs(x.share - p.share) < 1e-9);
    return v && v.n >= OMAHA_RIVER_CHECKED_TO_MIN_CELL ? v : p;
  });
}

/** The fold-share error at a pot share: the nearest measured point's (flat beyond the ends). */
function foldSeAt(curve: readonly OmahaRiverCheckedToPoint[], share: number): number {
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.share - share) < Math.abs(best.share - share)) best = p;
  return best.foldSe;
}

/**
 * The opponent's answer curve for this decision. One function so that a per-opponent public read can replace it later;
 * today it is the population curve for every opponent alike.
 */
export function omahaRiverCheckedToResponseOf(
  _opponent: SeatPlayer,
  gs: HorseGameStateV2
): readonly OmahaRiverCheckedToPoint[] {
  return omahaRiverCheckedToCurve(String(gs.gameVariant ?? '').toLowerCase());
}

export interface OmahaRiverCheckedToSpot {
  opponent: SeatPlayer;
}

/** The spot, or null. Public information only. */
export function omahaRiverCheckedToSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverCheckedToSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    const scope = omahaCardImpactScope(hero, gs);
    if (!scope || scope.street !== 'river' || !scope.heroCloses) return null;
    return { opponent: scope.opponent };
  } catch {
    return null;
  }
}

export interface OmahaRiverCheckedToRow {
  action: 'bet' | 'all_in';
  amount: number;
  ev: number;
  error: number;
  fold: number;
  equity: number;
}

export interface OmahaRiverCheckedToVerdict {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  evCheck: number;
  rows: OmahaRiverCheckedToRow[];
  best: OmahaRiverCheckedToRow | null;
}

/** The comparison; `rake` is the marginal rake on the pot as a fraction. Null when a number cannot be computed. */
export function omahaRiverCheckedToBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  spot: OmahaRiverCheckedToSpot,
  rake: number,
  /** tests only: a response curve in place of the measured one */
  curveOverride?: readonly OmahaRiverCheckedToPoint[]
): OmahaRiverCheckedToVerdict | null {
  const pot = gs.pot;
  if (!fin(pot) || !(pot > 0)) return null;
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  const opp = spot.opponent;
  const curve = curveOverride ?? omahaRiverCheckedToResponseOf(opp, gs);
  if (curve.length === 0) return null;
  const amounts = omahaCardImpactAmounts(hero, opp, gs);
  if (amounts.length === 0) return null;
  const read: OmahaCardImpactRead = {
    measured: false,
    continueRate: null,
    riverCallRate: null,
    betCheckedTo: OMAHA_RIVER_CHECKED_TO_BET_CHECKED_TO,
    bluffShare: OMAHA_CARD_IMPACT_PRIOR.bluffShare,
  };
  const responseAt: OmahaCardImpactResponseCurve = curve.map((p) => ({
    share: p.share,
    cont: p.cont,
    raise: p.raise,
  }));
  const impact = omahaCardImpact({
    hole: hero.cards,
    board: gs.communityCards ?? [],
    dead: hero.knownDeadCards ?? [],
    pot,
    heroStack: hero.stack,
    oppStack: opp.stack,
    heroCloses: true,
    line: omahaCardImpactLine(hero, opp, gs),
    read,
    amounts,
    seedSalt: opp.seat * 16 + hero.seat,
    responseAt,
  });
  if (!impact) return null;
  const check = impact.options.find((o) => o.action === 'check');
  if (!check || !fin(check.ev)) return null;
  const eff = Math.max(1, impact.opp.effective);
  // The check ends the hand: its value is the showdown share. The model's share is over-confident at both ends
  // (production fit, kind-free: logit(real) = a + b logit(model), a -0.098, b 0.355, n 814 river spots; THREEBET-POT);
  // the check takes the HIGHER of the model's and the calibrated share, so it is never made to look worse than it is.
  const raw = clamp(impact.showdown, 0.005, 0.995);
  const lx = Math.log(raw / (1 - raw));
  const calShare =
    1 /
    (1 +
      Math.exp(
        -(OMAHA_RIVER_CHECKED_TO_SHOWDOWN_FIT.a + OMAHA_RIVER_CHECKED_TO_SHOWDOWN_FIT.b * lx)
      ));
  const sd = Math.max(raw, calShare);
  const evCheck = Math.max(check.ev, pot * sd);
  const checkVar = pot * pot * ((sd * (1 - sd)) / eff + MODEL_ROUNDING ** 2);
  // The exact current nuts lose to no holding: their called equity is the model's (a chop at worst), never shaded.
  const nuts = hasRiverNuts(hero, gs, false);
  const rows: OmahaRiverCheckedToRow[] = [];
  for (const o of impact.options as OmahaCardImpactOption[]) {
    if (o.action === 'check') continue;
    const a = round2(Math.min(o.amount, hero.stack));
    if (!(a > 0)) continue;
    const B = Math.min(a, opp.stack);
    const fold = clamp(o.fold, 0, 1);
    const call = clamp(o.call, 0, 1);
    const raise = clamp(o.raise, 0, 1);
    const raw = clamp(o.continueEquity, 0, 1);
    const cal = omahaCheckedToContinueCalibrated(raw, Math.max(1, eff * (call + raise)));
    const e = nuts ? raw : Math.min(raw, cal.share);
    const ev = fold * pot * (1 - r) + call * (e * (pot + 2 * B) * (1 - r) - a) - raise * a;
    // d EV / d fold: the pot won against what the call branch is worth; the fold share's error rides on it.
    const ride = Math.abs(pot * (1 - r) - (e * (pot + 2 * B) * (1 - r) - a));
    const fse = foldSeAt(curve, a / pot);
    const eVar = (raw * (1 - raw)) / Math.max(1, eff * Math.max(call + raise, 0.01)) + cal.variance;
    const variance =
      (fse * ride) ** 2 +
      (call * (pot + 2 * B) * (1 - r)) ** 2 * eVar +
      checkVar +
      3 * (MODEL_ROUNDING * (pot + 2 * B)) ** 2;
    rows.push({
      action: a >= hero.stack - 0.005 ? 'all_in' : 'bet',
      amount: a,
      ev: round2(ev),
      error: round2(Math.sqrt(variance)),
      fold: round2(fold),
      equity: round2(e),
    });
  }
  if (rows.length === 0) return null;
  let chosen: OmahaRiverCheckedToRow | null = null;
  for (const row of rows)
    if (row.ev - evCheck > row.error && (chosen === null || row.ev > chosen.ev)) chosen = row;
  return {
    action: chosen ? chosen.action : 'check',
    amount: chosen ? chosen.amount : 0,
    evCheck: round2(evCheck),
    rows,
    best: chosen,
  };
}

export interface OmahaRiverCheckedToResult {
  decision: HorseDecision;
  priced: boolean;
  changed: boolean;
  verdict?: OmahaRiverCheckedToVerdict;
}

/**
 * The option's one entry. `on` is the option (read `=== true` by the caller); `legalize` makes the bet legal (the
 * engine's own legalizer). Every decision that is not a check in the spot is returned as given (the same object).
 */
export function omahaRiverCheckedToBetRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  rake: number,
  legalize: (d: HorseDecision) => HorseDecision
): OmahaRiverCheckedToResult {
  const same: OmahaRiverCheckedToResult = { decision, priced: false, changed: false };
  if (!on || decision.action !== 'check') return same;
  try {
    const spot = omahaRiverCheckedToSpot(hero, gs);
    if (!spot) return same;
    const verdict = omahaRiverCheckedToBet(hero, gs, spot, rake);
    if (!verdict) return same;
    if (verdict.action === 'check' || !verdict.best)
      return { decision, priced: true, changed: false, verdict };
    const want: HorseDecision = { ...decision, action: verdict.action, amount: verdict.amount };
    const legal = legalize(want);
    if (legal.action !== 'bet' && legal.action !== 'all_in')
      return { decision, priced: true, changed: false, verdict };
    if (
      !fin(legal.amount) ||
      !((legal.amount as number) > 0) ||
      (legal.amount as number) > hero.stack + 0.005
    )
      return { decision, priced: true, changed: false, verdict };
    return {
      decision: { ...decision, action: legal.action, amount: legal.amount },
      priced: true,
      changed: true,
      verdict,
    };
  } catch {
    return same;
  }
}
