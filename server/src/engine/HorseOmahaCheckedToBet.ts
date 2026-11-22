/**
 * OMAHA CHECKED-TO BET IS PRICED (2026-11-18, WooWoo audit repair programme,
 * lane CHECKED-TO-BET; option omahaCheckedToBetIsPriced, default OFF, read
 * `=== true`).
 *
 * The measurement (audit archive woowoo-48h-audit-01BNteGYgf,
 * repairs/FLOP-DEFENCE/ATTRIBUTION.md section 3): when every opponent has
 * checked and the Horse closes the action it almost never bets a medium, weak
 * or empty hand. One human folded 140 of 177 times (79%) to a river bet
 * heads-up after checking, and the Horses checked back air or a weak pair in
 * 35 of 43 such spots; with two or more opponents they bet such hands 0 of 93
 * times; on the turn after a checked-through flop he folded 11 of 22.
 *
 * v2 (2026-11-18, lane OFFENCE, REDESIGN-PLAN section 2, after the v1
 * evaluation FAILED on efficacy): (1) the river only: the turn is priced as a
 * whole line by the street plan; (2) the showdown share in EV(check) and the
 * equity against the hands that continue are no longer the raw card-impact
 * figures: each is mapped through a logistic calibration fitted on production
 * river spots (below, OMAHA_CHECKED_TO_SHOWDOWN_FIT and
 * OMAHA_CHECKED_TO_CONTINUE_FIT), and the fits' errors join the margin. The
 * turn text below describes v1 and no longer runs.
 *
 * What this file does. PLO4/PLO5 cash, one board, high only, no bomb pot, not
 * Lightning (HorseOmahaPricedWiring.omahaPricedInScope), on the river (any
 * number of opponents), when every live opponent
 * has checked this street, nobody is all in, and today's answer is a check:
 * the check is priced beside every bet size the engine considers
 * (HorseOmahaCardImpact.omahaCardImpactAmounts) and replaced by the bet of
 * highest expected value when that bet is worth more than the check by more
 * than the comparison's own standard error. There is no hand-class, position
 * or size rule and nothing is keyed to an account: the inputs are the Horse's
 * exact cards, each opponent's range from his line this hand, his measured
 * rate of continuing against a bet, the pot, the stacks and the rake.
 *
 * THE NUMBERS. Against each opponent the card-impact model
 * (HorseOmahaCardImpact.omahaCardImpact: 800 hands sampled from a private
 * stream seeded by the cards, weighted by his line, this street's check
 * included, so the range is his CHECKING range) answers, for a bet B:
 *   c  the share of that range that continues: his measured continue rate
 *      (river: his river call rate; turn: one minus his fold-to-bet rate; a
 *      posterior mean that shrinks to the Horse-population mean of the game
 *      and table size by the opportunity count, HorseOmahaPricedRules.
 *      omahaPricedRead), observed at the reference bet of 0.6 pot and moved
 *      to this size in proportion to the pot odds (the model's own scaling);
 *      with no read at all the pot-odds share itself, against which a bet
 *      with no equity is worth exactly nothing;
 *   the calling range: the top c of his checking range by strength, of which
 *      the top min(0.1, c) raises (the model's raise share);
 *   e  the Horse's equity against the hands that continue; s its showdown
 *      share against the whole checking range.
 * One opponent:
 *   EV(bet B) = [f x pot + call x (e x (pot + 2B)) - call x B + raise branch]
 *               less the rake on the chips won      (f = 1 - c)
 *     (the raise branch is the model's: facing the raise the Horse takes the
 *     better of folding, -B, and calling it);
 *   river: EV(check) = s x pot x (1 - rake);
 *   turn:  EV(check) = the model's value of checking when he may still bet:
 *     he bets the next street at his measured bet rate (value and bluff
 *     shares of the model, 0.66 pot), the Horse calls when the call is worth
 *     more than folding, and otherwise realizes its equity; less the rake.
 * Two or more opponents (river): each answers independently (the stated
 * simplification of HorseOmahaStrongHandValue: joint card removal is not
 * modelled), so every opponent folds with probability prod f_j, the JOINT
 * probability the brief of this lane asks for; every set of callers is
 * enumerated, the Horse wins against a set with probability prod e_j, and a
 * raise by anyone costs the bet (the Horse folds to it):
 *   EV(bet B) = prod f_j x pot x (1 - rake)
 *               + sum over caller sets C of P(C) x [prod_{j in C} e_j
 *                 x (pot + B + sum_{j in C} min(B, stack_j)) x (1 - rake) - B]
 *               - P(somebody raises) x B
 *   EV(check) = prod s_j x pot x (1 - rake).
 *
 * THE MARGIN is the standard error of EV(bet) - EV(check), nothing chosen:
 *  - the read: each opponent's continue rate is a rate from n opportunities
 *    and k = 6 prior pseudo-opportunities (HorseOpponentExploit), standard
 *    deviation sqrt(m(1 - m) / (n + k + 1)), scaled to the size like the rate
 *    itself, times the chips that ride on his answer (pot + B: the pot won
 *    when he folds against the bet lost when he calls with better) and the
 *    chance that the others fold;
 *  - the sample: the binomial error of s and of e on the effective size of
 *    the weighted sample (and of the called share);
 *  - the rounding of the model's reported shares (to 0.01).
 * So an opponent with few opportunities needs a larger gap, and one who is
 * measured to call (a calling station) gives EV(bet) below EV(check) for a
 * hand that cannot win when called: the check is kept.
 *
 * LIMITS, stated. A model, not a solver. The flop is not priced (two cards
 * to come and two streets of betting do not fit this arithmetic). The turn
 * is priced heads-up only, and its called branch takes the Horse's equity
 * against the calling range as realized (no river betting after a called
 * turn bet is modelled), which leans toward the bet for a hand with equity.
 * The continue rate is the pooled read until the per-street read
 * (HorseMind.omahaStreetReadOf) is delivered to decisions through
 * HorseOmahaPricedWiring.omahaPricedSetStreetRatesSource; on the turn the
 * pooled fold-to-bet rate covers every street. "After checking" is not a
 * cell of either read: the rate is his fold to any bet he faced. The size
 * scaling of the continue rate is the model's, not a measurement at each
 * size. With a player still to act behind the Horse the option does not act.
 *
 * Pure: no state beyond the card-impact module's memo, no random draw from
 * the brain's stream, no telemetry, no opponent memory (the caller supplies
 * the reads).
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  omahaCardImpactResponseOf,
  OMAHA_CARD_IMPACT_PRIOR,
  type OmahaCardImpact,
  type OmahaCardImpactOption,
  type OmahaCardImpactRead,
  type OmahaCardImpactResponseCurve,
} from './HorseOmahaCardImpact.js';
import { OMAHA_SMALL_BET_RESPONSE } from './HorseOmahaSmallBetConstants.js';
import { EXPLOIT_PRIOR_STRENGTH } from './HorseOpponentExploit.js';
import {
  OMAHA_PRICED_NO_READ,
  omahaPricedCardImpactRead,
  type OmahaPricedRead,
} from './HorseOmahaPricedRules.js';
import { omahaPricedInScope, type OmahaPricedScopeOpts } from './HorseOmahaPricedWiring.js';
import { omahaOpponentKindOf, type OmahaOpponentKind } from './HorseOmahaPricedMode.js';

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** The card-impact model reports its shares rounded to this step. */
const MODEL_ROUNDING = 0.005;

/** One opponent's read as the comparison takes it. */
export interface OmahaCheckedToRead {
  /** the one priced read (pooled, or the per-street read once delivered) */
  read: OmahaPricedRead;
  /** decayed river opportunities behind his river call rate; null when unknown */
  riverOpportunities: number | null;
  /** omahaCheckedToBetResponseIsMeasured: the population means his own rates are read beside; absent or null: none */
  population?: OmahaCheckedToPopulation | null;
}

export interface OmahaCheckedToScope {
  street: 'turn' | 'river';
  /** every other player in the hand: each has checked this street, none is all in */
  opponents: SeatPlayer[];
}

/** The option's spot: public information and the Horse's own cards. Null outside it. */
export function omahaCheckedToBetScope(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  /** the decision's options: a Lightning pool is in scope only with omahaPricedInLightning (AUDIT-02, 2026-11-19) */
  opts?: OmahaPricedScopeOpts | null
): OmahaCheckedToScope | null {
  try {
    if (!omahaPricedInScope(hero, gs, opts)) return null;
    const street = String(gs.stage ?? '');
    // v2 (REDESIGN-PLAN section 2): the river only. The turn is priced as a whole line by the
    // street plan, which this arithmetic lacks (no river betting after a called turn bet).
    if (street !== 'river') return null;
    if ((gs.communityCards ?? []).length !== 5) return null;
    if (gs.allInOrFold === true || gs.wagersCapped === true) return null;
    if (hero.is_folded || hero.is_all_in || hero.is_sitting_out) return null;
    if (!fin(hero.stack) || !(hero.stack > 0) || !fin(gs.pot) || !(gs.pot > 0)) return null;
    const toCall = fin(gs.toCall)
      ? Math.max(0, gs.toCall)
      : Math.max(0, (gs.currentBet || 0) - (fin(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    const opponents = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    );
    if (opponents.length === 0) return null;
    if (opponents.some((p) => p.is_all_in || !fin(p.stack) || !(p.stack > 0))) return null;
    const checked = new Set<number>();
    for (const a of gs.actionHistory ?? []) {
      if (String(a.stage) !== street) continue;
      const act = String(a.action);
      // Any wager on this street: the action was not checked to the Horse.
      if (act === 'bet' || act === 'raise' || act === 'all_in') return null;
      if (act === 'check' && a.seat !== hero.seat) checked.add(a.seat);
    }
    if (!opponents.every((p) => checked.has(p.seat))) return null;
    return { street, opponents };
  } catch {
    return null;
  }
}

export interface OmahaCheckedToRow {
  action: 'bet' | 'all_in';
  amount: number;
  /** expected chips of the bet, after the rake */
  ev: number;
  /** the probability that every opponent folds */
  allFold: number;
  /** the standard error of ev - evCheck */
  error: number;
  /** the hands that continue and lose outweigh those that continue and win */
  value: boolean;
}

export interface OmahaCheckedToVerdict {
  action: 'check' | 'bet' | 'all_in';
  amount: number;
  street: 'turn' | 'river';
  opponents: number;
  /** expected chips of the check, after the rake */
  evCheck: number;
  /** the Horse's showdown share against the checking ranges (the product over the opponents) */
  showdown: number;
  /** the bet chosen, or with the check kept the bet of largest gap over its error */
  best: OmahaCheckedToRow | null;
  rows: OmahaCheckedToRow[];
  /** where the continue rates came from: every opponent's source, the weakest named */
  source: 'street' | 'pooled' | 'prior';
  /** omahaCheckedToBetResponseIsMeasured: the measured answer priced this comparison ('kind': the one pooled
   *  curve, the same for every opponent; 'personal': his own level on that shape); absent when the model's keep
   *  priced it */
  measured?: 'kind' | 'personal';
}

/**
 * v2 (2026-11-18, lane OFFENCE; REDESIGN-PLAN section 2): THE SHOWDOWN SHARE IS FITTED, NOT ASSUMED.
 *
 * The v1 evaluation found the model's showdown share against a checking range at a median 0.67 where the
 * audit counted 0.44-0.47 at showdown. The share is now the model's share (his kind's prior read: no
 * personal read enters it) mapped through a logistic calibration fitted on production river spots:
 *   share = 1 / (1 + exp(-(a + b x))),  x = logit(model share clamped to [0.005, 0.995]).
 * a, b and their covariance are the maximum-likelihood fit of the Horse's real result against the hand
 * the checker really held (offline population table, archive woowoo-48h-audit-01BNteGYgf
 * repairs/CHECKED-TO-BET/v2/FIT-TABLE.md, sha256 c7907ac2b9631d51; production PLO4/PLO5 cash hands 2026-11-01..2026-11-15, read-only
 * export; every river spot where a Horse acted heads-up after his opponent checked). Hole cards are used
 * only there, offline, per kind of opponent (a person, a Horse), never per account and never as a
 * decision input. Fit: persons n 414 (mean model 0.583, mean result 0.585), Horses n 400 (0.537, 0.476); the slope b
 * is about 0.35 for both, so the model's own logit is about three times too confident at both ends. Its variance is the fit's (delta method) plus the model's sample error carried through
 * the map.
 */
export interface OmahaCheckedToShowdownFit {
  a: number;
  b: number;
  /** covariance of (a, b) */
  vaa: number;
  vab: number;
  vbb: number;
  /** river spots the fit is made from */
  n: number;
}
export const OMAHA_CHECKED_TO_SHOWDOWN_FIT: Readonly<
  Record<OmahaOpponentKind | 'pooled', OmahaCheckedToShowdownFit>
> = Object.freeze({
  person: { a: 0.122103, b: 0.355705, vaa: 0.014655, vab: -0.000498983, vbb: 0.0012304, n: 414 },
  horse: { a: -0.354739, b: 0.353924, vaa: 0.015433, vab: -0.00111882, vbb: 0.0012584, n: 400 },
  pooled: {
    a: -0.114544,
    b: 0.354075,
    vaa: 0.00740293,
    vab: -0.000398884,
    vbb: 0.000615673,
    n: 814,
  },
});

/**
 * v2: THE EQUITY AGAINST THE HANDS THAT CONTINUE IS FITTED TOO. Calibrating the check alone would leave the bet's
 * called branch on the model's overconfident equity and lean every value bet upward. Same form, fitted on the called
 * river bets of the same export (repairs/CHECKED-TO-BET/v2/FIT-CE.md, sha256 b929a2c6fa39d694): the Horse bet after the
 * check and the checker called, raised or went all in; n 144 (persons 78, Horses 66, each under 100, so the pooled fit
 * serves both kinds); mean model 0.413, mean result 0.486; slope 0.28 (SE 0.047).
 */
export const OMAHA_CHECKED_TO_CONTINUE_FIT: Readonly<OmahaCheckedToShowdownFit> = Object.freeze({
  a: 0.290444,
  b: 0.279895,
  vaa: 0.0444859,
  vab: 0.00327411,
  vbb: 0.00217208,
  n: 144,
});

/** The calibrated equity against the hands that continue and its variance. */
export function omahaCheckedToContinueCalibrated(
  model: number,
  effective: number
): { share: number; variance: number } {
  return calibrateWith(OMAHA_CHECKED_TO_CONTINUE_FIT, model, effective);
}

function calibrateWith(
  f: OmahaCheckedToShowdownFit,
  model: number,
  effective: number
): { share: number; variance: number } {
  const p = clamp(fin(model) ? model : 0.5, 0.005, 0.995);
  const x = Math.log(p / (1 - p));
  const share = 1 / (1 + Math.exp(-(f.a + f.b * x)));
  const g = share * (1 - share);
  const fitVar = g * g * (f.vaa + 2 * x * f.vab + x * x * f.vbb);
  // The model's own sample error (binomial on the effective size), carried through the map.
  const slope = (f.b * g) / (p * (1 - p));
  const sampleVar = slope * slope * ((p * (1 - p)) / Math.max(1, effective));
  return { share, variance: fitVar + sampleVar };
}

/** The calibrated showdown share against one checker and its variance. */
export function omahaCheckedToShowdownCalibrated(
  model: number,
  kind: OmahaOpponentKind | null,
  effective: number
): { share: number; variance: number } {
  return calibrateWith(OMAHA_CHECKED_TO_SHOWDOWN_FIT[kind ?? 'pooled'], model, effective);
}

/**
 * omahaCheckedToBetResponseIsMeasured (2026-11-20, EMERG lane OPEN-ITEMS-3; default OFF, read `=== true`, acts only
 * inside omahaCheckedToBetIsPriced). THE ANSWER TO A RIVER BET IS THE MEASURED ONE AT EVERY SIZE.
 *
 * The comparison above takes the share of the checker's range that continues from the card-impact model's keep: the
 * pot odds of the bet, scaled by his river call rate, or with no river evidence by his ALL-STREET continue rate (the
 * pooled read counts every street in one counter: about half), taken as observed at 0.6 pot. Measured (public
 * actions only, HorseOmahaSmallBetConstants OMAHA_SMALL_BET_RESPONSE, 5,379 PLO4/PLO5 cash hands 2026-11-13..17): a
 * person answers a river bet of two thirds of the pot by continuing 20% of the time in PLO5 (n 92) and 33% in PLO4
 * (n 69), a pot-sized bet 15% (n 142) and 27% (n 109); a Horse 27% and 28%, then 22% and 13%. Held out on
 * 2026-11-17..19 (archive woowoo-48h-audit-01BNteGYgf repairs/EMERG/OPEN-ITEMS-3.md section 2): a player who had
 * CHECKED the river continued against a Horse bet of 0.8 pot or more 4 of 48 times on Nov 17-18 and 4 of 26 on Nov 19.
 *
 * With the option on, heads-up on the river only (one opponent, who has checked), his continue and raise shares at
 * each bet size are the ONE measured curve of the variant (the person and Horse cells pooled by their counts; the
 * same curve whoever he is), joined by straight lines,
 * every hand continuing at a bet of nothing, MOVED BY HIS OWN EVIDENCE: the log-odds of continuing shift, at every
 * size alike, by logit(his own rate) - logit(the population mean of the same statistic) (his river call rate beside
 * the population's river call rate; with no river rate his continue rate beside the population's). A player with no
 * evidence is exactly that curve; a measured station continues more at every size and a measured folder less;
 * a player with evidence but no population figure to read it beside is priced by the model as before. The error of the rate is the binomial error of the measured cell joined
 * with the error of his own rate carried through the shift.
 * Everything else is the comparison above: his checking range, the fitted showdown share and continue equity, the
 * raise branch, the rake, and the bet only when it is worth more than the check by more than the comparison's own
 * standard error. No hand class, no position rule, nothing keyed to an account. Several opponents, the turn, PLO6
 * (no measured curve) and every game outside omahaPricedInScope are untouched.
 */
export interface OmahaCheckedToPopulation {
  /** population mean of continuing against a bet (1 - fold to bet); null: unknown */
  continueRate: number | null;
  /** population mean of the river call rate; null: unknown */
  riverCall: number | null;
}
export interface OmahaCheckedToMeasuredResponse {
  curve: OmahaCardImpactResponseCurve;
  /** true: his own evidence moved the pooled curve; false: exactly the pooled curve */
  personal: boolean;
  /** his own rate that moved the curve (null: none) */
  own: number | null;
  /** the rate and the count of the measured cell at a pot share */
  at: (share: number) => { cont: number; n: number };
}
const logitOf = (p: number): number => {
  const q = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(q / (1 - q));
};
/**
 * ONE CURVE FOR EVERY OPPONENT (2026-11-20, binding rule: no rule may key on whether an opponent is a person or a
 * Horse). The measured table holds a person cell and a Horse cell per bet size; the answer priced here is the two
 * pooled by their own counts at each size (a size only one of them measured is that cell). Null: no measured river
 * curve for the variant.
 */
export function omahaCheckedToPooledRiverPoints(
  variant: string
): Array<{ share: number; cont: number; raise: number; n: number }> | null {
  const cells = [
    OMAHA_SMALL_BET_RESPONSE[`${variant}|river|person`],
    OMAHA_SMALL_BET_RESPONSE[`${variant}|river|horse`],
  ].filter((c): c is NonNullable<typeof c> => Array.isArray(c) && c.length > 0);
  if (cells.length === 0) return null;
  const shares = [...new Set(cells.flatMap((c) => c.map((p) => p.share)))].sort((a, b) => a - b);
  return shares.map((share) => {
    const at = cells.flatMap((c) => c.filter((p) => p.share === share));
    const n = at.reduce((sum, p) => sum + Math.max(0, p.n), 0);
    const weight = (p: { n: number }): number => (n > 0 ? Math.max(0, p.n) / n : 1 / at.length);
    return {
      share,
      cont: at.reduce((sum, p) => sum + weight(p) * p.cont, 0),
      raise: at.reduce((sum, p) => sum + weight(p) * p.raise, 0),
      n,
    };
  });
}
export function omahaCheckedToMeasuredResponse(
  variant: string,
  read: OmahaCardImpactRead,
  population: OmahaCheckedToPopulation | null = null
): OmahaCheckedToMeasuredResponse | null {
  const points = omahaCheckedToPooledRiverPoints(variant);
  if (!points || points.length === 0) return null;
  // His own evidence beside the population's figure for the same statistic.
  let own: number | null = null;
  let shift = 0;
  if (read.measured && (read.riverCallRate !== null || read.continueRate !== null)) {
    const pairs: Array<[number | null, number | null]> = [
      [read.riverCallRate, population?.riverCall ?? null],
      [read.continueRate, population?.continueRate ?? null],
    ];
    for (const [mine, theirs] of pairs)
      if (
        mine !== null &&
        theirs !== null &&
        fin(mine) &&
        fin(theirs) &&
        theirs > 0 &&
        theirs < 1
      ) {
        own = clamp(mine, 0, 1);
        shift = logitOf(own) - logitOf(theirs);
        break;
      }
    // He has evidence and there is no population figure to read it beside: the comparison is the model's, as before.
    if (own === null) return null;
  }
  const moved = (cont: number): number =>
    shift === 0 ? clamp(cont, 0, 1) : 1 / (1 + Math.exp(-(logitOf(cont) + shift)));
  const curve: OmahaCardImpactResponseCurve = [
    { share: 0, cont: 1, raise: clamp(points[0].raise, 0, 1) },
    ...points
      .filter((p) => p.share > 0)
      .map((p) => {
        const cont = moved(p.cont);
        // of the hands that continue, the measured share at that size raises
        return {
          share: p.share,
          cont,
          raise: p.cont > 0 ? clamp((p.raise / p.cont) * cont, 0, 1) : 0,
        };
      }),
  ];
  const at = (share: number): { cont: number; n: number } => {
    // the count behind the rate: the nearer measured point's own cell
    let near = points[0];
    for (const p of points) if (Math.abs(p.share - share) < Math.abs(near.share - share)) near = p;
    return { cont: omahaCardImpactResponseOf(curve, share).cont, n: Math.max(0, near.n) };
  };
  return { curve, personal: shift !== 0, own, at };
}

interface Leg {
  opp: SeatPlayer;
  impact: OmahaCardImpact;
  /** omahaCheckedToBetResponseIsMeasured: the measured answer used for this opponent's bet rows; null: the model's keep */
  measured: OmahaCheckedToMeasuredResponse | null;
  /** decayed opportunities behind the continue rate used */
  n: number;
  /** his continue rate at the reference size; null: no read (the pot-odds share) */
  rate: number | null;
  /** v2: the showdown share against his checking range, calibrated to production showdowns, and its variance */
  share: number;
  shareVar: number;
}

/**
 * The comparison. `readOf` answers an opponent seat's read (null: none);
 * `rake` is the marginal rake on the pot as a fraction. Null when a number
 * cannot be computed.
 */
export function omahaCheckedToBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  scope: OmahaCheckedToScope,
  readOf: (seat: number) => OmahaCheckedToRead | null,
  rake: number,
  /** omahaCheckedToBetResponseIsMeasured (default off): heads-up, his answer to a bet is the measured one at every size */
  measuredResponse = false
): OmahaCheckedToVerdict | null {
  const pot = gs.pot;
  const river = scope.street === 'river';
  const r = fin(rake) ? clamp(rake, 0, 0.2) : 0;
  const deepest = scope.opponents.reduce((a, b) => (b.stack > a.stack ? b : a));
  const amounts = omahaCardImpactAmounts(hero, deepest, gs);
  if (amounts.length === 0) return null;
  const legs: Leg[] = [];
  let source: OmahaCheckedToVerdict['source'] = 'street';
  for (const opp of scope.opponents) {
    const given = readOf(opp.seat);
    const read = given?.read ?? OMAHA_PRICED_NO_READ;
    if (read.source === 'prior' || (read.source === 'pooled' && source === 'street'))
      source = read.source;
    const cardRead = omahaPricedCardImpactRead(read, scope.street);
    const measured =
      measuredResponse === true && river && scope.opponents.length === 1
        ? omahaCheckedToMeasuredResponse(
            String(gs.gameVariant ?? '').toLowerCase(),
            cardRead,
            given?.population ?? null
          )
        : null;
    const impact = omahaCardImpact({
      hole: hero.cards,
      board: gs.communityCards ?? [],
      dead: hero.knownDeadCards ?? [],
      pot,
      heroStack: hero.stack,
      oppStack: opp.stack,
      // River: the check ends the hand. Turn: he may still bet the river.
      heroCloses: river,
      line: omahaCardImpactLine(hero, opp, gs),
      read: cardRead,
      amounts,
      seedSalt: opp.seat * 16 + hero.seat,
      ...(measured ? { responseAt: measured.curve } : {}),
    });
    if (!impact) return null;
    // The rate the model used, as it reads it (HorseOmahaCardImpact keepOf).
    const cont = read.foldToBet === null ? null : 1 - read.foldToBet;
    const rate = cont === null ? null : river ? (read.riverCall ?? cont) : cont;
    const n =
      rate === null
        ? 0
        : river && read.riverCall !== null && fin(given?.riverOpportunities)
          ? Math.max(0, given!.riverOpportunities as number)
          : Math.max(0, read.opportunities);
    // v2: the showdown share. The model's share against his checking range with his KIND's prior read
    // (the exact input the population table was fitted on), mapped through the fitted calibration.
    const kind = omahaOpponentKindOf(gs, opp.user_id);
    const kindImpact = omahaCardImpact({
      hole: hero.cards,
      board: gs.communityCards ?? [],
      dead: hero.knownDeadCards ?? [],
      pot,
      heroStack: hero.stack,
      oppStack: opp.stack,
      heroCloses: true,
      line: omahaCardImpactLine(hero, opp, gs),
      read: omahaPricedCardImpactRead({ ...OMAHA_PRICED_NO_READ, kind }, 'river'),
      amounts: [amounts[0]],
      seedSalt: opp.seat * 16 + hero.seat,
    });
    if (!kindImpact) return null;
    const cal = omahaCheckedToShowdownCalibrated(
      kindImpact.showdown,
      kind,
      Math.max(1, kindImpact.opp.effective)
    );
    legs.push({ opp, impact, measured, n, rate, share: cal.share, shareVar: cal.variance });
  }
  void river;
  const showdown = legs.reduce((a, l) => a * clamp(l.share, 0, 1), 1);
  const evCheck = pot * showdown * (1 - r);
  // The error of the check: each leg's calibrated share (the fit's error, the sample's, the rounding).
  let checkVar = 0;
  for (const l of legs) {
    const s = clamp(l.share, 0, 1);
    const others = s > 0 ? showdown / s : legs.reduce((a, m) => (m === l ? a : a * m.share), 1);
    checkVar += (pot * others * (1 - r)) ** 2 * (l.shareVar + MODEL_ROUNDING ** 2);
  }
  const refOdds = 1 / (1 + OMAHA_CARD_IMPACT_PRIOR.referenceBet);
  const rows: OmahaCheckedToRow[] = [];
  for (const amount of amounts) {
    const a = round2(Math.min(amount, hero.stack));
    const opts: OmahaCardImpactOption[] = [];
    for (const l of legs) {
      const o = l.impact.options.find(
        (x) => x.action !== 'check' && Math.abs(x.amount - a) < 0.006
      );
      if (o) opts.push(o);
    }
    if (opts.length !== legs.length) continue;
    const folds = opts.map((o) => clamp(o.fold, 0, 1));
    // v2: the equity against the hands that continue, calibrated (FIT-CE.md).
    const ce = opts.map((o, j) =>
      omahaCheckedToContinueCalibrated(o.continueEquity, legs[j].impact.opp.effective)
    );
    const allFold = folds.reduce((x, y) => x * y, 1);
    let ev: number;
    let value: boolean;
    if (legs.length === 1) {
      const o = opts[0];
      const cont = o.call + o.raise;
      const B0 = Math.min(a, legs[0].opp.stack);
      const e = ce[0].share;
      const won = o.fold * pot + cont * e * (pot + 2 * B0);
      // The model's value with its continue equity replaced by the calibrated one.
      ev = o.ev + cont * (e - clamp(o.continueEquity, 0, 1)) * (pot + 2 * B0) - r * won;
      // A value bet: the hands that continue and lose outweigh those that continue and win.
      value = e > 0.5;
    } else {
      // Every set of callers; a raise by anyone costs the bet.
      const n = legs.length;
      let sum = allFold * pot * (1 - r);
      let noRaise = 1;
      for (const o of opts) noRaise *= 1 - clamp(o.raise, 0, 1);
      let accounted = allFold;
      for (let mask = 1; mask < 1 << n; mask++) {
        let p = 1;
        let win = 1;
        let chips = pot + a;
        for (let j = 0; j < n; j++) {
          const o = opts[j];
          if (mask & (1 << j)) {
            const call = clamp(o.call, 0, 1);
            p *= call;
            // Equity against his callers: at least the equity against all the hands that
            // continue (the raisers are the top of them), which is the figure used.
            win *= ce[j].share;
            chips += Math.min(a, legs[j].opp.stack);
          } else p *= folds[j];
        }
        accounted += p;
        sum += p * (win * chips * (1 - r) - a);
      }
      // What is left is the chance that somebody raises.
      sum -= Math.max(0, Math.min(1 - noRaise + 1e-9, 1 - accounted)) * a;
      ev = sum;
      let worse = 0;
      let better = 0;
      opts.forEach((o, j) => {
        const cont = o.call + o.raise;
        worse += cont * ce[j].share;
        better += cont * (1 - ce[j].share);
      });
      value = worse > better;
    }
    // The standard error of ev - evCheck.
    let variance = checkVar;
    legs.forEach((l, j) => {
      const o = opts[j];
      const B = Math.min(a, l.opp.stack);
      const odds = pot / (pot + B);
      // omahaCheckedToBetResponseIsMeasured: the rate is the measured cell's (moved by his own evidence), and its
      // error is the cell's binomial error joined with the error of his own rate carried through the shift.
      const cell = l.measured ? l.measured.at(B / pot) : null;
      const m = cell ? clamp(cell.cont, 0, 1) : l.rate === null ? odds : clamp(l.rate, 0, 1);
      const scale = cell || l.rate === null ? 1 : odds / refOdds;
      let sd =
        Math.sqrt((m * (1 - m)) / ((cell ? cell.n : l.n) + EXPLOIT_PRIOR_STRENGTH + 1)) * scale;
      if (cell && l.measured!.personal && l.measured!.own !== null) {
        const o = clamp(l.measured!.own, 0.02, 0.98);
        const ownSd = Math.sqrt((o * (1 - o)) / (l.n + EXPLOIT_PRIOR_STRENGTH + 1));
        sd = Math.hypot(sd, (ownSd * (m * (1 - m))) / (o * (1 - o)));
      }
      const othersFold =
        folds[j] > 0 ? allFold / folds[j] : folds.reduce((x, y, k) => (k === j ? x : x * y), 1);
      variance += (sd * (pot + B) * othersFold) ** 2;
      const cont = clamp(o.call + o.raise, 0, 1);
      variance += (cont * (pot + 2 * B) * othersFold) ** 2 * ce[j].variance;
      variance += 3 * (MODEL_ROUNDING * (pot + 2 * B)) ** 2;
    });
    rows.push({
      action: a >= hero.stack - 0.005 ? 'all_in' : 'bet',
      amount: a,
      ev: round2(ev),
      allFold: round2(allFold),
      error: round2(Math.sqrt(variance)),
      value,
    });
  }
  if (rows.length === 0) return null;
  const check = round2(evCheck);
  let chosen: OmahaCheckedToRow | null = null;
  let nearest: OmahaCheckedToRow | null = null;
  for (const row of rows) {
    if (row.ev - check > row.error && (chosen === null || row.ev > chosen.ev)) chosen = row;
    if (nearest === null || row.ev - check - row.error > nearest.ev - check - nearest.error)
      nearest = row;
  }
  return {
    action: chosen ? chosen.action : 'check',
    amount: chosen ? chosen.amount : 0,
    street: scope.street,
    opponents: legs.length,
    evCheck: check,
    showdown: round2(showdown),
    best: chosen ?? nearest,
    rows,
    source,
    ...(legs.length === 1 && legs[0].measured
      ? { measured: legs[0].measured.personal ? ('personal' as const) : ('kind' as const) }
      : {}),
  };
}

export interface OmahaCheckedToResult {
  decision: HorseDecision;
  /** the comparison was made */
  priced: boolean;
  changed: 'bet' | null;
  /** the bet is not a value bet: better hands continue more than worse ones (a declared bluff) */
  bluff: boolean;
  verdict?: OmahaCheckedToVerdict;
}

/** The option's one entry: today's check priced beside the bets. Every other decision is returned as given. */
export function omahaCheckedToBetDecision(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  readOf: (seat: number) => OmahaCheckedToRead | null,
  rake: number,
  opts?: OmahaPricedScopeOpts | null,
  /** omahaCheckedToBetResponseIsMeasured (default off) */
  measuredResponse = false
): OmahaCheckedToResult {
  const same: OmahaCheckedToResult = { decision, priced: false, changed: null, bluff: false };
  if (decision.action !== 'check') return same;
  const scope = omahaCheckedToBetScope(hero, gs, opts);
  if (!scope) return same;
  const verdict = omahaCheckedToBet(hero, gs, scope, readOf, rake, measuredResponse === true);
  if (!verdict) return same;
  if (verdict.action === 'check' || verdict.best === null)
    return { decision, priced: true, changed: null, bluff: false, verdict };
  const next: HorseDecision = { ...decision, action: verdict.action };
  if (verdict.action === 'bet') next.amount = verdict.amount;
  else delete next.amount;
  return { decision: next, priced: true, changed: 'bet', bluff: !verdict.best.value, verdict };
}
