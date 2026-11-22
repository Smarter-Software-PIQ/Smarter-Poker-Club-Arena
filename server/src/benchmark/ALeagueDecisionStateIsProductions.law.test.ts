/**
 * A LEAGUE DECISION STATE IS PRODUCTION'S (2026-11-15).
 *
 * The duplicate league must hand HorseLogic.decide the state the live table
 * hands it, or every league card measures a Horse that production never
 * fields: until 2026-11-15 the league state had no stateSchemaVersion, legal
 * menu, toCall, wager bounds or betting structure, so the river nuts raise,
 * the full-pot near-pot wager, the Omaha current-nuts raise, the checked-to
 * value bet and the heads-up commitment returned unchanged in every arm
 * (ALeaguePlaysProductionsBrain.law.test.ts proves they now fire).
 *
 * This law drives the REAL production builder - ServerTableEngine
 * .scheduleHorseAction over a real HandController, only the decision worker
 * replaced so the request can be read - at fixed nodes, builds the league's
 * state for the same node with leagueHorseDecisionInput, and compares them key
 * by key and value by value. Then it plays real league hands and checks that
 * every HorseLogic.decide call received exactly production's key set.
 *
 * A new production field fails this law until the league carries it or it is
 * listed below with the reason the league cannot or need not carry it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandConfig, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from '../engine/HorseLogic.js';
import type { FastHorseDecisionResult } from '../engine/horseDecision/protocol.js';

const worker = vi.hoisted(() => ({
  decideFast: vi.fn(),
  decideDeep: vi.fn(),
  commitDecisionEffects: vi.fn(async () => undefined),
  runWithDispatchBarrier: vi.fn(<T>(fn: () => T): T => fn()),
}));
vi.mock('../engine/horseDecision/index.js', async () => ({
  ...(await vi.importActual<typeof import('../engine/horseDecision/index.js')>(
    '../engine/horseDecision/index.js'
  )),
  getLiveHorseDecisionWorker: () => worker,
}));
vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

import { HandController } from '../engine/HandController.js';
import { ServerTableEngine } from '../engine/ServerTableEngine.js';
import { horsePlanBatchBindingFromRequest } from '../engine/HorsePlanHandIdentity.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { variantInfo } from '../engine/HorseEval.js';
import { playHand } from './HorseLeague.js';
import { LEAGUE_RAKE_CONFIG, leagueHorseDecisionInput } from './LeagueDecisionState.js';

const TABLE = 'fb100000-0000-4000-8000-0000000000b1';
const TABLE_RAKE = { percent: 5, cap: 6, noFlopNoDrop: true };

/** Keys a live table sends that the league does not. Empty: the league carries every one. */
const PRODUCTION_ONLY_KEYS: Readonly<Record<string, string>> = Object.freeze({});

/** Keys whose value differs by design, with the reason. */
const VALUE_EXCEPTIONS: Readonly<Record<string, string>> = Object.freeze({
  rakeConfig:
    'The league settles every pot rake free (HorseLeague.playHand settlement), so it sends a ' +
    'zero rate (LEAGUE_RAKE_CONFIG); a live table sends its own rake.',
  legalActions:
    'Only on a pot-limit node where the stack exceeds the pot: the live controller also offers ' +
    'all_in and clamps it to the pot, while the league executes all_in literally and offers ' +
    'it only where the literal shove is legal (validateAction). Checked exactly below.',
});

/** Action-record keys a live record carries that a league record does not. */
const PRODUCTION_ONLY_RECORD_KEYS: Readonly<Record<string, string>> = Object.freeze({
  publicNode:
    "The live table's provenance snapshot of the node a Horse acted at, read by the hand " +
    'journal, complaint replay and the worker observer (observerReads), never by a decision ' +
    "rule; the league observes its hands through playHand's own sandbox, not that observer.",
});

/** Seat keys a live seat carries that a league seat does not. */
const PRODUCTION_ONLY_SEAT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  avatar_url: 'Cosmetic broadcast identity (ServerTableEngineDealing); no decision reads it.',
  equipped_frame: 'Cosmetic broadcast identity (ServerTableEngineDealing); no decision reads it.',
  equipped_aura: 'Cosmetic broadcast identity (ServerTableEngineDealing); no decision reads it.',
});

const definedKeys = (o: object): string[] =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
const without = <T extends object>(o: T, keys: readonly string[]): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([k, v]) => !keys.includes(k) && v !== undefined)
  ) as Partial<T>;

interface Node {
  name: string;
  variant: string;
  stacks: number[];
  dealer: number;
  script: (hc: HandController) => void;
  /** The live controller offers a clamped deep pot-limit all_in here. */
  clampedShove: boolean;
}

const NODES: Node[] = [
  {
    name: 'NLH six-max preflop, first in',
    variant: 'nlh',
    stacks: [200, 200, 200, 200, 200, 200],
    dealer: 1,
    script: () => undefined,
    clampedShove: false,
  },
  {
    name: 'PLO4 six-max preflop, facing a pot raise, deep',
    variant: 'plo4',
    stacks: [200, 200, 200, 200, 200, 200],
    dealer: 1,
    script: (hc) => {
      expect(hc.performAction(4, 'raise', 7)).toBe(true);
    },
    clampedShove: true,
  },
  {
    name: 'PLO4 six-max preflop, facing a pot raise, stack under the pot',
    variant: 'plo4',
    stacks: [200, 200, 200, 200, 15, 200],
    dealer: 1,
    script: (hc) => {
      expect(hc.performAction(4, 'raise', 7)).toBe(true);
    },
    clampedShove: false,
  },
  {
    name: 'PLO5 heads-up flop, facing a bet',
    variant: 'plo5',
    stacks: [200, 200],
    dealer: 1,
    script: (hc) => {
      expect(hc.performAction(1, 'call')).toBe(true);
      expect(hc.performAction(2, 'check')).toBe(true);
      expect(hc.getState().stage).toBe('flop');
      expect(hc.performAction(2, 'bet', 4)).toBe(true);
    },
    clampedShove: true,
  },
  {
    name: 'NLH heads-up turn, checked to',
    variant: 'nlh',
    stacks: [200, 200],
    dealer: 1,
    script: (hc) => {
      expect(hc.performAction(1, 'call')).toBe(true);
      expect(hc.performAction(2, 'check')).toBe(true);
      expect(hc.performAction(2, 'check')).toBe(true);
      expect(hc.performAction(1, 'check')).toBe(true);
      expect(hc.getState().stage).toBe('turn');
      expect(hc.performAction(2, 'check')).toBe(true);
    },
    clampedShove: false,
  },
  // 2026-11-20: fixed-limit hold'em, which the league now deals with the
  // controller's own structure (LeagueDecisionState.leagueFixedLimitActionState).
  {
    name: 'FLH six-max preflop, first in',
    variant: 'flh',
    stacks: [200, 200, 200, 200, 200, 200],
    dealer: 1,
    script: () => undefined,
    clampedShove: false,
  },
  {
    name: 'FLH heads-up preflop, facing the cap',
    variant: 'flh',
    stacks: [200, 200],
    dealer: 1,
    script: (hc) => {
      expect(hc.performAction(1, 'raise', 4)).toBe(true);
      expect(hc.performAction(2, 'raise', 6)).toBe(true);
      expect(hc.performAction(1, 'raise', 8)).toBe(true);
      expect(hc.getAuthoritativeActionState(hc.getCurrentPlayer()!.user_id)).toMatchObject({
        wagersCapped: true,
        legalActions: ['fold', 'call'],
      });
    },
    clampedShove: false,
  },
  {
    name: 'FLH six-max turn, facing a big bet and a raise',
    variant: 'flh',
    stacks: [200, 200, 200, 200, 200, 200],
    dealer: 1,
    script: (hc) => {
      for (const seat of [4, 5, 6, 1]) expect(hc.performAction(seat, 'fold')).toBe(true);
      expect(hc.performAction(2, 'call')).toBe(true);
      expect(hc.performAction(3, 'check')).toBe(true);
      expect(hc.performAction(2, 'bet', 2)).toBe(true);
      expect(hc.performAction(3, 'call')).toBe(true);
      expect(hc.getState().stage).toBe('turn');
      expect(hc.performAction(2, 'bet', 4)).toBe(true);
      expect(hc.performAction(3, 'raise', 8)).toBe(true);
    },
    clampedShove: false,
  },
  // 2026-11-21: fixed-limit Omaha hi-lo (flo8), which now uses the same
  // controller fixed-limit menu (LeagueDecisionState.leagueFixedLimitActionState).
  {
    name: 'FLO8 six-max preflop, first in',
    variant: 'flo8',
    stacks: [200, 200, 200, 200, 200, 200],
    dealer: 1,
    script: () => undefined,
    clampedShove: false,
  },
  {
    name: 'FLO8 heads-up turn, facing a big bet and a raise',
    variant: 'flo8',
    stacks: [200, 200],
    dealer: 1,
    script: (hc) => {
      expect(hc.performAction(1, 'call')).toBe(true);
      expect(hc.performAction(2, 'check')).toBe(true);
      expect(hc.performAction(2, 'bet', 2)).toBe(true);
      expect(hc.performAction(1, 'call')).toBe(true);
      expect(hc.getState().stage).toBe('turn');
      expect(hc.performAction(2, 'bet', 4)).toBe(true);
      expect(hc.performAction(1, 'raise', 8)).toBe(true);
    },
    clampedShove: false,
  },
];

/** The request the live table sends the decision worker at this node, and
 *  the league's state for the same node (built before the Horse acts). */
async function productionRequest(node: Node) {
  const players = node.stacks.map((stack, i) => ({
    seat: i + 1,
    user_id: `fb200000-0000-4000-8000-0000000000b${i + 1}`,
    username: `Horse ${i + 1}`,
    stack,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    // ServerTableEngineDealing builds every dealt seat with these identity fields.
    is_horse: true,
    avatar_url: '',
    equipped_frame: '',
    equipped_aura: '',
  })) as SeatPlayer[];
  const hc = new HandController(
    {
      tableId: TABLE,
      handNumber: 1,
      gameVariant: node.variant,
      smallBlind: 1,
      bigBlind: 2,
      rakeConfig: TABLE_RAKE,
    } as HandConfig,
    players,
    node.dealer
  );
  hc.start();
  node.script(hc);
  const league = leagueRequest(hc, node.variant);
  const state = hc.getState();
  const seat = state.currentPlayerSeat!;
  const enginePlayer = state.players.find((p) => p.seat === seat)!;
  const seated = players.map((p) => ({
    seat_number: p.seat,
    user_id: p.user_id,
    username: p.username,
    stack: p.stack,
    is_horse: true,
    horse_profile: {},
  }));
  const player = seated.find((p) => p.seat_number === seat)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine = new ServerTableEngine(TABLE) as any;
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.handCount = 1;
  engine.tableInfo = {
    action_time_seconds: 15,
    big_blind: 2,
    small_blind: 1,
    game_variant: node.variant,
  };
  engine.seatedPlayers = seated;
  engine.handController = hc;
  engine.disconnectEngine = { isSittingOut: () => false, recordPlayerActed: vi.fn() };
  engine.timeBankEngine = {
    isAutoActivateEnabled: () => true,
    isArmed: () => false,
    getPlayerBank: () => null,
  };
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation: '9' });
  engine.humansSeated = () => 0;
  engine.tableFormat = () => 'cash';
  engine.markProgress = vi.fn();
  let request: { player: SeatPlayer; gameState: HorseGameStateV2 } | undefined;
  worker.decideFast.mockImplementationOnce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (snapshot: any): Promise<FastHorseDecisionResult> => {
      request = structuredClone({ player: snapshot.player, gameState: snapshot.gameState });
      return {
        type: 'FAST_RESULT',
        planIssueDisposition: 'no_effects',
        planBinding: horsePlanBatchBindingFromRequest({ ...snapshot, requestId: 1 }),
        requestId: 1,
        generation: snapshot.generation,
        fence: snapshot.fence,
        decision: {
          action: snapshot.gameState.legalActions.includes('check') ? 'check' : 'fold',
          thinkTime: 1,
        },
        rngBefore: 11,
        rngAfter: 22,
        computeMs: 1,
        governorScale: 1,
        effects: [],
      } as FastHorseDecisionResult;
    }
  );
  engine.scheduleHorseAction(player, seat, enginePlayer, state);
  await vi.advanceTimersByTimeAsync(300);
  expect(request, `${node.name}: the live table sent no decision request`).toBeDefined();
  const history = hc.getState({ includeActionOrigins: true }).actionHistory;
  return { league, accepted: history[history.length - 1], ...request! };
}

/** The league's state for the same node, its seats held as playHand holds them. */
function leagueRequest(hc: HandController, variant: string) {
  const state = hc.getState({ includeActionOrigins: true });
  const heroIdx = state.players.findIndex((p) => p.seat === state.currentPlayerSeat);
  const input = leagueHorseDecisionInput({
    seats: state.players.map((p) => ({
      // The seat object HorseLeague.playHand deals (seats.push there).
      player: {
        seat: p.seat,
        user_id: p.user_id,
        username: p.username,
        stack: p.stack,
        bet: p.bet,
        totalInvested: 0,
        cards: [...p.cards],
        is_folded: p.is_folded,
        is_all_in: p.is_all_in,
        is_sitting_out: false,
        is_horse: true,
      } as SeatPlayer,
      contributed: p.totalInvested,
      dead: p.deadInvested ?? 0,
    })),
    heroIdx,
    stage: state.stage,
    board: state.communityCards,
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    lastRaise: state.lastRaise,
    gameVariant: variant,
    smallBlind: 1,
    bigBlind: 2,
    dealerSeat: state.dealerSeat!,
    blindSeats: hc.getBlindSeatsSnapshot()!,
    history: state.actionHistory,
    gameMode: 'cash',
    format: 'cash',
    ante: 0,
    bigBlindAnte: false,
  });
  expect(input).not.toBeNull();
  return input!;
}

describe('a league decision state is the state the live table sends', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(NODES.map((node) => [node.name, node] as const))(
    '%s: same keys, same values (listed exceptions only)',
    async (_name, node) => {
      const live = await productionRequest(node);
      const league = live.league;
      const prod = live.gameState;
      const ours = league.gameState;

      // Keys: every live key, and nothing the live table does not send.
      expect(definedKeys(ours)).toEqual(
        definedKeys(prod).filter((k) => !(k in PRODUCTION_ONLY_KEYS))
      );

      // Values: equal for every key but the listed exceptions.
      const skip = [...Object.keys(VALUE_EXCEPTIONS), 'players'];
      expect(without(ours, skip)).toEqual(
        without(prod, [...skip, ...Object.keys(PRODUCTION_ONLY_KEYS)])
      );
      expect(ours.rakeConfig).toEqual(LEAGUE_RAKE_CONFIG);
      if (node.clampedShove) {
        expect(prod.legalActions).toContain('all_in');
        expect(ours.legalActions).toEqual(prod.legalActions!.filter((a) => a !== 'all_in'));
      } else {
        expect(ours.legalActions).toEqual(prod.legalActions);
      }

      // Seats: public only, the same money, the same keys but cosmetics.
      const cosmetic = Object.keys(PRODUCTION_ONLY_SEAT_KEYS);
      expect(ours.players).toHaveLength(prod.players.length);
      prod.players.forEach((seat, i) => {
        expect(seat.cards).toEqual([]);
        expect(without(ours.players[i], [])).toEqual(without(seat, cosmetic));
      });
      // The hero: its own cards, the same seat facts.
      expect(league.player.cards).toEqual(live.player.cards);
      expect(league.player.cards).toHaveLength(variantInfo(node.variant).holeCount);
      expect(without(league.player, [])).toEqual(without(live.player, cosmetic));
    }
  );

  it('every HorseLogic.decide in league hands receives exactly the live key set', async () => {
    const live = await productionRequest(NODES[0]);
    const liveKeys = definedKeys(live.gameState).filter((k) => !(k in PRODUCTION_ONLY_KEYS));
    // The Horse's own fold as the live controller recorded it.
    expect(live.accepted).toMatchObject({ action: 'fold', origin: 'horse_policy' });
    const liveFoldKeys = definedKeys(live.accepted).filter(
      (k) => !(k in PRODUCTION_ONLY_RECORD_KEYS)
    );
    vi.useRealTimers();
    const decide = vi.spyOn(HorseLogic, 'decide');
    const cells: Array<[string, number]> = [
      ['nlh', 6],
      ['plo4', 6],
      ['plo5', 6],
      ['nlh', 2],
      ['plo4', 2],
      ['flh', 6],
      ['flh', 2],
      ['flo8', 6],
      ['flo8', 2],
    ];
    let seed = 20261115;
    for (const [variant, seats] of cells)
      for (let h = 0; h < 3; h++)
        playHand(seed++, 1 + (h % seats), () => ({}), undefined, undefined, variant, seats);
    expect(decide.mock.calls.length).toBeGreaterThan(50);
    for (const [player, gs] of decide.mock.calls) {
      expect(definedKeys(gs)).toEqual(liveKeys);
      expect(gs.stateSchemaVersion).toBe(1);
      // Hidden-information firewall: no seat in the shared state shows cards.
      expect(gs.players.every((seat) => seat.cards.length === 0)).toBe(true);
      expect(player.cards).toHaveLength(variantInfo(gs.gameVariant).holeCount);
      // Real investment, as the live controller keeps it.
      expect(gs.players.reduce((n, seat) => n + seat.totalInvested, 0)).toBeCloseTo(gs.pot, 6);
      // Action records as HandController.performAction writes them.
      for (const record of gs.actionHistory ?? []) {
        if (record.action === 'fold') {
          expect(definedKeys(record)).toEqual(liveFoldKeys);
          expect(['horse_policy', 'horse_fallback', 'player']).toContain(record.origin);
        } else if (record.action === 'bet' || record.action === 'raise') {
          expect(typeof record.isFullRaise).toBe('boolean');
        } else if (record.action === 'call' || record.action === 'check') {
          expect(record.isFullRaise).toBeUndefined();
        }
        if (record.action !== 'fold') expect(record.origin).toBeUndefined();
      }
    }
  });
});
