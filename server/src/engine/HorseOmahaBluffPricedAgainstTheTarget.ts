/**
 * EVERY OMAHA BLUFF AND THIN BET IS PRICED AGAINST THE PERSON IN THE POT (HORSE DECISIONS lane,
 * 2026-11-19; option omahaBluffIsPricedAgainstTheTarget, default OFF, read `=== true`).
 *
 * Owner, 2026-11-17 11:49 Chicago: no blanket rules; every decision by math, ranges, equity and EV.
 * Owner, the same day: the size of a bet never makes or breaks a decision; it only feeds the price.
 *
 * The 48-hour audit of PLO5 Lightning cash against persons (archive plo-handoff-review-01a1cbbd/
 * hvh48-audit-01TLQer7J/A-plo5-lightning, classes 2 and 4) found two leaks no priced comparison covered:
 *  - BLUFFS AND THIN BETS (class 2, 47 CLEAR+LIKELY flags): the river bluff baseline, the river
 *    nut-blocker bluff, the card-impact press bets and the thin bets of the other owners bet without
 *    pricing the bet against the measured fold rate of the person who must answer it.
 *  - MISSED RAISES (class 4, 86 LIKELY flags, 51 on the flop): a made hand facing a flop bet was never
 *    priced raise against call; it called.
 *
 * With the option on, PLO4/PLO5 cash with one board, high only, no bomb pot, not fixed limit, at a
 * table AND in the Lightning pools (the option opens its own scope; omahaPricedInLightning is not
 * read), this module answers the FINAL decision of the wager rules (HorseLogic wager_rules,
 * outermost):
 *
 *  1. BET OR CHECK, every street, heads-up, facing no bet. A wager of b into the pot P is kept only
 *     when EV(bet) beats EV(check):
 *
 *       EV(bet)   = f.P + (1 - f).(r.e_called.(P + 2b) - b)
 *                 = f.P - (1 - f).(b - r.e_called.(P + 2b))
 *       EV(check) = r.e_all.P
 *
 *     f is his fold share at THIS price (omahaTargetFoldShare), e_called the Horse's showdown share
 *     against the strongest (1 - f) of his holdings (the weakest fold first), e_all its share against
 *     all of them, r the realization (1 on the river or when the bet puts the matched stack in, else
 *     1 in position and OMAHA_BIG_DRAW_OOP_REALISATION out of it, the sampled raise's own figure).
 *     Otherwise the wager becomes the check. Value bets and bluffs are priced alike: nothing here
 *     asks what the hand is called.
 *  2. RAISE OR CALL, THE FLOP, facing a bet, one or two opponents. A final CALL is priced beside a
 *     raise to each legal size on the sampled spot of omahaPricedSampledRaise with
 *     omahaSampledRaiseIsPricedAtEverySize's size grid (reused unchanged: the seeded sample, the
 *     ranges that continue against a bet and a raise, the fold at the price each raise lays, the
 *     share against the part of the range that continues at that price), with each opponent's fold
 *     to a bet taken from his MEASURED record below in place of the pooled read. A raise priced above
 *     the call by the sampled margin is made at the size of highest value.
 *  3. A RAISE FACING A BET, FLOP AND TURN, is priced the same way; where no raise is priced above the
 *     call the comparison's answer (call, or fold when the call is worth less than nothing) stands.
 *
 * HIS FOLD SHARE (omahaTargetFoldShare). His measured fold-to-bet record for this street (the street
 * read's foldToBet cell, HorseMind.omahaStreetReadOf) shrunk toward his kind's measured street rate
 * (HorseOmahaPricedMode.omahaPricedKindPrior) by OMAHA_TARGET_FOLD_PRIOR_STRENGTH pseudo-opportunities;
 * with no street record, his pooled postflop record (HorseMind.foldToBetCountersOf) shrunk toward his
 * kind's pooled rate, carried to this street by his kind's street-over-pooled log-odds; with neither,
 * his kind's street rate. That rate was measured at the bets his kind faced, whose median size is
 * OMAHA_TARGET_FOLD_REFERENCE_BET_POT; it is carried to the price of THIS bet by the fitted size
 * slope of the person fold model (OMAHA_FLOP_BET_PERSON_FOLD_FIT.logitMdf) on the log-odds of the
 * minimum-defence share s/(P+s). Continuous everywhere: no sample threshold, no label, no size cut.
 *
 * Unpriceable spots keep the decision given (`_unpriced_kept`); multiway bets are not priced (the
 * formula is heads-up). The river raise of riverBluffCheckRaise is not re-priced here: it is already
 * priced on the lower 99% bound of his measured answer to that same line. Pure but for the receipts:
 * no opponent memory is written and no draw is taken from the brain's random stream.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { noteDecisionRuleReceipt, noteFire, telemetryOn } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_BIG_DRAW_OOP_REALISATION,
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDrawEquities,
  omahaBigDrawRiverShares,
  omahaHeroInPosition,
  type OmahaBigDrawCounts,
} from './HorseOmahaBigDrawAggression.js';
import { OMAHA_FLOP_BET_PERSON_FOLD_FIT } from './HorseOmahaFlopBetMeasuredFoldShare.js';
import {
  omahaOpponentKindOf,
  omahaPricedKindPrior,
  type OmahaOpponentKind,
} from './HorseOmahaPricedMode.js';
import {
  omahaPricedSampledRaise,
  type OmahaPricedSampledVerdict,
} from './HorseOmahaPricedRules.js';
import {
  omahaPricedInScope,
  omahaPricedLegalSampledSizes,
  omahaPricedReadOfUser,
  omahaPricedSampledResized,
  omahaPricedSampledSpotOf,
} from './HorseOmahaPricedWiring.js';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown): number => (fin(v) ? Math.max(0, v) : 0);
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export type OmahaBluffStreet = 'flop' | 'turn' | 'river';

/**
 * Pseudo-opportunities of his kind's rate behind his own record: the person fold model's fitted prior
 * strength (OMAHA_FLOP_BET_PERSON_FOLD_FIT.priorStrength: time-split cross-validation flat over 4..64,
 * between-person dispersion 13.9).
 */
export const OMAHA_TARGET_FOLD_PRIOR_STRENGTH = OMAHA_FLOP_BET_PERSON_FOLD_FIT.priorStrength;
/** How his fold moves with the price: the fitted slope on logit(s/(P+s)) of the person fold model. */
export const OMAHA_TARGET_FOLD_SIZE_SLOPE = OMAHA_FLOP_BET_PERSON_FOLD_FIT.logitMdf;
/**
 * The size of the bets behind the measured fold rates, as a share of the pot: the median Horse bet by
 * street, PLO4 and PLO5 averaged (archive plo-handoff-review-01a1cbbd/priced-01BNteGZ/calibration/
 * rates.json, medianBetPot: flop 0.476 / 0.422, turn 0.624 / 0.628, river 0.795 / 0.789), the bets
 * persons answered on the hands his kind's rates were measured on. A rate is read AT this size and
 * carried to the size priced.
 */
export const OMAHA_TARGET_FOLD_REFERENCE_BET_POT: Readonly<Record<OmahaBluffStreet, number>> =
  Object.freeze({ flop: 0.449, turn: 0.626, river: 0.792 });

/** One success / opportunity pair. */
export interface OmahaTargetFoldCell {
  hit: number;
  opp: number;
}
/** His records: this street's fold-to-bet cell and his pooled postflop fold-to-bet counters. */
export interface OmahaTargetFoldRecord {
  street: OmahaTargetFoldCell | null;
  pooled: OmahaTargetFoldCell | null;
}
export interface OmahaTargetFoldRead {
  /** his fold to a bet on this street at the reference size (the shrunk record) */
  rate: number;
  source: 'street' | 'pooled' | 'prior';
  opportunities: number;
}

const known = (c: OmahaTargetFoldCell | null | undefined): c is OmahaTargetFoldCell =>
  !!c && fin(c.hit) && fin(c.opp) && c.opp > 0;
const shrunk = (c: OmahaTargetFoldCell, prior: number, k: number): number => {
  const opp = Math.max(0, c.opp);
  return (clamp(c.hit, 0, opp) + prior * k) / (opp + k);
};

/** His fold to a bet on this street at the reference size, shrunk toward his kind's rate. */
export function omahaTargetFoldRead(
  kind: OmahaOpponentKind | null,
  street: OmahaBluffStreet,
  record: OmahaTargetFoldRecord | null
): OmahaTargetFoldRead {
  const K = omahaPricedKindPrior(kind).foldToBet;
  const k = OMAHA_TARGET_FOLD_PRIOR_STRENGTH;
  const streetPrior = clamp(K[street], 0.01, 0.99);
  if (record && known(record.street))
    return {
      rate: clamp(shrunk(record.street, streetPrior, k), 0.01, 0.99),
      source: 'street',
      opportunities: record.street.opp,
    };
  if (record && known(record.pooled)) {
    const pooledPrior = clamp(K.pooled, 0.01, 0.99);
    const d = clamp(shrunk(record.pooled, pooledPrior, k), 0.01, 0.99);
    return {
      rate: clamp(sigmoid(logit(d) + logit(streetPrior) - logit(pooledPrior)), 0.01, 0.99),
      source: 'pooled',
      opportunities: record.pooled.opp,
    };
  }
  return { rate: streetPrior, source: 'prior', opportunities: 0 };
}

/** His fold share to a bet `wager` into the pot `potFacing` he sees, from the read at the reference size. */
export function omahaTargetFoldShare(
  read: OmahaTargetFoldRead,
  street: OmahaBluffStreet,
  potFacing: number,
  wager: number
): number | null {
  if (!fin(potFacing) || !fin(wager) || !(potFacing > 0) || !(wager > 0)) return null;
  const mdf = clamp(wager / (potFacing + wager), 0.02, 0.98);
  const r = OMAHA_TARGET_FOLD_REFERENCE_BET_POT[street];
  const ref = r / (1 + r);
  return sigmoid(
    logit(clamp(read.rate, 0.01, 0.99)) + OMAHA_TARGET_FOLD_SIZE_SLOPE * (logit(mdf) - logit(ref))
  );
}

/**
 * The Horse's share against the strongest `keep` of a range sampled in nested classes (index 0 every
 * holding, 1 those that continue against a bet, 2 those that continue against a raise; each holds
 * the next): the strongest class first, then the next, each class one figure (no order inside a
 * class: it would be read off the Horse's own cards). Null with nothing sampled.
 */
export function omahaShareAgainstStrongest(
  counts: OmahaBigDrawCounts,
  keep: number
): number | null {
  const g = counts.got;
  const w = counts.won;
  const g0 = g[0] ?? 0;
  if (!(g0 > 0)) return null;
  const g1 = Math.min(g0, g[1] ?? 0);
  const g2 = Math.min(g1, g[2] ?? 0);
  const w0 = w[0] ?? 0;
  const w1 = w[1] ?? 0;
  const w2 = w[2] ?? 0;
  const classes: Array<[number, number]> = [
    [g2, w2],
    [g1 - g2, w1 - w2],
    [g0 - g1, w0 - w1],
  ];
  let need = Math.max(1e-9, clamp(keep, 0, 1) * g0);
  let got = 0;
  let won = 0;
  for (const [n, s] of classes) {
    if (!(n > 0) || !(need > 0)) continue;
    const take = Math.min(need, n);
    won += (take * s) / n;
    got += take;
    need -= take;
  }
  return got > 0 ? won / got : null;
}

/** The share against the strongest `keep` of a river sample ordered strongest first. */
export function omahaRiverShareAgainstStrongest(
  strongestFirst: readonly number[],
  keep: number
): number | null {
  const n = strongestFirst.length;
  if (n === 0) return null;
  const take = clamp(keep, 0, 1) * n;
  if (!(take > 0)) return strongestFirst[0] ?? null;
  let won = 0;
  const whole = Math.floor(take);
  for (let i = 0; i < whole; i++) won += strongestFirst[i]!;
  const part = take - whole;
  if (part > 0 && whole < n) won += part * strongestFirst[whole]!;
  return won / take;
}

/** The Horse's showdown share against his holdings, all and the strongest `keep` of them. */
export interface OmahaBluffEquity {
  all: number;
  calledAt: (keep: number) => number | null;
}
export function omahaBluffEquity(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = [],
  samples: number = OMAHA_BIG_DRAW_SAMPLES
): OmahaBluffEquity | null {
  if (board.length === 5) {
    const r = omahaBigDrawRiverShares(hole, board, dead, samples);
    if (!r) return null;
    return {
      all: r.all,
      calledAt: (keep) => omahaRiverShareAgainstStrongest(r.strongestFirst, keep),
    };
  }
  if (board.length !== 3 && board.length !== 4) return null;
  const counts: OmahaBigDrawCounts = { got: [], won: [] };
  const e = omahaBigDrawEquities(hole, board, dead, samples, counts);
  if (!e) return null;
  return { all: e.all, calledAt: (keep) => omahaShareAgainstStrongest(counts, keep) };
}

export interface OmahaBluffBetPrice {
  fold: number;
  equityAll: number;
  equityCalled: number;
  realization: number;
  evBet: number;
  evCheck: number;
  bet: boolean;
}

/** The closed form of the header (item 1). Exported for its test. */
export function omahaBluffBetPrice(i: {
  pot: number;
  wager: number;
  fold: number;
  equityAll: number;
  equityCalled: number;
  /** realization of the checked line and of the called bet */
  realizationCheck: number;
  realizationCalled: number;
}): OmahaBluffBetPrice {
  const P = i.pot;
  const b = i.wager;
  const f = clamp(i.fold, 0, 1);
  const evBet = f * P - (1 - f) * (b - i.realizationCalled * i.equityCalled * (P + 2 * b));
  const evCheck = i.realizationCheck * i.equityAll * P;
  return {
    fold: round4(f),
    equityAll: round4(i.equityAll),
    equityCalled: round4(i.equityCalled),
    realization: round4(i.realizationCalled),
    evBet: round2(evBet),
    evCheck: round2(evCheck),
    bet: evBet > evCheck,
  };
}

/** Where his records come from; HorseMind inside a decision (tests pass their own). */
export type OmahaTargetRecordOf = (
  userId: string,
  street: OmahaBluffStreet
) => OmahaTargetFoldRecord | null;
export const omahaTargetRecordFromMind: OmahaTargetRecordOf = (userId, street) => {
  let streetCell: OmahaTargetFoldCell | null = null;
  try {
    const c = HorseMind.omahaStreetReadOf(userId)?.counters.foldToBet[street];
    streetCell = c && known(c) ? { hit: c.hit, opp: c.opp } : null;
  } catch {
    streetCell = null;
  }
  let pooled: OmahaTargetFoldCell | null = null;
  try {
    pooled = HorseMind.foldToBetCountersOf(userId);
  } catch {
    pooled = null;
  }
  return { street: streetCell, pooled };
};

/** PLO4/PLO5 cash, one board, high only, no bomb pot, not fixed limit; Lightning pools included. */
export function omahaBluffPricedInScope(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  return omahaPricedInScope(player, gs, { omahaPricedInLightning: true });
}

const streetOf = (gs: HorseGameStateV2): OmahaBluffStreet | null => {
  const s = String(gs.stage ?? '');
  const n = (gs.communityCards ?? []).length;
  if (s === 'flop' && n === 3) return 'flop';
  if (s === 'turn' && n === 4) return 'turn';
  if (s === 'river' && n === 5) return 'river';
  return null;
};
const toCallOf = (player: SeatPlayer, gs: HorseGameStateV2): number =>
  fin(gs.toCall) ? Math.max(0, gs.toCall) : Math.max(0, num(gs.currentBet) - num(player.bet));
const liveOf = (player: SeatPlayer, gs: HorseGameStateV2): SeatPlayer[] =>
  (gs.players ?? []).filter((p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out);

/**
 * The bet-or-check spot of item 1, from the public state alone (the receipt validator re-derives it):
 * in scope, a known street, nothing to call, the check legal, one live opponent with chips who is not
 * all in. Null otherwise.
 */
export function omahaBluffBetSpotOf(
  player: SeatPlayer,
  gs: HorseGameStateV2
): { street: OmahaBluffStreet; opponent: SeatPlayer; inPosition: boolean } | null {
  if (!omahaBluffPricedInScope(player, gs)) return null;
  const street = streetOf(gs);
  if (!street) return null;
  if (toCallOf(player, gs) > 0.005) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
  const live = liveOf(player, gs);
  if (live.length !== 1) return null;
  const opponent = live[0]!;
  if (opponent.is_all_in || !(num(opponent.stack) > 0)) return null;
  return {
    street,
    opponent,
    inPosition: omahaHeroInPosition(player.seat, gs.dealerSeat, [opponent.seat]),
  };
}

export type OmahaBluffBetVerdict =
  | { kind: 'unpriced'; reason: string }
  | ({ kind: 'priced'; wager: number; read: OmahaTargetFoldRead } & OmahaBluffBetPrice);

/** Item 1: the verdict on a wager facing no bet, or why it cannot be priced. */
export function omahaBluffBetVerdict(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  recordOf: OmahaTargetRecordOf = omahaTargetRecordFromMind
): OmahaBluffBetVerdict {
  try {
    const spot = omahaBluffBetSpotOf(player, gs);
    if (!spot) return { kind: 'unpriced', reason: 'spot' };
    const heroAll = num(player.bet) + num(player.stack);
    const raw =
      decision.action === 'all_in' ? heroAll : fin(decision.amount) ? decision.amount : NaN;
    if (!fin(raw) || !(raw > 0)) return { kind: 'unpriced', reason: 'amount' };
    const cover = num(spot.opponent.stack) + num(spot.opponent.bet);
    const wager = Math.min(raw - num(player.bet), cover - num(player.bet));
    const pot = num(gs.pot);
    if (!(wager > 0) || !(pot > 0)) return { kind: 'unpriced', reason: 'price' };
    const kind = omahaOpponentKindOf(gs, spot.opponent.user_id);
    const read = omahaTargetFoldRead(
      kind,
      spot.street,
      recordOf(spot.opponent.user_id, spot.street)
    );
    const fold = omahaTargetFoldShare(read, spot.street, pot, wager);
    if (fold === null) return { kind: 'unpriced', reason: 'fold' };
    const eq = omahaBluffEquity(
      player.cards ?? [],
      gs.communityCards ?? [],
      player.knownDeadCards ?? []
    );
    if (!eq) return { kind: 'unpriced', reason: 'equity' };
    const called = eq.calledAt(1 - fold);
    if (called === null) return { kind: 'unpriced', reason: 'equity' };
    const jam = raw >= heroAll - 0.005 || wager >= cover - num(player.bet) - 0.005;
    const live = spot.street === 'river' ? 1 : spot.inPosition ? 1 : OMAHA_BIG_DRAW_OOP_REALISATION;
    const price = omahaBluffBetPrice({
      pot,
      wager,
      fold,
      equityAll: eq.all,
      equityCalled: called,
      realizationCheck: live,
      realizationCalled: jam ? 1 : live,
    });
    return { kind: 'priced', wager: round2(wager), read, ...price };
  } catch {
    return { kind: 'unpriced', reason: 'error' };
  }
}

/** Item 2 and 3: the sampled flop / turn raise beside the call with his measured fold. */
export function omahaBluffRaiseVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  proposedTo: number,
  recordOf: OmahaTargetRecordOf = omahaTargetRecordFromMind
): { verdict: OmahaPricedSampledVerdict; live: SeatPlayer[] } | null {
  try {
    if (!omahaBluffPricedInScope(player, gs)) return null;
    const spot = omahaPricedSampledSpotOf(player, gs);
    if (!spot) return null;
    const verdict = omahaPricedSampledRaise({
      street: spot.street,
      hole: player.cards ?? [],
      board: gs.communityCards ?? [],
      dead: player.knownDeadCards ?? [],
      pot: num(gs.pot),
      toCall: spot.toCall,
      stack: num(player.stack),
      heroBet: num(player.bet),
      currentBet: num(gs.currentBet),
      to: proposedTo,
      inPosition: spot.inPosition,
      opponents: spot.live.map((p) => {
        const read = omahaPricedReadOfUser(p.user_id, gs, opts);
        const measured = omahaTargetFoldRead(
          omahaOpponentKindOf(gs, p.user_id),
          spot.street,
          recordOf(p.user_id, spot.street)
        );
        return {
          stack: num(p.stack),
          bet: num(p.bet),
          read: { ...read, foldToBet: measured.rate, opportunities: measured.opportunities },
        };
      }),
      sizes: omahaPricedLegalSampledSizes(player, gs, spot.toCall),
    });
    return verdict && verdict.action ? { verdict, live: spot.live } : null;
  } catch {
    return null;
  }
}

/**
 * The outermost answer of the wager rules (HorseLogic wager_rules) with the option on; the decision
 * itself, the same object, with it off or out of scope.
 */
export function omahaBluffIsPricedAgainstTheTargetRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  recordOf: OmahaTargetRecordOf = omahaTargetRecordFromMind
): HorseDecision {
  if (opts.omahaBluffIsPricedAgainstTheTarget !== true) return decision;
  const tele = telemetryOn(opts);
  try {
    if (!omahaBluffPricedInScope(player, gs)) return decision;
    const toCall = toCallOf(player, gs);
    const wager =
      decision.action === 'bet' || decision.action === 'all_in' || decision.action === 'raise';
    if (toCall <= 0.005) {
      if (!wager) return decision;
      const v = omahaBluffBetVerdict(decision, player, gs, recordOf);
      if (v.kind === 'unpriced') {
        if (tele && omahaBluffBetSpotOf(player, gs) !== null)
          noteFire('omaha_bluff_priced_against_target_unpriced_kept');
        return decision;
      }
      if (v.bet) {
        if (tele) noteFire('omaha_bluff_priced_against_target_bet_kept');
        return decision;
      }
      const checked: HorseDecision = { ...decision, action: 'check' };
      delete checked.amount;
      delete checked.continuationGuard;
      delete checked.valueSize;
      if (tele) {
        noteFire('omaha_bluff_priced_against_target_checked');
        noteDecisionRuleReceipt('omaha_bluff_priced_against_target_checked', decision, checked);
      }
      return checked;
    }
    const street = streetOf(gs);
    const raising =
      decision.action === 'raise' ||
      (decision.action === 'all_in' &&
        num(player.bet) + num(player.stack) > num(gs.currentBet) + 0.005);
    const calling = decision.action === 'call';
    if (!((calling && street === 'flop') || (raising && (street === 'flop' || street === 'turn'))))
      return decision;
    const heroAll = num(player.bet) + num(player.stack);
    const proposedTo = raising
      ? decision.action === 'all_in'
        ? heroAll
        : num(decision.amount)
      : fin(gs.maxRaiseTo)
        ? (gs.maxRaiseTo as number)
        : heroAll;
    const r = omahaBluffRaiseVerdict(player, gs, opts, proposedTo, recordOf);
    if (!r || !r.verdict.best) {
      if (tele && omahaPricedSampledSpotOf(player, gs) !== null)
        noteFire('omaha_bluff_priced_against_target_unpriced_kept');
      return decision;
    }
    const { verdict, live } = r;
    if (calling) {
      if (verdict.action !== 'raise') {
        if (tele) noteFire('omaha_bluff_priced_against_target_call_kept');
        return decision;
      }
      const best = verdict.best!;
      const raised: HorseDecision =
        best.to >= heroAll - 0.005
          ? { ...decision, action: 'all_in' }
          : { ...decision, action: 'raise', amount: best.to };
      if (raised.action === 'all_in') delete raised.amount;
      delete raised.continuationGuard;
      delete raised.valueSize;
      if (tele) {
        noteFire('omaha_bluff_priced_against_target_call_raised');
        noteDecisionRuleReceipt('omaha_bluff_priced_against_target_call_raised', decision, raised);
      }
      return raised;
    }
    if (verdict.action === 'raise') {
      const resized = omahaPricedSampledResized(
        decision,
        player,
        live,
        proposedTo,
        verdict.best!.to
      );
      if (resized === null) {
        if (tele) noteFire('omaha_bluff_priced_against_target_raise_kept');
        return decision;
      }
      if (tele) {
        noteFire('omaha_bluff_priced_against_target_raise_resized');
        noteDecisionRuleReceipt(
          'omaha_bluff_priced_against_target_raise_resized',
          decision,
          resized
        );
      }
      return resized;
    }
    if (verdict.action === 'call') {
      const called: HorseDecision = { ...decision, action: 'call', amount: toCall };
      delete called.continuationGuard;
      delete called.valueSize;
      if (tele) {
        noteFire('omaha_bluff_priced_against_target_raise_called');
        noteDecisionRuleReceipt('omaha_bluff_priced_against_target_raise_called', decision, called);
      }
      return called;
    }
    const folded: HorseDecision = { ...decision, action: 'fold' };
    delete folded.amount;
    delete folded.continuationGuard;
    delete folded.valueSize;
    if (tele) {
      noteFire('omaha_bluff_priced_against_target_raise_folded');
      noteDecisionRuleReceipt('omaha_bluff_priced_against_target_raise_folded', decision, folded);
    }
    return folded;
  } catch {
    if (tele) noteFire('omaha_bluff_priced_against_target_unpriced_kept');
    return decision;
  }
}

/**
 * Receipt validation, wager_rules: a wager that became the check (item 1), under the decision's own
 * option only (the validator's gate), in the bet-or-check spot re-derived from the request.
 */
export function omahaBluffPricedAdmitsCheck(
  player: SeatPlayer | undefined,
  gs: HorseGameStateV2 | undefined
): boolean {
  if (!player || !gs) return false;
  try {
    return omahaBluffBetSpotOf(player, gs) !== null;
  } catch {
    return false;
  }
}

/**
 * Receipt validation, wager_rules: a flop or turn raise that became the call (item 3), only with the
 * request, only in the sampled spot inside this option's scope, and only for the exact chips of the
 * call.
 */
export function omahaBluffPricedAdmitsRaiseToCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    if (!omahaBluffPricedInScope(player, gs)) return false;
    const spot = omahaPricedSampledSpotOf(player, gs);
    if (!spot) return false;
    return typeof amount === 'number' && Math.abs(amount - spot.toCall) < 1e-6;
  } catch {
    return false;
  }
}
