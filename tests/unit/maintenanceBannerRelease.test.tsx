import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const schedule = vi.hoisted(() => ({ mode: 'daily' }));
const maintenance = vi.hoisted(() => ({
  active: false,
  phase: 'idle',
  breakEndsAtMs: null as number | null,
  reason: '',
}));
vi.mock('../../src/hooks/useMaintenanceBreak', () => ({
  useMaintenanceBreak: () => ({ maintenanceBreak: maintenance, routineSchedule: schedule.mode }),
}));
vi.mock('../../src/utils/serverClock', () => ({ serverNow: () => Date.now() }));
import { MaintenanceBreakBanner } from '../../src/components/common/MaintenanceBreakBanner';

beforeEach(() => {
  vi.useFakeTimers();
  schedule.mode = 'daily';
  vi.setSystemTime(new Date('2026-10-21T08:56:00Z'));
  Object.assign(maintenance, { active: false, phase: 'idle', breakEndsAtMs: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('maintenance banner release follows the current Chicago clock immediately', () => {
  it('does not restore a cached upcoming notice after the daily break ends', () => {
    const view = render(<MaintenanceBreakBanner />);
    expect(screen.getByRole('status').textContent).toContain('Daily Maintenance At 4 AM');
    vi.setSystemTime(new Date('2026-10-21T08:58:00Z'));
    Object.assign(maintenance, { active: true, phase: 'last_hand' });
    view.rerender(<MaintenanceBreakBanner />);
    expect(screen.getByRole('status').textContent).toContain('Finishing Their Current Hand');
    vi.setSystemTime(new Date('2026-10-21T09:05:00Z'));
    Object.assign(maintenance, { active: false, phase: 'idle' });
    view.rerender(<MaintenanceBreakBanner />);
    // No interval advance: release must refresh the cached pre-break value now.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a valid upcoming notice immediately when an emergency ends during its lead-in', () => {
    maintenance.active = true;
    maintenance.phase = 'finalizing';
    vi.setSystemTime(new Date('2026-10-21T08:54:00Z'));
    const view = render(<MaintenanceBreakBanner />);
    vi.setSystemTime(new Date('2026-10-21T08:56:00Z'));
    Object.assign(maintenance, { active: false, phase: 'idle' });
    view.rerender(<MaintenanceBreakBanner />);
    expect(screen.getByRole('status').textContent).toContain('Daily Maintenance At 4 AM');
  });
});

it('changes routine copy only with the observed mode and preserves active authority', () => {
  vi.setSystemTime(new Date('2026-10-21T12:56:00Z'));
  const view = render(<MaintenanceBreakBanner />);
  expect(screen.queryByRole('status')).toBeNull();
  schedule.mode = 'phase1-hourly';
  view.rerender(<MaintenanceBreakBanner />);
  expect(screen.getByRole('status').textContent).toContain('Hourly Maintenance');
  schedule.mode = 'daily';
  view.rerender(<MaintenanceBreakBanner />);
  expect(screen.queryByRole('status')).toBeNull();
  schedule.mode = 'unknown';
  Object.assign(maintenance, { active: true, phase: 'finalizing' });
  view.rerender(<MaintenanceBreakBanner />);
  expect(screen.getByRole('status').textContent).toContain('Seats And Chips Remain Held');
  Object.assign(maintenance, { active: false, phase: 'idle' });
  vi.setSystemTime(new Date('2026-10-21T08:56:00Z'));
  view.rerender(<MaintenanceBreakBanner />);
  expect(screen.queryByRole('status')).toBeNull();
});

it('refreshes only the notice on the existing fifteen-second display tick', () => {
  schedule.mode = 'phase1-hourly';
  vi.setSystemTime(new Date('2026-10-21T12:54:59Z'));
  render(<MaintenanceBreakBanner />);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(15000));
  expect(screen.getByRole('status').textContent).toContain('Hourly Maintenance');
  act(() => vi.advanceTimersByTime(180000));
  expect(screen.queryByRole('status')).toBeNull();
});
