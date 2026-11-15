/**
 * OMAHA STRONG HAND SLOWPLAY MIX (2026-11-15, PLO Strategy lane; option
 * omahaStrongHandSlowplayMix, default OFF, read `=== true` in HorseLogic).
 *
 * Owner, 2026-11-15 14:13 Chicago: "ITS OK FOR HORSES TO JUST CALL WITH THE
 * NUTS, OR JUST CALL WITH TOP FULL HOUSE. THEY SHOULDN'T ALWAYS RAISE 100% OF
 * THE TIME, AND THEY SHOULD CHECK SOMETIMES WITH A SET ON SUPER DRY BOARDS.
 * ... IT SHOULD BE IMPLEMENTED TO SOME DEGREE FOR A BALANCED RANGE." With the
 * day's principles: no blanket rule (the hand, the player, the price and the
 * pot decide), plan the later streets, defend on bad cards and press on good
 * ones, the owner-ruled checks and folds are final, and a raise on the turn
 * or the river facing a bet needs the nuts.
 *
 * Measured first (lane archive plo-handoff-review-01a1cbbd/slowplay-20261115/
 * MEASURE.md): with the day's options on, a nut-class hand facing a pot bet
 * raised 100% of the time in most classes on every street, and a set on a
 * dry flop bet nearly always. This option adds the two mixes the owner asks
 * for. PLO4/PLO5 cash, pot limit, high only, one board, no bomb pot, not
 * Lightning. It only ever turns a raise into a call and a bet into a check:
 * it never folds, never adds a chip and never touches a check, a call or a
 * fold another rule made.
 *
 * (a) CALL MIX. Flop, turn or river, facing a bet, the final answer a raise,
 *     the hand nut class right now (omahaNutClassNow: the exact nuts, a full
 *     house no bigger one beats, the nut flush on an unpaired board, the nut
 *     straight on an unpaired board with no flush possible), the call not for
 *     the whole stack, at most two opponents in the hand. The raise becomes a
 *     call with a probability that depends on the spot:
 *       flop and turn: more when the hand is hard to outdraw (KEEP, the share
 *       of the unseen next cards after which the hand is still nut class),
 *       when the bettor is measured aggressive (he keeps betting), in
 *       position (a later street is played with the last word) and when the
 *       stacks behind leave room to get the money in later; less against a
 *       measured calling station (he pays the raise now), and almost never
 *       when KEEP is under OMAHA_SLOWPLAY_KEEP_FLOOR (a vulnerable nut hand
 *       raises).
 *       river: a call ends the hand, so the mix is small and is priced on the
 *       raise itself: the share of the bettor's range that calls a raise and
 *       loses (HorseOmahaStrongHandValue.omahaStrongHandRaiseVerdict, where
 *       it can be counted: one bettor, nobody else in the hand). The larger
 *       that share, the more the Horse raises; against a measured aggressive
 *       bettor (bluffs and thin bets that fold to a raise) it calls more,
 *       against a station it raises.
 * (b) CHECK MIX. Flop, nothing to call, the final answer a bet, one or two
 *     opponents, the hand a set (a pocket pair with one board card) on a
 *     VERY DRY flop: three suits, three ranks, and every two ranks at least
 *     OMAHA_SLOWPLAY_DRY_MIN_GAP apart with the ace counted high and low, so
 *     no turn card can make a straight or a flush possible. The bet becomes
 *     a check with a probability that rises when few turn cards hurt the hand
 *     (HURT, a weighted share of the unseen turn cards: a card that makes a
 *     straight or flush possible 1, a card that makes a new higher set
 *     possible 0.5, a card that only brings a draw 0.25, a card that pairs
 *     the board 0) and when an opponent is measured to bet when checked to;
 *     it falls against a measured passive player or station and when the pot
 *     is already large beside the stacks. In position the check gives a free
 *     card, so there HURT must be at most OMAHA_SLOWPLAY_IP_MAX_HURT. Never
 *     on any other board.
 *
 * THE DRAW. One uniform number per decision from a stream of this module's
 * own, derived from the decision's seeded strategy stream without advancing
 * it (omahaSlowplayUnit: a hash of the stream's position, the spot and a
 * salt). The strategy stream is left exactly where it was, so no other rule's
 * draw moves; under a pinned seed the mix replays; with the live time-seeded
 * stream the same spot is mixed from hand to hand.
 *
 * EVERY CONSTANT BELOW IS A BUILDER'S CHOICE. NONE IS MEASURED. No evaluation
 * was run; a live read is owed after the release.
 *
 * Pure: no state, no telemetry, no opponent memory, no random draw of its
 * own. HorseLogic supplies the reads and the uniform number.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import { RANKS, RANK_VALUES, SUITS } from './PokerEngine.js';
import { omahaBoardShape, variantInfo } from './HorseEval.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';

export const OMAHA_SLOWPLAY_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

// ── (a) the call mix: every number is a builder's choice, none is measured ──
/** Under this share of next cards that keep the hand nut class, the hand is vulnerable. */
export const OMAHA_SLOWPLAY_KEEP_FLOOR = 0.7;
/** A vulnerable nut hand calls at most this often. */
export const OMAHA_SLOWPLAY_VULNERABLE_CAP = 0.06;
export const OMAHA_SLOWPLAY_CALL_BASE = 0.08;
/** Added at KEEP = 1, in proportion from the floor. */
export const OMAHA_SLOWPLAY_CALL_KEEP_WEIGHT = 0.3;
/** Added against a fully aggressive bettor. */
export const OMAHA_SLOWPLAY_CALL_AGGRESSION_WEIGHT = 0.14;
/** Added in position with a street left. */
export const OMAHA_SLOWPLAY_CALL_POSITION_BONUS = 0.08;
/** Added when the stack behind is at least OMAHA_SLOWPLAY_ROOM_FULL_SPR pots after the call. */
export const OMAHA_SLOWPLAY_CALL_ROOM_WEIGHT = 0.08;
export const OMAHA_SLOWPLAY_ROOM_MIN_SPR = 1;
export const OMAHA_SLOWPLAY_ROOM_FULL_SPR = 4;
/** Taken off against a full calling station. */
export const OMAHA_SLOWPLAY_CALL_STATION_WEIGHT = 0.3;
/** The most a flop or turn raise is called. */
export const OMAHA_SLOWPLAY_CALL_CAP = 0.6;
/** River: the base, the weight of the share that calls a raise and loses, and the bounds. */
export const OMAHA_SLOWPLAY_RIVER_BASE = 0.3;
export const OMAHA_SLOWPLAY_RIVER_CALLED_BY_WORSE_WEIGHT = 0.5;
export const OMAHA_SLOWPLAY_RIVER_UNPRICED_BASE = 0.1;
export const OMAHA_SLOWPLAY_RIVER_AGGRESSION_WEIGHT = 0.15;
export const OMAHA_SLOWPLAY_RIVER_STATION_WEIGHT = 0.25;
export const OMAHA_SLOWPLAY_RIVER_FLOOR = 0.03;
export const OMAHA_SLOWPLAY_RIVER_CAP = 0.35;
/** Two opponents in the hand: the mix is scaled by this; three or more: no mix. */
export const OMAHA_SLOWPLAY_THREE_WAY_SCALE = 0.6;
export const OMAHA_SLOWPLAY_MAX_OPPONENTS = 2;

// ── (b) the check mix: every number is a builder's choice, none is measured ──
/** Very dry: every two flop ranks at least this far apart (ace high and low). */
export const OMAHA_SLOWPLAY_DRY_MIN_GAP = 5;
export const OMAHA_SLOWPLAY_HURT_HIGHER_SET = 0.5;
export const OMAHA_SLOWPLAY_HURT_DRAW = 0.25;
/** HURT at which the calm term is zero, and the span under it over which it grows to one. */
export const OMAHA_SLOWPLAY_HURT_CEILING = 0.45;
export const OMAHA_SLOWPLAY_HURT_SPAN = 0.25;
/** In position the check is a free card: HURT must be at most this. */
export const OMAHA_SLOWPLAY_IP_MAX_HURT = 0.3;
export const OMAHA_SLOWPLAY_CHECK_BASE = 0.04;
export const OMAHA_SLOWPLAY_CHECK_CALM_WEIGHT = 0.18;
export const OMAHA_SLOWPLAY_CHECK_AGGRESSION_WEIGHT = 0.22;
export const OMAHA_SLOWPLAY_CHECK_PASSIVE_WEIGHT = 0.25;
/** Taken off when the stack behind is one pot or less, in proportion up to four pots. */
export const OMAHA_SLOWPLAY_CHECK_COMMITTED_WEIGHT = 0.2;
export const OMAHA_SLOWPLAY_CHECK_CAP = 0.45;

// ── the reads: every number is a builder's choice, none is measured ──
/** Bet-when-checked-to posterior mean at which aggression starts and is full. */
export const OMAHA_SLOWPLAY_AGGRESSION_FROM = 0.45;
export const OMAHA_SLOWPLAY_AGGRESSION_FULL = 0.75;
/** Fold-to-bet posterior mean at which a station is full and stops. */
export const OMAHA_SLOWPLAY_STATION_FULL = 0.2;
export const OMAHA_SLOWPLAY_STATION_FROM = 0.4;
/** Bet-when-checked-to posterior mean at which a passive player is full and stops. */
export const OMAHA_SLOWPLAY_PASSIVE_FULL = 0.2;
export const OMAHA_SLOWPLAY_PASSIVE_FROM = 0.4;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fin = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const key = (c: Card) => `${c.rank}${c.suit[0]}`;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * One uniform number in [0, 1) from the module's own derived stream: a hash
 * of the strategy stream's position (HorseEval.saveFastRandom, read, never
 * advanced), the spot and a salt.
 */
export function omahaSlowplayUnit(streamState: number, spotKey: string, salt: number): number {
  let h = (0x811c9dc5 ^ (salt >>> 0) ^ Math.imul(streamState >>> 0, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < spotKey.length; i++) {
    h ^= spotKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}
export const OMAHA_SLOWPLAY_CALL_SALT = 0x51c0a11;
export const OMAHA_SLOWPLAY_CHECK_SALT = 0x51c0c4e;

/** The spot as the derived stream keys it. */
export function omahaSlowplaySpotKey(hero: SeatPlayer, gs: HorseGameStateV2): string {
  const bb = Math.max(1e-6, fin(gs.bigBlind) || 1);
  return `${hero.user_id}:${gs.stage}:${Math.round((fin(gs.pot) / bb) * 100)}:${(hero.cards ?? [])
    .map(key)
    .join('')}:${(gs.communityCards ?? []).map(key).join('')}`;
}

/** What the mix reads of the opponents: 0..1 each, 0 when nothing is measured. */
export interface OmahaSlowplayRead {
  /** he bets when checked to and keeps betting */
  aggression: number;
  /** he calls bets and raises: the value is taken now */
  station: number;
  /** he does not bet when checked to */
  passive: number;
}

export function omahaSlowplayReadOf(read: OmahaReadConditional | null): OmahaSlowplayRead {
  if (!read || read.measured !== true) return { aggression: 0, station: 0, passive: 0 };
  const mean = (s: { mean?: number; n?: number } | undefined): number | null =>
    s && typeof s.mean === 'number' && Number.isFinite(s.mean) && fin(s.n) > 0 ? s.mean : null;
  const bet = mean(read.betCheckedTo);
  const fold = mean(read.foldToBet);
  const aggression = read.valueLeader
    ? 0
    : read.postflopAggressor
      ? 1
      : bet === null
        ? 0
        : clamp(
            (bet - OMAHA_SLOWPLAY_AGGRESSION_FROM) /
              (OMAHA_SLOWPLAY_AGGRESSION_FULL - OMAHA_SLOWPLAY_AGGRESSION_FROM),
            0,
            1
          );
  const station = Math.max(
    fold === null
      ? 0
      : clamp(
          (OMAHA_SLOWPLAY_STATION_FROM - fold) /
            (OMAHA_SLOWPLAY_STATION_FROM - OMAHA_SLOWPLAY_STATION_FULL),
          0,
          1
        ),
    read.riverCall?.engaged === 'high' ? 1 : 0,
    read.foldToBet?.engaged === 'low' ? 1 : 0
  );
  const passive = read.postflopAggressor
    ? 0
    : Math.max(
        bet === null
          ? 0
          : clamp(
              (OMAHA_SLOWPLAY_PASSIVE_FROM - bet) /
                (OMAHA_SLOWPLAY_PASSIVE_FROM - OMAHA_SLOWPLAY_PASSIVE_FULL),
              0,
              1
            ),
        read.betCheckedTo?.engaged === 'low' ? 1 : 0
      );
  return { aggression, station, passive };
}

/** The readings of several opponents as one: the most of each. */
export function omahaSlowplayReadMost(reads: readonly OmahaSlowplayRead[]): OmahaSlowplayRead {
  return {
    aggression: Math.max(0, ...reads.map((r) => r.aggression)),
    station: Math.max(0, ...reads.map((r) => r.station)),
    passive: Math.max(0, ...reads.map((r) => r.passive)),
  };
}

type Street = 'flop' | 'turn' | 'river';
const STREET_BOARD: Record<Street, number> = { flop: 3, turn: 4, river: 5 };

/** PLO4/PLO5 cash, pot limit, high only, one board, no bomb pot, not Lightning, the Horse able to act. */
function inGame(hero: SeatPlayer, gs: HorseGameStateV2): Street | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_SLOWPLAY_VARIANTS.has(variant)) return null;
  const vi = variantInfo(variant);
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
  // Cash only (HorseLogic.isTournamentMode's own reading).
  if (
    gs.gameMode ? gs.gameMode === 'tournament' : gs.tournament != null || (gs.bigBlind ?? 0) >= 10
  )
    return null;
  if (
    (gs.boardCount ?? 1) !== 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0 ||
    gs.bombPot === true ||
    (gs as { allInOrFold?: boolean }).allInOrFold === true
  )
    return null;
  const speed = (gs as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain?.speed;
  if (speed === 'lightning') return null;
  const street: Street | null =
    gs.stage === 'flop' || gs.stage === 'turn' || gs.stage === 'river' ? gs.stage : null;
  if (street === null) return null;
  if ((gs.communityCards ?? []).length !== STREET_BOARD[street]) return null;
  if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
  if (hero.is_folded || hero.is_all_in || hero.is_sitting_out) return null;
  return street;
}

const toCallOf = (hero: SeatPlayer, gs: HorseGameStateV2): number =>
  Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, fin(gs.currentBet) - fin(hero.bet));

const liveOpponents = (hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer[] =>
  (gs.players ?? []).filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out);

/** Every live opponent acts before the Horse on a later street. */
function inPositionOf(hero: SeatPlayer, gs: HorseGameStateV2, live: SeatPlayer[]): boolean {
  const dealer = gs.dealerSeat;
  if (typeof dealer !== 'number' || !Number.isFinite(dealer) || live.length === 0) return false;
  const after = (seat: number): number => (((seat - dealer - 1) % 32) + 32) % 32;
  return live.every((p) => after(p.seat) < after(hero.seat));
}

function unseenCards(hero: SeatPlayer, gs: HorseGameStateV2): Card[] {
  const removed = new Set(
    [...(hero.cards ?? []), ...(gs.communityCards ?? []), ...(hero.knownDeadCards ?? [])].map(key)
  );
  const out: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) out.push(card);
    }
  return out;
}

/**
 * KEEP: the share of the unseen next cards after which the hand is still nut
 * class (omahaNutClassNow on the board with that card). 1 on the river (no
 * card is left), 0 when it cannot be computed.
 */
export function omahaSlowplayKeepShare(hero: SeatPlayer, gs: HorseGameStateV2): number {
  try {
    const board = gs.communityCards ?? [];
    if (board.length === 5) return 1;
    if (board.length !== 3 && board.length !== 4) return 0;
    const unseen = unseenCards(hero, gs);
    if (unseen.length === 0) return 0;
    let keep = 0;
    for (const card of unseen)
      if (omahaNutClassNow(hero, { ...gs, communityCards: [...board, card] })) keep++;
    return keep / unseen.length;
  } catch {
    return 0;
  }
}

// ───────────────────────────── (a) the call mix ─────────────────────────────

export interface OmahaSlowplayCallScope {
  street: Street;
  /** the chips the call puts in */
  paid: number;
  potAfterCall: number;
  inPosition: boolean;
  /** opponents still in the hand */
  opponents: number;
  /** the seat whose wager the Horse faces (the largest street bet), or null */
  bettorSeat: number | null;
  /** the stack the Horse can still win or lose after the call, in pots after the call */
  sprAfterCall: number;
}

/**
 * The public spot of the call mix, or null: facing a wager the Horse can call
 * without putting its whole stack in, with one or two opponents in the hand
 * and at least one of them with chips behind. Reads no hole card beyond the
 * count.
 */
export function omahaSlowplayCallScope(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaSlowplayCallScope | null {
  try {
    const street = inGame(hero, gs);
    if (street === null) return null;
    const toCall = toCallOf(hero, gs);
    if (!(toCall > 0.005)) return null;
    const stack = Math.max(0, fin(hero.stack));
    if (!(stack > toCall + 0.005)) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('call')) return null;
    const live = liveOpponents(hero, gs);
    if (live.length < 1 || live.length > OMAHA_SLOWPLAY_MAX_OPPONENTS) return null;
    const deepest = Math.max(0, ...live.filter((p) => !p.is_all_in).map((p) => fin(p.stack)));
    if (!(deepest > 0.005)) return null;
    const potAfterCall = Math.max(0, fin(gs.pot)) + toCall;
    let bettorSeat: number | null = null;
    let most = 0;
    for (const p of live)
      if (fin(p.bet) > most + 0.005) {
        most = fin(p.bet);
        bettorSeat = p.seat;
      }
    return {
      street,
      paid: Math.round(toCall * 100) / 100,
      potAfterCall,
      inPosition: inPositionOf(hero, gs, live),
      opponents: live.length,
      bettorSeat,
      sprAfterCall: potAfterCall > 0 ? Math.min(stack - toCall, deepest) / potAfterCall : 0,
    };
  } catch {
    return null;
  }
}

/** The river raise as HorseOmahaStrongHandValue.omahaStrongHandRaiseVerdict prices it, as far as the mix reads it. */
export interface OmahaSlowplayRiverRaise {
  /** the share of the bettor's range that continues against the best value raise */
  continues: number;
  /** of the continuing holdings, the share the Horse beats */
  win: number;
}

export interface OmahaSlowplayCallInput {
  scope: OmahaSlowplayCallScope;
  /** KEEP (omahaSlowplayKeepShare) */
  keep: number;
  read: OmahaSlowplayRead;
  /** river only: the priced raise, or null where it cannot be counted */
  riverRaise?: OmahaSlowplayRiverRaise | null;
}

/** The probability that the raise becomes a call. Monotone in KEEP and in the bettor's aggression. */
export function omahaSlowplayCallFrequency(input: OmahaSlowplayCallInput): number {
  const { scope, read } = input;
  const scale = scope.opponents >= 2 ? OMAHA_SLOWPLAY_THREE_WAY_SCALE : 1;
  if (scope.street === 'river') {
    const priced = input.riverRaise ?? null;
    const base =
      priced === null
        ? OMAHA_SLOWPLAY_RIVER_UNPRICED_BASE
        : OMAHA_SLOWPLAY_RIVER_BASE -
          OMAHA_SLOWPLAY_RIVER_CALLED_BY_WORSE_WEIGHT *
            clamp(priced.continues, 0, 1) *
            clamp(priced.win, 0, 1);
    return round4(
      scale *
        clamp(
          base +
            OMAHA_SLOWPLAY_RIVER_AGGRESSION_WEIGHT * read.aggression -
            OMAHA_SLOWPLAY_RIVER_STATION_WEIGHT * read.station,
          OMAHA_SLOWPLAY_RIVER_FLOOR,
          OMAHA_SLOWPLAY_RIVER_CAP
        )
    );
  }
  const keep = clamp(input.keep, 0, 1);
  const hard = clamp((keep - OMAHA_SLOWPLAY_KEEP_FLOOR) / (1 - OMAHA_SLOWPLAY_KEEP_FLOOR), 0, 1);
  const room = clamp(
    (scope.sprAfterCall - OMAHA_SLOWPLAY_ROOM_MIN_SPR) /
      (OMAHA_SLOWPLAY_ROOM_FULL_SPR - OMAHA_SLOWPLAY_ROOM_MIN_SPR),
    0,
    1
  );
  const raw =
    OMAHA_SLOWPLAY_CALL_BASE +
    OMAHA_SLOWPLAY_CALL_KEEP_WEIGHT * hard +
    OMAHA_SLOWPLAY_CALL_AGGRESSION_WEIGHT * read.aggression +
    (scope.inPosition ? OMAHA_SLOWPLAY_CALL_POSITION_BONUS : 0) +
    OMAHA_SLOWPLAY_CALL_ROOM_WEIGHT * room -
    OMAHA_SLOWPLAY_CALL_STATION_WEIGHT * read.station;
  const cap =
    keep < OMAHA_SLOWPLAY_KEEP_FLOOR ? OMAHA_SLOWPLAY_VULNERABLE_CAP : OMAHA_SLOWPLAY_CALL_CAP;
  return round4(scale * clamp(raw, 0, cap));
}

/** The decision puts in more than the call. */
function raises(decision: HorseDecision, hero: SeatPlayer, toCall: number): boolean {
  if (decision.action === 'raise') return true;
  if (decision.action === 'all_in') return fin(hero.stack) > toCall + 0.005;
  return false;
}

export interface OmahaSlowplayResult {
  decision: HorseDecision;
  changed: 'slowplay_call' | 'slowplay_check' | null;
  /** the probability of the conversion in this spot (0 outside it) */
  frequency: number;
  /** KEEP for the call mix, HURT for the check mix */
  share: number;
}

/**
 * (a): the raise becomes the exact call when `unit` falls under the spot's
 * frequency. `unit` is the caller's one draw from the derived stream.
 */
export function omahaSlowplayCallDecision(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: {
    unit: number;
    /** the bettor's read (and, three-way, the other opponent's), already combined */
    read: OmahaSlowplayRead;
    /** river only: prices the raise; null where it cannot be counted */
    riverRaise?: () => OmahaSlowplayRiverRaise | null;
  }
): OmahaSlowplayResult {
  const same: OmahaSlowplayResult = { decision, changed: null, frequency: 0, share: 0 };
  try {
    const scope = omahaSlowplayCallScope(hero, gs);
    if (!scope || !raises(decision, hero, scope.paid)) return same;
    if (!omahaNutClassNow(hero, gs)) return same;
    const keep = omahaSlowplayKeepShare(hero, gs);
    const frequency = omahaSlowplayCallFrequency({
      scope,
      keep,
      read: ctx.read,
      riverRaise: scope.street === 'river' && ctx.riverRaise ? ctx.riverRaise() : null,
    });
    if (!(ctx.unit < frequency)) return { decision, changed: null, frequency, share: keep };
    const called: HorseDecision = { ...decision, action: 'call', amount: scope.paid };
    delete called.continuationGuard;
    return { decision: called, changed: 'slowplay_call', frequency, share: keep };
  } catch {
    return same;
  }
}

/**
 * Receipt validation (no options, no opponent memory, no draw in the
 * request): a raise that became a call is admitted only inside the call
 * mix's public spot, with a nut-class hand, and only for the exact chips of
 * the call.
 */
export function omahaSlowplayAdmitsCall(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const scope = omahaSlowplayCallScope(hero, gs);
    if (!scope || !omahaNutClassNow(hero, gs)) return false;
    return typeof amount === 'number' && Math.abs(amount - scope.paid) < 1e-9;
  } catch {
    return false;
  }
}

// ───────────────────────────── (b) the check mix ─────────────────────────────

const rankOf = (c: Card): number => RANK_VALUES[c.rank] ?? 0;

/**
 * VERY DRY FLOP: three cards of three suits and three ranks, every two ranks
 * at least OMAHA_SLOWPLAY_DRY_MIN_GAP apart, the ace counted both high and
 * low (K-8-3, Q-7-2, K-7-2; not A-9-4, where the ace and the four are three
 * apart). On such a flop no turn card makes a straight or a flush possible.
 */
export function omahaVeryDryFlop(board: Card[]): boolean {
  if (!Array.isArray(board) || board.length !== 3) return false;
  if (new Set(board.map((c) => c.suit)).size !== 3) return false;
  const ranks = board.map(rankOf);
  if (new Set(ranks).size !== 3 || ranks.some((r) => r <= 0)) return false;
  const all = ranks.flatMap((r) => (r === 14 ? [14, 1] : [r]));
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (Math.abs(all[i] - all[j]) < OMAHA_SLOWPLAY_DRY_MIN_GAP) return false;
  return true;
}

/** The rank of the Horse's set (a pocket pair with one card of an unpaired flop), or 0. */
export function omahaFlopSetRank(hole: Card[], board: Card[]): number {
  if (!Array.isArray(hole) || !Array.isArray(board) || board.length !== 3) return 0;
  let best = 0;
  for (const b of board) {
    const r = rankOf(b);
    if (hole.filter((c) => rankOf(c) === r).length >= 2 && r > best) best = r;
  }
  return best;
}

/**
 * HURT: the weighted share of the unseen turn cards that hurt a set of
 * `setRank` on this flop. A card that makes a straight or a flush possible
 * counts 1; a card of a rank above the set that is not on the board (a new
 * higher set becomes possible) OMAHA_SLOWPLAY_HURT_HIGHER_SET; a card that
 * only brings a draw (a second card of a suit, or a rank within four of a
 * board rank) OMAHA_SLOWPLAY_HURT_DRAW; a card that pairs the board (the set
 * becomes a full house or quads) 0.
 */
export function omahaSlowplayHurtShare(hero: SeatPlayer, gs: HorseGameStateV2): number {
  try {
    const board = gs.communityCards ?? [];
    const setRank = omahaFlopSetRank(hero.cards ?? [], board);
    if (board.length !== 3 || setRank === 0) return 1;
    const unseen = unseenCards(hero, gs);
    if (unseen.length === 0) return 1;
    const boardRanks = board.map(rankOf);
    const low = (r: number) => (r === 14 ? [14, 1] : [r]);
    let hurt = 0;
    for (const card of unseen) {
      const r = rankOf(card);
      if (boardRanks.includes(r)) continue;
      const shape = omahaBoardShape([...board, card]);
      if (shape.straightPossible || shape.flushPossible) hurt += 1;
      else if (r > setRank) hurt += OMAHA_SLOWPLAY_HURT_HIGHER_SET;
      else if (
        board.some((b) => b.suit === card.suit) ||
        boardRanks.some((b) => low(b).some((x) => low(r).some((y) => Math.abs(x - y) <= 4)))
      )
        hurt += OMAHA_SLOWPLAY_HURT_DRAW;
    }
    return hurt / unseen.length;
  } catch {
    return 1;
  }
}

export interface OmahaSlowplayCheckScope {
  inPosition: boolean;
  opponents: number;
  opponentSeats: number[];
  setRank: number;
  /** the stack in play, in pots */
  spr: number;
}

/**
 * The spot of the check mix, or null: the flop, nothing to call, one or two
 * opponents, a set on a very dry flop.
 */
export function omahaSlowplayCheckScope(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaSlowplayCheckScope | null {
  try {
    if (inGame(hero, gs) !== 'flop') return null;
    if (toCallOf(hero, gs) > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    const board = gs.communityCards ?? [];
    if (!omahaVeryDryFlop(board)) return null;
    const setRank = omahaFlopSetRank(hero.cards, board);
    if (setRank === 0) return null;
    const live = liveOpponents(hero, gs);
    if (live.length < 1 || live.length > OMAHA_SLOWPLAY_MAX_OPPONENTS) return null;
    const deepest = Math.max(0, ...live.filter((p) => !p.is_all_in).map((p) => fin(p.stack)));
    const stack = Math.max(0, fin(hero.stack));
    const pot = Math.max(0, fin(gs.pot));
    if (!(deepest > 0.005) || !(stack > 0.005) || !(pot > 0)) return null;
    return {
      inPosition: inPositionOf(hero, gs, live),
      opponents: live.length,
      opponentSeats: live.map((p) => p.seat),
      setRank,
      spr: Math.min(stack, deepest) / pot,
    };
  } catch {
    return null;
  }
}

/** The probability that the bet becomes a check. Falls with HURT, rises with the opponents' aggression. */
export function omahaSlowplayCheckFrequency(
  scope: OmahaSlowplayCheckScope,
  hurt: number,
  read: OmahaSlowplayRead
): number {
  if (scope.inPosition && hurt > OMAHA_SLOWPLAY_IP_MAX_HURT) return 0;
  const calm = clamp((OMAHA_SLOWPLAY_HURT_CEILING - hurt) / OMAHA_SLOWPLAY_HURT_SPAN, 0, 1);
  const committed = clamp(
    (OMAHA_SLOWPLAY_ROOM_FULL_SPR - scope.spr) /
      (OMAHA_SLOWPLAY_ROOM_FULL_SPR - OMAHA_SLOWPLAY_ROOM_MIN_SPR),
    0,
    1
  );
  const raw =
    OMAHA_SLOWPLAY_CHECK_BASE +
    OMAHA_SLOWPLAY_CHECK_CALM_WEIGHT * calm +
    OMAHA_SLOWPLAY_CHECK_AGGRESSION_WEIGHT * read.aggression -
    OMAHA_SLOWPLAY_CHECK_PASSIVE_WEIGHT * Math.max(read.passive, read.station) -
    OMAHA_SLOWPLAY_CHECK_COMMITTED_WEIGHT * committed;
  const scale = scope.opponents >= 2 ? OMAHA_SLOWPLAY_THREE_WAY_SCALE : 1;
  return round4(scale * clamp(raw, 0, OMAHA_SLOWPLAY_CHECK_CAP));
}

/** (b): the bet becomes a check when `unit` falls under the spot's frequency. */
export function omahaSlowplayCheckDecision(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: { unit: number; read: (seat: number) => OmahaSlowplayRead }
): OmahaSlowplayResult {
  const same: OmahaSlowplayResult = { decision, changed: null, frequency: 0, share: 0 };
  try {
    if (decision.action !== 'bet') return same;
    const scope = omahaSlowplayCheckScope(hero, gs);
    if (!scope) return same;
    const hurt = omahaSlowplayHurtShare(hero, gs);
    const frequency = omahaSlowplayCheckFrequency(
      scope,
      hurt,
      omahaSlowplayReadMost(scope.opponentSeats.map(ctx.read))
    );
    if (!(ctx.unit < frequency)) return { decision, changed: null, frequency, share: hurt };
    const checked: HorseDecision = { ...decision, action: 'check' };
    delete checked.amount;
    delete checked.continuationGuard;
    return { decision: checked, changed: 'slowplay_check', frequency, share: hurt };
  } catch {
    return same;
  }
}

/** Receipt validation: a bet that became a check is admitted only in the check mix's spot. */
export function omahaSlowplayAdmitsCheck(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  return omahaSlowplayCheckScope(hero, gs) !== null;
}
