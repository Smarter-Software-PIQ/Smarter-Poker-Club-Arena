/**
 * A FINISHED CHEST HOLDS NOTHING (Dan 2026-11-06).
 *
 * "I ONLY CARE HOW LONG IT TAKES TO START THE NEXT HAND DEAL AFTER THE POT IS
 * PUSHED TO THE WINNER." Every mystery knockout opened two holds: the count
 * gate, released when the chest finished, and a wall-clock failsafe
 * (coalesce + chest + 15 s, about 30 s) that nothing released. Production
 * final tables waited 34-35 s per knockout. The law:
 *
 *   1. When a table's last chest finishes, the failsafe its chests placed is
 *      given back and the table may deal at once.
 *   2. While another chest still holds the table, nothing is given back.
 *   3. Chests finishing out of order still release the latest deadline.
 *   4. A hold placed by any other authority (spin wheel, booked start, add-on
 *      break) after the chest's failsafe is never shortened.
 *   5. An award whose gate is never closed keeps its failsafe.
 */
import { describe, expect, it } from 'vitest';
import { ServerTableEngine } from '../engine/ServerTableEngine.js';
import { TournamentManager } from './TournamentManager.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABLE = id(3);

function setup() {
  const m: any = new TournamentManager(id(1), {} as any, id(9), performance.now() + 60000);
  const engine: any = new ServerTableEngine(TABLE);
  m.tableEngines.set(TABLE, engine);
  const holdUntil = () => engine.dealHoldUntilMs as number;
  return { m, engine, holdUntil };
}

describe('a finished chest holds nothing', () => {
  it('the last finished chest gives back its failsafe', () => {
    const { m, engine, holdUntil } = setup();
    const deadline = Date.now() + 30_000;
    m.openBountyGate(TABLE, 'a1', deadline);
    expect(engine.hasOpenBountyReveal()).toBe(true);
    expect(holdUntil()).toBe(deadline);
    m.closeBountyGate(TABLE, 'a1');
    expect(engine.hasOpenBountyReveal()).toBe(false);
    expect(holdUntil()).toBe(0);
  });

  it('nothing is given back while another chest still holds the table', () => {
    const { m, engine, holdUntil } = setup();
    const d1 = Date.now() + 30_000;
    const d2 = Date.now() + 45_000;
    m.openBountyGate(TABLE, 'a1', d1);
    m.openBountyGate(TABLE, 'a2', d2);
    m.closeBountyGate(TABLE, 'a1');
    expect(engine.hasOpenBountyReveal()).toBe(true);
    expect(holdUntil()).toBe(d2);
    m.closeBountyGate(TABLE, 'a2');
    expect(holdUntil()).toBe(0);
  });

  it('chests finishing out of order still release the latest deadline', () => {
    const { m, holdUntil } = setup();
    m.openBountyGate(TABLE, 'a1', Date.now() + 30_000);
    m.openBountyGate(TABLE, 'a2', Date.now() + 45_000);
    m.closeBountyGate(TABLE, 'a2');
    m.closeBountyGate(TABLE, 'a1');
    expect(holdUntil()).toBe(0);
  });

  it('a later hold from another authority is never shortened', () => {
    const { m, engine, holdUntil } = setup();
    m.openBountyGate(TABLE, 'a1', Date.now() + 30_000);
    const breakEnds = Date.now() + 120_000;
    engine.holdDealingUntil(breakEnds);
    m.closeBountyGate(TABLE, 'a1');
    expect(holdUntil()).toBe(breakEnds);
  });

  it('an award whose gate is never closed keeps its failsafe', () => {
    const { m, holdUntil } = setup();
    const deadline = Date.now() + 30_000;
    m.openBountyGate(TABLE, 'a1', deadline);
    expect(holdUntil()).toBe(deadline);
  });
});
