/**
 * OMAHA: THREE BETS THAT BECOME CHECKS (owner 2026-11-15, hand 59517323; three
 * options, each default OFF and read `=== true`).
 *
 * One PLO5 cash hand. A Horse 4-bet aces, was called by one player who had
 * position, bet the flop 5-8-9 two-tone with the bare overpair and backdoor
 * draws, was called, bet the turn with the overpair and a flush draw it had
 * picked up, was called, and on the river that paired the board bet a quarter
 * of the pot with aces up into the player who had called both streets. That
 * player moved all in with a full house and the Horse paid it off. The owner's
 * rulings, in substance: out of position that flop is a check; called on the
 * flop and not improved, the turn is a check; the river was a terrible card
 * and defence should have been played.
 *
 * Why it happened: each street's bet came from an equity bar (the flop EV
 * comparator, the turn value/barrel branches, the river out-of-position block
 * bet). Position enters those only as a realisation or frequency factor, and
 * none asks what the hands that called are. The 2026-11-06 paired-board river
 * check needs the board paired by the turn; the made-hand defence's river
 * check needs an opponent who bet or raised earlier, not one who called.
 *
 * This file holds the three public-information spots. HorseLogic
 * (omahaOopCheckRules, wager_rules node, after the paired-board river check)
 * turns a bet in such a spot into a check:
 *
 *  - omahaBareOverpairOopFlopCheck: flop, an opponent still acts behind, one
 *    pair only, no flush draw and under eight straight outs, the flop two-tone
 *    or connected. No opponent read: heads-up and multiway.
 *  - omahaOverpairNoOopBarrelVsValueLeader: turn, heads-up, the opponent acts
 *    behind and called the Horse's flop bet, one pair only (a draw picked up,
 *    the nut flush draw included, is not an improved made hand), a straight
 *    possible on the board; only against a MEASURED postflop value leader.
 *  - omahaPairedTurnNoBarrelWithoutBoatVsValueLeader (hand 59521326: a flop
 *    check-raise with the nut straight called, then a bet into the turn card
 *    that paired the board, then a fold of the straight on the river): turn,
 *    heads-up, the opponent acts behind and called the Horse's flop bet or
 *    raise, the turn card pairs the board, less than a full house; only
 *    against a MEASURED postflop value leader.
 *  - omahaTurnBetNeedsRiverPlan (hand 59521326, no opponent read): a
 *    heads-up turn bet that leaves less than half the resulting pot behind
 *    is checked when the Horse's own river fold rules (omahaRiverShoveFoldVerdict:
 *    the paired-board fold and the big-bet tier) would fold more than 35% of
 *    the rivers to an all-in for what is left.
 *  - omahaPairedRiverNoThinLeadVsValueLeader: river, the final board paired,
 *    less than a full house, a live opponent called the Horse's flop or turn
 *    bet; only when every live opponent is a MEASURED postflop value leader.
 *
 * Scope of all three: PLO4 and PLO5 cash, pot limit, one board, high only,
 * nothing to call, check legal. A call or fold facing a bet is touched in two
 * places only: the turn after the check (omahaOopTurnCheckAfterFlopCall) and
 * the flop after the bare-pair check (omahaBareOverpairOopFlopCheck, THE
 * CONTINUATION below).
 * The spots read hero's cards, the board and the public actions; the value
 * leader read (HorseOmahaReadConditional, never a presumed read) is applied by
 * HorseLogic.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaAggressorTier,
  omahaBoardShape,
  omahaDrawQuality,
  omahaMadeClass,
  restoreFastRandom,
  saveFastRandom,
  seedFastRandom,
  simulateEquity,
  variantInfo,
  type OppPostflopRead,
} from './HorseEval.js';
import {
  OMAHA_FACING_BET_EV_MARGIN,
  OMAHA_FACING_BET_EV_TRIVIAL_BEHIND,
  omahaEvBluffShare,
} from './HorseOmahaFacingBetEv.js';
import { RANKS, SUITS } from './PokerEngine.js';
import {
  omahaBeatenByBoard,
  omahaNutClassNow,
  omahaTurnRedrawShare,
} from './HorseOmahaMadeHandDefense.js';
import {
  ploPairedBoardFoldRespectsPrice,
  ploPairedBoardMustFold,
} from './HorsePloPairedBoardFold.js';
import { v81Cell, v86OmahaUnderboatOrDominatedFold } from './HorseOmahaBigBetCalls.js';
import { horsePolicyDealtPlayers } from './multiway/DealtSeatCensus.js';

export const OMAHA_OOP_CHECK_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

const STREET_BOARD: Record<string, number> = { flop: 3, turn: 4, river: 5 };
const ONE_PAIR = 2;
const FULL_HOUSE = 7;
/** Eight straight outs is the open-ended draw; fewer is a gutshot or a backdoor. */
export const OMAHA_OOP_CHECK_STRAIGHT_DRAW_OUTS = 8;

type Street = 'flop' | 'turn' | 'river';

/** The street at this node when all three options' common scope holds, else null. */
export function omahaOopCheckStreet(hero: SeatPlayer, gs: HorseGameStateV2): Street | null {
  return scopeStreet(hero, gs, false);
}

/** The common scope; `facing` asks for a wager to call (fold and call legal) instead of none. */
function scopeStreet(hero: SeatPlayer, gs: HorseGameStateV2, facing: boolean): Street | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_OOP_CHECK_VARIANTS.has(variant)) return null;
  const stage = String(gs.stage ?? '');
  if (stage !== 'flop' && stage !== 'turn' && stage !== 'river') return null;
  const vi = variantInfo(variant);
  if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
  if (
    (gs.boardCount ?? 1) > 1 ||
    (gs.communityCards2?.length ?? 0) > 0 ||
    (gs.communityCards3?.length ?? 0) > 0
  )
    return null;
  if (gs.allInOrFold === true) return null;
  // Cash only (HorseLogic.isTournamentMode's own reading).
  if (
    gs.gameMode ? gs.gameMode === 'tournament' : gs.tournament != null || (gs.bigBlind ?? 0) >= 10
  )
    return null;
  if ((gs.communityCards ?? []).length !== STREET_BOARD[stage]) return null;
  if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
  if (facing) {
    if (!(toCall > 0.005)) return null;
    if (
      Array.isArray(gs.legalActions) &&
      !(gs.legalActions.includes('call') && gs.legalActions.includes('fold'))
    )
      return null;
    return stage;
  }
  if (toCall > 0.005) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
  return stage;
}

const liveOpponents = (hero: SeatPlayer, gs: HorseGameStateV2): SeatPlayer[] =>
  (gs.players ?? []).filter((p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out);

/**
 * Out of position: a live opponent with chips has not acted on this street
 * and sits later in the postflop order (the seat left of the button acts
 * first). The made-hand defence's own reading.
 */
export function omahaOpponentActsBehind(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  const street = String(gs.stage ?? '');
  const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
  const live = liveOpponents(hero, gs);
  const acted = new Set(history.filter((a) => String(a.stage) === street).map((a) => a.seat));
  const dealer = Number.isFinite(gs.dealerSeat) ? (gs.dealerSeat as number) : null;
  if (dealer === null) return false;
  const span = Math.max(hero.seat, dealer, ...live.map((p) => p.seat)) + 1;
  const order = (seat: number) => (seat - dealer - 1 + 2 * span) % span;
  return live.some(
    (p) =>
      !p.is_all_in && (p.stack ?? 0) > 0 && !acted.has(p.seat) && order(p.seat) > order(hero.seat)
  );
}

/** The seats that called hero's own last bet or raise on `stage` (empty when hero was not the last aggressor). */
export function omahaCallersOfHeroBet(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  stage: 'flop' | 'turn'
): Set<number> {
  let lastAggressor: number | null = null;
  let callers = new Set<number>();
  for (const a of gs.actionHistory ?? []) {
    if (String(a.stage) !== stage) continue;
    const act = String(a.action);
    if (act === 'bet' || act === 'raise' || act === 'all_in') {
      // An all-in that does not raise is a call of the standing wager.
      if (act === 'all_in' && lastAggressor !== null && a.isFullRaise !== true) {
        callers.add(a.seat);
        continue;
      }
      lastAggressor = a.seat;
      callers = new Set<number>();
    } else if (act === 'call' && a.seat !== lastAggressor) {
      callers.add(a.seat);
    }
  }
  return lastAggressor === hero.seat ? callers : new Set<number>();
}

const category = (hole: Card[], board: Card[]): number => omahaMadeClass(hole, board).category;

/**
 * omahaBareOverpairOopFlopCheck: flop, an opponent acts behind, exactly one
 * pair, no flush draw, fewer than eight straight outs, and the flop is
 * two-tone (two or more of a suit) or allows a straight.
 */
export function omahaBareOverpairOopFlopSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'flop') return false;
    if (!bareOnePairOnFlop(hero.cards, gs.communityCards ?? [])) return false;
    return omahaOpponentActsBehind(hero, gs);
  } catch {
    return false;
  }
}

/** The hand and flop of omahaBareOverpairOopFlopCheck: exactly one pair, no
 *  flush draw, fewer than eight straight outs, the flop two-tone or connected. */
function bareOnePairOnFlop(hole: Card[], board: Card[]): boolean {
  if (category(hole, board) !== ONE_PAIR) return false;
  const suits = new Map<string, number>();
  for (const c of board) suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
  const twoTone = Array.from(suits.values()).some((n) => n >= 2);
  if (!twoTone && !omahaBoardShape(board).straightPossible) return false;
  const draw = omahaDrawQuality(hole, board, false);
  if (draw.nutFlushDraw || draw.dominatedFlushDraw) return false;
  return draw.straightOuts < OMAHA_OOP_CHECK_STRAIGHT_DRAW_OUTS;
}

/**
 * omahaOverpairNoOopBarrelVsValueLeader, the public half: turn, exactly one
 * live opponent, who acts behind and called hero's flop bet; exactly one pair
 * (draws are not read); a straight is possible on the board.
 */
export function omahaOverpairOopTurnBarrelSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'turn') return false;
    const live = liveOpponents(hero, gs);
    if (live.length !== 1) return false;
    const board: Card[] = gs.communityCards ?? [];
    if (!omahaBoardShape(board).straightPossible) return false;
    if (category(hero.cards, board) !== ONE_PAIR) return false;
    if (!omahaCallersOfHeroBet(hero, gs, 'flop').has(live[0].seat)) return false;
    return omahaOpponentActsBehind(hero, gs);
  } catch {
    return false;
  }
}

/**
 * omahaPairedRiverNoThinLeadVsValueLeader, the public half: river, the final
 * board paired (on any street), less than a full house, and a live opponent
 * called hero's own flop or turn bet.
 */
export function omahaPairedRiverThinLeadSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'river') return false;
    const board: Card[] = gs.communityCards ?? [];
    if (!omahaBoardShape(board).paired) return false;
    const cat = category(hero.cards, board);
    if (!(cat > 0) || cat >= FULL_HOUSE) return false;
    const live = new Set(liveOpponents(hero, gs).map((p) => p.seat));
    if (live.size === 0) return false;
    for (const stage of ['flop', 'turn'] as const)
      for (const seat of omahaCallersOfHeroBet(hero, gs, stage)) if (live.has(seat)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * omahaPairedTurnNoBarrelWithoutBoatVsValueLeader, the public half: turn,
 * exactly one live opponent, who acts behind and called hero's flop bet or
 * raise; the turn card pairs the board; hero holds less than a full house (a
 * straight, a flush or weaker).
 */
export function omahaPairedTurnBarrelSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'turn') return false;
    const live = liveOpponents(hero, gs);
    if (live.length !== 1) return false;
    const board: Card[] = gs.communityCards ?? [];
    const turnCard = board[3];
    if (!board.slice(0, 3).some((c) => c.rank === turnCard.rank)) return false;
    const cat = category(hero.cards, board);
    if (!(cat > 0) || cat >= FULL_HOUSE) return false;
    if (!omahaCallersOfHeroBet(hero, gs, 'flop').has(live[0].seat)) return false;
    return omahaOpponentActsBehind(hero, gs);
  } catch {
    return false;
  }
}

/**
 * omahaTurnBetNeedsRiverPlan (lane owner 2026-11-15, hand 59521326): a turn
 * bet that leaves less than half of the resulting pot behind is the stack
 * decision, so the Horse must be able to call the river with it. The public
 * geometry: turn, heads-up, a bet (not an all-in) of `bet`, after which the
 * smaller of the two stacks is under OMAHA_TURN_PLAN_BEHIND_SHARE of the pot
 * the called bet makes. Returns the opponent, the chips left behind and that
 * pot, or null. omahaTurnBetLacksRiverPlan then asks omahaRiverShoveFoldVerdict
 * on every river card.
 */
export const OMAHA_TURN_PLAN_BEHIND_SHARE = 0.5;
export const OMAHA_TURN_PLAN_FOLD_SHARE = 0.35;

export interface OmahaTurnBetGeometry {
  opponent: SeatPlayer;
  /** the effective chips left behind after the bet is called */
  behind: number;
  /** the pot after the bet is called */
  potAfter: number;
}

export function omahaTurnBetShortBehind(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number | undefined
): OmahaTurnBetGeometry | null {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'turn') return null;
    if (!Number.isFinite(bet) || !((bet as number) > 0)) return null;
    const live = liveOpponents(hero, gs);
    if (live.length !== 1) return null;
    const opponent = live[0];
    if (opponent.is_all_in) return null;
    const heroStack = Number.isFinite(hero.stack) ? hero.stack : 0;
    const oppStack = Number.isFinite(opponent.stack) ? opponent.stack : 0;
    const behind = Math.min(heroStack, oppStack) - (bet as number);
    if (!(behind > 0.005)) return null;
    const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
    const potAfter = pot + 2 * (bet as number);
    if (behind >= OMAHA_TURN_PLAN_BEHIND_SHARE * potAfter) return null;
    return { opponent, behind, potAfter };
  } catch {
    return null;
  }
}

/** Every river card hero cannot see (the deck minus hole, board and known dead cards). */
export function omahaUnseenRiverCards(hero: SeatPlayer, board: Card[]): Card[] {
  const key = (c: Card) => `${c.rank}:${c.suit}`;
  const removed = new Set([...hero.cards, ...board, ...(hero.knownDeadCards ?? [])].map(key));
  const out: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) out.push(card);
    }
  return out;
}

/**
 * What the river look-ahead is told beyond the public state: the option
 * state of the Horse's river fold rules and the two opponent-memory values
 * the big-bet tier reads. Every field defaults to the widest form (every rule
 * on, the bettor not an over-bluffer), which is what the receipt validator
 * replays.
 */
export interface OmahaRiverShoveEnv {
  /** ploPairedBoardFold is on (default true). */
  pairedBoardFold?: boolean;
  /** omahaPairedBoardFoldRespectsPrice is on (default false). */
  respectPrice?: boolean;
  /** v86MultiStreetUnblocked, read by the paired-board fold (default false: no exemption). */
  v86MultiStreetUnblocked?: boolean;
  /** v81OmahaBigBetCalls is on (default true). */
  v81?: boolean;
  /** v86PloOverhaul and v40Omaha are on (default true). */
  v86?: boolean;
  /** The V81 river set / trips cell is admitted (omahaRiverNutRaiseOnly on; default true). */
  riverSetCell?: boolean;
  /** isPostflopManiac(read of the bettor): a measured postflop over-bluffer (default false). */
  bettorOverBluffs?: boolean;
  /** bettorOverBluffs, or a measured maniac raise width of 0.62 or more (default false). */
  bettorManiac?: boolean;
}

export type OmahaRiverShoveFold = 'paired_board' | 'big_bet_v81' | 'big_bet_v86';

/**
 * THE ONE QUESTION of the river look-ahead, and its single seam: after the
 * turn bet of `bet` is called and the Horse checks this river, would the
 * Horse's own rules fold its hand to an all-in for what is left? It consults
 * the rules the real river decision runs, in their order: the paired-board
 * fold (ploPairedBoardMustFold, with its price exception when that option is
 * on), then the big-bet tier (v81Cell and v86OmahaUnderboatOrDominatedFold,
 * the cells omahaBigBetCallFold asks for a river call with no chips in on the
 * street). Returns the rule that folds, or null.
 *
 * It does not ask the reference decision's own equity fold (a Monte Carlo
 * estimate against a range): that is not a rule, costs a full decision per
 * river and cannot be replayed without the brain. omahaFacingBetEv is to
 * replace this function when it exists.
 *
 * Pure: hero's cards, the public state, the bet, the river card and `env`.
 */
export function omahaRiverShoveFoldVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number,
  geo: OmahaTurnBetGeometry,
  riverCard: Card,
  env: OmahaRiverShoveEnv = {}
): OmahaRiverShoveFold | null {
  const board: Card[] = [...(gs.communityCards ?? []), riverCard];
  const shove = geo.behind;
  const pot = geo.potAfter + shove;
  const heroAfter: SeatPlayer = {
    ...hero,
    stack: Math.max(0, hero.stack - bet),
    bet: 0,
    totalInvested: (Number.isFinite(hero.totalInvested) ? (hero.totalInvested ?? 0) : 0) + bet,
  };
  const oppStack = Math.max(0, geo.opponent.stack - bet - shove);
  const oppAfter: SeatPlayer = {
    ...geo.opponent,
    stack: oppStack,
    bet: shove,
    totalInvested:
      (Number.isFinite(geo.opponent.totalInvested) ? (geo.opponent.totalInvested ?? 0) : 0) +
      bet +
      shove,
    is_all_in: oppStack <= 0.005,
  };
  const players = (gs.players ?? []).map((p) =>
    p.seat === hero.seat ? heroAfter : p.seat === oppAfter.seat ? oppAfter : p
  );
  // 1. The paired-board fold, with its price exception.
  if (
    env.pairedBoardFold !== false &&
    ploPairedBoardMustFold({
      gameVariant: gs.gameVariant,
      hiLo: false,
      multiBoard: false,
      board,
      hero: heroAfter,
      players,
      currentBet: shove,
      toCall: shove,
      pot,
      v86MultiStreetUnblocked: env.v86MultiStreetUnblocked === true,
    }) &&
    !(
      env.respectPrice === true &&
      ploPairedBoardFoldRespectsPrice({
        gameVariant: gs.gameVariant,
        board,
        hero: heroAfter,
        players,
        currentBet: shove,
        toCall: shove,
        pot,
      })
    )
  )
    return 'paired_board';
  // 2. The big-bet tier, as omahaBigBetCallFold asks it for this river call.
  const bb = gs.bigBlind > 0 ? gs.bigBlind : 1;
  const callable = Math.min(shove, heroAfter.stack);
  const callPrice = callable / (pot + callable);
  const overBluffs = env.bettorOverBluffs === true;
  if (
    env.v81 !== false &&
    v81Cell({
      variant: String(gs.gameVariant ?? ''),
      street: 'river',
      hole: hero.cards ?? [],
      board,
      potFrac: shove / geo.potAfter,
      effectiveBB: Math.min(heroAfter.stack, oppAfter.stack + shove) / bb,
      tournament: false,
      headsUpTable:
        (gs.dealtSeatIds === undefined
          ? gs.players.length
          : horsePolicyDealtPlayers(gs.players, hero.seat, gs.dealtSeatIds).length) <= 2,
      bountyEvent: false,
      hiLo: false,
      multiBoard: false,
      bombPot: gs.bombPot === true,
      heroHasStreetChips: false,
      bettorOverBluffs: overBluffs,
      callPrice,
      riverSetCell: env.riverSetCell !== false && heroAfter.stack > shove + 0.005,
    }) !== null
  )
    return 'big_bet_v81';
  if (env.v86 !== false) {
    const t = 0;
    const riverGs = {
      ...gs,
      players,
      communityCards: board,
      stage: 'river',
      pot,
      currentBet: shove,
      toCall: shove,
      minRaiseTo: null,
      maxRaiseTo: null,
      legalActions: ['fold', 'call'],
      actionHistory: [
        ...(gs.actionHistory ?? []),
        {
          stage: 'turn',
          seat: hero.seat,
          userId: hero.user_id,
          action: 'bet',
          amount: bet,
          timestamp: t,
        },
        {
          stage: 'turn',
          seat: oppAfter.seat,
          userId: oppAfter.user_id,
          action: 'call',
          amount: bet,
          timestamp: t,
        },
        {
          stage: 'river',
          seat: hero.seat,
          userId: hero.user_id,
          action: 'check',
          amount: 0,
          timestamp: t,
        },
        {
          stage: 'river',
          seat: oppAfter.seat,
          userId: oppAfter.user_id,
          action: oppAfter.is_all_in ? 'all_in' : 'bet',
          amount: shove,
          isFullRaise: true,
          timestamp: t,
        },
      ],
    } as unknown as HorseGameStateV2;
    const v86 = v86OmahaUnderboatOrDominatedFold(
      { action: 'call', amount: shove, thinkTime: 0 },
      heroAfter,
      riverGs,
      true,
      overBluffs || env.bettorManiac === true
    );
    if (v86.reason !== null) return 'big_bet_v86';
  }
  return null;
}

/**
 * True when the turn bet of `bet` leaves under half the resulting pot behind
 * (omahaTurnBetShortBehind) and omahaRiverShoveFoldVerdict folds on more than
 * OMAHA_TURN_PLAN_FOLD_SHARE of the unseen river cards. Exact enumeration of
 * at most 47 cards: no Monte Carlo, no random number.
 *
 * In this geometry the all-in is under half the pot, below every big-bet
 * cell's smallest wager (0.58 pot), so today the verdict does not depend on
 * the two opponent-memory values in `env` and the receipt validator's replay
 * (the widest `env`) is exact up to the option state.
 */
export function omahaTurnBetLacksRiverPlan(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  bet: number | undefined,
  env: OmahaRiverShoveEnv = {}
): boolean {
  try {
    const geo = omahaTurnBetShortBehind(hero, gs, bet);
    if (geo === null) return false;
    const rivers = omahaUnseenRiverCards(hero, gs.communityCards ?? []);
    if (rivers.length === 0) return false;
    let folds = 0;
    for (const card of rivers)
      if (omahaRiverShoveFoldVerdict(hero, gs, bet as number, geo, card, env) !== null) folds++;
    return folds / rivers.length > OMAHA_TURN_PLAN_FOLD_SHARE;
  } catch {
    return false;
  }
}

/**
 * omahaOopTurnCheckAfterFlopCall (owner 2026-11-15 12:09, hands 59517323,
 * 59521326 and 59526261: "THIS SHOULD BE A CHECK CALL 100% OF THE TIME WHEN
 * THE OPPONENT IS ONE OUT OF POSITION, AND TWO THEY OPPONENT ALREADY CALLED A
 * FLOP BET. CHECK CALL WHEN DRAWING TO THE NUTS, CHECK FOLD WHEN YOU CAN'T
 * IMPROVE WITH ANY TURN CARDS", meaning the Horse is out of position and the
 * flop bet was called). No opponent read. Two halves:
 *
 * THE CHECK (omahaOopTurnCheckAfterFlopCallSpot): turn, heads-up (the
 * opponent acts behind) or multiway (the Horse first to act), every live
 * opponent called the Horse's flop bet or raise, and the
 * Horse does not hold a nut-class hand for the street (omahaNutClassNow): a
 * bet becomes a check. Nut-class hands keep betting.
 *
 * FACING THE TURN BET (omahaOopTurnFacingBetVerdict): turn, the Horse
 * checked first and an opponent bet (multiway: every live opponent called
 * the Horse's flop bet or raise), chips went in from both on the flop
 * (the Horse's bet or raise was called, or the Horse called his), not nut
 * class. With `outs` the unseen river cards that make the nut flush or nut
 * straight on the board that card makes, or a full house or better
 * (omahaTurnRedrawShare, Omaha's two-card rule), and `price` the call over
 * the pot after it:
 *  - 'call_nut_draw': outs >= OMAHA_OOP_TURN_MIN_NUT_OUTS (4) and
 *    price <= outs / unseen + OMAHA_OOP_TURN_SHOWDOWN_CREDIT (0.15, a stated
 *    allowance for the made hand's showdown equity, not a measurement): the
 *    Horse calls, whatever the decision was;
 *  - 'fold_no_outs': no such river card, the made hand is one pair or less
 *    or a possible straight or flush already beats it (omahaBeatenByBoard),
 *    and price >= OMAHA_OOP_TURN_TOKEN_PRICE (0.15): the Horse folds;
 *  - 'no_raise': everything between: today's call or fold stands, and a
 *    raise becomes a call (the Horse never check-raises here).
 */
export const OMAHA_OOP_TURN_MIN_NUT_OUTS = 4;
export const OMAHA_OOP_TURN_SHOWDOWN_CREDIT = 0.15;
export const OMAHA_OOP_TURN_TOKEN_PRICE = 0.15;

/** On the flop, chips went in from both: hero's bet or raise was called by `opp`, or hero called his. */
function flopWagerCalled(hero: SeatPlayer, gs: HorseGameStateV2, opp: SeatPlayer): boolean {
  let lastAggressor: number | null = null;
  let callers = new Set<number>();
  for (const a of gs.actionHistory ?? []) {
    if (String(a.stage) !== 'flop') continue;
    const act = String(a.action);
    if (act === 'bet' || act === 'raise' || act === 'all_in') {
      if (act === 'all_in' && lastAggressor !== null && a.isFullRaise !== true) {
        callers.add(a.seat);
        continue;
      }
      lastAggressor = a.seat;
      callers = new Set<number>();
    } else if (act === 'call' && a.seat !== lastAggressor) callers.add(a.seat);
  }
  return (
    (lastAggressor === hero.seat && callers.has(opp.seat)) ||
    (lastAggressor === opp.seat && callers.has(hero.seat))
  );
}

/**
 * Multiway (audit 2026-11-15, the lane owner's reading of the 12:09 ruling):
 * true when every live opponent acts after hero on this street and none has
 * acted on it yet, so the Horse is first to act.
 */
function heroActsFirst(hero: SeatPlayer, gs: HorseGameStateV2, live: SeatPlayer[]): boolean {
  const street = String(gs.stage ?? '');
  const history = Array.isArray(gs.actionHistory) ? gs.actionHistory : [];
  const dealer = Number.isFinite(gs.dealerSeat) ? (gs.dealerSeat as number) : null;
  if (dealer === null) return false;
  const span = Math.max(hero.seat, dealer, ...live.map((p) => p.seat)) + 1;
  const order = (seat: number) => (seat - dealer - 1 + 2 * span) % span;
  const actedBeforeHero = history.some(
    (a) => String(a.stage) === street && live.some((p) => p.seat === a.seat)
  );
  return !actedBeforeHero && live.every((p) => order(p.seat) > order(hero.seat));
}

/** The check half: see above. Heads-up, or multiway with the Horse first to
 *  act and every live opponent a caller of its flop bet or raise. */
export function omahaOopTurnCheckAfterFlopCallSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): boolean {
  try {
    if (omahaOopCheckStreet(hero, gs) !== 'turn') return false;
    const live = liveOpponents(hero, gs);
    if (live.length === 0) return false;
    const callers = omahaCallersOfHeroBet(hero, gs, 'flop');
    if (!live.every((p) => callers.has(p.seat))) return false;
    if (live.length === 1) {
      if (!omahaOpponentActsBehind(hero, gs)) return false;
    } else if (!heroActsFirst(hero, gs, live)) return false;
    return !omahaNutClassNow(hero, gs);
  } catch {
    return false;
  }
}

export type OmahaOopTurnFacingBet = 'call_nut_draw' | 'fold_no_outs' | 'no_raise';

/** The facing-bet half: see above. Null outside the spot. */
export function omahaOopTurnFacingBetVerdict(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaOopTurnFacingBet | null {
  try {
    if (scopeStreet(hero, gs, true) !== 'turn') return null;
    const live = liveOpponents(hero, gs);
    if (live.length === 0) return null;
    // The Horse checked this street first, has no chips in on it, and an
    // opponent bet. Multiway (audit 2026-11-15): every live opponent called
    // the Horse's flop bet or raise.
    if ((Number.isFinite(hero.bet) ? hero.bet : 0) > 0.005) return null;
    const turn = (gs.actionHistory ?? []).filter((a) => String(a.stage) === 'turn');
    const first = turn.find((a) => a.seat === hero.seat || live.some((p) => p.seat === a.seat));
    if (!first || first.seat !== hero.seat || String(first.action) !== 'check') return null;
    if (
      !turn.some(
        (a) =>
          live.some((p) => p.seat === a.seat) &&
          ['bet', 'raise', 'all_in'].includes(String(a.action))
      )
    )
      return null;
    if (live.length === 1) {
      if (!flopWagerCalled(hero, gs, live[0])) return null;
    } else {
      const callers = omahaCallersOfHeroBet(hero, gs, 'flop');
      if (!live.every((p) => callers.has(p.seat))) return null;
    }
    if (omahaNutClassNow(hero, gs)) return null;
    const board: Card[] = gs.communityCards ?? [];
    const unseen = omahaUnseenRiverCards(hero, board).length;
    if (unseen === 0) return null;
    const share = omahaTurnRedrawShare(hero.cards, board, hero.knownDeadCards ?? []);
    const outs = Math.round(share * unseen);
    const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
    // what is owed, derived when the state carries no toCall (the league)
    const owed = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
    const call = Math.min(owed, stack);
    if (!(call > 0.005)) return null;
    const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
    const livePot = Math.max(0, pot - (owed - call));
    const price = call / (livePot + call);
    if (
      outs >= OMAHA_OOP_TURN_MIN_NUT_OUTS &&
      price <= share + OMAHA_OOP_TURN_SHOWDOWN_CREDIT + 1e-9
    )
      return 'call_nut_draw';
    if (
      outs === 0 &&
      price >= OMAHA_OOP_TURN_TOKEN_PRICE &&
      (category(hero.cards, board) <= ONE_PAIR || omahaBeatenByBoard(hero.cards, board))
    )
      return 'fold_no_outs';
    return 'no_raise';
  } catch {
    return null;
  }
}

/**
 * omahaBareOverpairOopFlopCheck, THE CONTINUATION (2026-11-15; the same
 * option, no option of its own): the flop was checked out of position with
 * the bare pair and the one opponent bet. Owner 11:39: no blanket rule, the
 * call or fold is "hand and player dependant and pot size to value
 * dependant"; owner 12:09: no check-raise without the nuts. So, heads-up:
 * never a raise; a call when the expected value of the call clears its
 * margin, else a fold.
 *
 * The exact-hand facing-bet model (HorseOmahaFacingBetEv) counts holdings on a
 * turn or river board only: it has no flop form (two cards to come, and its
 * value and bluff shares are turn and river measurements). The flop therefore
 * uses the engine's own equity helper, simulateEquity, on the Horse's exact
 * cards against the bettor's range:
 *
 *  HAND    Equity against the tiered Omaha aggressor ranges the engine
 *          already samples for a bettor (omahaAggressorTier /
 *          omahaTierRequirement: tier 1, one pair or better or a strong draw
 *          with a share of bluffs; tier 2, two pair or better or a pair with
 *          a strong draw; tier 3, the same with two pair under the draw), and
 *          against any hand (eqAny).
 *  SIZE    The engine puts a bet under 70 percent of the pot on tier 1 and a
 *          larger one on tier 2, a step. Here the range strengthens with the
 *          bet's share of the pot without the step: eqRange is tier 1 at a
 *          third of the pot or less, tier 2 at 70 percent or more, and the
 *          straight line between them in between (sizeWeight). eqStrong is
 *          the same one tier up. The two ends are the engine's; the line
 *          between them is stated, not measured.
 *  PLAYER  The measured read moves the range, never a presumed one: `lean`
 *          in [-1, 1] from the facing-bet model's own read multiplier
 *          (omahaEvBluffShare: his bet-when-checked-to rate over the Horse
 *          mean, a postflop over-bettor at least 1.3, bounds 0.7 to 1.5); a
 *          measured value leader is the full value lean. lean > 0 mixes
 *          eqRange toward eqAny by lean x OMAHA_BARE_OVERPAIR_CONT_AIR_SHARE
 *          (stated, not measured); lean < 0 mixes it toward eqStrong by
 *          -lean. Unknown: eqRange.
 *  PRICE   EV(call) = R x equity x the pot the call can win (less the
 *          marginal rake) - (1 - R x equity) x the call, called when it
 *          exceeds the facing-bet model's one margin (2 percent of the final
 *          pot). R is the realisation discount for being out of position with
 *          two streets to come: OMAHA_BARE_OVERPAIR_CONT_REALIZATION (0.75,
 *          the engine's flop out-of-position realizationFactor). It is a
 *          stated constant, NOT MEASURED. A call that leaves a trivial amount
 *          behind is final and takes no discount.
 *
 * Deterministic: the three samples are drawn from the equity helper on a
 * stream seeded by the cards and the seats, and the brain's random stream is
 * put back exactly as it was. Under load the equity governor may shrink the
 * sample.
 *
 * Scope: PLO4 / PLO5 cash, pot limit, one board, high only, the flop, exactly
 * one live opponent, the Horse checked first with no chips in on the street
 * and he bet, the hand and flop of the check rule, and the call is not for
 * the whole stack. Multiway, a raise war and the whole-stack call keep
 * today's decision.
 */
export const OMAHA_BARE_OVERPAIR_CONT_REALIZATION = 0.75;
/** At the full aggressive lean, this share of his flop bets is modelled as any hand. Stated, not measured. */
export const OMAHA_BARE_OVERPAIR_CONT_AIR_SHARE = 0.5;
/** Iterations asked of the equity helper for each of the three ranges. */
export const OMAHA_BARE_OVERPAIR_CONT_SAMPLES = 400;
/** The bet's share of the pot at or under which the bettor's range is tier 1, and at or over which it is one tier up (the engine's own 0.7). */
export const OMAHA_BARE_OVERPAIR_CONT_SMALL_BET = 1 / 3;
export const OMAHA_BARE_OVERPAIR_CONT_BIG_BET = 0.7;
/** The neutral share the read multiplier is taken on (omahaEvBluffShare's bounds do not bind on it). */
const CONT_LEAN_ANCHOR = 0.3;

export interface OmahaBareOverpairContSpot {
  opponent: SeatPlayer;
  /** chips the call puts in, and the pot it can win (his bet included) */
  call: number;
  pot: number;
  /** his bet as a share of the pot before it */
  potFrac: number;
  /** call / (pot + call) */
  price: number;
  /** the call leaves a trivial amount behind: no later decision */
  final: boolean;
}

/** The public spot of the continuation (with the Horse's own cards), or null. */
export function omahaBareOverpairFlopFacingBetSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): OmahaBareOverpairContSpot | null {
  try {
    if (scopeStreet(hero, gs, true) !== 'flop') return null;
    if (gs.bombPot === true) return null;
    const live = liveOpponents(hero, gs);
    if (live.length !== 1) return null;
    const opponent = live[0];
    if ((Number.isFinite(hero.bet) ? hero.bet : 0) > 0.005) return null;
    const flop = (gs.actionHistory ?? []).filter((a) => String(a.stage) === 'flop');
    const mine = flop.filter((a) => a.seat === hero.seat);
    const his = flop.filter((a) => a.seat === opponent.seat);
    // The Horse checked first, once; he then bet, once (no raise war).
    if (mine.length !== 1 || String(mine[0].action) !== 'check') return null;
    if (his.length !== 1 || !['bet', 'all_in'].includes(String(his[0].action))) return null;
    if (flop.indexOf(mine[0]) > flop.indexOf(his[0])) return null;
    if (!bareOnePairOnFlop(hero.cards, gs.communityCards ?? [])) return null;
    const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
    const owed = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
    // The whole-stack call is an all-in, a wager action: today's decision.
    if (!(owed > 0.005) || stack <= owed + 0.005) return null;
    const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
    const before = pot - owed;
    if (!(before > 0.005)) return null;
    const call = Math.round(owed * 100) / 100;
    return {
      opponent,
      call,
      pot,
      potFrac: owed / before,
      price: call / (pot + call),
      final: stack - call <= OMAHA_FACING_BET_EV_TRIVIAL_BEHIND * (pot + call),
    };
  } catch {
    return null;
  }
}

/** What the caller knows of the bettor from public play. Null or unmeasured: no lean. */
export interface OmahaBareOverpairContRead {
  /** HorseMind.omahaReadConditionalOf(...).measured */
  measured: boolean;
  /** measured value-heavy after the flop */
  valueLeader: boolean;
  /** his own postflop betting is measured high (the read-conditional postflopAggressor, or a postflop maniac) */
  postflopAggressor: boolean;
  /** his bet-when-checked-to posterior mean over the Horse mean; null when not measured */
  betCheckedToRatio: number | null;
}

/** The read as a lean in [-1, 1]: -1 the full value lean, 0 unknown, 1 the full aggressive lean. */
export function omahaBareOverpairContLean(read: OmahaBareOverpairContRead | null): number {
  if (!read || read.measured !== true) return 0;
  let k =
    omahaEvBluffShare(CONT_LEAN_ANCHOR, {
      measured: true,
      betCheckedToRatio: read.betCheckedToRatio,
      postflopManiac: read.postflopAggressor === true,
      sizeShown: null,
    }) / CONT_LEAN_ANCHOR;
  if (read.valueLeader === true) k = Math.min(k, 0.7);
  const lean = k >= 1 ? (k - 1) / 0.5 : (k - 1) / 0.3;
  return Math.max(-1, Math.min(1, lean));
}

export interface OmahaBareOverpairContVerdict {
  call: boolean;
  /** EV of the call in chips, and the margin it had to exceed */
  ev: number;
  margin: number;
  /** the equity used, and its three parts */
  equity: number;
  eqRange: number;
  eqAny: number;
  eqStrong: number;
  lean: number;
  /** 0 at a third of the pot or less (tier 1), 1 at 70 percent or more (tier 2) */
  sizeWeight: number;
  realization: number;
  price: number;
}

/** A read that puts the engine's Omaha sampler on aggressor tier `tier` (1..3). */
function tierRead(tier: number): OppPostflopRead {
  const read = tierReadOf(tier);
  if (omahaAggressorTier(read) !== tier) throw new Error('omaha aggressor tier moved');
  return read;
}
function tierReadOf(tier: number): OppPostflopRead {
  return {
    aggrW: 1,
    checked: 0,
    streets: tier >= 3 ? 2 : 1,
    lastFrac: tier >= 2 ? 1 : 0.5,
    lastStage: 'flop',
  };
}

function contSeed(hero: SeatPlayer, board: Card[], opponent: SeatPlayer): number {
  let h = 0x811c9dc5;
  const mix = (t: string) => {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const c of [...hero.cards, ...board]) mix(`${c.rank}${c.suit}`);
  mix(`|${hero.seat}|${opponent.seat}`);
  return h >>> 0 || 1;
}

/** The decision of the continuation: call when EV(call) exceeds the margin. Null when it cannot be computed. */
export function omahaBareOverpairFlopFacingBetVerdict(
  spot: OmahaBareOverpairContSpot,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  read: OmahaBareOverpairContRead | null,
  ctx: { rake?: number; realization?: number } = {}
): OmahaBareOverpairContVerdict | null {
  const saved = saveFastRandom();
  try {
    const vi = variantInfo(String(gs.gameVariant ?? '').toLowerCase());
    const board: Card[] = gs.communityCards ?? [];
    const dead = hero.knownDeadCards ?? [];
    const seed = contSeed(hero, board, spot.opponent);
    const sizeWeight = Math.max(
      0,
      Math.min(
        1,
        (spot.potFrac - OMAHA_BARE_OVERPAIR_CONT_SMALL_BET) /
          (OMAHA_BARE_OVERPAIR_CONT_BIG_BET - OMAHA_BARE_OVERPAIR_CONT_SMALL_BET)
      )
    );
    const lean = omahaBareOverpairContLean(read);
    const cache = new Map<number, number>();
    /** Equity against aggressor tier 1..3, or any hand (0); the same stream for each. */
    const equityVs = (tier: number): number => {
      const hit = cache.get(tier);
      if (hit !== undefined) return hit;
      seedFastRandom(seed);
      const e = simulateEquity(
        hero.cards,
        board,
        1,
        vi,
        OMAHA_BARE_OVERPAIR_CONT_SAMPLES,
        undefined,
        false,
        undefined,
        tier > 0 ? [tierRead(tier)] : undefined,
        undefined,
        dead
      );
      cache.set(tier, e);
      return e;
    };
    // A stronger tier is never a weaker range, any hand never a stronger one.
    const e1 = equityVs(1);
    const e2 = sizeWeight > 0 || lean < 0 ? Math.min(e1, equityVs(2)) : e1;
    const e3 = lean < 0 && sizeWeight > 0 ? Math.min(e2, equityVs(3)) : e2;
    const eqRange = e1 + sizeWeight * (e2 - e1);
    const eqStrong = lean < 0 ? e2 + sizeWeight * (e3 - e2) : eqRange;
    const eqAny = lean > 0 ? Math.max(e1, equityVs(0)) : eqRange;
    if (![eqRange, eqAny, eqStrong].every((e) => Number.isFinite(e) && e >= 0 && e <= 1))
      return null;
    const equity =
      lean > 0
        ? eqRange + lean * OMAHA_BARE_OVERPAIR_CONT_AIR_SHARE * (eqAny - eqRange)
        : eqRange + -lean * (eqStrong - eqRange);
    const realization = spot.final
      ? 1
      : Math.max(
          0.5,
          Math.min(
            1,
            Number.isFinite(ctx.realization)
              ? (ctx.realization as number)
              : OMAHA_BARE_OVERPAIR_CONT_REALIZATION
          )
        );
    const rake = Math.max(0, Math.min(0.2, Number.isFinite(ctx.rake) ? (ctx.rake as number) : 0));
    const p = equity * realization;
    const ev = p * spot.pot * (1 - rake) - (1 - p) * spot.call;
    const margin = OMAHA_FACING_BET_EV_MARGIN * (spot.pot + spot.call);
    return {
      call: ev > margin,
      ev,
      margin,
      equity,
      eqRange,
      eqAny,
      eqStrong,
      lean,
      sizeWeight,
      realization,
      price: spot.price,
    };
  } catch {
    return null;
  } finally {
    restoreFastRandom(saved);
  }
}

/**
 * Receipt validation (no options, no opponent memory in the request): a fold
 * or a raise that became a call is admitted only in the continuation's spot
 * and only for the exact chips of the call.
 */
export function omahaBareOverpairContAdmitsCall(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  const spot = omahaBareOverpairFlopFacingBetSpot(hero, gs);
  return spot !== null && typeof amount === 'number' && Math.abs(spot.call - amount) <= 0.005;
}

/** Any of the spots: what the worker receipt validator admits as a bet turned into a check. */
export function omahaOopCheckSpot(hero: SeatPlayer, gs: HorseGameStateV2, bet?: number): boolean {
  return (
    // the widest form of the river plan test (no price exception, no fold exemption)
    omahaTurnBetLacksRiverPlan(hero, gs, bet) ||
    omahaOopTurnCheckAfterFlopCallSpot(hero, gs) ||
    omahaBareOverpairOopFlopSpot(hero, gs) ||
    omahaOverpairOopTurnBarrelSpot(hero, gs) ||
    omahaPairedTurnBarrelSpot(hero, gs) ||
    omahaPairedRiverThinLeadSpot(hero, gs)
  );
}
