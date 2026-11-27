/**
 * OMAHA RIVER FIRST-TO-ACT BET IS PRICED (EMERG lane OFFENCE-BUILD, PLO-OWNER lead-2, 2026-11-20; option
 * omahaRiverFirstToActBetIsPriced, default OFF, read `=== true`; scopable per game with horse.omahaGameScope).
 *
 * THE MEASUREMENT (archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/OFFENCE-BUILD.md, steps 1-2; production hands with
 * a person seated, PLO4/PLO5 cash, public actions, every player pooled, no responder above 20% of a cell). On the river,
 * heads-up, the player who acts first and bets is folded to 39% of the time at about a quarter of the pot, 59% at four
 * tenths, 72% at two thirds and 75% at the pot (fit window, n 117 / 148 / 162 / 305). A pot-sized bet with no chance
 * when called breaks even at 50% folds, two thirds of the pot at 40%. Every earlier offence attempt that failed did so
 * multiway, on the flop, or as a raise priced unlike the call (OFFENCE-BUILD step 1); this rule is none of those.
 *
 * WHAT IT DOES. In a PLO4/PLO5 cash river decision (table or Lightning, one board, high only, no bomb pot), heads-up,
 * with nothing to call and the opponent still to act (the Horse acts first), when the node's final answer is a check:
 * the check is priced beside every bet size the engine considers (HorseOmahaCardImpact.omahaCardImpactAmounts) with the
 * card-impact model (his range weighted by his line this hand; the Horse's exact cards; after a check he bets at the
 * measured in-position rate and the Horse calls or folds by price), with his answer to each bet size taken from the
 * MEASURED curve below (continue and raise shares by pot share, joined by straight lines). The bet of highest expected
 * value replaces the check only when it beats the check by more than the comparison's own standard error.
 *
 *   EV(bet B) = fold x pot x (1 - rake) + call x (e x (pot + 2B) x (1 - rake) - B) - raise x B
 *     e = the Horse's equity against the hands that continue (the top of his range), taken as the lower of the
 *     model's figure and the production-fitted calibration of that figure (HorseOmahaCheckedToBet
 *     OMAHA_CHECKED_TO_CONTINUE_FIT): pessimistic both ways; the exact current nuts keep the model's figure (they lose
 *     to no holding). Facing a raise the Horse is charged the bet (it folds).
 *   EV(check) = the model's value of checking out of position (he may bet; the Horse calls or folds), no rake taken
 *     (a check is never made to look worse than it is).
 *   Error = the binomial error of the measured fold share at that size times the chips that ride on it, joined with
 *     the sample error of e on the model's effective range size and the model's 0.005 rounding.
 *
 * No hand class, position rule or size rule; nothing keyed to an account, a person or a Horse. The opponent's own record
 * is not read in this version (the population curve for everyone); OPPONENT-HUD's accessor can be added behind
 * omahaRiverFirstToActResponseOf later as a separately graded step. It changes only a check into a bet; it never folds,
 * never raises, never acts facing a wager, never acts multiway, on the flop or turn, in PLO6, PLO8, hold'em, tournaments,
 * bomb pots or multi-board hands. Pure: no random draw, no telemetry, no state.
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
export interface OmahaRiverFirstToActPoint {
  share: number;
  cont: number;
  raise: number;
  /** binomial standard error of the fold share on the cell's effective size */
  foldSe: number;
  n: number;
}

/**
 * GENERATED from the OFFENCE-BUILD measurement (work/m5.py, const-fit.json; sha256 in OMAHA_RIVER_FIRST_TO_ACT_SOURCE_SHA256):
 * river, heads-up, the bettor acted first (out of position), first answer of the opponent; PLO4/PLO5 cash hands with a
 * person seated, fit window before 2026-11-18 00:00Z; every player pooled, responders capped at 20% of a cell; bands
 * <0.34, 0.34-0.55, 0.55-0.8, >=0.8 of the pot at centres 0.27, 0.42, 0.65, 1.0.
 */
export const OMAHA_RIVER_FIRST_TO_ACT_SOURCE_SHA256 =
  '49e30e57c9d6a1a83b628b723b3817f0b8a4c9feec7d450a86ab22fede43dd19';
export const OMAHA_RIVER_FIRST_TO_ACT_RESPONSE: Readonly<
  Record<'plo4' | 'plo5' | 'pooled', readonly OmahaRiverFirstToActPoint[]>
> = Object.freeze({
  plo4: [
    { share: 0.27, cont: 0.6059, raise: 0.1007, foldSe: 0.0589, n: 69 },
    { share: 0.42, cont: 0.4474, raise: 0.0921, foldSe: 0.057, n: 76 },
    { share: 0.65, cont: 0.2929, raise: 0.0957, foldSe: 0.0527, n: 74 },
    { share: 1.0, cont: 0.2483, raise: 0.094, foldSe: 0.0354, n: 149 },
  ],
  plo5: [
    { share: 0.27, cont: 0.6056, raise: 0.2055, foldSe: 0.071, n: 47 },
    { share: 0.42, cont: 0.3611, raise: 0.0556, foldSe: 0.0566, n: 72 },
    { share: 0.65, cont: 0.2782, raise: 0.0706, foldSe: 0.0485, n: 86 },
    { share: 1.0, cont: 0.27, raise: 0.0608, foldSe: 0.0367, n: 146 },
  ],
  pooled: [
    { share: 0.27, cont: 0.6068, raise: 0.1453, foldSe: 0.0452, n: 117 },
    { share: 0.42, cont: 0.4054, raise: 0.0743, foldSe: 0.0404, n: 148 },
    { share: 0.65, cont: 0.284, raise: 0.0802, foldSe: 0.0354, n: 162 },
    { share: 1.0, cont: 0.2525, raise: 0.0754, foldSe: 0.0249, n: 305 },
  ],
});
/** After the first actor checks the river heads-up, the in-position player bets this share of the time (same data). */
export const OMAHA_RIVER_FIRST_TO_ACT_BET_CHECKED_TO = 0.4771;
/** A variant cell is used alone when its effective size is at least this; otherwise the pooled cell. */
export const OMAHA_RIVER_FIRST_TO_ACT_MIN_CELL = 30;

/** The curve this decision is priced with (the variant's points where measured well enough, else the pooled ones). */
export function omahaRiverFirstToActCurve(variant: string): readonly OmahaRiverFirstToActPoint[] {
  const pooled = OMAHA_RIVER_FIRST_TO_ACT_RESPONSE.pooled;
  const own =
    variant === 'plo4' || variant === 'plo5' ? OMAHA_RIVER_FIRST_TO_ACT_RESPONSE[variant] : [];
  return pooled.map((p) => {
    const v = own.find((x) => Math.abs(x.share - p.share) < 1e-9);
    return v && v.n >= OMAHA_RIVER_FIRST_TO_ACT_MIN_CELL ? v : p;
  });
}

/** The fold-share error at a pot share: the nearest measured point's (flat beyond the ends). */
function foldSeAt(curve: readonly OmahaRiverFirstToActPoint[], share: number): number {
  let best = curve[0];
  for (const p of curve) if (Math.abs(p.share - share) < Math.abs(best.share - share)) best = p;
  return best.foldSe;
}

/**
 * The opponent's answer curve for this decision. One function so that a per-opponent public read can replace it later;
 * today it is the population curve for every opponent alike.
 */
export function omahaRiverFirstToActResponseOf(
  _opponent: SeatPlayer,
  gs: HorseGameStateV2
): readonly OmahaRiverFirstToActPoint[] {
  return omahaRiverFirstToActCurve(String(gs.gameVariant ?? '').toLowerCase());
}

export interface OmahaRiverFirstToActSpot {
  opponent: SeatPlayer;
}

/** The spot, or null. Public information only. */
export function omahaRiverFirstToActSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverFirstToActSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(hero, gs)) return null;
    const scope = omahaCardImpactScope(hero, gs);
    if (!scope || scope.street !== 'river' || scope.heroCloses) return null;
    // The opponent has not acted on the river at all (the Horse acts first).
    const acted = (gs.actionHistory ?? []).some(
      (a) => String(a.stage) === 'river' && a.seat === scope.opponent.seat
    );
    if (acted) return null;
    return { opponent: scope.opponent };
  } catch {
    return null;
  }
}

export interface OmahaRiverFirstToActRow {
  action: 'bet' | 'all_in';
  amount: number;
  ev: number;
  error: number;
  fold: number;
  equity: number;
}

export interface OmahaRiverFirstToActVerdict {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  evCheck: number;
  rows: OmahaRiverFirstToActRow[];
  best: OmahaRiverFirstToActRow | null;
}

/** The comparison; `rake` is the marginal rake on the pot as a fraction. Null when a number cannot be computed. */
export function omahaRiverFirstToActBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  spot: OmahaRiverFirstToActSpot,
  rake: number,
  /** tests only: a response curve in place of the measured one */
  curveOverride?: readonly OmahaRiverFirstToActPoint[],
  /**
   * omahaRiverBetFoldIsHisRecord (default absent): the opponent's own answer curve from the population's
   * (HorseOmahaRiverBetFoldRecord.ts). Absent, or any error: the population curve, as before.
   */
  responseOf?: (
    opponent: SeatPlayer,
    population: readonly OmahaRiverFirstToActPoint[]
  ) => readonly OmahaRiverFirstToActPoint[],
  /**
   * omahaRiverBetCheckIsHisRecord (default absent): the range model's read with his own unopened bet shares
   * (HorseOmahaRiverBetFoldRecord.omahaRiverBetCheckRead). Absent, or any error: the read as before.
   */
  readOf?: (opponent: SeatPlayer, read: OmahaCardImpactRead) => OmahaCardImpactRead
): OmahaRiverFirstToActVerdict | null {
  const pot = gs.pot;
  if (!fin(pot) || !(pot > 0)) return null;
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  const opp = spot.opponent;
  const population = curveOverride ?? omahaRiverFirstToActResponseOf(opp, gs);
  let curve = population;
  if (responseOf) {
    try {
      const his = responseOf(opp, population);
      if (Array.isArray(his) && his.length === population.length) curve = his;
    } catch {
      curve = population;
    }
  }
  if (curve.length === 0) return null;
  const amounts = omahaCardImpactAmounts(hero, opp, gs);
  if (amounts.length === 0) return null;
  const read0: OmahaCardImpactRead = {
    measured: false,
    continueRate: null,
    riverCallRate: null,
    betCheckedTo: OMAHA_RIVER_FIRST_TO_ACT_BET_CHECKED_TO,
    bluffShare: OMAHA_CARD_IMPACT_PRIOR.bluffShare,
  };
  let read = read0;
  if (readOf) {
    try {
      const his = readOf(opp, read0);
      if (his && fin(his.betCheckedTo)) read = his;
    } catch {
      read = read0;
    }
  }
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
    heroCloses: false,
    line: omahaCardImpactLine(hero, opp, gs),
    read,
    amounts,
    seedSalt: opp.seat * 16 + hero.seat,
    responseAt,
  });
  if (!impact) return null;
  const check = impact.options.find((o) => o.action === 'check');
  if (!check || !fin(check.ev)) return null;
  const evCheck = check.ev;
  const eff = Math.max(1, impact.opp.effective);
  const sd = clamp(impact.showdown, 0, 1);
  const checkVar = pot * pot * ((sd * (1 - sd)) / eff + MODEL_ROUNDING ** 2);
  // The exact current nuts lose to no holding: their called equity is the model's (a chop at worst), never shaded.
  const nuts = hasRiverNuts(hero, gs, false);
  const rows: OmahaRiverFirstToActRow[] = [];
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
  let chosen: OmahaRiverFirstToActRow | null = null;
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

export interface OmahaRiverFirstToActResult {
  decision: HorseDecision;
  priced: boolean;
  changed: boolean;
  verdict?: OmahaRiverFirstToActVerdict;
}

/**
 * The option's one entry. `on` is the option (read `=== true` by the caller); `legalize` makes the bet legal (the
 * engine's own legalizer). Every decision that is not a check in the spot is returned as given (the same object).
 */
export function omahaRiverFirstToActBetRule(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  rake: number,
  legalize: (d: HorseDecision) => HorseDecision,
  /** omahaRiverBetFoldIsHisRecord (default absent): see omahaRiverFirstToActBet. */
  responseOf?: (
    opponent: SeatPlayer,
    population: readonly OmahaRiverFirstToActPoint[]
  ) => readonly OmahaRiverFirstToActPoint[],
  /**
   * omahaRiverBetCheckIsHisRecord (default absent): the range model's read with his own unopened bet shares
   * (HorseOmahaRiverBetFoldRecord.omahaRiverBetCheckRead). Absent, or any error: the read as before.
   */
  readOf?: (opponent: SeatPlayer, read: OmahaCardImpactRead) => OmahaCardImpactRead
): OmahaRiverFirstToActResult {
  const same: OmahaRiverFirstToActResult = { decision, priced: false, changed: false };
  if (!on || decision.action !== 'check') return same;
  try {
    const spot = omahaRiverFirstToActSpot(hero, gs);
    if (!spot) return same;
    const verdict = omahaRiverFirstToActBet(hero, gs, spot, rake, undefined, responseOf, readOf);
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
