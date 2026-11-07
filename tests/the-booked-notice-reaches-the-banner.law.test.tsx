import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Dan, 2026-11-07: the 13:16 Chicago cutover gave players two minutes' notice.
// #9952 projected every booked owner window into the client
// (bookedMaintenanceNotice); this proves the banner actually says it.

const h = vi.hoisted(() => ({
  now: Date.parse('2026-11-08T18:30:00Z'), // 12:30 PM Chicago
  booked: null as null | {
    id: string;
    kind: 'engine' | 'database';
    noticeAtMs: number | null;
    notBeforeMs: number;
    notAfterMs: number;
  },
  maintenance: { active: false, phase: 'idle', breakEndsAtMs: null as number | null, reason: '' },
  entry: { frozen: false, endsAtMs: null as number | null },
}));
vi.mock('../src/utils/serverClock', () => ({ serverNow: () => h.now }));
vi.mock('../src/hooks/useMaintenanceBreak', () => ({
  useMaintenanceBreak: () => ({ maintenanceBreak: h.maintenance, routineSchedule: 'daily' }),
}));
vi.mock('../src/hooks/useEntryFreeze', () => ({
  useEntryFreeze: () => ({ freeze: h.entry, label: undefined, secondsLeft: null, message: '' }),
}));
vi.mock('../src/utils/maintenanceSchedule', async (original) => {
  const real = await original<typeof import('../src/utils/maintenanceSchedule')>();
  return { ...real, bookedMaintenanceNotice: () => h.booked };
});

import { MaintenanceBreakBanner } from '../src/components/common/MaintenanceBreakBanner';

const WINDOW = {
  id: '2026-11-08-test-engine',
  kind: 'engine' as const,
  noticeAtMs: Date.parse('2026-11-08T18:00:00Z'),
  notBeforeMs: Date.parse('2026-11-08T19:00:00Z'), // 1:00 PM Chicago
  notAfterMs: Date.parse('2026-11-09T01:00:00Z'), // 7:00 PM Chicago
};

beforeEach(() => {
  h.booked = null;
  h.now = Date.parse('2026-11-08T18:30:00Z');
  Object.assign(h.maintenance, { active: false, phase: 'idle', breakEndsAtMs: null });
  Object.assign(h.entry, { frozen: false, endsAtMs: null });
});
afterEach(cleanup);

describe('a booked window reaches the banner', () => {
  it('before the window: names the window in Chicago time', () => {
    h.booked = WINDOW;
    render(<MaintenanceBreakBanner />);
    expect(screen.getByTestId('maintenance-banner-booked').textContent).toContain(
      'Short Maintenance Break Possible Between 1:00 PM And 7:00 PM Chicago Time.'
    );
  });

  it('inside the window: a break can start any time before it closes', () => {
    h.booked = WINDOW;
    h.now = Date.parse('2026-11-08T20:00:00Z');
    render(<MaintenanceBreakBanner />);
    expect(screen.getByTestId('maintenance-banner-booked').textContent).toContain(
      'A Short Maintenance Break Can Start Any Time Before 7:00 PM Chicago Time.'
    );
  });

  it('no booking, no notice; a live break or a frozen door outranks the booking', () => {
    render(<MaintenanceBreakBanner />);
    expect(screen.queryByTestId('maintenance-banner-booked')).toBeNull();
    cleanup();
    h.booked = WINDOW;
    Object.assign(h.maintenance, { active: true, phase: 'last_hand' });
    render(<MaintenanceBreakBanner />);
    expect(screen.queryByTestId('maintenance-banner-booked')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Finishing Their Current Hand');
    cleanup();
    Object.assign(h.maintenance, { active: false, phase: 'idle' });
    Object.assign(h.entry, { frozen: true, endsAtMs: null });
    render(<MaintenanceBreakBanner />);
    expect(screen.queryByTestId('maintenance-banner-booked')).toBeNull();
    expect(screen.getByTestId('maintenance-banner-entry')).toBeTruthy();
  });
});
