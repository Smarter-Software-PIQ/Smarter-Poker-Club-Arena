import { vi } from 'vitest';
import { getAuthUser, supabase } from '../../src/lib/supabase';

export const CREATE_ACTOR = 'a1000000-0000-4000-8000-000000000001';
export const CREATED_EVENT = 'e1000000-0000-4000-8000-000000000001';
export function prepareTournamentCreateFixture() {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(getAuthUser).mockResolvedValue({
    data: { user: { id: CREATE_ACTOR } },
    error: null,
  } as never);
}
export function mockTournamentCreateReply(
  data: Record<string, unknown> | null,
  error: unknown = null
) {
  prepareTournamentCreateFixture();
  return vi.spyOn(supabase, 'rpc').mockImplementation((_name: string, args: any) => {
    const reply = {
      data: data
        ? {
            ...data,
            request_id: args.p_request_id,
            user_id: args.p_actor_id,
            club_id: args.p_club_id,
            request_state: data.success === true ? 'accepted' : 'not_created',
            ...(args.p_plan && data.success === true
              ? {
                  stage_plan: {
                    ok: true,
                    tournament_id: data.tournament_id,
                    stage_count: args.p_plan.stages.length,
                    plan_hash: 'a'.repeat(32),
                  },
                }
              : {}),
          }
        : null,
      error,
    };
    return {
      abortSignal() {
        return this;
      },
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(reply).then(resolve, reject);
      },
    } as never;
  });
}
