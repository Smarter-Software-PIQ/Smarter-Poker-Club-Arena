/**
 * A HELD TABLE THAT NEVER LIFTS IS A STALLED TABLE (2026-11-06).
 *
 * Sunday Deep Stack Satellite 25 (fbb86b2a) sat nine hours with five tables
 * parked behind its qualifier boundary and one holding a retained hand that
 * never started, while /health reported stalledTableCount 0: the stall census
 * only ever looked at tables that were NOT paused by design. Pinned here:
 *  1. a seated table held past its bound by a boundary owner, a table move or
 *     a never-started original is stalled, and named with its holder;
 *  2. a scheduled, self-ending pause (the hourly break, a final-table deal, a
 *     weekly payout, a halt, the operator floor, a deal hold, an FSM pause) is
 *     never a stall here, however long;
 *  3. hand-for-hand (also the tournament's own :55 break) is a stall only past
 *     ten minutes;
 *  4. GameServer adds these tables to /health stalledTables and keeps them OUT
 *     of the liveness verdict, so nothing here can restart the process;
 *  5. every authority isPausedByDesign() reads is named by describePauseOwners().
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyHeldStall,
  HAND_FOR_HAND_STALL_MS,
  HELD_STALL_MS,
  SCHEDULED_PAUSE_OWNERS,
} from './heldTableStall.js';

const held = (over: Partial<Parameters<typeof classifyHeldStall>[0]> = {}) => ({
  seated: 8,
  paused: true,
  msPaused: HELD_STALL_MS + 1,
  msSinceProgress: 0,
  owners: [] as string[],
  heldOriginal: false,
  ...over,
});

describe('1. a boundary, a move or a held original past its bound is stalled', () => {
  it('Satellite 25: tables parked behind the qualifier boundary', () => {
    expect(classifyHeldStall(held({ owners: ['terminal_closeout'] }))).toMatchObject({
      reason: 'held_by_boundary',
      heldBy: ['terminal_closeout'],
    });
  });
  it('a table held by an unclaimed tournament move', () => {
    expect(classifyHeldStall(held({ owners: ['tournament_move'] }))?.reason).toBe(
      'held_by_boundary'
    );
  });
  it('the boundary still names the tournament break beside it', () => {
    expect(
      classifyHeldStall(held({ owners: ['hand_for_hand', 'terminal_closeout'] }))
    ).toMatchObject({
      reason: 'held_by_boundary',
      heldBy: ['hand_for_hand', 'terminal_closeout'],
    });
  });
  it('Satellite 30 72417d9c: a retained original that never started, held at the gate', () => {
    expect(
      classifyHeldStall(held({ owners: ['terminal_closeout'], heldOriginal: true }))?.reason
    ).toBe('held_by_boundary');
    expect(classifyHeldStall(held({ owners: [], heldOriginal: true, paused: false }))?.reason).toBe(
      'held_original_unstarted'
    );
  });
  it('is not a stall inside its bound', () => {
    expect(
      classifyHeldStall(held({ owners: ['terminal_closeout'], msPaused: HELD_STALL_MS }))
    ).toBeNull();
  });
  it('falls back to the progress clock when the pause clock is unstamped', () => {
    expect(
      classifyHeldStall(
        held({ owners: ['terminal_closeout'], msPaused: 0, msSinceProgress: HELD_STALL_MS + 5 })
      )?.msHeld
    ).toBe(HELD_STALL_MS + 5);
  });
  it('needs a seated table', () => {
    expect(classifyHeldStall(held({ owners: ['terminal_closeout'], seated: 1 }))).toBeNull();
  });
  it('an unpaused, unheld table is left to the ordinary stall census', () => {
    expect(classifyHeldStall(held({ paused: false }))).toBeNull();
  });
});

describe('2. a scheduled pause is never a stall here', () => {
  for (const owner of SCHEDULED_PAUSE_OWNERS) {
    it(owner, () => {
      expect(
        classifyHeldStall(
          held({
            owners: [owner, 'terminal_closeout'],
            heldOriginal: true,
            msPaused: 9 * 3_600_000,
          })
        )
      ).toBeNull();
    });
  }
  it('the scheduled set is exactly these seven owners', () => {
    expect([...SCHEDULED_PAUSE_OWNERS].sort()).toEqual(
      [
        'deal_hold',
        'dealing_halt',
        'final_table_deal',
        'fsm_paused',
        'maintenance',
        'operator_floor',
        'weekly_payout',
      ].sort()
    );
  });
});

describe('3. hand-for-hand is a stall only past ten minutes', () => {
  it('a five-minute tournament break plus its overlap is not a stall', () => {
    expect(
      classifyHeldStall(held({ owners: ['hand_for_hand'], msPaused: HAND_FOR_HAND_STALL_MS }))
    ).toBeNull();
  });
  it('past ten minutes it is', () => {
    expect(
      classifyHeldStall(held({ owners: ['hand_for_hand'], msPaused: HAND_FOR_HAND_STALL_MS + 1 }))
        ?.reason
    ).toBe('hand_for_hand_overlong');
  });
});

describe('4. GameServer names them on /health and keeps them out of liveness', () => {
  const GS = readFileSync(join(__dirname, '../GameServer.ts'), 'utf8');
  const status = GS.slice(
    GS.indexOf('  getStatus(livenessQuery?'),
    GS.indexOf('    let totalHands = 0;')
  );
  it('the stall list carries the held tables', () => {
    expect(status).toContain('const heldStalledTables = this.heldStalledTables(liveStalledIds);');
    expect(status).toMatch(
      /const stalledTables = \[\s*\.\.\.liveStalledTables,\s*\.\.\.heldStalledTables,/
    );
  });
  it('the liveness verdict is still computed from the per-table liveness only', () => {
    const verdict = status.slice(status.indexOf('evaluateEngineLiveness({'));
    expect(verdict.slice(0, verdict.indexOf('});'))).toContain('tables: tableLiveness,');
    expect(verdict.slice(0, verdict.indexOf('});'))).not.toMatch(/heldStalled|stalledTables/);
  });
  it('the census reads the engine owners and the held original through classifyHeldStall', () => {
    const fn = GS.slice(
      GS.indexOf('  private heldStalledTables('),
      GS.indexOf('  private tournamentTablesFailingAdmission(')
    );
    expect(fn).toContain('owners: engine.describePauseOwners?.() ?? [],');
    expect(fn).toContain('heldOriginal: engine.isPreparedOriginalHeldAtPauseGate?.() === true,');
    expect(fn).toContain('const stall = classifyHeldStall({');
  });
});

describe('5. every by-design authority is named', () => {
  const BASE = readFileSync(join(__dirname, 'ServerTableEngineBase.ts'), 'utf8');
  const pausedFn = BASE.slice(BASE.indexOf('  isPausedByDesign(): boolean {'));
  const pausedReturn = pausedFn.slice(pausedFn.indexOf('return ('), pausedFn.indexOf(');\n  }'));
  const ownersFn = BASE.slice(
    BASE.indexOf('  describePauseOwners(): string[] {'),
    BASE.indexOf('  /** Ms spent in the current by-design pause')
  );
  it.each([
    'handForHandPaused',
    'weeklyPayoutPauseOwners.size > 0',
    'maintenancePaused',
    'finalTableDealPaused',
    'terminalCloseoutPaused',
    'dealingHaltLock',
    'operatorFloorPaused',
    'tournamentMovePauseOwners.size > 0',
    'dealHoldUntilMs > Date.now()',
    "tableFSM.state === 'paused'",
  ])('%s', (flag) => {
    expect(pausedReturn).toContain(flag);
    expect(ownersFn).toContain(flag);
  });
});
