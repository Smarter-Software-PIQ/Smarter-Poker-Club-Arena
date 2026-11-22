/**
 * omahaMathCore wiring (lane MATHCORE 2026-11-19; option omahaMathCore,
 * default OFF, read === true). The final strategy owner of a PLO4/PLO5 cash
 * decision: HorseLogic wraps the whole wager_rules result with this rule, so
 * when the option is on the core's EV choice is the decision (the commit door
 * keeps it, ServerTableEngineTurns, and the response validator admits it,
 * responseValidation omahaMathCoreAdmits).
 *
 * The decision that reaches this rule is never an input to the choice. It is
 * returned unchanged only outside the scope, and when the core throws (the
 * receipt then names the error): never a fold the core did not choose.
 */
import type { HorseDecision, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';
import { cardToInt } from './OmahaMathCoreEval.js';
import { CURRENT_NUTS_CALL_FLOOR, holdsCurrentNuts } from './OmahaMathCoreNutsFloor.js';
import { publicHistoryOf, selectionScore } from './OmahaMathCoreWire.js';
import { noteFire } from '../BrainTelemetry.js';
import {
  decideOmahaMathCore,
  rakeNet,
  type CoreOpponent,
  type CoreReceipt,
  type CoreState,
  OMAHA_MATH_CORE_CBET_RAISE_READ,
  OMAHA_MATH_CORE_VERSION,
  omahaMathCoreOpponentRecords,
} from './OmahaMathCore.js';
import {
  omahaMathCoreTurnRiverProvider,
  priceTurnRiverLifetimeCall,
} from './OmahaMathCoreTurnRiver.js';
import { sizeBand, type Band, type Line } from './MeasuredRanges.js';
import type { PreflopLevel, PreflopPosition } from './OmahaMathCoreTables.js';

export const OMAHA_MATH_CORE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
// Owner 2026-11-19 8:26 PM: PLO6 is a separate game ("DON'T TOUCH PLO6"): six-card decisions never enter the core.
const HEADS_UP_RAKE_PERCENT = 5;
const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
const WAGERS = new Set(['bet', 'raise', 'all_in']);
const ACTS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

/**
 * Per-street admission (lead decision 2026-11-19 10:55 PM: the core ships street by street). With omahaMathCore
 * on, the core OWNS a postflop decision only on a street whose flag is on for that game; on every other street it
 * does no work at all (no receipt; OmahaMathCoreOffScopeNoWork) and today's action stands. Default all OFF (read === true).
 */
export const OMAHA_MATH_CORE_STREET_FLAGS = {
  plo4: {
    flop: 'omahaMathCorePlo4Flop',
    turn: 'omahaMathCorePlo4Turn',
    river: 'omahaMathCorePlo4River',
  },
  plo5: {
    flop: 'omahaMathCorePlo5Flop',
    turn: 'omahaMathCorePlo5Turn',
    river: 'omahaMathCorePlo5River',
  },
} as const;
export type OmahaMathCoreStreetFlag =
  (typeof OMAHA_MATH_CORE_STREET_FLAGS)[keyof typeof OMAHA_MATH_CORE_STREET_FLAGS][
    | 'flop'
    | 'turn'
    | 'river'];
export const OMAHA_MATH_CORE_STREET_FLAG_NAMES: readonly OmahaMathCoreStreetFlag[] = [
  'omahaMathCorePlo4Flop',
  'omahaMathCorePlo4Turn',
  'omahaMathCorePlo4River',
  'omahaMathCorePlo5Flop',
  'omahaMathCorePlo5Turn',
  'omahaMathCorePlo5River',
];
/** every street admitted (tests and the full-core grading arm) */
export const OMAHA_MATH_CORE_ALL_STREETS: Readonly<Record<OmahaMathCoreStreetFlag, true>> = {
  omahaMathCorePlo4Flop: true,
  omahaMathCorePlo4Turn: true,
  omahaMathCorePlo4River: true,
  omahaMathCorePlo5Flop: true,
  omahaMathCorePlo5Turn: true,
  omahaMathCorePlo5River: true,
};
export type OmahaMathCoreOpts = {
  omahaMathCore?: boolean;
  omahaMathCorePreflop?: boolean;
  /** EMERG lane RAKE 2026-11-20 (default OFF): the core nets the whole deduction (tier cap, jackpot drop, preflop lines that see a flop) */
  omahaMathCoreNetsTheWholeDeduction?: boolean;
} & Partial<Record<OmahaMathCoreStreetFlag, boolean>>;

/** True when the core owns this street's decision (preflop: omahaMathCorePreflop; postflop: the street flag). */
export function omahaMathCoreStreetAdmitted(
  variant: string,
  street: string,
  opts: OmahaMathCoreOpts
): boolean {
  if (street === 'preflop') return opts.omahaMathCorePreflop === true;
  const g = OMAHA_MATH_CORE_STREET_FLAGS[variant as 'plo4' | 'plo5'];
  if (!g) return false;
  const flag = g[street as 'flop' | 'turn' | 'river'];
  return flag !== undefined && opts[flag] === true;
}

/**
 * "Prove it to change it" (lead 10:55 PM; lane COREWIRE-2): the core replaces today's action only when its best
 * candidate's EV beats the EV of today's action (priced by the core on the same basis) by more than k standard
 * errors of the difference. k is fitted on Nov 17-18 only (never on the Nov 19 holdout): exact journal replay of
 * f827c50ce4a with the margin off (tag r1, 1,848 changed decisions graded vs real cards, always-call metric);
 * criterion declared before the fit: maximize the smallest per-street sum over the six game x street cells of
 * Nov 17-18 (the ship gate is per street), ties to the larger total. Grid 0..8: k=5 gives min -55 bb (PLO5
 * flop), total +1,174 bb; k=4 min -423, k=6 min -96, k=8 min -56. See repairs/EMERG/COREWIRE.md.
 */
export const OMAHA_MATH_CORE_CHANGE_MARGIN_K: number | null = 5;

/**
 * Class margin (lane CORE-3, criterion repairs/EMERG/CORE3 CRITERIA-CORE3-1, sha256 cdb4808a...): when today's action
 * is a CALL and the core's best is a RAISE below all-in (raise for value / raise a combo draw instead of flatting),
 * the margin is k = 2. Fit (Nov 18 only, r1 = margin off): that class with 2 <= z < 5 summed +210 +- 84 bb vs real
 * cards (always-call metric), K >= 2 +326 +- 104 bb, positive on flop, turn and river; call -> all-in is NOT in the
 * class (r1 Nov 18 -329 +- 158 bb) and keeps k = 5 like every other change.
 */
export const OMAHA_MATH_CORE_RAISE_OVER_CALL_MARGIN_K = 2;

/** the margin that applies to replacing `incoming` by `best` (call -> sub-all-in raise: class margin; else K) */
export function omahaMathCoreChangeMarginK(
  incomingAction: HorseDecision['action'],
  bestAction: HorseDecision['action'],
  variant: string
): number | null {
  if (OMAHA_MATH_CORE_CHANGE_MARGIN_K === null) return null;
  // PLO5 only: the fit evidence is PLO5 (+326 +- 104 bb); PLO4 had 3 such decisions on Nov 18 and its graded
  // replay (c3a) moved PLO4 turn by one decision (-21 bb): PLO4 keeps k = 5 until it has its own evidence.
  if (variant === 'plo5' && incomingAction === 'call' && bestAction === 'raise')
    return Math.min(OMAHA_MATH_CORE_CHANGE_MARGIN_K, OMAHA_MATH_CORE_RAISE_OVER_CALL_MARGIN_K);
  return OMAHA_MATH_CORE_CHANGE_MARGIN_K;
}

/**
 * River all-in commit margin (lane RIVER-CORE, criterion repairs/EMERG/CRITERIA-RIVER-CORE-2.md, sha256 f8f01229...):
 * on the PLO5 river a change from FOLD to a continue that commits the Horse's whole stack (all-in, or a call / raise
 * whose amount is the whole stack, incl. a call-off where the only legal continue is all-in) must beat folding by
 * more than K_allin standard errors of the difference; when the priced SE is 0 (exact), by more than K_allin % of the
 * chips committed. Measured (exact journal replay of the next-branch core, real chips to persons): every such change
 * on Nov 18-19 (7 of 7) met real equity 0 (persons' river all-ins are value); K_allin fitted on Nov 18 only over the
 * declared grid {5, 8, 10, 15, 20, 25, 30, 40, 60} (max class sum, ties to the smallest K): 25 (Nov 18 z of the four
 * changes 5.2 / 5.7 / 16.1 / 21.7, sum -846 chips at K = 5, 0 at K >= 25). fold -> call that does not commit the
 * stack is unchanged (K = 5). PLO4 / PLO6 / flop / turn: never.
 */
export const OMAHA_MATH_CORE_RIVER_ALLIN_COMMIT_MARGIN_K = 25;

/** true when the change may stand under the river all-in commit margin (or the margin does not apply) */
export function omahaMathCoreRiverAllInCommitOk(
  variant: string,
  street: string,
  incomingAction: string,
  best: { action: string; amount: number | null },
  gap: number,
  se: number,
  heroStack: number,
  heroBet: number
): boolean {
  if (variant !== 'plo5' || street !== 'river' || incomingAction !== 'fold') return true;
  const eps = 0.005;
  const stack = Math.max(0, heroStack);
  const commits =
    best.action === 'all_in' ||
    (best.action === 'call' && (best.amount ?? 0) >= stack - eps) ||
    ((best.action === 'bet' || best.action === 'raise') &&
      (best.amount ?? 0) >= Math.max(0, heroBet) + stack - eps);
  if (!commits) return true;
  const k = OMAHA_MATH_CORE_RIVER_ALLIN_COMMIT_MARGIN_K;
  if (se > 0) return gap > k * se;
  return gap > (k / 100) * stack;
}

/**
 * PLO5 river scope (lane RIVER-CORE, criterion repairs/EMERG/CRITERIA-RIVER-CORE-3.md, sha256 8b77e342...): the full
 * river core graded FAIL in real chips to persons (third journal day -1,883 +- 1,185: its new leads, shoves and
 * call-offs). On the PLO5 cash river the core may only turn today's FOLD into a plain CALL that leaves chips behind,
 * when EV(call) - EV(fold) beats K standard errors (SE 0: any positive gap) and the raw fold-boundary test passes;
 * every other PLO5 river decision is today's action. Returns the call candidate, or null (today's action stands).
 */
export function omahaMathCorePlo5RiverFoldToCall(
  incomingAction: string,
  evs: ReadonlyArray<{
    action: string;
    amount: number | null;
    ev: number;
    se: number | null;
    calibration?: { raw: number; rawSe: number | null } | null;
  }>,
  heroStack: number,
  k: number
): { action: 'call'; amount: number | null } | null {
  if (incomingAction !== 'fold') return null;
  const fold = evs.find((e) => e.action === 'fold');
  const call = evs.find((e) => e.action === 'call');
  if (!fold || !call) return null;
  if (!((call.amount ?? 0) < Math.max(0, heroStack) - 0.005)) return null;
  const se = Math.sqrt(Math.max(0, call.se ?? 0) ** 2 + Math.max(0, fold.se ?? 0) ** 2);
  const gap = call.ev - fold.ev;
  if (!(gap > k * se) || !(gap > 0)) return null;
  if (!omahaMathCoreFoldBoundaryRawOk(call, fold, 'fold', 'call', k)) return null;
  return { action: 'call', amount: call.amount };
}

type PricedEv = {
  ev: number;
  se: number | null;
  calibration?: { raw: number; rawSe: number | null } | null;
};
/**
 * CORE-4: a change across the fold boundary (fold -> continue, continue -> fold) must also beat today's action by
 * more than k standard errors at the RAW (uncalibrated) price; changes between continuing actions use the
 * calibrated price only. True when the raw test passes or does not apply.
 */
export function omahaMathCoreFoldBoundaryRawOk(
  best: PricedEv,
  inc: PricedEv,
  incomingAction: string,
  bestAction: string,
  k: number
): boolean {
  if ((incomingAction === 'fold') === (bestAction === 'fold')) return true;
  const raw = (e: PricedEv) => (e.calibration ? e.calibration.raw : e.ev);
  const rse = (e: PricedEv) => Math.max(0, (e.calibration ? e.calibration.rawSe : e.se) ?? 0);
  return raw(best) - raw(inc) > k * Math.sqrt(rse(best) ** 2 + rse(inc) ** 2);
}

export interface OmahaMathCoreDecisionReceipt {
  readonly switch: 'omahaMathCore';
  readonly applied: boolean;
  /** the core's choice (when applied), the action this decision carries */
  readonly action: HorseDecision['action'] | null;
  readonly amount: number | null;
  /** the decision that reached the core (for the record only; never an input) */
  readonly incoming: { action: HorseDecision['action']; amount: number | null };
  readonly error: string | null;
  readonly core: CoreReceipt | null;
  /** a street the core does not own (preflop: omahaMathCorePreflop off; postflop: its street flag off): computed
   * and receipted only; today's action stands */
  readonly shadow?: boolean;
  /**
   * lane CORE-FIX-1 (AUDIT-A item 9): false when today's action was KEPT because the core could not price it (receipt
   * core.kept.unpriced). That decision is the rules', not the core's: omahaMathCoreChoice / omahaMathCoreOwns read
   * it as no core choice, so no door treats it as core-protected, and its receipt choice carries no EV (null).
   */
  readonly owned?: false;
}

/**
 * lane CORE-FIX-1 (AUDIT-A item 7): whether today's action is a real incumbent. 'today': a decision someone made
 * reached the core, and "prove it to change it" (the change margin) protects it. 'none': the core runs standalone
 * (omahaMathCoreRecover after a brain exception or a worker failure) with a synthetic fold / check that nobody
 * chose; nothing is proven against a decision that was never made, so the core's EV choice stands. With 'none' a
 * synthetic fold no longer wins every spot whose continue cannot clear K standard errors.
 */
export type OmahaMathCoreIncumbent = 'today' | 'none';

/** In scope: PLO4/PLO5 cash, high only, one board, no bomb pot, pot limit, uncapped, a live decision. */
export function omahaMathCoreInScope(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_MATH_CORE_VARIANTS.has(variant)) return false;
  // HorseLogic.isTournamentMode's own reading (the engine's explicit mode wins)
  if (
    gs.gameMode ? gs.gameMode === 'tournament' : gs.tournament != null || (gs.bigBlind ?? 0) >= 10
  )
    return false;
  if (
    gs.variantRules?.splitLow8OrBetter ||
    (gs.boardCount ?? 1) !== 1 ||
    gs.communityCards2?.length ||
    gs.communityCards3?.length ||
    gs.bombPot === true ||
    gs.allInOrFold ||
    gs.wagersCapped === true ||
    (gs.bettingStructure !== undefined && gs.bettingStructure !== 'pot_limit')
  )
    return false;
  // lane CORE-POOLED-5: Diamond Arena is closed (platform hard rule). The core is never consulted on a
  // Diamond table; its Diamond fee branch (rake.platform.diamond, platformDeduction) is not applicable and is
  // unreachable from a decision (law: OmahaMathCoreOffScopeNoWork.law.test.ts, 'a Diamond table').
  if (gs.asset === 'diamonds') return false;
  if (!STREETS.includes(gs.stage as (typeof STREETS)[number])) return false;
  const hole = player.cards ?? [];
  if (hole.length !== Number(variant.at(-1))) return false;
  if (player.is_folded || player.is_all_in || !(player.stack > 0)) return false;
  return true;
}

/** Postflop acting order rank: the first seat left of the button acts first (0), the button last. */
function orderRank(seat: number, dealer: number | undefined): number {
  if (!Number.isFinite(dealer)) return seat;
  return (((seat - (dealer as number) - 1) % 10) + 10) % 10;
}

/** Six-max position names of the measured table, counted back from the button (BTN, CO, HJ, UTG...; SB, BB after it). */
function positionsOf(seats: number[], dealer: number | undefined): Map<number, PreflopPosition> {
  const out = new Map<number, PreflopPosition>();
  if (!Number.isFinite(dealer) || seats.length < 2) return out;
  const sorted = [...seats].sort((a, b) => orderRank(a, dealer) - orderRank(b, dealer));
  // sorted: SB, BB, UTG, ..., BTN (heads-up: the button is the small blind)
  const n = sorted.length;
  if (n === 2) {
    out.set(sorted[1], 'BTN');
    out.set(sorted[0], 'BB');
    return out;
  }
  out.set(sorted[0], 'SB');
  out.set(sorted[1], 'BB');
  const rest = sorted.slice(2).reverse(); // BTN first
  const names: PreflopPosition[] = ['BTN', 'CO', 'HJ', 'UTG'];
  rest.forEach((seat, k) => out.set(seat, names[Math.min(k, names.length - 1)]));
  return out;
}

const LEVELS: PreflopLevel[] = ['open', '3bet', '4bet', '5bet+'];

/** Build the core's state from the request: cards, board, chips and the public line only. */
export function omahaMathCoreState(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  wholeDeduction = false
): CoreState {
  const variant = String(gs.gameVariant).toLowerCase() as 'plo4' | 'plo5';
  const street = gs.stage as CoreState['street'];
  const history = (gs.actionHistory ?? []).filter((a) => ACTS.has(a.action));
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
  const si = STREETS.indexOf(street);

  // preflop raise levels per seat, and the street-by-street aggressors
  const preLevel = new Map<number, PreflopLevel | 'call'>();
  let preRaises = 0;
  let preLevelChips = 0;
  const lastAggressor: (number | null)[] = [null, null, null, null];
  const calledOn: Set<number>[] = [new Set(), new Set(), new Set(), new Set()];
  {
    const totals = new Map<string, number>();
    const level: number[] = [0, 0, 0, 0];
    for (const a of history) {
      const k = STREETS.indexOf(String(a.stage) as (typeof STREETS)[number]);
      if (k < 0) continue;
      const key = `${k}:${a.seat}`;
      const prevT = totals.get(key) ?? 0;
      const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
      if (a.action === 'call') {
        totals.set(key, prevT + amt);
        if (lastAggressor[k] !== null) calledOn[k].add(a.seat);
        if (k === 0 && !preLevel.has(a.seat)) preLevel.set(a.seat, 'call');
      } else if (WAGERS.has(a.action)) {
        const now = Math.max(prevT, amt);
        totals.set(key, now);
        if (now > level[k] + 0.005) {
          level[k] = now;
          lastAggressor[k] = a.seat;
          if (k === 0) {
            preRaises++;
            preLevelChips = now;
            preLevel.set(a.seat, LEVELS[Math.min(preRaises - 1, LEVELS.length - 1)]);
          }
        } else if (k === 0 && !preLevel.has(a.seat)) preLevel.set(a.seat, 'call');
      }
    }
    void preLevelChips;
  }
  const prevAggressor = si > 0 ? lastAggressor[si - 1] : null;

  // this street in order: the last wager, its line and size, each seat's last action
  const totals = new Map<number, number>();
  const lastAction = new Map<number, 'check' | 'call' | 'wager'>();
  const checkedFirst = new Set<number>();
  let level = 0;
  let wagers = 0;
  let aggressorSeat: number | null = null;
  let line: Line | null = null;
  let streetChipsBefore = 0;
  let wagerAdd = 0;
  let wagerPotBefore = 0;
  let toCallBefore = 0;
  let streetChips = 0;
  for (const a of history) {
    if (String(a.stage) !== street) continue;
    const prevT = totals.get(a.seat) ?? 0;
    const amt = Number.isFinite(a.amount) ? Math.max(0, a.amount) : 0;
    if (a.action === 'check') {
      lastAction.set(a.seat, 'check');
      if (wagers === 0) checkedFirst.add(a.seat);
    } else if (a.action === 'call') {
      totals.set(a.seat, prevT + amt);
      streetChips += amt;
      lastAction.set(a.seat, 'call');
    } else if (WAGERS.has(a.action)) {
      const now = Math.max(prevT, amt);
      const add = now - prevT;
      if (now > level + 0.005) {
        streetChipsBefore = streetChips;
        toCallBefore = Math.max(0, level - prevT);
        wagerAdd = add;
        level = now;
        wagers++;
        aggressorSeat = a.seat;
        if (wagers >= 2) line = checkedFirst.has(a.seat) ? 'check_raise' : 'raise';
        else if (street === 'preflop') line = null;
        else if (prevAggressor !== null && a.seat === prevAggressor)
          line = street === 'flop' ? 'cbet' : 'barrel';
        else if (prevAggressor === null) line = 'stab';
        else if (checkedFirst.has(prevAggressor)) line = 'probe';
        else line = 'donk';
      }
      totals.set(a.seat, now);
      streetChips += add;
      lastAction.set(a.seat, 'wager');
    }
  }
  const streetBetsNow = gs.players.reduce((s, p) => s + (Number.isFinite(p.bet) ? p.bet : 0), 0);
  const potStart = Math.max(0, gs.pot - streetBetsNow);
  wagerPotBefore = potStart + streetChipsBefore;
  let band: Band | null = null;
  let wagerFrac = 0;
  if (aggressorSeat !== null && street !== 'preflop') {
    const aggr = gs.players.find((p) => p.seat === aggressorSeat);
    const frac =
      wagers >= 2
        ? (wagerAdd - toCallBefore) / Math.max(1e-9, wagerPotBefore + toCallBefore)
        : wagerAdd / Math.max(1e-9, wagerPotBefore);
    wagerFrac = frac;
    band = sizeBand(frac, !!aggr?.is_all_in);
  }
  // the line a hero wager would be
  let heroWagerLine: Line;
  if (aggressorSeat !== null)
    heroWagerLine = checkedFirst.has(player.seat) ? 'check_raise' : 'raise';
  else if (prevAggressor === player.seat) heroWagerLine = street === 'flop' ? 'cbet' : 'barrel';
  else if (prevAggressor === null) heroWagerLine = 'stab';
  else if (checkedFirst.has(prevAggressor)) heroWagerLine = 'probe';
  else heroWagerLine = 'donk';

  const seated = gs.players.filter(
    (p) =>
      // a seat sitting out still counts while he is all-in or has chips in this street
      (!p.is_sitting_out || p.is_all_in || (p.bet ?? 0) > 0) &&
      !(gs.dealtSeatIds && !gs.dealtSeatIds.includes(p.seat))
  );
  const pos = positionsOf(
    seated.map((p) => p.seat),
    gs.dealerSeat
  );
  const opponents: CoreOpponent[] = seated
    .filter((p) => p.seat !== player.seat)
    .map((p) => ({
      seat: p.seat,
      stack: Math.max(0, p.stack || 0),
      bet: Math.max(0, p.bet || 0),
      folded: !!p.is_folded,
      // no chips behind is all-in whether or not the seat carries the flag (PROVE-2 hand 60037957)
      allIn: !!p.is_all_in || !((p.stack ?? 0) > 0.005),
      streetAction: lastAction.get(p.seat) ?? 'none',
      calledPrevStreet: si > 0 && calledOn[si - 1].has(p.seat),
      prevAggressor: prevAggressor === p.seat,
      position: pos.get(p.seat) ?? null,
      preflopLevel: preLevel.get(p.seat) ?? 'none',
    }));
  const live = opponents.filter((o) => !o.folded);
  // lane CORE-EXTEND-5: each live opponent's lifetime public answers to a flop continuation bet, by seat, from the
  // one opponent-record provider (installed outside the core); only where the core reads them
  const recs = omahaMathCoreOpponentRecords();
  if (
    recs &&
    street === 'flop' &&
    OMAHA_MATH_CORE_CBET_RAISE_READ.streets[variant]?.includes('flop')
  ) {
    const players = live.length === 1 ? 'hu' : 'mw';
    for (const o of live) {
      try {
        o.cbetAnswers = recs.cbetAnswers(gs, o.seat, variant, players);
      } catch {
        o.cbetAnswers = null;
      }
    }
  }
  const heroRank = orderRank(player.seat, gs.dealerSeat);
  const ip = live.every((o) => orderRank(o.seat, gs.dealerSeat) < heroRank);
  // lane CORE-POOLED-5: the rated player count is the platform's own count at settlement
  // (HandController.priceDeductions: the seats not sitting out), from the same flags; the dealt-seat census
  // and the all-in / chips-in exception above are for ranges and positions, not for the rake tier
  // (law: OmahaMathCorePlatformRake.law.test.ts).
  const dealt = gs.players.filter((p) => !p.is_sitting_out).length;
  const rc = gs.rakeConfig;
  const tableCap = rc && Number.isFinite(rc.cap) ? rc.cap : Infinity;
  // lane CORE-POOLED-4 (CORE-AUDIT note 9): the core nets every pot exactly as the platform deducts it, by
  // default (the cap of the dealt-player tier, the heads-up ceiling, cent rounding, the jackpot drop clipped to the
  // pot, a Diamond table: rake.platform, OmahaMathCore.ts platformDeduction). omahaMathCoreNetsTheWholeDeduction
  // is kept as a name and no longer changes anything (`wholeDeduction` is read by nothing below).
  void wholeDeduction;
  const tier = rc?.playerCountCaps?.length
    ? [...rc.playerCountCaps].sort((a, b) => b.players - a.players).find((t) => dealt >= t.players)
    : undefined;
  const bbj = gs.bbjConfig;
  const drop =
    bbj?.enabled === true && dealt >= bbj.minPlayersDealt && gs.bigBlind > 0
      ? Math.round(gs.bigBlind * bbj.feeBB * 100) / 100
      : 0;
  const pct = rc && Number.isFinite(rc.percent) ? rc.percent : 0;
  const rake = rc
    ? {
        percent: dealt <= 2 ? Math.min(pct, HEADS_UP_RAKE_PERCENT) : pct,
        cap: tier && Number.isFinite(tier.cap) ? Math.max(0, tier.cap) : tableCap,
        noFlopNoDrop: rc.noFlopNoDrop !== false,
        whole: true,
        drop: Number.isFinite(drop) ? drop : 0,
        platform: {
          config: {
            percent: pct,
            cap: Number.isFinite(rc.cap) ? rc.cap : Infinity,
            noFlopNoDrop: rc.noFlopNoDrop !== false,
            ...(rc.playerCountCaps?.length
              ? {
                  playerCountCaps: rc.playerCountCaps.map((t) => ({
                    players: t.players,
                    cap: t.cap,
                  })),
                }
              : {}),
          },
          players: dealt,
          bbjFee: Number.isFinite(drop) ? drop : 0,
          ...(rc.diamondCashFees && gs.asset === 'diamonds'
            ? {
                diamond: {
                  schedule: rc.diamondCashFees.schedule,
                  variant: rc.diamondCashFees.variant,
                  doubleBoard: rc.diamondCashFees.doubleBoard,
                },
              }
            : {}),
        },
      }
    : null;
  const hole = (player.cards ?? []).map(cardToInt);
  const board = (gs.communityCards ?? []).map(cardToInt);
  // the hand's public line for lanes RANGEADV (postflop) and PREFLOP-EV (preflop bands)
  const ph = publicHistoryOf(gs, pos);
  const legal = Array.isArray(gs.legalActions)
    ? [...gs.legalActions]
    : toCall > 0
      ? ['fold', 'call', 'raise', 'all_in']
      : ['check', 'bet', 'all_in'];
  return {
    variant,
    chipUnit: gs.chipUnit === 1 || gs.asset === 'diamonds' ? 1 : 0.01,
    mode: gs.publicMemoryDomain?.speed === 'lightning' ? 'lightning' : 'table',
    street,
    hole,
    board,
    pot: gs.pot,
    toCall,
    heroBet: Math.max(0, player.bet || 0),
    heroStack: Math.max(0, player.stack || 0),
    currentBet: Math.max(0, gs.currentBet || 0),
    minRaiseTo: Number.isFinite(gs.minRaiseTo) ? (gs.minRaiseTo as number) : null,
    maxRaiseTo: Number.isFinite(gs.maxRaiseTo) ? (gs.maxRaiseTo as number) : null,
    bigBlind: gs.bigBlind,
    legal,
    heroSeat: player.seat,
    heroPosition: pos.get(player.seat) ?? null,
    ip,
    opponents,
    aggressorSeat,
    line,
    band,
    wagerFrac,
    checkedBeforeWager: checkedFirst.size > 0,
    heroWagerLine,
    preflopRaises: preRaises,
    rake,
    // deterministic per request: the cards and the public node (never the brain's stream)
    seed: `${hole.join('.')}|${board.join('.')}|${gs.pot}|${toCall}|${player.seat}|${history.length}`,
    history: ph.history,
    preflopActions: ph.preflopActions,
  };
}

function sameAction(
  a: { action: string; amount: number | null },
  b: { action: string; amount?: number }
): boolean {
  return (
    a.action === b.action &&
    (a.action === 'all_in' || Math.abs((a.amount ?? 0) - (b.amount ?? 0)) <= 0.011)
  );
}

/** Today's action among the core's priced candidates: the same action, the nearest size for a wager. */
function incumbentOf(
  evs: CoreReceipt['evs'],
  incoming: { action: string; amount: number | null }
): CoreReceipt['evs'][number] | null {
  const same = evs.filter((e) => e.action === incoming.action);
  if (same.length === 0) return null;
  if (incoming.action !== 'bet' && incoming.action !== 'raise') return same[0];
  const amt = incoming.amount ?? 0;
  return same.reduce((x, y) =>
    Math.abs((y.amount ?? 0) - amt) < Math.abs((x.amount ?? 0) - amt) ? y : x
  );
}

// (toDecision kept for tests)
export function toDecision(receipt: CoreReceipt, base: HorseDecision): HorseDecision {
  const { action, amount } = receipt.choice;
  const d: HorseDecision = { action, thinkTime: base.thinkTime };
  if (action !== 'fold' && action !== 'check' && amount !== null) d.amount = amount;
  return d;
}

/**
 * The rule. `legalize` is HorseLogic's own legalizer: the core's choice is
 * legal as proposed (the receipt records the legal decision); a choice the
 * legalizer rewrites is an error and falls back.
 */
export function omahaMathCoreRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: OmahaMathCoreOpts,
  legalize: (d: HorseDecision) => HorseDecision,
  now: () => number = () => performance.now(),
  incumbent: OmahaMathCoreIncumbent = 'today'
): HorseDecision {
  if (opts.omahaMathCore !== true) return decision;
  // Lane CORE-POOLED-2 latency (lead order 04:3xZ Nov 21; VERIFIER V60, SHADOW: with only the PLO5 flop flag on,
  // turn and river decisions cost 51 ms / 15 ms more and the flop 65 ms): a street whose admission flag is off is
  // not the core's decision, so the core does no work there at all - no state build, no pool, no equity draw, no
  // receipt. This replaces the COREWIRE-2 shadow receipt on non-admitted streets (2026-11-19); acted decisions are
  // unchanged because a non-admitted street always executed today's action. Cheap checks first: the admission flag
  // reads only the variant and the stage.
  if (
    !omahaMathCoreStreetAdmitted(
      String(gs.gameVariant ?? '').toLowerCase(),
      String(gs.stage ?? ''),
      opts
    )
  )
    return decision;
  let inScope = false;
  try {
    inScope = omahaMathCoreInScope(player, gs);
  } catch {
    inScope = false;
  }
  if (!inScope) return decision;
  const incoming = { action: decision.action, amount: decision.amount ?? null };
  try {
    const coreState = omahaMathCoreState(
      player,
      gs,
      opts.omahaMathCoreNetsTheWholeDeduction === true
    );
    // B3 fast-path (lane core-repair, 2026-11-22; audit P0-1 & P0-2): on PLO4/PLO5 cash turn/river
    // against a live incumbent ('today'), NEVER fall through to the failed, uncertified population
    // turn/river decideOmahaMathCore() pass — even when no opponent-lifetime HUD packet is installed.
    // ONLY fold -> plain call proven by priceTurnRiverLifetimeCall (when trProv.active(trVariant))
    // plus CURRENT_NUTS_CALL_FLOOR is permitted. Any unpriced kept decision sets owned: false so
    // downstream safety doors (commit-door, V44 Second Look, Lightning fold-through, Phase 8-14
    // withdrawals) retain full authority.
    const trStage = String(gs.stage);
    const trVariantRaw = String(gs.gameVariant).toLowerCase();
    const trVariant: 'plo4' | 'plo5' | null =
      trVariantRaw === 'plo4' || trVariantRaw === 'plo5' ? trVariantRaw : null;
    const trProv = omahaMathCoreTurnRiverProvider();
    if (
      incumbent === 'today' &&
      trVariant !== null &&
      (trStage === 'turn' || trStage === 'river')
    ) {
      const trT0 = now();
      const keepInc: HorseDecision = { action: incoming.action, thinkTime: decision.thinkTime };
      if (incoming.amount !== null && incoming.action !== 'fold' && incoming.action !== 'check')
        keepInc.amount = incoming.amount;
      let trLegal: HorseDecision = keepInc;
      const liveOpps = coreState.opponents.filter((o) => !o.folded);
      let trSamples = 0;
      let trEv: number | null = incoming.action === 'fold' ? 0 : null;
      if (
        trProv?.active?.(trVariant) === true &&
        incoming.action === 'fold' &&
        coreState.aggressorSeat !== null &&
        coreState.line !== null &&
        coreState.line !== 'raise' &&
        coreState.line !== 'check_raise' &&
        liveOpps.length === 1 &&
        liveOpps[0].seat === coreState.aggressorSeat
      ) {
        const hudLine: 'stab' | 'lead' = coreState.checkedBeforeWager === true ? 'stab' : 'lead';
        const lineFw = trProv.firstWager(
          gs,
          coreState.aggressorSeat,
          trVariant,
          trStage,
          'hu',
          hudLine
        );
        const pooledFw = trProv.firstWager(gs, coreState.aggressorSeat, trVariant, trStage, 'hu');
        const fw = lineFw && lineFw.opps > 0 ? lineFw : pooledFw;
        if (fw && fw.opps > 0) {
          const brl =
            trProv.barrel?.(gs, coreState.aggressorSeat, trVariant, trStage, 'hu') ?? null;
          const rvFw =
            trStage === 'turn'
              ? (trProv.riverRate?.(gs, coreState.aggressorSeat, trVariant, 'hu') ?? null)
              : null;
          const trRes = priceTurnRiverLifetimeCall({
            state: coreState,
            counts: fw,
            pooledCounts: pooledFw,
            barrel: brl,
            riverCounts: rvFw,
            net: (p) => rakeNet(coreState, p),
            k: OMAHA_MATH_CORE_CHANGE_MARGIN_K ?? 5,
          });
          trSamples = trRes.pool ?? 0;
          if (trRes.call && trRes.callChips !== undefined) {
            const proposed: HorseDecision = {
              action: 'call',
              amount: trRes.callChips,
              thinkTime: decision.thinkTime,
            };
            try {
              const l = legalize(proposed);
              if (l.action === 'call' && Math.abs((l.amount ?? 0) - trRes.callChips) <= 0.011) {
                trLegal = l;
                if (typeof trRes.evCall === 'number' && Number.isFinite(trRes.evCall))
                  trEv = Math.round(trRes.evCall * 100) / 100;
              }
            } catch {
              trLegal = keepInc;
            }
          }
        }
      }
      let nutFloor: string | undefined;
      if (
        CURRENT_NUTS_CALL_FLOOR &&
        trLegal.action === 'fold' &&
        coreState.board.length >= 3 &&
        coreState.toCall > 0.005 &&
        holdsCurrentNuts(coreState.hole, coreState.board)
      ) {
        const stack = Math.max(0, player.stack ?? 0);
        const tries: HorseDecision[] =
          coreState.toCall < stack - 0.005
            ? [{ action: 'call', amount: coreState.toCall, thinkTime: decision.thinkTime }]
            : [];
        tries.push({ action: 'all_in', thinkTime: decision.thinkTime });
        for (const t of tries) {
          let l: HorseDecision;
          try {
            l = legalize(t);
          } catch {
            continue;
          }
          if (l.action === 'fold') continue;
          if (l.action === 'all_in' && Math.max(0, stack) > coreState.toCall + 0.005) continue;
          nutFloor = `current nuts facing a wager (${trStage}): fold replaced by ${l.action}`;
          trLegal = l;
          trEv = null;
          break;
        }
      }
      const trReceipt: CoreReceipt = {
        version: OMAHA_MATH_CORE_VERSION,
        switch: 'omahaMathCore',
        tables: 'b3-turn-river-hud',
        street: trStage,
        realization: { value: 1, source: 'b3-turn-river-hud' },
        price:
          coreState.toCall > 0
            ? Math.round(
                (coreState.toCall / Math.max(0.01, coreState.pot + coreState.toCall)) * 10000
              ) / 10000
            : 0,
        pot: Math.round(coreState.pot * 100) / 100,
        toCall: Math.round(coreState.toCall * 100) / 100,
        opponents: liveOpps.map((o) => ({ seat: o.seat, range: 'hud-lifetime' })),
        evs: [],
        choice: {
          action: trLegal.action as CoreReceipt['choice']['action'],
          amount: trLegal.amount ?? null,
          ev: trEv,
        },
        ...(nutFloor ? { nutFloor } : {}),
        samples: trSamples,
        ms: Math.round((now() - trT0) * 10) / 10,
      };
      const trKeptUnpriced =
        trLegal.action === incoming.action && trLegal.amount === (incoming.amount ?? undefined);
      const trOut: HorseDecision = {
        ...decision,
        action: trLegal.action,
        amount: trLegal.amount,
        omahaMathCore: {
          switch: 'omahaMathCore',
          applied: true,
          action: trLegal.action,
          amount: trLegal.amount ?? null,
          incoming,
          error: null,
          core: trReceipt,
          // Audit P0-2: unpriced kept turn/river decisions belong to the baseline rules, not the core,
          // so omahaMathCoreOwns() returns false and downstream safety doors keep full authority.
          ...(trKeptUnpriced ? { owned: false as const } : {}),
        },
      };
      if (trLegal.amount === undefined) delete trOut.amount;
      return trOut;
    }
    const { receipt } = decideOmahaMathCore(coreState, { now });
    // The executed action is a priced candidate exactly as the legalizer leaves it: the best EV
    // whose legal form is itself (cent rounding and the all-in amount aside). A candidate the
    // legalizer would resize (a 90-100% pot wager made the full pot, a wager of nearly the whole
    // stack made all-in, the pot-limit cap) is not executed at a size the core did not price.
    const same = (a: HorseDecision, b: HorseDecision) =>
      a.action === b.action &&
      (a.action === 'all_in' || Math.abs((a.amount ?? 0) - (b.amount ?? 0)) <= 0.011);
    // the core's own ranking (selectionScore: EV; lane CORE-FIX-1), ties to fewer chips
    const ranked = [...receipt.evs].sort(
      (x, y) => selectionScore(y) - selectionScore(x) || x.adds - y.adds
    );
    let legal: HorseDecision | null = null;
    let legalizeError: string | null = null;
    for (const cand of ranked) {
      const proposed: HorseDecision = { action: cand.action, thinkTime: decision.thinkTime };
      if (cand.action !== 'fold' && cand.action !== 'check' && cand.amount !== null)
        proposed.amount = cand.amount;
      // a legalizer that throws on one candidate (e.g. an all-in above the pot-limit cap) rules out that
      // candidate only; it never discards the core (PROVE-2: hands 59979051, 60015335, 60026456, 60035341)
      let l: HorseDecision;
      try {
        l = legalize(proposed);
      } catch (e) {
        legalizeError = String((e as Error)?.message ?? e);
        continue;
      }
      if (same(l, proposed)) {
        legal = l;
        if (cand !== ranked[0])
          receipt.legalized = { from: ranked[0].amount, to: cand.amount, action: cand.action };
        receipt.choice = {
          action: cand.action,
          amount: cand.amount,
          ev: Math.round(cand.ev * 100) / 100,
        };
        break;
      }
    }
    if (!legal)
      throw new Error(
        `omahaMathCore: no priced candidate is legal as proposed${legalizeError ? ` (legalizer: ${legalizeError})` : ''}`
      );
    // prove it to change it: today's action stands unless the core's best beats it by more than the margin
    // (only against a real incumbent: a standalone recovery run has none, lane CORE-FIX-1)
    let unpricedKept = false;
    if (incumbent === 'today') {
      const best = receipt.evs.find(
        (e) =>
          e.action === legal!.action &&
          (e.action === 'all_in' || Math.abs((e.amount ?? 0) - (legal!.amount ?? 0)) <= 0.011)
      );
      const inc = incumbentOf(receipt.evs, incoming);
      const K = omahaMathCoreChangeMarginK(
        incoming.action,
        legal.action,
        String(gs.gameVariant).toLowerCase()
      );
      if (K !== null && !inc && incoming.action !== legal.action) {
        // lane CORE-POOLED-6 (owner-ordered sweep): today's action has no price among the core's candidates (a
        // bet into an opponent with almost nothing behind, where the core priced the check alone; a raise where
        // only the all-in was priced). Without its price nothing was proven against it, so it stands: "prove it
        // to change it" has no exception for an action the core could not price. It is already legal here.
        const kept: HorseDecision = { action: incoming.action, thinkTime: decision.thinkTime };
        if (incoming.amount !== null && incoming.action !== 'fold' && incoming.action !== 'check')
          kept.amount = incoming.amount;
        receipt.kept = {
          incoming: `${incoming.action}${incoming.amount !== null ? ' ' + incoming.amount : ''}`,
          best: `${legal.action}${legal.amount != null ? ' ' + legal.amount : ''}`,
          gap: 0,
          se: 0,
          k: K,
          unpriced: true,
        };
        // lane CORE-FIX-1 (AUDIT-A item 9): not the core's choice (owned: false below) and no EV the core never priced
        receipt.choice = {
          action: incoming.action as CoreReceipt['choice']['action'],
          amount: incoming.amount,
          ev: null,
        };
        unpricedKept = true;
        legal = kept;
      } else if (K !== null && best && inc && inc !== best && !sameAction(incoming, legal)) {
        const se = Math.sqrt(
          Math.pow(Math.max(0, best.se ?? 0), 2) + Math.pow(Math.max(0, inc.se ?? 0), 2)
        );
        const gap = best.ev - inc.ev;
        const rawOk = omahaMathCoreFoldBoundaryRawOk(best, inc, incoming.action, legal.action, K);
        const allInOk = omahaMathCoreRiverAllInCommitOk(
          String(gs.gameVariant).toLowerCase(),
          String(gs.stage),
          incoming.action,
          { action: legal.action, amount: legal.amount ?? null },
          gap,
          se,
          player.stack ?? 0,
          player.bet ?? 0
        );
        if (!(gap > K * se) || !rawOk || !allInOk) {
          // today's action, exactly as it reached the core (already legal on this state)
          const kept: HorseDecision = { action: incoming.action, thinkTime: decision.thinkTime };
          if (incoming.amount !== null && incoming.action !== 'fold' && incoming.action !== 'check')
            kept.amount = incoming.amount;
          receipt.kept = {
            incoming: `${incoming.action}${incoming.amount !== null ? ' ' + incoming.amount : ''}`,
            best: `${best.action}${best.amount !== null ? ' ' + best.amount : ''}`,
            gap: Math.round(gap * 100) / 100,
            se: Math.round(se * 100) / 100,
            k: K,
          };
          receipt.choice = {
            action: inc.action,
            amount: incoming.amount,
            ev: Math.round(inc.ev * 100) / 100,
          };
          legal = kept;
        }
      }
    }
    // RIVER-CORE criterion 3: on the PLO5 cash river against a live incumbent ('today', never during
    // standalone omahaMathCoreRecover where incumbent === 'none'; audit P1-5) the core may only turn
    // today's fold into a plain call.
    if (incumbent === 'today' && trVariant === 'plo5' && trStage === 'river') {
      const keep: HorseDecision = { action: incoming.action, thinkTime: decision.thinkTime };
      if (incoming.amount !== null && incoming.action !== 'fold' && incoming.action !== 'check')
        keep.amount = incoming.amount;
      const pick = omahaMathCorePlo5RiverFoldToCall(
        incoming.action,
        receipt.evs,
        player.stack ?? 0,
        OMAHA_MATH_CORE_CHANGE_MARGIN_K ?? 5
      );
      let narrowed: HorseDecision = keep;
      if (pick) {
        const proposed: HorseDecision = { action: 'call', thinkTime: decision.thinkTime };
        if (pick.amount !== null) proposed.amount = pick.amount;
        try {
          const l = legalize(proposed);
          if (l.action === 'call') narrowed = l;
        } catch {
          narrowed = keep;
        }
      }
      const chosen = receipt.evs.find((e) => e.action === narrowed.action);
      receipt.choice = {
        action: narrowed.action as CoreReceipt['choice']['action'],
        amount: narrowed.amount ?? null,
        ev: chosen ? Math.round(chosen.ev * 100) / 100 : null,
      };
      legal = narrowed;
    }
    // Current-nuts call floor, last word (lane CORE-POOLED-2 phase 2): whatever path reached a fold - the
    // change margin keeping today's fold, the PLO5 river fold -> call narrowing keeping it (an all-in call or
    // a fold that is no longer a priced candidate) - the exact current nuts facing a wager is called when a
    // call (or an all-in for no more than the call) is legal. Public information only: the hero's own cards
    // and the board, the same for every player.
    if (
      CURRENT_NUTS_CALL_FLOOR &&
      legal.action === 'fold' &&
      coreState.board.length >= 3 &&
      coreState.toCall > 0.005 &&
      holdsCurrentNuts(coreState.hole, coreState.board)
    ) {
      const stack = Math.max(0, player.stack ?? 0);
      const tries: HorseDecision[] =
        coreState.toCall < stack - 0.005
          ? [{ action: 'call', amount: coreState.toCall, thinkTime: decision.thinkTime }]
          : [];
      tries.push({ action: 'all_in', thinkTime: decision.thinkTime });
      for (const t of tries) {
        let l: HorseDecision;
        try {
          l = legalize(t);
        } catch {
          continue;
        }
        if (l.action === 'fold') continue;
        if (l.action === 'all_in' && Math.max(0, stack) > coreState.toCall + 0.005) continue;
        const chosen = receipt.evs.find((e) => e.action === l.action);
        receipt.nutFloor = `current nuts facing a wager (${String(gs.stage)}): fold replaced by ${l.action}`;
        receipt.choice = {
          action: l.action as CoreReceipt['choice']['action'],
          amount: l.amount ?? null,
          ev: chosen ? Math.round(chosen.ev * 100) / 100 : null,
        };
        legal = l;
        break;
      }
    }
    // (a street that is not admitted never reaches this point: see the admission check at the top)
    const out: HorseDecision = {
      ...decision,
      action: legal.action,
      amount: legal.amount,
      omahaMathCore: {
        switch: 'omahaMathCore',
        applied: true,
        action: legal.action,
        amount: legal.amount ?? null,
        incoming,
        error: null,
        core: receipt,
        // a kept-unpriced action that no later step replaced is the rules' decision, not the core's
        ...(unpricedKept &&
        legal.action === incoming.action &&
        legal.amount === (incoming.amount ?? undefined)
          ? { owned: false as const }
          : {}),
      },
    };
    if (legal.amount === undefined) delete out.amount;
    return out;
  } catch (err) {
    // lane CORE-FIX-1 (AUDIT-A item 14): the rules' decision executes; counted on the live ledger
    noteFire('omaha_math_core_fallback_core_error');
    return {
      ...decision,
      omahaMathCore: {
        switch: 'omahaMathCore',
        applied: false,
        action: null,
        amount: null,
        incoming,
        error: String((err as Error)?.message ?? err).slice(0, 200),
        core: null,
      },
    };
  }
}
