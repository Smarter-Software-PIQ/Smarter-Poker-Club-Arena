import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LobbyTable from '../../src/components/lobby/LobbyTable';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';

vi.mock('../../src/hooks/useSpinTierAvailability', () => ({
  useSpinTierAvailability: () => null,
}));
vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  observeLobbyTableWarmups: () => () => undefined,
}));

const NOW = Date.parse('2026-11-01T18:00:00Z');
const START = '2026-11-04T05:15:08.000Z';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width') ? width <= 660 : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const source: LobbyTournamentRow = {
    id: 'future-tournament',
    name: 'Nightly 10K (NLH)',
    game_type: 'NLH',
    format_contract: 'mtt-v2',
    buy_in_amount: 35,
    buy_in_fee: 0,
    guaranteed_prize: 10000,
    start_time: START,
    status: 'REGISTERING',
    current_players: 2,
    max_players: null,
    starting_chips: 20000,
  };
  const onSelect = vi.fn();
  const onActivate = vi.fn();
  const onRegister = vi.fn();
  render(
    <MemoryRouter>
      <LobbyTable
        entries={[tournamentEntry(source, 'mtt')]}
        category="MTT"
        selectedId={null}
        onSelect={onSelect}
        onActivate={onActivate}
        ctx={{
          favoriteIds: new Set(),
          seatedIds: new Set(),
          registeredIds: new Set(),
          waitlistedIds: new Set(),
          onRegister,
        }}
      />
    </MemoryRouter>
  );
  return { onSelect, onActivate, onRegister };
}

describe('exact start time is touch-accessible on the real lobby row', () => {
  it.each([
    ['compact', 393, '.compact-lobby'],
    ['wide', 1280, '.lobby-table-wrap'],
  ] as const)(
    '%s switches the clock without selecting or activating a tournament',
    (_, width, selector) => {
      const actions = mount(width);
      const board = document.querySelector(selector);
      expect(board).not.toBeNull();
      const ui = within(board as HTMLElement);
      const showExact = ui.getByRole('button', { name: 'Show Exact Start Time' });
      expect(showExact).toHaveAttribute('aria-pressed', 'false');
      expect(within(showExact).getByText('2d 11h', { selector: 'strong' })).toBeInTheDocument();
      expect(within(showExact).getByText('Starts In')).toBeInTheDocument();
      expect(showExact).not.toHaveTextContent('59:15:08');

      fireEvent.click(showExact);
      const showCountdown = ui.getByRole('button', { name: 'Show Countdown' });
      expect(showCountdown).toHaveAttribute('aria-pressed', 'true');
      const time = showCountdown.querySelector('time');
      expect(time).toHaveAttribute('datetime', START);
      const instant = new Date(START);
      expect(showCountdown).toHaveTextContent(
        instant.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      );
      expect(showCountdown).toHaveTextContent(
        instant.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      );
      expect(showCountdown).toHaveAttribute(
        'title',
        instant.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })
      );
      expect(within(showCountdown).queryByText('2d 11h')).toBeNull();

      fireEvent.click(showCountdown);
      const restored = ui.getByRole('button', { name: 'Show Exact Start Time' });
      expect(within(restored).getByText('2d 11h', { selector: 'strong' })).toBeInTheDocument();
      expect(restored).toHaveAttribute('aria-pressed', 'false');
      fireEvent.doubleClick(restored);
      for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    }
  );
});
