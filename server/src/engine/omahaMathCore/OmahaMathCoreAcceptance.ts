/**
 * omahaMathCore acceptance (lane COREGUARD 2026-11-19; owner 8:48 PM Chicago:
 * "You need to fix this and make any and all proper changes as needed").
 *
 * With omahaMathCore on, the action committed to the table is exactly the
 * core's EV choice on every PLO4/PLO5 cash decision, and an error never
 * becomes a fold. This module is the one owner of that law at every door
 * between the core and the controller:
 *
 *  - keepOmahaMathCoreDecision: an authority recheck (Phase 8-14 withdrawal,
 *    the feature authority), a commit-door wager rule or a Lightning door
 *    reshape may record its verdict, but it never replaces an applied core
 *    choice (the receipt names the refused override).
 *  - omahaMathCoreExactLegalize: the only legalizer of a core proposal. It
 *    does cent or chip-unit rounding and nothing else: no near-pot snap to
 *    the full pot, no 92% / 95% stack jam, no whole-dollar style rounding.
 *    The size the core priced is the size the table plays; a size that is
 *    not legal as-is throws (the core's menu is legal by construction:
 *    OmahaMathCoreAcceptance.law.test).
 *  - omahaMathCoreRecover: on any exception in the brain (HorseLogic.decide's
 *    safety net) or a worker failure, the decision comes from the core run
 *    standalone on the request (public state and the Horse's own cards), and
 *    if the core itself fails, from the minimal exact computation: equity of
 *    the Horse's exact holding against random holdings of every live
 *    opponent (verified 2+3 evaluator) against the price; call when the
 *    equity beats the price, check when free, fold only when the equity says
 *    so. Bounded time; never throws.
 *
 * PLO6 and everything outside omahaMathCoreInScope are untouched: every
 * function here is the identity (or null) for them.
 */
import type { HorseDecision, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { calculateBettingState, validateAction } from '../PokerEngine.js';
import { noteFire } from '../BrainTelemetry.js';
import { cardToInt, omahaBest } from './OmahaMathCoreEval.js';
import {
  omahaMathCoreInScope,
  omahaMathCoreRule,
  omahaMathCoreStreetAdmitted,
  type OmahaMathCoreDecisionReceipt,
} from './OmahaMathCoreRule.js';
import type { OmahaMathCoreStreetFlag } from './OmahaMathCoreRule.js';

type Act = HorseDecision['action'];
const EPS = 0.005;
const fin = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : 0;
const cents = (x: number): number => Math.round(x * 100) / 100;

/** How a decision reached the core outside its normal wager_rules run. */
export type OmahaMathCoreRecoveredFrom =
  | 'brain_exception'
  | 'worker_failure'
  | 'controller_refused';

/** The receipt of a recovered decision: the core's receipt plus what it recovered from. */
export interface OmahaMathCoreRecoveredReceipt extends OmahaMathCoreDecisionReceipt {
  readonly recovered: {
    readonly from: OmahaMathCoreRecoveredFrom;
    readonly error: string;
    /** 'core': the full core ran standalone; 'minimal': the core failed too, equity vs random holdings decided */
    readonly method: 'core' | 'minimal';
    readonly equity: number | null;
    readonly price: number | null;
    readonly samples: number | null;
    readonly coreError: string | null;
  };
}

/** The applied core choice a decision carries, or null (switch off, out of scope, core error). */
export function omahaMathCoreChoice(
  d: { omahaMathCore?: OmahaMathCoreDecisionReceipt | null } | null | undefined
): { action: Act; amount: number | null } | null {
  const r = d?.omahaMathCore;
  if (!r || r.applied !== true || r.switch !== 'omahaMathCore' || !r.action) return null;
  // lane CORE-FIX-1 (AUDIT-A item 9): today's action kept because the core could not price it is not a core choice
  if (r.owned === false) return null;
  return { action: r.action, amount: r.amount ?? null };
}

/** True when the decision is an applied core choice (the commit is the core's). */
export function omahaMathCoreOwns(
  d: { omahaMathCore?: OmahaMathCoreDecisionReceipt | null } | null | undefined
): boolean {
  return omahaMathCoreChoice(d) !== null;
}

function sameChoice(
  a: { action: string; amount?: number | null },
  c: { action: string; amount: number | null }
): boolean {
  if (a.action !== c.action) return false;
  if (a.action === 'fold' || a.action === 'check' || a.action === 'all_in') return true;
  return Math.abs((a.amount ?? 0) - (c.amount ?? 0)) < EPS;
}

/**
 * The door law. `issued` is the decision as the core issued it; `after` is
 * what a door would submit. For an applied core decision the core's choice
 * stands (a refused override fires `omaha_math_core_override_refused_<site>`);
 * otherwise `after` is returned untouched (switch off and PLO6: identical).
 */
export function keepOmahaMathCoreDecision<T extends { action: string; amount?: number }>(
  issued: { omahaMathCore?: OmahaMathCoreDecisionReceipt | null } | null | undefined,
  after: T,
  site: string
): T {
  const c = omahaMathCoreChoice(issued);
  if (c === null || sameChoice(after, c)) return after;
  noteFire(`omaha_math_core_override_refused_${site}`);
  const out = { ...after, action: c.action } as T;
  if (c.amount === null || c.action === 'fold' || c.action === 'check' || c.action === 'all_in')
    delete out.amount;
  else out.amount = c.amount;
  return out;
}

/**
 * The only legalizer of a core proposal: the engine's own validateAction on
 * the request's betting state, cent (or chip-unit) rounding only. A size that
 * is not legal as-is is a defect and throws: no snap to another size.
 */
export function omahaMathCoreExactLegalize(
  d: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2
): HorseDecision {
  const currentBet = fin(gs.currentBet);
  const pot = fin(gs.pot);
  const heroBet = fin(player.bet);
  const stack = fin(player.stack);
  const toCall = Math.max(0, currentBet - heroBet);
  const thinkTime = d.thinkTime;
  let action: Act = d.action === ('allin' as Act) ? 'all_in' : d.action;
  if (action === 'fold' || action === 'check') {
    if (toCall <= EPS) return { action: 'check', thinkTime };
    if (action === 'check') throw new Error('omahaMathCore: check facing a bet');
    return { action: 'fold', thinkTime };
  }
  if (action === 'call') {
    if (toCall <= EPS) return { action: 'check', thinkTime };
    return toCall >= stack - EPS
      ? { action: 'all_in', thinkTime }
      : { action: 'call', amount: cents(toCall), thinkTime };
  }
  const potLimitTo = currentBet + pot + toCall;
  if (action === 'all_in') {
    if (heroBet + stack > potLimitTo + EPS)
      throw new Error('omahaMathCore: all-in above the pot-limit cap');
    return { action: 'all_in', thinkTime };
  }
  if (action !== 'bet' && action !== 'raise') throw new Error(`omahaMathCore: action ${action}`);
  if (action === 'bet' && currentBet > EPS) action = 'raise';
  if (action === 'raise' && currentBet <= EPS) action = 'bet';
  const whole = gs.chipUnit === 1 || gs.asset === 'diamonds';
  const raw = Number(d.amount);
  if (!Number.isFinite(raw) || raw <= 0) throw new Error('omahaMathCore: wager without size');
  const amt = whole ? Math.round(raw) : cents(raw);
  const allInTo = action === 'bet' ? stack : heroBet + stack;
  if (amt >= allInTo - EPS) {
    if (heroBet + stack > potLimitTo + EPS)
      throw new Error('omahaMathCore: whole-stack wager above the pot-limit cap');
    return { action: 'all_in', thinkTime };
  }
  const bs = calculateBettingState(
    pot,
    currentBet,
    heroBet,
    gs.bigBlind || 0.02,
    gs.lastRaise ?? gs.minRaise,
    true
  );
  if (validateAction(action, amt, stack, bs).valid) return { action, amount: amt, thinkTime };
  throw new Error(`omahaMathCore: illegal ${action} ${amt}`);
}

/** A small deterministic generator (the minimal computation is reproducible per request). */
function rngOf(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let s = h >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The recovery computation's whole work: hands evaluated (the hero's and every opponent's, per runout). Fixed, so
 * the answer of a failed decision does not depend on the machine's load (lane CORE-POOLED-6; BENCH-FIX's finding:
 * the loop stopped on a 15 ms clock box, so a loaded host took fewer draws and could flip a call into a fold).
 * 6,000 evaluations is about 3,000 runouts heads-up and 1,000 six-handed (equity SE 0.009 to 0.016).
 */
export const OMAHA_MATH_CORE_RECOVERY_EVALUATIONS = 6000;

/**
 * Equity of the Horse's exact holding against a random holding of each live
 * opponent, run to the river (exact 2+3 evaluator). The work is bounded by
 * OMAHA_MATH_CORE_RECOVERY_EVALUATIONS, never by the clock: `budgetMs` and `now`
 * are kept for the callers' signature and are not read.
 */
export function omahaMathCoreRandomRangeEquity(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  budgetMs: number,
  now: () => number = () => performance.now()
): { equity: number; samples: number } {
  void budgetMs;
  void now;
  const hole = (player.cards ?? []).map(cardToInt);
  const board = (gs.communityCards ?? []).map(cardToInt);
  const holeLen = hole.length;
  const opponents = Math.max(
    1,
    gs.players.filter((p) => p.seat !== player.seat && !p.is_folded).length
  );
  const used = new Set<number>([...hole, ...board]);
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
  const need = opponents * holeLen + (5 - board.length);
  if (need > deck.length) throw new Error('omahaMathCore: deck too small');
  const rng = rngOf(`${hole.join('.')}|${board.join('.')}|${gs.pot}|${opponents}`);
  const full = new Array<number>(5);
  const opp = new Array<number>(holeLen);
  let won = 0;
  let n = 0;
  const MAX = Math.max(256, Math.floor(OMAHA_MATH_CORE_RECOVERY_EVALUATIONS / (opponents + 1)));
  while (n < MAX) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    let k = 0;
    for (let i = 0; i < 5; i++) full[i] = i < board.length ? board[i] : deck[k++];
    const mine = omahaBest(hole, holeLen, full, 5);
    let best = -1;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      for (let i = 0; i < holeLen; i++) opp[i] = deck[k++];
      const s = omahaBest(opp, holeLen, full, 5);
      if (s > best) {
        best = s;
        ties = s === mine ? 1 : 0;
      } else if (s === best && s === mine) ties++;
    }
    if (mine > best) won += 1;
    else if (mine === best) won += 1 / (ties + 1);
    n++;
  }
  return { equity: n > 0 ? won / n : 0, samples: n };
}

/**
 * The decision of an exception or a worker failure in the core's scope with
 * the switch on, or null (switch off, out of scope: the caller keeps its
 * existing path, PLO6 included). `runCore` runs the full core standalone
 * first (inside the worker); the main thread passes false and gets the
 * bounded minimal computation only. Never throws.
 */
export function omahaMathCoreRecover(input: {
  player: SeatPlayer;
  gs: HorseGameStateV2;
  on: boolean;
  from: OmahaMathCoreRecoveredFrom;
  error: unknown;
  runCore: boolean;
  /** omahaMathCorePreflop: the core also owns preflop (off: the core does not recover a failed preflop decision; the caller's path decides) */
  preflopOwned?: boolean;
  /** per-street admission flags (OmahaMathCoreRule OMAHA_MATH_CORE_STREET_FLAGS): off, the core does not recover that street (the caller's path decides) */
  streetOpts?: Partial<Record<OmahaMathCoreStreetFlag, boolean>>;
  /** omahaMathCoreNetsTheWholeDeduction: the standalone core run nets the whole deduction, as the decision would have */
  wholeDeduction?: boolean;
  budgetMs?: number;
  thinkTime?: number;
  now?: () => number;
}): HorseDecision | null {
  try {
    if (input.on !== true) return null;
    const { player, gs } = input;
    if (!omahaMathCoreInScope(player, gs)) return null;
    // Lane CORE-AUDIT (Nov 21; lead decision 2026-11-19 10:55 PM: the core ships street by street): a brain
    // exception or a worker failure is the core's to recover only on a street the core OWNS (omahaMathCorePreflop
    // preflop, the game's street flag postflop). On any other street the caller's own path decides, exactly as
    // with the switch off. A controller refusal follows an applied core receipt, so that street is already owned.
    if (
      input.from !== 'controller_refused' &&
      !omahaMathCoreStreetAdmitted(
        String(gs.gameVariant ?? '').toLowerCase(),
        String(gs.stage ?? ''),
        {
          omahaMathCorePreflop: input.preflopOwned === true,
          ...(input.streetOpts ?? {}),
        }
      )
    )
      return null;
    const errorText = String((input.error as Error)?.message ?? input.error).slice(0, 200);
    const thinkTime = Number.isFinite(input.thinkTime) ? (input.thinkTime as number) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, fin(gs.currentBet) - fin(player.bet));
    const incoming = { action: (toCall > EPS ? 'fold' : 'check') as Act, amount: null };
    let coreError: string | null = null;
    if (input.runCore) {
      const ruled = omahaMathCoreRule(
        { action: incoming.action, thinkTime },
        player,
        gs,
        {
          omahaMathCore: true,
          omahaMathCorePreflop: input.preflopOwned === true,
          omahaMathCoreNetsTheWholeDeduction: input.wholeDeduction === true,
          ...(input.streetOpts ?? {}),
        },
        (d) => omahaMathCoreExactLegalize(d, player, gs),
        input.now,
        // lane CORE-FIX-1 (AUDIT-A item 7): the incoming fold / check is synthetic; no margin protects it
        'none'
      );
      const receipt = ruled.omahaMathCore;
      if (receipt?.applied === true) {
        noteFire(`omaha_math_core_recovered_core_${input.from}`);
        const recovered: OmahaMathCoreRecoveredReceipt = {
          ...receipt,
          recovered: {
            from: input.from,
            error: errorText,
            method: 'core',
            equity: null,
            price: null,
            samples: null,
            coreError: null,
          },
        };
        const out: HorseDecision = {
          action: ruled.action,
          thinkTime,
          omahaMathCore: recovered,
        };
        if (ruled.amount !== undefined) out.amount = ruled.amount;
        return out;
      }
      coreError = receipt?.error ?? 'core_not_applied';
    }
    // The minimal exact computation: equity vs random holdings against the price.
    const stack = fin(player.stack);
    let action: Act;
    let amount: number | undefined;
    let equity: number | null = null;
    let price: number | null = null;
    let samples: number | null = null;
    if (toCall <= EPS) {
      action = 'check';
    } else {
      const r = omahaMathCoreRandomRangeEquity(player, gs, input.budgetMs ?? 15, input.now);
      equity = Math.round(r.equity * 1e4) / 1e4;
      samples = r.samples;
      price = Math.round((toCall / Math.max(1e-9, fin(gs.pot) + toCall)) * 1e4) / 1e4;
      if (r.equity > toCall / Math.max(1e-9, fin(gs.pot) + toCall)) {
        if (toCall >= stack - EPS) action = 'all_in';
        else {
          action = 'call';
          amount = cents(toCall);
        }
      } else action = 'fold';
    }
    noteFire(`omaha_math_core_recovered_minimal_${input.from}`);
    const receipt: OmahaMathCoreRecoveredReceipt = {
      switch: 'omahaMathCore',
      applied: true,
      action,
      amount: amount ?? null,
      incoming,
      error: null,
      core: null,
      recovered: {
        from: input.from,
        error: errorText,
        method: 'minimal',
        equity,
        price,
        samples,
        coreError,
      },
    };
    const out: HorseDecision = { action, thinkTime, omahaMathCore: receipt };
    if (amount !== undefined) out.amount = amount;
    return out;
  } catch {
    // Never throws: the caller keeps its existing liveness path.
    return null;
  }
}
