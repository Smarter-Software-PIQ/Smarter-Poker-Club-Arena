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
 *  - OTHER PLAYERS IN THE HAND (review of 59ea78d08f3, B1): the arithmetic
 *    above is the heads-up spot (nobody but the Horse and the re-raiser still
 *    in). With anyone else in the hand, in for the price, still to act or all
 *    in, the spot is priced by omahaReraisedRaiseMultiwayPriced below: every
 *    such player holds a hand of his own band and answers the raise by the
 *    measured share of players in his situation, and the pot is settled with
 *    side pots. Nobody is priced as folding by assumption, and nobody's answer
 *    is assumed: a player whose band cannot be read leaves the spot unpriced.
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
import { omahaReraisedEquity, omahaReraisedEquityAgainst } from './HorseOmahaReraisedPot.js';
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
  /**
   * Present when other players were in the hand: the spot was priced with them in it, at both measured ends of
   * their fold shares (omahaReraisedRaiseMultiwayPriced reproduces it from the cards; omahaReraisedRaiseEv does
   * not apply). `samples` then holds hero's heads-up results against the re-raiser's bands on the joint run.
   */
  multiway?: OmahaReraisedMultiwayReceipt;
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

/*
 * ---------------------------------------------------------------------------
 * OTHER PLAYERS IN THE HAND (2026-11-19; review of 59ea78d08f3, item B1, at its
 * root). The first build priced every other player as folding to the raise; the
 * second priced nothing unless the hand was heads-up. From here a spot with
 * other players is PRICED WITH THEM IN IT:
 *
 *  - every other player still in the hand holds a hand from his own band (the
 *    calling rule's HorseMind.bandFor of his line; a player with no voluntary
 *    action yet holds any hand), sampled together with the re-raiser's, without
 *    replacement, by the calling rule's multiway sampler;
 *  - he answers the raise by his hand: he folds the bottom share of his band and
 *    continues with the rest. The share is MEASURED (the table below), by what
 *    he had done when the raise came: he had called the re-raise ('caller'), he
 *    had raised earlier and not yet answered the re-raise ('pendingRaiser'), or
 *    neither ('pending'). A player already all in cannot fold;
 *  - each sample is then one whole outcome of the raise: who folded, who is in,
 *    what each put in (capped by his stack), the main pot and every side pot,
 *    and hero's share of each by the showdown of the hands still in. Money put
 *    in by a player who folds stays in the pot. What nobody can match comes
 *    back uncalled. EV(raise) is the mean over the samples, so no probability
 *    of any combination of answers is assumed: it comes from the hands;
 *  - realization: omahaReraisedCallRealization at the stack-to-pot ratio that
 *    outcome leaves, in position only when no player still in with chips behind
 *    acts after hero (seat order);
 *  - EV(call) is the calling rule's omahaReraisedCallEv on its own definition of
 *    the equity (against the re-raiser and everyone in for the price), taken on
 *    the same samples (common random numbers);
 *  - the re-raiser's answer is his own record, exactly as heads-up.
 *
 * NO PER-PLAYER RECORD of a third player's answer exists, and the engine does
 * not know whether he is a Horse. The measured groups differ widely (a Horse
 * that called a 3-bet folds to a 4-bet 0.60 of the time, a person 0.16). So the
 * spot is priced TWICE on the same samples, with every third player at the
 * lowest measured fold share of his kind and with every one at the highest, and
 * the verdict is a raise only when BOTH clear the bar. The bar's standard error
 * adds, for each third player, the variance of that measured share (its count)
 * by the difference between the outcomes where he folds and where he continues.
 *
 * THE MEASUREMENT (production hand_history through the read-only helper,
 * PLO4/PLO5 cash, hands with a person at the table, 2026-10-15 to 2026-11-17
 * 00:00Z, 758 player-rows; archive repairs/CALL-OR-RAISE-2/third-player-*.{sql,
 * txt}): for every third raise of a preflop street or later one, every player
 * other than its maker and the maker of the raise before it, at his first
 * action after it while it is still the last raise. folds / spots:
 *
 *   the raise is a 4-bet   caller         people 7/45, people without the most
 *                                         frequent one 5/14, Horses 55/91
 *                          pendingRaiser  people 20/63, without 1/9, Horses 83/147
 *                          pending        people 44/53, without 18/21, Horses 541/624
 *   a 5-bet or later       caller         people 0/7, without 0/2, Horses 2/17
 *                          pendingRaiser  people 5/12, without 2/6, Horses 8/26
 *                          pending        people 8/10, without 2/4, Horses 15/31
 *
 * `low` and `high` below are the lowest and highest of the three measured
 * groups of each cell. Thin cells are thin: their variance is in the bar.
 * Limits, stated: a third player who continues is priced as calling (his own
 * re-raise is not a separate branch); when the re-raiser re-raises and hero
 * continues, the third players who continued are taken to put the same again;
 * dead money sits in the main pot; one rake share for every outcome.
 */
export type OmahaReraisedOtherKind = 'caller' | 'pendingRaiser' | 'pending' | 'allIn';
export interface OmahaReraisedOtherPlayer {
  kind: OmahaReraisedOtherKind;
  /** what he has in on this street, and behind */
  bet: number;
  stack: number;
  /** the percentile band of his line (HorseMind.bandFor), or [0, 1] with no voluntary action yet */
  band: readonly [number, number];
  /** the calling rule counts him in its equity (he has called the price, or is all in for more than a blind) */
  inForPrice: boolean;
  /** he acts after hero on every later street (seat order) */
  afterHero: boolean;
}
export interface ThirdPlayerFoldMeasure {
  folds: number;
  spots: number;
}
export type ThirdPlayerRaiseLevel = 'fourBet' | 'fiveBetOrLater';
/** The measured fold share of a third player facing the raise: lowest and highest measured group (see above). */
export const RERAISE_THIRD_PLAYER_FOLD: Readonly<
  Record<
    ThirdPlayerRaiseLevel,
    Readonly<
      Record<
        Exclude<OmahaReraisedOtherKind, 'allIn'>,
        { low: ThirdPlayerFoldMeasure; high: ThirdPlayerFoldMeasure }
      >
    >
  >
> = {
  fourBet: {
    caller: { low: { folds: 7, spots: 45 }, high: { folds: 55, spots: 91 } },
    pendingRaiser: { low: { folds: 1, spots: 9 }, high: { folds: 83, spots: 147 } },
    pending: { low: { folds: 44, spots: 53 }, high: { folds: 541, spots: 624 } },
  },
  fiveBetOrLater: {
    caller: { low: { folds: 0, spots: 7 }, high: { folds: 2, spots: 17 } },
    pendingRaiser: { low: { folds: 8, spots: 26 }, high: { folds: 5, spots: 12 } },
    pending: { low: { folds: 15, spots: 31 }, high: { folds: 8, spots: 10 } },
  },
};
/** Samples of the joint run (the heads-up run's count: one error budget for both). */
export const RERAISE_RAISE_MULTIWAY_SAMPLES = RERAISE_RAISE_EQUITY_SAMPLES;

/** The level of the raise hero would make: with two raises made it is a 4-bet. */
export function thirdPlayerRaiseLevelOf(preflopRaises: number): ThirdPlayerRaiseLevel {
  return preflopRaises <= 2 ? 'fourBet' : 'fiveBetOrLater';
}
/** A measured share and the variance its count leaves (a Jeffreys-smoothed binomial, so 0 of 7 is not certain). */
export function thirdPlayerFoldShare(m: ThirdPlayerFoldMeasure): {
  fold: number;
  variance: number;
} {
  const fold = m.spots > 0 ? m.folds / m.spots : 0;
  const smooth = (m.folds + 0.5) / (m.spots + 1);
  return { fold, variance: (smooth * (1 - smooth)) / (m.spots + 1) };
}

/** One end of the measured range of the third players' fold shares, priced. */
export interface OmahaReraisedMultiwayEnd {
  verdict: 'raise' | 'stand';
  /** each third player's fold share at this end, in the order of `others` (0 for a player all in) */
  foldShares: number[];
  evRaise: number;
  edge: number;
  se: number;
  seSampling: number;
  seRates: number;
  /** the part of seRates that is the third players' shares */
  seThirdPlayers: number;
  seRealization: number;
  /** share of the samples in which: everyone folds; only the re-raiser continues; any third player continues */
  shareAllFold: number;
  shareHeadsUp: number;
  shareMultiway: number;
  /** mean result of the raise where at least one third player continues (null: no such sample) */
  evWhenMultiway: number | null;
  continues: boolean;
}
export interface OmahaReraisedMultiwayReceipt {
  others: OmahaReraisedOtherPlayer[];
  level: ThirdPlayerRaiseLevel;
  samples: number;
  /** hero's share against the re-raiser and everyone in for the price, on these samples (the call's equity) */
  equityCall: number;
  low: OmahaReraisedMultiwayEnd;
  high: OmahaReraisedMultiwayEnd;
  /** the end the receipt's main numbers are taken from: the one nearer its bar */
  binding: 'low' | 'high';
}
export interface OmahaReraisedRaiseMultiwayInput extends OmahaReraisedRaiseInput {
  others: readonly OmahaReraisedOtherPlayer[];
  /** evaluation and tests only: a fold share for every third player in place of the measured ends */
  thirdPlayerFoldOverride?: { low: number; high: number };
  /** evaluation and tests only: the realization's depth costs moved by this many of their standard errors */
  depthCostShiftSe?: number;
  /** evaluation and tests only: price a heads-up spot on the joint run too (the engine uses omahaReraisedRaisePriced) */
  allowNoOthers?: boolean;
}

export interface OmahaReraisedPotSeat {
  /** what he has in on this street when the betting is over */
  c: number;
  /** still in the hand (a player who folded leaves his money in the pot) */
  live: boolean;
  score: number;
}
type Seat = OmahaReraisedPotSeat;
/** Hero's chips out of the pots: main and side pots by the scores of the seats still in (hero is seats[0]). */
export function heroShareOfPots(
  seats: readonly Seat[],
  dead: number
): { won: number; pot: number } {
  const levels = [...new Set(seats.map((s) => s.c).filter((c) => c > 1e-9))].sort((a, b) => a - b);
  let prev = 0;
  let won = 0;
  let pot = 0;
  const hero = seats[0]!;
  for (let k = 0; k < levels.length; k++) {
    const level = levels[k]!;
    let amount = 0;
    let best = -Infinity;
    let tied = 0;
    for (const s of seats) {
      if (s.c < level - 1e-9) continue;
      amount += level - prev;
      if (!s.live) continue;
      if (s.score > best) {
        best = s.score;
        tied = 1;
      } else if (s.score === best) tied++;
    }
    if (k === 0) amount += dead;
    pot += amount;
    if (hero.c >= level - 1e-9 && hero.score === best && tied > 0) won += amount / tied;
    prev = level;
  }
  if (levels.length === 0) {
    pot = dead;
    won = dead;
  }
  return { won, pot };
}

/**
 * The priced call-or-raise with other players in the hand: one joint run of the
 * sampler, priced at both measured ends of the third players' fold shares.
 * Null when it cannot be priced (the standing decision then stands, unpriced).
 */
export function omahaReraisedRaiseMultiwayPriced(
  i: OmahaReraisedRaiseMultiwayInput
): OmahaReraisedRaiseReceipt | null {
  const { hole, dead, samples: wanted, others: others0, ...rest } = i;
  const { thirdPlayerFoldOverride, depthCostShiftSe, allowNoOthers, ...spot } = rest;
  const others = others0.map((o) => ({ ...o, band: [o.band[0], o.band[1]] as const }));
  const { pricing: p, rates } = spot;
  const call = Math.min(spot.call, spot.stack);
  if (others.length === 0 && allowNoOthers !== true) return null;
  if (!(call > 0.005) || !(spot.pot > 0) || !(spot.stack > 0)) return null;
  if (![rates.fold, rates.call, rates.raise].every((x) => Number.isFinite(x) && x >= 0))
    return null;
  if (Math.abs(rates.fold + rates.call + rates.raise - 1) > 1e-6) return null;
  for (const o of others) {
    if (![o.bet, o.stack, o.band[0], o.band[1]].every((x) => Number.isFinite(x) && x >= 0))
      return null;
    if (!(o.band[1] > o.band[0])) return null;
  }
  const heroTo = Math.min(spot.raiseTo, spot.heroBet + spot.stack);
  if (!(heroTo - spot.heroBet > call + 0.005)) return null;
  const raiserBet = Math.max(0, spot.raiserBet);
  const raiserStack = Math.max(0, spot.raiserStack);
  const { width, lo, foldBelow, reraiseFrom } = omahaReraisedRaiseBands(spot);
  const level = thirdPlayerRaiseLevelOf(spot.preflopRaises);

  // ONE joint run: the re-raiser's whole range and every other player's band.
  const K = others.length;
  const pct = new Array<number>(K + 1).fill(0);
  const pctOf: number[][] = [];
  const scoreOf: number[][] = [];
  const ranges: ((h: readonly Card[]) => boolean)[] = [
    (h) => {
      pct[0] = omahaPreflopPercentile([...h], false);
      return lo <= 1e-9 || pct[0] >= lo;
    },
    ...others.map((o, j) => (h: readonly Card[]) => {
      pct[j + 1] = omahaPreflopPercentile([...h], false);
      return pct[j + 1]! >= o.band[0] && pct[j + 1]! <= o.band[1];
    }),
  ];
  const drawn = omahaReraisedEquityAgainst(
    hole,
    dead,
    ranges,
    wanted ?? RERAISE_RAISE_MULTIWAY_SAMPLES,
    (mine, opp) => {
      pctOf.push(pct.slice());
      scoreOf.push([mine, ...opp]);
    }
  );
  if (drawn === null) return null;
  const N = scoreOf.length;
  if (!(N > 1)) return null;

  // The call, on the calling rule's own definition of the equity, same samples.
  let callSum = 0;
  let headsUpSum = 0;
  const callResult = new Float64Array(N);
  const zN: [number, number, number] = [0, 0, 0];
  const zSum: [number, number, number] = [0, 0, 0];
  const zSumSq: [number, number, number] = [0, 0, 0];
  for (let s = 0; s < N; s++) {
    const sc = scoreOf[s]!;
    const mine = sc[0]!;
    let best = Math.max(mine, sc[1]!);
    let tied = (mine === best ? 1 : 0) + (sc[1] === best ? 1 : 0);
    const hu = mine > sc[1]! ? 1 : mine === sc[1] ? 0.5 : 0;
    headsUpSum += hu;
    const zp = pctOf[s]![0]!;
    const band = rates.raise > 0 && zp >= reraiseFrom ? 2 : zp < foldBelow ? 0 : 1;
    zN[band]++;
    zSum[band] += hu;
    zSumSq[band] += hu * hu;
    for (let j = 0; j < K; j++) {
      if (!others[j]!.inForPrice) continue;
      const v = sc[j + 2]!;
      if (v > best) {
        best = v;
        tied = 1;
      } else if (v === best) tied++;
    }
    callResult[s] = mine === best ? 1 / tied : 0;
    callSum += callResult[s]!;
  }
  const equityCall = callSum / N;
  const callNumbers = omahaReraisedCallEv(equityCall, width, call, spot.pot, spot.stack, p);
  const rakeCall = clamp(Number.isFinite(p.rakeFraction) ? p.rakeFraction : 0, 0, 0.5);
  const rakeCalled = clamp(Number.isFinite(spot.rakeCalled) ? spot.rakeCalled : rakeCall, 0, 0.5);
  const standingIsCall = spot.standing === 'call';
  const shift = Number.isFinite(depthCostShiftSe) ? (depthCostShiftSe as number) : 0;
  // The realization, with the evaluation's shift of the depth cost (0 in the engine): R = 1 - cost x depth.
  const realization = (inPosition: boolean, spr: number, n: number): number => {
    const r0 = omahaReraisedCallRealization(inPosition, spr, n, 0);
    if (shift === 0 || !(spr > 1e-9)) return r0;
    const side = inPosition ? 'ip' : 'oop';
    const depth = spr / (spr + RERAISE_CALL_DEPTH_HALF[side]);
    return clamp(
      r0 - shift * RERAISE_RAISE_DEPTH_COST_SE[side] * depth,
      RERAISE_CALL_REALIZATION_MIN,
      1
    );
  };
  const callRealization =
    shift === 0
      ? callNumbers.realization
      : realization(p.inPosition, callNumbers.sprAfter, p.othersIn);
  const callCoef = callRealization * (spot.pot + call) * (1 - rakeCall);
  const evCall = callCoef * equityCall - call;
  // money in the pot that belongs to nobody still in the hand
  const deadMoney = Math.max(
    0,
    spot.pot - spot.heroBet - raiserBet - others.reduce((a, o) => a + o.bet, 0)
  );
  const heroAll = spot.heroBet + spot.stack;

  const priceEnd = (end: 'low' | 'high'): OmahaReraisedMultiwayEnd => {
    const share = others.map((o) => {
      if (o.kind === 'allIn') return { fold: 0, variance: 0 };
      if (thirdPlayerFoldOverride)
        return { fold: clamp(thirdPlayerFoldOverride[end], 0, 1), variance: 0 };
      return thirdPlayerFoldShare(RERAISE_THIRD_PLAYER_FOLD[level][o.kind][end]);
    });
    const foldUnder = others.map((o, j) => o.band[0] + share[j]!.fold * (o.band[1] - o.band[0]));
    const x = new Float64Array(N); // the raise's result, sample by sample
    const slopeIp = new Float64Array(N);
    const slopeOop = new Float64Array(N);
    // the re-raiser re-raises and chips are left: the result of continuing, and of giving up
    const cont = new Float64Array(N);
    const contSlopeIp = new Float64Array(N);
    const contSlopeOop = new Float64Array(N);
    const giveUp = new Float64Array(N);
    const reraised = new Uint8Array(N);
    const inMask: boolean[][] = [];
    let nAllFold = 0;
    let nHeadsUp = 0;
    let nMulti = 0;
    for (let s = 0; s < N; s++) {
      const sc = scoreOf[s]!;
      const pc = pctOf[s]!;
      const zBand = rates.raise > 0 && pc[0]! >= reraiseFrom ? 2 : pc[0]! < foldBelow ? 0 : 1;
      const stays = others.map((o, j) => o.kind === 'allIn' || pc[j + 1]! >= foldUnder[j]!);
      inMask.push(stays);
      const anyThird = stays.some((v, j) => v && others[j]!.kind !== 'allIn');
      const build = (
        more: number
      ): {
        seats: Seat[];
        heroC: number;
        left: number[];
        after: boolean[];
      } => {
        const seats: Seat[] = [{ c: 0, live: true, score: sc[0]! }];
        const left: number[] = [];
        const after: boolean[] = [];
        let top = 0;
        const zIn = zBand !== 0;
        const zC = zIn ? Math.min(raiserBet + raiserStack, heroTo + more) : raiserBet;
        seats.push({ c: zC, live: zIn, score: sc[1]! });
        top = Math.max(top, zC);
        if (zIn) {
          left.push(raiserBet + raiserStack - zC);
          after.push(!p.inPosition);
        }
        for (let j = 0; j < K; j++) {
          const o = others[j]!;
          const inHand = stays[j]!;
          const c =
            o.kind === 'allIn' ? o.bet : inHand ? Math.min(o.bet + o.stack, heroTo + more) : o.bet;
          seats.push({ c, live: inHand, score: sc[j + 2]! });
          top = Math.max(top, c);
          if (inHand) {
            left.push(o.kind === 'allIn' ? 0 : o.bet + o.stack - c);
            after.push(o.afterHero);
          }
        }
        // what nobody can match comes back; hero never has less in than he already has
        const heroC = Math.max(spot.heroBet, Math.min(heroTo + more, heroAll, top));
        seats[0]!.c = heroC;
        return { seats, heroC, left, after };
      };
      const settle = (
        b: ReturnType<typeof build>,
        allInNow: boolean
      ): { value: number; slope: number; ip: boolean; pot: number; behind: number } => {
        const { won, pot } = heroShareOfPots(b.seats, deadMoney);
        const heroLeft = heroAll - b.heroC;
        let oppLeft = 0;
        let ip = true;
        for (let k = 0; k < b.left.length; k++) {
          if (b.left[k]! > 0.005) {
            oppLeft = Math.max(oppLeft, b.left[k]!);
            if (b.after[k]) ip = false;
          }
        }
        const behind = Math.max(0, Math.min(heroLeft, oppLeft));
        const spr = pot > 0 ? behind / pot : 0;
        const r = allInNow || !(behind > 0.005) ? 1 : realization(ip, spr, b.left.length - 1);
        const slope =
          allInNow || !(behind > 0.005) ? 0 : realizationSlope(ip, spr, r) * won * (1 - rakeCalled);
        return {
          value: r * won * (1 - rakeCalled) - (b.heroC - spot.heroBet),
          slope,
          ip,
          pot,
          behind,
        };
      };
      const called = build(0);
      const nobody = called.seats.every((seat, k) => k === 0 || !seat.live);
      if (nobody) {
        x[s] = spot.pot; // everyone folds: the pot as it stands
        nAllFold++;
        continue;
      }
      if (anyThird) nMulti++;
      else nHeadsUp++;
      const first = settle(called, false);
      x[s] = first.value;
      if (first.ip) slopeIp[s] = first.slope;
      else slopeOop[s] = first.slope;
      // His re-raise needs chips behind for him and for hero once the raise is called.
      const zLeft = raiserBet + raiserStack - called.seats[1]!.c;
      const heroLeft = heroAll - called.heroC;
      if (zBand === 2 && zLeft > 0.005 && heroLeft > 0.005) {
        const between = Math.min(zLeft, heroLeft);
        const sprHZ = first.pot > 0 ? between / first.pot : 0;
        const allInNow = sprHZ <= 1 + 1e-9;
        const more = allInNow ? between : Math.min(first.pot, between);
        const second = settle(build(more), allInNow);
        reraised[s] = 1;
        cont[s] = second.value;
        if (second.ip) contSlopeIp[s] = second.slope;
        else contSlopeOop[s] = second.slope;
        giveUp[s] = -(called.heroC - spot.heroBet);
      }
    }
    // Continue against his re-raise or give up: one decision for the whole band (hero does not see his cards).
    let contSum = 0;
    let giveSum = 0;
    let nRe = 0;
    for (let s = 0; s < N; s++)
      if (reraised[s]) {
        contSum += cont[s]!;
        giveSum += giveUp[s]!;
        nRe++;
      }
    const continues = nRe > 0 && contSum > giveSum;
    let sum = 0;
    let dSum = 0;
    let dSumSq = 0;
    let sIp = 0;
    let sOop = 0;
    let multiSum = 0;
    const g: [number, number, number] = [0, 0, 0];
    const gN: [number, number, number] = [0, 0, 0];
    const foldSum = new Array<number>(K).fill(0);
    const foldN = new Array<number>(K).fill(0);
    const staySum = new Array<number>(K).fill(0);
    const stayN = new Array<number>(K).fill(0);
    for (let s = 0; s < N; s++) {
      let v = x[s]!;
      if (reraised[s]) {
        v = continues ? cont[s]! : giveUp[s]!;
        sIp += continues ? contSlopeIp[s]! : 0;
        sOop += continues ? contSlopeOop[s]! : 0;
      } else {
        sIp += slopeIp[s]!;
        sOop += slopeOop[s]!;
      }
      sum += v;
      const d = v - (standingIsCall ? callCoef * callResult[s]! - call : 0);
      dSum += d;
      dSumSq += d * d;
      const pc = pctOf[s]!;
      const zBand = rates.raise > 0 && pc[0]! >= reraiseFrom ? 2 : pc[0]! < foldBelow ? 0 : 1;
      g[zBand] += v;
      gN[zBand]++;
      const stays = inMask[s]!;
      let third = false;
      for (let j = 0; j < K; j++) {
        if (stays[j]) {
          staySum[j] += v;
          stayN[j]++;
          if (others[j]!.kind !== 'allIn') third = true;
        } else {
          foldSum[j] += v;
          foldN[j]++;
        }
      }
      if (third) multiSum += v;
    }
    const evRaise = sum / N;
    const edge = dSum / N;
    const seSampling = Math.sqrt(Math.max(0, (dSumSq - (dSum * dSum) / N) / (N - 1)) / N);
    // The re-raiser's rates: the Dirichlet posterior of his answers, by the values of his three bands.
    const answered = rates.counts.fold + rates.counts.call + rates.counts.raise;
    const alpha0 = answered + RERAISE_RESPONSE_PRIOR_MASS;
    const ps = [rates.fold, rates.call, rates.raise];
    let m1 = 0;
    let m2 = 0;
    for (let b = 0; b < 3; b++) {
      const gb = gN[b]! > 0 ? g[b]! / gN[b]! : 0;
      m1 += gb * ps[b]!;
      m2 += gb * gb * ps[b]!;
    }
    const varRaiser = Math.max(0, m2 - m1 * m1) / (alpha0 + 1);
    // Each third player's measured share: the difference between the outcomes where he folds and where he stays.
    let varThird = 0;
    for (let j = 0; j < K; j++) {
      if (!(foldN[j]! > 0) || !(stayN[j]! > 0)) continue;
      const diff = foldSum[j]! / foldN[j]! - staySum[j]! / stayN[j]!;
      varThird += diff * diff * share[j]!.variance;
    }
    const seRates = Math.sqrt(varRaiser + varThird);
    const slopeCall = standingIsCall
      ? realizationSlope(p.inPosition, callNumbers.sprAfter, callRealization) *
        equityCall *
        (spot.pot + call) *
        (1 - rakeCall)
      : 0;
    const netIp = sIp / N - (p.inPosition ? slopeCall : 0);
    const netOop = sOop / N - (p.inPosition ? 0 : slopeCall);
    const seRealization = Math.sqrt(
      (netIp * RERAISE_RAISE_DEPTH_COST_SE.ip) ** 2 +
        (netOop * RERAISE_RAISE_DEPTH_COST_SE.oop) ** 2
    );
    const se = Math.sqrt(seSampling ** 2 + seRates ** 2 + seRealization ** 2);
    return {
      verdict: evRaise > 0 && edge > RERAISE_RAISE_SE_MULTIPLE * se ? 'raise' : 'stand',
      foldShares: share.map((v) => v.fold),
      evRaise,
      edge,
      se,
      seSampling,
      seRates,
      seThirdPlayers: Math.sqrt(varThird),
      seRealization,
      shareAllFold: nAllFold / N,
      shareHeadsUp: nHeadsUp / N,
      shareMultiway: nMulti / N,
      evWhenMultiway: nMulti > 0 ? multiSum / nMulti : null,
      continues,
    };
  };
  const low = priceEnd('low');
  const high = priceEnd('high');
  const margin = (e: OmahaReraisedMultiwayEnd): number => e.edge - RERAISE_RAISE_SE_MULTIPLE * e.se;
  const binding: 'low' | 'high' = margin(low) <= margin(high) ? 'low' : 'high';
  const b = binding === 'low' ? low : high;
  const raise = low.verdict === 'raise' && high.verdict === 'raise';
  // The heads-up shape of the called raise, for the receipt's own fields (hero and the re-raiser alone).
  const raiseToHu = Math.min(heroTo, raiserBet + raiserStack);
  const addedHu = raiseToHu - spot.heroBet;
  const raiserPays = Math.min(raiserStack, Math.max(0, raiseToHu - raiserBet));
  const potCalled = spot.pot + addedHu + raiserPays;
  const behindHu = Math.max(0, Math.min(spot.stack - addedHu, raiserStack - raiserPays));
  const sprRaise = potCalled > 0 ? behindHu / potCalled : 0;
  const canReraise = behindHu > 0.005;
  const nCalls = canReraise ? zN[1] : zN[1] + zN[2];
  const multiway: OmahaReraisedMultiwayReceipt = {
    others: others.map((o) => ({ ...o, band: [o.band[0], o.band[1]] as const })),
    level,
    samples: N,
    equityCall,
    low,
    high,
    binding,
  };
  return {
    verdict: raise ? 'raise' : 'stand',
    standing: spot.standing,
    evCall,
    evRaise: b.evRaise,
    edge: b.edge,
    se: b.se,
    seSampling: b.seSampling,
    seRates: b.seRates,
    seRealization: b.seRealization,
    width,
    pFold: rates.fold,
    pCall: canReraise ? rates.call : rates.call + rates.raise,
    pReraise: canReraise ? rates.raise : 0,
    equityRange: headsUpSum / N,
    equityCall,
    equityCallBand: nCalls > 0 ? (zSum[1] + (canReraise ? 0 : zSum[2])) / nCalls : null,
    equityReraiseBand: canReraise && zN[2] > 0 ? zSum[2] / zN[2] : null,
    realizationCall: callRealization,
    realizationRaise: realization(p.inPosition, sprRaise, p.othersIn),
    sprCall: callNumbers.sprAfter,
    sprRaise,
    added: addedHu,
    potCalled,
    evWhenCalled: b.evWhenMultiway ?? b.evRaise,
    evContinue: null,
    continues: b.continues,
    continueAllIn: sprRaise <= 1 + 1e-9,
    spot,
    samples: { n: zN, sum: zSum, sumSq: zSumSq, callEquityMultiway: equityCall },
    multiway,
  };
}

/*
 * ---------------------------------------------------------------------------
 * FOLD, CALL OR RAISE FACING A RE-RAISE, ALL THREE PRICED (option
 * omahaPreflopJamFacingReraiseIsPriced, 2026-11-19, default OFF; owner
 * complaint on hand #60156608 and the owner's 15:34 Chicago input: "just
 * calling would have been fine ... re-raising AKQQ should never be an option").
 *
 * The rules facing a 3-bet or more decide the re-raise (and the 5-bet jam) by
 * the hand's entry-score percentile against a bar: never by equity against the
 * hands that put that money in. Here every one of the three actions is priced
 * at the LOWER BOUND of hero's equity (the estimate minus twice its standard
 * error) and the largest EV is played:
 *   EV(fold)  = 0
 *   EV(call)  = the calling rule's omahaReraisedCallEv: realization at the
 *               stack-to-pot ratio the call leaves, in or out of position
 *               (the measured omahaReraisedCallRealization, REALIZATION.md;
 *               1 only when nothing is left behind) x equity against his
 *               range at this raise x the pot after the call net of rake
 *               - the call
 *   EV(raise) = P(fold) x pot + P(call) x (realization at the ratio left x
 *               equity against the hands that CONTINUE x pot called net of
 *               rake - chips added) + P(re-raise) x max(-chips added, EV of
 *               going on against the hands that raise again)
 * with his answers from his own record (reraiseResponseRatesForTheRaise).
 *
 * THE RANGES ARE MEASURED, NOT A PERCENTILE BAND ALONE. A band of the entry
 * score puts high-card hands next to aces, so a hand near its top looked like
 * a favourite against a 4-bet (AKQQx: 0.50 against the band, 0.35 against
 * aces). The composition of the hands people actually showed after making the
 * k-th raise of a preflop street (production, PLO4/PLO5 cash, hands with a
 * person, 2026-10-15 to 2026-11-17 00:00Z; archive
 * repairs/CALL-OR-RAISE-2/raise-range-*.{sql,txt}) is used as the range: the
 * share holding two aces, the share holding two kings (no two aces), and the
 * rest drawn from the band of his measured re-raise rate. The continuing range
 * against hero's raise is the measured range one raise higher. Nothing here
 * reads hero's hand class: hero's equity against those hands decides.
 * Measured (people; Horses in brackets, not used): shown after a 3-bet 600
 * (715), two aces 50 (255), two kings 43 (134); after a 4-bet 180 (323), aces
 * 31 (160), kings 14 (41); after a 5-bet or later 86 (78), aces 24 (35), kings
 * 10 (14). Limits, stated: shown hands only (a pot that ends before a showdown
 * is not in the count: 180 of 351 4-bets were shown); one pooled composition
 * of people for every opponent (a Horse raiser holds aces more often, so
 * against a Horse this prices hero's equity high); no per-player record of
 * shown hands exists; the rest of the range is the band of his re-raise rate.
 *
 * Heads-up only: with any other player still in the hand the spot is not
 * priced here.
 */
export interface OmahaRaiseRangeComposition {
  /** shown hands at this raise, of them with two aces, with two kings and fewer than two aces */
  n: number;
  aces: number;
  kings: number;
}
/** By the raise the hand was made at: 2 = a 3-bet, 3 = a 4-bet, 4 = a 5-bet or later. */
export const OMAHA_RAISE_RANGE_COMPOSITION: Readonly<
  Record<2 | 3 | 4, OmahaRaiseRangeComposition>
> = Object.freeze({
  2: { n: 600, aces: 50, kings: 43 },
  3: { n: 180, aces: 31, kings: 14 },
  4: { n: 86, aces: 24, kings: 10 },
});
export const OMAHA_THREE_WAY_SAMPLES_PER_PART = 600;
export const OMAHA_THREE_WAY_SE_MULTIPLE = 2;

const rankCount = (h: readonly Card[], r: string): number => h.filter((c) => c.rank === r).length;

/** Hero's equity against the measured range at one raise, its standard error, and the parts. */
export function omahaMeasuredRangeEquity(
  hole: readonly Card[],
  dead: readonly Card[],
  level: number,
  rate: number,
  samplesPerPart: number = OMAHA_THREE_WAY_SAMPLES_PER_PART
): {
  equity: number;
  se: number;
  parts: [number, number, number];
  shares: [number, number, number];
} | null {
  const k = Math.min(4, Math.max(2, Math.round(level))) as 2 | 3 | 4;
  const c = OMAHA_RAISE_RANGE_COMPOSITION[k];
  if (!(c.n > 0)) return null;
  const sA = c.aces / c.n;
  const sK = c.kings / c.n;
  const sR = Math.max(0, 1 - sA - sK);
  const lo = 1 - omahaReraiserRangeWidth(rate, k);
  const tests: ((h: readonly Card[]) => boolean)[] = [
    (h) => rankCount(h, 'A') >= 2,
    (h) => rankCount(h, 'K') >= 2 && rankCount(h, 'A') < 2,
    (h) =>
      rankCount(h, 'A') < 2 &&
      rankCount(h, 'K') < 2 &&
      (lo <= 1e-9 || omahaPreflopPercentile([...h], false) >= lo),
  ];
  const shares: [number, number, number] = [sA, sK, sR];
  const parts: [number, number, number] = [0, 0, 0];
  let varSampling = 0;
  for (let i = 0; i < 3; i++) {
    if (shares[i] <= 1e-9) continue;
    let n = 0;
    let s = 0;
    let s2 = 0;
    const e = omahaReraisedEquity(hole, [], dead, tests[i], samplesPerPart, (_o, r) => {
      n++;
      s += r;
      s2 += r * r;
    });
    if (e === null || n < 2) return null;
    parts[i] = e;
    varSampling += (shares[i] * shares[i] * Math.max(0, (s2 - (s * s) / n) / (n - 1))) / n;
  }
  const equity = shares[0] * parts[0] + shares[1] * parts[1] + shares[2] * parts[2];
  // the composition is itself a count: its multinomial error on the mixture
  const second = shares[0] * parts[0] ** 2 + shares[1] * parts[1] ** 2 + shares[2] * parts[2] ** 2;
  const varShares = Math.max(0, second - equity * equity) / c.n;
  return { equity, se: Math.sqrt(varSampling + varShares), parts, shares };
}

export interface OmahaThreeWayInput {
  hole: readonly Card[];
  dead: readonly Card[];
  preflopRaises: number;
  call: number;
  pot: number;
  stack: number;
  heroBet: number;
  /** hero's total on the street if he raises (capped by his stack); null: no raise is legal */
  raiseTo: number | null;
  raiserBet: number;
  raiserStack: number;
  pricing: OmahaReraisedCallPricing;
  rates: ReraiseResponsePosterior;
  rakeCalled: number;
  standing: 'fold' | 'call' | 'raise';
  samplesPerPart?: number;
}
export interface OmahaThreeWayReceipt {
  verdict: 'fold' | 'call' | 'raise';
  standing: 'fold' | 'call' | 'raise';
  /** EV of each action at the lower bound of the equities (fold is 0) */
  evCallLow: number;
  evRaiseLow: number | null;
  /** the same at the equities' estimates */
  evCall: number;
  evRaise: number | null;
  equityNow: number;
  equityNowSe: number;
  equityContinue: number | null;
  equityContinueSe: number | null;
  equityReraise: number | null;
  realizationCall: number;
  realizationRaise: number | null;
  sprRaise: number | null;
  pFold: number;
  pCall: number;
  pReraise: number;
  added: number | null;
  /** equity against the measured range's parts at this raise: two aces, two kings, the rest */
  partsNow: [number, number, number];
  sharesNow: [number, number, number];
}

export function omahaThreeWayPriced(i: OmahaThreeWayInput): OmahaThreeWayReceipt | null {
  const p = i.pricing;
  const call = Math.min(i.call, i.stack);
  if (!(call > 0.005) || !(i.pot > 0) || !(i.stack > call + 0.005)) return null;
  const k = Math.max(2, i.preflopRaises);
  const now = omahaMeasuredRangeEquity(i.hole, i.dead, k, p.rate, i.samplesPerPart);
  if (!now) return null;
  const m = OMAHA_THREE_WAY_SE_MULTIPLE;
  const width = omahaReraiserRangeWidth(p.rate, k);
  const callLow = omahaReraisedCallEv(
    Math.max(0, now.equity - m * now.se),
    width,
    call,
    i.pot,
    i.stack,
    p
  );
  const callMid = omahaReraisedCallEv(now.equity, width, call, i.pot, i.stack, p);
  const rakeCalled = clamp(Number.isFinite(i.rakeCalled) ? i.rakeCalled : p.rakeFraction, 0, 0.5);
  let evRaiseLow: number | null = null;
  let evRaise: number | null = null;
  let cont: ReturnType<typeof omahaMeasuredRangeEquity> = null;
  let again: ReturnType<typeof omahaMeasuredRangeEquity> = null;
  let realizationRaise: number | null = null;
  let sprRaise: number | null = null;
  let added: number | null = null;
  let pCall = i.rates.call;
  let pReraise = i.rates.raise;
  if (i.raiseTo !== null) {
    const raiseTo = Math.min(
      i.raiseTo,
      i.heroBet + i.stack,
      Math.max(0, i.raiserBet) + Math.max(0, i.raiserStack)
    );
    added = raiseTo - i.heroBet;
    if (added > call + 0.005) {
      cont = omahaMeasuredRangeEquity(i.hole, i.dead, k + 1, p.rate, i.samplesPerPart);
      const raiserPays = Math.min(Math.max(0, i.raiserStack), Math.max(0, raiseTo - i.raiserBet));
      const potCalled = i.pot + added + raiserPays;
      const behind = Math.max(0, Math.min(i.stack - added, i.raiserStack - raiserPays));
      sprRaise = potCalled > 0 ? behind / potCalled : 0;
      realizationRaise = omahaReraisedCallRealization(p.inPosition, sprRaise, 0, 0);
      const canReraise = behind > 0.005;
      pCall = canReraise ? i.rates.call : i.rates.call + i.rates.raise;
      pReraise = canReraise ? i.rates.raise : 0;
      if (canReraise)
        again = omahaMeasuredRangeEquity(i.hole, i.dead, k + 2, p.rate, i.samplesPerPart);
      if (cont && (!canReraise || again)) {
        const value = (eqC: number, eqA: number): number => {
          const whenCalled =
            (realizationRaise as number) * eqC * potCalled * (1 - rakeCalled) - (added as number);
          let reraised = -(added as number);
          if (canReraise) {
            const allIn = (sprRaise as number) <= 1 + 1e-9;
            const more = allIn ? behind : Math.min(potCalled, behind);
            const potFinal = potCalled + 2 * more;
            const r2 = allIn
              ? 1
              : omahaReraisedCallRealization(p.inPosition, (behind - more) / potFinal, 0, 0);
            reraised = Math.max(
              reraised,
              r2 * eqA * potFinal * (1 - rakeCalled) - ((added as number) + more)
            );
          }
          return i.rates.fold * i.pot + pCall * whenCalled + pReraise * reraised;
        };
        evRaise = value(cont.equity, again ? again.equity : 0);
        evRaiseLow = value(
          Math.max(0, cont.equity - m * cont.se),
          again ? Math.max(0, again.equity - m * again.se) : 0
        );
      }
    }
  }
  // The largest EV at the lower bound; a tie keeps the standing action.
  const ev: Record<'fold' | 'call' | 'raise', number | null> = {
    fold: 0,
    call: callLow.evCall,
    raise: evRaiseLow,
  };
  let verdict: 'fold' | 'call' | 'raise' = i.standing;
  for (const a of ['fold', 'call', 'raise'] as const) {
    const v = ev[a];
    const best = ev[verdict];
    if (v !== null && (best === null || v > best + 1e-9)) verdict = a;
  }
  // EMERG lane PREFLOP-AUDIT 2026-11-20 (plain fix inside the default-OFF option): THIS PRICING DOES NOT FOLD
  // A HAND THE STANDING RULES CONTINUE WITH. Two defects met in its fold verdict. (1) The fold is exact (0, no
  // sampling error) while the call and the raise are priced at their estimate minus two standard errors, so a
  // close hand always tipped to the fold. (2) Its realization out of position with deep stacks (0.50 for the
  // call, 0.70 for the raise at 400 bb) prices bare aces facing a single 3-bet below zero even at the estimate,
  // while aces in exactly that spot realised +15.0 +/- 13.0 bb (call) and +15.8 +/- 24.4 bb (4-bet) from
  // 2026-10-15 to 2026-11-19. Exact replay of all 1,643 journaled decisions facing a 3-bet or more (2026-11-18
  // and 11-19) with the option on: 55 standing calls and raises moved to a fold, and every class and transition
  // of those moves graded negative against the real cards (call to fold -8.5 aces, -8.1 queens/jacks, -4.8 the
  // rest; raise to fold -17.6 aces, -9.0 kings; 22 of them aces folded to one 3-bet), -496 bb in all; the 36
  // that remained after fixing (1) alone still graded -385 +/- 28. So a standing call or raise is never
  // replaced by a fold here: the better of the call and the raise at the lower bound stands (the standing one
  // on a tie). Folding those hands stays with the rules that own the fold. A standing fold still needs a lower
  // bound above zero to become a call or a raise.
  if (verdict === 'fold' && i.standing !== 'fold') {
    let kept: 'call' | 'raise' | null = null;
    for (const a of ['call', 'raise'] as const) {
      const low = ev[a];
      if (low === null) continue;
      const best = kept === null ? null : (ev[kept] as number);
      if (best === null || low > best + 1e-9 || (a === i.standing && low >= best - 1e-9)) kept = a;
    }
    if (kept !== null) verdict = kept;
  }
  // A STANDING RE-RAISE OF ACES STANDS (same lane, same day). The raise branch is realized on the curve
  // measured for CALLS of a re-raise, which prices the re-raise of aces under the call out of position and
  // deep. Measured the other way twice: over 2026-10-15 to 2026-11-19 the Horses' re-raise of aces was worth
  // +18.8 +/- 4.7 bb more than the flat call (stratified by spot and stack band; fit +20.7 +/- 6.9, held out
  // +14.7 +/- 6.6), and in the exact replay every downgrade of a standing aces re-raise by this pricing graded
  // negative against the real cards. Aces are still priced from a fold or a call upward.
  if (i.standing === 'raise' && verdict !== 'raise' && rankCount(i.hole, 'A') >= 2)
    verdict = 'raise';
  return {
    verdict,
    standing: i.standing,
    evCallLow: callLow.evCall,
    evRaiseLow,
    evCall: callMid.evCall,
    evRaise,
    equityNow: now.equity,
    equityNowSe: now.se,
    equityContinue: cont ? cont.equity : null,
    equityContinueSe: cont ? cont.se : null,
    equityReraise: again ? again.equity : null,
    realizationCall: callLow.realization,
    realizationRaise,
    sprRaise,
    pFold: i.rates.fold,
    pCall,
    pReraise,
    added,
    partsNow: now.parts,
    sharesNow: now.shares,
  };
}
