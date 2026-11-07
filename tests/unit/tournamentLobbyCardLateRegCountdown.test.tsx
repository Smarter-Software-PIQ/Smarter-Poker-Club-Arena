import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/context/InTabLobbyContext', () => ({ useAppNavigate: () => vi.fn() }));
vi.mock('../../src/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import TournamentLobbyCard from '../../src/components/tournament/TournamentLobbyCard';

/*
 * Dan 2026-11-06: "FIX IT SO IT ALWAYS SHOWS THE COUNT DOWN". The tournament
 * lobby card printed a static "Open Through Add-On" for every add-on event and
 * "N Lvls Left" for the rest. It now counts down with the lobby's projection.
 * Fixture: the production Nightly 10K (66eb539e) as read on 2026-11-07.
 */
const tenLevels = JSON.stringify(
  Array.from({ length: 40 }, (_, i) => ({ level: i + 1, durationMinutes: 10 }))
);
const nightly = (over: Record<string, unknown> = {}) =>
  ({
    format_contract: 'mtt-v2',
    id: '66eb539e',
    name: 'Nightly 10K (NLH)',
    type: 'mtt',
    buyIn: 35,
    prizePool: 0,
    maxPlayers: null,
    registeredPlayers: 75,
    status: 'running',
    startsAt: '2026-11-07T01:00:00Z',
    started_at: '2026-11-07T01:00:00Z',
    synchronized_breaks: true,
    late_reg_levels: 9,
    late_reg_mins: 90,
    rebuy_levels: 9,
    current_level: 3,
    level_started_at: '2026-11-07T01:35:01.264Z',
    blind_structure: tenLevels,
    add_on_available: true,
    addon_from_start: false,
    addon_period_triggered: false,
    addon_period_started_at: null,
    addon_period_ends_at: null,
    prize_pool_finalized: false,
    on_break: false,
    break_ends_at: null,
    ...over,
  }) as never;

/* The status pill also reads "Late Reg"; the row is the label with a value beside it. */
const lateReg = () =>
  screen
    .getAllByText('Late Reg')
    .map((label) => label.parentElement!)
    .find((row) => row.children.length === 2)!.lastElementChild!.textContent;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the tournament lobby card counts late registration down', () => {
  it('counts an add-on event through its break to the add-on minute', () => {
    vi.setSystemTime(new Date('2026-11-07T01:40:00Z'));
    render(<TournamentLobbyCard tournament={nightly()} knownRegistration={false} />);
    // 02:46:01.264 - see tests/unit/lateRegCountdown.test.ts for the derivation.
    expect(lateReg()).toBe('Ends In 66:02');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lateReg()).toBe('Ends In 66:01');
  });

  it('names the add-on minute while it is open', () => {
    vi.setSystemTime(new Date('2026-11-07T02:47:00Z'));
    render(
      <TournamentLobbyCard
        tournament={nightly({
          current_level: 9,
          level_started_at: '2026-11-07T02:45:05Z',
          addon_period_triggered: true,
          addon_period_started_at: '2026-11-07T02:46:49.575Z',
          addon_period_ends_at: '2026-11-07T02:47:49.575Z',
        })}
        knownRegistration={false}
      />
    );
    expect(lateReg()).toBe('Add-On Ends In 0:50');
  });

  it('says the add-on is starting while the entry levels drain past the estimate', () => {
    vi.setSystemTime(new Date('2026-11-07T02:46:30Z'));
    render(
      <TournamentLobbyCard
        tournament={nightly({ current_level: 9, level_started_at: '2026-11-07T02:45:05Z' })}
        knownRegistration={false}
      />
    );
    expect(lateReg()).toBe('Add-On Starting');
  });

  it('an ordinary event counts down too instead of printing levels left', () => {
    vi.setSystemTime(new Date('2026-11-07T01:40:00Z'));
    render(
      <TournamentLobbyCard
        tournament={nightly({ add_on_available: false, late_reg_mins: 60 })}
        knownRegistration={false}
      />
    );
    expect(lateReg()).toBe('Ends In 20:00');
  });

  it('before the start, an add-on event says it runs through the add-on', () => {
    vi.setSystemTime(new Date('2026-11-07T00:30:00Z'));
    render(
      <TournamentLobbyCard
        tournament={nightly({
          status: 'registering',
          started_at: null,
          current_level: 0,
          level_started_at: null,
        })}
        knownRegistration={false}
      />
    );
    expect(lateReg()).toBe('Through Lvl 9 + Add-On');
  });
});
