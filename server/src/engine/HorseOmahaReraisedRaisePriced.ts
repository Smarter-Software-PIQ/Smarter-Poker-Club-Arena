/**
 * THE PRICED CALL-OR-RAISE FACING A RE-RAISE (option
 * omahaReraisedCallVsRaisePriced, default OFF; WooWoo 48-hour audit,
 * CALL-VS-RAISE analysis 2026-11-18; owner 2026-11-17: when a fix turns a fold
 * into a call, find out whether the spot should have been a raise, and what in
 * the math makes the difference; no blanket rules).
 *
 * Before this module no preflop step could turn a call into a raise, and
 * EV(raise) was never computed: the reference 4-bets by a margin on the CALL's
 * price or by a percentile bar, and every later rule only keeps or lowers.
 *
 * PLO4/PLO5 cash, preflop, facing two or more raises, the re-raiser not all
 * in. For the standing call (or a reference raise a range rule lowered) two
 * numbers are computed on ONE set of sampled opponent holdings:
 *
 *   EV(call)  = the hotfix's omahaReraisedCallEv (its constants, not forked):
 *               R(call) x equity vs his whole re-raising range x pot after the
 *               call x (1 - rake) - call
 *
 *   EV(raise) = P(fold) x pot now
 *             + P(call) x [ R(SPR left) x equity vs his CALLING band
 *                           x final pot x (1 - rake) - chips added ]
 *             + P(re-raise) x max( -chips added, EV(continuing) )
 *
 *  - P(fold), P(call), P(re-raise): his own answers when his re-raise was
 *    raised again (HorseOmahaReraiseResponse, the node of his raise), as a
 *    posterior against the measured population prior below. Never an assumed
 *    fold rate.
 *  - his re-raising range: the top `width` of hands by the engine's preflop
 *    percentile (omahaReraiserRangeWidth, the hotfix's width). He folds its
 *    bottom P(fold) share, re-raises its top P(re-raise) share and calls the
 *    band between.
 *  - equity against the range and against each band: the hotfix's sampler
 *    (omahaReraisedEquity, seeded by the cards), ONE run, each sample assigned
 *    to its band by its percentile: common random numbers for both actions.
 *  - R: omahaReraisedCallRealization at the stack-to-pot ratio the called
 *    raise leaves (position and other players as the call is priced).
 *  - the raise is priced at its effective size: what the re-raiser cannot
 *    match is returned uncalled.
 *  - when nothing is left behind once the raise is called (either player all
 *    in) no re-raise is possible: his re-raising share is a calling share, and
 *    the equity is against his calling and re-raising bands together.
 *  - EV(continuing) against his re-raise: he re-raises pot. When the
 *    stack-to-pot ratio left after our raise is called is 1 or less the rest
 *    goes in (R = 1); otherwise his raise is called and priced like any call.
 *    Giving up costs the chips added.
 *  - HEADS-UP ONLY (review of 59ea78d08f3, B1): the option prices a spot
 *    only when nobody but the Horse and the re-raiser is still in the hand.
 *    How a third player answers a raise is not measured, and pricing him as
 *    folding is an assumed fold rate of 1. With others in the decision is the
 *    standing one, unpriced (HorseLogic's gate).
 *  - HIS FOLD SHARE IS HIS OWN (B2): the prior contributes call and re-raise
 *    shares only. Its fold share (2 folds in 23 spots at the 5-bet node) is
 *    moved to calling, so the fold share is his own decayed folds over his
 *    answers plus the prior mass: zero with no record at the node.
 *
 * VERDICT. Raise only when EV(raise) > 0 AND EV(raise) - EV(standing action)
 * exceeds twice its standard error (the standing action is the call, or the
 * fold a rule made of a reference raise: EV 0). The standard error (B3) is the
 * root of the sum of three variances: the equity sampling; his response rates
 * (the Dirichlet posterior of his counts and the prior's mass, by the delta
 * method: EV(raise) is linear in the three rates); and the realization's depth
 * cost (RERAISE_RAISE_DEPTH_COST_SE, from REALIZATION.md), by the derivative
 * of the edge in that cost.
 * Otherwise the standing call-or-fold verdict stands. The option never lowers
 * a decision. Nothing here is keyed to a hand class, a position, a bet size or
 * an account: position and depth enter only through R, the hand only through
 * its equities, the opponent only through his own counts.
 *
 * THE PRIOR (measured, not assumed): production hand_history, PLO4/PLO5 cash,
 * 30 days to 2026-11-18, hands with a human at the table, the reducer of
 * HorseOmahaReraiseResponse run in SQL (w12-callraise/scripts/sql, data
 * pop-summary.txt):
 *   3-bet facing a 4-bet   humans 24 players, 544 spots: fold 0.007 call 0.812
 *                          re-raise 0.180; without the most frequent player
 *                          (23 players, 211 spots): 0.014 / 0.744 / 0.242
 *                          Horses 262, 517 spots: 0.404 / 0.485 / 0.110
 *   4-bet facing a 5-bet   humans 11 players, 50 spots: 0.040 / 0.880 / 0.080;
 *                          without the most frequent player (23 spots): 0.087 /
 *                          0.826 / 0.087. Horses 109, 132 spots: 0.061 / 0.917
 *                          / 0.023
 * The prior is the HUMAN envelope without its most frequent player: the engine
 * does not know whether an opponent is a Horse (and must not key on it), a
 * prior that credits the Horse population's 0.40 fold rate to a player who
 * folds 1 time in 100 is the error the analysis warns of, and one account must
 * not set the prior. A Horse opponent's own counts move his posterior off it
 * within a few spots. Prior weight: STREET_READ_PRIOR_MASS (6), the engine's
 * existing weight for a durable opportunity-gated read (a convention).
 *
 * Pure: no I/O, no draw from the brain's random stream.
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile } from './HorseEval.js';
import { omahaReraisedEquity } from './HorseOmahaReraisedPot.js';
import {
  RERAISE_CALL_DEPTH_HALF,
  RERAISE_CALL_EQUITY_SAMPLES,
  RERAISE_CALL_REALIZATION_MIN,
  omahaReraisedCallEv,
  omahaReraisedCallPriced,
  omahaReraisedCallRealization,
  omahaReraiserRangeWidth,
  type OmahaReraisedCallPricing,
} from './HorseOmahaOopReraisedPot.js';
import {
  reraiseResponsePosterior,
  type ReraiseResponseCounters,
  type ReraiseResponseNode,
  type ReraiseResponsePosterior,
  type ReraiseResponseRates,
} from './HorseOmahaReraiseResponse.js';

/** The measured population prior (see the module comment for counts and source). */
export const RERAISE_RESPONSE_PRIOR: Readonly<Record<ReraiseResponseNode, ReraiseResponseRates>> = {
  threeBetFacesFourBet: { fold: 0.014, call: 0.744, raise: 0.242 },
  fourBetFacesFiveBet: { fold: 0.087, call: 0.826, raise: 0.087 },
};
/**
 * The standard error of the realization's depth cost the bar carries (B3): the
 * fit on a Horse caller against a human re-raiser, the population these
 * decisions are made in (REALIZATION.md, 2,067 calls): in position 0.08, SE
 * 0.18; out of position 0.73, SE 0.30. The central constants stay the calling
 * rule's (0.15 / 0.70).
 */
export const RERAISE_RAISE_DEPTH_COST_SE: Readonly<Record<'ip' | 'oop', number>> = {
  ip: 0.18,
  oop: 0.3,
};

/**
 * The prior's weight in opportunities: 6, the weight the engine already gives the prior of its other durable
 * opportunity-gated read (STREET_READ_PRIOR_MASS). A convention, not a measurement: with 23 players behind the
 * prior a between-player spread cannot be fitted.
 */
export const RERAISE_RESPONSE_PRIOR_MASS = 6;
/**
 * Opponent holdings sampled. 1,600 gives a standard error of about 0.0125 on
 * the equity against the range (the review of the hotfix, item 3(b): 400
 * samples leave 0.025, about 2 bb of noise on EV(call) alone).
 */
export const RERAISE_RAISE_EQUITY_SAMPLES = 1600;
/** The raise must beat the standing action by this many sampling standard errors. */
export const RERAISE_RAISE_SE_MULTIPLE = 2;

/**
 * His rates for the raise (B2): the posterior of his own counts against the
 * measured prior with the prior's fold share moved to calling, so a fold share
 * can only come from his own folds. Null when the prior is unusable.
 */
export function reraiseResponseRatesForTheRaise(
  record: ReraiseResponseCounters | null | undefined,
  node: ReraiseResponseNode
): ReraiseResponsePosterior | null {
  const prior = RERAISE_RESPONSE_PRIOR[node];
  return reraiseResponsePosterior(
    record,
    node,
    { fold: 0, call: prior.call + prior.fold, raise: prior.raise },
    RERAISE_RESPONSE_PRIOR_MASS
  );
}

/** d R / d (depth cost) at a stack-to-pot ratio: zero where R is clamped (all in, or at its floor). */
function realizationSlope(inPosition: boolean, spr: number, r: number): number {
  if (!(spr > 1e-9) || r >= 1 - 1e-12 || r <= RERAISE_CALL_REALIZATION_MIN + 1e-12) return 0;
  return -spr / (spr + RERAISE_CALL_DEPTH_HALF[inPosition ? 'ip' : 'oop']);
}

/** Everything the arithmetic needs besides the cards (the fixture of the regression tests holds exactly this). */
export interface OmahaReraisedRaiseSpot {
  /** raises made on the preflop street so far (2: hero faces a 3-bet) */
  preflopRaises: number;
  /** chips to call now (capped by hero's stack) */
  call: number;
  /** the pot now, every bet included */
  pot: number;
  /** hero's stack behind, before acting */
  stack: number;
  /** what hero has in on this street */
  heroBet: number;
  /** the raise priced: hero's total on this street after it (capped by his stack) */
  raiseTo: number;
  /** what the re-raiser has in on this street, and behind */
  raiserBet: number;
  raiserStack: number;
  /** the inputs of the priced call (position, other players, rake, his re-raise rate) */
  pricing: OmahaReraisedCallPricing;
  /** his answers to a raise of his re-raise (posterior against the prior) */
  rates: ReraiseResponsePosterior;
  /** the share of the pot lost to rake when the raise is called (the engine's deduction on that pot) */
  rakeCalled: number;
  /** the standing action the raise must beat */
  standing: 'call' | 'fold';
}
export interface OmahaReraisedRaiseInput extends OmahaReraisedRaiseSpot {
  hole: readonly Card[];
  dead: readonly Card[];
  samples?: number;
}
/**
 * One run of the sampler against his whole re-raising range, split by band: [folding, calling, re-raising]. For
 * each band the samples that fell in it, the sum of hero's results on them (1 win, 0.5 tie) and the sum of their
 * squares. `callEquityMultiway`: the calling rule's own equity when other players are in for the price (else null).
 */
export interface OmahaReraisedRaiseSamples {
  n: readonly [number, number, number];
  sum: readonly [number, number, number];
  sumSq: readonly [number, number, number];
  callEquityMultiway: number | null;
}

export interface OmahaReraisedRaiseReceipt {
  verdict: 'raise' | 'stand';
  standing: 'call' | 'fold';
  evCall: number;
  evRaise: number;
  /** EV(raise) - EV(standing action) */
  edge: number;
  /** standard error of `edge`: the root of the three below, squared and summed */
  se: number;
  seSampling: number;
  seRates: number;
  seRealization: number;
  /** his range width and the three shares of it */
  width: number;
  pFold: number;
  pCall: number;
  pReraise: number;
  equityRange: number;
  equityCall: number;
  equityCallBand: number | null;
  equityReraiseBand: number | null;
  realizationCall: number;
  realizationRaise: number;
  sprCall: number;
  sprRaise: number;
  added: number;
  potCalled: number;
  /** EV of the raise when he calls, and of continuing against his re-raise (null: no sample in that band) */
  evWhenCalled: number;
  evContinue: number | null;
  continues: boolean;
  continueAllIn: boolean;
  /** the inputs, whole: with `samples` they reproduce every number above (omahaReraisedRaiseEv) */
  spot: OmahaReraisedRaiseSpot;
  samples: OmahaReraisedRaiseSamples;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The band limits by percentile: he folds below `foldBelow`, re-raises from `reraiseFrom`, calls between. */
export function omahaReraisedRaiseBands(
  spot: Pick<OmahaReraisedRaiseSpot, 'pricing' | 'preflopRaises' | 'rates'>
): { width: number; lo: number; foldBelow: number; reraiseFrom: number } {
  const width = omahaReraiserRangeWidth(spot.pricing.rate, spot.preflopRaises);
  const lo = 1 - width;
  return {
    width,
    lo,
    foldBelow: lo + spot.rates.fold * width,
    reraiseFrom: 1 - spot.rates.raise * width,
  };
}

/** The arithmetic alone, for a given run of samples (omahaReraisedRaisePriced draws them). */
export function omahaReraisedRaiseEv(
  spot: OmahaReraisedRaiseSpot,
  samples: OmahaReraisedRaiseSamples
): OmahaReraisedRaiseReceipt | null {
  const { pricing: p, rates } = spot;
  const call = Math.min(spot.call, spot.stack);
  // The effective raise: capped by hero's stack and by the re-raiser's all-in (what he cannot match is returned
  // uncalled; the other players are priced as folding to the raise).
  const raiseTo = Math.min(
    spot.raiseTo,
    spot.heroBet + spot.stack,
    Math.max(0, spot.raiserBet) + Math.max(0, spot.raiserStack)
  );
  const added = raiseTo - spot.heroBet;
  if (!(call > 0.005) || !(spot.pot > 0) || !(spot.stack > 0)) return null;
  if (!(added > call + 0.005)) return null;
  if (![rates.fold, rates.call, rates.raise].every((x) => Number.isFinite(x) && x >= 0))
    return null;
  if (Math.abs(rates.fold + rates.call + rates.raise - 1) > 1e-6) return null;
  const [nFold, nCall, nRe] = samples.n;
  const N = nFold + nCall + nRe;
  if (!(N > 0)) return null;
  const { width } = omahaReraisedRaiseBands(spot);
  const equityRange = (samples.sum[0] + samples.sum[1] + samples.sum[2]) / N;

  // The call: the calling rule's arithmetic (its constants). Heads-up, on this run's equity against his range.
  // With other players already in for the price, on the calling rule's own multiway equity (its own samples):
  // the call plays against all of them, while the raise is priced with them folding.
  const multiway = samples.callEquityMultiway !== null;
  const equityCall = multiway ? (samples.callEquityMultiway as number) : equityRange;
  const callNumbers = omahaReraisedCallEv(equityCall, width, call, spot.pot, spot.stack, p);
  const evCall = callNumbers.evCall;
  const rakeCall = clamp(Number.isFinite(p.rakeFraction) ? p.rakeFraction : 0, 0, 0.5);
  const rakeCalled = clamp(Number.isFinite(spot.rakeCalled) ? spot.rakeCalled : rakeCall, 0, 0.5);

  // The raise, called.
  const raiserPays = Math.min(Math.max(0, spot.raiserStack), Math.max(0, raiseTo - spot.raiserBet));
  const potCalled = spot.pot + added + raiserPays;
  const behind = Math.max(0, Math.min(spot.stack - added, spot.raiserStack - raiserPays));
  const sprRaise = potCalled > 0 ? behind / potCalled : 0;
  const diluted = p.headsUpDiluted ?? 0;
  const realizationRaise = omahaReraisedCallRealization(
    p.inPosition,
    sprRaise,
    p.othersIn,
    diluted
  );
  // Nothing left behind once the raise is called (the Horse, or he, is all in): no re-raise is possible, so his
  // re-raising share is a calling share and the hands he calls with are both bands.
  const canReraise = behind > 0.005;
  const pCall = canReraise ? rates.call : rates.call + rates.raise;
  const pReraise = canReraise ? rates.raise : 0;
  const nCalls = canReraise ? nCall : nCall + nRe;
  const equityCallBand =
    nCalls > 0 ? (samples.sum[1] + (canReraise ? 0 : samples.sum[2])) / nCalls : null;
  const equityReraiseBand = canReraise && nRe > 0 ? samples.sum[2] / nRe : null;
  // A share of the range he is said to call with but no sample in it: not priceable.
  if (pCall > 1e-9 && equityCallBand === null) return null;
  const calledCoef = realizationRaise * potCalled * (1 - rakeCalled); // x equity vs the calling band
  const evWhenCalled = calledCoef * (equityCallBand ?? 0) - added;

  // He re-raises pot: continue (all in at SPR <= 1, else a priced call of it) or give up.
  let evContinue: number | null = null;
  let continueCoef = 0; // x equity vs the re-raising band
  let continueSlopeCoef = 0; // d(evContinue)/d(depth cost) / equity
  const continueAllIn = sprRaise <= 1 + 1e-9;
  if (equityReraiseBand !== null && canReraise) {
    const more = continueAllIn ? behind : Math.min(potCalled, behind);
    const potFinal = potCalled + 2 * more;
    const left = behind - more;
    const r2 = continueAllIn
      ? 1
      : omahaReraisedCallRealization(p.inPosition, left / potFinal, p.othersIn, diluted);
    continueCoef = r2 * potFinal * (1 - rakeCalled);
    if (!continueAllIn)
      continueSlopeCoef =
        realizationSlope(p.inPosition, left / potFinal, r2) * potFinal * (1 - rakeCalled);
    evContinue = continueCoef * equityReraiseBand - (added + more);
  }
  const continues = evContinue !== null && evContinue > -added;
  const evReraised = continues ? (evContinue as number) : -added;
  const evRaise = rates.fold * spot.pot + pCall * evWhenCalled + pReraise * evReraised;

  // Sampling error of EV(raise) - EV(standing). With the bands' shares taken as given both are linear in the
  // per-sample results, so the difference is the mean of one term per sample: a coefficient that depends only on
  // the sample's band, times its result.
  const standingIsCall = spot.standing === 'call';
  const callCoef = callNumbers.realization * (spot.pot + call) * (1 - rakeCall);
  const paired = standingIsCall && !multiway ? callCoef : 0; // the call is on the same samples
  const calledTerm = nCalls > 0 ? (pCall * calledCoef * N) / nCalls : 0;
  const coef = [
    -paired,
    calledTerm - paired,
    (canReraise ? (continues && nRe > 0 ? (pReraise * continueCoef * N) / nRe : 0) : calledTerm) -
      paired,
  ];
  let sum = 0;
  let sumSq = 0;
  for (let b = 0; b < 3; b++) {
    sum += coef[b] * samples.sum[b];
    sumSq += coef[b] * coef[b] * samples.sumSq[b];
  }
  const variance = N > 1 ? Math.max(0, (sumSq - (sum * sum) / N) / (N - 1)) : 0;
  // multiway: the call's equity is on its own samples; its error is added in quadrature
  const seCallAlone =
    standingIsCall && multiway
      ? callCoef * Math.sqrt((equityCall * (1 - equityCall)) / RERAISE_CALL_EQUITY_SAMPLES)
      : 0;
  const seSampling = Math.sqrt(variance / N + seCallAlone * seCallAlone);
  // His rates (B3): EV(raise) = sum of rate x value, the rates a Dirichlet
  // posterior with mass = his answers + the prior's mass.
  const answered = rates.counts.fold + rates.counts.call + rates.counts.raise;
  const alpha0 = answered + RERAISE_RESPONSE_PRIOR_MASS;
  const g = [spot.pot, evWhenCalled, evReraised];
  const ps = [rates.fold, pCall, pReraise];
  const mean = g[0] * ps[0] + g[1] * ps[1] + g[2] * ps[2];
  const second = g[0] * g[0] * ps[0] + g[1] * g[1] * ps[1] + g[2] * g[2] * ps[2];
  const seRates = Math.sqrt(Math.max(0, second - mean * mean) / (alpha0 + 1));
  // The realization's depth cost (B3): the edge's slope in it times its standard error.
  const slopeCall =
    realizationSlope(p.inPosition, callNumbers.sprAfter, callNumbers.realization) *
    equityCall *
    (spot.pot + call) *
    (1 - rakeCall);
  const slopeRaise =
    pCall *
      realizationSlope(p.inPosition, sprRaise, realizationRaise) *
      potCalled *
      (1 - rakeCalled) *
      (equityCallBand ?? 0) +
    (continues ? pReraise * continueSlopeCoef * (equityReraiseBand ?? 0) : 0);
  const seRealization =
    Math.abs(slopeRaise - (standingIsCall ? slopeCall : 0)) *
    RERAISE_RAISE_DEPTH_COST_SE[p.inPosition ? 'ip' : 'oop'];
  const se = Math.sqrt(seSampling * seSampling + seRates * seRates + seRealization * seRealization);
  const edge = evRaise - (standingIsCall ? evCall : 0);
  const raise = evRaise > 0 && edge > RERAISE_RAISE_SE_MULTIPLE * se;
  return {
    verdict: raise ? 'raise' : 'stand',
    standing: spot.standing,
    evCall,
    evRaise,
    edge,
    se,
    seSampling,
    seRates,
    seRealization,
    width,
    pFold: rates.fold,
    pCall,
    pReraise,
    equityRange,
    equityCall,
    equityCallBand,
    equityReraiseBand,
    realizationCall: callNumbers.realization,
    realizationRaise,
    sprCall: callNumbers.sprAfter,
    sprRaise,
    added,
    potCalled,
    evWhenCalled,
    evContinue,
    continues,
    continueAllIn,
    spot,
    samples,
  };
}

/** Draws the samples (one run of the calling rule's sampler, split by band) and prices the spot. */
export function omahaReraisedRaisePriced(
  i: OmahaReraisedRaiseInput
): OmahaReraisedRaiseReceipt | null {
  const { hole, dead, samples: wanted, ...spot } = i;
  if (!(spot.call > 0.005) || !(spot.pot > 0) || !(spot.stack > 0)) return null;
  const { lo, foldBelow, reraiseFrom } = omahaReraisedRaiseBands(spot);
  const n: [number, number, number] = [0, 0, 0];
  const sum: [number, number, number] = [0, 0, 0];
  const sumSq: [number, number, number] = [0, 0, 0];
  let pct = 0;
  const equityRange = omahaReraisedEquity(
    hole,
    [],
    dead,
    (h) => {
      pct = omahaPreflopPercentile([...h], false);
      return lo <= 1e-9 || pct >= lo;
    },
    wanted ?? RERAISE_RAISE_EQUITY_SAMPLES,
    (_opp, result) => {
      const band = spot.rates.raise > 0 && pct >= reraiseFrom ? 2 : pct < foldBelow ? 0 : 1;
      n[band]++;
      sum[band] += result;
      sumSq[band] += result * result;
    }
  );
  if (equityRange === null) return null;
  let callEquityMultiway: number | null = null;
  if ((spot.pricing.othersInBands?.length ?? 0) > 0) {
    const m = omahaReraisedCallPriced(
      hole,
      dead,
      spot.preflopRaises,
      Math.min(spot.call, spot.stack),
      spot.pot,
      spot.stack,
      spot.pricing
    );
    if (m === null) return null;
    callEquityMultiway = m.equity;
  }
  return omahaReraisedRaiseEv(spot, { n, sum, sumSq, callEquityMultiway });
}
