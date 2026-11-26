/**
 * LAW: A CARRIED SIT-OUT TAKES ITS TABLE FIRST (2026-11-26).
 *
 * At 2026-11-26 16:22:05 UTC fn_ca_f06_share_table_lane (tournament table lane:
 * the tables row FOR UPDATE, then every chair ORDER BY id) deadlocked with a
 * plain PostgREST PATCH of table_seats.is_sitting_out. The PATCH came from
 * adoptTournamentMovePresence, which wrote a moved player's carried sit-out
 * straight to the new chair: the UPDATE locks the chair, and its AFTER trigger
 * zz_note_human_seat_seen then updates the tables row. Chair, then table: the
 * reverse of the lane.
 *
 * The carried sit-out now goes through fn_cash_seat_sitout (SeatSitOutPersistence),
 * which takes the tables row before the chair like every other sit-out write.
 * And no engine code may PATCH a chair's is_sitting_out or leave_pending
 * directly: those are the two columns whose change fires the table write.
 *
 * Ships with the next certified engine cutover after merge.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../services/supabase.js';
import { ServerTableEngine } from './ServerTableEngine.js';
import {
  claimTournamentMovePresence,
  depositTournamentMovePresence,
  resetTournamentMovePresence,
} from './SeatMovePresence.js';

const TABLE = '00000000-0000-4000-8000-0000000000c1';
const SOURCE = '00000000-0000-4000-8000-0000000000c2';
const PLAYER = '00000000-0000-4000-8000-0000000000c3';
const OCCUPANCY = '00000000-0000-4000-8000-0000000000c4';

function destination(isSittingOut: boolean) {
  const engine = new ServerTableEngine(TABLE) as any;
  engine.isTournamentTable = () => true;
  engine.seatedPlayers = [
    {
      user_id: PLAYER,
      seat_number: 4,
      is_horse: false,
      is_sitting_out: isSittingOut,
      occupancy_id: OCCUPANCY,
      stack: 100,
    },
  ];
  const persist = vi.fn((..._args: unknown[]) => Promise.resolve(null));
  engine.seatSitOutPersistence = { persist, wait: () => Promise.resolve(null) };
  return { engine, persist };
}

function depositSatOut(requestId: string) {
  const since = Date.now() - 60_000;
  depositTournamentMovePresence(PLAYER, TABLE, {
    requestId,
    fromTableId: SOURCE,
    fsm: {
      state: 'SAT_OUT',
      sinceMs: since,
      graceDeadlineMs: null,
      sitOutSinceMs: since,
      sitOutOrbits: 1,
      sitOutReason: 'forced',
      strikes: 3,
    },
  });
}

describe('a carried sit-out takes its table first', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetTournamentMovePresence();
  });

  it('writes the carried sit-out through fn_cash_seat_sitout, never a direct chair PATCH', () => {
    const from = vi.spyOn(supabase as any, 'from');
    depositSatOut('00000000-0000-4000-8000-0000000000d1');
    const { engine, persist } = destination(false);
    engine.adoptTournamentMovePresence();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(TABLE, PLAYER, OCCUPANCY, true);
    expect(from.mock.calls.filter(([t]) => t === 'table_seats')).toEqual([]);
    expect(engine.disconnectEngine.isSittingOut(TABLE, PLAYER)).toBe(true);
    expect(claimTournamentMovePresence(PLAYER, TABLE)).toBeNull();
  });

  it('writes nothing when the new chair already shows the sit-out', () => {
    depositSatOut('00000000-0000-4000-8000-0000000000d2');
    const { engine, persist } = destination(true);
    engine.adoptTournamentMovePresence();
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports a refused write instead of throwing out of the seat sweep', async () => {
    depositSatOut('00000000-0000-4000-8000-0000000000d3');
    const { engine, persist } = destination(false);
    persist.mockImplementationOnce(() => Promise.reject(new Error('PLATFORM_FROZEN')));
    expect(() => engine.adoptTournamentMovePresence()).not.toThrow();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('no engine code PATCHes a chair is_sitting_out or leave_pending directly', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'node_modules') walk(path);
        } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
          files.push(path);
        }
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      let at = src.indexOf("from('table_seats')");
      while (at >= 0) {
        const window = src.slice(at, at + 400);
        const update = window.match(/\.(update|upsert)\(([^)]*)\)/);
        if (update && /is_sitting_out|leave_pending/.test(update[2])) {
          offenders.push(relative(root, file));
        }
        at = src.indexOf("from('table_seats')", at + 1);
      }
    }
    expect(offenders).toEqual([]);
  });
});
