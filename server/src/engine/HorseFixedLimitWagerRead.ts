/**
 * FIXED LIMIT: THE WAGER SIGNAL IS STRUCTURAL (Fixed-Limit lane, 2026-11-14;
 * SPEC-FL-01, SPEC-FL-02, SPEC-FL-03).
 *
 * Why: every opponent-strength read in the brain is keyed on the SIZE of a
 * bet. HorseMind weighs a bet by its distance from a texture-expected pot
 * fraction and marks a "big bet" at 20 big blinds; the samplers in HorseEval
 * step up at a bet of 0.7 pot (`omahaAggressorTier`) or at that big-bet mark
 * (the hold'em contact sampler); HorseLogic's one-pair river shade starts at a
 * fifth of the pot. A fixed-limit bet is 0.1 to 0.33 of the pot and never 20
 * big blinds, so each of those reads sits at its weakest setting and a
 * fixed-limit river bettor is modelled like a no-limit player who made a
 * small bet: on K-9-4-7-2 heads-up the sampled range of a river bettor is
 * about 37 percent hands with no pair, and bottom pair is priced at 0.35
 * against a price of 0.20 (measured on main 2f8fa5ab, 20 seeds, mind on).
 *
 * In fixed limit the size carries no information: a bet is the largest bet
 * the structure allows. What carries information is the FACT of the wager
 * and the COUNT of wagers on the street (a bet, then a raise). This module
 * holds that mapping and the two fixed-limit rules that follow from the same
 * arithmetic. Everything here is pure; HorseLogic owns the gates and the
 * options, all of them opt-in (read as `=== true`, default off):
 *
 *   fixedLimitRiverFullBetRead      (SPEC-FL-01) the read mapping below
 *   fixedLimitHiLoNutLowRiverBet    (SPEC-FL-02) hiLoNutLowRiverBets
 *   fixedLimitRiverOneBetValueRaise (SPEC-FL-03) fixedLimitOneBetValueRaise
 *
 * Default OFF: fixtures and a mechanism only. Turning any of them on needs
 * the league evaluation of the lane's frozen protocol and a
 * docs/horse-default-on.d evidence file.
 */
import type { ActionRecord, Card } from '../types.js';
import type { ExploitStat, OpponentExploitRead } from './HorseOpponentExploit.js';

/**
 * Opponent-exploit statistics that actually describe betting or re-raising
 * pressure on the hand, as opposed to preflop entry width (`vpip`), folding
 * (`foldToBet`), or passive river bluff-catching (`riverCall`).
 */
export const FIXED_LIMIT_PRESSURE_STATS: readonly ExploitStat[] = Object.freeze([
  'betCheckedTo',
  'threeBet',
  'foldTo3Bet',
]);

/**
 * True when an observed (non-presumed) opponent profile carries credible
 * engagement or cross-size corroboration on a pressure-relevant statistic and
 * is not an over-folder (`foldToBet` engaged high). A profile corroborated
 * only on `vpip` (voluntary preflop entry) returns `false`.
 */
export function fixedLimitProfileShowsPressure(
  profile: OpponentExploitRead | null | undefined
): boolean {
  if (!profile || profile.presumed === true) return false;
  if (profile.stats?.foldToBet?.engaged === 'high') return false;
  return FIXED_LIMIT_PRESSURE_STATS.some(
    (stat) =>
      profile.stats?.[stat]?.engaged != null || profile.corroborated?.includes(stat) === true
  );
}

/** What one player did with chips on one street, structurally. */
export type StreetWagerKind = 'bet' | 'raise';

export interface StreetWagerSignal {
  /** Wagers on the street: 0 unbet, 1 a bet, 2 a bet and a raise, and so on. */
  wagers: number;
  /** The strongest wager each player made on the street (a raise outranks a bet). */
  byUser: ReadonlyMap<string, StreetWagerKind>;
}

/**
 * Count the wagers of one postflop street from the public action history.
 * A bet is the first wager; every raise is one more. An all-in counts only
 * when it lifts the price (an all-in call is not a wager). Calls, checks and
 * folds are not wagers. Preflop is not supported (the blinds are the first
 * wager there): pass a postflop street.
 */
export function streetWagerSignal(
  history: readonly ActionRecord[] | undefined,
  stage: 'flop' | 'turn' | 'river'
): StreetWagerSignal {
  const byUser = new Map<string, StreetWagerKind>();
  let wagers = 0;
  let price = 0;
  for (const a of history ?? []) {
    if (a.stage !== stage) continue;
    const amount = Number.isFinite(a.amount) ? a.amount : 0;
    const lifts =
      a.action === 'bet' ||
      a.action === 'raise' ||
      ((a.action as string) === 'all_in' && amount > price + 1e-8);
    if (!lifts) continue;
    wagers++;
    price = Math.max(price, amount);
    const kind: StreetWagerKind = wagers >= 2 ? 'raise' : 'bet';
    if (kind === 'raise' || !byUser.has(a.userId)) byUser.set(a.userId, kind);
  }
  return { wagers, byUser };
}

/** The read fields this module sets; a structural subset of OppPostflopRead. */
export interface FullBetReadFields {
  fullBet?: boolean;
  raised?: boolean;
  highOnlyBoard?: boolean;
  strictPressureRange?: boolean;
}

/**
 * Mark a river wagerer's read as a full fixed-limit bet (SPEC-FL-01). A raise
 * also sets the existing `raised` mark. `highOnlyBoard` says the pot cannot
 * split (a high-only game, or hi-lo on a board where no low is possible),
 * which is what lets the Omaha sampler draw the declared made-hand stratum
 * directly instead of by bounded rejection. When `highOnlyBoard` is false, an
 * opponent telemetry `profile` never flips `strictPressureRange` on from
 * `vpip` alone or from an uncorroborated `presumed` prior; only
 * `fixedLimitProfileShowsPressure(profile)` (genuine pressure stats) sets
 * `strictPressureRange: true`. Returns a new object; the input is not changed.
 */
export function fixedLimitFullBetRead<T extends FullBetReadFields>(
  read: T,
  kind: StreetWagerKind,
  highOnlyBoard: boolean,
  profile?: OpponentExploitRead | null
): T {
  const pressure = fixedLimitProfileShowsPressure(profile);
  return {
    ...read,
    fullBet: true,
    ...(kind === 'raise' ? { raised: true } : {}),
    ...(highOnlyBoard || pressure
      ? { highOnlyBoard: !!highOnlyBoard, strictPressureRange: true }
      : {}),
  };
}

const LOW_RANK: Record<string, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
};

/** Distinct ranks of eight or under on the board (ace low). */
function boardLowRanks(board: readonly Card[]): Set<number> {
  const out = new Set<number>();
  for (const c of board) {
    const v = LOW_RANK[c.rank];
    if (v !== undefined) out.add(v);
  }
  return out;
}

/** True when the board cannot make an eight-or-better low (fewer than three distinct low ranks). */
export function noLowPossible(board: readonly Card[]): boolean {
  return boardLowRanks(board).size < 3;
}

/**
 * How many hole cards carry one of the two ranks that make the nut low on
 * this board (the two lowest ranks, ace low, that the board does not show).
 * Two is the bare nut low; three or four means hero holds cards an opponent
 * needs to tie it. 0 when no low is possible.
 */
export function nutLowBlockersHeld(hole: readonly Card[], board: readonly Card[]): number {
  const onBoard = boardLowRanks(board);
  if (onBoard.size < 3) return 0;
  const nut: number[] = [];
  for (let r = 1; r <= 8 && nut.length < 2; r++) if (!onBoard.has(r)) nut.push(r);
  if (nut.length < 2) return 0;
  let held = 0;
  for (const c of hole) {
    const v = LOW_RANK[c.rank];
    if (v !== undefined && nut.includes(v)) held++;
  }
  return held;
}

/**
 * SPEC-FL-02. Heads-up on a fixed-limit hi-lo river that is unbet or checked
 * to hero, a hand the river-bluff module already classifies as a freeroll
 * (the nut low with no high, HorseRiverBluffRange) bets every time instead of
 * 55 percent of the time: the bet cannot lose the low half, it wins the high
 * half whenever a better high folds, and it costs half a bet when the low is
 * tied. The one refusal is the spec's: a read that this opponent does not
 * fold (a station) while hero holds the bare nut low (two blockers or fewer),
 * where nothing folds and the quartering exposure is at its highest.
 */
export function hiLoNutLowRiverBets(spot: {
  isFixedLimit: boolean;
  isHiLo: boolean;
  headsUp: boolean;
  freeroll: boolean;
  opponentCanRespond: boolean;
  opponentNeverFolds: boolean;
  nutLowBlockers: number;
}): boolean {
  if (!spot.isFixedLimit || !spot.isHiLo || !spot.headsUp || !spot.freeroll) return false;
  if (!spot.opponentCanRespond) return false;
  if (spot.opponentNeverFolds && spot.nutLowBlockers <= 2) return false;
  return true;
}

/**
 * SPEC-FL-03. The equity against the betting range at which raising one
 * fixed-limit bet is worth more than calling it. The raise risks ONE more
 * bet. Called by the bettor it needs to win more than half the time against
 * the hands that call; a re-raise costs a second bet when it comes from a
 * better hand. 0.5 plus that re-raise allowance is 0.6. It is a bar on equity
 * against the BETTING range, which is wider than the calling range, so it
 * leans toward raising; the stack-to-pot adjustment and the no-limit raise
 * frequency do not apply, because no stack is at risk.
 */
export const FIXED_LIMIT_ONE_BET_RAISE_BREAK_EVEN = 0.6;

/** SPEC-FL-03: fixed-limit hold'em, river, facing exactly one wager on an uncapped street. */
export function fixedLimitOneBetValueRaise(spot: {
  isFixedLimit: boolean;
  isOmaha: boolean;
  isRiver: boolean;
  wagersOnStreet: number;
  wagersCapped: boolean;
  raiseLegal: boolean;
}): boolean {
  return (
    spot.isFixedLimit &&
    !spot.isOmaha &&
    spot.isRiver &&
    spot.wagersOnStreet === 1 &&
    !spot.wagersCapped &&
    spot.raiseLegal
  );
}
