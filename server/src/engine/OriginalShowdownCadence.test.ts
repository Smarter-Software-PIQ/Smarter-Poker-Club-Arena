import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../services/supabase/client.js', () => ({ supabase: {}, maintenanceSupabase: {} }));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));
import { ServerTableEngine } from './ServerTableEngine.js';
import { handCompletionHoldMs } from '../config/handCompletionSpec.js';
const engines: any[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) {
    e.clearLooseHandTimers();
    e.preciseTimer.dispose();
    e.actionValidator.dispose();
    e.timeBankEngine.disposeAll();
    e.engineTelemetry.dispose();
  }
  vi.useRealTimers();
});
it.each([
  { original: true, runs: 0, bbj: false },
  { original: false, runs: 0, bbj: false },
  { original: true, runs: 2, bbj: false },
  { original: true, runs: 0, bbj: true },
])(
  'counts the completed showdown read once (original/multi-board/BBJ=%j)',
  async ({ original, runs, bbj }) => {
    vi.useFakeTimers();
    const e: any = new ServerTableEngine('cadence-isolated');
    engines.push(e);
    e.running = true;
    e.handCount = 1;
    e.currentHandRitBoards = runs;
    e.currentHandBBJHit = bbj ? { hit: true } : null;
    e.broadcastCurrentState = vi.fn();
    e.hub = { emitEvent: vi.fn() };
    e.currentHandShowdownResults = [
      { userId: 'u1', holeCards: [], seat: 1 },
      { userId: 'u2', holeCards: [], seat: 2 },
    ];
    const start = Date.now();
    const winners = e.handleHandEvent(
      { type: 'WINNERS', winners: [{ userId: 'u1', amount: 10, potIndex: 0 }] },
      [],
      1,
      false,
      original
    );
    await vi.advanceTimersByTimeAsync(1399);
    expect(e.hub.emitEvent.mock.calls.some((call: any[]) => call[1]?.type === 'pot_win')).toBe(
      false
    );
    await vi.advanceTimersByTimeAsync(1);
    await winners;
    expect(
      e.hub.emitEvent.mock.calls.filter((call: any[]) => call[1]?.type === 'pot_win')
    ).toHaveLength(1);
    const full = handCompletionHoldMs({
      wentToShowdown: true,
      showdownHands: 2,
      ritRuns: runs,
      bbjHit: bbj,
    });
    let completed = false;
    const display = e.awaitHandCompletionDisplay(full).then(() => {
      completed = true;
    });
    const credited = original && runs < 2 && !bbj;
    const remaining = full - (credited ? 1400 : 0);
    await vi.advanceTimersByTimeAsync(remaining - 1);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(completed).toBe(true);
    await display;
    expect(Date.now() - start).toBe(credited ? full : full + 1400);
    expect(e.completedOriginalShowdownReadMs).toBe(0);
  }
);
