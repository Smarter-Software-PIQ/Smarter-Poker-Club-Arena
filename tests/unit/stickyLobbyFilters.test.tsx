import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StickyLobbyFilters from '../../src/components/lobby/StickyLobbyFilters';

describe('compact sticky lobby controls', () => {
  it('uses the live browse, favorites and sheet handlers with accessible saved state', () => {
    const onBrowse = vi.fn();
    const onFavorites = vi.fn();
    const onFilters = vi.fn();
    const { rerender } = render(
      <StickyLobbyFilters
        gameLabel="MTT"
        favoritesOnly
        showFavorites
        sortOnly={false}
        {...{ onBrowse, onFavorites, onFilters }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Browse Game Types' }));
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Sticky Filters' }));
    expect(onBrowse).toHaveBeenCalledOnce();
    expect(onFavorites).toHaveBeenCalledOnce();
    expect(onFilters).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    rerender(
      <StickyLobbyFilters
        gameLabel="All"
        favoritesOnly
        showFavorites={false}
        sortOnly
        {...{ onBrowse, onFavorites, onFilters }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Sticky Filters' })).toHaveTextContent('Sort');
  });
});
