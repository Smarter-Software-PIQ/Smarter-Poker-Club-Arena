import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ rpc: vi.fn(), reportError: vi.fn() }));

vi.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => testState.rpc(...args) },
}));

vi.mock('../../src/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => testState.reportError(...args),
}));

vi.mock('../../src/components/console/SpadeConsole', () => ({
  SpadeConsole: ({
    title,
    pill,
    children,
  }: {
    title: string;
    pill?: string;
    children?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      <span data-testid="pill">{pill}</span>
      {children}
    </section>
  ),
}));

import WeeklyRakebackStatus from '../../src/components/union/WeeklyRakebackStatus';
import {
  parseWeeklyRakebackStatus,
  weeklyRakebackOverall,
} from '../../src/utils/weeklyRakebackStatus';

const UNION = 'fade0000-0000-0000-0000-000000000001';

function stage(key: string, label: string, state: string, extra: Record<string, unknown> = {}) {
  return { key, label, state, at: null, amount: null, count: null, detail: '', ...extra };
}

/** Last week's production answer (2026-11-09 08:00Z), as the dry run returned it. */
function lastWeek(inProgress = false, override: Record<string, unknown>[] | null = null) {
  return {
    union_id: UNION,
    period: {
      start: '2026-11-02T08:00:00+00:00',
      end: '2026-11-09T08:00:00+00:00',
      time_zone: 'America/Chicago',
      label: 'Mon Nov 2, 2026 2:00 AM CST To Mon Nov 9, 2026 2:00 AM CST (America/Chicago)',
    },
    scheduled_for: '2026-11-09T10:00:00+00:00',
    in_progress: inProgress,
    stages: override ?? [
      stage('preparation', 'Preparation', 'done', {
        at: '2026-11-09T10:51:00.188309+00:00',
        count: 1371,
      }),
      stage('clubs_paid', 'Clubs Paid', 'done', {
        at: '2026-11-09T10:52:00.249576+00:00',
        amount: 840213.67,
        count: 3,
        detail: '3 Clubs Paid',
      }),
      stage('agents_paid', 'Agents Paid', 'done', {
        at: '2026-11-09T10:53:00.16623+00:00',
        amount: 695.49,
        count: 20,
      }),
      stage('players_paid', 'Players Paid', 'done', {
        at: '2026-11-09T14:40:28.612883+00:00',
        amount: 642268.52,
        count: 1339,
      }),
      stage('statements_sent', 'Statements Sent', 'done', {
        count: 4,
        detail: '4 Of 4 Club Statements Delivered',
      }),
      stage('invoices_match', 'Invoices Match Club Data', 'not_checked', {
        count: 0,
        detail: 'Not Checked Yet: 0 Of 4 Club Statements Checked',
        scheduled_at: '2026-11-09T10:00:00+00:00',
        elapsed_seconds: 3900,
      }),
      stage('books_closed', 'Books Closed', 'done', { at: '2026-11-11T09:06:09.542475+00:00' }),
    ],
    statements: [
      {
        number: 'MIDWAY-2026-000039',
        club: 'KINGS CLUB',
        house: false,
        direction: 'club owes union',
        amount: 6042.96,
        delivered: true,
        matches_club_data: null,
        credit_notes: [{ number: 'MIDWAY-2026-000045', amount: 21.25, delivered: true }],
      },
      {
        number: 'MIDWAY-2026-000040',
        club: 'Midway Union',
        house: true,
        direction: 'union owes club',
        amount: 21.25,
        delivered: false,
        matches_club_data: null,
        credit_notes: [],
      },
      {
        number: 'MIDWAY-2026-000041',
        club: 'The Felt Society',
        house: false,
        direction: 'club owes union',
        amount: 88305.04,
        delivered: true,
        matches_club_data: false,
        credit_notes: [],
      },
    ],
    last_updated: '2026-11-15T16:31:11.773216+00:00',
    generated_at: '2026-11-16T02:09:21.386535+00:00',
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Weekly Rakeback Status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testState.rpc.mockReset();
    testState.reportError.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows every stage in Title Case with two-decimal chips and Chicago times', async () => {
    testState.rpc.mockResolvedValue({ data: lastWeek(), error: null });
    render(<WeeklyRakebackStatus unionId={UNION} />);
    await flush();
    expect(testState.rpc).toHaveBeenCalledWith('ca_union_weekly_rakeback_status', {
      p_union_id: UNION,
    });
    for (const label of [
      'Preparation',
      'Clubs Paid',
      'Agents Paid',
      'Players Paid',
      'Statements Sent',
      'Invoices Match Club Data',
      'Books Closed',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('840,213.67')).toBeTruthy();
    expect(screen.getByText('695.49')).toBeTruthy();
    expect(screen.getByText('642,268.52')).toBeTruthy();
    expect(screen.getByText('Mon Nov 9, 2026 4:52 AM Chicago Time')).toBeTruthy();
    expect(screen.getByText('Week Ending Mon Nov 9')).toBeTruthy();
    expect(
      screen.getByText(
        'Accounting Period Mon Nov 2, 2026 2:00 AM CST To Mon Nov 9, 2026 2:00 AM CST (America/Chicago)'
      )
    ).toBeTruthy();
    expect(screen.getByText('Not Checked Yet')).toBeTruthy();
    expect(screen.getByText('Not Checked Yet: 0 Of 4 Club Statements Checked')).toBeTruthy();
    expect(screen.getByText('1 Hr 5 Min Elapsed')).toBeTruthy();
    expect(screen.getByText('Payout Scheduled Mon Nov 9, 2026 4:00 AM Chicago Time')).toBeTruthy();
    expect(screen.getByText('6,042.96')).toBeTruthy();
    expect(screen.getAllByText('Club Owes Union')).toHaveLength(2);
    expect(screen.getByText('Credit Note MIDWAY-2026-000045 21.25')).toBeTruthy();
    expect(screen.getByText('Union House Statement, Record Only')).toBeTruthy();
    expect(screen.getByText('Differs From Club Data')).toBeTruthy();
    expect(screen.getAllByText('Club Data Not Checked')).toHaveLength(1);
    // Never green while a verification stage has no record.
    expect(screen.getByTestId('pill').textContent).toBe('Not Finished');
    expect(testState.reportError).not.toHaveBeenCalled();
  });

  it('shows a stage with no deadline as Not Finished Yet with its run time and elapsed time, never Late', async () => {
    testState.rpc.mockResolvedValue({
      data: lastWeek(true, [
        stage('statements_sent', 'Statements Sent', 'not_finished', {
          detail: 'Not Finished Yet: 3 Of 4 Club Statements Delivered',
          scheduled_at: '2026-11-09T10:00:00+00:00',
          elapsed_seconds: 2 * 86400 + 3 * 3600 + 7 * 60,
        }),
        stage('agents_paid', 'Agents Paid', 'not_finished', {
          scheduled_at: '2026-11-09T10:00:00+00:00',
          deadline_at: '2026-11-10T10:00:00+00:00',
          deadline_source: 'Automatic Payout Window Closes (Run Time Plus 24 Hours)',
          elapsed_seconds: 120,
        }),
      ]),
      error: null,
    });
    render(<WeeklyRakebackStatus unionId={UNION} />);
    await flush();
    expect(screen.getAllByText('Not Finished Yet')).toHaveLength(2);
    expect(screen.getByText('2 Days 3 Hr 7 Min Elapsed')).toBeTruthy();
    expect(screen.getAllByText('Scheduled Mon Nov 9, 2026 4:00 AM Chicago Time')).toHaveLength(2);
    expect(screen.getByText('No Deadline Set')).toBeTruthy();
    expect(
      screen.getByText(
        'Deadline Tue Nov 10, 2026 4:00 AM Chicago Time (Automatic Payout Window Closes (Run Time Plus 24 Hours))'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Late')).toBeNull();
    expect(screen.getByTestId('pill').textContent).toBe('Not Finished');
  });

  it('never refreshes on its own when nothing is running', async () => {
    testState.rpc.mockResolvedValue({ data: lastWeek(false), error: null });
    render(<WeeklyRakebackStatus unionId={UNION} />);
    await flush();
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    await flush();
    expect(testState.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Does Not Refresh On Its Own/)).toBeTruthy();
  });

  it('refreshes at most once a minute while the payout is in progress, and stops when it ends', async () => {
    const running = lastWeek(true, [
      stage('preparation', 'Preparation', 'done'),
      stage('clubs_paid', 'Clubs Paid', 'done', { amount: 840213.67, count: 3 }),
      stage('agents_paid', 'Agents Paid', 'running', { detail: 'Paying Now' }),
      stage('players_paid', 'Players Paid', 'not_finished'),
      stage('statements_sent', 'Statements Sent', 'not_finished'),
      stage('invoices_match', 'Invoices Match Club Data', 'not_checked'),
      stage('books_closed', 'Books Closed', 'not_checked'),
    ]);
    testState.rpc
      .mockResolvedValueOnce({ data: running, error: null })
      .mockResolvedValueOnce({ data: running, error: null })
      .mockResolvedValue({ data: lastWeek(false), error: null });
    render(<WeeklyRakebackStatus unionId={UNION} />);
    await flush();
    expect(screen.getByTestId('pill').textContent).toBe('Running');
    expect(screen.getByText('Paying Now')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(testState.rpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flush();
    expect(testState.rpc).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(testState.rpc).toHaveBeenCalledTimes(3);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    await flush();
    expect(testState.rpc).toHaveBeenCalledTimes(3);
  });

  it('says so when the caller may not see the union', async () => {
    testState.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'not authorized for this union' },
    });
    render(<WeeklyRakebackStatus unionId={UNION} />);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('You Do Not Have Access');
    expect(testState.reportError).not.toHaveBeenCalled();
  });

  it('names the worst stage for the whole week and refuses inexact amounts', () => {
    const late = parseWeeklyRakebackStatus(
      lastWeek(true, [stage('clubs_paid', 'Clubs Paid', 'late')])
    );
    expect(weeklyRakebackOverall(late)).toBe('Late');
    const failed = parseWeeklyRakebackStatus(
      lastWeek(false, [stage('books_closed', 'Books Closed', 'failed')])
    );
    expect(weeklyRakebackOverall(failed)).toBe('Failed');
    const done = parseWeeklyRakebackStatus(
      lastWeek(false, [stage('books_closed', 'Books Closed', 'done')])
    );
    expect(weeklyRakebackOverall(done)).toBe('Done');
    const unchecked = parseWeeklyRakebackStatus(
      lastWeek(false, [
        stage('statements_sent', 'Statements Sent', 'done'),
        stage('invoices_match', 'Invoices Match Club Data', 'not_checked'),
        stage('books_closed', 'Books Closed', 'not_checked'),
      ])
    );
    expect(weeklyRakebackOverall(unchecked)).toBe('Not Finished');
    const before = parseWeeklyRakebackStatus(
      lastWeek(false, [
        stage('clubs_paid', 'Clubs Paid', 'waiting'),
        stage('books_closed', 'Books Closed', 'not_checked'),
      ])
    );
    expect(weeklyRakebackOverall(before)).toBe('Waiting');
    expect(() =>
      parseWeeklyRakebackStatus(
        lastWeek(false, [stage('clubs_paid', 'Clubs Paid', 'done', { amount: 1.005 })])
      )
    ).toThrow(/exact chip-cent/);
    expect(() => parseWeeklyRakebackStatus(lastWeek(false, [stage('x', 'X', 'paused')]))).toThrow(
      /state/
    );
  });
});
