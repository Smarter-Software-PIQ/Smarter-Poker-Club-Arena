import { describe, expect, it } from 'vitest';
import { scheduleAtExactEpochMs } from './deadlineFloorTimer.js';
import {
  MaintenanceBreak,
  type MaintenanceBreakStore,
  type PersistedMaintenanceBreak,
} from './MaintenanceBreak.js';

class FakeStore implements MaintenanceBreakStore {
  row: PersistedMaintenanceBreak | null = null;
  async loadReleaseBoundary(): Promise<number | null> {
    return null;
  }
  async load(): Promise<PersistedMaintenanceBreak | null> {
    return this.row;
  }
  async save(state: PersistedMaintenanceBreak): Promise<void> {
    this.row = { ...state };
  }
  async claim(
    expectedOwnershipToken: string,
    newOwnershipToken: string
  ): Promise<PersistedMaintenanceBreak | null> {
    if (!this.row || this.row.ownershipToken !== expectedOwnershipToken) return null;
    this.row = { ...this.row, ownershipToken: newOwnershipToken };
    return this.row;
  }
  async clear(expected: PersistedMaintenanceBreak): Promise<void> {
    if (JSON.stringify(this.row) === JSON.stringify(expected)) {
      this.row = null;
    }
  }
}

describe('scheduleAtExactEpochMs (deadline-floor timer helper)', () => {
  it('re-arms whenever the timer callback wakes up before targetEpochMs and fires only once now() >= targetEpochMs', () => {
    const target = 1_793_620_805_533;
    let nowMs = target - 120_000;
    const armed: Array<{ fn: () => void; ms: number; handle: number }> = [];
    let currentHandle: number | null = null;
    let firedAt: number | null = null;
    let nextId = 1;

    scheduleAtExactEpochMs(
      target,
      () => nowMs,
      (fn, ms) => {
        const handle = nextId++;
        armed.push({ fn, ms, handle });
        return handle;
      },
      (handle) => {
        currentHandle = handle;
      },
      () => {
        firedAt = nowMs;
      }
    );

    expect(armed).toHaveLength(1);
    expect(armed[0].ms).toBe(120_000);
    expect(currentHandle).toBe(1);
    expect(firedAt).toBeNull();

    // Wake up 2ms early: must re-arm for 2ms and NOT fire onDue
    nowMs = target - 2;
    armed[0].fn();
    expect(firedAt).toBeNull();
    expect(armed).toHaveLength(2);
    expect(armed[1].ms).toBe(2);
    expect(currentHandle).toBe(2);

    // Wake up 1ms early: must re-arm for 1ms and NOT fire onDue
    nowMs = target - 1;
    armed[1].fn();
    expect(firedAt).toBeNull();
    expect(armed).toHaveLength(3);
    expect(armed[2].ms).toBe(1);
    expect(currentHandle).toBe(3);

    // Reach exact targetEpochMs: must clear handle and fire onDue
    nowMs = target;
    armed[2].fn();
    expect(currentHandle).toBeNull();
    expect(firedAt).toBe(target);
  });

  it('aborts cleanly without re-arming or firing onDue when shouldContinue() returns false', () => {
    const target = 10_000;
    let nowMs = 9_000;
    let active = true;
    const armed: Array<{ fn: () => void; ms: number }> = [];
    let currentHandle: object | null = null;
    let fired = false;

    scheduleAtExactEpochMs(
      target,
      () => nowMs,
      (fn, ms) => {
        const h = { fn, ms };
        armed.push(h);
        return h;
      },
      (h) => {
        currentHandle = h;
      },
      () => {
        fired = true;
      },
      () => active
    );

    expect(currentHandle).not.toBeNull();
    active = false;
    nowMs = 9_999; // even if early, shouldContinue() === false aborts immediately
    armed[0].fn();
    expect(currentHandle).toBeNull();
    expect(armed).toHaveLength(1);
    expect(fired).toBe(false);
  });
});

describe('MaintenanceBreak deadline-floor protection across all four scheduled timers', () => {
  it('scheduleNextAnnouncement re-arms when the announcement timer fires 1ms early instead of throwing scheduled_maintenance_announcement_expired', async () => {
    // 1 second before 00:58:00.000Z
    let nowMs = Date.parse('2026-11-01T00:57:59.000Z');
    const targetAnnounceMs = Date.parse('2026-11-01T00:58:00.000Z');
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const store = new FakeStore();

    const mb = new MaintenanceBreak({
      engines: () => new Map().entries(),
      isRunning: () => true,
      emit: () => {},
      store,
      now: () => nowMs,
      setTimer: ((fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return { fn, ms } as unknown as NodeJS.Timeout;
      }) as any,
      clearTimer: () => {},
    });

    await mb.start();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(1_000);

    // Fire 1ms early (00:57:59.999Z): without deadline floor this shifts intendedStartMinute and throws!
    nowMs = targetAnnounceMs - 1;
    timers[0].fn();
    expect(store.row).toBeNull();
    expect(timers).toHaveLength(2);
    expect(timers[1].ms).toBe(1);

    // Fire at exact boundary (00:58:00.000Z)
    nowMs = targetAnnounceMs;
    timers[1].fn();
    await new Promise((r) => setImmediate(r));
    expect(store.row?.phase).toBe('last_hand');
    expect(store.row?.announcedAt).toBe(targetAnnounceMs);
    await mb.stop();
  });

  it('armEndTimer and armSecondBreakReport re-arm when their timers wake up 1ms early', async () => {
    let nowMs = Date.parse('2026-11-02T06:58:00.000Z');
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const store = new FakeStore();
    const faults: unknown[] = [];

    const unparkedEngine = {
      pauseForMaintenance: () => {},
      resumeFromMaintenance: () => {},
      isParkedBetweenHands: () => false,
      isBetweenHands: () => false,
      isRunning: () => true,
      hasAccountingInFlight: () => true,
    };
    const engines = new Map<string, any>([['t-straggler', unparkedEngine]]);

    const mb = new MaintenanceBreak({
      engines: () => engines.entries(),
      isRunning: () => true,
      emit: () => {},
      store,
      now: () => nowMs,
      recordFault: async (f) => {
        faults.push(f);
      },
      setTimer: ((fn: () => void, ms: number) => {
        const entry = { fn, ms };
        timers.push(entry);
        return entry as unknown as NodeJS.Timeout;
      }) as any,
      clearTimer: () => {},
    });

    // First break: uncertified because t-straggler is unparked
    await mb.announceLastHand();
    nowMs += MaintenanceBreak.LAST_HAND_LEAD_MS;
    await mb.beginCountdown();

    // End timer was armed for BREAK_DURATION_MS (300,000ms)
    const firstEndTimer = timers.at(-1)!;
    expect(firstEndTimer.ms).toBe(MaintenanceBreak.BREAK_DURATION_MS);

    // Fire endTimer 1ms early: must re-arm for 1ms and stay in counting_down
    nowMs += MaintenanceBreak.BREAK_DURATION_MS - 1;
    firstEndTimer.fn();
    expect(mb.isActive()).toBe(true);
    const rearmedEndTimer = timers.at(-1)!;
    expect(rearmedEndTimer.ms).toBe(1);

    // Advance the remaining 1ms and fire: break ends and records unparkedAtLastUncertifiedBreak
    nowMs += 1;
    rearmedEndTimer.fn();
    await new Promise((r) => setImmediate(r));
    expect(mb.isActive()).toBe(false);

    // Second break: armSecondBreakReport arms for SECOND_BREAK_REPORT_AFTER_MS (60,000ms)
    nowMs += 60_000;
    await mb.announceLastHand();
    nowMs += MaintenanceBreak.LAST_HAND_LEAD_MS;
    await mb.beginCountdown();

    const secondBreakTimer = timers.find(
      (t) => t.ms === MaintenanceBreak.SECOND_BREAK_REPORT_AFTER_MS
    );
    expect(secondBreakTimer).toBeDefined();

    // Fire secondBreakTimer 1ms early: must re-arm for 1ms and not report yet
    nowMs += MaintenanceBreak.SECOND_BREAK_REPORT_AFTER_MS - 1;
    secondBreakTimer!.fn();
    expect((mb.snapshot().secondBreak as any).refusingAccountingPending).toBe(0);
    const rearmedSecondBreak = timers.at(-1)!;
    expect(rearmedSecondBreak.ms).toBe(1);

    // Advance the final 1ms and fire: now reports the straggler
    nowMs += 1;
    rearmedSecondBreak.fn();
    expect((mb.snapshot().secondBreak as any).refusingAccountingPending).toBe(1);
    await mb.stop();
  });
});
