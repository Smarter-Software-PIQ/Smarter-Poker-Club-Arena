import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TournamentTabProps } from '../../src/components/tournament/details/types';
vi.mock('../../src/hooks/useMasterBusSubscription', () => ({ useMasterBusSubscription: vi.fn() }));
import BlindsTab from '../../src/components/tournament/details/BlindsTab';
afterEach(cleanup);
function input(extra: Record<string, unknown> = {}, count = 50): TournamentTabProps {
  return {
    tournament: {
      id: 'full-structure',
      status: 'RUNNING',
      current_level: 6,
      format_contract: 'mtt-v2',
      late_reg_levels: 12,
      late_reg_mins: 0,
      rebuy_levels: 10,
      is_rebuy: true,
      add_on_available: true,
      ...extra,
    },
    blindLevels: Array.from({ length: count }, (_, i) => ({
      level: i + 1,
      smallBlind: 25 * (i + 1),
      bigBlind: 50 * (i + 1),
      ante: i * 10,
      duration: 8,
      isBreak: false,
    })),
  } as TournamentTabProps;
}
function schedule() {
  return screen.getByRole('region', { name: 'Full Blind Structure' });
}
describe('full published tournament blind schedule', () => {
  it.each(['mtt-v2', 'spin-v1', 'sng-v1', 'satellite-v1'])(
    'lists every published level for %s',
    (format_contract) => {
      render(<BlindsTab {...input({ format_contract })} />);
      const table = within(schedule()).getByRole('table');
      expect(within(table).getAllByRole('row')).toHaveLength(51);
      expect(
        within(within(table).getAllByRole('row').at(-1)!).getByRole('rowheader')
      ).toHaveTextContent('50');
      expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('1,250 / 2,500');
      expect(table.querySelector('[aria-current="step"]')).toHaveTextContent('7Current');
      expect(table.querySelector('[data-level-state="next"]')).toHaveTextContent('8Next');
      expect(within(table).getByText('Last Entry Level').closest('tr')).toHaveTextContent('12');
      expect(within(table).getByText('Rebuys End').closest('tr')).toHaveTextContent('10');
      expect(schedule()).toHaveTextContent('Through The End Of The 60-Second Add-On Period');
      expect(schedule()).toHaveTextContent('After The Last Entry Level And Current Hands Finish');
    }
  );
  it('retains the current highlight on a synchronized break', () => {
    render(<BlindsTab {...input({ on_break: true })} />);
    expect(schedule().querySelector('[aria-current="step"]')).toHaveTextContent('7Current');
  });
  it('uses committed current amounts and supports shorter and longer structures', () => {
    const props = input(
      { blind_level_state: { index: 6, small_blind: 400, big_blind: 800, ante: 800 } },
      60
    );
    const view = render(<BlindsTab {...props} />);
    expect(schedule().querySelector('[aria-current="step"]')).toHaveTextContent('400 / 800800');
    expect(within(schedule()).getAllByRole('row')).toHaveLength(61);
    view.rerender(
      <BlindsTab {...input({ current_level: 2, is_rebuy: false, add_on_available: false }, 3)} />
    );
    expect(within(schedule()).getAllByRole('row')).toHaveLength(4);
    expect(schedule().querySelector('[data-level-state="next"]')).toBeNull();
    expect(within(schedule()).queryByText('Add-On Period')).toBeNull();
    expect(within(schedule()).queryByText('Rebuy Period')).toBeNull();
  });
  it('shows both clock and level entry limits without inventing a minute-level mapping', () => {
    render(<BlindsTab {...input({ add_on_available: false, late_reg_mins: 90 })} />);
    expect(schedule()).toHaveTextContent(
      'End Of Level 12 Or 90 Min After Start (Whichever Comes First)'
    );
  });
  it('keeps the schedule for finished events without live highlights', () => {
    render(<BlindsTab {...input({ status: 'COMPLETED', prize_pool_finalized: true })} />);
    expect(within(schedule()).getAllByRole('row')).toHaveLength(51);
    expect(schedule().querySelector('[data-level-state]')).toBeNull();
    expect(schedule()).toHaveTextContent('Closed');
  });
  it('preserves the unpublished structure state', () => {
    render(<BlindsTab {...input({}, 0)} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getByText('No Blind Structure Published For This Tournament Yet')
    ).toBeInTheDocument();
  });
});
