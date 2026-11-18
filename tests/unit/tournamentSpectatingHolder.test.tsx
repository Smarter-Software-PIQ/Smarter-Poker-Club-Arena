import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fx = vi.hoisted(() => ({ read: vi.fn(), report: vi.fn() }));
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: { getTournament: fx.read },
}));
vi.mock('../../src/utils/serverClock', () => ({ serverNow: () => Date.now() }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: fx.report }));
vi.mock('../../src/components/lobby/game-cards/useFitText', () => ({
  useFitText: () => ({ current: null }),
}));
import { TournamentLateRegCallToAction } from '../../src/components/table/TournamentLateRegCallToAction';
const now = Date.parse('2026-10-23T01:00:00Z');
const row = {
  status: 'RUNNING',
  current_level: 0,
  late_reg_levels: 0,
  late_reg_mins: 1,
  started_at: new Date(now - 55_000).toISOString(),
};
const props = { tournamentId: 'first', onRegister: vi.fn(), fallback: <span>Closed</span> };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  fx.read.mockResolvedValue(row);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function mount() {
  const view = render(<TournamentLateRegCallToAction {...props} />);
  await act(async () => {});
  return view;
}
describe('live tournament spectating holder', () => {
  it('ticks from the deadline and removes entry at expiry', async () => {
    await mount();
    expect(screen.getByText('0:05')).toBeTruthy();
    expect(screen.getByText('Tap Here To Enter')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('0:04')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByTestId('tournament-late-reg-cta')).toBeNull();
    expect(screen.getByText('Closed')).toBeTruthy();
  });
  it('keeps the existing entry callback and refuses a clock that expired while suspended', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('tournament-late-reg-cta'));
    expect(props.onRegister).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 6000);
    fireEvent.click(screen.getByTestId('tournament-late-reg-cta'));
    expect(props.onRegister).toHaveBeenCalledTimes(1);
  });
  it('does not paint the previous tournament while the next read is pending', async () => {
    const view = await mount();
    fx.read.mockReturnValue(new Promise(() => {}));
    view.rerender(<TournamentLateRegCallToAction {...props} tournamentId="second" />);
    expect(screen.queryByTestId('tournament-late-reg-cta')).toBeNull();
  });
  it('reports a failed read and shows the fallback', async () => {
    fx.read.mockRejectedValue(new Error('Read Failed'));
    await mount();
    expect(screen.getByText('Closed')).toBeTruthy();
    expect(fx.report).toHaveBeenCalledTimes(1);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  THE CLOCK COMPARTMENT COUNTS ON AN ADD-ON EVENT (Dan 2026-11-10)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan, with a screenshot of the Nightly 10K's holder: "THE 'REGISTRATION
 * CLOSES IN' BUTTON ISN'T WORKING OR FUNCTIONAL. IT SHOULD HAVE THE COUNT DOWN
 * CLOCK INSIDE OF IT."
 *
 * The strict `lateRegEndMs` answers null for an add-on event until the engine
 * stamps `addon_period_ends_at`, which happens only once the entry levels are
 * already over - so for the whole registration window the compartment printed
 * the bare word "Open". The rows below are the production shape it was printed
 * on: add_on_available true, addon_period_ends_at null.
 */
const addOnLevels = Array.from({ length: 12 }, (_, i) => ({
  level: i + 1,
  smallBlind: 25 * (i + 1),
  bigBlind: 50 * (i + 1),
  ante: 0,
  durationMinutes: 10,
}));
/** The Nightly 10K as production carried it: entry through level 10 + the add-on. */
const addOnRow = (over: Record<string, unknown> = {}) => ({
  status: 'RUNNING',
  current_level: 9,
  late_reg_levels: 10,
  rebuy_levels: 12,
  late_reg_mins: 0,
  prize_pool_finalized: false,
  add_on_available: true,
  addon_from_start: false,
  addon_period_started_at: null,
  addon_period_ends_at: null,
  synchronized_breaks: false,
  on_break: false,
  started_at: new Date(now - 90 * 60_000).toISOString(),
  level_started_at: new Date(now - 60_000).toISOString(),
  blind_structure: JSON.stringify(addOnLevels),
  ...over,
});

describe('the spectating holder counts down on an add-on event', () => {
  it('counts to the last entry level plus the add-on minute, never the word Open', async () => {
    fx.read.mockResolvedValue(addOnRow());
    await mount();
    // Level 10 has 9 of its 10 minutes left, then the engine's fixed minute.
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.getByText('Reg Closes In')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('9:59')).toBeTruthy();
  });

  it('counts to the stamped add-on end once the engine opens the window', async () => {
    fx.read.mockResolvedValue(
      addOnRow({
        current_level: 10,
        addon_period_started_at: new Date(now - 10_000).toISOString(),
        addon_period_ends_at: new Date(now + 50_000).toISOString(),
      })
    );
    await mount();
    expect(screen.getByText('Add-On Ends In')).toBeTruthy();
    expect(screen.getByText('0:50')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
  });

  it('keeps the entry offer while the hands drain past the estimate', async () => {
    // Entry levels over, window not stamped yet: the database still admits
    // (addon_period_ends_at IS NULL), so an elapsed ESTIMATE may not retract
    // the button - it only drops the clock to the honest wording.
    fx.read.mockResolvedValue(
      addOnRow({ current_level: 10, level_started_at: new Date(now - 120_000).toISOString() })
    );
    await mount();
    expect(screen.getByTestId('tournament-late-reg-cta')).toBeTruthy();
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.getByText('Starting')).toBeTruthy();
  });
});
