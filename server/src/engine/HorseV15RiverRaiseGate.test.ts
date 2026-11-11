/**
 * V15 river raise gate (2026-11-07). An Omaha flush with a live higher flush
 * rank on an unpaired board (high-only, one board) facing a river wager
 * calls; it never raises, whatever the equity estimate says. Hand 3374459
 * (plo4 lightning, K-high flush on Ts3c7hJs2s with the As live) raised a
 * pot-sized river bet on 43 of 60 seeds because the gate's near-lock escape
 * (`eq15 - dominationPenalty >= 0.85`) read the Monte Carlo against the
 * bettor's range as 0.91-1.00. Every other non-nut flush or straight keeps
 * the near-lock escape, seed for seed. See
 * docs/changelog/2026-11-07-the-river-has-no-near-lock.md and
 * docs/horse-measure/2026-11-07/v15-river-raise-scope.md.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HandController } from './HandController.js';
import type { Card, CardRank, CardSuit, GameState, SeatPlayer } from '../types.js';

const SU: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(t: string): Card[] {
  const o: Card[] = [];
  for (let i = 0; i + 1 < t.length; i += 2) o.push({ rank: t[i] as CardRank, suit: SU[t[i + 1]] });
  return o;
}
function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  folded: boolean,
  hole = ''
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: cards(hole),
    is_folded: folded,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as SeatPlayer;
}

/**
 * The river node of hand 3374459 as the engine captured it: six seats, three
 * folded, a pot-sized 21.8 bet into 21.8 from seat 3, seat 5 folded behind
 * it, hero (seat 6) to act with 222.03 behind at a 0.5 big blind.
 */
function node3374459(
  hole: string,
  board: string,
  stage: 'river' | 'turn' = 'river',
  variant = 'plo4',
  wager = 21.8,
  heroStack = 222.03,
  gameMode: 'cash' | 'tournament' = 'cash'
) {
  const hero = seat(6, 'hero', heroStack, 0, 6.1, false, hole);
  const players = [
    seat(1, 'p1', 110.21, 0, 0.25, true),
    seat(2, 'p2', 95.75, 0, 1, true),
    seat(3, 'bettor', 214, wager, 6.1 + wager, false),
    seat(4, 'p4', 134.69, 0, 2.25, true),
    seat(5, 'p5', 69.96, 0, 6.1, true),
    hero,
  ];
  const a = (st: string, s: number, userId: string, action: string, amount: number) => ({
    stage: st,
    seat: s,
    userId,
    action,
    amount,
    timestamp: 0,
  });
  const actionHistory = [
    a('preflop', 3, 'bettor', 'raise', 2.25),
    a('preflop', 4, 'p4', 'call', 2.25),
    a('preflop', 5, 'p5', 'call', 2.25),
    a('preflop', 6, 'hero', 'call', 2.25),
    a('preflop', 1, 'p1', 'fold', 0),
    a('preflop', 2, 'p2', 'fold', 0),
    a('flop', 3, 'bettor', 'check', 0),
    a('flop', 4, 'p4', 'check', 0),
    a('flop', 5, 'p5', 'check', 0),
    a('flop', 6, 'hero', 'check', 0),
    a('turn', 3, 'bettor', 'check', 0),
    a('turn', 4, 'p4', 'check', 0),
    a('turn', 5, 'p5', 'bet', 3.85),
    a('turn', 6, 'hero', 'call', 3.85),
    a('turn', 3, 'bettor', 'call', 3.85),
    a('turn', 4, 'p4', 'fold', 0),
    a(stage, 3, 'bettor', 'bet', wager),
    a(stage, 5, 'p5', 'fold', 0),
  ];
  return {
    hero,
    gs: {
      players,
      communityCards: cards(board),
      pot: 21.8 + wager,
      currentBet: wager,
      toCall: wager,
      minRaiseTo: 2 * wager,
      maxRaiseTo: 21.8 + 3 * wager,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      stage,
      gameVariant: variant,
      bettingStructure: variant === 'flo8' ? 'fixed_limit' : 'pot_limit',
      gameMode,
      bigBlind: 0.5,
      dealerSeat: 2,
      actionHistory,
    },
  };
}

function decideMany(
  s: ReturnType<typeof node3374459>,
  seeds = 60,
  extra: Record<string, unknown> = {}
) {
  const acts: string[] = [];
  let gateFires = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 15);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...extra,
    } as never) as { action: string };
    gateFires += drainFires().find((r) => r.feature === 'v15_raise_gate')?.fires ?? 0;
    acts.push(d.action);
  }
  return { acts, gateFires };
}
const raises = (acts: string[]) => acts.filter((x) => x === 'raise' || x === 'all_in').length;

// Ts 3c 7h Js 2s: three spades, unpaired, no straight flush possible.
const BOARD = 'Ts3c7hJs2s';

describe('V15 river raise gate: the river has no near-lock', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('hand 3374459: the K-high flush with the As live never raises the river bet', () => {
    const { acts, gateFires } = decideMany(node3374459('4d7sQdKs', BOARD));
    expect(raises(acts)).toBe(0);
    expect(acts.every((x) => x === 'call')).toBe(true);
    expect(gateFires).toBe(acts.length);
  });

  it('a third-nut flush never raises the river bet either', () => {
    const { acts } = decideMany(node3374459('4d7sQs9d', BOARD));
    expect(raises(acts)).toBe(0);
  });

  it('the nut flush is outside the gate and still raises for value', () => {
    const { acts, gateFires } = decideMany(node3374459('4d7sAsQd', BOARD));
    expect(gateFires).toBe(0);
    expect(raises(acts)).toBeGreaterThan(0);
  });

  it('the explicit off arm restores the river near-lock escape', () => {
    const { acts } = decideMany(node3374459('4d7sQdKs', BOARD), 60, { v15RiverNoNearLock: false });
    expect(raises(acts)).toBeGreaterThan(0);
  });

  it('the demonstrated cell never raises a pot-sized river wager in PLO5 or PLO6 either', () => {
    for (const [variant, hole] of [
      ['plo5', '4d7sQdKs5h'],
      ['plo6', '4d7sQdKs5h6c'],
    ] as const) {
      const s = node3374459(hole, BOARD, 'river', variant, 21.8);
      // The off arm raises, so the gate has something to stop.
      expect(raises(decideMany(s, 40, { v15RiverNoNearLock: false }).acts)).toBeGreaterThan(0);
      const { acts } = decideMany(s, 40);
      expect(raises(acts), variant).toBe(0);
      // The gate never answers with a fold of its own; a fold here is a
      // later measured call rule (V81 folds PLO5 and V86/V87 extend parity to
      // PLO6 second-nut flush calls of pot-sized multiway river wagers),
      // applied exactly as it applies to any call.
      expect(acts.every((x) => x === 'fold')).toBe(true);
      if (variant === 'plo6') {
        const { acts: preV86Acts } = decideMany(s, 40, {
          v86PloOverhaul: false,
          v87DeepDiveDiscipline: false,
        });
        expect(raises(preV86Acts), 'plo6 pre-v86 raises').toBe(0);
        expect(preV86Acts.every((x) => x === 'call')).toBe(true);
      }
    }
  });

  // Boundaries of the measured cell: under 0.8 pot, in a tournament, or a
  // third-nut-or-worse flush, the river keeps today's near-lock reading
  // seed for seed (their raises did not measure negative).
  const OUTSIDE_CELL: Array<[string, string, number, 'cash' | 'tournament']> = [
    ['second-nut flush facing a half-pot wager', '4d7sQdKs', 10.9, 'cash'],
    ['second-nut flush facing 0.75 pot', '4d7sQdKs', 16.35, 'cash'],
    ['second-nut flush in a tournament, pot-sized wager', '4d7sQdKs', 21.8, 'tournament'],
    ['third-nut flush, pot-sized wager', '4d7sQs9d', 21.8, 'cash'],
  ];
  it.each(OUTSIDE_CELL)('%s keeps today seed for seed', (_name, hole, wager, mode) => {
    const s = node3374459(hole, BOARD, 'river', 'plo4', wager, 222.03, mode);
    expect(decideMany(s, 40).acts).toEqual(decideMany(s, 40, { v15RiverNoNearLock: false }).acts);
  });

  it('the cell starts at 0.8 pot', () => {
    const s = node3374459('4d7sQdKs', BOARD, 'river', 'plo4', 17.44);
    expect(raises(decideMany(s, 40).acts)).toBe(0);
  });

  // Every non-nut-class hand outside the demonstrated class keeps today's
  // river near-lock reading: the default and the explicit off arm decide the
  // same action on every seed. Each case below raised on some seeds under
  // PR #9943's unscoped rule and called on every seed under it.
  const EXCLUDED: Array<[string, string, string, string, number]> = [
    ['nut flush, paired board', 'As9s4d5c', 'Ts3c7hJs3s', 'plo4', 10.9],
    ['nut flush, paired board, pot bet', 'As9s4d5c', 'Ts3c7hJs3s', 'plo4', 21.8],
    ['second-nut flush, paired board', 'Ks9s4d5c', 'Ts3c7hJs3s', 'plo4', 10.9],
    ['non-nut straight', '9c8d4h2h', 'Ts7c6hJdQs', 'plo4', 10.9],
    ['non-nut straight, king high', 'Kc9d4h2h', 'Ts8c6hJdQs', 'plo4', 10.9],
    ['nut straight on a three-flush board', 'AcKd4h2c', 'TsQsJs8d3c', 'plo4', 10.9],
    ['non-nut straight on a three-flush board', '9c8d4h2c', 'TsQsJs7d3c', 'plo4', 10.9],
    ['hi-lo second-nut flush with a low', 'Ks4s3d2c', 'Ts5c7hJs6s', 'plo8', 21.8],
    ['hi-lo second-nut flush with a low, half pot', 'Ks4s3d2c', 'Ts5c7hJs6s', 'plo8', 10.9],
    ['PLO5 nut flush, paired board', 'As9s4d5c6h', 'Ts3c7hJs3s', 'plo5', 10.9],
  ];
  it.each(EXCLUDED)('%s keeps today seed for seed', (_name, hole, board, variant, wager) => {
    const s = node3374459(hole, board, 'river', variant, wager);
    const on = decideMany(s, 40).acts;
    const off = decideMany(s, 40, { v15RiverNoNearLock: false }).acts;
    expect(on).toEqual(off);
  });
  it('the excluded classes still raise where they raised before the river rule', () => {
    for (const [name, hole, board, variant, wager] of [EXCLUDED[0], EXCLUDED[4], EXCLUDED[7]]) {
      const s = node3374459(hole, board, 'river', variant, wager);
      expect(raises(decideMany(s, 40).acts), name).toBeGreaterThan(0);
    }
  });

  it('flop and turn are unchanged: the flag reads the river only', () => {
    // Ts 3s 7h Js: the K-high flush with the As live on the turn.
    const s = node3374459('4d7sQdKs', 'Ts3s7hJs', 'turn');
    expect(decideMany(s, 40).acts).toEqual(decideMany(s, 40, { v15RiverNoNearLock: false }).acts);
    const flop = node3374459('4d7sQdKs', 'Ts3s7h', 'turn');
    (flop.gs as { stage: string }).stage = 'flop';
    for (const a of flop.gs.actionHistory) if (a.stage === 'turn') a.stage = 'flop';
    expect(decideMany(flop, 40).acts).toEqual(
      decideMany(flop, 40, { v15RiverNoNearLock: false }).acts
    );
  });

  it('facing no wager the gate never fires and nothing changes', () => {
    const s = node3374459('4d7sQdKs', BOARD);
    const gs = s.gs as Record<string, unknown> & {
      players: SeatPlayer[];
      actionHistory: { stage: string; action: string }[];
    };
    gs.currentBet = 0;
    gs.toCall = 0;
    gs.pot = 21.8;
    gs.minRaiseTo = 0.5;
    gs.maxRaiseTo = 21.8;
    gs.legalActions = ['check', 'bet', 'all_in'];
    gs.players.find((p) => p.user_id === 'bettor')!.bet = 0;
    gs.actionHistory = gs.actionHistory.filter((a) => !(a.stage === 'river' && a.action === 'bet'));
    const on = decideMany(s, 40);
    expect(on.gateFires).toBe(0);
    expect(on.acts).toEqual(decideMany(s, 40, { v15RiverNoNearLock: false }).acts);
    expect(on.acts.some((x) => x === 'call' || x === 'fold')).toBe(false);
  });
});

/**
 * Legality: the gate returns `{ action: 'call', amount: toCall }`. Each spot
 * below is put into a real HandController, the brain decides against the
 * controller's own authoritative menu, and the controller must accept what
 * the brain submits. The same holds for the off arm, so the gate never
 * changes legality, only the choice between a legal raise and a legal call.
 */
describe('V15 river raise gate: every answer is one the engine accepts', () => {
  beforeEach(() => {
    HorseMind.reset();
    drainFires();
  });

  function controllerSpot(
    s: ReturnType<typeof node3374459>,
    config: { allInOrFold?: boolean } = {}
  ) {
    const variant = String(s.gs.gameVariant);
    const players = s.gs.players.map((p) => ({ ...p, cards: p.cards.map((c) => ({ ...c })) }));
    const controller = new HandController(
      {
        tableId: '40000000-0000-4000-8000-00000000v15a',
        handNumber: 1,
        gameVariant: variant,
        smallBlind: 0.25,
        bigBlind: 0.5,
        rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        ...config,
      } as never,
      players,
      2
    );
    const internal = controller as unknown as {
      state: GameState;
      handFSM: { transition(stage: string): void };
    };
    const wager = s.gs.currentBet;
    Object.assign(internal.state, {
      players,
      communityCards: s.gs.communityCards,
      stage: 'river',
      currentBet: wager,
      pot: s.gs.pot,
      minRaise: Math.max(0.5, wager),
      lastRaise: Math.max(0.5, wager),
      currentPlayerSeat: 6,
      actionHistory: s.gs.actionHistory.map((a) => ({ ...a })),
    });
    for (const stage of ['posting_blinds', 'dealing', 'preflop', 'flop', 'turn', 'river'])
      internal.handFSM.transition(stage);
    const menu = controller.getAuthoritativeActionState('hero')!;
    expect(menu.canAct).toBe(true);
    const gs = {
      ...s.gs,
      stateSchemaVersion: 1,
      heroSeat: 6,
      currentPlayerSeat: 6,
      legalActions: [...menu.legalActions],
      toCall: menu.toCall,
      minRaiseTo: menu.minRaiseTo,
      maxRaiseTo: menu.maxRaiseTo,
      bettingStructure: menu.structure,
      fixedBetSize: menu.fixedBetSize,
      wagersCapped: menu.wagersCapped,
      ...(config.allInOrFold ? { allInOrFold: true } : {}),
    };
    return { controller, menu, gs, hero: players.find((p) => p.user_id === 'hero')! };
  }

  function accepted(
    s: ReturnType<typeof node3374459>,
    seed: number,
    extra: Record<string, unknown>,
    config: { allInOrFold?: boolean } = {}
  ) {
    const spot = controllerSpot(s, config);
    seedFastRandom(seed * 7919 + 15);
    HorseMind.reset();
    const d = HorseLogic.decide(spot.hero, spot.gs as never, 'balanced', {}, {
      mind: false,
      ...extra,
    } as never) as { action: string; amount?: number };
    expect(spot.menu.legalActions, JSON.stringify(d)).toContain(d.action);
    expect(spot.controller.performAction(6, d.action as never, d.amount), JSON.stringify(d)).toBe(
      true
    );
    return d;
  }

  it.each([
    ['the demonstrated river node', () => node3374459('4d7sQdKs', BOARD), {}],
    [
      'a call for more than the stack (all-in to call)',
      () => node3374459('4d7sQdKs', BOARD, 'river', 'plo4', 21.8, 15),
      {},
    ],
    [
      'an all-in-or-fold (lightning) table on the river',
      () => node3374459('4d7sQdKs', BOARD),
      { allInOrFold: true },
    ],
    ['PLO6', () => node3374459('4d7sQdKs5h6c', BOARD, 'river', 'plo6'), {}],
    [
      'fixed-limit FLO8 (hi-lo, outside the river rule)',
      () => node3374459('Ks4s3d2c', 'Ts5c7hJs6s', 'river', 'flo8', 1),
      {},
    ],
  ] as const)('%s', (_name, make, config) => {
    for (let seed = 1; seed <= 12; seed++) {
      const on = accepted(make(), seed, {}, config);
      expect(on.action === 'raise' && make().gs.gameVariant !== 'flo8').toBe(false);
      accepted(make(), seed, { v15RiverNoNearLock: false }, config);
    }
  });

  it('all-in to call: the gated call is submitted as the all-in the controller settles as a call', () => {
    const s = node3374459('4d7sQdKs', BOARD, 'river', 'plo4', 21.8, 15);
    for (let seed = 1; seed <= 12; seed++) {
      const d = accepted(s, seed, {});
      expect(['all_in', 'fold']).toContain(d.action);
    }
  });

  it('a menu without call (never offered postflop by the controller) degrades to a menu action', () => {
    const s = node3374459('4d7sQdKs', BOARD);
    const gs = {
      ...s.gs,
      stateSchemaVersion: 1,
      heroSeat: 6,
      currentPlayerSeat: 6,
      legalActions: ['fold', 'raise', 'all_in'],
    };
    for (let seed = 1; seed <= 12; seed++) {
      seedFastRandom(seed * 7919 + 15);
      HorseMind.reset();
      const d = HorseLogic.decide(s.hero, gs as never, 'balanced', {}, {
        mind: false,
      } as never) as { action: string };
      expect(gs.legalActions).toContain(d.action);
      expect(d.action).not.toBe('raise');
    }
  });
});
