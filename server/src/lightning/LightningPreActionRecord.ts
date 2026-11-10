/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LIGHTNING PRE-ACTION RECORD (2026-11-10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, in the big blind on 2026-11-10: "i clicked check fold but it didn't
 * move me ... it made me hit fold again." Hand 58348210's cause could not be
 * proven because nothing recorded what the engine did with a player's
 * pre-action: whether it was armed, refused, cleared, executed or released.
 * This module is that record.
 *
 * WHAT IS RECORDED. Every arm that reaches a Lightning room's pre-action
 * door (POST /preaction) and every consequence of it, one row per event:
 *
 *   set       armed and held, with the price owed at that moment
 *   refused   the door said no (stale hand, left the hand, invalid, not in
 *             the hand, no active hand, not this player's room), or a
 *             release on a bet was refused
 *   pending   an arm that became a fold request held until the seat's turn
 *   released  freed to the next hand: at the arm (already priced), on a bet
 *             that priced an armed Check/Fold, or a held fold priced by a bet
 *   executed  ran at the player's turn, and what it became
 *   rearmed   a carried Check/Fold armed again after its free check
 *   cleared   by the player, invalidated by a bet or at the turn, by a fold
 *             request, or at the hand's end
 *
 * NEVER ON THE ACTION PATH. `record` is a push into a bounded in-memory
 * buffer and a timer; it never awaits, never throws into its caller and
 * never touches the database itself. A background flush sends batches to
 * fn_lightning_preaction_record, one call in flight at a time. Each event
 * carries its own id, so a retry after an unknown outcome replays rows the
 * database may already hold and the insert ignores them.
 *
 * BOUNDED. At most LIGHTNING_PREACTION_MAX_BUFFERED events wait; beyond that
 * the oldest are dropped and counted. A failed batch is retried at most
 * LIGHTNING_PREACTION_MAX_ATTEMPTS times. "Function not found" (the
 * database half not installed) drops the buffer and stays quiet for ten
 * minutes: never a loop, never a fault. Retention is the database's.
 *
 * HORSES ARE PLAYERS (CLAUDE.md 10.5). Nothing here knows or asks whether a
 * player is a horse; every event at the door is recorded the same way.
 *
 * NO CARDS. Who, which hand, which pre-action, what happened, the price owed
 * and the street: never a card.
 */
import { randomUUID } from 'node:crypto';
import { isMissingFunctionError } from './rpcErrors.js';
import { isUuid, type LightningRpcClient } from './LightningRpc.js';
import { RateLimitedLog } from './RateLimitedLog.js';
import { LIGHTNING_FAILURE_LOG_INTERVAL_MS } from './LightningConfig.js';
import type { LightningWorkerLogger } from './LightningClusterWorker.js';

export const LIGHTNING_PREACTION_EVENT_KINDS = [
  'set',
  'refused',
  'pending',
  'released',
  'executed',
  'rearmed',
  'cleared',
] as const;
export type LightningPreActionEventKind = (typeof LIGHTNING_PREACTION_EVENT_KINDS)[number];

/** One fact about one player's pre-action. */
export interface LightningPreActionEvent {
  readonly kind: LightningPreActionEventKind;
  readonly playerId: string;
  /** The hand the engine holds the arm for; null when the door found no hand. */
  readonly handId: string | null;
  readonly clusterId: string | null;
  /** The hand the request named, when it differed from the one found (a refusal). */
  readonly requestedHandId?: string | null;
  /** The Lightning room the request came through, when known. */
  readonly roomId?: string | null;
  /** The pre-action concerned (auto_check_fold, auto_fold, ...). */
  readonly action: string | null;
  /** Why or what: a refusal code, a clear cause, what an execution became. */
  readonly detail: string | null;
  /** Chips owed by the player at that moment, when the engine knew it. */
  readonly toCall?: number | null;
  readonly stage?: string | null;
  /** Engine clock (epoch ms). */
  readonly atMs: number;
}

/** Waiting events kept; the oldest are dropped beyond this. */
export const LIGHTNING_PREACTION_MAX_BUFFERED = 5_000;
/** Events per database call. */
export const LIGHTNING_PREACTION_BATCH = 200;
/** How long an event waits before its batch is sent. */
export const LIGHTNING_PREACTION_FLUSH_MS = 1_000;
/** Sends of one batch before it is given up (an unknown outcome is retried as the same rows). */
export const LIGHTNING_PREACTION_MAX_ATTEMPTS = 3;
/** After "function not found", nothing is sent for this long. */
export const LIGHTNING_PREACTION_RETRY_MS = 10 * 60_000;

const DETAIL_MAX = 120;

export interface LightningPreActionRecorderDeps {
  rpc?: LightningRpcClient;
  logger?: LightningWorkerLogger;
  now?: () => number;
  flushMs?: number;
  maxBuffered?: number;
  batchSize?: number;
  uuid?: () => string;
}

// Loaded on first send, so a process (or a test) that never records never
// opens the database client for this module.
const defaultRpc: LightningRpcClient = async (fn, args) => {
  const { supabase } = await import('../services/supabase/client.js');
  return (await supabase.rpc(fn, args)) as unknown as { data: unknown; error: unknown };
};

const defaultLogger: LightningWorkerLogger = {
  log: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m, err) => console.error(m, err ?? ''),
};

/** The row the database receives (fn_lightning_preaction_record p_events). */
interface Row {
  event_id: string;
  kind: LightningPreActionEventKind;
  player_id: string;
  hand_id: string | null;
  cluster_id: string | null;
  requested_hand_id: string | null;
  room_id: string | null;
  action: string | null;
  detail: string | null;
  to_call: number | null;
  stage: string | null;
  at: string;
}

function clip(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.length > DETAIL_MAX ? v.slice(0, DETAIL_MAX) : v;
}

function uuidOrNull(v: string | null | undefined): string | null {
  return isUuid(v) ? v : null;
}

export class LightningPreActionRecorder {
  private readonly rpc: LightningRpcClient;
  private readonly logger: LightningWorkerLogger;
  private readonly now: () => number;
  private readonly flushMs: number;
  private readonly maxBuffered: number;
  private readonly batchSize: number;
  private readonly uuid: () => string;
  private readonly failureLog = new RateLimitedLog(LIGHTNING_FAILURE_LOG_INTERVAL_MS, 8);
  private buffer: Row[] = [];
  /** The batch being sent (kept for an unknown-outcome retry) and its attempts. */
  private inFlight: { rows: Row[]; attempts: number } | null = null;
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unavailableUntilMs = 0;
  private stopped = false;
  /** Events dropped by the buffer bound or a batch given up. */
  dropped = 0;
  /** Events the database acknowledged receiving. */
  sent = 0;

  constructor(deps: LightningPreActionRecorderDeps = {}) {
    this.rpc = deps.rpc ?? defaultRpc;
    this.logger = deps.logger ?? defaultLogger;
    this.now = deps.now ?? Date.now;
    this.flushMs = deps.flushMs ?? LIGHTNING_PREACTION_FLUSH_MS;
    this.maxBuffered = deps.maxBuffered ?? LIGHTNING_PREACTION_MAX_BUFFERED;
    this.batchSize = deps.batchSize ?? LIGHTNING_PREACTION_BATCH;
    this.uuid = deps.uuid ?? randomUUID;
  }

  /** Events waiting to be sent (excluding a batch in flight). */
  get pending(): number {
    return this.buffer.length;
  }

  /** Queue one event. Cheap, synchronous, never throws. */
  record(event: LightningPreActionEvent): void {
    try {
      if (this.stopped || !isUuid(event.playerId)) return;
      if (this.now() < this.unavailableUntilMs) return;
      this.buffer.push({
        event_id: this.uuid(),
        kind: event.kind,
        player_id: event.playerId,
        hand_id: uuidOrNull(event.handId),
        cluster_id: uuidOrNull(event.clusterId),
        requested_hand_id:
          event.requestedHandId && event.requestedHandId !== event.handId
            ? clip(event.requestedHandId)
            : null,
        room_id: clip(event.roomId ?? null),
        action: clip(event.action),
        detail: clip(event.detail),
        to_call:
          typeof event.toCall === 'number' && Number.isFinite(event.toCall)
            ? Math.round(event.toCall * 100) / 100
            : null,
        stage: clip(event.stage ?? null),
        at: new Date(event.atMs).toISOString(),
      });
      const over = this.buffer.length - this.maxBuffered;
      if (over > 0) {
        this.buffer.splice(0, over);
        this.dropped += over;
      }
      this.schedule();
    } catch {
      /* never into the action path */
    }
  }

  private schedule(): void {
    if (this.timer || this.stopped) return;
    const t = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushMs);
    (t as { unref?: () => void }).unref?.();
    this.timer = t;
  }

  /** Send what is waiting, one batch at a time. Never throws. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const run = this.drain().finally(() => {
      if (this.flushing === run) this.flushing = null;
      if (this.buffer.length > 0 || this.inFlight) this.schedule();
    });
    this.flushing = run;
    return run;
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      if (!this.inFlight) {
        if (this.buffer.length === 0) return;
        this.inFlight = { rows: this.buffer.splice(0, this.batchSize), attempts: 0 };
      }
      const batch = this.inFlight;
      batch.attempts += 1;
      let outcome: 'ok' | 'unavailable' | 'error';
      let error: unknown = null;
      try {
        const { error: e } = await this.rpc('fn_lightning_preaction_record', {
          p_events: batch.rows,
        });
        if (!e) outcome = 'ok';
        else if (isMissingFunctionError(e)) outcome = 'unavailable';
        else {
          outcome = 'error';
          error = e;
        }
      } catch (e) {
        if (isMissingFunctionError(e)) outcome = 'unavailable';
        else {
          outcome = 'error';
          error = e;
        }
      }
      if (outcome === 'ok') {
        this.sent += batch.rows.length;
        this.inFlight = null;
        continue;
      }
      if (outcome === 'unavailable') {
        this.dropped += batch.rows.length + this.buffer.length;
        this.buffer = [];
        this.inFlight = null;
        this.unavailableUntilMs = this.now() + LIGHTNING_PREACTION_RETRY_MS;
        if (this.failureLog.shouldLog('unavailable', this.now()))
          this.logger.warn(
            '[LightningPreActionRecord] fn_lightning_preaction_record not installed; quiet for 10 minutes'
          );
        return;
      }
      if (this.failureLog.shouldLog('error', this.now()))
        this.logger.error('[LightningPreActionRecord] batch not recorded', error);
      if (batch.attempts >= LIGHTNING_PREACTION_MAX_ATTEMPTS) {
        this.dropped += batch.rows.length;
        this.inFlight = null;
      }
      // The same batch (same event ids) is sent again on the next timer.
      return;
    }
  }

  /** Stop recording and drop what waits. For shutdown and tests. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = [];
  }
}

/** The engine's one recorder. */
export const lightningPreActionRecorder = new LightningPreActionRecorder();
