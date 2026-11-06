/**
 * WATCH AT TABLE ON THE PLAYER RECORD (Dan 2026-10-16)
 *
 * "WHEN YOU ARE INSIDE OF PLAYER MANAGEMENT, AND THE PLAYER IS 'AT A TABLE'
 * THERE SHOULD BE A BUTTON TO EASILY CLICK TO BE REDIRECTED AND WATCH THEM."
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../../src/components/common/Toast', () => ({ useToast: () => toast }));

import MemberWatchAtTable from '../../src/components/club/MemberWatchAtTable';
import { PlayerSearchService } from '../../src/services/PlayerSearchService';

function Where() {
  const location = useLocation();
  return <span aria-label="current route">{`${location.pathname}${location.search}`}</span>;
}

function renderRecord(seated: boolean) {
  return render(
    <MemoryRouter initialEntries={['/record']}>
      <Routes>
        <Route
          path="/record"
          element={
            <MemberWatchAtTable
              clubUuid="club-1"
              memberUserId="player-1"
              seated={seated}
              fallback={<p>Record Caption</p>}
            />
          }
        />
        <Route path="/table/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Player Record: Watch At Table', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    toast.error.mockReset();
  });

  it('asks for nothing and shows the caption while the player is not seated', () => {
    const live = vi.spyOn(PlayerSearchService, 'getMemberLiveTables');
    renderRecord(false);
    expect(screen.getByText('Record Caption')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(live).not.toHaveBeenCalled();
  });

  it('offers Watch At Table for the seated player and opens the observer view', async () => {
    const user = userEvent.setup();
    vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue([
      {
        table_id: 'table-9',
        name: 'midnight cash',
        stakes: '$1/$2',
        is_tournament: false,
      },
    ]);
    const access = vi.spyOn(PlayerSearchService, 'getTableWatchAccess').mockResolvedValue({
      found: true,
      table_id: 'table-9',
      can_watch: true,
      action: 'watch',
    });
    renderRecord(true);

    const button = await screen.findByRole('button', { name: 'Watch At Table, Midnight Cash' });
    expect(screen.queryByText('Record Caption')).not.toBeInTheDocument();
    expect(PlayerSearchService.getMemberLiveTables).toHaveBeenCalledWith('player-1', 'club-1');

    await user.click(button);

    expect(access).toHaveBeenCalledWith('table-9', 'player-1');
    await waitFor(() =>
      expect(screen.getByLabelText('current route')).toHaveTextContent('/table/table-9?observer=1')
    );
  });

  it('keeps the caption when no live table can be read', async () => {
    vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue([]);
    renderRecord(true);
    await waitFor(() => expect(PlayerSearchService.getMemberLiveTables).toHaveBeenCalled());
    expect(screen.getByText('Record Caption')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not route when the player has already left the table', async () => {
    const user = userEvent.setup();
    vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue([
      {
        table_id: 'table-9',
        name: 'midnight cash',
        stakes: '',
        is_tournament: false,
      },
    ]);
    vi.spyOn(PlayerSearchService, 'getTableWatchAccess').mockResolvedValue({
      found: false,
      can_watch: false,
      action: 'unavailable',
    });
    renderRecord(true);

    await user.click(await screen.findByRole('button', { name: /Watch At Table/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This Player Has Left The Table.')
    );
    expect(screen.queryByLabelText('current route')).not.toBeInTheDocument();
    expect(screen.getByText('Record Caption')).toBeInTheDocument();
  });

  it.each(['cash-1', 'mtt-2', 'cash-3'])(
    'offers every table and watches the selected table %s',
    async (selected) => {
      const user = userEvent.setup();
      vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue(
        ['cash-1', 'mtt-2', 'cash-3'].map((id) => ({
          table_id: id,
          name: id,
          stakes: '100/200',
          is_tournament: id === 'mtt-2',
        }))
      );
      const access = vi.spyOn(PlayerSearchService, 'getTableWatchAccess').mockResolvedValue({
        found: true,
        can_watch: true,
        action: 'watch',
      });
      renderRecord(true);
      await screen.findByRole('group', { name: 'Current Tables' });
      expect(screen.getAllByRole('button')).toHaveLength(3);
      await user.click(screen.getByRole('button', { name: new RegExp(selected, 'i') }));
      expect(access).toHaveBeenCalledExactlyOnceWith(selected, 'player-1');
      await waitFor(() =>
        expect(screen.getByLabelText('current route')).toHaveTextContent(
          `/table/${selected}?observer=1`
        )
      );
    }
  );

  it('removes only the departed table and retains the other watch buttons', async () => {
    const user = userEvent.setup();
    vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue(
      ['Left', 'Still Playing'].map((name) => ({
        table_id: name,
        name,
        stakes: '',
        is_tournament: false,
      }))
    );
    vi.spyOn(PlayerSearchService, 'getTableWatchAccess').mockResolvedValue({
      found: false,
      can_watch: false,
      action: 'unavailable',
    });
    renderRecord(true);
    await user.click(await screen.findByRole('button', { name: 'Watch At Table, Left' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Watch At Table, Left' })).toBeNull()
    );
    expect(screen.getByRole('button', { name: 'Watch At Table, Still Playing' })).toBeEnabled();
    expect(screen.queryByText('Record Caption')).not.toBeInTheDocument();
  });

  it.each(['observers_restricted', 'unavailable'])(
    'does not route when access is refused: %s',
    async (action) => {
      const user = userEvent.setup();
      vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue([
        { table_id: 'table-9', name: 'Cash', stakes: '', is_tournament: false },
      ]);
      vi.spyOn(PlayerSearchService, 'getTableWatchAccess').mockResolvedValue({
        found: true,
        can_watch: false,
        action: action as 'observers_restricted' | 'unavailable',
      });
      renderRecord(true);
      await user.click(await screen.findByRole('button', { name: 'Watch At Table, Cash' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(screen.queryByLabelText('current route')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Watch At Table, Cash' })).toBeEnabled();
    }
  );

  it('replaces the full list on record refresh and ignores an older pending response', async () => {
    let resolveOld!: (tables: []) => void;
    const live = vi
      .spyOn(PlayerSearchService, 'getMemberLiveTables')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce([
        { table_id: 'new', name: 'New Table', stakes: '', is_tournament: true },
      ]);
    const record = (refreshKey: number) => (
      <MemoryRouter>
        <MemberWatchAtTable
          clubUuid="club-1"
          memberUserId="player-1"
          seated
          refreshKey={refreshKey}
        />
      </MemoryRouter>
    );
    const view = render(record(0));
    view.rerender(record(1));
    await screen.findByRole('button', { name: 'Watch At Table, New Table' });
    resolveOld([]);
    await waitFor(() => expect(live).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Watch At Table, New Table' })).toBeInTheDocument();
  });

  it('carries the selected tournament player so the viewer own finished entry cannot replace the watch', async () => {
    const user = userEvent.setup();
    vi.spyOn(PlayerSearchService, 'getMemberLiveTables').mockResolvedValue([
      {
        table_id: 'mtt-9',
        tournament_id: 'event-9',
        name: 'Nightly',
        stakes: '',
        is_tournament: true,
      },
      { table_id: 'cash-1', name: 'Cash', stakes: '', is_tournament: false },
    ]);
    vi.spyOn(PlayerSearchService, 'getTableWatchAccess').mockResolvedValue({
      found: true,
      can_watch: true,
      action: 'watch',
    });
    renderRecord(true);
    await user.click(await screen.findByRole('button', { name: 'Watch At Table, Nightly' }));
    await waitFor(() =>
      expect(screen.getByLabelText('current route')).toHaveTextContent(
        '/table/mtt-9?observer=1&followTournament=event-9&followPlayer=player-1&followName=Player'
      )
    );
  });

  it('is wired into the Player Record from the record presence', () => {
    const page = readFileSync(
      resolve(__dirname, '../../src/pages/MemberManagementPage.tsx'),
      'utf8'
    );
    expect(page).toContain('<MemberWatchAtTable');
    expect(page).toContain('seated={detail!.presence.is_seated}');
  });
});
