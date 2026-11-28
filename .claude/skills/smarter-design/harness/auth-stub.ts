import { fixtures } from './fixtures';
const user = {
  id: fixtures.ownerId,
  email: 'owner@kings.club',
  display_name: 'Dan',
  username: 'dan',
};
export function useAuthUser() {
  return { user, isAuthenticated: true, isHydrating: false, loading: false } as any;
}
export default useAuthUser;
