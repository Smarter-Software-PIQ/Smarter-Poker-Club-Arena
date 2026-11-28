/**
 * STATS HAND INDEX CATCHES UP ONCE AFTER A MAINTENANCE BREAK (2026-11-28).
 *
 * Incidents eb6f18a7 (ClubArenaStatsIndexLag, 94 occurrences / 79 recurrences)
 * and 91172a99 (StatsHandIndexLagging, 16 recurrences):
 *
 * World Hub's `/api/cron/club-stats-maintenance` runs on :00/:15/:30/:45 and
 * intentionally skips :00 while `engine_maintenance_break` or
 * `fn_platform_frozen()` is active (so `AccessShareLock` on `public.tournaments`
 * cannot block window migrations). Because migration 20261111131639 also holds
 * `ca_refresh_hand_player_index`'s `v_bound` to `now() - 5 minutes`, every
 * three-hourly :00-:05 maintenance break left `idx_ceil` at :40:00 until :15:45
 * — 35 minutes of lag, crossing the 30-minute bar at :10:00 eight times a day
 * even when zero runs failed and every hand was already indexed live.
 *
 * This law pins the permanent root-cause fix:
 *   1. `StatsHealthMonitor` keeps the 30-minute `STATS_INDEX_LAG_THRESHOLD_S`
 *      intact (no threshold weakening).
 *   2. `GameServer` wires `catchUpIndex` to `ca_refresh_hand_player_index`.
 *   3. `StatsHealthMonitor` invokes `catchUpIndex` at most once on an explicit
 *      maintenance-break exit transition (or once on cold boot right after a
 *      break) when lag exceeds one 15-minute cadence, NEVER while paused, and
 *      NEVER as a recurring repair loop in steady state (so an actually broken
 *      external scheduler still pages at 30 minutes).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  STATS_INDEX_LAG_ALERT,
  STATS_INDEX_LAG_THRESHOLD_S,
  STATS_INDEX_POST_BREAK_CATCHUP_LAG_S,
  StatsHealthMonitor,
} from './StatsHealthMonitor.js';

const here = dirname(fileURLToPath(import.meta.url));
const gameServerSrc = readFileSync(join(here, '..', 'GameServer.ts'), 'utf8');

describe('stats hand index catches up once after a maintenance break', () => {
  it('keeps the 30-minute alert bar and wires GameServer catchUpIndex to ca_refresh_hand_player_index', () => {
    expect(STATS_INDEX_LAG_THRESHOLD_S).toBe(30 * 60);
    expect(STATS_INDEX_POST_BREAK_CATCHUP_LAG_S).toBe(15 * 60);
    expect(gameServerSrc).toMatch(
      /catchUpIndex:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?supabase\.rpc\('ca_refresh_hand_player_index'/
    );
  });

  it('catches up once on :00-:05 break exit instead of crossing 30m at :10, while still alerting on a real steady-state outage', async () => {
    let paused = true;
    const reads = [
      // 07:04 inside the maintenance break: must not touch the database index refresh.
      {
        checkedAt: '2026-11-28T07:04:00.000Z',
        indexCeil: '2026-11-28T06:40:00.000Z',
        indexLagSeconds: 1440,
      },
      // 07:05 right after thaw: lag is 25m (> 15m cadence), triggers ONE catch-up.
      {
        checkedAt: '2026-11-28T07:05:10.000Z',
        indexCeil: '2026-11-28T06:40:00.000Z',
        indexLagSeconds: 1510,
      },
      // Immediate re-read after catchUpIndex advances idx_ceil to 07:00:00 (5m v_bound).
      {
        checkedAt: '2026-11-28T07:05:12.000Z',
        indexCeil: '2026-11-28T07:00:00.000Z',
        indexLagSeconds: 312,
      },
      // 07:10: normal 10m lag, well under 30m.
      {
        checkedAt: '2026-11-28T07:10:10.000Z',
        indexCeil: '2026-11-28T07:00:00.000Z',
        indexLagSeconds: 610,
      },
      // 08:35: external scheduler actually died in steady state — must NOT catch up, must alert.
      {
        checkedAt: '2026-11-28T08:35:10.000Z',
        indexCeil: '2026-11-28T08:04:00.000Z',
        indexLagSeconds: 1870,
      },
    ];
    let idx = 0;
    const read = vi.fn(async () => reads[Math.min(idx++, reads.length - 1)]);
    const catchUpIndex = vi.fn(async () => undefined);
    const raise = vi.fn(async () => true);
    const resolve = vi.fn(async () => true);

    const monitor = new StatsHealthMonitor({
      read,
      catchUpIndex,
      raise,
      resolve,
      paused: () => paused,
      log: () => {},
    });

    await monitor.tick();
    expect(catchUpIndex).toHaveBeenCalledTimes(0);

    paused = false;
    await monitor.tick();
    expect(catchUpIndex).toHaveBeenCalledTimes(1);
    expect(monitor.publish()?.indexLagSeconds).toBe(312);
    expect(raise).not.toHaveBeenCalled();

    await monitor.tick();
    expect(catchUpIndex).toHaveBeenCalledTimes(1);
    expect(raise).not.toHaveBeenCalled();

    await monitor.tick();
    expect(catchUpIndex).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ alertname: STATS_INDEX_LAG_ALERT })
    );
  });
});
