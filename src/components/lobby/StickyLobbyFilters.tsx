import { useEffect, useRef, useState } from 'react';
import LobbyFilterLabel from './LobbyFilterLabel';
import './StickyLobbyFilters.css';

interface StickyLobbyFiltersProps {
  gameLabel: string;
  favoritesOnly: boolean;
  showFavorites: boolean;
  sortOnly: boolean;
  onBrowse: (button: HTMLButtonElement) => void;
  onFavorites: () => void;
  onFilters: () => void;
}

/** The compact rail keeps the original controls reachable without covering the schedule. */
export default function StickyLobbyFilters({
  gameLabel,
  favoritesOnly,
  showFavorites,
  sortOnly,
  onBrowse,
  onFavorites,
  onFilters,
}: StickyLobbyFiltersProps) {
  const railRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const rail = railRef.current;
    const controls = rail?.closest('.club-home')?.querySelector('#lobby-game-section-controls');
    if (!rail || !controls) return;
    let observer: IntersectionObserver | undefined;
    const bind = () => {
      observer?.disconnect();
      const top = Math.max(0, parseFloat(getComputedStyle(rail).top) || 0);
      setCollapsed(controls.getBoundingClientRect().bottom <= top);
      observer = new IntersectionObserver(
        ([entry]) => {
          setCollapsed(!entry.isIntersecting && entry.boundingClientRect.bottom <= top);
        },
        { rootMargin: `-${top}px 0px 0px 0px` }
      );
      observer.observe(controls);
    };
    bind();
    // The desktop rail has a different offset; remeasure on orientation or
    // viewport changes rather than retaining the phone's intersection margin.
    window.addEventListener('resize', bind);
    const header = document.querySelector('[aria-label="Smarter.Poker Global Header"]');
    const headerSize =
      header && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bind) : null;
    if (header && headerSize) headerSize.observe(header);
    return () => {
      observer?.disconnect();
      headerSize?.disconnect();
      window.removeEventListener('resize', bind);
    };
  }, [gameLabel, showFavorites]);
  return (
    <nav
      ref={railRef}
      className="lobby-sticky-filters"
      aria-label="Quick Lobby Filters"
      hidden={!collapsed}
    >
      <button
        type="button"
        onClick={(event) => onBrowse(event.currentTarget)}
        aria-label="Browse Game Types"
      >
        <LobbyFilterLabel>{gameLabel}</LobbyFilterLabel>
      </button>
      {showFavorites && (
        <button type="button" onClick={onFavorites} aria-pressed={favoritesOnly}>
          <LobbyFilterLabel>Favorites</LobbyFilterLabel>
        </button>
      )}
      <button type="button" onClick={onFilters} aria-label="Open Sticky Filters">
        <LobbyFilterLabel>{sortOnly ? 'Sort' : 'Filters'}</LobbyFilterLabel>
      </button>
    </nav>
  );
}
