import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// RecoveryStackDegraded, 2026-11-13: the verifier was fixed at 15:35Z, but its
// daily timer fired at 09:17Z, before the 04:00-04:05 America/Chicago window
// that installs a new control generation. The fixed script could not run until
// the day after it was installed, so a false critical stayed lit for two days.
// The audit must run after the window in both CST (10:00Z) and CDT (09:00Z).
const installer = readFileSync('server/scripts/install-engine-supervisor.sh', 'utf8');

describe('the recovery audit runs after the daily install', () => {
  it('schedules the verify timer after the release window in both offsets', () => {
    const unit = installer.slice(installer.indexOf('club-arena-verify.timer" <<'));
    const match = /OnCalendar=\*-\*-\* (\d{2}):(\d{2}):00 UTC/.exec(unit);
    expect(match).not.toBeNull();
    const minuteOfDay = Number(match![1]) * 60 + Number(match![2]);
    const windowEndCst = 10 * 60 + 5; // 04:05 Chicago in CST
    const windowEndCdt = 9 * 60 + 5; // 04:05 Chicago in CDT
    expect(minuteOfDay).toBeGreaterThan(Math.max(windowEndCst, windowEndCdt) + 30);
    // Still the same day's audit, well before the next window: the 48h
    // RecoveryStackUnverified threshold keeps its full margin.
    expect(minuteOfDay).toBeLessThan(23 * 60);
  });
});
