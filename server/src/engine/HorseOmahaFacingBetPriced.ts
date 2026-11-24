/**
 * THE CORRECTED PLO4 / PLO5 CASH FACING-BET PRICE ON THE TURN AND THE RIVER (PLO-OWNER lead-6 2026-11-24; design
 * plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4 and multiway/MULTIWAY-AUDIT-AND-PLAN.md section 5). Pure: no
 * telemetry, no opponent memory, no random draw from the brain's stream. HorseLogic.omahaFacingBetEvCount applies
 * it to the facing-bet verdict (omahaFacingBetEv) when one of its options is on; every option is default OFF and
 * read `=== true`, and with all of them off nothing here runs.
 *
 *  F1 omahaFacingBetRangeIsMeasuredByLine. The bettor's range is his MEASURED strength histogram for this street,
 *     line, size and pot type (HorseOmahaMeasuredBettorRange), his own shown record shrunk toward it where he has
 *     one. The value share narrowed by 0.8 / 0.9 per earlier street and the fixed 13-19% river bluff share are not
 *     used. The Horse's share against each strength bin is an exact count (omahaEvHandCounts: river top shares,
 *     turn value regions over every river card), so the price is exact; the turn realization is today's verdict's
 *     (its 0.85 / 0.92 and caps). Heads-up only: a multiway spot is M1's (with M1 off it keeps today's verdict).
 *  F2 omahaFacingBetIndifferenceCalls. The call is made at EV >= the estimate's own error: 0 for an exact count
 *     (today's verdict and F1), the sampling error for the joint sample (M1). Exact indifference calls.
 *  F6 omahaFacingBetMinimumDefencePrior. With no record, the prior's weak share is at least the cell's
 *     minimum-defence share (see HorseOmahaMeasuredBettorRange). A record is never bounded.
 *  M1 omahaFacingBetFieldIsJoint. With another player in the hand, the bettor, every caller, every earlier all-in
 *     and every player still to act (at his measured continue rate, his call added to the pot when he continues)
 *     are dealt on the same cards (HorseOmahaPricedJointSample), the bettor from his measured range for a bet into
 *     several players, the others from the measured calling range. Heads-up spots are not touched by M1.
 *  M2 omahaMultiwayCallNeedsNutShare. Inside M1's sample, the field holds flush draws at the measured share of
 *     callers, and the share of the Horse's wins over the bettor lost to a same-category hand of the field is
 *     reported; it is an input to M1's price, never a rule of its own.
 *
 * Every fold and call stays an EV comparison on this hand, this opponent and this price. No input reads whether an
 * opponent is a person or a Horse, a user id or a name (the identity law covers this file). Only the public node,
 * the Horse's own cards and the known dead cards are read.
 */
import type { Card } from '../types.js';
import {
  omahaEvHandCounts,
  type OmahaFacingBetEvSpot,
  type OmahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_MEASURED_BIN_EDGES,
  OMAHA_MEASURED_BINS,
  omahaMeasuredBettorRange,
  omahaMeasuredCallerHist,
  omahaMeasuredContinueRate,
  omahaMeasuredFlushDrawShare,
  type OmahaMeasuredLine,
  type OmahaMeasuredRecord,
} from './HorseOmahaMeasuredBettorRange.js';
import { omahaPricedJointRows } from './HorseOmahaPricedJointSample.js';

export interface OmahaPricedFacingOptions {
  range: boolean;
  indifference: boolean;
  minDefence: boolean;
  jointField: boolean;
  nutShare: boolean;
}

export function omahaPricedFacingOptionsOf(
  opts: Readonly<Record<string, unknown>>
): OmahaPricedFacingOptions {
  return {
    range: opts.omahaFacingBetRangeIsMeasuredByLine === true,
    indifference: opts.omahaFacingBetIndifferenceCalls === true,
    minDefence: opts.omahaFacingBetMinimumDefencePrior === true,
    jointField: opts.omahaFacingBetFieldIsJoint === true,
    nutShare: opts.omahaMultiwayCallNeedsNutShare === true,
  };
}

/** Any turn / river option of this file is on. */
export function omahaPricedFacingAnyOn(o: OmahaPricedFacingOptions): boolean {
  return o.range || o.indifference || o.jointField;
}

export interface OmahaPricedFacingInput {
  variant: string;
  spot: OmahaFacingBetEvSpot;
  /** today's verdict for the same spot (its realization, field factor, margin and EV) */
  base: OmahaFacingBetEvVerdict;
  hole: Card[];
  board: Card[];
  dead: Card[];
  line: OmahaMeasuredLine;
  record: OmahaMeasuredRecord | null;
  /** today's public read factor on the non-value share (the verdict's bluff share over its prior); 1 with none */
  readFactor: number;
  rake: number;
}

export interface OmahaPricedFacingVerdict {
  call: boolean;
  ev: number;
  margin: number;
  pWin: number;
  pTie: number;
  /** which part priced it: the measured range exactly, the joint field sample, or today's EV at the F2 margin */
  priced: 'range' | 'joint' | 'margin';
  weak: number | null;
  source: 'record' | 'prior' | null;
  bounded: boolean;
  nutShareLoss: number | null;
}

/** The Horse's win and tie shares against each strength bin of holdings, exact (river: top shares; turn: per river card). */
export function omahaPricedBinShares(
  hole: Card[],
  board: Card[],
  dead: Card[]
): { win: number[]; tie: number[] } | null {
  const edges = OMAHA_MEASURED_BIN_EDGES;
  const S = new Array<number>(edges.length).fill(0);
  const W = new Array<number>(edges.length).fill(0);
  const T = new Array<number>(edges.length).fill(0);
  if (board.length === 5) {
    const hc = omahaEvHandCounts(hole, board, dead, 0.5);
    if (!hc) return null;
    for (let e = 1; e < edges.length; e++) {
      if (edges[e] >= 1) {
        S[e] = 1;
        W[e] = hc.all.win;
        T[e] = hc.all.tie;
      } else {
        const t = hc.top(edges[e]);
        S[e] = t.share;
        W[e] = t.win;
        T[e] = t.tie;
      }
    }
  } else if (board.length === 4) {
    let all: { win: number; tie: number } | null = null;
    for (let e = 1; e < edges.length; e++) {
      if (edges[e] >= 1) {
        if (!all) {
          const hc = omahaEvHandCounts(hole, board, dead, 0.5);
          if (!hc) return null;
          all = hc.all;
        }
        S[e] = 1;
        W[e] = all.win;
        T[e] = all.tie;
      } else {
        const hc = omahaEvHandCounts(hole, board, dead, edges[e]);
        if (!hc) return null;
        S[e] = hc.valueShare;
        W[e] = hc.value.win;
        T[e] = hc.value.tie;
        if (!all) all = hc.all;
      }
    }
  } else return null;
  const win: number[] = [];
  const tie: number[] = [];
  for (let b = 0; b < OMAHA_MEASURED_BINS; b++) {
    const d = S[b + 1] - S[b];
    if (d > 1e-9) {
      win.push(Math.max(0, Math.min(1, (S[b + 1] * W[b + 1] - S[b] * W[b]) / d)));
      tie.push(Math.max(0, Math.min(1, (S[b + 1] * T[b + 1] - S[b] * T[b]) / d)));
    } else {
      win.push(Math.max(0, Math.min(1, W[b + 1])));
      tie.push(Math.max(0, Math.min(1, T[b + 1])));
    }
  }
  return { win, tie };
}

/**
 * The corrected verdict, or null where none of the options prices this spot (the caller keeps today's verdict).
 */
export function omahaPricedFacingVerdict(
  input: OmahaPricedFacingInput,
  o: OmahaPricedFacingOptions
): OmahaPricedFacingVerdict | null {
  const { spot, base, hole, board, dead } = input;
  if (hole.length !== 4 && hole.length !== 5) return null;
  const street = spot.street;
  const multi = spot.callers + spot.allIns + spot.behind > 0;
  const into = multi ? 'mw' : 'hu';
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(input.rake) ? input.rake : 0));
  const realization = Number.isFinite(base.realization) ? base.realization : 1;
  const exactMargin = (margin: number): number => (o.indifference ? 0 : margin);
  const decide = (ev: number, margin: number): boolean =>
    o.indifference ? ev >= margin : ev > margin;
  const rangeOf = () =>
    omahaMeasuredBettorRange(input.variant, street, input.line, spot.potFrac, into, {
      record: input.record,
      readFactor: input.readFactor,
      minDefence: o.minDefence,
    });

  // M1 (multiway): the joint sample on measured ranges.
  if (o.jointField && multi) {
    const range = rangeOf();
    const callerHist = omahaMeasuredCallerHist(input.variant, street, spot.potFrac, 'mw');
    const cont = omahaMeasuredContinueRate(input.variant, street, spot.potFrac, 'mw');
    if (range && callerHist && cont !== null) {
      const fd =
        o.nutShare && street === 'turn'
          ? Array.from({ length: OMAHA_MEASURED_BINS }, (_, b) =>
              omahaMeasuredFlushDrawShare(input.variant, 'turn', b)
            )
          : null;
      const joint = omahaPricedJointRows(hole, board, dead, range.hist, {
        always: Array.from({ length: spot.callers + spot.allIns }, () => callerHist),
        behind: spot.behind,
        continueRate: cont,
        behindHist: callerHist,
        flushDrawByBin: fd,
      });
      if (joint) {
        const share = (1 - range.weak) * joint.value + range.weak * joint.weak;
        const winnable = (spot.winnable + joint.behindIn * spot.paid) * (1 - rake);
        const ev = realization * share * (winnable + spot.paid) - spot.paid;
        const se = ((winnable + spot.paid) * joint.sd) / Math.sqrt(Math.max(1, joint.samples));
        const margin = o.indifference ? se : base.margin;
        return {
          call: decide(ev, margin),
          ev,
          margin,
          pWin: share * realization,
          pTie: 0,
          priced: 'joint',
          weak: range.weak,
          source: range.source,
          bounded: range.bounded,
          nutShareLoss: o.nutShare ? joint.nutShareLoss : null,
        };
      }
    }
  }

  // F1: the measured range, exact, heads-up (a multiway spot is M1's: the stated field factors on top of a measured
  // multiway range would count the field twice; with M1 off a multiway spot keeps today's verdict).
  if (o.range && !multi) {
    const range = rangeOf();
    const bins = range ? omahaPricedBinShares(hole, board, dead) : null;
    if (range && bins) {
      let pWin = 0;
      let pTie = 0;
      for (let b = 0; b < OMAHA_MEASURED_BINS; b++) {
        pWin += range.hist[b] * bins.win[b];
        pTie += range.hist[b] * bins.tie[b];
      }
      const field = multi && Number.isFinite(base.field) ? base.field : 1;
      pWin *= field * realization;
      pTie *= field * realization;
      const win = spot.winnable * (1 - rake);
      const pLose = Math.max(0, 1 - pWin - pTie);
      const ev = pWin * win + pTie * ((win - spot.paid) / 2) - pLose * spot.paid;
      const margin = exactMargin(base.margin);
      return {
        call: decide(ev, margin),
        ev,
        margin,
        pWin,
        pTie,
        priced: 'range',
        weak: range.weak,
        source: range.source,
        bounded: range.bounded,
        nutShareLoss: null,
      };
    }
  }

  // F2 alone: today's EV at the indifference margin.
  if (o.indifference && Number.isFinite(base.ev)) {
    return {
      call: base.ev >= 0,
      ev: base.ev,
      margin: 0,
      pWin: base.pWin,
      pTie: base.pTie,
      priced: 'margin',
      weak: null,
      source: null,
      bounded: false,
      nutShareLoss: null,
    };
  }
  return null;
}
