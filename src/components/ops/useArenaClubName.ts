import { useMemo } from 'react';
import { useClubWorkspace } from '../../contexts/ClubWorkspaceContext';
import { useClubStore } from '../../stores/useClubStore';

/** A no-break space: holds the mast's context line without naming anything. */
export const ARENA_NO_CLUB_NAME = ' ';

/**
 * The club's name for a Club Operations mast from the first frame (Dan
 * 2026-11-27). The mast printed the generic "Club Arena" until the page's own
 * read landed, a wrong name for a moment on every visit. In order: the name
 * the page has read, the name already held for this club in the membership
 * list, the name the route spells (a raw UUID names nothing). With none of
 * those the line is held blank, never filled with a name that is not the
 * club's.
 */
export function useArenaClubName(readName?: string | null): string {
  const { routeClubId, clubUUID } = useClubWorkspace();
  const memberships = useClubStore((state) => state.memberships);
  return useMemo(() => {
    if (readName) return readName;
    const held = memberships.find(
      (m) =>
        m.club &&
        (m.club.id === clubUUID ||
          m.club.id === routeClubId ||
          (routeClubId != null && m.club.slug === routeClubId))
    )?.club.name;
    if (held) return held;
    if (routeClubId && !/^[0-9a-f]{8}-/i.test(routeClubId)) {
      return routeClubId.replace(/[-_]/g, ' ');
    }
    return ARENA_NO_CLUB_NAME;
  }, [readName, memberships, clubUUID, routeClubId]);
}
