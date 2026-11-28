/* Offline stand-in for src/hooks/useAuthUser.ts in the table surface ink spec. */
import { FIXTURE_USER_ID } from './supabaseStub';

const user = {
  id: FIXTURE_USER_ID,
  email: 'fixture@smarter.poker',
  display_name: 'Fixture Hero',
  username: 'fixture_hero',
};
export function useAuthUser() {
  return { user, isAuthenticated: true, isHydrating: false, loading: false } as any;
}
export default useAuthUser;
