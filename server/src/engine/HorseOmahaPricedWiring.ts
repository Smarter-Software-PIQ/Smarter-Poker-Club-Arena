/**
 * OMAHA PRICED RULES: THE RULE SITES (2026-11-17, PLO Strategy lane).
 *
 * Each function here is called from the one place in HorseLogic.ts where a
 * categorical PLO4/PLO5 cash rule acts, behind its own default-OFF option
 * (read `=== true`). It returns the decision the priced comparison
 * (HorseOmahaPricedRules) reaches, or null when the decision is outside the
 * option's scope (another game, a tournament, Lightning unless
 * omahaPricedInLightning is on, hi-lo, more than one board, a bomb pot), in
 * which case the caller's rule acts exactly as before.
 * Inside the scope the categorical rule does not decide: the comparison's
 * answer stands, and where no comparison can be computed the decision given
 * is kept and the receipt says so.
 *
 * The opponent memory is read here and only here for these rules
 * (omahaPricedReadOfUser): the pooled read today, the per-street read through
 * omahaPricedStreetRatesOf when it is delivered.
 *
 * Receipts are counted where the rule answers (BrainTelemetry.noteFire,
 * literal keys; HorseDataLedger.ts registers each).
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { noteFire, telemetryOn } from './BrainTelemetry.js';
import { saveFastRandom } from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import { hudLifetimeCountOf, hudStat } from './opponentHud/OpponentHud.js';
import { exploitEnvelopeFor } from './HorseOpponentExploit.js';
import type { OmahaFacingBetEvRead } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_BIG_DRAW_OOP_REALISATION,
  omahaBigDrawEquities,
  omahaDrawRaiseBarOf,
  omahaHeroInPosition,
} from './HorseOmahaBigDrawAggression.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaSlowplayUnit } from './HorseOmahaStrongHandSlowplayMix.js';
import {
  omahaDecisionRaises,
  omahaRaiseNeedsNutsCall,
  omahaRaiseNeedsNutsKeeps,
  omahaRaiseNeedsNutsScope,
  type OmahaRaiseNeedsNutsScope,
} from './HorseOmahaTurnRiverRaiseNeedsNuts.js';
import {
  withOmahaPricedMode,
  OMAHA_PRICED_MODE_OFF,
  omahaOpponentKindOf,
  omahaPricedModeNow,
} from './HorseOmahaPricedMode.js';
import {
  OMAHA_PRICED_MIX_SALT,
  OMAHA_PRICED_NO_READ,
  OMAHA_PRICED_VARIANTS,
  omahaPricedBet,
  omahaPricedFacingBetRead,
  omahaPricedMixProbability,
  omahaPricedPublicSpotKey,
  omahaPricedRaise,
  omahaPricedRead,
  omahaPricedReadSpread,
  omahaPricedSampledCandidates,
  omahaPricedSampledRaise,
  type OmahaPricedRaiseVerdict,
  type OmahaPricedRead,
  type OmahaPricedSampledSizes,
  type OmahaPricedStreetRates,
} from './HorseOmahaPricedRules.js';

/** What the caller in HorseLogic supplies of its own private helpers. */
export interface OmahaPricedDeps {
  /** the marginal rake on the pot, as a fraction (HorseLogic.rakeDrag; 0 in a tournament) */
  rake: number;
  /** the engine's realization factor for a turn call or raise with chips behind */
  realization: number;
  /**
   * omahaFacingBetValueShareIsMeasured only (default absent): the facing-bet verdict of the decision
   * (HorseLogic.omahaFacingBetEvCount, the bettor's measured range), whose call or fold is then the
   * priced comparisons' call-versus-fold answer; null when it does not price the spot.
   */
  facingVerdict?: () => { call: boolean; ev: number } | null;
  /**
   * omahaLateFlattenedCallIsPriced only (default absent): true when the call given to the turn and river raise
   * rule is a river raise that call_large_river_boat_wager flattened after the facing-bet EV stage had stood
   * aside for the raise, and that stage's verdict could not price it (HorseLogic.omahaLateFlattenedCallIsPricedRule).
   */
  lateFlattenedCall?: () => boolean;
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;

/**
 * omahaPricedInLightning (PLO Strategy lane 2026-11-18, default OFF, read `=== true`): the Lightning pools
 * (gs.publicMemoryDomain.speed === 'lightning') are inside the priced scope, so each priced option whose OWN
 * switch is on also decides Lightning PLO4/PLO5 cash. It turns no priced option on by itself. Unset or false:
 * Lightning is outside the scope exactly as before (byte-identical).
 */
export type OmahaPricedScopeOpts = Pick<HorseDecideOpts, 'omahaPricedInLightning' | 'telemetry'>;
export const omahaPricedInLightningOn = (opts: OmahaPricedScopeOpts | null | undefined): boolean =>
  opts?.omahaPricedInLightning === true;

/**
 * PLO4/PLO5 cash, one board, high only, no bomb pot, not Lightning (Lightning too when the decision's
 * omahaPricedInLightning is on): the scope of every option here.
 */
export function omahaPricedInScope(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts?: OmahaPricedScopeOpts | null
): boolean {
  try {
    if (!OMAHA_PRICED_VARIANTS.has(String(gs.gameVariant ?? '').toLowerCase())) return false;
    if (omahaIsTournamentMode(gs)) return false;
    if (gs.variantRules?.splitLow8OrBetter) return false;
    if (gs.bettingStructure === 'fixed_limit') return false;
    if (
      (gs.boardCount ?? 1) !== 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0 ||
      gs.bombPot === true
    )
      return false;
    const speed = (gs as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain?.speed;
    if (speed === 'lightning' && !omahaPricedInLightningOn(opts)) return false;
    const inScope =
      Array.isArray(player.cards) &&
      player.cards.length === Number(String(gs.gameVariant).toLowerCase().at(-1));
    // Once per decision (BrainTelemetry ONCE_PER_DECISION_RECEIPTS): a priced option that is on was in scope in
    // a Lightning pool because omahaPricedInLightning opened it.
    if (inScope && speed === 'lightning' && telemetryOn(opts ?? undefined))
      noteFire('omaha_priced_in_lightning_scope_seen');
    return inScope;
  } catch {
    return false;
  }
}

/**
 * THE SEAM FOR THE PER-STREET READ. The cells of the street-and-texture read
 * (HorseOmahaStreetRead, HorseMind.omahaStreetReadOf) for one opponent on the
 * street and board of the decision. No source is registered until that read
 * is delivered to decisions: the pooled read then answers alone. Registering
 * the source is the whole wiring; every priced comparison takes it through
 * omahaPricedReadOfUser.
 */
export type OmahaPricedStreetRatesSource = (
  userId: string,
  gs: HorseGameStateV2
) => OmahaPricedStreetRates | null;
let streetRatesSource: OmahaPricedStreetRatesSource | null = null;
export function omahaPricedSetStreetRatesSource(source: OmahaPricedStreetRatesSource | null): void {
  streetRatesSource = source;
}
/** The source registered now (null: none), so a caller that registers one for a decision can put it back. */
export function omahaPricedStreetRatesSourceNow(): OmahaPricedStreetRatesSource | null {
  return streetRatesSource;
}
export function omahaPricedStreetRatesOf(
  userId: string,
  gs: HorseGameStateV2
): OmahaPricedStreetRates | null {
  if (streetRatesSource === null) return null;
  try {
    return streetRatesSource(userId, gs);
  } catch {
    return null;
  }
}

/** The priced read of one opponent from the decision's public memory (the priors with the mind off). */
export function omahaPricedReadOfUser(
  userId: string | null | undefined,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): OmahaPricedRead {
  if (opts.mind === false || !userId) return OMAHA_PRICED_NO_READ;
  try {
    const pooled = HorseMind.omahaReadConditionalOf(userId);
    const scope = HorseMind.currentScope();
    const env = scope ? exploitEnvelopeFor(scope, String(gs.gameVariant ?? '')) : undefined;
    const stage = String(gs.stage ?? '');
    return omahaPricedRead(
      pooled,
      env ? { bet: env.betCheckedTo.mean, foldToBet: env.foldToBet.mean } : null,
      omahaPricedStreetRatesOf(userId, gs),
      // his kind (a person or a Horse): every prior and reference rate is his kind's
      // (omahaPricedPriorsByOpponentKind on; off: unknown kind, the #11212 read)
      opts.omahaPricedPriorsByOpponentKind === true ? omahaOpponentKindOf(gs, userId) : null,
      stage === 'flop' || stage === 'turn' || stage === 'river' ? stage : undefined
    );
  } catch {
    return OMAHA_PRICED_NO_READ;
  }
}
/**
 * The population means an opponent's own rates are read beside (the envelope of the decision's read scope and game:
 * the figures his posterior shrinks toward). Null with the mind off, no scope or no envelope. Used by
 * omahaCheckedToBetResponseIsMeasured; reads nothing about any player.
 */
export function omahaPricedPopulationRates(
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): { continueRate: number | null; riverCall: number | null } | null {
  if (opts.mind === false) return null;
  try {
    const scope = HorseMind.currentScope();
    const env = scope ? exploitEnvelopeFor(scope, String(gs.gameVariant ?? '')) : undefined;
    if (!env) return null;
    const rate = (x: unknown): number | null =>
      typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1 ? x : null;
    const fold = rate(env.foldToBet?.mean);
    return { continueRate: fold === null ? null : 1 - fold, riverCall: rate(env.riverCall?.mean) };
  } catch {
    return null;
  }
}
/**
 * A spot a priced family cannot price never falls back to the categorical rule it replaces (ROWFIX
 * 2026-11-18; owner 2026-11-17 11:49, no blanket rules): the decision given is kept, the #11212 handling,
 * whatever omahaPricedPriorsByOpponentKind says. Until 2026-11-18 that option also switched the families
 * to fall CLOSED (the categorical rule decided every unpriceable spot, e.g. omahaTurnRiverRaiseNeedsNuts in
 * cash); it now switches only the kind priors. Its receipt for such a spot still fires with it on.
 */
const priorsOn = (opts: HorseDecideOpts): boolean => opts.omahaPricedPriorsByOpponentKind === true;
const readOfSeat =
  (gs: HorseGameStateV2, opts: HorseDecideOpts) =>
  (seat: number): OmahaPricedRead =>
    omahaPricedReadOfUser((gs.players ?? []).find((p) => p.seat === seat)?.user_id, gs, opts);

/**
 * omahaBluffShareFromBetRate: the facing-bet read of the bettor with his bet
 * rate beside the population taken from the priced read (posterior mean, no
 * sample threshold). Returns `base` unchanged when the mode is off.
 */
export function omahaPricedFacingRead(
  base: OmahaFacingBetEvRead | null,
  bettorId: string | null | undefined,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): OmahaFacingBetEvRead | null {
  if (!omahaPricedModeNow().bluffShareFromBetRate || opts.mind === false) return base;
  return omahaPricedFacingBetRead(base, omahaPricedReadOfUser(bettorId, gs, opts));
}

/**
 * Receipts of the two facing-bet input options: with telemetry on and a mode
 * active, the verdict is taken again in the stepped mode (`stepped`, run with
 * the mode off) and a difference is counted. No decision reads the result.
 */
export function omahaPricedNoteFacingInputs(
  opts: HorseDecideOpts,
  call: boolean,
  stepped: () => boolean | null
): void {
  const mode = omahaPricedModeNow();
  if ((!mode.rangeContinuous && !mode.bluffShareFromBetRate) || !telemetryOn(opts)) return;
  try {
    const before = withOmahaPricedMode(OMAHA_PRICED_MODE_OFF, stepped);
    if (before === null || before === call) return;
    noteFire(
      call
        ? 'omaha_priced_facing_inputs_changed_to_call'
        : 'omaha_priced_facing_inputs_changed_to_fold'
    );
  } catch {
    // a receipt never changes a decision
  }
}

/** A spot the count excludes only for its table mode (capped wagers, all-in-or-fold) is priced on its chips. */
const pricedState = (gs: HorseGameStateV2): HorseGameStateV2 =>
  gs.allInOrFold === true || gs.wagersCapped === true
    ? { ...gs, allInOrFold: false, wagersCapped: false }
    : gs;

const toCallOf = (player: SeatPlayer, gs: HorseGameStateV2): number =>
  Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - num(player.bet));

const folded = (decision: HorseDecision): HorseDecision => {
  const f: HorseDecision = { ...decision, action: 'fold' };
  delete f.amount;
  delete f.continuationGuard;
  return f;
};
const checked = (decision: HorseDecision): HorseDecision => {
  const c: HorseDecision = { ...decision, action: 'check' };
  delete c.amount;
  return c;
};

/**
 * omahaPricedMix: with the option on, the lower-valued of two close actions
 * is taken with the probability the gap and the comparison's own uncertainty
 * give. The draw is the decision's derived stream (read, never advanced)
 * hashed with PUBLIC state only.
 */
function mixTakesLower(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  gap: number,
  uncertainty: number
): boolean {
  if (opts.omahaPricedMix !== true) return false;
  const p = omahaPricedMixProbability(Math.abs(gap), uncertainty);
  if (!(p > 0)) return false;
  const unit = omahaSlowplayUnit(
    saveFastRandom(),
    omahaPricedPublicSpotKey(player, gs),
    OMAHA_PRICED_MIX_SALT
  );
  if (!(unit < p)) return false;
  if (telemetryOn(opts)) noteFire('omaha_priced_mix_lower_action_taken');
  return true;
}

function raiseVerdictOf(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  deps: OmahaPricedDeps
): { verdict: OmahaPricedRaiseVerdict; read: OmahaPricedRead } | null {
  const state = pricedState(gs);
  const lossesOnce = opts.omahaRaiseEvCountsLossesOnce === true;
  const peek = omahaPricedRaise(player, state, {
    rake: deps.rake,
    realization: deps.realization,
    lossesOnce,
  });
  if (!peek) return null;
  const bettor = (gs.players ?? []).find((p) => p.seat === peek.spot.bettorSeat);
  const read = omahaPricedReadOfUser(bettor?.user_id, gs, opts);
  let bettorRead: OmahaFacingBetEvRead | null = null;
  if (opts.mind !== false && bettor) {
    try {
      bettorRead = HorseMind.omahaFacingBetEvReadOf(
        bettor.user_id,
        peek.spot.street,
        peek.spot.potFrac,
        peek.spot.isRaise
      );
    } catch {
      bettorRead = null;
    }
    bettorRead = omahaPricedFacingRead(bettorRead, bettor.user_id, gs, opts);
  }
  const proposedTo =
    decision.action === 'raise' && typeof decision.amount === 'number'
      ? decision.amount
      : decision.action === 'all_in'
        ? num(player.bet) + num(player.stack)
        : undefined;
  const verdict = omahaPricedRaise(player, state, {
    bettorRead,
    read,
    rake: deps.rake,
    realization: deps.realization,
    proposedTo,
    lossesOnce,
  });
  if (!verdict) return null;
  // omahaFacingBetValueShareIsMeasured: the call or fold is the facing-bet verdict's (the bettor's measured
  // range), so no priced raise site folds a call that verdict prices above the margin, or calls a fold.
  const facing = deps.facingVerdict?.() ?? null;
  if (facing && (facing.call !== verdict.callStands || facing.ev !== verdict.evCall))
    return {
      verdict: {
        ...verdict,
        callStands: facing.call,
        evCall: Math.round(facing.ev * 100) / 100,
        action:
          verdict.action === 'raise' || verdict.action === 'all_in'
            ? verdict.action
            : facing.call
              ? 'call'
              : 'fold',
      },
      read,
    };
  return { verdict, read };
}

/**
 * omahaTurnRiverRaiseIsPriced (replaces omahaTurnRiverRaiseNeedsNuts and
 * omahaRiverNutRaiseOnly in PLO4/PLO5 cash). The outermost answer on the turn
 * and river facing a wager: fold, call and a raise to each legal size are
 * priced on the exact hand. A raise is made when it is worth more than the
 * best other action by the margin, with any hand; a raise another owner
 * proposed that is not becomes the priced call or fold; a call or fold
 * another owner chose stays unless a raise is priced above it. A nut-class
 * hand keeps the raise or the call it was given (its raise is never worth
 * less than its call; the slow-play mix owns its call).
 *
 * omahaPricedRaiseNeverMakesNonNutRaise (PLO-OWNER lead-5 2026-11-22, default OFF, read `=== true`; owner
 * 2026-11-15 12:52 / 12:53 and 12:30: a non-nut hand facing a turn or river bet folds or at best calls, and a
 * draw raises only in position with a combo draw): with it on, this rule returns a raise only for a hand that is
 * nut class now, or for the in-position turn combo draw raising (HorseOmahaTurnRiverRaiseNeedsNuts
 * .omahaRaiseNeedsNutsKeeps, the one classifier). Every other raise it is given becomes the priced call or
 * fold it already computed (verdict.callStands; the call when nothing could be priced), and a call or fold it is
 * given is never turned into a raise. Off or unset: byte-identical.
 *
 * omahaLateFlattenedCallIsPriced (PLO-OWNER lead-5 2026-11-22, default OFF, read `=== true`): a call this rule
 * is given that is a late-flattened river raise no verdict priced (deps.lateFlattenedCall) is folded where the
 * priced call does not stand. Nothing else changes. Off or unset: byte-identical.
 */
export function omahaPricedTurnRiverRaiseRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  deps: OmahaPricedDeps
): HorseDecision | null {
  if (opts.omahaTurnRiverRaiseIsPriced !== true || !omahaPricedInScope(player, gs, opts))
    return null;
  const tele = telemetryOn(opts);
  const neverNonNut = opts.omahaPricedRaiseNeverMakesNonNutRaise === true;
  let scope: ReturnType<typeof omahaRaiseNeedsNutsScope> = null;
  try {
    scope = omahaRaiseNeedsNutsScope(player, gs, omahaPricedInLightningOn(opts));
    if (!scope) return null;
    const raises = omahaDecisionRaises(decision, player, scope);
    if (
      !raises &&
      decision.action !== 'call' &&
      decision.action !== 'fold' &&
      decision.action !== 'all_in'
    )
      return decision;
    if (omahaNutClassNow(player, gs)) {
      if (tele && raises) noteFire('omaha_priced_raise_kept');
      return decision;
    }
    // omahaPricedRaiseNeverMakesNonNutRaise: the hand is not nut class. Only the in-position turn combo draw
    // that is already raising goes on to the priced comparison below; every other decision leaves here as a
    // call or a fold.
    if (neverNonNut && !(raises && omahaRaiseNeedsNutsKeeps(player, gs, scope) === 'combo_draw')) {
      const nonNut = raiseVerdictOf(decision, player, gs, opts, deps);
      const wanted =
        nonNut !== null &&
        (nonNut.verdict.action === 'raise' || nonNut.verdict.action === 'all_in');
      if (!raises) {
        // A call or fold it was given is never turned into a raise.
        if (tele && wanted) noteFire('omaha_priced_raise_non_nut_raise_not_made');
        return omahaLateFlattenedCallPriced(decision, player, scope, opts, deps, nonNut?.verdict);
      }
      if (!nonNut) {
        // Nothing could be priced: the chips the raise would add stay out and the hand calls.
        if (tele) noteFire('omaha_priced_raise_non_nut_unpriced_called');
        return omahaRaiseNeedsNutsCall(decision, scope);
      }
      if (tele && wanted) noteFire('omaha_priced_raise_non_nut_raise_not_made');
      if (nonNut.verdict.callStands) {
        if (tele) noteFire('omaha_priced_raise_called');
        return omahaRaiseNeedsNutsCall(decision, scope);
      }
      if (tele) noteFire('omaha_priced_raise_folded');
      return folded(decision);
    }
    const priced = raiseVerdictOf(decision, player, gs, opts, deps);
    if (!priced) {
      // Nothing could be priced: the decision given is kept and the categorical rule does not decide it
      // (ROWFIX 2026-11-18: no fall closed); the receipt says so.
      if (tele && raises) noteFire('omaha_priced_raise_unpriced_kept');
      return decision;
    }
    const { verdict, read } = priced;
    const best = verdict.best;
    const passiveEv = Math.max(verdict.callStands ? verdict.evCall : 0, 0);
    let wantsRaise = verdict.action === 'raise' || verdict.action === 'all_in';
    if (best !== null && best.ev > 0) {
      // Exact counts carry no sampling error: the uncertainty is the read's. What rides on his
      // answer is the gap between the pot won when he folds and the result when he continues.
      const called =
        best.continues > 0
          ? (best.ev - (1 - best.continues) * verdict.spot.winnable) / best.continues
          : 0;
      const stake = Math.abs(verdict.spot.winnable - called);
      const gap = best.ev - (passiveEv + verdict.margin);
      if (mixTakesLower(player, gs, opts, gap, omahaPricedReadSpread(read, stake)))
        wantsRaise = !wantsRaise;
    }
    if (wantsRaise && best !== null) {
      if (
        raises &&
        verdict.rows.some(
          (r) => proposedMatches(decision, player, r.to) && r.ev > passiveEv + verdict.margin
        )
      ) {
        if (tele) noteFire('omaha_priced_raise_kept');
        return decision;
      }
      if (tele)
        noteFire(best.value ? 'omaha_priced_raise_made_value' : 'omaha_priced_raise_made_bluff');
      const raised: HorseDecision = best.allIn
        ? { ...decision, action: 'all_in' }
        : { ...decision, action: 'raise', amount: best.to };
      if (best.allIn) delete raised.amount;
      delete raised.continuationGuard;
      return raised;
    }
    if (!raises) return omahaLateFlattenedCallPriced(decision, player, scope, opts, deps, verdict);
    if (verdict.callStands) {
      if (tele) noteFire('omaha_priced_raise_called');
      return omahaRaiseNeedsNutsCall(decision, scope);
    }
    if (tele) noteFire('omaha_priced_raise_folded');
    return folded(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    // omahaPricedRaiseNeverMakesNonNutRaise: a failure inside scope never leaves a non-nut raise standing, and
    // never folds on one either (as the nut rule's own failure path): the hand calls.
    if (neverNonNut && scope) {
      try {
        if (
          omahaDecisionRaises(decision, player, scope) &&
          omahaRaiseNeedsNutsKeeps(player, gs, scope) === null
        )
          return omahaRaiseNeedsNutsCall(decision, scope);
      } catch {
        return decision;
      }
    }
    return decision;
  }
}
/**
 * omahaLateFlattenedCallIsPriced at the turn and river raise rule: the call it was given is returned as it is
 * unless the option is on, the street is the river, the decision is a call (or the all-in call) that
 * deps.lateFlattenedCall marks as a late-flattened raise no verdict priced, and the comparison priced it. Then
 * the priced call stands or the hand folds. Receipts omaha_late_flattened_call_priced_kept / _folded.
 */
function omahaLateFlattenedCallPriced(
  decision: HorseDecision,
  player: SeatPlayer,
  scope: OmahaRaiseNeedsNutsScope,
  opts: HorseDecideOpts,
  deps: OmahaPricedDeps,
  verdict: { callStands: boolean } | null | undefined
): HorseDecision {
  if (opts.omahaLateFlattenedCallIsPriced !== true || scope.street !== 'river' || !verdict)
    return decision;
  const calls =
    decision.action === 'call' ||
    (decision.action === 'all_in' && !omahaDecisionRaises(decision, player, scope));
  if (!calls || deps.lateFlattenedCall?.() !== true) return decision;
  const tele = telemetryOn(opts);
  if (verdict.callStands) {
    if (tele) noteFire('omaha_late_flattened_call_priced_kept');
    return decision;
  }
  if (tele) noteFire('omaha_late_flattened_call_priced_folded');
  return folded(decision);
}
function proposedMatches(decision: HorseDecision, player: SeatPlayer, to: number): boolean {
  if (decision.action === 'all_in')
    return Math.abs(num(player.bet) + num(player.stack) - to) < 0.006;
  return typeof decision.amount === 'number' && Math.abs(decision.amount - to) < 0.006;
}

/** True where omahaTurnRiverRaiseIsPriced owns the raise decision (the inner river nut-raise rule stands aside). */
export function omahaPricedOwnsTurnRiverRaise(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  return (
    opts.omahaTurnRiverRaiseIsPriced === true &&
    omahaPricedInScope(player, gs, opts) &&
    // every spot in scope, priceable or not (#11212): the inner nut rule never decides one
    omahaRaiseNeedsNutsScope(player, gs, omahaPricedInLightningOn(opts)) !== null
  );
}

/**
 * Receipt validation: a priced raise that became a call, with a hand that is not nut class, for the exact chips.
 * `inLightning`: the decision's own omahaPricedInLightning (the receipt context's gate); absent or false, Lightning
 * is outside as before.
 */
export function omahaPricedAdmitsRaiseToCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined,
  inLightning = false
): boolean {
  try {
    if (!omahaPricedInScope(player, gs, { omahaPricedInLightning: inLightning })) return false;
    const scope = omahaRaiseNeedsNutsScope(player, gs, inLightning);
    if (!scope || scope.allIn || omahaNutClassNow(player, gs)) return false;
    return typeof amount === 'number' && Math.abs(amount - scope.paid) < 1e-9;
  } catch {
    return false;
  }
}

interface SampledSpot {
  street: 'flop' | 'turn';
  toCall: number;
  inPosition: boolean;
  live: SeatPlayer[];
}
function sampledSpot(player: SeatPlayer, gs: HorseGameStateV2): SampledSpot | null {
  const street = String(gs.stage ?? '');
  if (street !== 'flop' && street !== 'turn') return null;
  if ((gs.communityCards ?? []).length !== (street === 'flop' ? 3 : 4)) return null;
  const toCall = toCallOf(player, gs);
  if (!(toCall > 0.005) || !(num(player.stack) > toCall + 0.005)) return null;
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
  );
  if (live.length === 0 || live.length > 2 || live.some((p) => p.is_all_in)) return null;
  return {
    street,
    toCall,
    live,
    inPosition: omahaHeroInPosition(
      player.seat,
      gs.dealerSeat,
      live.map((p) => p.seat)
    ),
  };
}
/**
 * omahaBluffIsPricedAgainstTheTarget (default OFF) prices the flop and turn raise beside the call on
 * this same sampled spot, legal sizes and resizing; exported for it, unchanged for every other caller.
 */
export type OmahaPricedSampledSpot = SampledSpot;
export const omahaPricedSampledSpotOf = (
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaPricedSampledSpot | null => sampledSpot(player, gs);
export const omahaPricedLegalSampledSizes = (
  player: SeatPlayer,
  gs: HorseGameStateV2,
  toCall: number
): OmahaPricedSampledSizes => legalSampledSizes(player, gs, toCall);
export const omahaPricedSampledResized = (
  decision: HorseDecision,
  player: SeatPlayer,
  live: SeatPlayer[],
  to: number,
  bestTo: number
): HorseDecision | null => sampledResized(decision, player, live, to, bestTo);
function sampledVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  spot: SampledSpot,
  to: number
) {
  return omahaPricedSampledRaise({
    street: spot.street,
    hole: player.cards ?? [],
    board: gs.communityCards ?? [],
    dead: player.knownDeadCards ?? [],
    pot: num(gs.pot),
    toCall: spot.toCall,
    stack: num(player.stack),
    heroBet: num(player.bet),
    currentBet: num(gs.currentBet),
    to,
    inPosition: spot.inPosition,
    opponents: spot.live.map((p) => ({
      stack: num(p.stack),
      bet: num(p.bet),
      read: omahaPricedReadOfUser(p.user_id, gs, opts),
    })),
    sizes: sampledSizes(player, gs, opts, spot.toCall),
  });
}
/**
 * omahaSampledRaiseIsPricedAtEverySize (default OFF): the legal raise-to range of the decision, so
 * the sampled comparison prices the fold, the call and a raise to each legal size, each raise's fold
 * share at the price it lays. Null with the option off: the one size given, its fold share
 * size-blind (#11212, byte-identical).
 */
function sampledSizes(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  toCall: number
): OmahaPricedSampledSizes | null {
  if (opts.omahaSampledRaiseIsPricedAtEverySize !== true) return null;
  return legalSampledSizes(player, gs, toCall);
}
/** The legal raise-to range and menu of the decision, from the public state alone. */
function legalSampledSizes(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  toCall: number
): OmahaPricedSampledSizes {
  const menu = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  return {
    minTo: Number.isFinite(gs.minRaiseTo) ? (gs.minRaiseTo as number) : num(gs.currentBet) * 2,
    maxTo: potRaiseTo(player, gs, toCall),
    whole: (gs.bigBlind ?? 1) >= 1,
    canRaise: menu === null || menu.includes('raise'),
    canShove: menu === null || menu.includes('all_in'),
  };
}
/**
 * omahaSampledRaiseIsPricedAtEverySize: the decision that makes the raise at the priced size of
 * highest value, or null when the size given (`to`, as matched: no more than the Horse or the
 * deepest opponent holds) is already that size. The Horse's whole stack is the all-in action. A
 * changed amount voids what was said of the old one (valueSize, continuationGuard).
 */
function sampledResized(
  decision: HorseDecision,
  player: SeatPlayer,
  live: SeatPlayer[],
  to: number,
  bestTo: number
): HorseDecision | null {
  const heroAll = num(player.bet) + num(player.stack);
  const cover = live.length ? Math.max(...live.map((p) => num(p.stack) + num(p.bet))) : heroAll;
  if (Math.abs(Math.min(to, heroAll, cover) - bestTo) < 0.006) return null;
  const resized: HorseDecision =
    bestTo >= heroAll - 0.005
      ? { ...decision, action: 'all_in' }
      : { ...decision, action: 'raise', amount: bestTo };
  if (resized.action === 'all_in') delete resized.amount;
  delete resized.continuationGuard;
  delete resized.valueSize;
  return resized;
}
/**
 * Receipt validation (omahaSampledRaiseIsPricedAtEverySize): a raise or an all-in that became a
 * raise to another size. The size chosen is priced on the opponent memory, which the request does
 * not carry, so it is admitted only with the request, only in the sampled spot (PLO4/PLO5 cash,
 * flop or turn, facing a wager, one or two opponents, none all in), and only for the exact chips of
 * one of the sizes the comparison prices there (omahaPricedSampledCandidates, public state alone):
 * an all-in where the Horse's whole stack is one of them, a raise to exactly one of the others.
 * `inLightning`: the decision's own omahaPricedInLightning (the receipt context's gate), as for
 * omahaPricedAdmitsRaiseToCall; absent or false, Lightning is outside as before.
 */
export function omahaPricedSampledAdmitsResize(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  action: string,
  amount: number | null | undefined,
  inLightning = false
): boolean {
  try {
    if (!omahaPricedInScope(player, gs, { omahaPricedInLightning: inLightning })) return false;
    const spot = sampledSpot(player, gs);
    if (!spot) return false;
    const heroAll = num(player.bet) + num(player.stack);
    const tos = omahaPricedSampledCandidates(
      {
        stack: num(player.stack),
        heroBet: num(player.bet),
        currentBet: num(gs.currentBet),
        opponents: spot.live.map((p) => ({ stack: num(p.stack), bet: num(p.bet) })),
      },
      legalSampledSizes(player, gs, spot.toCall)
    );
    if (action === 'all_in') return tos.some((to) => to >= heroAll - 0.005);
    return (
      action === 'raise' &&
      typeof amount === 'number' &&
      tos.some((to) => to < heroAll - 0.005 && Math.abs(to - amount) < 1e-9)
    );
  } catch {
    return false;
  }
}
const potRaiseTo = (player: SeatPlayer, gs: HorseGameStateV2, toCall: number): number => {
  const cap = num(gs.currentBet) + num(gs.pot) + toCall;
  const max = Number.isFinite(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : cap;
  return Math.min(max, num(player.bet) + num(player.stack));
};

/** True where omahaDrawRaiseIsPriced owns the draw raise (the bar at the brain's raise sites stands aside). */
export function omahaPricedOwnsDrawRaise(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  return opts.omahaDrawRaiseIsPriced === true && omahaPricedInScope(player, gs, opts);
}

/**
 * omahaDrawRaiseIsPriced at the brain's own draw-raise sites: whether the
 * raise about to be made there with a draw the bar names is BARRED (the site
 * then falls through to its own call or fold, as with the bar). It is barred
 * unless the pot raise is priced above the call. Null out of scope: the bar
 * acts. A hand the bar does not name, and a spot that cannot be priced, are
 * not barred here (omahaPricedDrawRaiseRule sees the raise again).
 */
export function omahaPricedDrawRaiseBarred(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean | null {
  if (!omahaPricedOwnsDrawRaise(player, gs, opts)) return null;
  try {
    if (omahaDrawRaiseBarOf(player, gs) === null) return false;
    // A spot the sample cannot price (three or more opponents, one all in): not barred (#11212); the
    // bar never decides it (ROWFIX 2026-11-18: no fall closed).
    const spot = sampledSpot(player, gs);
    if (!spot) {
      if (priorsOn(opts) && telemetryOn(opts)) noteFire('omaha_priced_draw_raise_unpriced_kept');
      return false;
    }
    const verdict = sampledVerdict(player, gs, opts, spot, potRaiseTo(player, gs, spot.toCall));
    if (!verdict) {
      if (priorsOn(opts) && telemetryOn(opts)) noteFire('omaha_priced_draw_raise_unpriced_kept');
      return false;
    }
    if (telemetryOn(opts))
      noteFire(
        verdict.raise
          ? 'omaha_priced_draw_raise_site_admitted'
          : 'omaha_priced_draw_raise_site_withheld'
      );
    return !verdict.raise;
  } catch {
    return null;
  }
}

/**
 * omahaDrawRaiseIsPriced (replaces omahaNoDrawRaiseOutOfPosition in PLO4/PLO5
 * cash). A raise facing a wager on the flop or turn with a draw the bar names
 * (any draw out of position, anything short of a combo draw in position) is
 * priced beside the call on the sampled shares: it stands when it is worth
 * more than the call by the margin, else it becomes the call.
 */
export function omahaPricedDrawRaiseRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): HorseDecision | null {
  if (!omahaPricedOwnsDrawRaise(player, gs, opts)) return null;
  if (decision.action !== 'raise' && decision.action !== 'all_in') return decision;
  const tele = telemetryOn(opts);
  try {
    // unpriceable: kept (#11212 order); the bar never decides it (ROWFIX 2026-11-18: no fall closed)
    const spot = sampledSpot(player, gs);
    if (!spot) {
      if (
        tele &&
        priorsOn(opts) &&
        !(Array.isArray(gs.legalActions) && !gs.legalActions.includes('call')) &&
        omahaDrawRaiseBarOf(player, gs) !== null
      )
        noteFire('omaha_priced_draw_raise_unpriced_kept');
      return decision;
    }
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('call')) return decision;
    if (omahaDrawRaiseBarOf(player, gs) === null) return decision;
    const to =
      decision.action === 'raise' && typeof decision.amount === 'number'
        ? decision.amount
        : num(player.bet) + num(player.stack);
    const verdict = sampledVerdict(player, gs, opts, spot, to);
    if (!verdict) {
      if (tele) noteFire('omaha_priced_draw_raise_unpriced_kept');
      return decision;
    }
    let raise = verdict.raise;
    const gap = verdict.evRaise - (verdict.evCall + verdict.margin);
    const read = omahaPricedReadOfUser(spot.live[0]?.user_id, gs, opts);
    if (
      verdict.evRaise > 0 &&
      mixTakesLower(
        player,
        gs,
        opts,
        gap,
        verdict.standardError + omahaPricedReadSpread(read, num(gs.pot))
      )
    )
      raise = !raise;
    if (raise) {
      // omahaSampledRaiseIsPricedAtEverySize: the raise is made to the size of highest value. The
      // size given is kept when it is that size. A raise the mix took (omahaPricedMix: within the
      // noise of the call, NOT priced above it) is sized the same way under its own receipt.
      const best = verdict.best ?? null;
      const resized = best ? sampledResized(decision, player, spot.live, to, best.to) : null;
      if (resized) {
        if (tele)
          noteFire(
            verdict.raise
              ? 'omaha_priced_draw_raise_resized'
              : 'omaha_priced_draw_raise_mixed_resized'
          );
        return resized;
      }
      // omahaPricedMix: a raise the mix took was NOT priced above the call; its receipt says so
      if (tele)
        noteFire(
          verdict.raise ? 'omaha_priced_draw_raise_kept' : 'omaha_priced_draw_raise_mixed_kept'
        );
      return decision;
    }
    // omahaPricedMix: a call the mix took WAS priced above the call as a raise; its receipt says so
    if (tele)
      noteFire(
        verdict.raise ? 'omaha_priced_draw_raise_mixed_called' : 'omaha_priced_draw_raise_called'
      );
    return { ...decision, action: 'call', amount: spot.toCall };
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}

/**
 * The bet-or-check comparison at a site where a categorical rule turned a bet
 * into a check. The bet stands when it is worth at least the check, else it
 * becomes the check. A decision that is not a bet is returned as given.
 */
function ownBetRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  receipts: { kept: () => void; checked: () => void; unpriced: () => void }
): HorseDecision | null {
  if (decision.action !== 'bet' && decision.action !== 'all_in') return decision;
  const tele = telemetryOn(opts);
  try {
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return decision;
    const amount =
      decision.action === 'all_in'
        ? num(player.stack)
        : typeof decision.amount === 'number'
          ? decision.amount
          : NaN;
    const readOf = readOfSeat(gs, opts);
    const verdict = Number.isFinite(amount) ? omahaPricedBet(player, gs, readOf, amount) : null;
    if (!verdict || verdict.proposed === null) {
      // unpriceable: kept (#11212); the categorical rule never decides it (ROWFIX 2026-11-18)
      if (tele) receipts.unpriced();
      return decision;
    }
    let bet = verdict.proposed.ev >= verdict.evCheck;
    const opp = (gs.players ?? []).find(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    // The card-impact sample: a share from about 800 weighted hands, in chips of the pot after the bet.
    const sampling = (0.5 / Math.sqrt(800)) * (num(gs.pot) + amount);
    const spread = omahaPricedReadSpread(readOf(opp?.seat ?? -1), num(gs.pot));
    if (mixTakesLower(player, gs, opts, verdict.proposed.ev - verdict.evCheck, sampling + spread))
      bet = !bet;
    if (bet) {
      if (tele) receipts.kept();
      return decision;
    }
    if (tele) receipts.checked();
    return checked(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}

/**
 * omahaOopTurnBarrelIsPriced (replaces the check half of
 * omahaOopTurnCheckAfterFlopCall in PLO4/PLO5 cash): the turn bet out of
 * position after the flop bet was called is priced beside the check. The
 * caller has established the rule's spot.
 */
export function omahaPricedOopTurnBarrelRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): HorseDecision | null {
  if (opts.omahaOopTurnBarrelIsPriced !== true || !omahaPricedInScope(player, gs, opts))
    return null;
  return ownBetRule(decision, player, gs, opts, {
    kept: () => noteFire('omaha_priced_oop_turn_barrel_kept'),
    checked: () => noteFire('omaha_priced_oop_turn_barrel_checked'),
    unpriced: () => noteFire('omaha_priced_oop_turn_barrel_unpriced_kept'),
  });
}

/**
 * omahaPairedBoardBetIsPriced (replaces omahaPairedRiverNoThinLeadVsValueLeader,
 * omahaOverpairNoOopBarrelVsValueLeader, omahaPairedTurnNoBarrelWithoutBoatVsValueLeader,
 * the card-impact press veto, the paired-board river check and the river
 * nut-blocker bluff's paired-board bar in PLO4/PLO5 cash): a bet in one of
 * those spots is priced beside the check against every opponent, whatever
 * his label. The caller has established the spot.
 */
export function omahaPricedPairedBoardBetRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): HorseDecision | null {
  if (!omahaPricedOwnsPairedBoardBet(player, gs, opts)) return null;
  return ownBetRule(decision, player, gs, opts, {
    kept: () => noteFire('omaha_priced_paired_board_bet_kept'),
    checked: () => noteFire('omaha_priced_paired_board_bet_checked'),
    unpriced: () => noteFire('omaha_priced_paired_board_bet_unpriced_kept'),
  });
}
export function omahaPricedOwnsPairedBoardBet(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  return opts.omahaPairedBoardBetIsPriced === true && omahaPricedInScope(player, gs, opts);
}

/**
 * The river nut-blocker bluff on a paired board (omahaPairedBoardBetIsPriced):
 * admitted when some bet is priced above the check against the opponent's
 * range and measured fold rate. False with the option off or out of scope
 * (the bar stands).
 */
export function omahaPricedBlockerBluffAdmits(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  if (!omahaPricedOwnsPairedBoardBet(player, gs, opts)) return false;
  try {
    const verdict = omahaPricedBet(player, gs, readOfSeat(gs, opts));
    const ok = verdict !== null && verdict.best !== null && verdict.best.ev > verdict.evCheck;
    if (ok && telemetryOn(opts)) noteFire('omaha_priced_paired_board_blocker_bluff_admitted');
    return ok;
  } catch {
    return false;
  }
}

/**
 * omahaPressureIsPriced (replaces the label test of
 * omahaPressureNeedsPostflopAggression in PLO4/PLO5 cash). Whether the
 * pressure play against this bettor is WITHHELD: the raise is withheld unless
 * the raise is priced above the call (flop and turn, sampled shares and his
 * measured fold rate; river, the exact count), the call-down unless the call
 * is priced above the fold. Null out of scope: the label test acts.
 */
/**
 * What omahaPricedPressureWithheld tells its caller beside the answer. `sampledAtPrice`: the raise
 * was admitted by the sampled comparison at a priced size (omahaSampledRaiseIsPricedAtEverySize);
 * `sampledTo`: that size (the raise-to of highest value, priced above the call by the margin).
 * Written only when the answer is the admission, after the pricing has finished. The object
 * belongs to the caller and to one decision; this module keeps no decision state.
 */
export interface OmahaPricedPressureAdmission {
  sampledAtPrice?: boolean;
  sampledTo?: number;
}
export function omahaPricedPressureWithheld(
  kind: 'raise' | 'call_down',
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  deps: OmahaPricedDeps,
  out?: OmahaPricedPressureAdmission
): boolean | null {
  if (opts.omahaPressureIsPriced !== true || !omahaPricedInScope(player, gs, opts)) return null;
  const tele = telemetryOn(opts);
  try {
    const stage = String(gs.stage ?? '');
    let admitted = false;
    // whether any comparison produced a number (its receipt, with omahaPricedPriorsByOpponentKind on)
    let priceable = false;
    // omahaSampledRaiseIsPricedAtEverySize: the priced size the sampled comparison admitted the raise at
    let sampledTo: number | null = null;
    if (stage === 'turn' || stage === 'river') {
      const priced = raiseVerdictOf({ action: 'call', thinkTime: 0 }, player, gs, opts, deps);
      if (priced) {
        priceable = true;
        admitted =
          kind === 'raise'
            ? priced.verdict.action === 'raise' || priced.verdict.action === 'all_in'
            : priced.verdict.callStands;
      }
    }
    if (!admitted && (stage === 'flop' || stage === 'turn')) {
      const spot = sampledSpot(player, gs);
      if (spot) {
        const verdict = sampledVerdict(player, gs, opts, spot, potRaiseTo(player, gs, spot.toCall));
        if (verdict) {
          priceable = true;
          admitted = kind === 'raise' ? verdict.raise : verdict.evCall > 0;
          // omahaSampledRaiseIsPricedAtEverySize: the raise admitted here is admitted at the
          // priced size of highest value. The caller is told so (below, once the answer is
          // settled), and carries it with its own decision to the rule that makes the raise at
          // that size (omahaPricedPressureRaiseSized).
          if (kind === 'raise' && verdict.best && verdict.raise && Number.isFinite(verdict.best.to))
            sampledTo = verdict.best.to;
        }
      } else if (kind === 'call_down' && stage === 'flop') {
        const eq = omahaBigDrawEquities(
          player.cards ?? [],
          gs.communityCards ?? [],
          player.knownDeadCards ?? []
        );
        const toCall = Math.min(toCallOf(player, gs), num(player.stack));
        if (eq !== null) priceable = true;
        admitted = eq !== null && eq.bet * (num(gs.pot) + toCall) - toCall > 0;
      }
    }
    // unpriceable: withheld as with the option off (#11212); the label test never decides it (ROWFIX
    // 2026-11-18: no fall closed)
    if (!priceable && tele && priorsOn(opts)) noteFire('omaha_priced_pressure_unpriced_kept');
    if (tele) {
      if (kind === 'raise')
        noteFire(
          admitted ? 'omaha_priced_pressure_raise_admitted' : 'omaha_priced_pressure_raise_withheld'
        );
      else
        noteFire(
          admitted
            ? 'omaha_priced_pressure_call_down_admitted'
            : 'omaha_priced_pressure_call_down_withheld'
        );
    }
    if (out && admitted && sampledTo !== null) {
      out.sampledAtPrice = true;
      out.sampledTo = sampledTo;
    }
    return !admitted;
  } catch {
    return null;
  }
}

/**
 * omahaSampledRaiseIsPricedAtEverySize with omahaPressureIsPriced: the pressure raise is admitted
 * when the priced size of highest value is worth more than the call, so the raise the brain then
 * makes is made AT a size priced above the call (before, it kept the brain's own size: a minimum
 * raise admitted on the fold share of the pot raise). Applies to a raise or an all-in facing the
 * wager in a decision whose pressure raise the sampled comparison admitted: `admission` is the
 * caller's own record of THIS decision (HorseLogic's per-decision memo, set by the brain where it
 * priced the pressure raise, bound to the state object of the decision and cleared when the
 * decision starts and when it ends), carrying the size the admission priced. This module holds no
 * decision state. A draw the bar names is left to omahaPricedDrawRaiseRule where that rule owns it
 * (it prices and sizes the same way, or makes the call).
 *
 * The raise is priced again here with the size given among the sizes priced: it is made at the size
 * of highest value (kept as given when the size given is that size). Where it cannot be priced
 * again, or no longer stands above the call, it is made at the size the admission priced above the
 * call: an admission by a priced size never leaves the raise at an unpriced size (review note N1).
 * Receipt: omaha_priced_pressure_raise_resized.
 */
export function omahaPricedPressureRaiseSized(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  admission: OmahaPricedPressureAdmission | null | undefined
): HorseDecision {
  if (admission?.sampledAtPrice !== true) return decision;
  const admittedTo = admission.sampledTo;
  if (typeof admittedTo !== 'number' || !Number.isFinite(admittedTo)) return decision;
  if (opts.omahaSampledRaiseIsPricedAtEverySize !== true || opts.omahaPressureIsPriced !== true)
    return decision;
  if (decision.action !== 'raise' && decision.action !== 'all_in') return decision;
  const to =
    decision.action === 'raise' && typeof decision.amount === 'number'
      ? decision.amount
      : num(player.bet) + num(player.stack);
  const live = (): SeatPlayer[] =>
    (gs.players ?? []).filter((p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out);
  // made at the size the admission priced above the call (the decision itself when it is that size)
  const atAdmitted = (spot: SampledSpot | null): HorseDecision => {
    const resized = sampledResized(decision, player, spot?.live ?? live(), to, admittedTo);
    if (resized && telemetryOn(opts)) noteFire('omaha_priced_pressure_raise_resized');
    return resized ?? decision;
  };
  let spot: SampledSpot | null = null;
  try {
    // The scope of the pricing that admitted the raise (omahaPricedPressureWithheld reads the same opts):
    // Lightning only with the decision's own omahaPricedInLightning. The scope receipt is the admission's.
    // Out of it nothing was priced, so nothing is admitted: the decision as given, as with the option off.
    if (!omahaPricedInScope(player, gs, { omahaPricedInLightning: omahaPricedInLightningOn(opts) }))
      return decision;
    spot = sampledSpot(player, gs);
    if (!spot) return atAdmitted(null);
    if (
      opts.omahaNoDrawRaiseOutOfPosition === true &&
      omahaPricedOwnsDrawRaise(player, gs, opts) &&
      omahaDrawRaiseBarOf(player, gs) !== null
    )
      return decision;
    const verdict = sampledVerdict(player, gs, opts, spot, to);
    if (!verdict || !verdict.raise || !verdict.best) return atAdmitted(spot);
    const resized = sampledResized(decision, player, spot.live, to, verdict.best.to);
    if (!resized) return decision;
    if (telemetryOn(opts)) noteFire('omaha_priced_pressure_raise_resized');
    return resized;
  } catch {
    if (telemetryOn(opts)) noteFire('omaha_strategy_rule_failed');
    try {
      return atAdmitted(spot);
    } catch {
      return decision;
    }
  }
}

/**
 * omahaBigBetCallsArePriced (replaces the V81, V84, bluff-catcher and V86
 * cells in PLO4/PLO5 cash). Called where one of those cells would change a
 * turn or river call or raise by the size of the bet, the stack in big blinds
 * and the hand class: the exact count judges it instead. The call stands when
 * EV(call) exceeds the margin and is folded when it does not; a river raise
 * is priced beside the call and the fold. Where the hand cannot be counted
 * the decision is kept.
 */
export function omahaPricedBigBetCallRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  deps: OmahaPricedDeps
): HorseDecision | null {
  if (!omahaPricedOwnsBigBetCalls(player, gs, opts)) return null;
  const tele = telemetryOn(opts);
  try {
    const toCall = toCallOf(player, gs);
    const stack = num(player.stack);
    if (toCall <= 0.005) return decision;
    const isCall =
      decision.action === 'call' || (decision.action === 'all_in' && stack <= toCall + 0.005);
    const isRaise =
      decision.action === 'raise' || (decision.action === 'all_in' && stack > toCall + 0.005);
    if (!isCall && !isRaise) return decision;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return decision;
    const priced = raiseVerdictOf(decision, player, gs, opts, deps);
    if (!priced) {
      // unpriceable: kept (#11212); the cells never decide it (ROWFIX 2026-11-18)
      if (tele) noteFire('omaha_priced_big_bet_call_unpriced_kept');
      return decision;
    }
    const { verdict } = priced;
    if (isCall) {
      if (verdict.callStands) {
        if (tele) noteFire('omaha_priced_big_bet_call_kept');
        return decision;
      }
      if (tele) noteFire('omaha_priced_big_bet_call_folded');
      return folded(decision);
    }
    // A raise: it stands when it is priced above the call and the fold, or with a nut-class hand.
    const passiveEv = Math.max(verdict.callStands ? verdict.evCall : 0, 0);
    if (
      omahaNutClassNow(player, gs) ||
      verdict.rows.some(
        (r) => proposedMatches(decision, player, r.to) && r.ev > passiveEv + verdict.margin
      )
    ) {
      if (tele) noteFire('omaha_priced_big_bet_raise_kept');
      return decision;
    }
    const scope = omahaRaiseNeedsNutsScope(player, gs, omahaPricedInLightningOn(opts));
    if (verdict.callStands && scope) {
      if (tele) noteFire('omaha_priced_big_bet_raise_called');
      return omahaRaiseNeedsNutsCall(decision, scope);
    }
    if (verdict.callStands) return decision;
    if (tele) noteFire('omaha_priced_big_bet_raise_folded');
    return folded(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}

/**
 * omahaUnderpairMultiwayIsPriced (replaces the categorical fold of
 * omahaUnderpairNoMultiwayFlopContinue in PLO4/PLO5 cash). The flop call
 * facing a bet and a call is priced on the sampled share against the bettor
 * and against the caller (both must be beaten; the product of the two shares
 * is used, a stated simplification that ignores shared outs), realized less
 * out of position. True: the fold stands. False: the call is priced in.
 * Null out of scope or when no number can be computed (the rule acts).
 */
export function omahaPricedUnderpairFolds(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean | null {
  if (opts.omahaUnderpairMultiwayIsPriced !== true || !omahaPricedInScope(player, gs, opts))
    return null;
  try {
    if (String(gs.stage ?? '') !== 'flop') return null;
    const eq = omahaBigDrawEquities(
      player.cards ?? [],
      gs.communityCards ?? [],
      player.knownDeadCards ?? []
    );
    if (eq === null) return null;
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    const toCall = Math.min(toCallOf(player, gs), num(player.stack));
    const inPosition = omahaHeroInPosition(
      player.seat,
      gs.dealerSeat,
      live.map((p) => p.seat)
    );
    const share = eq.bet ** Math.max(1, live.length);
    const real = inPosition ? 1 : OMAHA_BIG_DRAW_OOP_REALISATION;
    const ev = real * share * (num(gs.pot) + toCall) - toCall;
    const folds = !(ev > 0);
    if (telemetryOn(opts))
      noteFire(
        folds ? 'omaha_priced_underpair_multiway_folded' : 'omaha_priced_underpair_multiway_called'
      );
    return folds;
  } catch {
    return null;
  }
}

/** True where omahaBigBetCallsArePriced owns the big-bet cells: a PLO4/PLO5 cash turn or river decision. */
export function omahaPricedOwnsBigBetCalls(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  if (opts.omahaBigBetCallsArePriced !== true || !omahaPricedInScope(player, gs, opts))
    return false;
  const stage = String(gs.stage ?? '');
  return stage === 'turn' || stage === 'river';
}

/** Test seam: run `fn` with the facing-bet range model in its stepped (off) mode. */
export function omahaPricedWithoutMode<T>(fn: () => T): T {
  return withOmahaPricedMode(OMAHA_PRICED_MODE_OFF, fn);
}

// ---------------------------------------------------------------------------------------------------------------
// OPPONENT HUD NO-LOWERING (2026-11-21, lane OPPONENT-HUD; option omahaOpponentLifetimeHud, default OFF)
// ---------------------------------------------------------------------------------------------------------------
// Where the lifetime read would turn a raise into a call or a bet into a check BY ITSELF (the decayed read with the
// PLO presumption would have raised or bet), the lowering stands only if a priced comparison says so: the raise
// against the call (flop / turn sampled shares, his fold to a raise) or the bet against the check (turn / river), on
// the response the lifetime read measures (his fold to a bet: hudStat, shrunk n / (n + k) to the population prior;
// his fold to a raise: his raw lifetime cell, shrunk at use by the comparison). Null: not priceable here, and the
// caller then does not consume the lifetime read at that site.

const HUD_SK: Record<string, string> = { flop: 'f', turn: 't', river: 'r' };
function hudPricedReadOf(
  p: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): OmahaPricedRead {
  const base = omahaPricedReadOfUser(p.user_id, gs, opts);
  const family = String(gs.gameVariant ?? '').toLowerCase();
  const sk = HUD_SK[String(gs.stage ?? '')];
  if ((family !== 'plo4' && family !== 'plo5') || !sk || !p.user_id) return base;
  const fb = hudStat(p.user_id, family, `${sk}.fBet`, null, false);
  const fr = hudLifetimeCountOf(p.user_id, family, `${sk}.fRaise`);
  return {
    ...base,
    foldToBet: fb.n > 0 && fb.p !== null ? fb.p : base.foldToBet,
    foldToRaise: fr.n > 0 ? { hit: fr.hits, opp: fr.n } : base.foldToRaise,
  };
}
/** The raise priced above the call on the lifetime read (true), the call above the raise (false), or null. */
export function omahaHudPricedRaiseOverCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean | null {
  try {
    if (!omahaPricedInScope(player, gs, opts)) return null;
    const spot = sampledSpot(player, gs);
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
      to: potRaiseTo(player, gs, spot.toCall),
      inPosition: spot.inPosition,
      opponents: spot.live.map((p) => ({
        stack: num(p.stack),
        bet: num(p.bet),
        read: hudPricedReadOf(p, gs, opts),
      })),
      sizes: sampledSizes(player, gs, opts, spot.toCall),
    });
    return verdict ? verdict.raise === true : null;
  } catch {
    return null;
  }
}
/** The best bet priced above the check on the lifetime read (true), the check above every bet (false), or null. */
export function omahaHudPricedBetOverCheck(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean | null {
  try {
    if (!omahaPricedInScope(player, gs, opts)) return null;
    const verdict = omahaPricedBet(player, gs, (seat: number) => {
      const p = (gs.players ?? []).find((x) => x.seat === seat);
      return p ? hudPricedReadOf(p, gs, opts) : null;
    });
    if (!verdict) return null;
    return verdict.best !== null && verdict.best.ev > verdict.evCheck;
  } catch {
    return null;
  }
}
