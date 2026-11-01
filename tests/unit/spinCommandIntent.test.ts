import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/supabase', () => ({ supabase: {} }));
import { pendingSpinCommand, withSpinCommandIntent } from '../../src/services/SpinCommandIntent';
import { SpinCommandRefusedError } from '../../src/services/SpinActivationService';
const scope = { actorId: 'actor', clubId: 'club', ownerId: 'owner' };
const build = () => ({ action: 'activate' as const, seed: 200, stake: 1, wallet: 'chip_treasury' });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  let tail = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_key: string, run: () => Promise<any>) => {
        const work = tail.then(run);
        tail = work.then(
          () => undefined,
          () => undefined
        );
        return work;
      },
    },
  });
});
it('keeps payload and ID after unknown, even for a different requested action', async () => {
  const submit = vi.fn().mockRejectedValue(new Error('unknown'));
  await expect(withSpinCommandIntent(scope, build, submit)).rejects.toThrow('unknown');
  const old = submit.mock.calls[0][0];
  await expect(
    withSpinCommandIntent(
      scope,
      () => ({ action: 'deactivate', seed: null, stake: null, wallet: null }),
      submit
    )
  ).rejects.toThrow('unknown');
  expect(submit.mock.calls[1][0]).toEqual(old);
  expect(pendingSpinCommand(scope)).toEqual(old);
});
it('serializes concurrent clicks onto the same original command', async () => {
  const submit = vi.fn().mockResolvedValue({ ok: true });
  await Promise.all([
    withSpinCommandIntent(scope, build, submit),
    withSpinCommandIntent(scope, build, submit),
  ]);
  expect(submit.mock.calls[0][0]).toEqual(submit.mock.calls[1][0]);
});
it('resolves only a proven refusal and permits a subsequent explicit new intent', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new SpinCommandRefusedError('refused'))
    .mockResolvedValueOnce({ ok: true });
  await expect(withSpinCommandIntent(scope, build, submit)).rejects.toThrow('refused');
  expect(pendingSpinCommand(scope)).toBeNull();
  await withSpinCommandIntent(scope, build, submit);
  expect(submit.mock.calls[0][0].requestId).not.toBe(submit.mock.calls[1][0].requestId);
});
it('does not read another actor intent and refuses a changed owner for an unresolved command', async () => {
  await expect(
    withSpinCommandIntent(scope, build, async () => {
      throw new Error('unknown');
    })
  ).rejects.toThrow('unknown');
  expect(pendingSpinCommand({ ...scope, actorId: 'other' })).toBeNull();
  expect(() => pendingSpinCommand({ ...scope, ownerId: 'new-owner' })).toThrow(
    'Could Not Be Verified'
  );
});
it('fails before transport if persistence does not read back', async () => {
  const submit = vi.fn();
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
  await expect(withSpinCommandIntent(scope, build, submit)).rejects.toThrow('Could Not Be Saved');
  expect(submit).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it('does not overwrite a newer shared intent while resolving this tab original', async () => {
  const submit = vi.fn().mockRejectedValueOnce(new Error('unknown'));
  await expect(withSpinCommandIntent(scope, build, submit)).rejects.toThrow();
  const key = localStorage.key(0)!;
  const newer = JSON.parse(localStorage.getItem(key)!);
  newer.request.requestId = crypto.randomUUID();
  localStorage.setItem(key, JSON.stringify(newer));
  await withSpinCommandIntent(scope, build, async () => ({ ok: true }));
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(newer);
});

it('permits a new owner scope only after the earlier owner command is resolved', async () => {
  await withSpinCommandIntent(scope, build, async () => ({ ok: true }));
  const next = { ...scope, ownerId: 'new-owner' };
  expect(pendingSpinCommand(next)).toBeNull();
  const submit = vi.fn().mockResolvedValue({ ok: true });
  await withSpinCommandIntent(next, build, submit);
  expect(submit.mock.calls[0][0].ownerId).toBe('new-owner');
});
