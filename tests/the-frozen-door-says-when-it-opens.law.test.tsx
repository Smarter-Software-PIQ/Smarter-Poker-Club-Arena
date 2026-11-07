import React from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dan, 2026-11-07 13:20 Chicago: eleven NLH and PLO Lightning joins refused
// during an owner-ordered engine cutover. The engine was back at 13:20:17; the
// database kept entry closed until its release boundary at 13:21:37. The Join
// buttons looked open, the banner followed the engine, the Lightning page
// called the refusal a failure, and no sentence said when seats would reopen.

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  now: 1_794_080_000_000,
  onMaintenance: null as null | ((payload: unknown) => void),
  maintenance: { active: false, phase: 'idle', breakEndsAtMs: null as number | null, reason: '' },
}));
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('../src/utils/serverClock', () => ({ serverNow: () => mocks.now }));
vi.mock('../src/services/RealtimeChannelService', () => ({
  realtimeChannelService: {
    subscribeToLobby: (callbacks: { onMaintenance?: (payload: unknown) => void }) => {
      mocks.onMaintenance = callbacks.onMaintenance ?? null;
      return () => {
        mocks.onMaintenance = null;
      };
    },
  },
}));
vi.mock('../src/hooks/useMaintenanceBreak', () => ({
  useMaintenanceBreak: () => ({ maintenanceBreak: mocks.maintenance, routineSchedule: 'daily' }),
}));

import {
  ENTRY_OPEN,
  entryFreezeFromRow,
  entryFreezeLabel,
  platformFrozenMessageUntil,
} from '../src/utils/entryFreeze';
import { PLATFORM_FROZEN_MESSAGE } from '../src/utils/platformFrozen';
import {
  __resetEntryFreezeForTests,
  freezeRefusalText,
  getEntryFreeze,
  readEntryFreeze,
  subscribeEntryFreeze,
  withFreezeTime,
} from '../src/hooks/useEntryFreeze';
import { MaintenanceBreakBanner } from '../src/components/common/MaintenanceBreakBanner';

const NOW = mocks.now;
const frozenFor = (ms: number | null) => ({
  data: [{ phase: 'recovering', break_ends_at: null, remaining_ms: ms ?? 0, reason: 'x' }],
  error: null,
});

beforeEach(() => {
  __resetEntryFreezeForTests();
  mocks.rpc.mockReset();
  mocks.now = NOW;
  Object.assign(mocks.maintenance, { active: false, phase: 'idle', breakEndsAtMs: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the database row is the freeze', () => {
  it('no row is open; any row is frozen; the end is read-time plus remaining', () => {
    expect(entryFreezeFromRow([], NOW)).toEqual(ENTRY_OPEN);
    expect(entryFreezeFromRow(null, NOW)).toEqual(ENTRY_OPEN);
    expect(entryFreezeFromRow([{ remaining_ms: 47_000 }], NOW)).toEqual({
      frozen: true,
      endsAtMs: NOW + 47_000,
    });
    // A break the engine is still finishing has no certain end, and is still frozen.
    expect(entryFreezeFromRow([{ remaining_ms: 0, phase: 'counting_down' }], NOW)).toEqual({
      frozen: true,
      endsAtMs: null,
    });
  });

  it('the Join label counts down, or says shortly, and is absent when open', () => {
    expect(entryFreezeLabel(ENTRY_OPEN, NOW)).toBeUndefined();
    expect(entryFreezeLabel({ frozen: true, endsAtMs: NOW + 47_000 }, NOW)).toBe('Opens In 0:47');
    expect(entryFreezeLabel({ frozen: true, endsAtMs: NOW + 125_000 }, NOW)).toBe('Opens In 2:05');
    expect(entryFreezeLabel({ frozen: true, endsAtMs: null }, NOW)).toBe('Opening Shortly');
  });

  it('the refusal sentence names the wait, never a clock time', () => {
    expect(platformFrozenMessageUntil(NOW + 47_000, NOW)).toBe(
      'The Platform Is On A Short Maintenance Break. Nothing Is Lost. Seats Reopen In About 47 Seconds.'
    );
    expect(platformFrozenMessageUntil(NOW + 1_000, NOW)).toContain('About 1 Second.');
    expect(platformFrozenMessageUntil(NOW + 125_000, NOW)).toContain('About 3 Minutes.');
    expect(platformFrozenMessageUntil(null, NOW)).toBe(PLATFORM_FROZEN_MESSAGE);
    expect(platformFrozenMessageUntil(NOW + 47_000, NOW)).not.toMatch(/\d{1,2}:\d{2}|[–—]/);
  });
});

describe('the shared store reads the door', () => {
  it('a refused entry is answered with the time, and every surface learns the freeze', async () => {
    mocks.rpc.mockResolvedValue(frozenFor(80_000));
    expect(await withFreezeTime(PLATFORM_FROZEN_MESSAGE)).toContain(
      'Seats Reopen In About 2 Minutes.'
    );
    expect(mocks.rpc).toHaveBeenCalledWith('fn_maintenance_break_state');
    expect(getEntryFreeze()).toEqual({ frozen: true, endsAtMs: NOW + 80_000 });
    // The PostgREST shape fn_lightning_rejoin_seated raised at 19:20 UTC.
    expect(await freezeRefusalText({ code: 'P0001', message: 'PLATFORM_FROZEN' })).toContain(
      'Seats Reopen In About'
    );
    expect(await freezeRefusalText(new Error('GAME_CLOSED'))).toBeNull();
    expect(await withFreezeTime('This Game Is Not Taking Players.')).toBe(
      'This Game Is Not Taking Players.'
    );
  });

  it('a failed read keeps what was known and never claims the door is open', async () => {
    mocks.rpc.mockResolvedValueOnce(frozenFor(30_000));
    await readEntryFreeze();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await readEntryFreeze();
    expect(getEntryFreeze().frozen).toBe(true);
    mocks.rpc.mockRejectedValueOnce(new Error('offline'));
    await readEntryFreeze();
    expect(getEntryFreeze().frozen).toBe(true);
  });

  it('reads once at the stated end and reopens when the database says so', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValue(frozenFor(5_000));
    const off = subscribeEntryFreeze(() => undefined);
    await vi.waitFor(() => expect(getEntryFreeze().frozen).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.now = NOW + 6_000;
    await vi.advanceTimersByTimeAsync(5_800);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(getEntryFreeze()).toEqual(ENTRY_OPEN);
    // Open: nothing is scheduled, nothing polls.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    off();
  });

  it('an uncertain end is read again, so a missed broadcast cannot hold Join shut', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValue(frozenFor(null));
    const off = subscribeEntryFreeze(() => undefined);
    await vi.waitFor(() => expect(getEntryFreeze()).toEqual({ frozen: true, endsAtMs: null }));
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getEntryFreeze()).toEqual(ENTRY_OPEN);
    off();
  });

  it('a request during a running read gets a fresh read, not the stale answer', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.rpc.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = readEntryFreeze();
    mocks.rpc.mockResolvedValueOnce(frozenFor(60_000));
    const second = readEntryFreeze();
    release({ data: [], error: null });
    expect(await first).toEqual(ENTRY_OPEN);
    expect(await second).toEqual({ frozen: true, endsAtMs: NOW + 60_000 });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('a lobby maintenance broadcast is read at once', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const off = subscribeEntryFreeze(() => undefined);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    mocks.rpc.mockResolvedValue(frozenFor(60_000));
    act(() => mocks.onMaintenance?.({ active: true }));
    await vi.waitFor(() => expect(getEntryFreeze().frozen).toBe(true));
    off();
  });
});

describe('the banner ends when the door opens, not when the engine does', () => {
  it('engine resuming but entry still closed: says when new seats open', async () => {
    Object.assign(mocks.maintenance, { active: true, phase: 'resuming' });
    mocks.rpc.mockResolvedValue(frozenFor(80_000));
    render(<MaintenanceBreakBanner />);
    await vi.waitFor(() =>
      expect(screen.getByTestId('maintenance-banner-entry').textContent).toContain(
        'Tables Are Back. New Seats Open In 1:20.'
      )
    );
    expect(screen.queryByText(/Maintenance Complete/)).toBeNull();
  });

  it('engine idle and entry open: nothing at all', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    render(<MaintenanceBreakBanner />);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    expect(screen.queryByTestId('maintenance-banner-entry')).toBeNull();
  });

  it('a live engine break keeps its own banner', async () => {
    Object.assign(mocks.maintenance, { active: true, phase: 'last_hand' });
    mocks.rpc.mockResolvedValue(frozenFor(null));
    render(<MaintenanceBreakBanner />);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toContain('Finishing Their Current Hand');
  });
});

describe('every Join surface is wired to the freeze', () => {
  const src = (p: string) => readFileSync(p, 'utf8');

  it('Lightning: the rejoin freeze is not "Could Not Open The Buy-In", and Join counts down', () => {
    const page = src('src/pages/LightningEntryPage.tsx');
    const caught = page.indexOf('const frozen = await freezeRefusalText(err);');
    expect(caught).toBeGreaterThan(-1);
    expect(caught).toBeLessThan(page.indexOf("'LightningEntryPage.buyin_context_failed'"));
    expect(page).toContain(
      "primaryLabel: joining ? 'Joining...' : (entryFreeze.label ?? joinLabel)"
    );
    expect(page).toMatch(/primaryDisabled:\s*joining \|\|\s*entryFreeze\.freeze\.frozen/);
    expect(page).toContain('message: await withFreezeTime(result.message)');
    expect(page).toContain('<MaintenanceBreakBanner />');
  });

  it('the lobby boards close their Join doors through the one seats-closed label', () => {
    expect(src('src/pages/ClubHomePage.tsx')).toMatch(
      /const arenaSeatsClosedLabel =[\s\S]{0,160}\?\?\s*entryFreeze\.label;/
    );
  });

  it('cash join, must-move and the buy-in modal say the time', () => {
    expect(src('src/pages/ClubHomePage.tsx')).toContain(
      'toast.warning(await withFreezeTime(joinGameRefusalText(err)));'
    );
    expect(src('src/components/table/useCashSeatEntry.ts')).toContain(
      'await withFreezeTime(joinGameRefusalText(error))'
    );
    expect(src('src/components/table/MustMoveLobbyModal.tsx')).toContain(
      'await withFreezeTime(joinGameRefusalText(err))'
    );
    expect(src('src/components/table/BuyInModal.tsx')).toContain(
      'setConfirmError(await withFreezeTime(confirmed.message));'
    );
  });
});
