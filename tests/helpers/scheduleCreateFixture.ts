import { beforeEach, afterEach, vi } from 'vitest';
import * as db from '../../src/lib/supabase';
export const scheduleActor = '00000000-0000-4000-8000-0000000000a1';
/** Actual durable create flow, with only browser/session and RPC transport substituted. */
export function installScheduleCreateFixture() {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(db, 'getAuthUser').mockResolvedValue({
      data: { user: { id: scheduleActor } },
      error: null,
    } as never);
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: (_key: string, fn: () => unknown) => fn() },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
}
export function scheduleReceipt(args: any, id: string) {
  return scheduleRpcResponse({
    data: { ok: true, schedule_id: id, request_id: args.p_request_id, user_id: args.p_user_id },
    error: null,
  });
}

export function scheduleRpcResponse<T>(value: T) {
  const response = Promise.resolve(value);
  return Object.assign(response, { abortSignal: (_signal: AbortSignal) => response });
}
