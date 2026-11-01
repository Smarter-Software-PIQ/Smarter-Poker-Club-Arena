import { SpinCommandRefusedError } from './SpinActivationService';

export type SpinCommandScope = { actorId: string; clubId: string; ownerId: string };
export type SpinCommandRequest = SpinCommandScope & {
  action: 'activate' | 'deactivate';
  requestId: string;
  seed: number | null;
  stake: number | null;
  wallet: string | null;
};
type Intent = { version: 1; state: 'pending' | 'resolved'; request: SpinCommandRequest };
const prefix = 'ca:spin-owner-command:v1:';
const keyFor = (scope: SpinCommandScope) => prefix + JSON.stringify([scope.actorId, scope.clubId]);
const same = (a: Intent | null, b: Intent) => a?.request.requestId === b.request.requestId;
function read(raw: string | null, scope: SpinCommandScope): Intent | null {
  if (raw === null) return null;
  const value = JSON.parse(raw) as Intent;
  const r = value?.request;
  if (
    value?.version !== 1 ||
    !['pending', 'resolved'].includes(value.state) ||
    !r ||
    r.actorId !== scope.actorId ||
    r.clubId !== scope.clubId ||
    typeof r.ownerId !== 'string' ||
    !r.ownerId ||
    (value.state === 'pending' && r.ownerId !== scope.ownerId) ||
    typeof r.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      r.requestId
    ) ||
    !(r.action === 'deactivate'
      ? r.seed === null && r.stake === null && r.wallet === null
      : r.action === 'activate' &&
        Number.isInteger(r.seed) &&
        Number(r.seed) >= 0 &&
        typeof r.stake === 'number' &&
        [1, 2, 3, 5, 10, 20, 50, 100].includes(r.stake) &&
        typeof r.wallet === 'string' &&
        r.wallet.length > 0)
  )
    throw new Error('The Saved Spin Request Could Not Be Verified.');
  return r.ownerId === scope.ownerId ? value : null;
}
export function pendingSpinCommand(scope: SpinCommandScope): SpinCommandRequest | null {
  const key = keyFor(scope);
  const own = read(sessionStorage.getItem(key), scope);
  const shared = read(localStorage.getItem(key), scope);
  return own?.state === 'pending'
    ? own.request
    : shared?.state === 'pending'
      ? shared.request
      : null;
}

/** One explicit action, serialized across tabs, always retains the original unknown payload. */
export async function withSpinCommandIntent<T>(
  scope: SpinCommandScope,
  build: () => Omit<SpinCommandRequest, keyof SpinCommandScope | 'requestId'>,
  submit: (request: SpinCommandRequest) => Promise<T>
): Promise<{ request: SpinCommandRequest; result: T }> {
  if (!scope.actorId || !scope.ownerId || !navigator.locks || !crypto.randomUUID)
    throw new Error('This Browser Cannot Safely Save The Spin Request.');
  const key = keyFor(scope);
  const invokedRaw = localStorage.getItem(key);
  return navigator.locks.request(key, async () => {
    const currentRaw = localStorage.getItem(key);
    const current = read(currentRaw, scope);
    const own = read(sessionStorage.getItem(key), scope);
    const invoked = read(invokedRaw, scope);
    const original =
      own?.state === 'pending'
        ? own
        : invoked?.state === 'pending'
          ? invoked
          : current?.state === 'pending'
            ? current
            : currentRaw !== invokedRaw
              ? current
              : null;
    const intent: Intent = {
      version: 1,
      state: 'pending',
      request: original?.request ?? { ...scope, ...build(), requestId: crypto.randomUUID() },
    };
    read(JSON.stringify(intent), scope);
    const raw = JSON.stringify(intent);
    sessionStorage.setItem(key, raw);
    if (sessionStorage.getItem(key) !== raw)
      throw new Error('The Spin Request Could Not Be Saved.');
    if (!current || !original || same(current, intent)) {
      localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw)
        throw new Error('The Spin Request Could Not Be Saved.');
    }
    const resolve = () => {
      try {
        const resolved = JSON.stringify({ ...intent, state: 'resolved' });
        if (same(read(sessionStorage.getItem(key), scope), intent))
          sessionStorage.setItem(key, resolved);
        if (same(read(localStorage.getItem(key), scope), intent))
          localStorage.setItem(key, resolved);
      } catch {
        /* A proven receipt stays proven; retained identity is safe to replay. */
      }
    };
    try {
      const result = await submit({ ...intent.request });
      resolve();
      return { request: intent.request, result };
    } catch (error) {
      if (error instanceof SpinCommandRefusedError) resolve();
      throw error;
    }
  });
}
