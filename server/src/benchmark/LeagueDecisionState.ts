/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LEAGUE PLAYS PRODUCTION'S BRAIN (2026-11-15)
 * ═══════════════════════════════════════════════════════════════════════════
 * The live table hands HorseLogic.decide one canonical decision state, built
 * in ServerTableEngineTurns.scheduleHorseAction from the HandController's
 * authoritative action state (getAuthoritativeActionState, then
 * applyTableCommitmentCap and applyAllInOrFoldActionState). The duplicate
 * league (HorseLeague.playHand) used to hand the brain a reduced legacy state:
 * no stateSchemaVersion, no legal menu, no toCall, no wager bounds, no betting
 * structure, totalInvested 0 for every seat and every opponent's hole cards.
 * Every rule that guards on those fields returned unchanged in EVERY league
 * arm (audit AUDIT-SCHEMA-GUARD.md, eval3 2026-11-15): the river nuts raise,
 * the full-pot near-pot wager, the Omaha current-nuts raise, the checked-to
 * turn boat / river value bet, the heads-up cash matched commitment, the large
 * river boat call and the final legality mapping. The league measured a Horse
 * that production never fields.
 *
 * This module builds the same state from the league's own authoritative hand:
 * the same keys production sends, valued from the league's table. The legal
 * menu is the controller's contract (fold always; check or call; bet or raise;
 * all_in) priced by the league's own validator, calculateBettingState and
 * validateAction, exactly the functions playHand checks every wager with.
 *
 * Where the league's table differs from a live table the value says so, never
 * a guess (each is pinned by ALeagueStateHasProductionsFields.law.test.ts):
 *  - Raise rights: the league queues only seats that may act (a short all-in
 *    does not requeue a seat that already acted), so every seat it puts on
 *    the clock may reopen. HandController.canReopenBetting is therefore true
 *    for every league decision.
 *  - all_in: the league executes an all_in literally (no pot-limit clamp), so
 *    it is offered only where the literal shove is legal (validateAction
 *    'all_in'). The live controller also offers a deep pot-limit shove and
 *    clamps it to the pot; the brain reaches that size through 'raise' to
 *    maxRaiseTo instead.
 *  - Rake: the league settles every pot rake free, so rakeConfig is a zero
 *    rate. Call pricing reads the league's real deductions (none), not the
 *    rakeDrag estimate a state without rakeConfig falls back to.
 *  - No commitment cap, no all-in-or-fold, no VPIP floor, no straddle, no
 *    bomb pot, one board, no bad-beat jackpot: the values a live table with
 *    none of them sends.
 *  - Fixed limit: the league deals no fixed-limit street unit or wager cap
 *    (UNMEASURABLE_MATCHUPS refuses every fixed-limit card), so a fixed-limit
 *    variant gets no menu here (null) and keeps the legacy state.
 */
import type {
  ActionRecord,
  ActionType,
  AuthoritativeActionState,
  Card,
  HandStage,
  RakeConfig,
  SeatPlayer,
} from '../types.js';
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';
import {
  calculateBettingState,
  calculateContestablePot,
  calculatePots,
  validateAction,
} from '../engine/PokerEngine.js';
import { variantInfo } from '../engine/HorseEval.js';
import { horseVariantRulesFor } from '../engine/VariantRules.js';
import { publicMemoryDomainFromRules } from '../engine/HorsePublicMemoryDomain.js';

/** The menu production composes (AuthoritativeActionState, then the table's
 *  commitment cap, null when the table has none). */
export type LeagueActionState = AuthoritativeActionState & { commitmentCapRemaining: null };

/** The league settles every pot without rake (HorseLeague.playHand settlement). */
export const LEAGUE_RAKE_CONFIG: Readonly<RakeConfig> = Object.freeze({
  percent: 0,
  cap: 0,
  noFlopNoDrop: true,
});

/** Live tables without a configured window send 10 (ServerTableEngineBase.horseVpipDecisionInputs). */
const VPIP_WINDOW_HANDS_DEFAULT = 10;

export interface LeagueMenuSpot {
  player: Pick<SeatPlayer, 'seat' | 'stack' | 'bet' | 'is_folded' | 'is_all_in' | 'is_sitting_out'>;
  gameVariant: string;
  pot: number;
  currentBet: number;
  lastRaise: number;
  bigBlind: number;
  /** Tournament chips (or Diamonds) are whole units; cash chips are cents. */
  wholeChip: boolean;
}

/**
 * The league's legal menu for the seat on the clock, in the shape of
 * HandController.getAuthoritativeActionState composed with
 * applyTableCommitmentCap (no cap) and applyAllInOrFoldActionState (off).
 * Null for a fixed-limit variant: the league has no fixed-limit menu.
 */
export function leagueActionState(spot: LeagueMenuSpot): LeagueActionState | null {
  const vi = variantInfo(spot.gameVariant);
  if (vi.isFixedLimit) return null;
  const p = spot.player;
  // The same betting state playHand validates every bet and raise against.
  const bs = calculateBettingState(
    spot.pot,
    spot.currentBet,
    p.bet,
    spot.bigBlind,
    spot.lastRaise,
    vi.isPotLimit
  );
  const canAct = !p.is_folded && !p.is_all_in && !p.is_sitting_out && p.stack > 0;
  let legalActions: ActionType[] = [];
  if (canAct) {
    // HandController.getAvailableActions, with the league's raise rights
    // (every seat it queues may reopen) and its literal all_in.
    legalActions = ['fold'];
    const toCall = spot.currentBet - p.bet;
    if (toCall === 0) {
      legalActions.push('check');
      if (p.stack > 0) legalActions.push(spot.currentBet === 0 ? 'bet' : 'raise');
    } else {
      legalActions.push('call');
      if (p.stack > toCall) legalActions.push('raise');
    }
    if (p.stack > 0 && validateAction('all_in', undefined, p.stack, bs).valid) {
      legalActions.push('all_in');
    }
  }
  const hasRaise = legalActions.includes('raise');
  const hasSizedWager = hasRaise || legalActions.includes('bet');
  const cents = (value: number): number => Math.round(value * 100) / 100;
  const snapMin = (value: number): number =>
    spot.wholeChip ? Math.ceil(value - 1e-6) : cents(value);
  const snapMax = (value: number): number =>
    spot.wholeChip ? Math.floor(value + 1e-6) : cents(value);
  const snapCall = (value: number): number => (spot.wholeChip ? Math.round(value) : cents(value));
  let minRaiseTo: number | null = null;
  let maxRaiseTo: number | null = null;
  if (hasSizedWager) {
    minRaiseTo = snapMin(hasRaise ? spot.currentBet + bs.minRaise : bs.minRaise);
    const stackBound = hasRaise ? p.bet + p.stack : p.stack;
    const structureBound =
      bs.maxRaise === undefined ? Infinity : hasRaise ? spot.currentBet + bs.maxRaise : bs.maxRaise;
    maxRaiseTo = snapMax(Math.min(stackBound, structureBound));
    // A stack below the ordinary minimum acts through all_in only.
    if (maxRaiseTo < minRaiseTo - 0.005) {
      legalActions = legalActions.filter((action) => action !== (hasRaise ? 'raise' : 'bet'));
      minRaiseTo = null;
      maxRaiseTo = null;
    }
  }
  return {
    schemaVersion: 1,
    heroSeat: p.seat,
    currentPlayerSeat: p.seat,
    canAct,
    legalActions,
    toCall: snapCall(Math.max(0, bs.toCall)),
    minRaiseTo,
    maxRaiseTo,
    structure: bs.structure ?? 'no_limit',
    fixedBetSize: null,
    wagersCapped: bs.wagersCapped === true,
    commitmentCapRemaining: null,
  };
}

/** One league seat as playHand holds it. */
export interface LeagueDecisionSeat {
  player: SeatPlayer;
  /** Chips this seat has put into the pot this hand (blinds, antes, wagers). */
  contributed: number;
  /** The part of `contributed` that is shared dead money (a big-blind ante). */
  dead: number;
}

/** The league table at the moment a Horse is on the clock. */
export interface LeagueDecisionTable {
  seats: readonly LeagueDecisionSeat[];
  heroIdx: number;
  stage: HandStage;
  board: readonly Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  lastRaise: number;
  gameVariant: string;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  /** The seats the blinds were posted from (HandController.getBlindSeatsSnapshot). */
  blindSeats: { smallBlind: number | null; bigBlind: number };
  history: readonly ActionRecord[];
  gameMode: 'cash' | 'tournament';
  format: 'cash' | 'mtt' | 'sng' | 'spin' | 'hu_sng';
  ante: number;
  bigBlindAnte: boolean;
  tournament?: HorseGameStateV2['tournament'];
}

/**
 * The decision input production builds for this node (ServerTableEngineTurns
 * scheduleHorseAction): the hero with its own cards, and a state whose seats
 * are public only. Null when the league has no menu for the variant (fixed
 * limit); the caller keeps its legacy state there.
 */
export function leagueHorseDecisionInput(
  table: LeagueDecisionTable
): { player: SeatPlayer; gameState: HorseGameStateV2 } | null {
  const heroSeat = table.seats[table.heroIdx];
  const tournament = table.gameMode === 'tournament';
  const menu = leagueActionState({
    player: heroSeat.player,
    gameVariant: table.gameVariant,
    pot: table.pot,
    currentBet: table.currentBet,
    lastRaise: table.lastRaise,
    bigBlind: table.bigBlind,
    wholeChip: tournament,
  });
  if (!menu) return null;
  const cents = (value: number): number => Math.round(value * 100) / 100;
  // HIDDEN-INFORMATION FIREWALL, as production: every seat in the shared state
  // is public only, and its money is what the league actually holds for it.
  const publicPlayers: SeatPlayer[] = table.seats.map((seat) => {
    const { knownDeadCards: _privateDeadCards, ...publicSeat } = seat.player;
    return {
      ...publicSeat,
      cards: [],
      totalInvested: cents(seat.contributed),
      returnedUncalled: 0,
      deadInvested: cents(seat.dead),
      individualAnteInvested: 0,
    };
  });
  const publicHero = publicPlayers[table.heroIdx];
  const player: SeatPlayer = {
    ...publicHero,
    cards: [...heroSeat.player.cards],
    knownDeadCards: [],
  };
  const gameState: HorseGameStateV2 = {
    stateSchemaVersion: 1,
    humanUserIds: table.seats
      .filter((seat) => seat.player.is_horse === false)
      .map((seat) => seat.player.user_id),
    dealtSeatIds: table.seats
      .filter((seat) => seat.player.cards.length > 0)
      .map((seat) => seat.player.seat)
      .sort((a, b) => a - b),
    blindSeats: { ...table.blindSeats },
    // HandController.getChipRulesSnapshot for a chip table without a jackpot.
    asset: 'chips',
    chipUnit: tournament ? 1 : 0.01,
    bbjConfig: null,
    heroSeat: menu.heroSeat,
    currentPlayerSeat: menu.currentPlayerSeat,
    legalActions: [...menu.legalActions],
    toCall: menu.toCall,
    minRaiseTo: menu.minRaiseTo,
    maxRaiseTo: menu.maxRaiseTo,
    bettingStructure: menu.structure,
    fixedBetSize: menu.fixedBetSize,
    fixedLimitSmallBet: null,
    wagersCapped: menu.wagersCapped,
    commitmentCapRemaining: menu.commitmentCapRemaining,
    pots: calculatePots(publicPlayers).map((pot) => ({
      ...pot,
      eligiblePlayers: [...pot.eligiblePlayers],
    })),
    contestablePot: calculateContestablePot(
      publicPlayers,
      publicHero.user_id,
      Math.max(0, table.currentBet - publicHero.bet)
    ),
    rakeConfig: { ...LEAGUE_RAKE_CONFIG },
    variantRules: horseVariantRulesFor(table.gameVariant),
    players: publicPlayers,
    communityCards: [...table.board],
    communityCards2: [],
    communityCards3: [],
    bombPot: false,
    boardCount: 1,
    pot: table.pot,
    currentBet: table.currentBet,
    minRaise: table.minRaise,
    stage: table.stage,
    gameVariant: table.gameVariant,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    dealerSeat: table.dealerSeat,
    lastRaise: table.lastRaise,
    actionHistory: table.history.map((action) => ({ ...action })),
    gameMode: table.gameMode,
    ante: table.ante,
    publicMemoryDomain: publicMemoryDomainFromRules('table', table.ante, table.bigBlindAnte),
    bigBlindAnte: table.bigBlindAnte,
    allInOrFold: false,
    // No VPIP floor: ownVpip is read only under a floor (vpipFloorMul).
    vpipFloor: 0,
    vpipWindowHands: VPIP_WINDOW_HANDS_DEFAULT,
    straddleActive: false,
    format: table.format,
    ...(table.tournament ? { tournament: structuredClone(table.tournament) } : {}),
  };
  return { player, gameState };
}
