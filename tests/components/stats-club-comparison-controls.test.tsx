import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import ClubScopeConsole from '../../src/pages/stats/ClubScopeConsole';
import { CHIP_STATS } from '../../src/services/statsScope';

it.each(['cash', 'tournament'] as const)(
  'loads the optional %s comparison and keeps its controls operable',
  async (gameMode) => {
    const sort = vi.fn();
    const retry = vi.fn();
    function Fixture() {
      const [open, setOpen] = useState(false);
      return (
        <ClubScopeConsole
          gameMode={gameMode}
          statsScope={CHIP_STATS}
          clubLabel="All Clubs"
          selectedClubId={null}
          changeClub={vi.fn()}
          clubs={[
            { id: 'a', name: 'Club A' },
            { id: 'b', name: 'Club B' },
          ]}
          clubsLoading={false}
          clubsError={false}
          onRetryClubs={vi.fn()}
          comparisonOpen={open}
          setComparisonOpen={setOpen}
          comparisonSort="hands"
          changeComparisonSort={sort}
          onRetryComparison={retry}
          comparisonLoading={false}
          comparisonError
          sortedComparisonRows={[]}
        />
      );
    }
    render(<Fixture />);
    const toggle = screen.getByRole('button', { name: 'Compare Clubs' });
    expect(toggle).not.toHaveAttribute('aria-controls');
    fireEvent.click(toggle);
    const region = await screen.findByRole('region', { name: 'Club Comparison' });
    expect(region.id).toBe(toggle.getAttribute('aria-controls'));
    expect(within(region).getByRole('button', { name: 'Hands' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const key = gameMode === 'cash' ? 'Profit' : 'Tournaments';
    fireEvent.click(within(region).getByRole('button', { name: key }));
    expect(sort).toHaveBeenCalledWith(key.toLowerCase());
    fireEvent.click(within(region).getByRole('button', { name: 'Try Again' }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Club Comparison' })).toBeNull();
  }
);
