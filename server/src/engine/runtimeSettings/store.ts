/**
 * ENGINE RUNTIME SETTINGS, THE STORE (2026-11-19). One per engine process.
 *
 *   database: fn_ca_engine_runtime_settings_current()   (read every RUNTIME_SETTINGS_POLL_MS)
 *     -> parseRuntimeSettings (snapshot.ts): every key registered, every value in range, or the version is refused
 *       -> `active`: the snapshot the NEXT hand will take
 *         -> pinHand(scope, handId) at each hand start: that hand reads that snapshot to its end
 *
 * AT A HAND BOUNDARY, NEVER MID-HAND. A new version only replaces `active`. A hand already dealt holds the snapshot it
 * pinned when it started; the next hand of that table pins the new one. So a change is atomic per hand: no hand ever
 * reads two versions.
 *
 * FAIL SAFE: THE LAST GOOD VERSION KEEPS SERVING.
 * - The read fails, times out or the function is missing: `active` is unchanged (before any good read that is the
 *   compiled defaults, version 0).
 * - The read returns a version this engine refuses (an unknown key, a value of the wrong kind or out of range, a
 *   broken cross rule): `active` is unchanged and the refusal is reported once per refused version.
 * - Nothing is published (the function answers null): the compiled defaults.
 *
 * AUDIT. When a scope (one table, or one Lightning Cluster) pins a version different from the one it pinned before,
 * one row {scope, hand_id, version, previous_version, pinned_at} is queued and written in a batch through
 * fn_ca_engine_runtime_settings_record_use. A hand used the version of the latest row of its scope at or before it
 * (hand numbers order a table; pinned_at orders a Cluster). The last RECENT_HANDS pins are also kept in memory
 * (handVersion) for diagnostics. A failed write keeps its rows for the next tick, bounded by AUDIT_QUEUE_MAX.
 */
import {
  COMPILED_RUNTIME_SETTINGS,
  parseRuntimeSettings,
  type RuntimeSettingsSnapshot,
} from './snapshot.js';
import { validateSingleBlanketOffStep } from '../HorseBlanketOffSingleStepGuard.js';

export const RUNTIME_SETTINGS_POLL_MS = 30_000;
export const RUNTIME_SETTINGS_READ_TIMEOUT_MS = 5_000;
const AUDIT_QUEUE_MAX = 5_000;
const AUDIT_BATCH_MAX = 500;
const SCOPES_MAX = 50_000;
const RECENT_HANDS = 4_096;
const WARN_EVERY_MS = 10 * 60_000;

export interface RuntimeSettingsUseRow {
  scope: string;
  hand_id: string;
  version: number;
  previous_version: number | null;
  pinned_at: string;
}

export type RuntimeSettingsRefreshOutcome = 'applied' | 'unchanged' | 'refused' | 'failed';

export interface RuntimeSettingsStoreDeps {
  /** Reads the database answer. Absent: the store never reads and serves the compiled defaults. */
  read?: () => Promise<unknown>;
  /** Writes audit rows. Absent: rows are kept in memory only. */
  recordUse?: (rows: readonly RuntimeSettingsUseRow[]) => Promise<void>;
  now?: () => number;
  warn?: (message: string) => void;
  log?: (message: string) => void;
  intervalMs?: number;
  readTimeoutMs?: number;
}

export interface RuntimeSettingsStatus {
  activeVersion: number;
  activeSource: 'compiled' | 'database';
  lastReadAt: number | null;
  lastReadOutcome: RuntimeSettingsRefreshOutcome | null;
  lastRefusal: { version: number | null; reason: string } | null;
  consecutiveFailures: number;
  pendingAuditRows: number;
}

export interface RuntimeSettingsStore {
  /** The snapshot the next hand will take. */
  current(): RuntimeSettingsSnapshot;
  /** Pin the snapshot a hand reads to its end. The same (scope, handId) again returns the same pin. */
  pinHand(scope: string, handId: string): RuntimeSettingsSnapshot;
  /** The version a recent hand pinned (in memory, last RECENT_HANDS pins), or undefined. */
  handVersion(scope: string, handId: string): number | undefined;
  refresh(): Promise<RuntimeSettingsRefreshOutcome>;
  flushAudit(): Promise<void>;
  /** Replace the database reader and audit writer (the production attach), keeping every pin. */
  attach(io: Pick<RuntimeSettingsStoreDeps, 'read' | 'recordUse'>): void;
  /** First read, then a read every intervalMs. Resolves after the first read (whatever its outcome). */
  start(): Promise<void>;
  stop(): void;
  status(): RuntimeSettingsStatus;
}

export function createRuntimeSettingsStore(
  deps: RuntimeSettingsStoreDeps = {}
): RuntimeSettingsStore {
  const now = deps.now ?? (() => Date.now());
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const log = deps.log ?? ((m: string) => console.log(m));
  const intervalMs = deps.intervalMs ?? RUNTIME_SETTINGS_POLL_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? RUNTIME_SETTINGS_READ_TIMEOUT_MS;
  let read = deps.read;
  let recordUse = deps.recordUse;
  let active: RuntimeSettingsSnapshot = COMPILED_RUNTIME_SETTINGS;
  const pins = new Map<string, { handId: string; snapshot: RuntimeSettingsSnapshot }>();
  const recent = new Map<string, number>();
  let queue: RuntimeSettingsUseRow[] = [];
  let lastReadAt: number | null = null;
  let lastReadOutcome: RuntimeSettingsRefreshOutcome | null = null;
  let lastRefusal: { version: number | null; reason: string } | null = null;
  let refusedVersionReported: number | null | undefined;
  let failures = 0;
  let lastFailWarn = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<RuntimeSettingsRefreshOutcome> | null = null;
  let flushing: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const once = async (): Promise<RuntimeSettingsRefreshOutcome> => {
    if (!read) return 'unchanged';
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let answer: unknown;
    try {
      answer = await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('runtime settings read timed out')),
            readTimeoutMs
          );
          (deadline as { unref?: () => void }).unref?.();
        }),
      ]);
    } catch (error) {
      failures += 1;
      const at = now();
      if (failures === 1 || at - lastFailWarn >= WARN_EVERY_MS) {
        lastFailWarn = at;
        warn(
          `[EngineRuntimeSettings] read failed (${failures} in a row); version ${active.version} keeps serving: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
      return 'failed';
    } finally {
      if (deadline) clearTimeout(deadline);
    }
    lastReadAt = now();
    if (failures > 0) log(`[EngineRuntimeSettings] reads again after ${failures} failed read(s)`);
    failures = 0;
    const parsed = parseRuntimeSettings(answer);
    if (!parsed.ok) {
      lastRefusal = { version: parsed.version, reason: parsed.reason };
      if (refusedVersionReported !== parsed.version) {
        refusedVersionReported = parsed.version;
        warn(
          `[EngineRuntimeSettings] refused version ${parsed.version ?? '(unreadable)'}: ${parsed.reason}; ` +
            `version ${active.version} keeps serving`
        );
      }
      return 'refused';
    }
    if (parsed.snapshot.version === active.version) return 'unchanged';
    // 1-at-a-time blanket-off transition guard (2026-11-21, Horse Switch lane):
    // refuse any initial v1 publish or live database->database transition that turns >= 2 new
    // blanket rules OFF in a single version. Cold-boot hydration of an already-established v2+
    // steady-state version is allowed; emergency rollbacks turning any number of rules back ON
    // are always allowed.
    if (active.source === 'database' || parsed.snapshot.version === 1) {
      const step = validateSingleBlanketOffStep(active.values, parsed.snapshot.values);
      if (!step.ok) {
        lastRefusal = { version: parsed.snapshot.version, reason: step.reason };
        if (refusedVersionReported !== parsed.snapshot.version) {
          refusedVersionReported = parsed.snapshot.version;
          warn(
            `[EngineRuntimeSettings] refused version ${parsed.snapshot.version}: ${step.reason}; ` +
              `version ${active.version} keeps serving`
          );
        }
        return 'refused';
      }
    }
    const previous = active.version;
    active = parsed.snapshot;
    lastRefusal = null;
    refusedVersionReported = undefined;
    log(
      `[EngineRuntimeSettings] version ${active.version} accepted (was ${previous}); ` +
        'each table takes it at its next hand'
    );
    return 'applied';
  };

  const flush = async (): Promise<void> => {
    if (!recordUse || queue.length === 0) return;
    const batch = queue.slice(0, AUDIT_BATCH_MAX);
    try {
      await recordUse(batch);
      queue = queue.slice(batch.length);
    } catch (error) {
      const at = now();
      if (at - lastFailWarn >= WARN_EVERY_MS) {
        lastFailWarn = at;
        warn(
          `[EngineRuntimeSettings] the hand-use audit could not be written (${queue.length} row(s) kept): ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }
  };

  const store: RuntimeSettingsStore = {
    current: () => active,
    pinHand(scope, handId) {
      const prior = pins.get(scope);
      if (prior && prior.handId === handId) return prior.snapshot;
      const snapshot = active;
      if (prior) pins.delete(scope);
      else if (pins.size >= SCOPES_MAX) pins.delete(pins.keys().next().value as string);
      pins.set(scope, { handId, snapshot });
      const recentKey = `${scope}\u0000${handId}`;
      recent.delete(recentKey);
      recent.set(recentKey, snapshot.version);
      if (recent.size > RECENT_HANDS) recent.delete(recent.keys().next().value as string);
      if (!prior || prior.snapshot.version !== snapshot.version) {
        if (queue.length >= AUDIT_QUEUE_MAX) queue.shift();
        queue.push({
          scope,
          hand_id: handId,
          version: snapshot.version,
          previous_version: prior ? prior.snapshot.version : null,
          pinned_at: new Date(now()).toISOString(),
        });
      }
      return snapshot;
    },
    handVersion: (scope, handId) => recent.get(`${scope}\u0000${handId}`),
    refresh() {
      if (inFlight) return inFlight;
      inFlight = once()
        .then((outcome) => {
          lastReadOutcome = outcome;
          return outcome;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    flushAudit() {
      if (flushing) return flushing;
      flushing = flush().finally(() => {
        flushing = null;
      });
      return flushing;
    },
    attach(io) {
      if (io.read) read = io.read;
      if (io.recordUse) recordUse = io.recordUse;
    },
    async start() {
      if (timer) return;
      timer = setInterval(() => {
        void store.refresh().catch(() => undefined);
        void store.flushAudit().catch(() => undefined);
      }, intervalMs);
      (timer as { unref?: () => void }).unref?.();
      await store.refresh().catch(() => undefined);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      void store.flushAudit().catch(() => undefined);
    },
    status: () => ({
      activeVersion: active.version,
      activeSource: active.source,
      lastReadAt,
      lastReadOutcome,
      lastRefusal,
      consecutiveFailures: failures,
      pendingAuditRows: queue.length,
    }),
  };
  return store;
}
