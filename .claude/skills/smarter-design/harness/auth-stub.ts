import { fixtures } from './fixtures';
import { useUserStore } from '../../../../src/stores/useUserStore';
const user = {
  id: fixtures.ownerId,
  email: 'owner@kings.club',
  display_name: 'Dan',
  username: 'dan',
};
/* The signed-in player in the user store too, as the app's auth listener
   would set it (the Profile page reads its account from the store). */
if (!useUserStore.getState().user) {
  useUserStore.getState().setUser({ id: fixtures.ownerId, username: 'KingDan' } as any);
}
export function useAuthUser() {
  return { user, isAuthenticated: true, isHydrating: false, loading: false } as any;
}
export default useAuthUser;
