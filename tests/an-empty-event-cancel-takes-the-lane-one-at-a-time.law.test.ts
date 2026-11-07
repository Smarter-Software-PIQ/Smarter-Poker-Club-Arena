import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 2026-11-07 20:05:12 UTC: the engine asked atomic_cancel_tournament for ~30
// empty past-start events at once. The database admits one cancellation at a
// time through its exclusive terminal-settlement lane, so all but one were
// refused CANCELLATION_GLOBAL_LANE_BUSY (55P03, a PostgREST 500), each was
// reported as an error and parked thirty minutes, together, to collide again.
// 41 empty Midway Union Sit & Go boards sat up to eight hours past start.
// The engine now asks one cancel at a time, and a busy lane is "not now".
const engine = readFileSync('server/src/GameServer.ts', 'utf8');
const rule = readFileSync('server/src/tournament/emptyPastStartEvent.ts', 'utf8');
const lane = engine.slice(
  engine.indexOf('private launchEmptyEventCancel('),
  engine.indexOf('private pastStartTopUpClock: Map<string, PastStartTopUpClock>')
);

describe('an empty-event cancel takes the lane one at a time', () => {
  it('starts no second cancel while one is in flight anywhere in the engine', () => {
    expect(lane).toContain('this.emptyEventCancelsInFlight.size > 0');
  });

  it('treats only the lane try-lock refusals as busy, by SQLSTATE 55P03 and exact name', () => {
    expect(rule).toContain("if (code !== '55P03' || typeof message !== 'string') return false;");
    expect(rule).toContain(
      "const LANE_BUSY_REFUSALS = ['CANCELLATION_GLOBAL_LANE_BUSY', 'CANCELLATION_BARRIER_BUSY'];"
    );
  });

  it('asks a busy lane again after a minute without an error report', () => {
    expect(rule).toContain('export const EMPTY_PAST_START_LANE_BUSY_RETRY_MS = 60 * 1000;');
    const busy = engine.slice(
      engine.indexOf('if (cancelError && isCancellationLaneBusy(cancelError)) {'),
      engine.indexOf("'GameServer.empty_past_start_event_cancel_refused'")
    );
    expect(busy).toContain('cancelAskedAt: laneBusyCancelAskedAt(now),');
    expect(busy.slice(0, busy.indexOf('if (cancelError) {'))).not.toContain('reportError(');
  });

  it('still cancels only through the database cancellation authority', () => {
    expect(engine).toContain("await supabase.rpc('atomic_cancel_tournament', {");
  });
});
