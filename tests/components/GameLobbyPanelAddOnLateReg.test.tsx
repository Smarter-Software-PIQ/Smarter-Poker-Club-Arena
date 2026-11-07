import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const getTournament = vi.fn();
vi.mock('../../src/services/TournamentService', () => ({
  tournamentService: { getTournament: (...args: unknown[]) => getTournament(...args) },
}));
import GameLobbyPanel from '../../src/components/lobby/GameLobbyPanel';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';

afterEach(() => {
  cleanup();
  getTournament.mockReset();
});

/*
 * Dan 2026-11-06: the Nightly 10K carries late_reg_mins 90, but entry for an
 * add-on event is decided only by its add-on window
 * (fn_tournament_late_registration_open). The panel's Late Reg row now says
 * the add-on is part of it instead of reading as if level 9 closed entry.
 */
function panelFor(over: Partial<LobbyTournamentRow> & Record<string, unknown>) {
  const raw = {
    id: 'nightly',
    format_contract: 'mtt-v2',
    name: 'Nightly 10K (NLH)',
    status: 'REGISTERING',
    start_time: '2099-11-07T01:00:00Z',
    variant: 'nlh',
    game_type: 'NLH',
    current_players: 10,
    max_players: null,
    buy_in_amount: 35,
    starting_chips: 10000,
    late_reg_levels: 9,
    late_reg_mins: 90,
    rebuy_levels: 9,
    add_on_available: true,
    ...over,
  } as LobbyTournamentRow;
  getTournament.mockResolvedValue(raw);
  render(
    <MemoryRouter>
      <GameLobbyPanel
        entry={tournamentEntry(raw, 'mtt')}
        clubId="club"
        currentUserId="viewer"
        waitlisted={false}
        seated={false}
        registered={false}
        busy={false}
        onClose={vi.fn()}
        onJoinTable={vi.fn()}
        onWaitlistToggle={vi.fn()}
        onRegister={vi.fn()}
        onUnregister={vi.fn()}
        onSpinJoin={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('the game lobby panel Late Reg row', () => {
  it('says an add-on event runs through its add-on', async () => {
    panelFor({});
    expect(await screen.findByText('9 Levels + Add-On')).toBeTruthy();
    expect(screen.queryByText('90 Min')).toBeNull();
  });

  it('keeps the plain level count for an event without an add-on', async () => {
    panelFor({ add_on_available: false });
    expect(await screen.findByText('9 Levels')).toBeTruthy();
  });
});
