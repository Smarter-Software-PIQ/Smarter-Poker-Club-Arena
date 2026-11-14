/**
 * 2026-11-14: wind-down leaves a table alone for its own 20-30 minute dwell
 * after the LAST person leaves (Dan 2026-11-11), and never freezes a table a
 * person is still playing at. Built from a real table row, end to end through
 * the snapshot mapper the planner reads.
 */
import { describe, expect, it } from 'vitest';
import { tableSnapshotFromRow } from './StableHandSnapshot.js';
import { planFloor } from './StableHandController.js';
import { MIDWAY_UNION_ID } from './StableHand.js';

const NOW = Date.parse('2026-11-14T09:30:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const seat = (id: string) => ({ user_id: id, stack: 100, joined_at: minutesAgo(90) });

function row(id: string, lastHumanMinutesAgo: number | null, humans = 0) {
  const horses = Array.from({ length: 6 - humans }, (_, i) => `${id}-horse${i}`);
  const people = Array.from({ length: humans }, (_, i) => `${id}-person${i}`);
  const t = {
    id,
    game_variant: 'nlh',
    small_blind: 1,
    big_blind: 2,
    max_players: 6,
    status: 'running',
    last_human_seen_at: lastHumanMinutesAgo === null ? null : minutesAgo(lastHumanMinutesAgo),
    cluster_id: null,
  };
  return { t, rows: [...horses, ...people].map(seat), horseIds: new Set(horses) };
}

describe('the human dwell is read from the table row', () => {
  it('flags a table a person left five minutes ago, and not one left an hour ago', () => {
    const recent = row('recent', 5);
    const old = row('old', 60);
    const never = row('never', null);
    for (const [r, want] of [
      [recent, true],
      [old, false],
      [never, false],
    ] as const) {
      const snap = tableSnapshotFromRow(
        r.t,
        r.rows,
        r.horseIds,
        MIDWAY_UNION_ID,
        0,
        undefined,
        NOW
      );
      expect(snap.inHumanDwell).toBe(want);
      expect(snap.occupied).toBe(6);
    }
  });

  it('never flags a table a person is still playing at', () => {
    const live = row('live', 1, 1);
    const snap = tableSnapshotFromRow(
      live.t,
      live.rows,
      live.horseIds,
      MIDWAY_UNION_ID,
      0,
      undefined,
      NOW
    );
    expect(snap.humansSeated).toBe(1);
    expect(snap.inHumanDwell).toBe(false);
  });

  it('keeps the planner off the dwelling table, end to end', () => {
    const tables = [row('recent', 5), row('old', 60), row('never', null)].map((r) =>
      tableSnapshotFromRow(r.t, r.rows, r.horseIds, MIDWAY_UNION_ID, 0, undefined, NOW)
    );
    const plan = planFloor({
      chicagoHour: 19,
      chicagoMinute: 0,
      killed: false,
      hosts: [{ hostId: MIDWAY_UNION_ID, n: 584, uniqueLive: 400, tables }],
    });
    const wound = plan.stand
      .filter((s) => s.reason === 'occupancy_wind_down')
      .map((s) => s.tableId);
    expect(wound.length).toBeGreaterThan(0);
    expect(wound).not.toContain('recent');
  });
});
