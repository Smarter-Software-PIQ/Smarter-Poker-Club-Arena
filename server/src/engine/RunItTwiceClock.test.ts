import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { RunItTwiceEngine, type RITEvent } from './RunItTwiceEngine.js';
import { DeadlineScheduler } from './DeadlineScheduler.js';
import { ServerTableEngine } from './ServerTableEngine.js';

let scheduler: DeadlineScheduler;
let rit: RunItTwiceEngine;
let host: any;
let events: RITEvent[];
let wire: any[];
let complete: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
  scheduler = new DeadlineScheduler();
  events = [];
  wire = [];
  rit = new RunItTwiceEngine((e) => events.push(e), scheduler);
  rit.configure('clock', { enabled: true, autoDeclineTimeout: 25, maxRuns: 3 });
  host = new ServerTableEngine('clock');
  host.runItTwiceEngine = rit;
  host.hub = { emitEvent: (_id: string, event: any) => wire.push(event) };
  host.handController = {};
  host.handCount = 1;
  host.running = true;
  host.isCurrentEngine = () => true;
  host.lifecycleCanMutate = () => true;
  host.wireRunItTwiceEvents();
  rit.offer('clock', 'clock:1', 'a', ['a', 'b', 'c'], 300);
  complete = vi.fn();
  host.waitForRITResponse(complete);
});
afterEach(() => {
  host.preciseTimer.dispose();
  rit.disposeAll();
  scheduler.stop();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('ten-second RIT decision clock', () => {
  it.each([2, 3] as const)(
    'stops the timer and proceeds immediately on unanimous %sx consent (chooser last)',
    (runs) => {
      host.respondToRIT('b', 'accept');
      host.respondToRIT('c', 'accept');
      expect(complete).not.toHaveBeenCalled();
      expect(wire.filter((e) => e.type === 'rit_all_accepted')).toHaveLength(0);

      host.respondToRIT('a', undefined, runs);
      // Immediate: 0ms wait, timer cancelled, rit_chooser_decided precedes rit_all_accepted.
      expect(complete).toHaveBeenCalledTimes(1);
      expect(rit.getChosenRuns('clock')).toBe(runs);
      expect(rit.isDecisionPending('clock')).toBe(false);
      expect(scheduler.persistPending('clock').some((d) => d.eventId === 'rit_offer')).toBe(false);
      expect(wire.filter((e) => e.type === 'rit_all_accepted')).toHaveLength(1);
      const decidedIdx = wire.findIndex((e) => e.type === 'rit_chooser_decided');
      const acceptedIdx = wire.findIndex((e) => e.type === 'rit_all_accepted');
      expect(decidedIdx).toBeGreaterThanOrEqual(0);
      expect(decidedIdx).toBeLessThan(acceptedIdx);

      // Passing the original 10s deadline must not double-emit or double-complete.
      vi.advanceTimersByTime(15_000);
      expect(wire.filter((e) => e.type === 'rit_all_accepted')).toHaveLength(1);
      expect(wire.filter((e) => e.type === 'rit_single_run')).toHaveLength(0);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  );

  it('uses exactly ten seconds when players do not finish deciding, even when old config says 25', () => {
    expect(rit.offerTimeoutSeconds('clock')).toBe(10);
    vi.advanceTimersByTime(9_999);
    expect(rit.getState('clock')?.status).toBe('offered');
    expect(complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(251);
    expect(rit.getState('clock')?.status).toBe('declined');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(wire.filter((e) => e.type === 'rit_single_run')).toHaveLength(1);
  });

  it.each(['decline', 'once'] as const)(
    'stops the timer and proceeds immediately on explicit %s',
    (decision) => {
      vi.advanceTimersByTime(2_000);
      if (decision === 'decline') host.respondToRIT('c', 'decline');
      else host.respondToRIT('a', undefined, 1);
      // Immediate: 0ms wait, no waiting for the 250ms poll or 10s deadline.
      expect(complete).toHaveBeenCalledTimes(1);
      expect(rit.getChosenRuns('clock')).toBe(1);
      expect(rit.isDecisionPending('clock')).toBe(false);
      expect(scheduler.persistPending('clock').some((d) => d.eventId === 'rit_offer')).toBe(false);
      expect(wire.filter((e) => e.type === 'rit_single_run')).toHaveLength(1);

      vi.advanceTimersByTime(15_000);
      expect(wire.filter((e) => e.type === 'rit_all_accepted')).toHaveLength(0);
      expect(wire.filter((e) => e.type === 'rit_single_run')).toHaveLength(1);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  );

  it('stops the timer and proceeds immediately when the chooser is first and last responder accepts', () => {
    host.respondToRIT('a', undefined, 3);
    vi.advanceTimersByTime(2_000);
    host.respondToRIT('b', 'accept');
    expect(complete).not.toHaveBeenCalled();
    expect(wire.some((e) => e.type === 'rit_all_accepted')).toBe(false);

    host.respondToRIT('c', 'accept');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(rit.getChosenRuns('clock')).toBe(3);
    expect(scheduler.persistPending('clock').some((d) => d.eventId === 'rit_offer')).toBe(false);
    expect(wire.filter((e) => e.type === 'rit_all_accepted')).toHaveLength(1);
    const updateIdx = wire.map((e) => e.type).lastIndexOf('rit_response_update');
    const acceptedIdx = wire.findIndex((e) => e.type === 'rit_all_accepted');
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeLessThan(acceptedIdx);

    vi.advanceTimersByTime(15_000);
    expect(wire.filter((e) => e.type === 'rit_all_accepted')).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('a paused pending offer keeps its remaining decision time', () => {
    host.respondToRIT('a', undefined, 2);
    host.respondToRIT('b', 'accept');
    vi.advanceTimersByTime(2_000);
    rit.pauseForWeeklyPayout('clock', 'owner');
    vi.advanceTimersByTime(20_000);
    expect(complete).not.toHaveBeenCalled();
    rit.resumeFromWeeklyPayout('clock', 'owner');
    vi.advanceTimersByTime(7_999);
    expect(complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(251);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
