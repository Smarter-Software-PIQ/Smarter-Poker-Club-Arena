import type { SetStateAction } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePlayerPreference } from './usePlayerPreference';

export type ClubDataGame = 'ALL' | 'HOLDEM' | 'OMAHA' | 'MIXED' | 'MTT' | 'SNG';
export type ClubDataStakes = 'ALL' | 'MICRO' | 'SMALL' | 'MID' | 'HIGH';
const games: readonly string[] = ['ALL', 'HOLDEM', 'OMAHA', 'MIXED', 'MTT', 'SNG'];
const stakes: readonly string[] = ['ALL', 'MICRO', 'SMALL', 'MID', 'HIGH'];

/** Explicit report links override saved preferences; Back restores the linked question. */
export function useClubDataFilters(prefix: string) {
  const [params, setParams] = useSearchParams();
  const [savedGame, saveGame] = usePlayerPreference<ClubDataGame>(`${prefix}:game`, 'ALL');
  const [savedStakes, saveStakes] = usePlayerPreference<ClubDataStakes>(`${prefix}:stakes`, 'ALL');
  const [savedSearch, saveSearch] = usePlayerPreference(`${prefix}:searchInput`, '');
  const game = (
    games.includes(params.get('dataGame') ?? '') ? params.get('dataGame') : savedGame
  ) as ClubDataGame;
  const stake = (
    stakes.includes(params.get('dataStakes') ?? '') ? params.get('dataStakes') : savedStakes
  ) as ClubDataStakes;
  const searchInput = params.get('dataSearch') ?? savedSearch;
  const write = (nextGame: ClubDataGame, nextStakes: ClubDataStakes, nextSearch: string) => {
    const next = new URLSearchParams(params);
    next.set('dataGame', nextGame);
    next.set('dataStakes', nextStakes);
    next.set('dataSearch', nextSearch);
    setParams(next, { replace: true });
  };
  return {
    game,
    stakes: stake,
    searchInput,
    setGame: (action: SetStateAction<ClubDataGame>) => {
      const next = typeof action === 'function' ? action(game) : action;
      saveGame(next);
      write(next, stake, searchInput);
    },
    setStakes: (action: SetStateAction<ClubDataStakes>) => {
      const next = typeof action === 'function' ? action(stake) : action;
      saveStakes(next);
      write(game, next, searchInput);
    },
    setSearchInput: (next: string) => {
      saveSearch(next);
      write(game, stake, next);
    },
    clearFilters: () => {
      saveGame('ALL');
      saveStakes('ALL');
      saveSearch('');
      write('ALL', 'ALL', '');
    },
  };
}

/** Carry the actual active question, including explicit ALL and empty search. */
export function clubDataContextQuery(
  params: URLSearchParams,
  context: {
    start: string;
    end: string;
    game: string;
    stakes: string;
    search: string;
  }
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('dataUntil');
  next.delete('dataDays');
  next.set('dataStart', context.start);
  next.set('dataEnd', context.end);
  next.set('dataGame', context.game);
  next.set('dataStakes', context.stakes);
  next.set('dataSearch', context.search);
  return next;
}
