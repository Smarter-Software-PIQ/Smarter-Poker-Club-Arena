/* Render-harness stand-in: club navigation access as the owner. Never shipped. */
export * from '../../../../src/hooks/useClubNavigationAccess';
export function useClubNavigationAccess() {
  return {
    isClubStaff: true,
    canViewFinance: true,
    canControlClub: true,
    clubRole: 'owner',
    isPlatformStaff: false,
    loading: false,
    error: null,
    reload: () => undefined,
  } as any;
}
