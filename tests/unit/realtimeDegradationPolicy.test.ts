import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RESUBSCRIBE_BACKOFF,
  __resetRealtimeDegradationPolicyForTests,
  claimDegradedToast,
  createDegradationGate,
  createResubscribeScheduler,
  noteChannelRecovered,
  resubscribeDelayMs,
} from '../../src/lib/realtimeDegradationPolicy';

describe('realtime degradation policy (15,302-toast storm, 2026-10-31)', () => {
  it('retries immediately after one failure, then backs off exponentially with jitter to a 30 s cap', () => {
    expect(resubscribeDelayMs(0)).toBe(0);
    expect(resubscribeDelayMs(1)).toBe(0);
    // Equal jitter: [ceiling / 2, ceiling].
    expect(resubscribeDelayMs(2, () => 0)).toBe(500);
    expect(resubscribeDelayMs(2, () => 1)).toBe(1_000);
    expect(resubscribeDelayMs(3, () => 1)).toBe(2_000);
    expect(resubscribeDelayMs(6, () => 1)).toBe(16_000);
    for (const failures of [7, 10, 50, 1_000_000]) {
      expect(resubscribeDelayMs(failures, () => 1)).toBe(RESUBSCRIBE_BACKOFF.capMs);
      expect(resubscribeDelayMs(failures, () => 0)).toBe(RESUBSCRIBE_BACKOFF.capMs / 2);
    }
    // A broken random source cannot produce a negative or unbounded delay.
    expect(resubscribeDelayMs(4, () => Number.NaN)).toBe(2_000);
    expect(resubscribeDelayMs(4, () => 7)).toBe(4_000);
  });

  it('the scheduler counts one failure per attempt, coalesces pending runs and resets on SUBSCRIBED', () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const scheduler = createResubscribeScheduler({
      random: () => 1,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: vi.fn(),
    });
    const run = vi.fn();
    scheduler.run(run);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.noteFailure(1);
    scheduler.noteFailure(1); // CHANNEL_ERROR then CLOSED of the same attempt
    expect(scheduler.failures()).toBe(1);
    scheduler.run(run);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.noteFailure(2);
    scheduler.run(run);
    scheduler.run(run);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(1_000);
    timers[0].fn();
    expect(run).toHaveBeenCalledTimes(3);
    scheduler.noteSubscribed();
    expect(scheduler.failures()).toBe(0);
    scheduler.run(run);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('the gate opens once per episode and recovery starts a new one', () => {
    const gate = createDegradationGate();
    expect(gate.shouldNotify()).toBe(true);
    for (let i = 0; i < 1_000; i++) expect(gate.shouldNotify()).toBe(false);
    gate.recovered();
    expect(gate.shouldNotify()).toBe(true);
  });

  it('a degraded toast is claimed once per channel per episode', () => {
    __resetRealtimeDegradationPolicyForTests();
    expect(claimDegradedToast('member-record:a')).toBe(true);
    expect(claimDegradedToast('member-record:a')).toBe(false);
    expect(claimDegradedToast('club-roster-wallet:a')).toBe(true);
    noteChannelRecovered('member-record:a');
    expect(claimDegradedToast('member-record:a')).toBe(true);
  });

  it('no surface toasts from onSubscriptionError: degraded toasts go through the hooks', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|jsx?)$/.test(name)) {
          const source = readFileSync(path, 'utf8');
          // An onSubscriptionError handler whose body (up to 400 chars) toasts.
          const pattern = /onSubscriptionError\s*[:=]\s*\{?\s*\([^)]*\)\s*=>[\s\S]{0,400}?/g;
          for (const match of source.matchAll(pattern)) {
            const body = source.slice(match.index ?? 0, (match.index ?? 0) + 400);
            const end = body.search(/\n\s*on[A-Z]\w*\s*[:=]|\n\s*\}\);/);
            const handler = end > 0 ? body.slice(0, end) : body;
            if (/\btoast\w*\s*(\.|\?\.)\s*(error|warning|info|show|success)\s*\(/.test(handler))
              offenders.push(path);
          }
        }
      }
    };
    walk(join(__dirname, '../../src'));
    expect(offenders).toEqual([]);
  });
});
