import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
import {
  spinActivationApi,
  SpinCommandRefusedError,
} from '../../src/services/SpinActivationService';
import { DEFAULT_REQUEST_DEADLINE_MS } from '../../src/utils/requestDeadline';
const never = () => new Promise<any>(() => {});
it.each([
  [400, false, true, false, true],
  [500, false, true, false, false],
  [400, false, 'true', false, false],
  [400, false, true, 'false', false],
  [400, true, true, false, false],
])(
  'classifies only a canonical resolved refusal %s/%s/%s/%s',
  async (status, success, requestResolved, ok, definite) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success, requestResolved, detail: { ok }, error: 'refused' }), {
        status: Number(status),
      })
    );
    const result = await spinActivationApi
      .activate('club-a', 200, 1, 'chip_treasury', 'key')
      .catch((error) => error);
    expect(result instanceof SpinCommandRefusedError).toBe(definite);
  }
);
beforeEach(() => {
  vi.useFakeTimers();
  getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-test-token' } } });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(['session', 'response', 'body'])(
  'bounds an owner read stalled at its %s',
  async (stage) => {
    if (stage === 'session') getSession.mockImplementation(never);
    else if (stage === 'response') vi.mocked(fetch).mockImplementation(never);
    else vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: never } as any);
    let settled = false;
    const result = spinActivationApi.getState('club-a').then(
      () => {
        settled = true;
        return 'success';
      },
      (error) => {
        settled = true;
        return error;
      }
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_DEADLINE_MS + 1);
    expect(settled).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    if (stage !== 'session') expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(stage === 'session' ? 0 : 1);
  }
);
it.each([
  { status: 503, success: true },
  { status: 200, success: 'false' },
])('rejects a contradictory HTTP receipt $status/$success', async ({ status, success }) => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ success, state: { owner_id: 'club-a' } }), { status })
  );
  await expect(spinActivationApi.getState('club-a')).rejects.toThrow();
});
it('accepts the actual successful read envelope once', async () => {
  const data = {
    success: true,
    state: { owner_id: 'club-a' },
    canManage: false,
    ownerKind: 'club',
  };
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
  await expect(spinActivationApi.getState('club-a')).resolves.toEqual(data);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not send a late read after session acquisition exceeded its deadline', async () => {
  let release!: (value: any) => void;
  getSession.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const result = spinActivationApi.getState('club-a').catch((error) => error);
  await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_DEADLINE_MS + 1);
  expect(await result).toBeInstanceOf(Error);
  release({ data: { session: { access_token: 'synthetic-late-token' } } });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).not.toHaveBeenCalled();
});

it('preserves the financial request identity and does not introduce a timed automatic replay', async () => {
  let release!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  let settled = false;
  const result = spinActivationApi
    .activate('club-a', 2000, 10, 'chip_treasury', 'original-operation')
    .then((value) => {
      settled = true;
      return value;
    })
    .catch((error) => error);
  await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_DEADLINE_MS + 1);
  expect(settled).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
    'X-Idempotency-Key': 'original-operation',
  });
  release(new Response(JSON.stringify({ success: true, result: { ok: true } }), { status: 200 }));
  expect(await result).toBeInstanceOf(Error);
  expect(await result).not.toBeInstanceOf(SpinCommandRefusedError);
  expect(settled).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('refuses a saved command when session acquisition returns another actor', async () => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic', user: { id: 'other' } } },
  });
  await expect(
    spinActivationApi.activate('club', 200, 1, 'chip_treasury', 'request', {
      actorId: 'original',
      ownerId: 'owner',
    })
  ).rejects.toThrow('Another Account');
  expect(fetch).not.toHaveBeenCalled();
});
it('forwards the saved owner and request identity with the current matching actor', async () => {
  getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic', user: { id: 'actor' } } },
  });
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ success: true, result: { ok: true } }))
  );
  await spinActivationApi.deactivate('club', 'request', { actorId: 'actor', ownerId: 'owner' });
  const init = vi.mocked(fetch).mock.calls[0][1]!;
  expect(JSON.parse(String(init.body))).toEqual({
    action: 'deactivate',
    clubId: 'club',
    expectedOwnerId: 'owner',
  });
  expect((init.headers as Record<string, string>)['X-Idempotency-Key']).toBe('request');
});

it.each([undefined, null, 'true', false])(
  'keeps malformed financial success unknown: %s',
  async (ok) => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: { ok } }))
    );
    await expect(
      spinActivationApi.activate('club', 200, 1, 'chip_treasury', 'request')
    ).rejects.toThrow('Receipt Could Not Be Verified');
  }
);

it.each(['activate', 'deactivate'] as const)(
  'bounds the %s transport without resolving its command',
  async (action) => {
    vi.mocked(fetch).mockImplementation(never);
    const result = (
      action === 'activate'
        ? spinActivationApi.activate('club', 200, 1, 'chip_treasury', 'same-request')
        : spinActivationApi.deactivate('club', 'same-request')
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_DEADLINE_MS + 1);
    expect(await result).toBeInstanceOf(Error);
    expect(await result).not.toBeInstanceOf(SpinCommandRefusedError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
  }
);
