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
import {
  decideOmahaMathCore,
  type CoreOpponent,
  type CoreReceipt,
  type CoreState,
} from './OmahaMathCore.js';
import { sizeBand, type Band, type Line } from './MeasuredRanges.js';
import type { PreflopLevel, PreflopPosition } from './OmahaMathCoreTables.js';

export const OMAHA_MATH_CORE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
// Owner 2026-11-19 8:26 PM: PLO6 is a separate game ("DON'T TOUCH PLO6"): six-card decisions never enter the core.
const HEADS_UP_RAKE_PERCENT = 5;
const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
const WAGERS = new Set(['bet', 'raise', 'all_in']);
const ACTS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

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
}

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
export function omahaMathCoreState(player: SeatPlayer, gs: HorseGameStateV2): CoreState {
  const variant = String(gs.gameVariant).toLowerCase() as 'plo4' | 'plo5';
  const street = gs.stage as CoreState['street'];
  const history = (gs.actionHistory ?? []).filter((a) => ACTS.has(a.action));
  const persons = new Set(gs.humanUserIds ?? []);
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
    (p) => !p.is_sitting_out && !(gs.dealtSeatIds && !gs.dealtSeatIds.includes(p.seat))
  );
  const pos = positionsOf(
    seated.map((p) => p.seat),
    gs.dealerSeat
  );
  const opponents: CoreOpponent[] = seated
    .filter((p) => p.seat !== player.seat)
    .map((p) => ({
      seat: p.seat,
      user: p.user_id,
      person: persons.has(p.user_id),
      stack: Math.max(0, p.stack || 0),
      bet: Math.max(0, p.bet || 0),
      folded: !!p.is_folded,
      allIn: !!p.is_all_in,
      streetAction: lastAction.get(p.seat) ?? 'none',
      calledPrevStreet: si > 0 && calledOn[si - 1].has(p.seat),
      prevAggressor: prevAggressor === p.seat,
      position: pos.get(p.seat) ?? null,
      preflopLevel: preLevel.get(p.seat) ?? 'none',
    }));
  const live = opponents.filter((o) => !o.folded);
  const heroRank = orderRank(player.seat, gs.dealerSeat);
  const ip = live.every((o) => orderRank(o.seat, gs.dealerSeat) < heroRank);
  const dealt = gs.dealtSeatIds?.length ?? seated.length;
  const rc = gs.rakeConfig;
  const rake =
    rc && Number.isFinite(rc.percent)
      ? {
          percent: dealt <= 2 ? Math.min(rc.percent, HEADS_UP_RAKE_PERCENT) : rc.percent,
          cap: Number.isFinite(rc.cap) ? rc.cap : Infinity,
          noFlopNoDrop: rc.noFlopNoDrop !== false,
        }
      : null;
  const hole = (player.cards ?? []).map(cardToInt);
  const board = (gs.communityCards ?? []).map(cardToInt);
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
    heroWagerLine,
    preflopRaises: preRaises,
    rake,
    // deterministic per request: the cards and the public node (never the brain's stream)
    seed: `${hole.join('.')}|${board.join('.')}|${gs.pot}|${toCall}|${player.seat}|${history.length}`,
  };
}

function toDecision(receipt: CoreReceipt, base: HorseDecision): HorseDecision {
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
  opts: { omahaMathCore?: boolean },
  legalize: (d: HorseDecision) => HorseDecision,
  now: () => number = () => performance.now()
): HorseDecision {
  if (opts.omahaMathCore !== true) return decision;
  let inScope = false;
  try {
    inScope = omahaMathCoreInScope(player, gs);
  } catch {
    inScope = false;
  }
  if (!inScope) return decision;
  const incoming = { action: decision.action, amount: decision.amount ?? null };
  try {
    const { receipt } = decideOmahaMathCore(omahaMathCoreState(player, gs), { now });
    const proposed = toDecision(receipt, decision);
    const legal = legalize(proposed);
    if (legal.action !== proposed.action || (legal.amount ?? null) !== (proposed.amount ?? null)) {
      // The legalizer may restate a wager's size (the all-in amount; a 90-100% pot wager made the
      // full pot; cent rounding): the same kind of action stands, with the legal size, recorded.
      // Any other rewrite (a wager becoming a call, a call a fold) is an error and falls back.
      const wager = (a: HorseDecision['action']) => a === 'bet' || a === 'raise' || a === 'all_in';
      if (wager(proposed.action) && wager(legal.action))
        receipt.legalized = {
          from: proposed.amount ?? null,
          to: legal.amount ?? null,
          action: legal.action,
        };
      else if (!(proposed.action === 'all_in' && legal.action === 'all_in'))
        throw new Error(
          `omahaMathCore: illegal ${proposed.action} ${proposed.amount ?? ''} -> ${legal.action} ${legal.amount ?? ''}`
        );
    }
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
      },
    };
    if (legal.amount === undefined) delete out.amount;
    return out;
  } catch (err) {
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
