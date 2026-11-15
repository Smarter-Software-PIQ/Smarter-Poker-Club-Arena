/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BUS EVENT LOGGER — Batched Supabase logging for critical MasterBus events
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Subscribes to critical events and batch-writes them to `bus_event_log` table.
 * Flushes every 10 seconds or when batch reaches 20 events.
 */

import { supabase } from '../lib/supabase';
import { masterBus, type BusEventType } from '../core/MasterBus';
import { useUserStore } from '../stores/useUserStore';
import { reportError } from '../utils/errorReporter';
import { setShareOutcomeSink } from '../lib/share';

interface LogEntry {
  event_type: string;
  payload: Record<string, unknown>;
  user_id: string | null;
  created_at: string;
}

const CRITICAL_EVENTS: BusEventType[] = [
  'BALANCE_UPDATED',
  'CLUB_JOINED',
  'CLUB_LEFT',
  'TABLE_SEATED',
  'TABLE_LEFT',
];

const BATCH_FLUSH_INTERVAL = 10_000; // 10 seconds
const MAX_BATCH_SIZE = 20;

class BusEventLoggerService {
  private batch: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribes: (() => void)[] = [];
  private started = false;
  // Rate-limit flush error reporting — max 1 error reporting event per 5 min window
  private _lastFlushErrorAt = 0;
  private readonly _FLUSH_ERROR_COOLDOWN_MS = 5 * 60_000;

  /** Start listening to critical events and batching to Supabase */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Every share and copy button reports its outcome here (src/lib/share.ts).
    setShareOutcomeSink((source, outcome) => this.record('SHARE_OUTCOME', { source, outcome }));

    // Subscribe to each critical event
    for (const eventType of CRITICAL_EVENTS) {
      const unsub = masterBus.subscribe(eventType, (event) => {
        const userId = useUserStore.getState().user?.id || null;
        this.batch.push({
          event_type: event.type,
          payload:
            typeof event.payload === 'object'
              ? (event.payload as Record<string, unknown>)
              : { value: event.payload },
          user_id: userId,
          created_at: event.timestamp,
        });

        if (this.batch.length >= MAX_BATCH_SIZE) {
          this.flush();
        }
      });
      this.unsubscribes.push(unsub);
    }

    // Periodic flush (record() may already have started one)
    if (!this.flushTimer) this.flushTimer = setInterval(() => this.flush(), BATCH_FLUSH_INTERVAL);
  }

  /**
   * Record one event from THIS tab only (2026-11-15, share outcomes). The
   * MasterBus repeats every event to the other open tabs, and each tab runs its
   * own logger, so an event that must be counted once is handed to the batch
   * directly instead of being emitted. Starts the flush timer if the app has
   * not started the logger yet; never throws into the caller.
   */
  record(eventType: string, payload: Record<string, unknown>): void {
    try {
      this.batch.push({
        event_type: eventType,
        payload,
        user_id: useUserStore.getState().user?.id || null,
        created_at: new Date().toISOString(),
      });
      if (this.batch.length >= MAX_BATCH_SIZE) void this.flush();
      else if (!this.flushTimer) {
        this.flushTimer = setInterval(() => void this.flush(), BATCH_FLUSH_INTERVAL);
      }
    } catch {
      /* a measurement never breaks the action it measures */
    }
  }

  /** Flush the current batch to Supabase */
  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const toFlush = [...this.batch];
    this.batch = [];

    try {
      const { error } = await supabase.from('bus_event_log').insert(toFlush);

      if (error) {
        // Rate-limit error reporting reporting for flush failures — transient network timeouts
        // (TypeError: Load failed) can recur every 10s and would flood error reporting.
        const now = Date.now();
        if (now - this._lastFlushErrorAt > this._FLUSH_ERROR_COOLDOWN_MS) {
          this._lastFlushErrorAt = now;
          reportError(error, 'BusEventLogger.flush');
        } else {
          console.debug('[BusEventLogger] flush error (rate-limited):', error.message);
        }
        // Re-queue failed entries (up to limit)
        this.batch = [...toFlush.slice(-10), ...this.batch].slice(0, MAX_BATCH_SIZE);
      }
    } catch (e: unknown) {
      const now = Date.now();
      if (now - this._lastFlushErrorAt > this._FLUSH_ERROR_COOLDOWN_MS) {
        this._lastFlushErrorAt = now;
        reportError(e, 'BusEventLogger.flush.catch');
      } else {
        console.debug('[BusEventLogger] flush exception (rate-limited):', e);
      }
    }
  }

  /** Stop the logger and clean up */
  stop(): void {
    setShareOutcomeSink(null);
    this.unsubscribes.forEach((fn) => fn());
    this.unsubscribes = [];
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush(); // Final flush
    this.started = false;
  }

  /** Get current batch size (for DevTools) */
  getBatchSize(): number {
    return this.batch.length;
  }
}

export const busEventLogger = new BusEventLoggerService();
