/**
 * AN ENTRY POST IS ONE OBLIGATION (hand #59634000, NLH 0.50/1 Classic,
 * 2026-11-15; 24 new players between 2026-11-07 and 2026-11-15).
 *
 * The published rule (Dan 2026-08-26): a cash entrant waits for the big blind
 * or posts ONE live big blind. A dead small blind plus a live big blind is the
 * debt of a player who was playing here, sat out and missed blinds.
 *
 * What the engine did instead:
 *
 *   Post Big Blind + I'm Back on one arrival   dead SB + live BB + a second BB
 *                                              not counted toward the bet
 *                                              (Burls: 2.50 out, 1.00 live)
 *   I'm Back before the arrival was registered dead SB + live BB, no wait
 *
 * These tests drive the engine's real sitOut / postBBToEnter / entryChargeSeats
 * and the real HandController, in every order the two requests can arrive.
 * Cards are random, so every assertion is on posting and chip math.
 */
import { describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import { HandController } from './HandController.js';
import type { HandConfig, SeatPlayer } from '../types.js';

const NEW = 'new-player';
const VET = 'veteran';
const SEATS = 9;
const HERO_SEAT = 4;

type Row = {
  user_id: string;
  seat_number: number;
  stack: number;
  entry_hold: string | null;
  occupancy_id: string;
};

function table(opts: { heroId?: string; heroStack?: number; heroHold?: string | null } = {}) {
  const heroId = opts.heroId ?? NEW;
  const rows: Row[] = Array.from({ length: SEATS }, (_, i) => ({
    user_id: i + 1 === HERO_SEAT ? heroId : `u${i + 1}`,
    seat_number: i + 1,
    stack: i + 1 === HERO_SEAT ? (opts.heroStack ?? 200) : 200,
    entry_hold: i + 1 === HERO_SEAT ? (opts.heroHold ?? null) : null,
    occupancy_id: `occ-${i + 1}`,
  }));
  const engine = Object.create(ServerTableEngine.prototype) as any;
  Object.assign(engine, {
    tableId: 'table',
    tableInfo: { game_type: 'cash' },
    seatedPlayers: rows,
    handController: null,
    weeklyHandPauseValue: { held: () => false },
    knownPlayerIds: new Set(rows.map((r) => r.user_id)),
    dealtInUserIds: new Set(rows.filter((r) => r.user_id !== NEW).map((r) => r.user_id)),
    waitingForBB: new Set<string>(),
    postBBWhenClear: new Set<string>(),
    postingBBToEnter: new Set<string>(),
    pendingPostToEnter: new Set<string>(),
    returningFromSitout: new Set<string>(),
    returnedFromSitOutAtMs: new Map(),
    pendingSitOut: new Set(),
    leaveHeldByClock: new Map(),
    disconnectEngine: {
      sitOut: vi.fn(),
      sitBack: vi.fn(),
      markClientSitOut: vi.fn(),
      isSittingOut: () => false,
    },
    chipContinuity: {
      evaluate: vi.fn(async () => []),
      markBlindOff: vi.fn(),
      leaveLock: vi.fn(() => ({ locked: false, remainingMs: 0, handsRemaining: 0 })),
    },
    broadcastCurrentState: vi.fn(),
    isContinuityActive: vi.fn(() => true),
    persistEntryHold: vi.fn(),
    dealsInWhileSittingOut: () => false,
    // Button seat 5: small blind 6, big blind 7. Seat 4 is clear of both rules.
    getSBSeatIndex: () => 6,
    getButtonSeatIndex: () => 5,
  });
  return { engine, rows };
}

/** The dealing loop's registration of a fresh arrival. */
function register(engine: any, userId = NEW) {
  engine.registerWaitForBB(userId);
}

/** Deal the next hand exactly as dealHand hands the entry charges to the controller. */
function deal(engine: any, rows: Row[], blinds = { sb: 0.5, bb: 1 }) {
  const charges = engine.entryChargeSeats(rows) as {
    deadBlinds: { seat: number }[];
    bbOnlyPosts: { seat: number }[];
  };
  const players = rows
    .filter((r) => !engine.waitingForBB.has(r.user_id))
    .map(
      (r) =>
        ({
          seat: r.seat_number,
          user_id: r.user_id,
          username: r.user_id,
          stack: r.stack,
          bet: 0,
          totalInvested: 0,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        }) as SeatPlayer
    );
  const cfg = {
    tableId: 'table',
    handNumber: 1,
    gameVariant: 'nlh',
    smallBlind: blinds.sb,
    bigBlind: blinds.bb,
    rakeConfig: { percent: 10, cap: 2.5, noFlopNoDrop: true },
    deadBlinds: charges.deadBlinds.length > 0 ? charges.deadBlinds : undefined,
    bbOnlyPosts: charges.bbOnlyPosts.length > 0 ? charges.bbOnlyPosts : undefined,
  } as HandConfig;
  const hc = new HandController(cfg, players, 5);
  hc.start();
  const state = (
    hc as unknown as { state: { players: SeatPlayer[]; pot: number; currentBet: number } }
  ).state;
  const hero = state.players.find((p) => p.seat === HERO_SEAT);
  const startChips = players.reduce((a, p) => a + p.stack, 0);
  const chipsNow = state.players.reduce((a, p) => a + p.stack, 0) + state.pot;
  return { charges, state, hero, conserved: Math.round((startChips - chipsNow) * 100) === 0 };
}

const postedOneLiveBigBlind = (r: ReturnType<typeof deal>, bb: number, startStack: number) => {
  expect(r.charges.deadBlinds).toEqual([]);
  expect(r.charges.bbOnlyPosts).toEqual([{ seat: HERO_SEAT }]);
  expect(r.hero!.stack).toBe(startStack - bb);
  expect(r.hero!.bet).toBe(bb);
  expect(r.hero!.totalInvested).toBe(bb);
  expect(r.hero!.deadInvested ?? 0).toBe(0);
  // What the felt shows the player as "in for", and what a raise costs them.
  expect(r.state.currentBet - r.hero!.bet).toBe(0);
  expect(r.conserved).toBe(true);
};

describe('a genuinely new cash seat owes one live big blind, in every request order', () => {
  it('Post Big Blind alone', () => {
    const { engine, rows } = table();
    register(engine);
    expect(engine.postBBToEnter(NEW)).toEqual({ success: true });
    postedOneLiveBigBlind(deal(engine, rows), 1, 200);
  });

  it("Post Big Blind then I'm Back (Burls, 0.50/1): 1.00, not 2.50", () => {
    const { engine, rows } = table();
    register(engine);
    engine.postBBToEnter(NEW);
    expect(engine.sitOut(NEW, false).success).toBe(true);
    expect(engine.returningFromSitout.has(NEW)).toBe(false);
    postedOneLiveBigBlind(deal(engine, rows), 1, 200);
  });

  it("I'm Back then Post Big Blind", () => {
    const { engine, rows } = table();
    register(engine);
    engine.sitOut(NEW, false);
    engine.postBBToEnter(NEW);
    expect(engine.returningFromSitout.has(NEW)).toBe(false);
    postedOneLiveBigBlind(deal(engine, rows), 1, 200);
  });

  it('fresco, 0.10/0.25: 0.25, not 0.60', () => {
    const { engine, rows } = table({ heroStack: 14.18 });
    register(engine);
    engine.postBBToEnter(NEW);
    engine.sitOut(NEW, false);
    const r = deal(engine, rows, { sb: 0.1, bb: 0.25 });
    expect(r.hero!.stack).toBe(13.93);
    expect(r.hero!.totalInvested).toBe(0.25);
    expect(r.hero!.deadInvested ?? 0).toBe(0);
  });

  it('repeated and retried requests bill once', () => {
    const { engine, rows } = table();
    register(engine);
    for (let i = 0; i < 3; i++) {
      engine.postBBToEnter(NEW);
      engine.sitOut(NEW, false);
      engine.sitOut(NEW, false);
    }
    postedOneLiveBigBlind(deal(engine, rows), 1, 200);
  });

  it("I'm Back before the dealing loop has registered the arrival does not skip the wait", () => {
    const { engine, rows } = table();
    engine.knownPlayerIds.delete(NEW);
    engine.sitOut(NEW, false);
    // The loop registers only a seat that is not marked returning.
    expect(engine.returningFromSitout.has(NEW)).toBe(false);
    register(engine);
    const r = deal(engine, rows);
    // Still waiting for the big blind: not dealt, not billed.
    expect(r.hero).toBeUndefined();
    expect(r.charges).toEqual({ deadBlinds: [], bbOnlyPosts: [] });
  });

  it("a queued Post from an unregistered arrival, then I'm Back, still bills one big blind", () => {
    const { engine, rows } = table();
    engine.knownPlayerIds.delete(NEW);
    expect(engine.postBBToEnter(NEW)).toEqual({ success: true });
    expect(engine.pendingPostToEnter.has(NEW)).toBe(true);
    engine.sitOut(NEW, false);
    expect(engine.returningFromSitout.has(NEW)).toBe(false);
    // The loop registers the arrival and replays the queued post.
    engine.knownPlayerIds.add(NEW);
    register(engine);
    engine.pendingPostToEnter.delete(NEW);
    engine.postBBToEnter(NEW);
    postedOneLiveBigBlind(deal(engine, rows), 1, 200);
  });

  it("waiting for the big blind and tapping I'm Back costs nothing and deals nothing", () => {
    const { engine, rows } = table();
    register(engine);
    engine.sitOut(NEW, false);
    const r = deal(engine, rows);
    expect(r.hero).toBeUndefined();
    expect(r.charges).toEqual({ deadBlinds: [], bbOnlyPosts: [] });
    expect(engine.waitingForBB.has(NEW)).toBe(true);
  });

  it('a reconnect that sits the entrant back in after they posted adds nothing', () => {
    const { engine, rows } = table();
    register(engine);
    engine.postBBToEnter(NEW);
    // A dropped link is sat out by presence and sat back in by the client.
    engine.sitOut(NEW, false, { requestedByClient: true });
    postedOneLiveBigBlind(deal(engine, rows), 1, 200);
  });

  it('a short stack posting to enter is all in for its stack, once', () => {
    const { engine, rows } = table({ heroStack: 0.6 });
    register(engine);
    engine.postBBToEnter(NEW);
    engine.sitOut(NEW, false);
    const r = deal(engine, rows);
    expect(r.hero!.stack).toBe(0);
    expect(r.hero!.totalInvested).toBe(0.6);
    expect(r.hero!.bet).toBe(0.6);
    expect(r.hero!.is_all_in).toBe(true);
    expect(r.conserved).toBe(true);
  });
});

describe('a legitimate missed-blind return is untouched', () => {
  it('a veteran back from sit-out owes a dead small blind and a live big blind', () => {
    const { engine, rows } = table({ heroId: VET });
    expect(engine.sitOut(VET, false).success).toBe(true);
    expect(engine.returningFromSitout.has(VET)).toBe(true);
    const r = deal(engine, rows);
    expect(r.charges).toEqual({ deadBlinds: [{ seat: HERO_SEAT }], bbOnlyPosts: [] });
    expect(r.hero!.stack).toBe(198.5);
    expect(r.hero!.bet).toBe(1);
    expect(r.hero!.totalInvested).toBe(1.5);
    expect(r.hero!.deadInvested).toBe(0.5);
    expect(r.conserved).toBe(true);
  });

  it("a veteran tapping I'm Back twice is billed once", () => {
    const { engine, rows } = table({ heroId: VET });
    engine.sitOut(VET, false);
    engine.sitOut(VET, false);
    const r = deal(engine, rows);
    expect(r.hero!.totalInvested).toBe(1.5);
  });

  it('a short-stacked veteran pays the dead small blind first and is all in for the rest', () => {
    const { engine, rows } = table({ heroId: VET, heroStack: 1.2 });
    engine.sitOut(VET, false);
    const r = deal(engine, rows);
    expect(r.hero!.stack).toBe(0);
    expect(r.hero!.deadInvested).toBe(0.5);
    expect(r.hero!.bet).toBe(0.7);
    expect(r.hero!.is_all_in).toBe(true);
    expect(r.conserved).toBe(true);
  });

  it('a moved arrival keeps the treatment it had (docs/LAWS.md, 2026-11-15)', () => {
    const { engine, rows } = table({ heroHold: 'moved' });
    engine.sitOut(NEW, false);
    expect(engine.returningFromSitout.has(NEW)).toBe(true);
    expect(engine.postingBBToEnter.has(NEW)).toBe(false);
    const r = deal(engine, rows);
    expect(r.charges).toEqual({ deadBlinds: [{ seat: HERO_SEAT }], bbOnlyPosts: [] });
    expect(r.hero!.totalInvested).toBe(1.5);
  });

  it('a seat that leaves and sits again is new again', () => {
    const { engine, rows } = table({ heroId: VET });
    // The occupancy ended: the roster reconcile drops the veteran record.
    engine.dealtInUserIds.delete(VET);
    register(engine, VET);
    engine.postBBToEnter(VET);
    engine.sitOut(VET, false);
    expect(engine.returningFromSitout.has(VET)).toBe(false);
    const r = deal(engine, rows);
    expect(r.charges).toEqual({ deadBlinds: [], bbOnlyPosts: [{ seat: HERO_SEAT }] });
    expect(r.hero!.totalInvested).toBe(1);
  });

  it('a tournament seat is billed neither charge', () => {
    const { engine, rows } = table({ heroId: VET });
    engine.tableInfo = { game_type: 'tournament' };
    engine.sitOut(VET, false);
    engine.postingBBToEnter.add(VET);
    expect(engine.entryChargeSeats(rows)).toEqual({ deadBlinds: [], bbOnlyPosts: [] });
  });
});

describe('the hand itself never bills one seat two entry charges', () => {
  function start(over: Partial<HandConfig>, stack = 200) {
    const players = Array.from(
      { length: SEATS },
      (_, i) =>
        ({
          seat: i + 1,
          user_id: `u${i + 1}`,
          username: `P${i + 1}`,
          stack: i + 1 === HERO_SEAT ? stack : 200,
          bet: 0,
          totalInvested: 0,
          cards: [],
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        }) as SeatPlayer
    );
    const hc = new HandController(
      {
        tableId: 't',
        handNumber: 1,
        gameVariant: 'nlh',
        smallBlind: 0.5,
        bigBlind: 1,
        rakeConfig: { percent: 10, cap: 2.5, noFlopNoDrop: true },
        ...over,
      } as HandConfig,
      players,
      5
    );
    hc.start();
    const state = (hc as unknown as { state: { players: SeatPlayer[]; pot: number } }).state;
    return { hero: state.players.find((p) => p.seat === HERO_SEAT)!, pot: state.pot };
  }

  it('a seat named as both a dead blind and a post-to-enter is billed the entry post (any host, any caller)', () => {
    const { hero, pot } = start({ deadBlinds: [{ seat: 4 }], bbOnlyPosts: [{ seat: 4 }] });
    expect(hero.stack).toBe(199);
    expect(hero.bet).toBe(1);
    expect(hero.totalInvested).toBe(1);
    expect(hero.deadInvested ?? 0).toBe(0);
    expect(pot).toBe(2.5);
  });

  it('a duplicated post-to-enter entry bills one big blind', () => {
    const { hero } = start({ bbOnlyPosts: [{ seat: 4 }, { seat: 4 }] });
    expect(hero.stack).toBe(199);
    expect(hero.totalInvested).toBe(1);
  });
});

describe('a funded arrival enters without using the sit-out control', () => {
  it('queues the live blind from a clear seat and posts it only once', () => {
    const { engine, rows } = table();
    engine.registerWaitForBB(NEW, true);
    expect(engine.postBBWhenClear.has(NEW)).toBe(true);
    expect(engine.postBBToEnter(NEW)).toEqual({ success: true });
    expect(engine.postBBWhenClear.has(NEW)).toBe(false);
    expect(engine.waitingForBB.has(NEW)).toBe(false);
    expect(engine.entryChargeSeats(rows)).toMatchObject({
      deadBlinds: [],
      bbOnlyPosts: [{ seat: HERO_SEAT }],
    });
    expect(engine.disconnectEngine.sitBack).not.toHaveBeenCalled();
  });

  it('holds an arriving button seat until the position clears', () => {
    const { engine } = table();
    engine.getButtonSeatIndex = () => HERO_SEAT;
    engine.registerWaitForBB(NEW, true);
    expect(engine.postBBToEnter(NEW)).toMatchObject({ success: true, deferred: true });
    expect(engine.waitingForBB.has(NEW)).toBe(true);
    expect(engine.postingBBToEnter.has(NEW)).toBe(false);
    engine.getButtonSeatIndex = () => 5;
    expect(engine.postBBToEnter(NEW)).toEqual({ success: true });
    expect(engine.waitingForBB.has(NEW)).toBe(false);
    expect(engine.postingBBToEnter.has(NEW)).toBe(true);
  });
});
