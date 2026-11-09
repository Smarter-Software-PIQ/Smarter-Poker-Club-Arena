/**
 * useMyPlayers - the viewer's own players in this tournament, for every tab.
 *
 * Resolves "mine" exactly as Ranking always has (Dan 2026-11-06: only the club
 * the viewer is INSIDE right now): the club lobby's `:clubId`, else the
 * `?club=` every lobby link carries, else the club they entered through. Any of
 * these may be a slug or number code; useDownlineIds resolves it. ONE call to
 * useDownlineIds per tab, and the derivation is the pure `deriveMyPlayers`.
 *
 * `ready` is true only once the downline read has settled AND the viewer
 * carries a downline. A read that is still in flight, or failed, publishes
 * nothing (useDownlineIds' "never publish a partial set" rule), so the card is
 * never drawn half-known and a plain player never sees it at all.
 */

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { readClubContextParam } from '../../../utils/clubScopedPath';
import { useUserStore } from '../../../stores/useUserStore';
import { useDownlineIds } from './useDownlineIds';
import { deriveMyPlayers, type MyPlayersSummary } from './myPlayersSummary';
import type { TournamentEntry, TournamentTabProps, TournamentTable } from './types';

export interface MyPlayersResult {
  /** True when the card should render: settled read, viewer has a downline. */
  ready: boolean;
  downlineIds: ReadonlySet<string>;
  summary: MyPlayersSummary;
}

export function useMyPlayers(
  tournament: TournamentTabProps['tournament'] | null | undefined,
  entries: readonly TournamentEntry[],
  tables: readonly TournamentTable[],
  currentUserId: string | undefined | null
): MyPlayersResult {
  const routeClubId = useParams<{ clubId?: string }>().clubId;
  const linkClubId = readClubContextParam(
    typeof window === 'undefined' ? '' : window.location.search
  );
  const enteredClubId = useUserStore((s) => s.currentClubId);
  const { downlineIds, carriesDownline, loading } = useDownlineIds(
    currentUserId,
    tournament?.id,
    routeClubId || linkClubId || enteredClubId
  );

  const summary = useMemo(
    () => deriveMyPlayers(tournament, entries, tables, carriesDownline ? downlineIds : EMPTY),
    [tournament, entries, tables, downlineIds, carriesDownline]
  );

  return {
    ready: carriesDownline && !loading,
    downlineIds: carriesDownline ? downlineIds : EMPTY,
    summary,
  };
}

const EMPTY: ReadonlySet<string> = new Set();

export default useMyPlayers;
