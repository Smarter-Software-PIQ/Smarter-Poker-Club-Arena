import { afterEach, describe, expect, it, vi } from 'vitest';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { ServerTableEngine } from '../engine/ServerTableEngine.js';
import type { GameServer } from '../GameServer.js';
import { supabase } from '../services/supabase.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';

/**
 * Dan 2026-11-18: "WHEN THE ADD ON PERIOD STARTS AND HANDS ARE PAUSED, THE
 * NEXT LEVEL STAYS PAUSED UNTIL THE REBUY PERIOD IS OVER... IT CURRENTLY KEEPS
 * RUNNING UNTIL THE ADD ON STARTS. IT SHOULDN'T DO THAT, IT SHOULD PAUSE AND
 * WAIT FOR ALL HANDS TO FINISH AND THE REBUY PERIOD END, BEFORE THE NEXT
 * LEVEL STARTS."
 *
 * The real suspendLevelClock and the real level timer run here: the law is
 * about how much of the level is left, so nothing about the clock is stubbed.
 */
const LEVEL_MS = 10 * 60_000;
const STRUCTURE = [
  { level: 1, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 10 },
  { level: 2, smallBlind: 200, bigBlind: 400, ante: 0, durationMinutes: 10 },
];

class Harness extends TournamentManagerBase {
  armedWith: Array<number | undefined> = [];
  constructor() {
    super('00000000-0000-4000-8000-000000000118', {} as GameServer);
    (this as any).lifecycleEpoch.begin();
    this.gameServer.getTableEngine = (id: string) => this.tableEngines.get(id);
    this.running = true;
    this.tournamentEntryWindowClosed = true;
    this.tournamentCache = {
      addon_from_start: false,
      started_at: '2026-11-18T01:00:00.000Z',
      level_started_at: '2026-11-18T01:26:00.000Z',
      late_reg_mins: 30,
      addon_cost: 35,
      addon_chips: 30000,
      blind_structure: STRUCTURE,
    } as any;
    (this as any).requestEliminationSweep = vi.fn();
    (this as any).scheduleAddOnRetry = vi.fn();
    (this as any).advanceHandForHandBarrier = vi.fn();
    (this as any).levelDurationMs = () => LEVEL_MS;
  }
  add(id: string, e: ServerTableEngine) {
    this.tableEngines.set(id, e);
    this.wireEliminationWake(e);
  }
  /** A level that started `elapsedMs` ago with its wake armed, as in play. */
  armLevel(elapsedMs: number) {
    (this as any).blindTimerStartedAt = Date.now() - elapsedMs;
    (this as any).blindTimer = setTimeout(() => {}, LEVEL_MS - elapsedMs);
  }
  open() {
    return this.triggerAddOnPeriod();
  }
  begin(endMs: number) {
    return (this as any).beginAddOnBreak(endMs);
  }
  finish() {
    return (this as any).finishAddOnBreak();
  }
  get timer() {
    return (this as any).blindTimer;
  }
  get saved(): number {
    return (this as any).savedBlindTimerRemaining;
  }
  protected override scheduleAddOnPeriodEnd(): void {}
  protected override startBlindTimer(_structure: any[], remainingMs?: number): void {
    this.armedWith.push(remainingMs);
  }
  protected override async broadcast(): Promise<boolean> {
    return true;
  }
  protected override startEliminationChecker(): void {}
  protected override async recalculateEliminatedPrizes(): Promise<boolean> {
    return true;
  }
}

function persistedWindow() {
  let saved: any;
  const chain: any = {
    update: vi.fn((r: any) => {
      saved = { ...r, add_on_available: true, prize_pool_finalized: false, status: 'RUNNING' };
      return chain;
    }),
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    select: () => chain,
    maybeSingle: async () => ({ data: saved, error: null }),
  };
  vi.spyOn(supabase, 'from').mockReturnValue(chain);
  return { chain, saved: () => saved };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setMaintenanceFrozen(false);
});

describe('the level clock stops when the add-on drain starts', () => {
  it('holds the level through the drain and the paid minute, then gives back exactly what was left', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T01:30:00Z'));
    const db = persistedWindow();
    const m = new Harness();
    const a = new ServerTableEngine('a');
    const b = new ServerTableEngine('b');
    (a as any).running = true;
    (b as any).running = true;
    m.add('a', a);
    m.add('b', b);
    // Four minutes of a ten-minute level have been played.
    m.armLevel(4 * 60_000);

    // The entry window closes: the drain begins while hands are still out.
    await m.open();
    expect((m as any).addOnDrainPending).toBe(true);
    expect(db.chain.update).not.toHaveBeenCalled();
    // The clock stopped NOW, with the six minutes that were really left.
    expect(m.timer).toBeNull();
    expect(m.saved).toBe(6 * 60_000);

    // The last hand takes ninety more seconds. None of it is spent.
    const parkedA = (a as any).awaitPauseGate();
    await Promise.resolve();
    vi.setSystemTime(new Date('2026-11-18T01:31:30Z'));
    const parkedB = (b as any).awaitPauseGate();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(db.chain.update).toHaveBeenCalledTimes(1);
    expect((m as any).addOnDrainPending).toBe(false);
    expect(m.timer).toBeNull();
    expect(m.saved).toBe(6 * 60_000);

    // The paid minute takes the stopped clock over; it does not measure a
    // null timer as a fresh full level.
    const endMs = Date.parse(db.saved().addon_period_ends_at);
    await m.begin(endMs);
    expect((m as any).addOnBreakActive).toBe(true);
    expect(m.saved).toBe(6 * 60_000);
    expect(m.armedWith).toEqual([]);

    // The minute ends: the level resumes with its six minutes, not one second
    // and not ten.
    vi.setSystemTime(new Date(endMs));
    await m.finish();
    expect(m.armedWith).toEqual([6 * 60_000]);
    expect((m as any).addOnDrainHoldsLevelClock).toBe(false);

    (a as any).running = false;
    (b as any).running = false;
    a.resumeDealing();
    b.resumeDealing();
    await Promise.all([parkedA, parkedB]);
  });

  it('keeps the drain remainder when a synchronized break lands inside the drain', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T01:30:00Z'));
    persistedWindow();
    const m = new Harness();
    const a = new ServerTableEngine('a');
    (a as any).running = true;
    m.add('a', a);
    m.armLevel(7 * 60_000);
    await m.open();
    expect(m.saved).toBe(3 * 60_000);
    // pauseForBreak measures the clock when a break begins. The drain's
    // remainder survives it: a stopped clock is not read as a full level.
    (m as any).suspendLevelClock();
    expect(m.saved).toBe(3 * 60_000);
    expect((m as any).addOnDrainHoldsLevelClock).toBe(true);
    (a as any).running = false;
    a.resumeDealing();
  });

  it('gives the clock back when the add-on closes without ever reaching its break', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T01:30:00Z'));
    const m = new Harness();
    m.armLevel(2 * 60_000);
    (m as any).holdLevelClockForAddOnDrain();
    expect(m.timer).toBeNull();
    expect(m.saved).toBe(8 * 60_000);
    // Still draining: nothing may restart the level.
    (m as any).addOnDrainPending = true;
    (m as any).giveBackAddOnDrainLevelClock();
    expect(m.armedWith).toEqual([]);
    // The add-on is over and no break ever began.
    (m as any).addOnDrainPending = false;
    await m.finish();
    expect(m.armedWith).toEqual([8 * 60_000]);
  });
});
