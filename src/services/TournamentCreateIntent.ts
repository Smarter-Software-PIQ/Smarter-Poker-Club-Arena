import type { SealedStagePlanBody } from '../utils/multiDaySchedule';
import { runWithRequestDeadline } from '../utils/requestDeadline';

export interface PreparedTournamentCreate {
  payload: Record<string, unknown>;
  stagePlan?: SealedStagePlanBody | null;
  mysteryConfig?: Record<string, unknown>;
}
export interface TournamentCreateRequest extends PreparedTournamentCreate {
  requestId: string;
  tournamentId?: string;
  refused?: boolean;
}
interface Bundle {
  version: 1;
  actorId: string;
  clubId: string;
  state: 'pending' | 'awaiting_stage' | 'resolved' | 'retired';
  requests: TournamentCreateRequest[];
}
const prefix = 'ca:tournament-create:v1:';
const running = new Map<string, Promise<unknown[]>>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class TournamentCreateRetiredError extends Error {}
export class TournamentCreateRefusedError extends Error {}

function decode(raw: string | null, actorId: string, clubId: string): Bundle | null {
  if (raw === null) return null;
  const value = JSON.parse(raw) as Bundle;
  if (
    value?.version !== 1 ||
    value.actorId !== actorId ||
    value.clubId !== clubId ||
    !['pending', 'awaiting_stage', 'resolved', 'retired'].includes(value.state) ||
    !Array.isArray(value.requests) ||
    value.requests.length === 0 ||
    value.requests.some(
      (request) =>
        !uuid.test(request.requestId) ||
        !request.payload ||
        typeof request.payload !== 'object' ||
        Array.isArray(request.payload) ||
        (request.tournamentId !== undefined && !uuid.test(request.tournamentId))
    )
  )
    throw new Error('The Original Tournament Request Could Not Be Verified.');
  return value;
}

function unresolved(bundle: Bundle | null): bundle is Bundle {
  return bundle?.state === 'pending' || bundle?.state === 'awaiting_stage';
}

/** Called only after the canonical stage read confirms this exact saved plan. */
export async function resolveTournamentCreateStage(
  actorId: string,
  clubId: string,
  tournamentId: string,
  plan: SealedStagePlanBody
): Promise<void> {
  const key = prefix + actorId + ':' + clubId;
  if (!navigator.locks) throw new Error('The Original Stage Request Cannot Be Safely Recorded.');
  await navigator.locks.request(key, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error('The Original Tournament Request Is Active In Another Tab.');
    for (const storage of [sessionStorage, localStorage]) {
      const raw = storage.getItem(key);
      const bundle = decode(raw, actorId, clubId);
      if (!bundle || bundle.requests[0].tournamentId !== tournamentId) continue; // Legacy stage intents have no creation bundle.
      if (
        JSON.stringify(bundle.requests[0].stagePlan) !== JSON.stringify(plan) ||
        bundle.requests.some((request) => !request.tournamentId)
      )
        throw new Error('The Original Stage Request Does Not Match The Verified Plan.');
      if (bundle.state === 'retired') throw new Error('The Original Tournament Was Retired.');
      bundle.state = 'resolved';
      const resolved = JSON.stringify(bundle);
      if (storage.getItem(key) !== raw) throw new Error('The Original Stage Request Changed.');
      storage.setItem(key, resolved);
      if (storage.getItem(key) !== resolved)
        throw new Error('The Verified Stage Outcome Could Not Be Saved.');
    }
  });
}

export function hasStoredTournamentCreate(): boolean {
  for (const storage of [sessionStorage, localStorage]) {
    for (let index = 0; index < storage.length; index++) {
      if (storage.key(index)?.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function readPendingTournamentCreate(actorId: string, clubId: string): Bundle | null {
  const key = prefix + actorId + ':' + clubId;
  const own = decode(sessionStorage.getItem(key), actorId, clubId);
  const shared = decode(localStorage.getItem(key), actorId, clubId);
  return unresolved(own) ? own : unresolved(shared) ? shared : null;
}

/** One explicit form submission owns its main and every requested satellite.
 * Unknown replies retain the original payload and UUID, including across reload.
 * Preparing a new form never replaces an unresolved original request.
 */
export function withTournamentCreateIntent<T extends { id: string }>(
  actorId: string,
  clubId: string,
  prepare: () => Promise<PreparedTournamentCreate[]>,
  submit: (request: TournamentCreateRequest, signal: AbortSignal) => Promise<T>
): Promise<T[]> {
  const key = prefix + actorId + ':' + clubId;
  const active = running.get(key);
  if (active) return active as Promise<T[]>;
  const promise = (async () => {
    if (!globalThis.navigator?.locks || !globalThis.crypto?.randomUUID)
      throw new Error('This Browser Cannot Safely Save The Tournament Request.');
    const storage = globalThis.localStorage;
    const session = globalThis.sessionStorage;
    const invoked = storage.getItem(key);
    return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock)
        throw new Error(
          'The Original Tournament Request Is Active In Another Tab. Check That Request Before Submitting Again.'
        );
      const currentRaw = storage.getItem(key);
      const current = decode(currentRaw, actorId, clubId);
      const own = decode(session.getItem(key), actorId, clubId);
      const prior = decode(invoked, actorId, clubId);
      let bundle = unresolved(own)
        ? own
        : unresolved(prior)
          ? prior
          : unresolved(current)
            ? current
            : currentRaw !== invoked
              ? current
              : null;
      if (bundle?.state === 'retired')
        throw new TournamentCreateRetiredError(
          'The Original Tournament Was Retired. Submit Again To Create A New Event.'
        );
      if (!bundle) {
        const prepared = await runWithRequestDeadline(() => prepare());
        if (!prepared.length) throw new Error('No Tournament Was Selected.');
        bundle = {
          version: 1,
          actorId,
          clubId,
          state: 'pending',
          requests: prepared.map((entry) => ({
            ...entry,
            requestId: crypto.randomUUID(),
          })),
        };
      }
      if (bundle.requests.some((request) => request.refused)) {
        const corrected = await runWithRequestDeadline(() => prepare());
        if (corrected.length !== bundle.requests.length)
          throw new Error(
            'Keep The Original Satellite Count While Finishing This Tournament Request.'
          );
        bundle.requests = bundle.requests.map((request, index) =>
          request.refused
            ? {
                ...corrected[index],
                requestId: request.requestId,
                payload: {
                  ...corrected[index].payload,
                  satelliteTargetId: request.payload.satelliteTargetId,
                },
              }
            : request
        );
      }
      const original = bundle;
      const save = () => {
        const raw = JSON.stringify(original);
        session.setItem(key, raw);
        if (session.getItem(key) !== raw)
          throw new Error('The Tournament Request Could Not Be Saved.');
        const latest = decode(storage.getItem(key), actorId, clubId);
        if (
          !latest ||
          !unresolved(latest) ||
          latest.requests[0].requestId === original.requests[0].requestId
        ) {
          storage.setItem(key, raw);
          if (storage.getItem(key) !== raw)
            throw new Error('The Tournament Request Could Not Be Saved.');
        }
      };
      save();
      const results: T[] = [];
      for (let index = 0; index < original.requests.length; index++) {
        const request = original.requests[index];
        if (index > 0 && !request.payload.satelliteTargetId) {
          request.payload = { ...request.payload, satelliteTargetId: results[0].id };
          save();
        }
        try {
          const event = await runWithRequestDeadline((signal) => submit(request, signal), {
            timeoutError: () =>
              new Error(
                'The Tournament Request Is Unconfirmed. Submit Again To Check The Same Original Event.'
              ),
          });
          if (!uuid.test(event.id) || (request.tournamentId && request.tournamentId !== event.id))
            throw new Error('The Original Tournament Identity Could Not Be Verified.');
          request.tournamentId = event.id;
          // If this save fails, the earlier pending identity still replays the
          // same canonical event. Do not proceed to another child without it.
          save();
          results.push(event);
        } catch (error) {
          if (error instanceof TournamentCreateRetiredError) {
            original.state = 'retired';
            try {
              save();
            } catch {
              /* Keep the original pending identity. */
            }
          } else if (error instanceof TournamentCreateRefusedError) {
            // A verified refusal owns no accepted receipt. Accepted siblings
            // remain immutable; an explicit submit may correct only this child.
            if (index === 0) original.state = 'resolved';
            else request.refused = true;
            try {
              save();
            } catch {
              /* Keep the original pending identity. */
            }
          }
          throw error;
        }
      }
      original.state = original.requests[0].stagePlan ? 'awaiting_stage' : 'resolved';
      try {
        save();
      } catch {
        /* Pending replay remains safe after a lost local acknowledgement. */
      }
      return results;
    });
  })();
  running.set(key, promise);
  const clear = () => {
    if (running.get(key) === promise) running.delete(key);
  };
  void promise.then(clear, clear);
  return promise;
}
