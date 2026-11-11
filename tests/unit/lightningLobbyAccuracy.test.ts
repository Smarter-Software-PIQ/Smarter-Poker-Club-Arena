/**
 * LIGHTNING LOBBY ACCURACY AND THE START TICKER (Dan 2026-11-11).
 *
 * An empty PLO5 1/2 Lightning game printed "Tick 442h Ago: Quiet", "Avg Pot
 * 135" from weeks-old hands, and its table told the player Lightning could
 * not start. The lobby statistics now belong to the lobby day that starts at
 * the daily 04:00 Chicago maintenance, a stalled or Lightning-run tick is
 * never printed as current, and a feeder-stage Lightning game counts down the
 * players it still needs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ gte: [] as unknown[][] }));

vi.mock('../../src/lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.gte = (...args: unknown[]) => {
    calls.gte.push(args);
    return chain;
  };
  chain.order = () => chain;
  chain.limit = async () => ({ data: [{ pot_size: 10 }, { pot_size: 30 }], error: null });
  return {
    supabase: { from: () => chain, rpc: vi.fn() },
    subscribeToTable: vi.fn(() => vi.fn()),
    subscribeToHandState: vi.fn(() => vi.fn()),
  };
});

import { LOBBY_DAY, lobbyDayStart } from '../../src/components/lobby/lobbyDay';
import { LIGHTNING_TICK_LINE, staffTickLine } from '../../src/components/lobby/cashGameTick';
import { lightningStartTickerText } from '../../src/components/table/LightningStartTicker';
import { tableService } from '../../src/services/TableService';
import { DAILY_WINDOW } from '../../server/src/maintenance/dailyWindow';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const EM_DASH = String.fromCharCode(0x2014);

describe('the lobby day starts at the daily 04:00 Chicago maintenance', () => {
  it('is the same boundary the engine maintenance window opens on', () => {
    expect(LOBBY_DAY.timeZone).toBe(DAILY_WINDOW.timeZone);
    expect(`${String(LOBBY_DAY.resetHour).padStart(2, '0')}:00`).toBe(DAILY_WINDOW.windowStart);
  });

  it('resets at 4 AM and holds until the next 4 AM, through both DST changes', () => {
    // CST (UTC-6): 04:00 Chicago is 10:00Z.
    expect(lobbyDayStart(new Date('2026-11-11T21:00:00Z')).toISOString()).toBe(
      '2026-11-11T10:00:00.000Z'
    );
    expect(lobbyDayStart(new Date('2026-11-11T10:00:00Z')).toISOString()).toBe(
      '2026-11-11T10:00:00.000Z'
    );
    // 03:59 Chicago still belongs to yesterday's lobby day.
    expect(lobbyDayStart(new Date('2026-11-11T09:59:59Z')).toISOString()).toBe(
      '2026-11-10T10:00:00.000Z'
    );
    // CDT (UTC-5): 04:00 Chicago is 09:00Z.
    expect(lobbyDayStart(new Date('2026-07-04T12:00:00Z')).toISOString()).toBe(
      '2026-07-04T09:00:00.000Z'
    );
    // Fall back (Nov 1 2026, 02:00 CDT -> 01:00 CST): that 4 AM is CST.
    expect(lobbyDayStart(new Date('2026-11-01T12:00:00Z')).toISOString()).toBe(
      '2026-11-01T10:00:00.000Z'
    );
    expect(lobbyDayStart(new Date('2026-11-01T09:30:00Z')).toISOString()).toBe(
      '2026-10-31T09:00:00.000Z'
    );
    // Spring forward (Mar 8 2026, 02:00 CST -> 03:00 CDT): that 4 AM is CDT.
    expect(lobbyDayStart(new Date('2026-03-08T12:00:00Z')).toISOString()).toBe(
      '2026-03-08T09:00:00.000Z'
    );
    expect(lobbyDayStart(new Date('2026-03-08T08:59:00Z')).toISOString()).toBe(
      '2026-03-07T10:00:00.000Z'
    );
  });

  it('the average pot reads only hands from the lobby day', async () => {
    const since = lobbyDayStart(new Date('2026-11-11T21:00:00Z'));
    await expect(tableService.getAveragePot('table-1', since)).resolves.toBe(20);
    expect(calls.gte).toEqual([['created_at', '2026-11-11T10:00:00.000Z']]);
    const panel = read('src/components/lobby/GameLobbyPanel.tsx');
    expect(panel).toMatch(/\.getAveragePot\(entry\.id, lobbyDayStart\(new Date\(\)\)\)/);
  });
});

describe('the staff tick line never prints history as current', () => {
  const NOW = Date.parse('2026-11-11T21:00:00Z');
  it('a 442 hour old tick says the controller stalled, not what it did then', () => {
    const line = staffTickLine('2026-10-24T05:04:08Z', [], NOW);
    expect(line).toBe('Tick 447h Ago: Controller Stalled');
    expect(line).not.toContain('Quiet');
    expect(staffTickLine('2026-11-11T20:59:56Z', [{ moves_planned: 2 }], NOW)).toBe(
      'Tick 4s Ago: Moves Planned 2'
    );
  });

  it('a game in Lightning says the pool runs it and the must-move tick rests', () => {
    expect(staffTickLine('2026-10-24T05:04:08Z', [], NOW, { lightning: true })).toBe(
      LIGHTNING_TICK_LINE
    );
    expect(LIGHTNING_TICK_LINE).not.toContain(EM_DASH);
    expect(read('src/components/lobby/GameLobbyPanel.tsx')).toMatch(/lightning: isLightning,/);
  });
});

describe('XX More Players Until Lightning Games Start', () => {
  const base = {
    lightningEnabled: true,
    clusterMode: 'must_move',
    onThreshold: 5,
    offThreshold: 4,
  };
  it('counts down live while the Lightning game is still its feeder game', () => {
    expect(lightningStartTickerText({ ...base, liveEligible: 1 })).toBe(
      '4 More Players Until Lightning Games Start'
    );
    expect(lightningStartTickerText({ ...base, liveEligible: 4 })).toBe(
      '1 More Player Until Lightning Games Start'
    );
  });

  it('disappears once Lightning starts, while it switches, on Classic and when unknown', () => {
    expect(lightningStartTickerText({ ...base, liveEligible: 5 })).toBeNull();
    expect(
      lightningStartTickerText({ ...base, clusterMode: 'pending_on', liveEligible: 5 })
    ).toBeNull();
    expect(
      lightningStartTickerText({ ...base, clusterMode: 'lightning', liveEligible: 2 })
    ).toBeNull();
    expect(
      lightningStartTickerText({ ...base, lightningEnabled: false, liveEligible: 1 })
    ).toBeNull();
    expect(lightningStartTickerText({ ...base, liveEligible: null })).toBeNull();
    expect(lightningStartTickerText(null)).toBeNull();
  });

  it('sits under the bomb pot indicator on the table, never in a Lightning room', () => {
    const page = read('src/pages/TablePage.tsx');
    const bomb = page.indexOf('<span className="table-brand__bomb">{bombPotBadge.text}</span>');
    const ticker = page.indexOf(
      '{!lightningRoom && <LightningStartTicker state={tableGameLightningState} />}'
    );
    expect(bomb).toBeGreaterThan(0);
    expect(ticker).toBeGreaterThan(bomb);
    expect(ticker - bomb).toBeLessThan(200);
  });
});
