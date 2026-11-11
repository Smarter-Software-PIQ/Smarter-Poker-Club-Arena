/**
 * LIGHTNING'S OWN DATABASE LANE (Dan 2026-11-10: "isolate Lightning's
 * database connections").
 *
 * On 2026-11-10 a tournament settlement lock storm (#10361) pinned the shared
 * PostgREST connection pool, and every Lightning call queued behind it:
 * settlement averaged 979 ms against 141 ms and fold-to-next-hand p50 reached
 * 13 s. The original fast fold was unaffected because it already runs on its
 * own restricted login (lightningFoldSession.ts, 20261020160107). This lane
 * gives the rest of the per-hand path the same isolation:
 *
 *   fn_lightning_match_and_form          (the matcher's writer)
 *   fn_lightning_instance_begin_dealing  (a formed hand starts dealing)
 *   fn_lightning_bind_hand_number        (the hand gets its number)
 *   fn_lightning_settle_hand             (the hand settles)
 *
 * Same proven shape as the fold lane: a verified-TLS pg pool on the
 * engine_lightning_lane login (its URL read from Vault through a service_role
 * RPC, never from a host file), one pipelined round trip per call
 * (BEGIN, the fixed private wrapper, COMMIT), and only a COMMIT command tag
 * proves the answer is durable.
 *
 * THE FALLBACK CONTRACT (tightened 2026-11-10, Dan: "the shared path must
 * never be tried after the lane may have executed"). `call` answers:
 *   - null            -> DEFINITELY NOT SENT: no socket was acquired and no
 *                        byte of BEGIN, the wrapper or COMMIT was written (lane
 *                        not ready, credential absent, pool full, acquisition
 *                        over 100 ms or failed). Only this answer lets the
 *                        caller make the same call through PostgREST.
 *   - { data, null }  -> committed; data is the function's own jsonb answer.
 *   - { null, error } -> SENT. Either the database refused it and the COMMIT
 *                        answered ROLLBACK (LIGHTNING_LANE_ROLLED_BACK:
 *                        definitely not committed), or the outcome cannot be
 *                        known (LIGHTNING_LANE_UNKNOWN: lost socket before the
 *                        answer, after COMMIT was sent, or the request
 *                        boundary). Neither is re-sent here. The caller treats
 *                        both exactly as it treats a PostgREST error today and
 *                        resolves them from the operation's own durable record:
 *                          settle_hand       retried with the SAME request id
 *                                            and request hash; the function
 *                                            returns the stored settle_receipt
 *                                            (replay) if the first committed;
 *                          match_and_form    re-asked with the SAME request id;
 *                                            cash_cluster_matcher_pass replays
 *                                            the stored result;
 *                          begin_dealing,    never re-sent: the host abandons the
 *                          bind_hand_number  instance, keyed by its instance id
 *                                            (bind also replays on the same
 *                                            instance and hand number).
 * A refusal raised by the wrapper itself (wrong session, missing function,
 * privilege) also turns the lane off for the life of this process: every later
 * call is refused before sending and goes to PostgREST, and the gauge says so.
 *
 * TIMEOUTS. Each lane transaction runs at most LIGHTNING_LANE_STATEMENT_TIMEOUT_MS
 * (8 s, the shared path's service_role statement_timeout) under the role's
 * 4 s lock_timeout (the shared path allows 8 s). The client request boundary
 * stays at the engine's Supabase timeout and only decides when an answer is
 * declared unknown.
 */
import pg from 'pg';
import { supabase } from './supabase/client.js';
import { resolveClientTimeoutMs } from './cashAccountingBatchBudget.js';
import { enginePgSsl } from './supabase/enginePgSession.js';
import { currentTournamentDataAuthority, dataActorHeaders } from './supabase/dataActorContext.js';
import {
  isTournamentManagerFencedError,
  notifyTournamentManagerFenced,
} from './supabase/tournamentManagerFence.js';

export const LIGHTNING_LANE_POOL_MAX = 6;
export const LIGHTNING_LANE_ACQUIRE_MS = 100;
/** Never above the shared path's service_role statement_timeout (8 s). */
export const LIGHTNING_LANE_STATEMENT_TIMEOUT_MS = 8_000;
export const LIGHTNING_LANE_ROLE = 'engine_lightning_lane';
export const LIGHTNING_LANE_SQL =
  'SELECT smarter_private.fn_engine_lightning_lane($1::text,$2::jsonb,$3::jsonb) AS result';
export const LIGHTNING_ENTRY_BIG_BLIND_LANE_HEADER = 'x-smarter-lightning-entry-bb';
const DB_TIMEOUT_MS = resolveClientTimeoutMs();

/** The per-hand functions this lane carries, by their PostgREST name. */
export const LIGHTNING_LANE_OPERATIONS = {
  fn_lightning_match_and_form: 'match_and_form',
  fn_lightning_instance_begin_dealing: 'begin_dealing',
  fn_lightning_bind_hand_number: 'bind_hand_number',
  fn_lightning_settle_hand: 'settle_hand',
} as const;
export type LightningLaneFunction = keyof typeof LIGHTNING_LANE_OPERATIONS;

export function isLightningLaneFunction(fn: string): fn is LightningLaneFunction {
  return Object.prototype.hasOwnProperty.call(LIGHTNING_LANE_OPERATIONS, fn);
}

export type LightningLaneError =
  | { message: 'lightning_lane_outcome_unknown'; code: 'LIGHTNING_LANE_UNKNOWN' }
  | { message: 'lightning_lane_rolled_back'; code: 'LIGHTNING_LANE_ROLLED_BACK'; sqlState: string };
export type LightningLaneResult =
  | { data: unknown; error: null }
  | { data: null; error: LightningLaneError };

export interface LightningLaneClient {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Array<Record<string, unknown>>; command?: string | null }>;
  release(destroy?: boolean): void;
}
/** A pg socket as the pool first connects it, before anybody checks it out. */
export interface LightningLaneClientSocket {
  on(event: 'error', callback: () => void): unknown;
}
export interface LightningLanePool {
  connect(): Promise<LightningLaneClient>;
  end(): Promise<void>;
  on(event: 'error', callback: () => void): unknown;
  on(event: 'connect', callback: (socket: LightningLaneClientSocket) => void): unknown;
}

export function verifiedLaneConnectionString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      (url.port && url.port !== '5432') ||
      decodeURIComponent(url.username).split('.')[0] !== LIGHTNING_LANE_ROLE ||
      !url.password ||
      !url.hostname
    )
      return null;
    // pg merges query fields over its explicit configuration (user, port,
    // options, TLS); only the validated authority and path are used.
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** A refusal raised by the wrapper or the catalog, not by the function it calls. */
function laneDefinitionRefusal(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const code = typeof e?.code === 'string' ? e.code : '';
  return (
    message.startsWith('LIGHTNING_LANE_') ||
    code === '42883' || // undefined_function
    code === '42501' || // insufficient_privilege
    code === '42P01' || // undefined_table
    code === '3F000' // invalid_schema_name
  );
}

function hasSqlState(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

export function createLightningLaneSession(deps: {
  readUrl: () => Promise<unknown>;
  openPool: (connectionString: string) => LightningLanePool;
  actorHeaders?: () => Record<string, string>;
  log?: (line: string) => void;
  timeoutMs?: number;
}) {
  const timeoutMs = deps.timeoutMs ?? DB_TIMEOUT_MS;
  const statementMs = Math.min(timeoutMs, LIGHTNING_LANE_STATEMENT_TIMEOUT_MS);
  const BEGIN_SQL = `BEGIN; SET LOCAL synchronous_commit = on; SET LOCAL statement_timeout = '${statementMs}ms'; SET LOCAL idle_in_transaction_session_timeout = '${statementMs}ms'`;
  const actorHeaders =
    deps.actorHeaders ?? (() => Object.fromEntries(dataActorHeaders().entries()));
  let pool: LightningLanePool | null = null;
  let starting: Promise<boolean> | null = null;
  let stopped = false;
  let ready = false;
  let disabled = false;
  let active = 0;
  let committed = 0;
  let rolledBack = 0;
  let unknown = 0;
  let admissionRefused = 0;
  const log = deps.log ?? ((line: string) => console.log(line));
  const safeLog = (message: string) => {
    try {
      log(message);
    } catch {
      /* diagnostic only */
    }
  };

  function start(): Promise<boolean> {
    if (stopped || disabled) return Promise.resolve(false);
    if (ready) return Promise.resolve(true);
    if (starting) return starting;
    starting = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      let candidate: LightningLanePool | null = null;
      const warmed: LightningLaneClient[] = [];
      const prepare = (async () => {
        const connectionString = verifiedLaneConnectionString(await deps.readUrl());
        if (!connectionString || stopped || closed) return false;
        candidate = deps.openPool(connectionString);
        pool = candidate;
        candidate.on('error', () =>
          safeLog('[LightningLaneSession] idle socket lost; the next call reacquires a socket')
        );
        /* A SOCKET IN USE CAN BE LOST TOO (2026-11-11). The pool's 'error'
           listener above only covers IDLE sockets: pg-pool removes it while a
           socket is checked out, and pg then emits the loss on the client
           itself. With no listener there that is an uncaught exception, and
           at 09:55:38Z on 2026-11-11 one lost lane socket drained and restarted
           the whole engine outside the break (EngineRestartedOutsideTheBreak).
           Every socket the pool creates gets its own listener for its whole
           life. The call holding it still sees its queries rejected, resolves
           the outcome as unknown and destroys the socket on release. */
        candidate.on('connect', (socket) =>
          socket.on('error', () =>
            safeLog(
              '[LightningLaneSession] a socket in use was lost; its call resolves as unknown and the socket is destroyed'
            )
          )
        );
        for (let index = 0; index < LIGHTNING_LANE_POOL_MAX; index++) {
          const client = await candidate.connect();
          if (closed || stopped) {
            client.release(true);
            return false;
          }
          warmed.push(client);
          const result = await client.query(
            `SELECT current_user='${LIGHTNING_LANE_ROLE}' AND has_function_privilege('smarter_private.fn_engine_lightning_lane(text,jsonb,jsonb)','EXECUTE') AS ok`
          );
          if (result.rows[0]?.ok !== true || stopped || closed) return false;
        }
        return true;
      })();
      try {
        const boundary = new Promise<false>((resolve) => {
          timer = setTimeout(() => {
            closed = true;
            resolve(false);
          }, 5_000);
          timer.unref?.();
        });
        ready = await Promise.race([prepare, boundary]);
        safeLog(
          ready
            ? '[LightningLaneSession] ready: dedicated verified-TLS pool, six sockets, synchronous commit'
            : '[LightningLaneSession] unavailable; Lightning per-hand calls stay on PostgREST'
        );
        return ready;
      } catch {
        safeLog('[LightningLaneSession] unavailable; Lightning per-hand calls stay on PostgREST');
        return false;
      } finally {
        closed = true;
        if (timer) clearTimeout(timer);
        for (const client of warmed) client.release(!ready);
        if (!ready && candidate) {
          const failed = candidate as LightningLanePool;
          if (pool === failed) pool = null;
          void failed.end().catch(() => {});
        }
        starting = null;
      }
    })();
    return starting;
  }

  function disable(reason: string): void {
    if (disabled) return;
    disabled = true;
    ready = false;
    safeLog(
      `[LightningLaneSession] disabled (${reason}); Lightning per-hand calls stay on PostgREST`
    );
    const closing = pool;
    pool = null;
    if (closing) void closing.end().catch(() => {});
  }

  /** See the fallback contract at the top of this file. */
  async function call(
    fn: string,
    args: Record<string, unknown>,
    options: { entryBigBlind?: boolean } = {}
  ): Promise<LightningLaneResult | null> {
    if (!isLightningLaneFunction(fn)) return null;
    const authority = currentTournamentDataAuthority();
    const selected = pool;
    if (!ready || stopped || disabled || !selected || active >= LIGHTNING_LANE_POOL_MAX) {
      admissionRefused++;
      return null;
    }
    let headers: Record<string, string>;
    try {
      headers = { ...actorHeaders() };
    } catch {
      admissionRefused++;
      return null;
    }
    if (options.entryBigBlind) headers[LIGHTNING_ENTRY_BIG_BLIND_LANE_HEADER] = '1';
    active++;
    let client: LightningLaneClient | null = null;
    let admitted = false;
    let dispatched = false;
    let expired = false;
    let destroy = false;
    let acquireTimer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const acquisition = selected.connect();
      // An acquisition that finishes after admission closed is released unused.
      const owned = acquisition.then((connection) => {
        if (!admitted) {
          connection.release();
          return null;
        }
        return connection;
      });
      owned.catch(() => undefined);
      admitted = true;
      const acquisitionBound = new Promise<null>((resolve) => {
        acquireTimer = setTimeout(() => {
          admitted = false;
          resolve(null);
        }, LIGHTNING_LANE_ACQUIRE_MS);
        acquireTimer.unref?.();
      });
      client = await Promise.race([owned, acquisitionBound]);
      if (acquireTimer) clearTimeout(acquireTimer);
      if (!client || stopped) {
        admissionRefused++;
        return null;
      }
      const connection = client;
      dispatched = true;
      // One round trip: BEGIN, the wrapper and COMMIT are pipelined and run
      // strictly in order inside one transaction.
      const begun = connection.query(BEGIN_SQL);
      const statement = connection.query(LIGHTNING_LANE_SQL, [
        LIGHTNING_LANE_OPERATIONS[fn],
        JSON.stringify(args),
        JSON.stringify(headers),
      ]);
      const commit = connection.query('COMMIT');
      for (const reply of [begun, statement, commit]) reply.catch(() => undefined);
      const transaction = (async (): Promise<LightningLaneResult> => {
        await begun;
        let result: { rows: Array<Record<string, unknown>> };
        try {
          result = await statement;
        } catch (refused) {
          // A database error reply aborts the transaction; the queued COMMIT
          // then answers ROLLBACK. Only that pair proves nothing committed. It
          // is still NEVER re-sent through PostgREST from here: the call reached
          // the database, so the caller resolves it from the operation's own
          // record exactly as it resolves a PostgREST error.
          const done = await commit;
          if (hasSqlState(refused) && done.command === 'ROLLBACK' && !expired) {
            rolledBack++;
            if (isTournamentManagerFencedError(refused)) notifyTournamentManagerFenced(authority);
            if (laneDefinitionRefusal(refused)) disable('the lane wrapper refused the call');
            return {
              data: null,
              error: {
                message: 'lightning_lane_rolled_back',
                code: 'LIGHTNING_LANE_ROLLED_BACK',
                sqlState: String((refused as { code?: unknown }).code),
              },
            };
          }
          throw refused;
        }
        const done = await commit;
        if (done.command !== 'COMMIT') throw new Error('lane_not_committed');
        if (expired) throw new Error('lane_request_boundary');
        committed++;
        return { data: result.rows[0]?.result ?? null, error: null };
      })();
      const boundary = new Promise<never>((_, reject) => {
        requestTimer = setTimeout(() => {
          expired = true;
          destroy = true;
          reject(new Error('lane_request_boundary'));
        }, timeoutMs);
        requestTimer.unref?.();
      });
      return await Promise.race([transaction, boundary]);
    } catch (error) {
      destroy = true;
      if (isTournamentManagerFencedError(error)) notifyTournamentManagerFenced(authority);
      if (!dispatched) {
        admissionRefused++;
        return null;
      }
      unknown++;
      safeLog(`[LightningLaneSession] ${fn} outcome unknown; reported as a transport failure`);
      return {
        data: null,
        error: { message: 'lightning_lane_outcome_unknown', code: 'LIGHTNING_LANE_UNKNOWN' },
      };
    } finally {
      admitted = false;
      if (acquireTimer) clearTimeout(acquireTimer);
      if (requestTimer) clearTimeout(requestTimer);
      client?.release(destroy);
      active--;
    }
  }

  async function stop(): Promise<void> {
    stopped = true;
    ready = false;
    if (starting) await starting;
    const closing = pool;
    pool = null;
    if (closing) await closing.end();
  }

  function toPrometheus(): string[] {
    return [
      '# TYPE poker_lightning_lane_ready gauge',
      `poker_lightning_lane_ready ${ready && !stopped && !disabled ? 1 : 0}`,
      '# TYPE poker_lightning_lane_disabled gauge',
      `poker_lightning_lane_disabled ${disabled ? 1 : 0}`,
      '# TYPE poker_lightning_lane_active gauge',
      `poker_lightning_lane_active ${active}`,
      '# TYPE poker_lightning_lane_committed_total counter',
      `poker_lightning_lane_committed_total ${committed}`,
      '# TYPE poker_lightning_lane_rolled_back_total counter',
      `poker_lightning_lane_rolled_back_total ${rolledBack}`,
      '# TYPE poker_lightning_lane_unknown_total counter',
      `poker_lightning_lane_unknown_total ${unknown}`,
      '# TYPE poker_lightning_lane_admission_refused_total counter',
      `poker_lightning_lane_admission_refused_total ${admissionRefused}`,
    ];
  }

  return { start, call, stop, toPrometheus };
}

const session = createLightningLaneSession({
  readUrl: async () => {
    const { data, error } = await supabase.rpc('fn_engine_lightning_lane_session_url');
    if (error) throw new Error('lightning_lane_credential_unavailable');
    return data;
  },
  openPool: (connectionString) =>
    new pg.Pool({
      connectionString,
      max: LIGHTNING_LANE_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 0,
      keepAlive: true,
      pipeline: true,
      ssl: enginePgSsl(),
      query_timeout: DB_TIMEOUT_MS,
      statement_timeout: DB_TIMEOUT_MS,
      application_name: `club-arena-engine-lightning-lane:${process.pid}`,
    }) as unknown as LightningLanePool,
});
export const startLightningLaneSession = session.start;
export const lightningLaneCall = session.call;
export const stopLightningLaneSession = session.stop;
export const lightningLaneToPrometheus = session.toPrometheus;
