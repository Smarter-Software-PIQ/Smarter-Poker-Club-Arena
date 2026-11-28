/**
 * PRICED MONSTER SLOWPLAY REPLACEMENT FOR UNOWNED H4 (2026-11-22, option `horseSlowplayIsPriced`,
 * default OFF, OPTION_SWITCH_REFUSED / zero SQL migrations). r2 (2026-11-24): every input measured.
 * r3 (2026-11-28): EVERY STREET LEFT IS PRICED, with what real people do.
 *
 * Replaces the unowned blanket random coin flip at HorseLogic.ts (`H4`:
 * `!isRiver && wetness < 0.5 && !scare.any && !vulnerable && !turnSetPound &&
 * fastRandom() < params.slowplayFreq && oppCount <= 2`) in non-Omaha / non-FLH games
 * when `opts.horseSlowplayIsPriced === true`.
 *
 * Pure, deterministic (zero `fastRandom()` draw), public-info-only (zero opponent hole
 * cards, zero `opponentHud/` import: uses `holdemEmpiricalPriors.ts` structural
 * `HoldemHudPacketOpponent` / `ExploitCounters` shrinkage).
 *
 * WHY r3. r2 priced ONE street: bet now (a fold, or one call) against check now (one stab, or
 * nothing). A check's worth is mostly on the streets that follow (the bets it draws later and the
 * value bet the Horse can still make), and so is a bet's (a called bet builds the pot that the
 * later bets are sized from). Graded 2026-11-28, the one-street version netted +0.08 +/- 0.49
 * bb/100 and gained only against an opponent who never folds.
 *
 * THE MODEL (a small explicit tree, walked from this street to the river):
 *   State: street, pot `P`, the chips the Horse has put in since the decision `I`, effective stack
 *   `S`, equity `e` against the opponents' current range, and who bet last on the street before
 *   (`hero` | `opp` | `none`: the three cases the people's rates are measured in).
 *   At each street, in order:
 *     1. LEAD. Opponents who act BEFORE the Horse bet with probability `L` (not on the decision
 *        street: there they have already checked). The Horse calls (or folds if calling is worse).
 *     2. Otherwise the Horse takes the better of BET and CHECK (on the decision street the two are
 *        the verdict's `evBet` and `evCheck`).
 *        BET `b = min(S, frac * P)` (`frac` = the engine's candidate bet as a pot fraction):
 *          everyone folds, `F = prod_i F_i`          -> the Horse wins `P - I`;
 *          a raise, `(1 - F) * rho`                  -> to `min(S, m * b)`; the Horse calls;
 *          a call, `(1 - F) * (1 - rho)`             -> next street, pot `P + 2b`.
 *        CHECK: opponents who act AFTER the Horse bet with probability `A`; the Horse calls (or
 *          folds if worse); otherwise the street is checked through -> next street, same pot.
 *   After the river (or all-in) the hand is shown down: `e * (P - I) - (1 - e) * bf * I`
 *   (`bf` = the tournament bubble factor, 1 in cash; at `I = 0` this is `e * P`).
 *
 *   Equity moves with what the opponents do, and is conserved over each of their choices:
 *     - a called bet meets the stronger part of the range: `e_c = e ^ (1 + kappa * meanG)` (the
 *       measured NLH continuation sharpness `NLH_REFERENCE_CONTINUATION_SHARPNESS`, flop 0.3151,
 *       turn 0.4068, river 0.9415; `meanG` = mean over opponents of `F_i / (1 - F_i)`);
 *     - an opponent's bet comes from the part of its range that bets, priced as its strongest
 *       part: `e_b = e ^ (1 + kappa * (1 - q) / q)` for a bet made with probability `q`; the range
 *       that did NOT bet is weaker by exactly as much: `e_n = (e - q * e_b) / (1 - q)`.
 *
 * MEASURED INPUTS (people only; see `SLOWPLAY_PRICED_PROVENANCE`):
 *   - `L`, `A`: `SLOWPLAY_PEOPLE_UNBET_POT_BET`, the rate at which a person bets into an unbet pot,
 *     by street, by who bet last on the street before, and by whether the person is first to act
 *     (lead) or was checked to. Each opponent's own `betCheckedTo` record moves the measured rate
 *     by its log-odds distance from the pool (`estimateHoldemBetWhenCheckedTo`) on the decision
 *     street; on the later streets that record may lower the people's rate but never raise it.
 *   - the size of that bet: `SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES`, 20 quantile midpoints of the pot
 *     fraction per street; the priced size is `P * mean_j min(S / P, q_j)` (the stack caps every
 *     bet before the mean is taken, which the r2 mean-then-cap did not do).
 *   - `rho`, `m`: `SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES`, `SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE`.
 *   - `F_i`: `estimateHoldemFlopCbetFold` / `estimateHoldemTurnBetFold` /
 *     `estimateHoldemRiverFoldToBet` (measured NLH priors, each opponent's record shrunk onto them).
 *
 * WHERE NOTHING IS MEASURED the model leans to the bet (today's usual action), never to the check:
 *   - the Horse only ever CALLS an opponent's bet (it never raises it): undervalues the check;
 *   - a raise of the Horse's bet is called at the called-range equity `e_c` (not at a stronger
 *     raising range): overvalues the bet;
 *   - an opponent's bet is priced as the strongest part of its range (no bluffs in it):
 *     undervalues the check;
 *   - with two opponents and the last bet theirs, the pricer does not know which of them made it:
 *     both are priced at the lower `none` rate;
 *   - a board with `wetness >= 0.5` is never checked (the blanket rule's own gate): what a free
 *     card costs on a wet board is not priced, so the answer there is the bet.
 *   - Checks (slowplays) ONLY when `EV(check) > EV(bet)`.
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import { NLH_REFERENCE_CONTINUATION_SHARPNESS } from './HorseShortDeckMultiwayPriced.js';
import {
  conditionEquityAgainstRaiseCallRange,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemFlopCbetFold,
  estimateHoldemRiverFoldToBet,
  estimateHoldemTurnBetFold,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

/** Provenance of the measured inputs pinned below. */
export const SLOWPLAY_PRICED_PROVENANCE = Object.freeze({
  criteria:
    'CRITERIA-SLOWPLAY2-01Gw7aDq.md (declared before the r3 grade; sha256 in docs/horse-option-authority.d/horseSlowplayIsPriced.UNREGISTERED.md). r2: CRITERIA-H4-SLOWPLAY-PRICED-R2.md sha256 3178e72583229b197c3add048da6fbc7c8302cf12b8e3e7a9f224c4fe9fafe71',
  sample:
    "production hand_history (read-only SELECT), game_variant = 'nlh', has_human, no bomb pot, single board, 2026-10-19T00:00Z..2026-11-28T06:00Z; only actions taken by people (profiles.is_horse false) that carry a publicNode; Horse actions excluded",
  unbetPotBet:
    'a person to act on the flop, turn or river with nothing to call and every earlier action on the street a check; hit = bet (or all-in); split by who made the last bet or raise on the street before (self, other, none) and by lead (first to act) or checked to; smallest cell n 196 (51 people)',
  betSize:
    'the same bets, amount / publicNode.pot: flop n 2035 (78 people) mean 0.7111 median 0.5000; turn n 1425 (73 people) mean 0.6822 median 0.5099; river n 1000 (76 people) mean 0.7455 median 0.5238; pinned as 20 quantile midpoints (2.5%..97.5%) per street',
  raise:
    'a person first to answer the first bet of a street: raise share of the answers that continue, flop 324 / 1806, turn 163 / 1041, river 79 / 470; median raise-to as a multiple of the bet, flop 3.479 (n 324, 59 people), turn 2.835 (n 163, 45 people), river 3.000 (n 79, 32 people)',
  queries:
    'hd-01TLQer9/grade-runs/slowplay2/measure/ (_base.sql, unbet-pot-bet.sql, bet-size.sql, bet-response.sql, their outputs and SHA256SUMS)',
  continuationSharpness:
    'NLH_REFERENCE_CONTINUATION_SHARPNESS (HorseShortDeckMultiwayPriced.ts): flop 0.3151 +/- 0.0074, turn 0.4068 +/- 0.0129, river 0.9415',
});

export type HorseSlowplayStreet = 'flop' | 'turn';
/** Every street the tree walks. */
export type HorseSlowplayTreeStreet = 'flop' | 'turn' | 'river';
/** Who made the last bet or raise on the street before, seen from the Horse. */
export type HorseSlowplayInitiative = 'hero' | 'opp' | 'none';

type PeopleBetContext = 'self' | 'other' | 'none';
interface PeopleRate {
  readonly n: number;
  readonly hits: number;
  readonly rate: number;
}
const rate = (hits: number, n: number): PeopleRate => Object.freeze({ n, hits, rate: hits / n });

/**
 * How often a PERSON bets into an unbet pot (people only; see `SLOWPLAY_PRICED_PROVENANCE`).
 * Keyed by street, then by who made the last bet or raise on the street before, seen from the
 * person about to act (`self` = that person, `other` = someone else, `none` = nobody: on the turn
 * and river the street before was checked through, on the flop nobody raised before the flop),
 * then by `lead` (first to act) or `checkedTo` (every earlier action on the street was a check).
 */
export const SLOWPLAY_PEOPLE_UNBET_POT_BET: Readonly<
  Record<
    HorseSlowplayTreeStreet,
    Readonly<
      Record<PeopleBetContext, { readonly lead: PeopleRate; readonly checkedTo: PeopleRate }>
    >
  >
> = Object.freeze({
  flop: Object.freeze({
    none: Object.freeze({ lead: rate(79, 336), checkedTo: rate(177, 527) }),
    other: Object.freeze({ lead: rate(278, 3117), checkedTo: rate(331, 1461) }),
    self: Object.freeze({ lead: rate(214, 323), checkedTo: rate(956, 1385) }),
  }),
  turn: Object.freeze({
    none: Object.freeze({ lead: rate(328, 1110), checkedTo: rate(252, 890) }),
    other: Object.freeze({ lead: rate(66, 925), checkedTo: rate(102, 338) }),
    self: Object.freeze({ lead: rate(279, 402), checkedTo: rate(398, 702) }),
  }),
  river: Object.freeze({
    none: Object.freeze({ lead: rate(259, 842), checkedTo: rate(207, 891) }),
    other: Object.freeze({ lead: rate(51, 397), checkedTo: rate(66, 196) }),
    self: Object.freeze({ lead: rate(234, 363), checkedTo: rate(183, 331) }),
  }),
});

/**
 * The size of a person's first bet into an unbet pot, as a fraction of the pot: 20 quantile
 * midpoints (2.5%, 7.5%, ..., 97.5%) per street. The priced bet is the mean of these, each capped
 * by the stack first.
 */
export const SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES: Readonly<
  Record<HorseSlowplayTreeStreet, readonly number[]>
> = Object.freeze({
  flop: Object.freeze([
    0.1538, 0.2419, 0.3077, 0.3333, 0.3529, 0.3636, 0.3732, 0.3934, 0.4433, 0.5, 0.5, 0.5195,
    0.5333, 0.5455, 0.6, 0.75, 0.8, 1.0, 1.0, 2.7616,
  ]),
  turn: Object.freeze([
    0.1117, 0.2016, 0.265, 0.3333, 0.3393, 0.3556, 0.3772, 0.4444, 0.5, 0.5047, 0.5155, 0.5263,
    0.5556, 0.686, 0.7591, 0.7826, 0.8963, 1.0, 1.0113, 2.0158,
  ]),
  river: Object.freeze([
    0.074, 0.1538, 0.2399, 0.3255, 0.3392, 0.3682, 0.4136, 0.5, 0.5072, 0.5185, 0.5343, 0.6114,
    0.7518, 0.7628, 0.7852, 0.9898, 1.0, 1.0027, 1.0584, 2.8348,
  ]),
});

/** Of a person's answers to a first bet that do not fold, the share that raise. */
export const SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES: Readonly<
  Record<HorseSlowplayTreeStreet, PeopleRate>
> = Object.freeze({
  flop: rate(324, 1806),
  turn: rate(163, 1041),
  river: rate(79, 470),
});

/** A person's raise of a first bet, as a multiple of that bet (raise-to / bet; median). */
export const SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE: Readonly<Record<HorseSlowplayTreeStreet, number>> =
  Object.freeze({ flop: 3.479, turn: 2.835, river: 3.0 });

/** The wetness at and above which a board is never checked (the blanket H4 rule's own gate). */
export const SLOWPLAY_WET_BOARD_GATE = 0.5;

/** The most tree nodes one verdict can visit (flop: 1 + 4 + 20 street nodes, then 100 showdowns). */
export const SLOWPLAY_MAX_TREE_NODES = 125;

export type HorseSlowplayReason =
  | 'ev_check_exceeds_ev_bet'
  | 'ev_bet_exceeds_or_equals_ev_check'
  | 'wet_board_not_priced'
  | 'degenerate_pot_or_stack';

export interface SlowplayOpponentInput {
  /** False when the opponent is already all-in / has zero chips behind and cannot fold or stab. */
  readonly canRespond?: boolean;
  /**
   * True when this opponent acts after the Horse on a street (live, not all-in), so it can bet
   * into a check; false when it acts before the Horse (on the decision street it has already
   * checked; on a later street it can lead). Absent: treated as true.
   */
  readonly canStab?: boolean;
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  readonly exploitCounters?:
    | (Pick<ExploitCounters, 'foldToBet' | 'foldToBetOpp' | 'betCheckedTo' | 'betCheckedToOpp'> &
        Partial<Pick<ExploitCounters, 'riverCall' | 'riverCallOpp'>>)
    | null;
}

export interface PriceMonsterSlowplayInput {
  /** Hero's estimated monster equity against live opponent(s) in [0, 1]. */
  readonly equity: number;
  /** Current pot size in chips. */
  readonly pot: number;
  /** Engine's chosen monster value bet size in chips before effective-stack cap. */
  readonly candidateBet: number;
  /** Effective remaining stack behind in chips (min of hero stack and deepest live opponent). */
  readonly effectiveStack: number;
  /** Number of live opponents in the pot (1 or 2). */
  readonly oppCount: number;
  /** Board wetness in [0, 1]. At or above `SLOWPLAY_WET_BOARD_GATE` the verdict is the bet. */
  readonly wetness?: number;
  /** Current street ('flop' or 'turn'). */
  readonly street: HorseSlowplayStreet;
  /** Whether hero acts in position (last on this street). */
  readonly inPosition: boolean;
  /** Effective stack-to-pot ratio (optional; conditions small IP flop c-bet fold prior). */
  readonly spr?: number;
  /** Public flop board texture ('unpaired_nonmono' | 'paired' | 'mono'). */
  readonly flopTexture?: HoldemFlopTexture;
  /** Hero tournament/Spin bubble factor (>= 1). Null/undefined/<=1 resolves to chip EV (1). */
  readonly heroBubbleFactor?: number | null;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly SlowplayOpponentInput[];
  /**
   * Who made the last bet or raise on the street before this one (before the flop, on the flop).
   * Absent: 'none'.
   */
  readonly initiative?: HorseSlowplayInitiative;
  /**
   * How many streets to price, this one included. Absent: every street left (3 on the flop, 2 on
   * the turn). 1 is the one-street comparison, kept for the law's closed-form check.
   */
  readonly maxStreets?: number;
}

export interface PriceMonsterSlowplayResult {
  readonly action: 'check' | 'bet';
  /** Value of checking now, every priced street included. */
  readonly evCheck: number;
  /** Value of betting now, every priced street included. */
  readonly evBet: number;
  /** Probability every opponent folds to the bet on this street. */
  readonly foldProb: number;
  /** Probability an opponent who acts after the Horse bets into its check on this street. */
  readonly stabProb: number;
  /** The Horse's equity as given (before any opponent action moves it). */
  readonly checkEquity: number;
  /** Equity against the continuing range in the called branch of a bet on this street. */
  readonly calledEquity: number;
  readonly effectiveBet: number;
  /** The priced size of an opponent's bet into the check on this street. */
  readonly stabSize: number;
  readonly bubbleFactor: number;
  /** Streets priced, this one included. */
  readonly streetsPriced: number;
  /** Tree nodes visited (never more than `SLOWPLAY_MAX_TREE_NODES`). */
  readonly nodes: number;
  readonly reason: HorseSlowplayReason;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Classify public flop texture from the board cards (first three cards).
 * Pure public-board helper: never inspects hole cards.
 */
export function classifyHoldemFlopTexture(
  board: readonly { readonly rank: string; readonly suit: string }[],
  pairedBoardHint?: boolean
): HoldemFlopTexture {
  if (board.length >= 3) {
    const c0 = board[0]!;
    const c1 = board[1]!;
    const c2 = board[2]!;
    if (c0.suit === c1.suit && c1.suit === c2.suit) return 'mono';
    if (c0.rank === c1.rank || c1.rank === c2.rank || c0.rank === c2.rank) return 'paired';
    return 'unpaired_nonmono';
  }
  return pairedBoardHint === true ? 'paired' : 'unpaired_nonmono';
}

/**
 * Hero's equity against the continuing opponents after a bet: `e ^ (1 + kappa * meanG)`, `meanG`
 * the mean over opponents of `F_i / (1 - F_i)`, `kappa` the measured NLH continuation sharpness of
 * `street`. Non-increasing in `meanG`; equals `e` at `meanG = 0`. Evaluated with the shared kernel
 * at the fold probability whose odds are `meanG` (`f = meanG / (1 + meanG)`).
 */
export function slowplayCalledEquity(
  equity: number,
  meanG: number,
  street: HorseSlowplayTreeStreet
): number {
  const g = Number.isFinite(meanG) && meanG > 0 ? meanG : 0;
  return conditionEquityAgainstRaiseCallRange(equity, g / (1 + g), {
    sharpness: NLH_REFERENCE_CONTINUATION_SHARPNESS[street],
  });
}

/**
 * Hero's equity against the range an opponent BETS with, when it bets with probability `betProb`:
 * the strongest `betProb` of its range (`e ^ (1 + kappa * (1 - q) / q)`), and against the range
 * that did not bet, which is weaker by exactly as much (`(e - q * e_b) / (1 - q)`), so that
 * `q * vsBet + (1 - q) * vsNoBet = e`.
 */
export function slowplayEquityAroundOpponentBet(
  equity: number,
  betProb: number,
  street: HorseSlowplayTreeStreet
): { readonly vsBet: number; readonly vsNoBet: number } {
  const e = clamp01(equity);
  const q = clamp01(betProb);
  if (q <= 0) return { vsBet: e, vsNoBet: e };
  if (q >= 1) return { vsBet: e, vsNoBet: e };
  const vsBet = conditionEquityAgainstRaiseCallRange(e, 1 - q, {
    sharpness: NLH_REFERENCE_CONTINUATION_SHARPNESS[street],
  });
  return { vsBet, vsNoBet: clamp01((e - q * vsBet) / (1 - q)) };
}

/**
 * The priced size of a person's bet into an unbet pot: `pot * mean_j min(stack / pot, q_j)` over
 * the measured quantile midpoints of `street`. Never more than the stack.
 */
export function slowplayPeopleBetSize(
  street: HorseSlowplayTreeStreet,
  pot: number,
  stack: number
): number {
  if (!(pot > 0) || !(stack > 0)) return 0;
  const cap = stack / pot;
  const qs = SLOWPLAY_PEOPLE_BET_SIZE_QUANTILES[street];
  let sum = 0;
  for (let j = 0; j < qs.length; j++) sum += qs[j]! < cap ? qs[j]! : cap;
  return Math.min(stack, (pot * sum) / qs.length);
}

/**
 * Risk-adjusted expected utility of contesting a wager `wager` into `pot` with equity `equity`
 * under tournament bubble factor `bubbleFactor >= 1`:
 *   win branch (prob `equity`):      +(pot + wager)
 *   lose branch (prob `1 - equity`): -bubbleFactor * wager
 * At `bubbleFactor = 1`, reduces identically to `equity * (pot + 2 * wager) - wager`.
 */
export function riskAdjustedCallUtility(
  equity: number,
  pot: number,
  wager: number,
  bubbleFactor: number
): number {
  const e = clamp01(equity);
  const p = Number.isFinite(pot) && pot > 0 ? pot : 0;
  const w = Number.isFinite(wager) && wager > 0 ? wager : 0;
  const bf = Number.isFinite(bubbleFactor) && bubbleFactor > 1 ? bubbleFactor : 1;
  return e * (p + w) - (1 - e) * bf * w;
}

const NEXT_STREET: Readonly<Record<HorseSlowplayTreeStreet, HorseSlowplayTreeStreet | null>> =
  Object.freeze({ flop: 'turn', turn: 'river', river: null });
const LOGIT_EPS = 1e-6;
const logit = (p: number): number => {
  const c = p < LOGIT_EPS ? LOGIT_EPS : p > 1 - LOGIT_EPS ? 1 - LOGIT_EPS : p;
  return Math.log(c / (1 - c));
};

interface TreeOpponent {
  readonly canRespond: boolean;
  /** Acts after the Horse on every postflop street. */
  readonly after: boolean;
  readonly hudOpp: HoldemHudPacketOpponent | null | undefined;
  readonly counters: SlowplayOpponentInput['exploitCounters'];
  /** Log-odds distance of this opponent's bet-when-checked-to estimate from the pool, by street. */
  readonly shift: Readonly<Record<HorseSlowplayTreeStreet, number>>;
}

interface TreeContext {
  readonly opps: readonly TreeOpponent[];
  readonly frac: number;
  readonly bf: number;
  readonly inPosition: boolean;
  readonly headsUp: boolean;
  readonly flopTexture: HoldemFlopTexture | undefined;
  readonly flopSpr: number | undefined;
  nodes: number;
}

/** Field response to a Horse bet of `potFraction` on `street`: all-fold probability and mean odds. */
function fieldFold(
  ctx: TreeContext,
  street: HorseSlowplayTreeStreet,
  potFraction: number
): { readonly allFold: number; readonly meanG: number } {
  let allFold = 1;
  let sumG = 0;
  let nG = 0;
  for (const opp of ctx.opps) {
    if (!opp.canRespond) {
      // An all-in / zero-stack opponent cannot fold; its whole range continues (g = 0).
      allFold = 0;
      nG++;
      continue;
    }
    const est =
      street === 'flop'
        ? estimateHoldemFlopCbetFold(
            {
              bettorInPosition: ctx.inPosition,
              potFraction,
              texture: ctx.flopTexture,
              spr: ctx.flopSpr,
              headsUp: ctx.headsUp,
            },
            opp.hudOpp,
            opp.counters
          )
        : street === 'turn'
          ? estimateHoldemTurnBetFold(
              { bettorInPosition: ctx.inPosition, potFraction, headsUp: ctx.headsUp },
              opp.hudOpp,
              opp.counters
            )
          : estimateHoldemRiverFoldToBet(
              { potFraction, headsUp: ctx.headsUp },
              opp.hudOpp,
              opp.counters &&
                typeof opp.counters.riverCallOpp === 'number' &&
                typeof opp.counters.riverCall === 'number'
                ? { riverCall: opp.counters.riverCall, riverCallOpp: opp.counters.riverCallOpp }
                : null
            );
    const fi = clamp01(est.mean);
    allFold *= fi;
    if (fi < 1) {
      sumG += fi / (1 - fi);
      nG++;
    }
  }
  return { allFold: clamp01(allFold), meanG: nG > 0 ? sumG / nG : 0 };
}

/**
 * Probability that an opponent bets into the unbet pot on `street`: those who act after the Horse
 * (`after = true`, they were checked to) or those who act before it (`after = false`, a lead).
 * `decisionStreet`: the street the verdict is for (the tree's first), not a later one.
 */
function fieldBet(
  ctx: TreeContext,
  street: HorseSlowplayTreeStreet,
  initiative: HorseSlowplayInitiative,
  after: boolean,
  decisionStreet: boolean
): number {
  // Seen from the opponent: the Horse's last bet is someone else's; the opponents' last bet is its
  // own only heads-up (with two opponents the pricer does not know whose it was: the lower rate).
  const key: PeopleBetContext =
    initiative === 'hero' ? 'other' : initiative === 'opp' && ctx.headsUp ? 'self' : 'none';
  const cell = SLOWPLAY_PEOPLE_UNBET_POT_BET[street][key];
  const base = logit(after ? cell.checkedTo.rate : cell.lead.rate);
  let none = 1;
  for (const opp of ctx.opps) {
    if (!opp.canRespond || opp.after !== after) continue;
    // The opponent's own record is a record of betting when checked to, which is exactly the
    // decision street's question. Whether it carries to the later streets is not measured: there
    // it may lower the people's rate, never raise it.
    const shift = decisionStreet ? opp.shift[street] : Math.min(0, opp.shift[street]);
    none *= 1 - 1 / (1 + Math.exp(-(base + shift)));
  }
  return clamp01(1 - none);
}

/** Showdown utility: win `pot - invested` with `equity`, lose `invested` scaled by the bubble factor. */
function showdown(ctx: TreeContext, pot: number, invested: number, equity: number): number {
  ctx.nodes++;
  return equity * (pot - invested) - (1 - equity) * ctx.bf * invested;
}

interface HeroChoice {
  readonly bet: number;
  readonly check: number;
  readonly foldProb: number;
  readonly calledEquity: number;
  readonly effectiveBet: number;
  readonly stabProb: number;
  readonly stabSize: number;
}

/** The Horse to act with nothing to call: the value of betting and the value of checking. */
function heroChoice(
  ctx: TreeContext,
  street: HorseSlowplayTreeStreet,
  pot: number,
  invested: number,
  stack: number,
  equity: number,
  initiative: HorseSlowplayInitiative,
  streetsLeft: number,
  decisionStreet: boolean
): HeroChoice {
  const next = streetsLeft > 1 ? NEXT_STREET[street] : null;
  const left = streetsLeft - 1;
  const fold = -ctx.bf * invested;

  // BET
  const b = Math.min(stack, ctx.frac * pot);
  const { allFold, meanG } = fieldFold(ctx, street, b / pot);
  const ec = slowplayCalledEquity(equity, meanG, street);
  const raiseTo = Math.min(stack, SLOWPLAY_PEOPLE_RAISE_TO_MULTIPLE[street] * b);
  const rho = raiseTo > b ? SLOWPLAY_PEOPLE_RAISE_SHARE_OF_CONTINUES[street].rate : 0;
  const called = walk(ctx, next, pot + 2 * b, invested + b, stack - b, ec, 'hero', left);
  const raised =
    rho > 0
      ? Math.max(
          walk(ctx, next, pot + 2 * raiseTo, invested + raiseTo, stack - raiseTo, ec, 'opp', left),
          -ctx.bf * (invested + b)
        )
      : 0;
  const bet = allFold * (pot - invested) + (1 - allFold) * ((1 - rho) * called + rho * raised);

  // CHECK
  const stabProb = fieldBet(ctx, street, initiative, true, decisionStreet);
  const stabSize = slowplayPeopleBetSize(street, pot, stack);
  const around = slowplayEquityAroundOpponentBet(equity, stabProb, street);
  const through = walk(ctx, next, pot, invested, stack, around.vsNoBet, 'none', left);
  const stabbed =
    stabProb > 0
      ? Math.max(
          walk(
            ctx,
            next,
            pot + 2 * stabSize,
            invested + stabSize,
            stack - stabSize,
            around.vsBet,
            'opp',
            left
          ),
          fold
        )
      : 0;
  const check = stabProb * stabbed + (1 - stabProb) * through;

  return { bet, check, foldProb: allFold, calledEquity: ec, effectiveBet: b, stabProb, stabSize };
}

/** The value of the hand from the start of `street` (null: the betting is over, show down). */
function walk(
  ctx: TreeContext,
  street: HorseSlowplayTreeStreet | null,
  pot: number,
  invested: number,
  stack: number,
  equity: number,
  initiative: HorseSlowplayInitiative,
  streetsLeft: number
): number {
  if (street === null || streetsLeft <= 0 || !(stack > 0)) {
    return showdown(ctx, pot, invested, equity);
  }
  ctx.nodes++;
  const leadProb = fieldBet(ctx, street, initiative, false, false);
  const around = slowplayEquityAroundOpponentBet(equity, leadProb, street);
  const choice = heroChoice(
    ctx,
    street,
    pot,
    invested,
    stack,
    around.vsNoBet,
    initiative,
    streetsLeft,
    false
  );
  const own = choice.bet > choice.check ? choice.bet : choice.check;
  if (!(leadProb > 0)) return own;
  const s = slowplayPeopleBetSize(street, pot, stack);
  const next = streetsLeft > 1 ? NEXT_STREET[street] : null;
  const led = Math.max(
    walk(ctx, next, pot + 2 * s, invested + s, stack - s, around.vsBet, 'opp', streetsLeft - 1),
    -ctx.bf * invested
  );
  return leadProb * led + (1 - leadProb) * own;
}

/**
 * Deterministic EV comparison between slowplaying (checking) and value-betting a monster on the
 * flop or turn, over every street left. Zero RNG, public-info-only.
 */
export function priceMonsterSlowplay(input: PriceMonsterSlowplayInput): PriceMonsterSlowplayResult {
  const e = clamp01(input.equity);
  const bf =
    typeof input.heroBubbleFactor === 'number' &&
    Number.isFinite(input.heroBubbleFactor) &&
    input.heroBubbleFactor > 1
      ? input.heroBubbleFactor
      : 1;
  const oppCount = Math.max(
    1,
    Math.min(2, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1))
  );

  const pot = Number.isFinite(input.pot) ? input.pot : 0;
  const effectiveStack = Number.isFinite(input.effectiveStack) ? input.effectiveStack : 0;
  const rawBet = Number.isFinite(input.candidateBet) ? input.candidateBet : 0;
  const effectiveBet = Math.min(Math.max(0, effectiveStack), Math.max(0, rawBet));
  const streetsToRiver = input.street === 'flop' ? 3 : 2;
  const streetsPriced =
    typeof input.maxStreets === 'number' && Number.isFinite(input.maxStreets)
      ? Math.max(1, Math.min(streetsToRiver, Math.floor(input.maxStreets)))
      : streetsToRiver;

  if (!(pot > 0) || !(effectiveStack > 0) || !(effectiveBet > 0)) {
    return {
      action: 'bet',
      evCheck: 0,
      evBet: 0,
      foldProb: 0,
      stabProb: 0,
      checkEquity: e,
      calledEquity: e,
      effectiveBet: 0,
      stabSize: 0,
      bubbleFactor: bf,
      streetsPriced,
      nodes: 0,
      reason: 'degenerate_pot_or_stack',
    };
  }

  const opps: TreeOpponent[] = [];
  for (let i = 0; i < oppCount; i++) {
    const opp = input.opponents?.[i];
    const shiftOf = (street: HorseSlowplayTreeStreet): number => {
      const est = estimateHoldemBetWhenCheckedTo(street, opp?.hudOpp, opp?.exploitCounters);
      return est.weight > 0 ? logit(est.mean) - logit(est.prior) : 0;
    };
    opps.push({
      canRespond: opp?.canRespond !== false,
      after: opp?.canStab !== false,
      hudOpp: opp?.hudOpp,
      counters: opp?.exploitCounters,
      shift: { flop: shiftOf('flop'), turn: shiftOf('turn'), river: shiftOf('river') },
    });
  }
  const ctx: TreeContext = {
    opps,
    frac: rawBet / pot,
    bf,
    inPosition: input.inPosition,
    headsUp: oppCount === 1,
    flopTexture: input.flopTexture,
    flopSpr: input.spr,
    nodes: 1,
  };

  const root = heroChoice(
    ctx,
    input.street,
    pot,
    0,
    effectiveStack,
    e,
    input.initiative ?? 'none',
    streetsPriced,
    true
  );

  const wet =
    typeof input.wetness === 'number' &&
    Number.isFinite(input.wetness) &&
    input.wetness >= SLOWPLAY_WET_BOARD_GATE;
  const action: 'check' | 'bet' = !wet && root.check > root.bet ? 'check' : 'bet';
  return {
    action,
    evCheck: root.check,
    evBet: root.bet,
    foldProb: root.foldProb,
    stabProb: root.stabProb,
    checkEquity: e,
    calledEquity: root.calledEquity,
    effectiveBet: root.effectiveBet,
    stabSize: root.stabSize,
    bubbleFactor: bf,
    streetsPriced,
    nodes: ctx.nodes,
    reason:
      action === 'check'
        ? 'ev_check_exceeds_ev_bet'
        : wet && root.check > root.bet
          ? 'wet_board_not_priced'
          : 'ev_bet_exceeds_or_equals_ev_check',
  };
}
