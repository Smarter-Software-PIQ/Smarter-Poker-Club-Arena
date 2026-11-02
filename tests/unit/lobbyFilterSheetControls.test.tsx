import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { supabase } from '../../src/lib/supabase';
import { holdShellReload, isShellReloadBlocked } from '../../src/lib/shellReloadBlocker';
import AdvancedFilters, {
  loadFilters,
  saveFilters,
  type FilterStore,
} from '../../src/components/lobby/AdvancedFilters';
import {
  emptyFilterValue,
  FILTER_SPECS,
  type FilterGameType,
} from '../../src/components/lobby/advancedFilterSpec';

const identity = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('../../src/lib/authUtils', () => ({
  readLocalSession: () => (identity.userId ? { userId: identity.userId } : null),
}));
vi.mock('../../src/hooks/usePlatformCapability', () => ({
  usePlatformCapability: () => 'available',
}));

const club = 'filter-sheet-controls';
const options = [
  { key: 'recommended', label: 'Recommended' },
  { key: 'players', label: 'Most Players' },
];

beforeEach(() => {
  localStorage.clear();
  identity.userId = null;
});

function section(name: string) {
  return within(screen.getByRole('heading', { name }).closest('details')!);
}

describe('mounted lobby filter controls', () => {
  it.each(['close', 'escape', 'backdrop', 'apply', 'sort-done', 'unmount'])(
    'defers shell adoption throughout real filter interaction and releases on %s',
    (exit) => {
      function Board() {
        const [open, setOpen] = useState(true);
        return open ? (
          <AdvancedFilters
            clubId={club}
            initialType="MTT"
            sortOnly={exit === 'sort-done'}
            sortOptions={options}
            onClose={() => setOpen(false)}
            onApply={vi.fn()}
          />
        ) : null;
      }
      expect(isShellReloadBlocked()).toBe(false);
      const view = render(<Board />);
      try {
        expect(isShellReloadBlocked()).toBe(true);
        const independentLease = holdShellReload();
        try {
          if (exit === 'unmount') view.unmount();
          else if (exit === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
          else if (exit === 'backdrop') fireEvent.click(document.querySelector('.afx-overlay')!);
          else
            fireEvent.click(
              screen.getByRole('button', {
                name:
                  exit === 'sort-done'
                    ? 'Done'
                    : exit === 'apply'
                      ? /^Apply .*Filters$/
                      : 'Close Game Filters',
                exact: true,
              })
            );
          expect(screen.queryByRole('dialog')).toBeNull();
          expect(isShellReloadBlocked()).toBe(true);
        } finally {
          independentLease();
        }
        expect(isShellReloadBlocked()).toBe(false);
      } finally {
        view.unmount();
      }
    }
  );

  it('changes the board type before sorting, restores each tab sort, and follows parent type changes', () => {
    const sorts = vi.fn();
    function Board() {
      const [type, setType] = useState<FilterGameType>('MTT');
      const [orders, setOrders] = useState<Record<string, string>>({
        MTT: 'recommended',
        SPIN: 'players',
      });
      return (
        <>
          <button onClick={() => setType('SNG')}>External SNG</button>
          <output aria-label="Board Type">{type}</output>
          <AdvancedFilters
            clubId={club}
            initialType={type}
            allowedTypes={['MTT', 'SPIN', 'SNG']}
            onTypeChange={setType}
            onClose={vi.fn()}
            onApply={vi.fn()}
            sortKey={orders[type] ?? 'recommended'}
            sortOptions={options}
            onSortChange={(key) => {
              sorts(type, key);
              setOrders((prev) => ({ ...prev, [type]: key }));
            }}
          />
        </>
      );
    }
    render(<Board />);
    fireEvent.click(screen.getByRole('button', { name: 'Spins', exact: true }));
    expect(screen.getByLabelText('Board Type')).toHaveTextContent('SPIN');
    expect(screen.getByRole('button', { name: 'Most Players' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recommended', exact: true }));
    expect(sorts).toHaveBeenLastCalledWith('SPIN', 'recommended');
    fireEvent.click(screen.getByRole('button', { name: 'MTT', exact: true }));
    expect(screen.getByRole('button', { name: 'Recommended', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'External SNG' }));
    expect(screen.getByRole('button', { name: "Sit N Go's", exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('applies an untouched newer remote store to the board and cache before close', async () => {
    identity.userId = 'filter-sheet-owner';
    const remote: FilterStore = { MTT: { ...emptyFilterValue(FILTER_SPECS.MTT), games: ['plo4'] } };
    const applied = vi.fn();
    const chain: any = {};
    for (const method of ['select', 'eq']) chain[method] = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: { filters: remote }, error: null });
    vi.mocked(supabase.from).mockReturnValueOnce(chain);
    render(<AdvancedFilters clubId={club} initialType="MTT" onClose={vi.fn()} onApply={applied} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'NLH', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    );
    expect(loadFilters(club, identity.userId)).toEqual(remote);
    expect(applied).toHaveBeenCalledWith(remote);
  });

  it('does not let a late remote store undo a filter tapped during hydration', async () => {
    identity.userId = 'filter-sheet-late-owner';
    let resolve!: (value: unknown) => void;
    const response = new Promise((done) => {
      resolve = done;
    });
    const chain: any = {};
    for (const method of ['select', 'eq']) chain[method] = () => chain;
    chain.maybeSingle = () => response;
    vi.mocked(supabase.from).mockReturnValueOnce(chain);
    const applied = vi.fn();
    render(<AdvancedFilters clubId={club} initialType="MTT" onClose={vi.fn()} onApply={applied} />);
    fireEvent.click(screen.getByRole('button', { name: 'NLH', exact: true }));
    const tapped = loadFilters(club, identity.userId);
    await act(async () => {
      resolve({ data: { filters: { MTT: emptyFilterValue(FILTER_SPECS.MTT) } }, error: null });
      await response;
    });
    expect(screen.getByRole('button', { name: 'NLH', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(loadFilters(club, identity.userId)).toEqual(tapped);
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('uses one satellite exclusion choice and resolves required/excluded contradictions', () => {
    const applied = vi.fn();
    render(<AdvancedFilters clubId={club} initialType="MTT" onClose={vi.fn()} onApply={applied} />);
    const include = screen.getByRole('button', { name: 'Include Satellites' });
    expect(include).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(include);
    expect(loadFilters(club).MTT!.hide).not.toContain('satellite');
    fireEvent.click(
      section('Required Features').getByRole('button', { name: 'Satellite', exact: true })
    );
    expect(loadFilters(club).MTT!.mustHave).toContain('satellite');
    fireEvent.click(
      section('Exclude Features').getByRole('button', { name: 'Satellite', exact: true })
    );
    expect(loadFilters(club).MTT!.mustHave).not.toContain('satellite');
    expect(loadFilters(club).MTT!.hide).toContain('satellite');
    expect(include).toHaveAttribute('aria-pressed', 'false');
    expect(applied).toHaveBeenLastCalledWith(loadFilters(club));
  });

  it('clears presets when a thumb changes and resets only the displayed tab', () => {
    const other = { ...emptyFilterValue(FILTER_SPECS.SNG), games: ['nlh'], format: ['regular'] };
    saveFilters(club, { SNG: other });
    render(<AdvancedFilters clubId={club} initialType="MTT" onClose={vi.fn()} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Micro', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'High', exact: true }));
    expect(loadFilters(club).MTT!.selectedRanges).toEqual(['micro', 'high']);
    fireEvent.change(screen.getByRole('slider', { name: 'Minimum Tournament Buy-In' }), {
      target: { value: '10' },
    });
    expect(loadFilters(club).MTT!.selectedRanges).toEqual([]);
    expect(loadFilters(club).MTT!.rangeMin).toBe(10);
    fireEvent.click(screen.getByRole('button', { name: 'Reset MTT' }));
    expect(loadFilters(club).MTT).toEqual(emptyFilterValue(FILTER_SPECS.MTT));
    expect(loadFilters(club).SNG).toEqual(other);
  });
});
