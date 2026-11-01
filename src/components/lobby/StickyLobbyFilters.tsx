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
  return (
    <nav className="lobby-sticky-filters" aria-label="Quick Lobby Filters">
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
