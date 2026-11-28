/* Render-harness stand-in: the real ClubWorkspaceContext, with the hook answering as Kings Club's owner. Never shipped. */
export * from '../../../../src/contexts/ClubWorkspaceContext';
import { CLUB_UUID, SLUG } from './fixtures';
export function useClubWorkspace() {
  return {
    routeClubId: SLUG,
    clubUUID: CLUB_UUID,
    clubRole: 'owner',
    membershipStatus: 'active',
    isMember: true,
    isPlatformStaff: false,
    status: 'ready',
    loading: false,
    error: null,
    isOffline: false,
    isStale: false,
    lastSyncedAt: Date.now(),
    reload: () => undefined,
    isClubStaff: true,
    canViewFinance: true,
    canControlClub: true,
  } as any;
}
