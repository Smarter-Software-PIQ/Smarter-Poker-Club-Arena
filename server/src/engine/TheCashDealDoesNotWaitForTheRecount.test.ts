/**
 * THE NEXT CASH DEAL DOES NOT WAIT FOR WORK THAT CANNOT CHANGE IT
 * (Dan 2026-11-05: "AS SOON AS ONE CASH GAME HAND FINISHES AT A TABLE, THE
 * NEXT HAND NEEDS TO START WITHIN 2 SECONDS").
 *
 * Production 2026-11-09, 823 cash hands with per-step settlement timing: two
 * round trips ran in series after everything the next hand is dealt from was
 * already settled - the committed stack read after the post-commit envelope
 * (p50 147 ms, p99 800 ms) and the table_unlock recount (p50 132 ms, p99
 * 807 ms). These tests pin the three properties the change rests on:
 *   1. the deal barrier releases after the seats lane (stacks, add-ons, horse
 *      funding, stay clocks, departures, moves) and before the recount, and the
 *      recount still holds "settlement in flight" until it lands, in hand order;
 *   2. the committed stacks read beside the envelope are used only when nothing
 *      could have written a seat since - otherwise they are read again after;
 *   3. the timing budget: with every round trip at the measured p99, the
 *      barrier is two round trips shorter than before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  obligations: vi.fn(),
  leaves: vi.fn(),
  recount: vi.fn(),
}));
vi.mock('../services/supabase.js', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../services/supabase.js')),
  logHandHistory: mocks.commit,
  processHandPostCommitObligations: mocks.obligations,
  processLeavePending: mocks.leaves,
  reconcileTableSeatCount: mocks.recount,
}));
vi.mock('../services/financialAlerts.js', () => ({
  raiseFinancialAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/errorReporter.js', () => ({
  reportError: vi.fn(),
  describeError: (error: unknown) => String(error),
}));
import { ServerTableEngine } from './ServerTableEngine.js';
import { supabase } from '../services/supabase/client.js';

const id = '00000000-0000-0000-0000-0000000010a1';
const handId = '00000000-0000-0000-0000-0000001010a1';
const joinedAt = '2026-11-09T01:00:00.000Z';

function cashTable(tournament = false) {
  const engine = new ServerTableEngine(id) as any;
  engine.tableInfo = {
    id,
    club_id: 'club',
    tournament_id: tournament ? 'tournament' : null,
    cluster_id: null,
    game_variant: 'nlh',
    small_blind: 1,
    big_blind: 2,
    max_players: 6,
    min_buy_in: 20,
    max_buy_in: 200,
    rake_percent: 0,
    bbj_percent: 0,
  };
  const players = ['a', 'b'].map((user, i) => ({
    user_id: user,
    seat_id: `seat-${user}`,
    seat_joined_at: joinedAt,
    occupancy_id: `occupancy-${user}`,
    seat_number: i + 1,
    stack: i ? 110 : 90,
    is_horse: false,
  }));
  engine.seatedPlayers = players;
  engine.handCount = 9459700;
  engine.currentHandVariant = 'nlh';
  engine.currentHandPotSize = 20;
  engine.currentHandRake = 0;
  engine.currentHandBBJFee = 0;
  engine.currentHandInsuranceNet = 0;
  engine.currentHandContributions = new Map([
    ['a', 10],
    ['b', 10],
  ]);
  engine.currentHandDealtStacks = new Map([
    ['a', 100],
    ['b', 100],
  ]);
  engine.currentHandSeatGenerations = new Map(
    players.map((p) => [p.user_id, { seat_id: p.seat_id, seat_joined_at: p.seat_joined_at }])
  );
  engine.currentHandWinners = [{ userId: 'b', amount: 20 }];
  engine.currentHandStartedAt = Date.now() - 1000;
  engine.lifecycleCanMutate = () => true;
  engine.isTournamentTable = () => tournament;
  engine.hasCurrentEngineLeaseAuthority = () => true;
  engine.getEngineLeaseAuthority = () => ({ verified: true, generation: 'g', scope: 'cash' });
  engine.finishTerminalBoundaryPersistence = vi.fn();
  engine.announceEnvelopeResolvedAddOns = vi.fn().mockResolvedValue(undefined);
  engine.executePendingSeatMoves = vi.fn().mockResolvedValue(undefined);
  engine.wakeClusterGame = vi.fn();
  engine.killForRestart = vi.fn();
  engine.hub = { emitEvent: vi.fn(), sendToUser: vi.fn() };
  return { engine, players };
}

/** table_seats reads: each call is recorded with the moment it was sent. */
const seatReads: Array<{ at: string }> = [];
let phase = 'start';
let seatRows = [
  { user_id: 'a', stack: 90 },
  { user_id: 'b', stack: 110 },
];
beforeEach(() => {
  seatReads.length = 0;
  phase = 'start';
  seatRows = [
    { user_id: 'a', stack: 90 },
    { user_id: 'b', stack: 110 },
  ];
  mocks.commit.mockReset().mockResolvedValue({ handId, settlementCommitted: true });
  mocks.obligations.mockReset().mockImplementation(async () => {
    phase = 'envelope_answered';
    return { ok: true, pending_addons: 0 };
  });
  mocks.leaves.mockReset().mockResolvedValue([]);
  mocks.recount.mockReset().mockResolvedValue(2);
  vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: null } as any);
  vi.spyOn(supabase, 'from').mockImplementation((() => {
    seatReads.push({ at: phase });
    const chain: any = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(async () => ({ data: seatRows.map((r) => ({ ...r })), error: null })),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    return chain;
  }) as any);
});
afterEach(() => vi.restoreAllMocks());

const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe('1. the deal barrier releases before the recount, and the recount stays owned', () => {
  it('settles stacks, departures and moves, then releases the deal while the recount is in flight', async () => {
    const { engine, players } = cashTable();
    let finishRecount!: (n: number) => void;
    mocks.recount.mockImplementation(() => new Promise((r) => (finishRecount = r)));
    const order: string[] = [];
    mocks.leaves.mockImplementation(async () => {
      order.push('leave_pending');
      return [];
    });
    engine.wakeClusterGame = vi.fn(() => order.push('wake'));

    await engine.postHandTasks(players, 1);
    order.push('deal_barrier_released');

    // Everything the next hand is dealt from ran before the release.
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.obligations).toHaveBeenCalledTimes(1);
    expect(mocks.leaves).toHaveBeenCalledTimes(1);
    // The recount was sent but has not answered, and is still settlement.
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    expect(engine.hasSettlementInFlight()).toBe(true);
    expect(engine.tableUnlockTail).not.toBeNull();
    expect(engine.hub.emitEvent.mock.calls.some((c: any[]) => c[1].type === 'table_unlocked')).toBe(
      false
    );

    finishRecount(2);
    await engine.tableUnlockTail;
    await flush();
    expect(order).toEqual(['leave_pending', 'deal_barrier_released', 'wake']);
    expect(
      engine.hub.emitEvent.mock.calls.find((c: any[]) => c[1].type === 'table_unlocked')?.[1]
    ).toMatchObject({ hand_number: 9459700, seated_count: 2 });
    expect(engine.hasSettlementInFlight()).toBe(false);
    expect(engine.tableUnlockTail).toBeNull();
    expect(engine.postHandTimingSnapshot()).toMatchObject({ pipelineComplete: true });
  });

  it('a hand whose lanes run in series (insurance, a jackpot hit) still finishes its recount', async () => {
    // Native EV smoke 2026-11-09: with the lanes serialized the step runs only
    // after this hand's own tail is published, so it must never wait on it.
    const { engine, players } = cashTable();
    engine.currentHandMiniBBJHit = {}; // serializes the lanes; no payout (hit is falsy)
    await engine.postHandTasks(players, 1);
    const tail = engine.tableUnlockTail;
    const landed = await Promise.race([
      tail.then(() => 'landed'),
      new Promise((r) => setTimeout(() => r('stuck'), 1_000)),
    ]);
    expect(landed).toBe('landed');
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    expect(engine.hasSettlementInFlight()).toBe(false);
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it("the next hand's recount is not sent before the previous one has answered", async () => {
    const { engine, players } = cashTable();
    const answers: Array<(n: number) => void> = [];
    mocks.recount.mockImplementation(() => new Promise((r) => answers.push(r)));
    await engine.postHandTasks(players, 1);
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    engine.handCount = 9459701;
    await engine.postHandTasks(players, 2);
    // Hand 2's deal barrier released; its recount waits behind hand 1's.
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    answers[0](2);
    await flush();
    expect(mocks.recount).toHaveBeenCalledTimes(2);
    answers[1](2);
    await engine.tableUnlockTail;
    await flush();
    expect(
      engine.hub.emitEvent.mock.calls
        .filter((c: any[]) => c[1].type === 'table_unlocked')
        .map((c: any[]) => c[1].hand_number)
    ).toEqual([9459700, 9459701]);
  });

  it('stop joins the recount: the drain cannot release the table under it', async () => {
    const { engine, players } = cashTable();
    let finishRecount!: (n: number) => void;
    mocks.recount.mockImplementation(() => new Promise((r) => (finishRecount = r)));
    await engine.postHandTasks(players, 1);
    expect(engine.hasSettlementInFlight()).toBe(true);
    expect(engine.hasAccountingInFlight()).toBe(true);
    finishRecount(2);
    await engine.tableUnlockTail;
    await flush();
    expect(engine.hasSettlementInFlight()).toBe(false);
  });

  it('a tournament table keeps the whole barrier: the recount lands before the release', async () => {
    const { engine, players } = cashTable();
    expect(engine.dealWaitsForRecount()).toBe(false);
    engine.isTournamentTable = () => true;
    expect(engine.dealWaitsForRecount()).toBe(true);
    // The money steps keep the cash fixture's path; only the barrier choice
    // is the tournament one.
    engine.isTournamentTable = () => false;
    engine.dealWaitsForRecount = () => true;
    let landed = false;
    mocks.recount.mockImplementation(async () => {
      await flush();
      landed = true;
      return 2;
    });
    await engine.postHandTasks(players, 1);
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    expect(landed).toBe(true);
    expect(engine.tableUnlockTail ?? null).toBeNull();
    expect(engine.wakeClusterGame).toHaveBeenCalledWith('hand_complete');
  });
});

describe('1b. a deferred recount that fails or times out', () => {
  it('a timeout is recorded once, moves nothing, and the next boundary recounts', async () => {
    const { engine, players } = cashTable();
    const { raiseFinancialAlert } = await import('../services/financialAlerts.js');
    vi.mocked(raiseFinancialAlert).mockClear();
    mocks.recount.mockRejectedValueOnce(new Error('supabase_timeout'));
    await engine.postHandTasks(players, 1);
    // The deal was released with the stacks already settled.
    expect(players.map((p: any) => p.stack)).toEqual([90, 110]);
    await engine.tableUnlockTail;
    await flush();
    // One attempt (no budget), recorded once, nothing re-applied, table freed.
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    const alerts = vi
      .mocked(raiseFinancialAlert)
      .mock.calls.filter((c: any[]) => c[1] === 'postHandTasks.table_unlock_failed');
    expect(alerts).toHaveLength(1);
    expect(engine.hasSettlementInFlight()).toBe(false);
    expect(players.map((p: any) => p.stack)).toEqual([90, 110]);
    expect(mocks.obligations).toHaveBeenCalledTimes(1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    // Recoverable: the next hand's recount runs and corrects the summary.
    engine.handCount = 9459701;
    await engine.postHandTasks(players, 2);
    await engine.tableUnlockTail;
    expect(mocks.recount).toHaveBeenCalledTimes(2);
  });

  it('the next deal never reads a stack the deferred work could change', async () => {
    // Everything after the deal barrier in a cash hand: only the recount. It
    // receives no stack and returns only a count.
    const SETTLEMENT = (await import('node:fs')).readFileSync(
      new URL('./ServerTableEngineSettlement.ts', import.meta.url),
      'utf8'
    );
    const start = SETTLEMENT.indexOf("await runStep('table_unlock'");
    const end = SETTLEMENT.indexOf('const finishLanesTiming', start);
    const deferred = SETTLEMENT.slice(start, end);
    expect(deferred).toContain('reconcileTableSeatCount(this.tableId');
    expect(deferred).not.toMatch(
      /\.stack\b|stack:|addChips|resolve_pending_addon|autoRebuyHorse|cashout/i
    );
    // And the deal barrier is taken after every seat-lane step is queued.
    const dealReady = SETTLEMENT.indexOf('const dealReady =');
    expect(dealReady).toBeGreaterThan(SETTLEMENT.indexOf("await runStep('leave_pending'"));
    expect(dealReady).toBeLessThan(start);
  });
});

describe('2. the committed stacks read beside the envelope', () => {
  it('a hand after one this engine settled sends the read beside the envelope and uses it', async () => {
    const { engine, players } = cashTable();
    await engine.postHandTasks(players, 1); // first hand: read after, as before
    await engine.tableUnlockTail;
    expect(seatReads.map((r) => r.at)).toEqual(['envelope_answered']);
    expect(engine.envelopeChainApplied).toBe(true);

    seatReads.length = 0;
    phase = 'start';
    engine.handCount = 9459701;
    await engine.postHandTasks(players, 2);
    await engine.tableUnlockTail;
    expect(seatReads.map((r) => r.at)).toEqual(['start']);
    expect(players.map((p) => p.stack)).toEqual([90, 110]);
  });

  it('an envelope that resolved an add-on sends it back to a read after the envelope', async () => {
    const { engine, players } = cashTable();
    engine.envelopeChainApplied = true;
    mocks.obligations.mockImplementation(async () => {
      phase = 'envelope_answered';
      seatRows = [
        { user_id: 'a', stack: 140 }, // the envelope's resolve_pending_addon credit
        { user_id: 'b', stack: 110 },
      ];
      return { ok: true, pending_addons: 1 };
    });
    await engine.postHandTasks(players, 1);
    expect(seatReads.map((r) => r.at)).toEqual(['start', 'envelope_answered']);
    expect(players.map((p) => p.stack)).toEqual([140, 110]);
  });

  it('an older receipt shape (no add-on count) reads after, as before', async () => {
    const { engine, players } = cashTable();
    engine.envelopeChainApplied = true;
    mocks.obligations.mockImplementation(async () => {
      phase = 'envelope_answered';
      return { ok: true };
    });
    await engine.postHandTasks(players, 1);
    expect(seatReads.map((r) => r.at)).toEqual(['start', 'envelope_answered']);
  });

  it('a direct seat credit that starts after the read was sent invalidates it', async () => {
    const { engine, players } = cashTable();
    engine.envelopeChainApplied = true;
    mocks.obligations.mockImplementation(async () => {
      // atomic_table_addon applying to the seat, between hands, under the envelope
      engine.directSeatCreditsInFlight++;
      engine.directSeatCreditEpoch++;
      seatRows = [
        { user_id: 'a', stack: 150 },
        { user_id: 'b', stack: 110 },
      ];
      engine.directSeatCreditsInFlight--;
      phase = 'envelope_answered';
      return { ok: true, pending_addons: 0 };
    });
    await engine.postHandTasks(players, 1);
    expect(seatReads.map((r) => r.at)).toEqual(['start', 'envelope_answered']);
    expect(players.map((p) => p.stack)).toEqual([150, 110]);
  });

  it('a seat credit already in flight sends no read beside the envelope', async () => {
    const { engine, players } = cashTable();
    engine.envelopeChainApplied = true;
    engine.directSeatCreditsInFlight = 1;
    const run = engine.postHandTasks(players, 1);
    await flush();
    engine.directSeatCreditsInFlight = 0;
    await run;
    expect(seatReads.map((r) => r.at)).toEqual(['envelope_answered']);
  });

  it('a fresh engine, an abandoned envelope or a halted Cluster table reads after', async () => {
    for (const setup of [
      (e: any) => (e.envelopeChainApplied = false),
      (e: any) => {
        e.envelopeChainApplied = true;
        e.dealingHaltLock = true;
      },
      (e: any) => {
        e.envelopeChainApplied = true;
        e.tableInfo.cluster_id = 'cluster';
        e.clusterLightningEnabled = null;
      },
    ]) {
      seatReads.length = 0;
      phase = 'start';
      const { engine, players } = cashTable();
      setup(engine);
      await engine.postHandTasks(players, 1);
      expect(seatReads.map((r) => r.at)).toEqual(['envelope_answered']);
    }
  });

  it('the direct top-up path counts itself while it may write the seat', async () => {
    const { engine } = cashTable();
    engine.handController = null;
    const epoch = engine.directSeatCreditEpoch;
    let seen = -1;
    vi.mocked(supabase.rpc).mockImplementation((async () => {
      seen = engine.directSeatCreditsInFlight; // atomic_table_addon applying to the seat
      return { data: null, error: { message: 'insufficient balance' } };
    }) as any);
    engine.readCashAddonReceipt = vi.fn().mockResolvedValue(null);
    await engine.addChipsDecided('a', 10, 'op-1');
    expect(seen).toBe(1);
    expect(engine.directSeatCreditsInFlight).toBe(0);
    expect(engine.directSeatCreditEpoch).toBe(epoch + 1);
  });
});

describe('3. the timing budget', () => {
  it('with every round trip at its measured p99, the deal barrier is two round trips shorter', async () => {
    vi.useFakeTimers();
    try {
      const P99 = {
        commit: 1746,
        envelope: 889,
        read: 800,
        continuity: 838,
        leave: 643,
        recount: 807,
      };
      const after = (ms: number, value: unknown) =>
        new Promise((r) => setTimeout(() => r(value), ms));
      const measure = async () => {
        const { engine, players } = cashTable();
        engine.envelopeChainApplied = true;
        mocks.commit.mockImplementation(() =>
          after(P99.commit, { handId, settlementCommitted: true })
        );
        mocks.obligations.mockImplementation(() =>
          after(P99.envelope, { ok: true, pending_addons: 0 })
        );
        mocks.leaves.mockImplementation(() => after(P99.leave, []));
        mocks.recount.mockImplementation(() => after(P99.recount, 2));
        engine.chipContinuity.evaluate = () => after(P99.continuity, undefined);
        vi.mocked(supabase.from).mockImplementation((() => {
          const chain: any = {
            select: vi.fn(),
            eq: vi.fn(),
            is: vi.fn(() => after(P99.read, { data: seatRows, error: null })),
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }) as any);
        const start = Date.now();
        let released = -1;
        const run = engine.postHandTasks(players, 1).then(() => (released = Date.now() - start));
        await vi.advanceTimersByTimeAsync(20_000);
        await run;
        await engine.tableUnlockTail;
        return released;
      };
      const released = await measure();
      const serialBefore =
        P99.commit + P99.envelope + P99.read + P99.continuity + P99.leave + P99.recount;
      // The commit, the envelope (with the stack read beside it), stay clocks
      // and departures: the read and the recount are off the deal's path.
      expect(released).toBe(P99.commit + P99.envelope + P99.continuity + P99.leave);
      expect(serialBefore - released).toBe(P99.read + P99.recount);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* Owner merge gate for #10165 (2026-11-09): settlement ordering changed, so
   conservation, concurrency, retry and partial failure are proven before it
   may merge. The PostgreSQL side lives in
   scripts/ci/probes/chip-journal-atomicity/test_deferred_settlement.py; these
   pin the engine side of the same four properties with the tail deferred. */
describe('4. the deferred tail conserves, serializes, retries once and fails whole', () => {
  /** One hand: dealt stacks, contributions, winners, and the stacks it ended with. */
  function playHand(
    engine: any,
    players: any[],
    n: number,
    hand: { dealt: [number, number]; put: [number, number]; winner: 'a' | 'b'; addOn?: number }
  ) {
    engine.handCount = n;
    const pot = hand.put[0] + hand.put[1];
    engine.currentHandPotSize = pot;
    engine.currentHandDealtStacks = new Map([
      ['a', hand.dealt[0]],
      ['b', hand.dealt[1]],
    ]);
    engine.currentHandContributions = new Map([
      ['a', hand.put[0]],
      ['b', hand.put[1]],
    ]);
    engine.currentHandWinners = [{ userId: hand.winner, amount: pot }];
    engine.currentHandStartedAt = Date.now() - 1000;
    const ended = [
      hand.dealt[0] - hand.put[0] + (hand.winner === 'a' ? pot : 0),
      hand.dealt[1] - hand.put[1] + (hand.winner === 'b' ? pot : 0),
    ];
    players[0].stack = ended[0];
    players[1].stack = ended[1];
    // The atomic commit writes the ended stacks; the envelope may then credit
    // one frozen add-on to seat a (resolve_pending_addon) and says so.
    mocks.commit.mockImplementationOnce(async () => {
      seatRows = [
        { user_id: 'a', stack: ended[0] },
        { user_id: 'b', stack: ended[1] },
      ];
      return { handId: `hand-${n}`, settlementCommitted: true };
    });
    mocks.obligations.mockImplementationOnce(async () => {
      if (hand.addOn) seatRows[0] = { user_id: 'a', stack: seatRows[0].stack + hand.addOn };
      phase = 'envelope_answered';
      return { ok: true, pending_addons: hand.addOn ? 1 : 0 };
    });
    return engine.postHandTasks(players, n - 9459699);
  }
  const total = (players: any[]) => players.reduce((s, p) => s + p.stack, 0);
  const rowsOf = () => seatRows.map((r) => r.stack);
  const unlocked = (engine: any) =>
    engine.hub.emitEvent.mock.calls
      .filter((c: any[]) => c[1].type === 'table_unlocked')
      .map((c: any[]) => c[1].hand_number);

  it('conservation: three hands with overlapping tails hold every chip exactly once', async () => {
    const { engine, players } = cashTable();
    const answers: Array<(n: number) => void> = [];
    mocks.recount.mockImplementation(() => new Promise((r) => answers.push(r)));

    await playHand(engine, players, 9459700, { dealt: [100, 100], put: [10, 10], winner: 'b' });
    expect(players.map((p) => p.stack)).toEqual([90, 110]);
    expect(total(players)).toBe(200);

    // Hand 2 settles while hand 1's recount is still out; its envelope
    // credits a 25 add-on, so the committed stacks are read again after it.
    await playHand(engine, players, 9459701, {
      dealt: [90, 110],
      put: [10, 10],
      winner: 'a',
      addOn: 25,
    });
    expect(players.map((p) => p.stack)).toEqual(rowsOf());
    expect(players.map((p) => p.stack)).toEqual([125, 100]);
    expect(total(players)).toBe(225); // 200 + the one add-on, credited once

    // Hand 3 uses the read beside its envelope (no add-on, no seat credit).
    seatReads.length = 0;
    phase = 'start';
    await playHand(engine, players, 9459702, { dealt: [125, 100], put: [5, 5], winner: 'b' });
    expect(seatReads.map((r) => r.at)).toEqual(['start']);
    expect(players.map((p) => p.stack)).toEqual(rowsOf());
    expect(total(players)).toBe(225);

    // Every hand committed and ran its envelope exactly once, before its
    // release; the tails have moved nothing.
    expect(mocks.commit).toHaveBeenCalledTimes(3);
    expect(mocks.obligations).toHaveBeenCalledTimes(3);
    for (const answer of [0, 1, 2]) {
      await flush();
      answers[answer]?.(2);
    }
    await engine.tableUnlockTail;
    await flush();
    expect(unlocked(engine)).toEqual([9459700, 9459701, 9459702]);
    expect(total(players)).toBe(225);
    expect(players.map((p) => p.stack)).toEqual(rowsOf());
    expect(engine.hasSettlementInFlight()).toBe(false);
  });

  it('concurrency: back-to-back hands never have two recounts in flight, and none outlive a lost lifecycle', async () => {
    const { engine, players } = cashTable();
    let inFlight = 0;
    let peak = 0;
    const answers: Array<() => void> = [];
    mocks.recount.mockImplementation(
      () =>
        new Promise((r) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          answers.push(() => {
            inFlight--;
            r(2);
          });
        })
    );
    for (const n of [9459700, 9459701, 9459702]) {
      await playHand(engine, players, n, {
        dealt: [
          players[0].stack + (n === 9459700 ? 10 : 0),
          players[1].stack - (n === 9459700 ? 10 : 0),
        ],
        put: [5, 5],
        winner: n % 2 ? 'a' : 'b',
      });
    }
    // Three deals released; one recount out, two queued behind it in order.
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    answers[0]();
    await flush();
    expect(mocks.recount).toHaveBeenCalledTimes(2);
    // The generation loses the table while hand 2's recount is out: hand 3's
    // is never sent and nothing is announced for it by the stale generation.
    engine.lifecycleCanMutate = () => false;
    answers[1]();
    await flush();
    expect(peak).toBe(1);
    expect(mocks.recount).toHaveBeenCalledTimes(2);
    await engine.tableUnlockTail;
    await flush();
    expect(unlocked(engine)).not.toContain(9459702);
    expect(engine.hasSettlementInFlight()).toBe(false);
    expect(mocks.commit).toHaveBeenCalledTimes(3);
    expect(mocks.obligations).toHaveBeenCalledTimes(3);
    expect(total(players)).toBe(200);
  });

  it('retry: an envelope reply lost once is applied once, and its add-on is read once', async () => {
    const { engine, players } = cashTable();
    engine.envelopeChainApplied = true;
    // The first attempt commits in the database (the add-on lands) but its
    // reply is lost; the retry gets the stored receipt, which counts it.
    mocks.obligations
      .mockImplementationOnce(async () => {
        seatRows = [
          { user_id: 'a', stack: 115 },
          { user_id: 'b', stack: 110 },
        ];
        throw new Error('supabase_timeout');
      })
      .mockImplementationOnce(async () => {
        phase = 'envelope_answered';
        return { ok: true, pending_addons: 1, already_completed: true };
      });
    await engine.postHandTasks(players, 1);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.obligations).toHaveBeenCalledTimes(2);
    // The read sent beside the first attempt predates the add-on: discarded.
    expect(seatReads.map((r) => r.at)).toEqual(['start', 'envelope_answered']);
    expect(players.map((p) => p.stack)).toEqual([115, 110]);
    expect(total(players)).toBe(225);
    expect(engine.announceEnvelopeResolvedAddOns).toHaveBeenCalledTimes(1);
    expect(engine.envelopeChainApplied).toBe(true);
    await engine.tableUnlockTail;
    expect(mocks.recount).toHaveBeenCalledTimes(1);
    expect(unlocked(engine)).toEqual([9459700]);
  });

  it('partial failure: a recount that fails mid-tail strands nothing and credits nothing twice', async () => {
    const { engine, players } = cashTable();
    let failFirst!: (e: Error) => void;
    mocks.recount
      .mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)))
      .mockResolvedValue(2);
    await playHand(engine, players, 9459700, { dealt: [100, 100], put: [10, 10], winner: 'b' });
    await playHand(engine, players, 9459701, { dealt: [90, 110], put: [10, 10], winner: 'a' });
    const rpcBefore = vi.mocked(supabase.rpc).mock.calls.length;
    const fromBefore = vi.mocked(supabase.from).mock.calls.length;
    // Hand 1's recount fails while hand 2 is already dealt and settled.
    failFirst(new Error('supabase_timeout'));
    await flush();
    await engine.tableUnlockTail;
    await flush();
    // Hand 2's recount still ran after it and its table is unlocked; hand 1's
    // failure is announced as nothing but a failure.
    expect(mocks.recount).toHaveBeenCalledTimes(2);
    expect(unlocked(engine)).toEqual([9459701]);
    // The tail sent nothing but the recount: no hand number, no manifest, no
    // seat or wallet write, so no row is left that no hand carries.
    expect(vi.mocked(supabase.rpc).mock.calls.length).toBe(rpcBefore);
    expect(vi.mocked(supabase.from).mock.calls.length).toBe(fromBefore);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.obligations).toHaveBeenCalledTimes(2);
    expect(players.map((p) => p.stack)).toEqual(rowsOf());
    expect(total(players)).toBe(200);
    expect(engine.hasSettlementInFlight()).toBe(false);
    expect(engine.tableUnlockTail).toBeNull();
  });
});
