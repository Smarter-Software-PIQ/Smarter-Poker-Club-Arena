import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TournamentBreakScreen from '../../src/components/table/TournamentBreakScreen';

const clock = vi.hoisted(() => ({ now: 1_000_000 }));
vi.mock('../../src/utils/serverClock', () => ({ serverNow: () => clock.now }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));
const reads = vi.hoisted(() => ({ result: new Promise(() => {}) as Promise<unknown> }));
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in']) query[method] = () => query;
      query.maybeSingle = query.limit = () => reads.result;
      return query;
    },
  },
}));

vi.mock('../../src/services/readTournamentStandings', () => ({
  readTournamentStandings: () => reads.result,
}));
vi.mock('../../src/services/tournamentStandingsUpdates', () => ({
  subscribeTournamentStandings: () => () => {},
}));

const props = {
  isVisible: true,
  breakTimeRemaining: 241,
  tournamentName: 'Prime Time Main Event (NLH) - Table 14',
  currentLevel: 24,
  nextLevel: { level: 25, smallBlind: 10000, bigBlind: 20000, ante: 20000 },
  playersRemaining: 8,
  totalPlayers: 8,
  averageStack: 292500,
  prizePool: 5166,
  topPlayers: [{ playerId: '1', playerName: 'FISH', stack: 910719, rank: 1 }],
};

beforeEach(() => {
  vi.useFakeTimers();
  clock.now = 1_000_000;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the tournament break card', () => {
  it('shares the canonical tournament link and prevents duplicate share sheets', async () => {
    let finish!: () => void;
    const share = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    vi.stubGlobal('navigator', { share });
    render(<TournamentBreakScreen {...props} tournamentId="share-event" />);
    const button = screen.getByRole('button', { name: 'Share Tournament' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: props.tournamentName,
      url: expect.stringMatching(/\/hub\/club-arena\/tournaments\/share-event$/),
    });
    await act(async () => finish());
  });

  it('copies a link without Web Share, and reports clipboard failure honestly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<TournamentBreakScreen {...props} tournamentId="share-event" />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Share Tournament' }))
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/tournaments\/share-event$/));
    expect(screen.getByRole('alert')).toHaveTextContent('Tournament Link Copied');
    writeText.mockRejectedValue(new Error('Denied'));
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Share Tournament' }))
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could Not Share Tournament');
  });

  it('treats dismissing the share sheet as cancellation', async () => {
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')),
    });
    render(<TournamentBreakScreen {...props} tournamentId="share-event" />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Share Tournament' }))
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses the server clock and removes the expired popup without declaring play resumed', () => {
    render(<TournamentBreakScreen {...props} breakEndsAtMs={clock.now + 241000} />);
    expect(screen.getByRole('timer')).toHaveTextContent('4:01');
    act(() => {
      clock.now += 240000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('0:01');
    act(() => {
      clock.now += 5000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Play Resumed')).toBeNull();
  });

  it('keeps last-hand completion distinct from the timed break', () => {
    const view = render(<TournamentBreakScreen {...props} phase="last_hand" />);
    // Dan 2026-11-01: "Last Hand" is the add-on break's word alone; the
    // regular break announces itself as starting while other tables finish.
    expect(screen.getByRole('timer')).toHaveTextContent('Starting Soon');
    expect(screen.getByRole('status')).toHaveTextContent('Break Starts When Every Table Finishes');
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('timer')).not.toHaveTextContent('0:00');
    view.rerender(
      <TournamentBreakScreen {...props} phase="counting_down" breakTimeRemaining={300} />
    );
    expect(screen.getByRole('timer')).toHaveTextContent('5:00');
  });

  it('minimizes and reopens through accessible buttons without blocking the table', () => {
    render(<TournamentBreakScreen {...props} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Break Screen' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), {
      key: 'Escape',
    });
    expect(screen.getByRole('button', { name: 'Open Break Screen' })).toBeVisible();
  });

  it('keeps each minimized clock inside its owning table and reopens the same screen', () => {
    const table = document.createElement('div');
    const otherTable = document.createElement('div');
    document.body.append(table, otherTable);
    const view = render(<TournamentBreakScreen {...props} tableAnchorRef={{ current: table }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const clockButton = within(table).getByRole('button', { name: 'Open Break Screen' });
    expect(clockButton).toHaveClass('break-screen__minimized--on-table');
    expect(within(otherTable).queryByRole('button')).toBeNull();
    expect(clockButton).toHaveTextContent('Break: 4:01');
    fireEvent.click(clockButton);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(within(table).queryByRole('button')).toBeNull();
    view.unmount();
    table.remove();
    otherTable.remove();
  });

  it('keeps real field figures and hero standings, with exact amounts behind compact values', () => {
    render(
      <TournamentBreakScreen
        {...props}
        myPlayer={{ ...props.topPlayers[0], isCurrentUser: true }}
      />
    );
    expect(screen.getByText('292.5K')).toHaveAttribute('title', '292,500');
    expect(screen.getByText('5.1K')).toHaveAttribute('title', '5,166');
    const leaders = screen.getByRole('region', { name: 'Chip Leaders' });
    expect(within(leaders).getByText('FISH')).toBeVisible();
    expect(within(leaders).getByText('910.7K')).toHaveAttribute('title', '910,719');
    expect(screen.getByText('Your Status')).toBeVisible();
  });

  it('does not invent zeros while a tournament read is pending or has failed', async () => {
    reads.result = new Promise(() => {});
    const view = render(
      <TournamentBreakScreen
        isVisible
        breakTimeRemaining={300}
        tournamentName="Event"
        nextLevel={props.nextLevel}
        tournamentId="pending"
      />
    );
    expect(screen.getByText('Loading Standings')).toBeVisible();
    expect(screen.getAllByText('...')).toHaveLength(4);
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('...');
    reads.result = Promise.resolve({ data: null, error: { message: 'Unavailable' } });
    await act(async () =>
      view.rerender(
        <TournamentBreakScreen
          isVisible
          breakTimeRemaining={300}
          tournamentName="Event"
          nextLevel={props.nextLevel}
          tournamentId="failed"
        />
      )
    );
    expect(screen.getByText('Standings Unavailable')).toBeVisible();
    expect(screen.getAllByText('N/A')).toHaveLength(4);
    expect(document.querySelector('.break-screen__blind-value')).toHaveTextContent('N/A');
  });

  it('renders a real empty field without fake leader rows and renders nothing when hidden', () => {
    const view = render(<TournamentBreakScreen {...props} topPlayers={[]} />);
    expect(screen.getByText('Standings Update During The Break')).toBeVisible();
    view.rerender(<TournamentBreakScreen {...props} isVisible={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('removes the minimized popup when the break expires', () => {
  render(<TournamentBreakScreen {...props} breakEndsAtMs={clock.now + 1000} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('button', { name: 'Open Break Screen' })).toBeVisible();
  act(() => {
    clock.now += 1000;
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByRole('button', { name: 'Open Break Screen' })).toBeNull();
});

describe('the card waits for this table to finish its hand (Dan 2026-11-01)', () => {
  // "THE TOURNAMENT BREAK CARD SHOULD NOT POP UP UNTIL THE HAND AT THE
  //  CURRENT TABLE IS FINISHED ... IT NEEDS TO WAIT UNTIL THE HAND IS
  //  COMPLETED AND THEN POP UP" - and for the add-on break: "FIRST CARD
  //  SHOULD ONLY APPEAR WHEN THE TABLE HAS FINISHED ITS HAND AND IS WAITING
  //  FOR THE OTHER TABLE TO FINISH."
  it('renders nothing - full card AND minimized pill - while a hand is live during last_hand', () => {
    const view = render(<TournamentBreakScreen {...props} phase="last_hand" handInProgress />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Break Screen' })).toBeNull();
    // The hand completes: the card appears, in the waiting state.
    view.rerender(<TournamentBreakScreen {...props} phase="last_hand" handInProgress={false} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('Starting Soon');
  });
  it('a running countdown is never suppressed by a wedged hand snapshot', () => {
    render(
      <TournamentBreakScreen
        {...props}
        phase="counting_down"
        breakTimeRemaining={300}
        handInProgress
      />
    );
    expect(screen.getByRole('timer')).toHaveTextContent('5:00');
  });
});

describe('the add-on card carries its own Add On row (Dan 2026-11-01)', () => {
  // "WHERE IS THE ACTUAL 'ADD ON BUTTON' ON THE CARD?! THERE IS NO WAY TO
  //  ACTUALLY ADD ON."
  const notice = { cost: 15, chips: 20000, asset: 'chips' as const };
  it('offers Add On while the 60-second window counts, and it opens the sheet', () => {
    const onAddOn = vi.fn();
    render(
      <TournamentBreakScreen
        {...props}
        phase="counting_down"
        breakTimeRemaining={60}
        addOnNotice={notice}
        onAddOn={onAddOn}
      />
    );
    const row = screen.getByRole('button', { name: 'Add On For 15' });
    fireEvent.click(row);
    expect(onAddOn).toHaveBeenCalledOnce();
  });
  it('holds the row back until the window is actually open', () => {
    render(
      <TournamentBreakScreen {...props} phase="last_hand" addOnNotice={notice} onAddOn={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: /Add On For/ })).toBeNull();
  });
  it('the regular break card never grows an Add On row', () => {
    render(
      <TournamentBreakScreen
        {...props}
        phase="counting_down"
        breakTimeRemaining={300}
        onAddOn={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /Add On For/ })).toBeNull();
  });
});
