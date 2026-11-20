/**
 * omahaFacingBetIsPricedByEquity (default OFF; EMERG lane FACING, 2026-11-19).
 *
 * PLO4/PLO5 cash, high only, one board, postflop. The Horse faces a bet or a
 * raise whose last aggressor is a person, and the node's final answer is a
 * fold. The fold stands only when the call does not pay: the Horse's showdown
 * equity, recomputed here (exactly two hole cards and three board cards,
 * card-seeded Monte Carlo of OMAHA_FACING_EQUITY_SAMPLES runouts against one
 * holding for every live opponent), mapped through the street calibration
 * fitted on PUBLIC information only (cards revealed at showdown; fit on Nov
 * 18, held out on Nov 19; OMAHA_FACING_EQUITY_PROVENANCE), times the street
 * realization measured from the Horses' own flop and turn calls, must beat
 * the price
 * paid / (pot + paid) by the measured margin. Otherwise the call replaces the
 * fold. It never changes a check, a call, a bet or a raise, so a raise the
 * node already chose is kept.
 *
 * Pure in the request (hero cards, board, pot, the chips to call, the live
 * opponents, the street): no opponent memory, no brain random stream. The
 * response validator re-runs it (omahaFacingEquityAdmitsCall).
 * Constants: docs/horse-option-authority.d/omahaFacingBetIsPricedByEquity.CONSTANTS.md
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHi, scoreOmahaHiPartial } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { OMAHA_BET_READ_Q_MAX, omahaBetReadIsLaterBarrel } from './HorseOmahaBetRead.js';
import {
  OMAHA_EV_VALUE_SHARE,
  omahaBetSizeBucket,
  omahaEvHandCounts,
  omahaEvPriorBluffShare,
} from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_FLOP_EV_PRIOR_OTHER,
  OMAHA_FLOP_EV_VALUE_SHARE,
  omahaFlopEvCounts,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';

export const OMAHA_FACING_EQUITY_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** Runouts per verdict: SE <= 0.5 / sqrt(600) = 0.020 on the raw share. */
export const OMAHA_FACING_EQUITY_SAMPLES = 600;
/** More live opponents than this: no verdict (the fold stands). */
export const OMAHA_FACING_EQUITY_FIELD_MAX = 5;

type Street = 'flop' | 'turn' | 'river';
/**
 * Calibration knots [raw, calibrated] by street: the raw share against
 * random holdings mapped to the share against hands revealed at showdown
 * (public information only; Nov 18 fit; CONSTANTS.md). River multiway had
 * too few revealed spots: no verdict.
 */
export const OMAHA_FACING_EQUITY_CALIBRATION: Readonly<
  Record<
    Street,
    { hu: readonly (readonly [number, number])[]; mw: readonly (readonly [number, number])[] }
  >
> = {
  flop: {
    hu: [
      [0.292, 0.169],
      [0.436, 0.339],
      [0.583, 0.457],
      [0.715, 0.559],
      [0.945, 0.898],
    ],
    mw: [
      [0.292, 0.169],
      [0.436, 0.339],
      [0.583, 0.457],
      [0.715, 0.559],
      [0.945, 0.898],
    ],
  },
  turn: {
    hu: [
      [0.381, 0.239],
      [0.572, 0.363],
      [0.729, 0.594],
      [0.912, 0.779],
    ],
    mw: [
      [0.381, 0.239],
      [0.572, 0.363],
      [0.729, 0.594],
      [0.912, 0.779],
    ],
  },
  river: {
    hu: [
      [0.3, 0.214],
      [0.4, 0.25],
      [0.5, 0.286],
      [0.6, 0.357],
      [0.7, 0.464],
      [0.8, 0.607],
      [0.9, 0.679],
    ],
    mw: [],
  },
};
/**
 * Where every constant comes from (lead decision 2026-11-19: live inputs are
 * public information only). Hidden hole cards were used only to grade the
 * finished rule offline on the held-out day, never to fit a constant.
 */
export const OMAHA_FACING_EQUITY_PROVENANCE = Object.freeze({
  calibration:
    "public: flop/turn from opponents whose cards were revealed at showdown (weighted by the public reveal rate per street and raw band); river from the persons' river betting range revealed at showdown (Horse-called heads-up river bets, the bettor's hand percentile on its board)",
  realization:
    "public: chips the Horses' flop and turn calls won back (table results) over the calibrated public equity",
  hiddenCards: 'offline grading of the held-out day only; no constant',
  fit: 'Nov 18 Chicago; held out Nov 19 Chicago',
} as const);
/** Measured realization of the all-in share after a call (river: 1, no later street). */
export const OMAHA_FACING_EQUITY_REALIZATION: Readonly<Record<Street, number>> = {
  flop: 0.486,
  turn: 0.64,
  river: 1,
};
/** Measured margin over the price (calibration standard error, CONSTANTS.md). */
export const OMAHA_FACING_EQUITY_MARGIN: Readonly<Record<Street, number>> = {
  flop: 0.031,
  turn: 0.047,
  river: 0.087,
};

const RANKS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: readonly string[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const key = (c: Card): string => `${c.rank}${c.suit}`;

export interface OmahaFacingEquitySpot {
  street: Street;
  paid: number;
  price: number;
  opponents: number;
  bettorSeat: number;
  /** A Lightning pool decision (publicMemoryDomain.speed), a public fact of the request. */
  lightning: boolean;
}

export interface OmahaFacingEquityVerdict {
  raw: number;
  calibrated: number;
  realized: number;
  price: number;
  margin: number;
  call: boolean;
  /** omahaTurnStrongHandRealizationIsMeasured priced this verdict with the strong-hand turn realization. */
  strongTurn?: boolean;
  /** omahaBetReadIsPerOpponent: the bettor's measured composition moved the calibrated share by this much
   *  (omahaFacingEquityBettorShift); absent when it did not act */
  bettorShift?: number;
}

/**
 * omahaBetReadIsPerOpponent (default off): what the bettor's measured bet composition does to the calibrated
 * share. The calibration maps the raw share to the share against the POPULATION of revealed betting ranges, so
 * the population's non-value share q0 (the facing-bet verdicts' own prior for this street and size) is built in;
 * moving his share to q moves the equity by (q - q0) x (the Horse's share against holdings outside his value
 * region - its share against the value region), counted exactly as the facing-bet verdicts count them
 * (HorseOmahaFacingBetEv.omahaEvHandCounts on the turn and river, HorseOmahaFlopFacingBetEv.omahaFlopEvCounts on
 * the flop). Heads-up only (the read is the bettor's; a multiway share is not his alone). 0 when it cannot be
 * counted. Pure in the cards and the two shares.
 */
export function omahaFacingEquityBettorShift(
  spot: OmahaFacingEquitySpot,
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[],
  potFrac: number,
  q0: number,
  q: number
): number {
  if (spot.opponents !== 1 || !Number.isFinite(q) || !Number.isFinite(q0) || q === q0) return 0;
  try {
    const bucket = omahaBetSizeBucket(potFrac);
    let other: number;
    let value: number;
    if (spot.street === 'flop') {
      const c = omahaFlopEvCounts(
        [...hole],
        [...board],
        [...dead],
        OMAHA_FLOP_EV_VALUE_SHARE[bucket]
      );
      if (!c) return 0;
      other = c.other.win + c.other.tie / 2;
      value = c.value.win + c.value.tie / 2;
    } else {
      const c = omahaEvHandCounts(
        [...hole],
        [...board],
        [...dead],
        OMAHA_EV_VALUE_SHARE[spot.street][bucket]
      );
      if (!c) return 0;
      other = c.other.win + c.other.tie / 2;
      value = c.value.win + c.value.tie / 2;
    }
    const shift = (q - q0) * (other - value);
    return Number.isFinite(shift) ? shift : 0;
  } catch {
    return 0;
  }
}

/** The facing-a-person's-wager spot, or null outside the rule's scope. */
export function omahaFacingEquitySpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaFacingEquitySpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_FACING_EQUITY_VARIANTS.has(variant)) return null;
    if (omahaIsTournamentMode(gs)) return null;
    const street = gs.stage as Street;
    const boardLen = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
    if (
      boardLen === 0 ||
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.wagersCapped === true
    )
      return null;
    const board = gs.communityCards ?? [];
    const hole = player.cards ?? [];
    if (board.length !== boardLen || hole.length !== Number(variant.at(-1))) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Number.isFinite(gs.currentBet) && Number.isFinite(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (
      !Number.isFinite(toCall) ||
      !(toCall > 0.005) ||
      !Number.isFinite(gs.pot) ||
      !(gs.pot > 0) ||
      !Number.isFinite(player.stack) ||
      !(player.stack > 0) ||
      player.is_folded ||
      player.is_all_in ||
      player.is_sitting_out
    )
      return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
    if (
      Array.isArray(gs.legalActions) &&
      !gs.legalActions.includes('call') &&
      !gs.legalActions.includes('all_in')
    )
      return null;
    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, street, bets, gs.pot);
    if (!faced || faced.bettorSeat === player.seat) return null;
    const bettor = gs.players.find((p) => p.seat === faced.bettorSeat);
    // A person's wager only: the calibration is measured against persons.
    if (!bettor || bettor.is_folded || bettor.is_horse !== false) return null;
    const opponents = gs.players.filter(
      (p) => p.seat !== player.seat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
    ).length;
    if (opponents < 1 || opponents > OMAHA_FACING_EQUITY_FIELD_MAX) return null;
    const paid = Math.min(player.stack, toCall);
    return {
      street,
      paid,
      price: paid / (gs.pot + paid),
      opponents,
      bettorSeat: faced.bettorSeat,
      lightning:
        (gs as { publicMemoryDomain?: { speed?: string } | null }).publicMemoryDomain?.speed ===
        'lightning',
    };
  } catch {
    return null;
  }
}

function seedOf(hole: readonly Card[], board: readonly Card[], opponents: number): number {
  let h = 0x811c9dc5;
  const mix = (t: string): void => {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const group of [hole, board]) {
    for (const k of group.map(key).sort()) mix(k);
    mix('|');
  }
  mix(String(opponents));
  return h >>> 0 || 1;
}

/** mulberry32: this module's own stream, never the brain's. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The Horse's showdown share against `opponents` random holdings of its own
 * size, run to the river: exactly two hole and three board cards. Null when
 * the cards are not a valid hand.
 */
export function omahaFacingRawEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  samples: number = OMAHA_FACING_EQUITY_SAMPLES
): number | null {
  const known = new Set([...hole, ...board].map(key));
  if (known.size !== hole.length + board.length) return null;
  if ([...hole, ...board].some((c) => !c || !RANKS.includes(c.rank) || !SUITS.includes(c.suit)))
    return null;
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!known.has(key(card))) deck.push(card);
    }
  const size = hole.length;
  const need = 5 - board.length + opponents * size;
  if (need > deck.length) return null;
  const rnd = stream(seedOf(hole, board, opponents));
  const fullBoard: Card[] = [...board];
  const heroHole = [...hole];
  const opp: Card[] = new Array(size);
  let total = 0;
  for (let s = 0; s < samples; s++) {
    // Partial Fisher-Yates: the first `need` cards are the draw.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rnd() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    let d = 0;
    for (let i = board.length; i < 5; i++) fullBoard[i] = deck[d++];
    const hero = scoreOmahaHi(heroHole, fullBoard);
    let best = -1;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      for (let k = 0; k < size; k++) opp[k] = deck[d++];
      const v = scoreOmahaHi(opp, fullBoard);
      if (v > best) {
        best = v;
        ties = v === hero ? 1 : 0;
      } else if (v === best && v === hero) ties++;
    }
    if (hero > best) total += 1;
    else if (hero === best) total += 1 / (1 + ties);
  }
  return total / samples;
}

function interpolate(knots: readonly (readonly [number, number])[], x: number): number {
  if (knots.length === 0) return x;
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    const [x0, y0] = knots[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-9, x1 - x0);
  }
  return knots[knots.length - 1][1];
}

/** The calibrated share, or null where the cell had too few measured spots (fewer than three knots). */
export function omahaFacingEquityCalibrated(
  street: Street,
  headsUp: boolean,
  raw: number
): number | null {
  const cell = OMAHA_FACING_EQUITY_CALIBRATION[street];
  const knots = headsUp ? cell.hu : cell.mw;
  if (knots.length < 3) return null;
  return Math.max(0, Math.min(1, interpolate(knots, raw)));
}

/**
 * omahaTurnStrongHandRealizationIsMeasured (default OFF; EMERG lane OPEN-ITEMS,
 * 2026-11-19). The flat turn realization (0.64) is the mean over every turn
 * call. Measured apart, on public information only (the chips the Horses' own
 * heads-up turn calls won back over their calibrated public equity, Nov 17-18
 * Chicago), the calls of a STRONG made hand in a Lightning pool realize their
 * whole share: 1.02 on 44 calls (shipped capped at 1; held-out Nov 19: 0.73
 * on 15). A strong made hand = at most OMAHA_FACING_EQUITY_STRONG_BEATEN_MAX
 * of the two-card holdings the unseen cards allow beat it on the board as it
 * stands (the Horse's own cards and the board: public to the Horse). At tables
 * the same class measured 0.36 (26 calls), below the flat figure, and
 * multiway folds graded right, so the cell is Lightning, heads-up, turn only;
 * everywhere else the flat realization stands. No hidden card fitted any
 * constant; hidden cards graded the finished rule offline.
 */
export const OMAHA_FACING_EQUITY_STRONG_BEATEN_MAX = 0.1;
export const OMAHA_FACING_EQUITY_STRONG_TURN_REALIZATION_LIGHTNING = 1;
export const OMAHA_FACING_EQUITY_STRONG_TURN_PROVENANCE = Object.freeze({
  realization:
    "public: chips the Horses' heads-up Lightning turn calls with a strong made hand won back (table results) over the calibrated public equity; 1.02 on 44 calls, capped at 1",
  strength:
    'public to the Horse: its own cards and the board (share of two-card holdings that beat it)',
  hiddenCards: 'offline grading only; no constant',
  fit: 'Nov 17-18 Chicago; held out Nov 19 Chicago',
} as const);

/**
 * The share of the two-card holdings the unseen cards allow whose best hand
 * on this board (exactly those two cards and three board cards) beats the
 * Horse's best hand now. Flop, turn or river; null on invalid cards.
 */
export function omahaFacingBeatenShare(
  hole: readonly Card[],
  board: readonly Card[]
): number | null {
  if (board.length < 3 || board.length > 5 || hole.length < 2) return null;
  const known = new Set([...hole, ...board].map(key));
  if (known.size !== hole.length + board.length) return null;
  if ([...hole, ...board].some((c) => !c || !RANKS.includes(c.rank) || !SUITS.includes(c.suit)))
    return null;
  const score = (h: Card[]): number =>
    board.length === 5 ? scoreOmahaHi(h, board as Card[]) : scoreOmahaHiPartial(h, board as Card[]);
  const hero = score([...hole]);
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!known.has(key(card))) deck.push(card);
    }
  let beat = 0;
  let all = 0;
  const two: Card[] = new Array(2);
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      two[0] = deck[i];
      two[1] = deck[j];
      all++;
      if (score(two) > hero) beat++;
    }
  return all > 0 ? beat / all : null;
}

/** True in the one measured cell of the strong-hand turn realization. */
export function omahaFacingStrongTurnCell(
  spot: OmahaFacingEquitySpot,
  hole: readonly Card[],
  board: readonly Card[]
): boolean {
  if (spot.street !== 'turn' || spot.opponents !== 1 || !spot.lightning) return false;
  if (hole.length !== 4 && hole.length !== 5) return false;
  const beaten = omahaFacingBeatenShare(hole, board);
  return beaten !== null && beaten <= OMAHA_FACING_EQUITY_STRONG_BEATEN_MAX;
}

export function omahaFacingEquityVerdict(
  spot: OmahaFacingEquitySpot,
  hole: readonly Card[],
  board: readonly Card[],
  strongTurnRealization: boolean = false,
  /** omahaBetReadIsPerOpponent: omahaFacingEquityBettorShift for this spot (0 = the population) */
  bettorShift: number = 0
): OmahaFacingEquityVerdict | null {
  const raw = omahaFacingRawEquity(hole, board, spot.opponents);
  if (raw === null) return null;
  const base = omahaFacingEquityCalibrated(spot.street, spot.opponents === 1, raw);
  if (base === null) return null;
  const shifted = Number.isFinite(bettorShift) && bettorShift !== 0;
  const calibrated = shifted ? Math.max(0, Math.min(1, base + bettorShift)) : base;
  const strongTurn = strongTurnRealization && omahaFacingStrongTurnCell(spot, hole, board);
  const realized =
    calibrated *
    (strongTurn
      ? OMAHA_FACING_EQUITY_STRONG_TURN_REALIZATION_LIGHTNING
      : OMAHA_FACING_EQUITY_REALIZATION[spot.street]);
  const margin = OMAHA_FACING_EQUITY_MARGIN[spot.street];
  return {
    raw,
    calibrated,
    realized,
    price: spot.price,
    margin,
    call: realized - spot.price > margin,
    ...(strongTurn ? { strongTurn: true } : {}),
    ...(shifted ? { bettorShift } : {}),
  };
}

/**
 * The rule: a final fold in the spot becomes the call when the verdict says
 * the call pays. `legalize` turns the call into the legal call (or the
 * whole-stack all-in). Every other decision is returned unchanged.
 */
export function omahaFacingBetIsPricedByEquityRule<
  D extends { action: string; amount?: number | null },
>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: D) => D,
  note?: (verdict: OmahaFacingEquityVerdict) => void,
  /** omahaTurnStrongHandRealizationIsMeasured (acts only with `on`). */
  strongTurnRealization: boolean = false,
  /** omahaBetReadIsPerOpponent (acts only with `on`): the bettor's shift for the spot, from the caller's read */
  bettorShiftOf: ((spot: OmahaFacingEquitySpot) => number) | null = null
): D {
  if (!on || decision.action !== 'fold') return decision;
  try {
    const spot = omahaFacingEquitySpot(player, gs);
    if (!spot) return decision;
    const verdict = omahaFacingEquityVerdict(
      spot,
      player.cards ?? [],
      gs.communityCards ?? [],
      strongTurnRealization === true,
      bettorShiftOf ? bettorShiftOf(spot) : 0
    );
    if (!verdict || !verdict.call) return decision;
    // The legalizer makes the call for the whole stack an all-in.
    const legal = legalize({ ...decision, action: 'call', amount: spot.paid } as D);
    if (legal.action !== 'call' && legal.action !== 'all_in') return decision;
    note?.(verdict);
    return { ...decision, action: legal.action, amount: legal.amount };
  } catch {
    return decision;
  }
}

/** The validator's re-run: the exact call this rule makes in this spot. */
export function omahaFacingEquityAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const spot = omahaFacingEquitySpot(player, gs);
    if (!spot || !Number.isFinite(amount) || Math.abs((amount as number) - spot.paid) > 0.005)
      return false;
    const hole = player.cards ?? [];
    const board = gs.communityCards ?? [];
    const verdict = omahaFacingEquityVerdict(spot, hole, board);
    if (verdict !== null && verdict.call) return true;
    // The switch delivers omahaTurnStrongHandRealizationIsMeasured inside the
    // worker, so the request cannot say whether it was on: the call is
    // admitted where the rule COULD have made it (the same pure verdict with
    // the measured strong-hand turn realization), for the same exact chips.
    const strong = omahaFacingEquityVerdict(spot, hole, board, true);
    if (strong !== null && strong.strongTurn === true && strong.call) return true;
    // omahaBetReadIsPerOpponent is delivered inside the worker and reads the opponent memory, which the request
    // does not carry: the call is admitted where the read COULD have made it, the same pure verdict with the
    // largest share the read can give this bettor (OMAHA_BET_READ_Q_MAX), for the same exact chips.
    if (
      spot.street === 'flop' ||
      (spot.street === 'turn' &&
        !omahaBetReadIsLaterBarrel(gs.actionHistory, 'turn', spot.bettorSeat))
    )
      return false;
    const facing = omahaFacingEquityFacedFrac(player, gs, spot);
    if (facing === null || facing.isRaise) return false;
    const q0 = omahaFacingEquityPopulationShare(spot.street, facing.potFrac);
    const most = omahaFacingEquityBettorShift(
      spot,
      hole,
      board,
      player.knownDeadCards ?? [],
      facing.potFrac,
      q0,
      OMAHA_BET_READ_Q_MAX
    );
    if (!(most > 0)) return false;
    for (const strongTurn of [false, true]) {
      const v = omahaFacingEquityVerdict(spot, hole, board, strongTurn, most);
      if (v !== null && v.call) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * THE LIVENESS FALLBACK IS NEVER A BLIND FOLD OF A PRICED CALL (2026-11-19,
 * LIVEGRADE CR-1: hand 60117459, PLO5 Lightning turn, origin horse_fallback,
 * a fold at price 0.20 with 0.895 real equity). When no policy answer arrived
 * and chips are owed, the engine's liveness action was fold on every
 * pot-limit seat. In this rule's own spot (PLO4/PLO5 cash, postflop, facing a
 * person's bet or raise) the same pure verdict is cheap enough to run on the
 * engine thread (card-seeded, no opponent memory, no brain stream): where it
 * says the call pays, the fallback is the call for exactly these chips.
 * Null everywhere else (the liveness action stands, as before). Never PLO6.
 */
export function omahaFallbackPricedCall(player: SeatPlayer, gs: HorseGameStateV2): number | null {
  try {
    const spot = omahaFacingEquitySpot(player, gs);
    if (!spot) return null;
    const verdict = omahaFacingEquityVerdict(spot, player.cards ?? [], gs.communityCards ?? []);
    return verdict !== null && verdict.call && spot.paid > 0 ? spot.paid : null;
  } catch {
    return null;
  }
}

/**
 * omahaBetReadIsPerOpponent: the wager the spot faces as a share of the pot before it and whether it raised an
 * earlier wager of the street (the bet read keeps first bets only). Null when it cannot be read.
 */
export function omahaFacingEquityFacedFrac(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: OmahaFacingEquitySpot
): { potFrac: number; isRaise: boolean } | null {
  try {
    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, spot.street, bets, gs.pot);
    if (!faced || faced.bettorSeat !== spot.bettorSeat) return null;
    const potFrac = faced.wager / faced.potBefore;
    if (!Number.isFinite(potFrac) || !(potFrac > 0)) return null;
    let wagers = 0;
    for (const a of gs.actionHistory ?? [])
      if (
        String(a.stage) === spot.street &&
        (a.action === 'bet' || a.action === 'raise' || a.action === 'all_in') &&
        Number(a.amount) > 0
      )
        wagers++;
    return { potFrac, isRaise: wagers >= 2 };
  } catch {
    return null;
  }
}

/** The facing-bet verdicts' population non-value share for this street and size (the bet read's q0). */
export function omahaFacingEquityPopulationShare(street: Street, potFrac: number): number {
  const bucket = omahaBetSizeBucket(potFrac);
  return street === 'flop'
    ? OMAHA_FLOP_EV_PRIOR_OTHER[bucket]
    : omahaEvPriorBluffShare(street, potFrac, false);
}
