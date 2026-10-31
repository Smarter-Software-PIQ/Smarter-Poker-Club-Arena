import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LobbyTable from '../../src/components/lobby/LobbyTable';
import { tournamentEntry, type LobbyTournamentRow } from '../../src/components/lobby/lobbyEntries';
vi.mock('../../src/services/tableWarmup', () => ({
  warmTable: vi.fn(),
  observeLobbyTableWarmups: () => () => {},
}));
vi.mock('../../src/hooks/useSpinTierAvailability', () => ({ useSpinTierAvailability: () => null }));
afterEach(cleanup);
function board(guarantee: number) {
  const entry = tournamentEntry(
    {
      id: 'full-width',
      name: 'Nightly 10K (NLH)',
      format_contract: 'mtt-v1',
      game_type: 'NLH',
      variant: 'freezeout',
      status: 'REGISTERING',
      start_time: new Date(Date.now() + 600000).toISOString(),
      buy_in_amount: 35,
      buy_in_fee: 0,
      guaranteed_prize: guarantee,
      current_players: 12,
      max_players: 100,
    } as LobbyTournamentRow,
    'mtt'
  );
  const onSelect = vi.fn();
  const writers = { onJoinTable: vi.fn(), onRegister: vi.fn(), onWaitlistToggle: vi.fn() };
  render(
    <MemoryRouter>
      <LobbyTable
        entries={[entry]}
        category="MTT"
        selectedId={null}
        onSelect={onSelect}
        onActivate={onSelect}
        ctx={{
          ...writers,
          waitlistedIds: new Set(),
          seatedIds: new Set(),
          registeredIds: new Set(),
          favoriteIds: new Set(),
        }}
      />
    </MemoryRouter>
  );
  return { entry, onSelect, writers };
}
describe('tournament headers span their whole event frame', () => {
  it('overrides the machine desktop row gap and paints the actual last visible cell', () => {
    const css = readFileSync('src/components/lobby/LobbyTable.css', 'utf8');
    expect(css).toMatch(
      /\.club-lobby-machine \.lobby-table\.has-tournament-headings\s*\{\s*border-spacing: 0;/
    );
    expect(css.replace(/\s+/g, ' ')).toContain(
      "[data-tournament-body='true'].is-featured > td[data-last-visible='true']"
    );
    expect(css).toMatch(/tr\.lt-event-gap > td\s*\{\s*height: 4px;\s*padding: 0;/);
  });
  it('puts full title, snowflake and bold guarantee above the existing numeric columns in both layouts', () => {
    board(10000);
    for (const scope of ['.compact-lobby', '.lobby-table']) {
      const table = document.querySelector(scope)!;
      const heading = table.querySelector('tr[data-tournament-heading="full-width"]')!;
      const body = table.querySelector('tr[data-id="full-width"]')!;
      const span = Number(heading.querySelector('td')!.getAttribute('colspan'));
      expect(span).toBe(table.querySelectorAll('thead th').length);
      expect(heading.nextElementSibling).toBe(body);
      expect(within(heading as HTMLElement).getByText('Nightly 10K (NLH)')).toBeTruthy();
      expect(
        within(heading as HTMLElement).getByRole('img', { name: 'Freezeout Tournament' })
      ).toBeTruthy();
      expect(heading.querySelector('strong')?.textContent).toBe('10K Guarantee');
      expect(body.querySelectorAll('[data-tournament-icon]')).toHaveLength(0);
      expect(body.textContent).toContain('35');
      expect(body.textContent).toContain('12');
    }
    expect(document.querySelectorAll('tr[data-id="full-width"]')).toHaveLength(2);
  });
  it('omits a guarantee when none exists and preserves header and Details selection without spending', () => {
    const { entry, onSelect, writers } = board(0);
    const compact = document.querySelector('.compact-lobby')!;
    const heading = compact.querySelector('tr[data-tournament-heading]')!;
    expect(heading.querySelector('strong')).toBeNull();
    fireEvent.click(heading);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(entry);
    fireEvent.click(within(compact as HTMLElement).getByRole('button', { name: /^Details:/ }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    for (const writer of Object.values(writers)) expect(writer).not.toHaveBeenCalled();
  });
  it('tracks visible wide columns after responsive shedding without changing the compact span', () => {
    board(100);
    const wide = document.querySelector('.lobby-table')!;
    for (const cls of ['format', 'actions', 'leveltime', 'tlevel', 'tstack']) {
      (wide.querySelector(`thead .lt-col-${cls}`) as HTMLElement).style.display = 'none';
    }
    fireEvent.resize(window);
    expect(wide.querySelector('tr[data-tournament-heading] td')!.getAttribute('colspan')).toBe(
      String(wide.querySelectorAll('thead th').length - 5)
    );
    expect(wide.querySelector('tr[data-id] td[data-last-visible="true"]')?.className).toContain(
      'lt-col-status'
    );
    expect(
      document
        .querySelector('.compact-lobby tr[data-tournament-heading] td')!
        .getAttribute('colspan')
    ).toBe('4');
  });
});
