import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let GameServer: (typeof import('./GameServer.js'))['GameServer'];
let TournamentManagerBase: (typeof import('./tournament/TournamentManagerBase.js'))['TournamentManagerBase'];
let ServerTableEngineBase: (typeof import('./engine/ServerTableEngineBase.js'))['ServerTableEngineBase'];
let supabase: (typeof import('./services/supabase.js'))['supabase'];

beforeAll(async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-placeholder-key';
  ({ GameServer } = await import('./GameServer.js'));
  ({ TournamentManagerBase } = await import('./tournament/TournamentManagerBase.js'));
  ({ supabase } = await import('./services/supabase.js'));
  ({ ServerTableEngineBase } = await import('./engine/ServerTableEngineBase.js'));
}, 60_000); // importing GameServer alone can pass 10s on a loaded CI runner
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T12:55:00.000Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function manager(id: string) {
  return Object.assign(Object.create(TournamentManagerBase.prototype), {
    tournamentId: id,
    currentLevel: 0,
    onBreak: true,
    breakCountdownStarted: false,
    synchronizedBreakStartGeneration: 0,
    synchronizedBreakEndsAtMs: 0,
    breakCountdownAnchor: { generation: 0, startedAt: '2026-09-10T12:55:00.000Z' },
    captureLifecycleToken: () => 1,
    lifecycleIsCurrent: () => true,
    isRunning: () => true,
    takesSynchronizedBreaks: () => true,
    pauseForBreak: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn().mockResolvedValue(true),
    resumeFromBreak: vi.fn().mockResolvedValue(undefined),
  });
}

/**
 * `maintenanceEndsAt` is what MaintenanceBreak.endsAt() answers: 0 when no
 * maintenance break is on (the default, and every case written before
 * 2026-09-10), otherwise the instant the platform comes off it.
 */
function server(managers: ReturnType<typeof manager>[], maintenanceEndsAt = 0) {
  return Object.assign(Object.create(GameServer.prototype), {
    lifecycleGeneration: 1,
    running: true,
    breakCountdownStarted: true,
    breakEndsWithMaintenance: false,
    synchronizedBreakGeneration: 0,
    directAdmissionIsCurrent: () => true,
    tournamentEngines: new Map(managers.map((entry) => [entry.tournamentId, entry])),
    breakEndsAt: 0,
    breakResumeTimer: null,
    // The synchronized break asks the one-break end (an active break's end,
    // or the next scheduled hourly break it would overlap); these cases fix it.
    maintenanceBreak: {
      endsAt: vi.fn(() => maintenanceEndsAt),
      tournamentBreakEndsAt: vi.fn(() => maintenanceEndsAt),
    },
    waitForAllTablesParked: vi.fn().mockResolvedValue(true),
    launchServerLifecycleJob: vi.fn(),
  });
}

/**
 * Let every queued continuation run without moving the fake clock. The pauses
 * and countdown writes are awaited together (Promise.all), which costs a few
 * more microtask turns than the one-at-a-time loop did.
 */
async function settle(turns = 10) {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function persistence(delayMs = 0) {
  const writes: { id: string; deadline: string }[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  vi.spyOn(supabase, 'from').mockImplementation(() => {
    let patch: { break_ends_at: string } | undefined;
    const predicates = new Map<string, unknown>();
    const query = {
      select: () => query,
      update: (value: { break_ends_at: string }) => {
        patch = value;
        return query;
      },
      eq: (column: string, value: unknown) => {
        predicates.set(column, value);
        return query;
      },
      is: (column: string, value: unknown) => {
        predicates.set(column, value);
        return query;
      },
      maybeSingle: async () => {
        const id = predicates.get('id') as string;
        const row = rows.get(id) ?? {
          id,
          on_break: true,
          break_started_at: '2026-09-10T12:55:00.000Z',
          break_ends_at: null,
        };
        if ([...predicates].some(([key, value]) => row[key] !== value))
          return { data: null, error: null };
        if (patch) {
          writes.push({ id, deadline: patch.break_ends_at });
          Object.assign(row, patch);
          rows.set(id, row);
          vi.setSystemTime(Date.now() + delayMs);
        }
        return { data: { ...row }, error: null };
      },
    };
    return query as never;
  });
  return writes;
}

describe('Synchronized Break Deadline', () => {
  /*
   * Dan 2026-10-25, verbatim: "THE 5 MINUTE BREAK FOR ALL TOURNAMENTS DOES NOT
   * START FOR THE TOURNAMENT UNTIL ALL HANDS FOR THAT SPECIFIC TOURNAMENT ARE
   * COMPLETED ... EVERY TOURNAMENT WILL START AND STOP THERE 5 MINUTE BREAK AT
   * DIFFERENT TIMES WITH THIS SETTING. BUT THIS IS 100% HOW ITS SUPPOSED TO BE."
   */
  it('starts each tournament its own five minutes when its own last hand lands, and resumes it on its own', async () => {
    const quick = manager('quick');
    const slow = manager('slow');
    const owner = server([quick, slow]);
    const parkedAt = new Map<string, number>([
      ['quick', Date.parse('2026-09-10T12:55:00.000Z')],
      ['slow', Date.parse('2026-09-10T12:55:40.000Z')],
    ]);
    owner.waitForAllTablesParked.mockImplementation(
      async (managers: { tournamentId: string }[]) => {
        expect(managers).toHaveLength(1);
        const at = parkedAt.get(managers[0].tournamentId)!;
        await vi.advanceTimersByTimeAsync(Math.max(0, at - Date.now()));
        return true;
      }
    );
    const writes = persistence();
    await owner.triggerSynchronizedBreak();

    const quickEnd = Date.parse('2026-09-10T13:00:00.000Z');
    const slowEnd = Date.parse('2026-09-10T13:00:40.000Z');
    // The quick tournament's clock started at once; it never waited 40s on the slow one.
    expect(writes).toEqual([
      { id: 'quick', deadline: new Date(quickEnd).toISOString() },
      { id: 'slow', deadline: new Date(slowEnd).toISOString() },
    ]);
    expect(quick.broadcast).toHaveBeenCalledWith(
      'tournament_break_started',
      expect.objectContaining({ breakEndsAt: new Date(quickEnd).toISOString() })
    );
    expect(slow.broadcast).toHaveBeenCalledWith(
      'tournament_break_started',
      expect.objectContaining({ breakEndsAt: new Date(slowEnd).toISOString() })
    );
    expect(owner.breakEndsAt).toBe(slowEnd);

    // Each resumes at its own end, and the quick one's timer does not touch the slow one.
    await vi.advanceTimersByTimeAsync(quickEnd - Date.now());
    expect(quick.resumeFromBreak).toHaveBeenCalledOnce();
    expect(slow.resumeFromBreak).not.toHaveBeenCalled();
    // A newcomer is still held while the slow one is on its break.
    expect(owner.remainingBreakMs()).toBe(slowEnd - Date.now());
    await vi.advanceTimersByTimeAsync(slowEnd - Date.now());
    expect(slow.resumeFromBreak).toHaveBeenCalledOnce();
    expect(quick.resumeFromBreak).toHaveBeenCalledOnce();
    expect(owner.breakEndsAt).toBe(0);
  });

  it('gives a late entrant the existing deadline even when its pause takes time', async () => {
    const entrant = manager('late');
    const owner = server([entrant]);
    owner.breakEndsAt = Date.parse('2026-09-10T13:00:00.000Z');
    vi.setSystemTime(new Date('2026-09-10T12:58:00.000Z'));
    entrant.pauseForBreak.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 2_000);
    });
    const writes = persistence();
    await owner.holdIfBreakIsRunning(entrant);
    expect(writes).toEqual([{ id: 'late', deadline: '2026-09-10T13:00:00.000Z' }]);
  });

  it('does not publish a countdown while the participating hand is still draining', async () => {
    const participant = manager('draining');
    const owner = server([participant]);
    let finish!: (parked: boolean) => void;
    owner.waitForAllTablesParked.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const writes = persistence();
    const pending = owner.triggerSynchronizedBreak();
    await settle();
    expect(owner.waitForAllTablesParked).toHaveBeenCalledOnce();
    expect(writes).toEqual([]);
    expect(participant.broadcast).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 70_000);
    finish(true);
    await pending;
    expect(writes).toEqual([{ id: 'draining', deadline: '2026-09-10T13:01:10.000Z' }]);
  });
});

describe('Synchronized Break Drain', () => {
  it('gives a newcomer in the drain phase its own five minutes once its own tables are parked', async () => {
    const entrant = manager('during-drain');
    const owner = server([entrant]);
    owner.breakEndsAt = Date.now() + 420_000;
    owner.breakCountdownStarted = false;
    const writes = persistence();
    await owner.holdIfBreakIsRunning(entrant);
    expect(entrant.pauseForBreak).toHaveBeenCalledOnce();
    expect(owner.waitForAllTablesParked).toHaveBeenCalledWith([entrant]);
    expect(writes).toEqual([{ id: 'during-drain', deadline: '2026-09-10T13:00:00.000Z' }]);
  });

  it('treats a failed table inspection as an unproven drain', () => {
    const participant = manager('unknown');
    participant.tableEngines = new Map([
      [
        'table',
        {
          isWaitingForHandForHand: () => {
            throw new Error('inspection unavailable');
          },
        },
      ],
    ]);
    expect(participant.areAllTablesParked()).toBe(false);
  });

  it('waits for the real hand boundary beyond the old last-hand grace', async () => {
    const participant = manager('slow');
    const owner = server([participant]);
    owner.running = true;
    const started = Date.now();
    participant.areAllTablesParked = () => Date.now() >= started + 121_000;
    owner.sleep = async (milliseconds: number) => {
      vi.setSystemTime(Date.now() + milliseconds);
    };
    const parked = await (GameServer.prototype as any).waitForAllTablesParked.call(owner, [
      participant,
    ]);
    expect(parked).toBe(true);
    expect(Date.now() - started).toBe(121_000);
  });

  function table() {
    const state = { state: 'running', transition: vi.fn() };
    const engine = Object.assign(Object.create(ServerTableEngineBase.prototype), {
      tableId: 'long-drain',
      running: true,
      handForHandPaused: false,
      maintenancePaused: false,
      finalTableDealPaused: false,
      terminalCloseoutPaused: false,
      holdBeforeNextHand: false,
      pauseRequiresExplicitResume: false,
      tournamentMovePauseOwners: new Map(),
      claimedTournamentMovePauseOwners: new Set(),
      breakHeldTournamentMovePauseOwners: new Set(),
      f06MovementAdmission: null,
      handForHandResolve: null,
      pausedSinceMs: 0,
      pauseMaxWaitMs: null,
      pauseGateTimer: null,
      tableFSM: state,
      armUnclaimedTournamentMovePauseExpiry: vi.fn(),
      notifyBoundaryPauseWaiters: vi.fn(),
      markProgress: vi.fn(),
    });
    state.transition.mockImplementation((next: string) => {
      state.state = next;
    });
    return engine;
  }

  it('keeps an explicitly owned break parked until its manager releases it', async () => {
    const engine = table();
    engine.pauseAfterHand(420_000, { beforeNextHand: true, untilResumed: true });
    let released = false;
    const waiting = engine.awaitPauseGate().then(() => {
      released = true;
    });
    await vi.advanceTimersByTimeAsync(421_000);
    expect(released).toBe(false);
    expect(engine.isWaitingForHandForHand()).toBe(true);
    engine.resumeDealing();
    await waiting;
    expect(released).toBe(true);
  });

  it('retains the ordinary hand-for-hand safety timeout', async () => {
    const engine = table();
    engine.pauseAfterHand();
    let released = false;
    const waiting = engine.awaitPauseGate().then(() => {
      released = true;
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await waiting;
    expect(released).toBe(true);
  });
});

// Append to server/src/SynchronizedBreakDeadline.test.ts in the clock lane.
// This is one additional regression case, with ended-owner and replaced-owner branches.
describe('Synchronized Break Pause Completion', () => {
  it('reconciles a late pause only for the break owner that requested it', async () => {
    for (const replaced of [false, true]) {
      vi.setSystemTime(new Date('2026-09-10T12:59:58.000Z'));
      const entrant = manager(replaced ? 'new-owner' : 'ended-owner');
      const owner = server([entrant]);
      owner.synchronizedBreakGeneration = 1;
      owner.breakEndsAt = Date.parse('2026-09-10T13:00:00.000Z');
      let finishPause!: () => void;
      entrant.pauseForBreak.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishPause = resolve;
          })
      );
      persistence();
      const pending = owner.holdIfBreakIsRunning(entrant);
      vi.setSystemTime(new Date('2026-09-10T13:00:01.000Z'));
      owner.breakEndsAt = 0;
      if (replaced) {
        owner.synchronizedBreakGeneration = 2;
        owner.breakEndsAt = Date.parse('2026-09-10T14:00:00.000Z');
      }
      finishPause();
      await pending;
      expect(entrant.resumeFromBreak).toHaveBeenCalledTimes(replaced ? 0 : 1);
      expect(entrant.broadcast).not.toHaveBeenCalled();
    }
  });
});

/*
 * 2026-09-10: the maintenance break has every table finishing its hand from
 * :53 and holds it at the gate by :55, but the tournament drain only accepted
 * `isWaitingForHandForHand()`. At 12:55 it waited out the old 120 s grace and
 * every tournament resumed at 13:02:30; with that grace removed (#4105) the
 * same wait had no end. Parked means no cards in the air, whoever holds the
 * table - and the drain now has a liveness ceiling and names who it waits on.
 */
describe('A table the maintenance break holds is parked', () => {
  function stub(state: {
    gate?: boolean;
    running?: boolean;
    maintenance?: boolean;
    between?: boolean;
    handForHand?: boolean;
  }) {
    return {
      isWaitingForHandForHand: () => Boolean(state.handForHand && state.gate),
      isParkedBetweenHands: () => Boolean(state.gate) || state.running === false,
      isMaintenancePaused: () => Boolean(state.maintenance),
      isBetweenHands: () => Boolean(state.between),
    };
  }

  function heldEngine() {
    const fsm = { state: 'running', transition: vi.fn() };
    const engine = Object.assign(Object.create(ServerTableEngineBase.prototype), {
      tableId: 'maintenance-held',
      running: true,
      handForHandPaused: false,
      maintenancePaused: true,
      finalTableDealPaused: false,
      terminalCloseoutPaused: false,
      holdBeforeNextHand: true,
      pauseRequiresExplicitResume: false,
      tournamentMovePauseOwners: new Map(),
      claimedTournamentMovePauseOwners: new Set(),
      breakHeldTournamentMovePauseOwners: new Set(),
      f06MovementAdmission: null,
      handForHandResolve: null,
      pausedSinceMs: 0,
      pauseMaxWaitMs: 420_000,
      pauseGateTimer: null,
      tableFSM: fsm,
      armUnclaimedTournamentMovePauseExpiry: vi.fn(),
      notifyBoundaryPauseWaiters: vi.fn(),
      markProgress: vi.fn(),
    });
    fsm.transition.mockImplementation((next: string) => {
      fsm.state = next;
    });
    return engine;
  }

  it('counts a gate held by maintenance, a stopped engine, and a held table with no hand in flight', () => {
    const participant = manager('held');
    participant.tableEngines = new Map([
      ['gate', stub({ gate: true, maintenance: true })],
      ['stopped', stub({ running: false })],
      ['between', stub({ maintenance: true, between: true })],
    ]);
    expect(participant.areAllTablesParked()).toBe(true);
  });

  it('still waits on a table with cards in the air', () => {
    const participant = manager('live');
    participant.tableEngines = new Map([
      ['gate', stub({ gate: true, maintenance: true })],
      ['live', stub({ maintenance: true, between: false })],
    ]);
    expect(participant.areAllTablesParked()).toBe(false);
    // Between hands but held by nobody: it may deal the next one, so not yet.
    participant.tableEngines.set('live', stub({ between: true }));
    expect(participant.areAllTablesParked()).toBe(false);
  });

  it('parks a real engine the maintenance break holds, which the old predicate never did', async () => {
    const engine = heldEngine();
    void engine.awaitPauseGate();
    await Promise.resolve();
    expect(engine.isWaitingForHandForHand()).toBe(false);
    const participant = manager('maintenance-held');
    participant.tableEngines = new Map([['t', engine]]);
    expect(participant.areAllTablesParked()).toBe(true);
  });

  it('never substitutes five minutes of waiting for a completed hand', async () => {
    const participant = manager('slow-event');
    const owner = server([participant]);
    const started = Date.now();
    participant.areAllTablesParked = () => Date.now() >= started + 301_000;
    owner.sleep = async (milliseconds: number) => {
      vi.setSystemTime(Date.now() + milliseconds);
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const parked = await (GameServer.prototype as any).waitForAllTablesParked.call(owner, [
      participant,
    ]);
    expect(parked).toBe(true);
    expect(Date.now() - started).toBe(301_000);
  });

  it.each(['new-break', 'stopped-manager'])(
    'retires the old unproven drain when its owner changes: %s',
    async (change) => {
      const participant = manager('retired-event');
      const owner = server([participant]);
      participant.areAllTablesParked = () => false;
      owner.sleep = async () => {
        if (change === 'new-break') owner.synchronizedBreakGeneration++;
        if (change === 'stopped-manager') participant.isRunning = () => false;
      };
      const parked = await (GameServer.prototype as any).waitForAllTablesParked.call(owner, [
        participant,
      ]);
      expect(parked).toBe(false);
    }
  );

  it('returns an unproven drain when shutdown interrupts a hand beyond five minutes', async () => {
    const participant = manager('unresolved-event');
    const owner = server([participant]);
    const started = Date.now();
    participant.areAllTablesParked = () => false;
    owner.sleep = async (milliseconds: number) => {
      vi.setSystemTime(Date.now() + milliseconds);
      if (Date.now() - started >= 301_000) owner.running = false;
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const parked = await (GameServer.prototype as any).waitForAllTablesParked.call(owner, [
      participant,
    ]);
    expect(parked).toBe(false);
    expect(Date.now() - started).toBe(301_000);
  });
});

/*
 * 2026-09-10: THE TOURNAMENT BREAK ENDS WITH THE MAINTENANCE BREAK.
 *
 * At 15:55 the pause loop told 45 tournaments one after another
 * (break_started_at 15:55:00.002 to 15:55:13.6) and only then began a
 * five-minute countdown, so the tournaments came off their break at about
 * 16:00:14 and were then resumed one after another as well, while the
 * maintenance break had handed the platform back at 16:00:00. While a
 * maintenance break is on, its end is the tournament break's end, and every
 * event is paused, counted down and resumed at once.
 */
describe('The tournament break ends with the maintenance break', () => {
  const onTheHour = Date.parse('2026-09-10T13:00:00.000Z');

  /** Each pause costs seven seconds of wall clock, as 45 x 0.2-0.3s did. */
  function slowPauses(...participants: ReturnType<typeof manager>[]) {
    for (const participant of participants) {
      participant.pauseForBreak.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 7_000);
      });
    }
  }

  it('stamps the maintenance end on every countdown and resumes at it, however long the pauses took', async () => {
    const first = manager('first');
    const second = manager('second');
    slowPauses(first, second);
    const owner = server([first, second], onTheHour);
    const writes = persistence();
    await owner.triggerSynchronizedBreak();

    // Fourteen seconds went on pausing. The old rule would now run to 13:00:14.
    expect(Date.now()).toBe(Date.parse('2026-09-10T12:55:14.000Z'));
    expect(owner.breakEndsAt).toBe(onTheHour);
    expect(writes).toEqual([
      { id: 'first', deadline: new Date(onTheHour).toISOString() },
      { id: 'second', deadline: new Date(onTheHour).toISOString() },
    ]);
    for (const participant of [first, second]) {
      expect(participant.broadcast).toHaveBeenCalledWith(
        'tournament_break_started',
        expect.objectContaining({
          breakEndsAt: new Date(onTheHour).toISOString(),
          // The card says why this break runs past five minutes (Dan 2026-11-07).
          extendedFor: 'daily_update',
        })
      );
    }

    await vi.advanceTimersByTimeAsync(onTheHour - Date.now() - 1);
    expect(first.resumeFromBreak).not.toHaveBeenCalled();
    expect(second.resumeFromBreak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now()).toBe(onTheHour);
    expect(first.resumeFromBreak).toHaveBeenCalledOnce();
    expect(second.resumeFromBreak).toHaveBeenCalledOnce();
  });

  it('keeps the rule without a maintenance break: five minutes from the moment its tables parked', async () => {
    const first = manager('first');
    const second = manager('second');
    slowPauses(first, second);
    const owner = server([first, second]);
    const writes = persistence();
    await owner.triggerSynchronizedBreak();

    const fiveMinutesAfterParking = Date.parse('2026-09-10T13:00:14.000Z');
    expect(owner.breakEndsAt).toBe(fiveMinutesAfterParking);
    expect(writes.map((write) => write.deadline)).toEqual([
      new Date(fiveMinutesAfterParking).toISOString(),
      new Date(fiveMinutesAfterParking).toISOString(),
    ]);
    for (const participant of [first, second]) {
      expect(participant.broadcast).toHaveBeenCalledWith(
        'tournament_break_started',
        expect.objectContaining({ breakDurationMinutes: 5 })
      );
      const started = participant.broadcast.mock.calls.find(
        ([type]: [string]) => type === 'tournament_break_started'
      );
      expect(started?.[1]).not.toHaveProperty('extendedFor');
    }
    await vi.advanceTimersByTimeAsync(fiveMinutesAfterParking - Date.now() - 1);
    expect(first.resumeFromBreak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(first.resumeFromBreak).toHaveBeenCalledOnce();
  });

  it('ends at once when the drain outran the maintenance end, instead of five minutes later', async () => {
    const participant = manager('parked-after-the-hour');
    const owner = server([participant], onTheHour);
    owner.waitForAllTablesParked.mockImplementation(async () => {
      vi.setSystemTime(onTheHour + 1_000);
      return true;
    });
    const writes = persistence();
    await owner.triggerSynchronizedBreak();
    expect(writes).toEqual([
      { id: 'parked-after-the-hour', deadline: new Date(onTheHour + 1_000).toISOString() },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(participant.resumeFromBreak).toHaveBeenCalledOnce();
  });

  it('holds a tournament that starts during the drain until the same end, not the seven-minute worst case', async () => {
    const participant = manager('draining');
    const owner = server([participant], onTheHour);
    let finish!: (parked: boolean) => void;
    owner.waitForAllTablesParked.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    const writes = persistence();
    const pending = owner.triggerSynchronizedBreak();
    await settle();

    vi.setSystemTime(new Date('2026-09-10T12:56:00.000Z'));
    const entrant = manager('newcomer');
    owner.tournamentEngines.set(entrant.tournamentId, entrant);
    await owner.holdIfBreakIsRunning(entrant);
    expect(entrant.pauseForBreak).toHaveBeenCalledWith(onTheHour - Date.now());
    // The newcomer has no hand in the air, so its countdown starts now; the
    // draining tournament's does not start until its own hand lands.
    expect(writes).toEqual([{ id: 'newcomer', deadline: new Date(onTheHour).toISOString() }]);

    finish(true);
    await pending;
    expect(writes).toEqual([
      { id: 'newcomer', deadline: new Date(onTheHour).toISOString() },
      { id: 'draining', deadline: new Date(onTheHour).toISOString() },
    ]);
  });

  it('tells every event to stop in the same instant, and checks the server generation once they have settled', async () => {
    const first = manager('first');
    const second = manager('second');
    let release!: () => void;
    first.pauseForBreak.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const owner = server([first, second], onTheHour);
    let current = true;
    owner.directAdmissionIsCurrent = () => current;
    persistence();
    const pending = owner.triggerSynchronizedBreak();
    // The second event is not queued behind the first one's pause.
    expect(first.pauseForBreak).toHaveBeenCalledOnce();
    expect(second.pauseForBreak).toHaveBeenCalledOnce();
    await settle();
    expect(owner.waitForAllTablesParked).not.toHaveBeenCalled();

    // This server is fenced while a pause is still in flight.
    current = false;
    release();
    await pending;
    expect(owner.waitForAllTablesParked).not.toHaveBeenCalled();
    expect(owner.breakEndsAt).toBe(0);
  });

  it('resumes every event at once: one still waiting holds nobody, one that throws stops nobody', async () => {
    const waiting = manager('waiting-for-the-thaw');
    const broken = manager('broken');
    const ready = manager('ready');
    waiting.resumeFromBreak.mockImplementation(() => new Promise<void>(() => {}));
    broken.resumeFromBreak.mockRejectedValue(new Error('resume failed'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const owner = server([waiting, broken, ready]);
    owner.breakEndsAt = onTheHour;
    void owner.resumeSynchronizedBreak([waiting, broken, ready], 1);

    expect(waiting.resumeFromBreak).toHaveBeenCalledOnce();
    expect(broken.resumeFromBreak).toHaveBeenCalledOnce();
    expect(ready.resumeFromBreak).toHaveBeenCalledOnce();
    await settle();
    expect(errors).toHaveBeenCalledWith(
      '[GameServer.Failed_to_resume_tournament]',
      expect.objectContaining({ message: 'resume failed' })
    );
  });
});

/*
 * A RESTART AT THE :55 MARK DOES NOT SKIP THE BREAK (2026-11-02).
 *
 * The engine restarted at 05:54:50 UTC. Its :55 trigger fired before discovery
 * had adopted any tournament, returned without opening the window, and every
 * tournament adopted seconds later dealt straight through the hour's break.
 */
describe('Synchronized Break After A Restart', () => {
  it('opens the window with no tournament adopted yet, and holds one adopted inside it', async () => {
    const owner = server([]);
    owner.breakCountdownStarted = false;
    await owner.triggerSynchronizedBreak();
    expect(owner.breakEndsAt).toBeGreaterThan(Date.now());
    expect(owner.remainingBreakMs()).toBeGreaterThan(1000);

    const adopted = manager('adopted-after-trigger');
    adopted.onBreak = false;
    owner.tournamentEngines.set(adopted.tournamentId, adopted);
    persistence();
    await owner.holdIfBreakIsRunning(adopted);
    expect(adopted.pauseForBreak).toHaveBeenCalledOnce();
    expect(owner.waitForAllTablesParked).toHaveBeenCalledWith([adopted]);
  });

  it('closes an empty window at the top of the hour', async () => {
    vi.setSystemTime(new Date('2026-09-10T12:55:10.000Z'));
    const owner = server([]);
    owner.breakCountdownStarted = false;
    await owner.triggerSynchronizedBreak();
    expect(owner.remainingBreakMs()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(Date.parse('2026-09-10T13:00:00.000Z') - Date.now());
    expect(owner.breakEndsAt).toBe(0);
    expect(owner.remainingBreakMs()).toBe(0);
  });

  it('never gives a tournament adopted mid-break a second break', async () => {
    const restored = manager('restored-on-break');
    restored.onBreak = true;
    restored.synchronizedBreakEndsAtMs = Date.now() + 200_000;
    const owner = server([restored]);
    owner.breakCountdownStarted = false;
    await owner.triggerSynchronizedBreak();
    expect(restored.pauseForBreak).not.toHaveBeenCalled();
    expect(owner.waitForAllTablesParked).not.toHaveBeenCalled();
    await owner.holdIfBreakIsRunning(restored);
    expect(restored.pauseForBreak).not.toHaveBeenCalled();
  });

  it('a process that starts inside :55-:00 takes this hour break; one that starts earlier does not', () => {
    const inside = Object.assign(server([]), {
      triggerSynchronizedBreak: vi.fn().mockResolvedValue(undefined),
    });
    vi.setSystemTime(new Date('2026-09-10T12:56:30.000Z'));
    inside.catchUpSynchronizedBreakAtBoot();
    expect(inside.triggerSynchronizedBreak).toHaveBeenCalledOnce();
    expect(inside.launchServerLifecycleJob).toHaveBeenCalledOnce();

    const before = Object.assign(server([]), {
      triggerSynchronizedBreak: vi.fn().mockResolvedValue(undefined),
    });
    vi.setSystemTime(new Date('2026-09-10T12:54:59.000Z'));
    before.catchUpSynchronizedBreakAtBoot();
    expect(before.triggerSynchronizedBreak).not.toHaveBeenCalled();
  });
});

describe('break wait progress (Dan 2026-11-07)', () => {
  function engine(parked: boolean) {
    return {
      isParkedBetweenHands: () => parked,
      isMaintenancePaused: () => false,
      isBetweenHands: () => parked,
    };
  }

  it('counts the tables still finishing and publishes only when the count changes', async () => {
    const tm = manager('waiting');
    const engines = [engine(true), engine(false), engine(false)];
    tm.tableEngines = new Map(engines.map((e, i) => [`t${i}`, e]));
    expect(tm.breakWaitProgress()).toEqual({ tablesFinishing: 2, tablesTotal: 3 });
    await tm.publishBreakWaitProgress();
    await tm.publishBreakWaitProgress();
    expect(tm.broadcast).toHaveBeenCalledTimes(1);
    expect(tm.broadcast).toHaveBeenCalledWith('break_wait', { tablesFinishing: 2, tablesTotal: 3 });
    tm.tableEngines.set('t1', engine(true));
    await tm.publishBreakWaitProgress();
    expect(tm.broadcast).toHaveBeenLastCalledWith('break_wait', {
      tablesFinishing: 1,
      tablesTotal: 3,
    });
  });

  it('counts a table whose inspection throws as still finishing, and stays quiet once counting', async () => {
    const tm = manager('counting');
    tm.tableEngines = new Map([
      [
        't0',
        {
          isParkedBetweenHands: () => {
            throw new Error('gone');
          },
        },
      ],
    ]);
    expect(tm.breakWaitProgress()).toEqual({ tablesFinishing: 1, tablesTotal: 1 });
    tm.breakCountdownStarted = true;
    await tm.publishBreakWaitProgress();
    expect(tm.broadcast).not.toHaveBeenCalled();
  });

  it('the server publishes progress while it waits, for the tournaments still waiting', () => {
    const src = readFileSync(join(__dirname, 'GameServer.ts'), 'utf8');
    const at = src.indexOf('const waitingOn = managers.filter((tm) => !tm.areAllTablesParked());');
    expect(at).toBeGreaterThan(-1);
    const next = src.indexOf('await this.sleep(500);', at);
    expect(src.slice(at, next)).toMatch(/tm\.publishBreakWaitProgress\?\.\(\)/);
  });
});

/**
 * A TOURNAMENT THAT STARTS AT ITS ADVERTISED TIME STARTS ON THE DOT
 * (Dan, 2026-11-11: "THE 7PM TOURNAMENT THAT STARTS AT 7PM, SHOULD NOT START
 * ON A BREAK... IT SHOULD START AT 7 ON THE DOT"). Each running tournament
 * takes its own five minutes from when its own last hand parks, so the fleet
 * break spills past the top of the hour - and the Nightly 20K opened at 7:00
 * PM on a paused break screen. A FRESH field has had no play to rest from:
 * only a maintenance-anchored break may hold a starting tournament.
 */
describe('Scheduled Start During The Break', () => {
  it('does not hold a freshly starting tournament for the ordinary break', async () => {
    const entrant = manager('fresh-20k');
    entrant.onBreak = false;
    const owner = server([entrant]);
    owner.breakEndsAt = Date.now() + 61_000; // the 18:55 break's tail, past 19:00
    owner.breakCountdownStarted = true;
    const writes = persistence();
    await owner.holdIfBreakIsRunning(entrant, true);
    expect(entrant.pauseForBreak).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(owner.openTournamentBreaks().has(entrant)).toBe(false);
  });

  it('still holds a freshly starting tournament for a maintenance-anchored break', async () => {
    const entrant = manager('fresh-maint');
    entrant.onBreak = false;
    const owner = server([entrant]);
    owner.breakEndsAt = Date.now() + 61_000;
    owner.breakCountdownStarted = true;
    owner.breakEndsWithMaintenance = true;
    persistence();
    await owner.holdIfBreakIsRunning(entrant, true);
    expect(entrant.pauseForBreak).toHaveBeenCalledOnce();
  });

  it('still holds a resumed or adopted tournament exactly as before', async () => {
    const adopted = manager('adopted-mid');
    adopted.onBreak = false;
    const owner = server([adopted]);
    owner.breakEndsAt = Date.now() + 61_000;
    owner.breakCountdownStarted = true;
    persistence();
    await owner.holdIfBreakIsRunning(adopted, false);
    expect(adopted.pauseForBreak).toHaveBeenCalledOnce();
  });

  it("admission wires mode === 'start' through to the break hold", async () => {
    const src = readFileSync(join(__dirname, 'GameServer.ts'), 'utf8');
    // The fresh-start exemption must come from the admission mode itself, so
    // a resumed or adopted manager can never claim it.
    expect(src).toMatch(
      /finishTournamentManagerAdmission\(\s*tournamentId,\s*manager,\s*generation,\s*mode === 'start'\s*\)/
    );
    expect(src).toMatch(/holdIfBreakIsRunning\(manager, freshStart\)/);
    expect(src).toMatch(/if \(freshStart && !this\.breakEndsWithMaintenance\) return;/);
  });
});
