import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StickyLobbyFilters from '../../src/components/lobby/StickyLobbyFilters';

let observe: IntersectionObserverCallback;
const disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal('innerWidth', 393);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    bottom: 300,
  } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  disconnect.mockClear();
});
function moveControls(bottom: number, isIntersecting: boolean) {
  act(() =>
    observe(
      [{ boundingClientRect: { bottom }, isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
}

describe('compact sticky lobby controls', () => {
  it('remeasures the sticky offset when a phone layout changes to desktop', () => {
    const { container } = render(
      <div className="club-home">
        <div id="lobby-game-section-controls" />
        <StickyLobbyFilters
          gameLabel="MTT"
          favoritesOnly={false}
          showFavorites
          sortOnly={false}
          onBrowse={() => {}}
          onFavorites={() => {}}
          onFilters={() => {}}
        />
      </div>
    );
    const rail = container.querySelector<HTMLElement>('.lobby-sticky-filters')!;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      bottom: 50,
    } as DOMRect);
    rail.style.top = '70px';
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('navigation', { name: 'Quick Lobby Filters' })).toBeVisible();
    vi.stubGlobal('innerWidth', 1280);
    rail.style.top = '0px';
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('navigation', { name: 'Quick Lobby Filters' })).toBeNull();
  });

  it('uses the live browse, favorites and sheet handlers with accessible saved state', () => {
    const onBrowse = vi.fn();
    const onFavorites = vi.fn();
    const onFilters = vi.fn();
    const { rerender } = render(
      <div className="club-home">
        <div id="lobby-game-section-controls" />
        <StickyLobbyFilters
          gameLabel="MTT"
          favoritesOnly
          showFavorites
          sortOnly={false}
          {...{ onBrowse, onFavorites, onFilters }}
        />
      </div>
    );
    expect(screen.queryByRole('navigation', { name: 'Quick Lobby Filters' })).toBeNull();
    // Controls below the viewport do not activate a duplicate rail either.
    moveControls(900, false);
    expect(screen.queryByRole('button', { name: 'Open Sticky Filters' })).toBeNull();
    moveControls(-10, false);
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
      <div className="club-home">
        <div id="lobby-game-section-controls" />
        <StickyLobbyFilters
          gameLabel="All"
          favoritesOnly
          showFavorites={false}
          sortOnly
          {...{ onBrowse, onFavorites, onFilters }}
        />
      </div>
    );
    moveControls(-10, false);
    expect(screen.queryByRole('button', { name: 'Favorites' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Sticky Filters' })).toHaveTextContent('Sort');
    expect(disconnect).toHaveBeenCalled();
    moveControls(300, true);
    expect(screen.queryByRole('navigation', { name: 'Quick Lobby Filters' })).toBeNull();
  });
});

it('replaces the full desktop deck only after actual catalogue scroll and latches until Browse', () => {
  vi.stubGlobal('innerWidth', 1280);
  const browse = vi.fn();
  const { container, unmount } = render(
    <div className="club-home">
      <div className="club-lobby-machine">
        <div className="club-lobby-command-top">
          <section className="club-lobby-command-top__controls">
            <div id="lobby-game-section-controls" />
          </section>
        </div>
        <StickyLobbyFilters
          gameLabel="PLO"
          favoritesOnly={false}
          showFavorites
          sortOnly={false}
          onBrowse={browse}
          onFavorites={() => {}}
          onFilters={() => {}}
        />
        <div className="lobby-table-wrap" />
      </div>
    </div>
  );
  const machine = container.querySelector('.club-lobby-machine')!;
  const catalog = container.querySelector<HTMLElement>('.lobby-table-wrap')!;
  expect(screen.queryByRole('navigation')).toBeNull();
  fireEvent.scroll(window);
  expect(machine).not.toHaveAttribute('data-compact-lobby-controls');
  catalog.scrollTop = 120;
  fireEvent.scroll(catalog);
  expect(machine).toHaveAttribute('data-compact-lobby-controls', 'true');
  expect(screen.getByRole('navigation')).toBeVisible();
  // Removing the large deck can clamp scrollTop; that must not reopen it.
  catalog.scrollTop = 0;
  fireEvent.scroll(catalog);
  expect(screen.getByRole('navigation')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Browse Game Types' }));
  expect(catalog.scrollTop).toBe(0);
  expect(machine).not.toHaveAttribute('data-compact-lobby-controls');
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(browse).toHaveBeenCalledOnce();
  catalog.scrollTop = 30;
  fireEvent.scroll(catalog);
  vi.stubGlobal('innerWidth', 393);
  fireEvent.resize(window);
  expect(machine).not.toHaveAttribute('data-compact-lobby-controls');
  unmount();
  expect(machine).not.toHaveAttribute('data-compact-lobby-controls');
});
