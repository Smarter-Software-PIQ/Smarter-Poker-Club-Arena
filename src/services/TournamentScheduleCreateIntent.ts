type Scope = { userId: string; clubId: string; unionId: string | null };
type Intent = {
  version: 1;
  requestId: string;
  state: 'pending' | 'refused' | 'resolved' | 'retired';
  payload: Record<string, unknown>;
  scheduleId?: string;
};
const prefix = 'ca:tournament-schedule-create:v1:';
const running = new Map<string, { payload: string; promise: Promise<string> }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(fingerprint).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + fingerprint((value as Record<string, unknown>)[key])
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function read(raw: string | null, scope: Scope): Intent | null {
  if (raw === null) return null;
  const value = JSON.parse(raw) as Intent;
  if (
    value?.version !== 1 ||
    !uuid.test(value.requestId) ||
    !['pending', 'refused', 'resolved', 'retired'].includes(value.state) ||
    !value.payload ||
    value.payload.clubId !== scope.clubId ||
    value.payload.unionId !== scope.unionId ||
    (['resolved', 'retired'].includes(value.state) &&
      (typeof value.scheduleId !== 'string' || !value.scheduleId))
  )
    throw new Error('The Saved Schedule Request Could Not Be Verified.');
  return value;
}
export class ScheduleCreateRefusedError extends Error {}
export class ScheduleCreateRetiredError extends Error {
  constructor(
    readonly scheduleId: string,
    message: string
  ) {
    super(message);
  }
}

const changed = () =>
  new Error(
    'The Earlier Schedule Save Is Unconfirmed. Restore Its Settings And Submit Again To Check That Same Request Before Creating Another Schedule.'
  );

/** Persist before sending; only an explicit submit can replay an unresolved create. */
export function withTournamentScheduleCreateIntent(
  scope: Scope,
  payload: Record<string, unknown>,
  submit: (requestId: string) => Promise<string>
): Promise<string> {
  const key = prefix + scope.userId + ':' + scope.clubId + ':' + (scope.unionId ?? 'club');
  const wanted = fingerprint(payload);
  const active = running.get(key);
  if (active) return active.payload === wanted ? active.promise : Promise.reject(changed());
  const promise = (async () => {
    if (!globalThis.navigator?.locks || !globalThis.crypto?.randomUUID)
      throw new Error('This Browser Cannot Safely Save The Schedule Request.');
    const storage = globalThis.localStorage;
    const session = globalThis.sessionStorage;
    const invokedRaw = storage.getItem(key);
    return navigator.locks.request(key, async () => {
      const currentRaw = storage.getItem(key);
      const current = read(currentRaw, scope);
      const own = read(session.getItem(key), scope);
      const invoked = read(invokedRaw, scope);
      let intent =
        own?.state === 'pending'
          ? own
          : invoked?.state === 'pending'
            ? invoked
            : current?.state === 'pending'
              ? current
              : own?.state === 'refused'
                ? own
                : current?.state === 'refused'
                  ? current
                  : currentRaw !== invokedRaw
                    ? current
                    : null;
      if (intent && fingerprint(intent.payload) !== wanted) {
        if (intent.state === 'pending') throw changed();
        if (intent.state === 'resolved') intent = null; // A completed different request does not consume a new intent.
      }
      if (intent?.state === 'retired')
        throw new ScheduleCreateRetiredError(
          intent.scheduleId!,
          'The Original Schedule Was Retired. Submit Again To Create A New Schedule.'
        );
      if (intent?.state === 'resolved') return intent.scheduleId!;
      const fresh = !intent;
      intent ??= { version: 1, requestId: crypto.randomUUID(), state: 'pending', payload };
      intent = { ...intent, state: 'pending', payload };
      const pending = JSON.stringify(intent);
      session.setItem(key, pending);
      if (session.getItem(key) !== pending)
        throw new Error('The Schedule Request Could Not Be Saved.');
      if (fresh || !current || current.requestId === intent.requestId) {
        storage.setItem(key, pending);
        if (storage.getItem(key) !== pending)
          throw new Error('The Schedule Request Could Not Be Saved.');
      }
      let scheduleId: string;
      try {
        scheduleId = await submit(intent.requestId);
      } catch (error) {
        if (
          error instanceof ScheduleCreateRefusedError ||
          error instanceof ScheduleCreateRetiredError
        ) {
          try {
            const refused = JSON.stringify(
              error instanceof ScheduleCreateRetiredError
                ? { ...intent, state: 'retired', scheduleId: error.scheduleId }
                : { ...intent, state: 'refused' }
            );
            session.setItem(key, refused);
            if (read(storage.getItem(key), scope)?.requestId === intent.requestId)
              storage.setItem(key, refused);
          } catch {
            /* Retaining pending is conservative; never replace its identity. */
          }
        }
        throw error;
      }
      // A validated receipt is definitive even if recording it locally fails.
      // Retaining the pending identity remains safe: its replay returns that row.
      try {
        const resolved = JSON.stringify({ ...intent, state: 'resolved', scheduleId });
        session.setItem(key, resolved);
        if (read(storage.getItem(key), scope)?.requestId === intent.requestId)
          storage.setItem(key, resolved);
      } catch {
        /* The original request identity remains recoverable. */
      }
      return scheduleId;
    });
  })();
  running.set(key, { payload: wanted, promise });
  const cleanup = () => {
    if (running.get(key)?.promise === promise) running.delete(key);
  };
  void promise.then(cleanup, cleanup);
  return promise;
}
