/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ROLLING HANDOFF COORDINATOR: a new engine takes over table by table
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner order, Dan, 2026-11-19 12:54 Chicago: "WE NEED TO STOP REQUIRING AN
 * ENGINE CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
 *
 * Today a release drains every table's last hand, freezes the platform, swaps
 * the container and thaws. This module replaces that single global step with
 * one small step per table, taken at that table's own hand boundary:
 *
 *   OLD INSTANCE (yielding)                 NEW INSTANCE (adopting)
 *   1. park the unit after its hand         .
 *   2. prove the boundary is durable        .
 *   3. CAS the lease row to the new         .
 *      instance and a new generation        .
 *   4. retire the local engine, keep        4. see the handed row, claim with
 *      every seat, stack and bank              exactly that generation, start
 *      in the database                         the engine HELD at arrival
 *                                           5. compare the boundary fingerprint
 *                                           6. match: release the hold, settle
 *                                              mismatch or failed start: hand
 *                                              the lease straight back (return)
 *
 * A "unit" is a cash table or a whole tournament (a tournament manager owns
 * all of its tables under one lease, so its tables move together, at a point
 * where every one of them is between hands; the level clock is a durable
 * absolute timestamp and is never frozen or reset by a move).
 *
 * WHAT MAKES A SPLIT HAND IMPOSSIBLE: the CAS in step 3 only runs while the
 * park from step 1 still holds and `boundaryState` says no hand is in the air.
 * The park is a polled next-hand lock; nothing on the old instance can open a
 * hand after it, and the old generation can no longer commit one after the
 * CAS (every hand commit re-checks the exact lease generation in SQL).
 *
 * WHAT IS NEVER DONE: no unit is forced. A unit that does not reach a boundary
 * in time is released and kept by the old instance (`kept`), and the release
 * pipeline asks again later. Nothing here closes a cash game, unseats anyone,
 * moves a chip or touches a seat number.
 *
 * Everything outside this file is a port, so two coordinators over one fake
 * database can prove the protocol in-process
 * (RollingHandoffCoordinator.test.ts), and GameServer supplies the real port
 * only when ENGINE_ROLLING_HANDOFF=on.
 *
 * Design and pipeline wiring: docs/ENGINE-ROLLING-HANDOFF.md.
 */
import { randomUUID } from 'node:crypto';
import type {
  HandedLease,
  HandOffRequest,
  HandOffResult,
  LeaseHandoffStore,
} from './leaseHandoffStore.js';

export type HandoffScope = 'table' | 'tournament';

export interface HandoffUnit {
  readonly scope: HandoffScope;
  readonly key: string;
}

export interface BoundaryFingerprint {
  /** Every occupied seat at the boundary; `tableId` qualifies tournament seats. */
  seats: Array<{ seat: number; userId: string; stack: number; tableId?: string }>;
  /** A tournament's level clock; null for a cash table. */
  clock: { level: number; levelStartedAtMs: number; onBreak: boolean } | null;
}

export type BoundaryState = { atBoundary: true } | { atBoundary: false; reason: string };

/** The engine operations the coordinator needs. GameServer implements them. */
export interface HandoffEnginePort {
  readonly instanceId: string;
  readonly version: string;
  /** Units this instance currently deals. */
  ownedUnits(): HandoffUnit[];
  /** Null when the unit may move now; otherwise why it stays. */
  eligibility(unit: HandoffUnit): string | null;
  leaseGeneration(unit: HandoffUnit): string | null;
  /** Finish the hand in the air, deal no other. Idempotent. */
  parkAtNextBoundary(unit: HandoffUnit): void;
  /** Undo `parkAtNextBoundary` (the unit stays here and deals on). */
  releasePark(unit: HandoffUnit): void;
  boundaryState(unit: HandoffUnit): BoundaryState;
  fingerprint(unit: HandoffUnit): BoundaryFingerprint | null;
  /** Stop the local engine without releasing a lease this instance no longer holds. */
  retireYielded(unit: HandoffUnit): Promise<void>;
  /** Admit with exactly this lease generation; resolve true once ready and held. */
  adopt(unit: HandoffUnit, generation: string): Promise<boolean>;
  /** Let an adopted unit deal. */
  releaseArrivalHold(unit: HandoffUnit): void;
  /**
   * True when an adopted unit is held at arrival until `releaseArrivalHold`,
   * so it can still be handed back without splitting a hand. A unit that
   * starts dealing at once (a tournament manager today) is never handed back
   * after a mismatch: the mismatch is reported and the unit stays.
   */
  holdsArrivalOf(unit: HandoffUnit): boolean;
  /** Work that is not a unit but still keeps the instance alive, or null. */
  activeNonUnitWork(): string | null;
  report?(error: unknown, context: string, extra?: Record<string, unknown>): void;
  onRetired?(summary: RollingHandoffStatus): void;
}

export type YieldState =
  | 'parking'
  | 'transferring'
  | 'yielded'
  | 'kept'
  | 'retire_failed'
  | 'retired_unconfirmed';

export interface UnitYieldRecord {
  unit: HandoffUnit;
  state: YieldState;
  reason: string | null;
  handoffId: string | null;
  startedAtMs: number;
  settledAtMs: number | null;
}

export type AdoptState = 'adopting' | 'adopted' | 'returned' | 'abandoned';

export interface UnitAdoptRecord {
  unit: HandoffUnit;
  handoffId: string;
  kind: 'handoff' | 'return';
  from: string;
  state: AdoptState;
  reason: string | null;
}

export type CoordinatorMode = 'serving' | 'yielding' | 'retired';

export interface RollingHandoffStatus {
  flag: 'on';
  instanceId: string;
  version: string;
  mode: CoordinatorMode;
  successor: string | null;
  owned: number;
  yields: UnitYieldRecord[];
  adoptions: UnitAdoptRecord[];
  blockedRetirement: string | null;
  retiredAtMs: number | null;
}

export interface CoordinatorOptions {
  /** How long one unit may take to reach its boundary before it is kept. */
  boundaryDeadlineMs?: number;
  pollMs?: number;
  adoptPollMs?: number;
  handOffAttempts?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  newGeneration?: () => string;
}

export const DEFAULT_BOUNDARY_DEADLINE_MS = 180_000;
const DEFAULT_POLL_MS = 250;
const DEFAULT_ADOPT_POLL_MS = 1_000;
const DEFAULT_HANDOFF_ATTEMPTS = 3;

export const unitId = (unit: HandoffUnit): string => `${unit.scope}:${unit.key}`;

/**
 * A resumed manager re-derives its in-memory level start from the persisted
 * `level_started_at` and the level duration, so the two sides can differ by
 * rounding, never by a level. One second is far below the shortest level
 * (five minutes) and far above any rounding.
 */
export const LEVEL_CLOCK_TOLERANCE_MS = 1_000;

/** Exact equality of what must survive a move. Order-insensitive on seats. */
export function fingerprintsMatch(
  expected: BoundaryFingerprint | null,
  actual: BoundaryFingerprint | null
): { ok: true } | { ok: false; detail: string } {
  // The old side could not read one: there is nothing to hold the move against.
  if (expected === null) return { ok: true };
  if (actual === null) return { ok: false, detail: 'adopted unit published no fingerprint' };
  const key = (s: BoundaryFingerprint['seats'][number]) => `${s.tableId ?? ''}#${s.seat}`;
  const a = new Map(expected.seats.map((s) => [key(s), s]));
  const b = new Map(actual.seats.map((s) => [key(s), s]));
  if (a.size !== b.size) return { ok: false, detail: `seat count ${a.size} != ${b.size}` };
  for (const [k, s] of a) {
    const t = b.get(k);
    if (!t) return { ok: false, detail: `seat ${k} missing after the move` };
    if (t.userId !== s.userId) return { ok: false, detail: `seat ${k} changed player` };
    if (t.stack !== s.stack)
      return { ok: false, detail: `seat ${k} stack ${s.stack} != ${t.stack}` };
  }
  const c = expected.clock;
  const d = actual.clock;
  if ((c === null) !== (d === null)) return { ok: false, detail: 'clock presence changed' };
  if (c && d) {
    if (c.level !== d.level) return { ok: false, detail: `level ${c.level} != ${d.level}` };
    if (Math.abs(c.levelStartedAtMs - d.levelStartedAtMs) > LEVEL_CLOCK_TOLERANCE_MS)
      return { ok: false, detail: `level clock ${c.levelStartedAtMs} != ${d.levelStartedAtMs}` };
    if (c.onBreak !== d.onBreak) return { ok: false, detail: 'break state changed' };
  }
  return { ok: true };
}

export class RollingHandoffCoordinator {
  private mode: CoordinatorMode = 'serving';
  private successor: string | null = null;
  private readonly yields = new Map<string, UnitYieldRecord>();
  private readonly adoptions = new Map<string, UnitAdoptRecord>();
  /** Units this instance handed back after a failed adoption: never re-admitted here. */
  private readonly returnedAway = new Set<string>();
  /** Units whose lease is being moved away: a lost-lease report would be noise. */
  private readonly transferring = new Set<string>();
  private readonly yieldOps = new Set<Promise<void>>();
  private adoptTimer: ReturnType<typeof setTimeout> | null = null;
  private adoptPassRunning: Promise<void> | null = null;
  private retiredAtMs: number | null = null;
  private yieldRun = 0;
  /** Open moves from or to this instance at the last retirement check. */
  private openHandoffsSeen: number | null = null;

  private readonly boundaryDeadlineMs: number;
  private readonly pollMs: number;
  private readonly adoptPollMs: number;
  private readonly handOffAttempts: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newGeneration: () => string;

  constructor(
    private readonly port: HandoffEnginePort,
    private readonly store: LeaseHandoffStore,
    options: CoordinatorOptions = {}
  ) {
    this.boundaryDeadlineMs = options.boundaryDeadlineMs ?? DEFAULT_BOUNDARY_DEADLINE_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.adoptPollMs = options.adoptPollMs ?? DEFAULT_ADOPT_POLL_MS;
    this.handOffAttempts = Math.max(1, options.handOffAttempts ?? DEFAULT_HANDOFF_ATTEMPTS);
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          const t = setTimeout(resolve, ms);
          (t as { unref?: () => void }).unref?.();
        }));
    this.newGeneration = options.newGeneration ?? (() => randomUUID());
  }

  // ── Guards GameServer reads (all false while serving with nothing in flight) ──

  /** Admission of this unit must not start a dealer here. */
  refusesAdmission(unit: HandoffUnit): boolean {
    const id = unitId(unit);
    if (this.adoptions.get(id)?.state === 'adopting') return false;
    if (this.returnedAway.has(id)) return true;
    return this.mode !== 'serving';
  }

  /** A recovered engine of this unit must not be re-admitted by the cash lane. */
  suppressesReadmission(unit: HandoffUnit): boolean {
    const id = unitId(unit);
    const yielded = this.yields.get(id)?.state;
    return (
      this.transferring.has(id) ||
      yielded === 'yielded' ||
      yielded === 'retired_unconfirmed' ||
      this.adoptions.get(id)?.state === 'adopting' ||
      this.returnedAway.has(id)
    );
  }

  /** A freshly constructed engine of this unit starts held, not dealing. */
  holdsArrival(unit: HandoffUnit): boolean {
    return this.adoptions.get(unitId(unit))?.state === 'adopting';
  }

  /**
   * A handoff successor (ENGINE_ROLE=handoff-successor) admits a unit only
   * while it is adopting it, or to restart a unit it already adopted here.
   * Everything else stays with the serving engine.
   */
  admitsAsSuccessor(unit: HandoffUnit): boolean {
    const state = this.adoptions.get(unitId(unit))?.state;
    return state === 'adopting' || state === 'adopted';
  }

  /** The coordinator's mode, without building a status snapshot. */
  getMode(): CoordinatorMode {
    return this.mode;
  }

  /** The lease of this unit is moving on purpose; its loss is not an incident. */
  isTransferring(unit: HandoffUnit): boolean {
    const id = unitId(unit);
    return this.transferring.has(id) || this.yields.get(id)?.state === 'yielded';
  }

  // ── Yield (old instance) ──────────────────────────────────────────────────

  /**
   * Yield every unit to `successorInstanceId`. Each unit moves at its own
   * boundary, concurrently. Resolves when every unit has settled (yielded or
   * kept). Calling again while yielding re-offers units that were kept.
   */
  async yieldTo(successorInstanceId: string): Promise<RollingHandoffStatus> {
    if (typeof successorInstanceId !== 'string' || successorInstanceId.trim() === '')
      throw new Error('rolling handoff needs a successor instance id');
    if (successorInstanceId === this.port.instanceId)
      throw new Error('an instance cannot hand its tables to itself');
    if (this.mode === 'retired') return this.status();
    if (this.mode === 'yielding' && this.successor !== successorInstanceId)
      throw new Error(`already yielding to ${this.successor}`);
    this.mode = 'yielding';
    this.successor = successorInstanceId;
    const run = ++this.yieldRun;
    const ops: Promise<void>[] = [];
    for (const unit of this.port.ownedUnits()) {
      const id = unitId(unit);
      const prior = this.yields.get(id);
      if (prior && prior.state !== 'kept') continue;
      // A unit that came back from a failed adoption stays here for this run.
      if (this.adoptions.get(id)?.kind === 'return') continue;
      const op = this.yieldUnit(unit, successorInstanceId, run).catch((error) => {
        this.port.report?.(error, 'RollingHandoff.yield_unit_threw', { unit: id });
      });
      ops.push(op);
      this.yieldOps.add(op);
      void op.finally(() => this.yieldOps.delete(op));
    }
    await Promise.all(ops);
    this.yieldOps.clear();
    await this.checkRetirement();
    return this.status();
  }

  /** Stop yielding: every unit still parking deals on here. */
  abortYield(): RollingHandoffStatus {
    if (this.mode !== 'yielding') return this.status();
    this.yieldRun++;
    this.mode = 'serving';
    this.successor = null;
    // A unit already handed on is not this instance's any more (no engine,
    // no lease here). Forget its yield so that, when its lease goes stale
    // after a dead successor and discovery admits it here again, nothing
    // treats it as still moving away.
    for (const [id, record] of this.yields) {
      if (record.state === 'yielded' || record.state === 'retired_unconfirmed')
        this.yields.delete(id);
    }
    return this.status();
  }

  private async yieldUnit(unit: HandoffUnit, successor: string, run: number): Promise<void> {
    const id = unitId(unit);
    const record: UnitYieldRecord = {
      unit,
      state: 'parking',
      reason: null,
      handoffId: null,
      startedAtMs: this.now(),
      settledAtMs: null,
    };
    this.yields.set(id, record);
    const keep = (reason: string, release: boolean): void => {
      if (release) this.port.releasePark(unit);
      record.state = 'kept';
      record.reason = reason;
      record.settledAtMs = this.now();
    };

    const ineligible = this.port.eligibility(unit);
    if (ineligible) return keep(ineligible, false);

    this.port.parkAtNextBoundary(unit);
    const deadline = this.now() + this.boundaryDeadlineMs;
    for (;;) {
      if (run !== this.yieldRun) return keep('yield_aborted', true);
      const boundary = this.port.boundaryState(unit);
      if (boundary.atBoundary) break;
      if (this.now() >= deadline) return keep(`boundary_deadline:${boundary.reason}`, true);
      await this.sleep(this.pollMs);
    }
    if (run !== this.yieldRun) return keep('yield_aborted', true);

    const fromGeneration = this.port.leaseGeneration(unit);
    if (!fromGeneration) return keep('no_verified_lease', true);
    const fingerprint = this.port.fingerprint(unit);
    const request: HandOffRequest = {
      scope: unit.scope,
      leaseKey: unit.key,
      fromInstance: this.port.instanceId,
      fromGeneration,
      toInstance: successor,
      toVersion: 'successor',
      toGeneration: this.newGeneration(),
      fingerprint,
      kind: 'handoff',
      parentId: null,
    };

    record.state = 'transferring';
    this.transferring.add(id);
    const result = await this.handOffWithRetry(request);
    if (result.status === 'refused') {
      this.transferring.delete(id);
      return keep(`handoff_refused:${result.reason}`, true);
    }
    // Transferred, or unknown after every replay. Unknown is NOT a refusal: the
    // CAS may have committed, so the old dealer must not deal on. Retiring it
    // is safe either way: if the row did not move, it goes stale in 30 s and
    // ordinary discovery on the successor admits the table from the database.
    record.handoffId = result.status === 'transferred' ? result.handoffId : null;
    try {
      await this.port.retireYielded(unit);
      record.state = result.status === 'transferred' ? 'yielded' : 'retired_unconfirmed';
      record.reason = result.status === 'transferred' ? null : `handoff_unknown:${result.detail}`;
    } catch (error) {
      record.state = 'retire_failed';
      record.reason = error instanceof Error ? error.message : String(error);
      this.port.report?.(error, 'RollingHandoff.retire_failed', { unit: id });
    } finally {
      record.settledAtMs = this.now();
      this.transferring.delete(id);
    }
  }

  private async handOffWithRetry(request: HandOffRequest): Promise<HandOffResult> {
    let last: HandOffResult = { status: 'unknown', detail: 'not attempted' };
    for (let attempt = 1; attempt <= this.handOffAttempts; attempt++) {
      last = await this.store.handOff(request);
      if (last.status !== 'unknown') return last;
      if (attempt < this.handOffAttempts) await this.sleep(this.pollMs);
    }
    return last;
  }

  // ── Adopt (new instance, and the old one for returns) ────────────────────

  startAdoptionLoop(): void {
    if (this.adoptTimer) return;
    const tick = (): void => {
      this.adoptTimer = setTimeout(() => {
        void this.adoptPass()
          .catch((error) => this.port.report?.(error, 'RollingHandoff.adopt_pass_failed'))
          .finally(() => {
            if (this.adoptTimer) tick();
          });
      }, this.adoptPollMs);
      (this.adoptTimer as { unref?: () => void }).unref?.();
    };
    tick();
  }

  stopAdoptionLoop(): void {
    if (this.adoptTimer) clearTimeout(this.adoptTimer);
    this.adoptTimer = null;
  }

  /** One pass over the handoffs addressed to this instance. Serialized. */
  adoptPass(): Promise<void> {
    if (this.adoptPassRunning) return this.adoptPassRunning;
    const pass = this.performAdoptPass().finally(() => {
      if (this.adoptPassRunning === pass) this.adoptPassRunning = null;
    });
    this.adoptPassRunning = pass;
    return pass;
  }

  private async performAdoptPass(): Promise<void> {
    if (this.mode === 'retired') return;
    const handed = await this.store.handedTo(this.port.instanceId);
    await Promise.all(handed.map((row) => this.adoptOne(row)));
    await this.checkRetirement();
  }

  private async adoptOne(row: HandedLease): Promise<void> {
    const unit: HandoffUnit = { scope: row.scope, key: row.leaseKey };
    const id = unitId(unit);
    const existing = this.adoptions.get(id);
    if (existing && existing.handoffId === row.handoffId) return; // this row is already handled
    const record: UnitAdoptRecord = {
      unit,
      handoffId: row.handoffId,
      kind: row.kind,
      from: row.fromInstance,
      state: 'adopting',
      reason: null,
    };
    this.adoptions.set(id, record);
    this.returnedAway.delete(id);
    // A unit that comes back is this instance's again, whatever it yielded earlier.
    if (row.kind === 'return') this.yields.delete(id);

    let ready = false;
    try {
      ready = await this.port.adopt(unit, row.toGeneration);
    } catch (error) {
      this.port.report?.(error, 'RollingHandoff.adopt_threw', { unit: id });
      ready = false;
    }
    if (ready) {
      const match = fingerprintsMatch(row.fingerprint, this.port.fingerprint(unit));
      if (match.ok) {
        record.state = 'adopted';
        this.port.releaseArrivalHold(unit);
        await this.store.settle(row.handoffId, this.port.instanceId, 'adopted', 'ok');
        return;
      }
      this.port.report?.(
        new Error(`rolling handoff fingerprint mismatch on ${id}: ${match.detail}`),
        'RollingHandoff.fingerprint_mismatch',
        { unit: id, handoffId: row.handoffId }
      );
      if (!this.port.holdsArrivalOf(unit)) {
        // Already dealing here: handing it back now could split a hand. It
        // stays, loudly reported, exactly as a crash-recovered unit would.
        record.state = 'adopted';
        record.reason = `fingerprint_mismatch_reported:${match.detail}`;
        await this.store.settle(row.handoffId, this.port.instanceId, 'adopted', record.reason);
        return;
      }
      return this.giveBack(row, record, `fingerprint_mismatch:${match.detail}`, true);
    }
    return this.giveBack(row, record, 'adoption_failed', false);
  }

  /**
   * A failed adoption goes straight back to the instance that handed it, as a
   * `return` handoff it adopts like any other. A failed RETURN is not bounced
   * again: it is released to ordinary recovery (the lease goes stale or is
   * claimed by discovery), because two instances trading a sick table forever
   * is worse than one crash-recovery.
   */
  private async giveBack(
    row: HandedLease,
    record: UnitAdoptRecord,
    reason: string,
    started: boolean
  ): Promise<void> {
    const unit = record.unit;
    const id = unitId(unit);
    record.reason = reason;
    if (row.kind === 'return') {
      record.state = 'abandoned';
      if (started) this.port.releaseArrivalHold(unit);
      await this.store.settle(row.handoffId, this.port.instanceId, 'abandoned', reason);
      return;
    }
    this.transferring.add(id);
    if (started) {
      try {
        await this.port.retireYielded(unit);
      } catch (error) {
        this.port.report?.(error, 'RollingHandoff.return_retire_failed', { unit: id });
      }
    }
    const result = await this.handOffWithRetry({
      scope: unit.scope,
      leaseKey: unit.key,
      fromInstance: this.port.instanceId,
      fromGeneration: row.toGeneration,
      toInstance: row.fromInstance,
      toVersion: 'return',
      toGeneration: this.newGeneration(),
      fingerprint: row.fingerprint,
      kind: 'return',
      parentId: row.handoffId,
    });
    this.transferring.delete(id);
    record.state = 'returned';
    this.returnedAway.add(id);
    if (result.status !== 'transferred') {
      record.reason = `${reason}; return ${result.status}:${
        result.status === 'refused' ? result.reason : result.detail
      }`;
      this.port.report?.(
        new Error(`rolling handoff could not return ${id}: ${record.reason}`),
        'RollingHandoff.return_unconfirmed',
        { unit: id, handoffId: row.handoffId }
      );
    }
  }

  // ── Retirement ────────────────────────────────────────────────────────────

  /**
   * The old instance retires only when it deals nothing AND every move it made
   * has been adopted (or has come back and been adopted here). Until then a
   * failed adoption may still return a unit to it, so it must keep listening.
   */
  private localRetirementBlocker(): string | null {
    if (this.mode !== 'yielding') return 'not_yielding';
    if (this.yieldOps.size > 0) return 'yields_in_flight';
    const owned = this.port.ownedUnits().length;
    if (owned > 0) return `owns_units:${owned}`;
    if ([...this.adoptions.values()].some((a) => a.state === 'adopting'))
      return 'adoptions_in_flight';
    return this.port.activeNonUnitWork();
  }

  private async checkRetirement(): Promise<void> {
    if (this.localRetirementBlocker() !== null) return;
    let open: number;
    try {
      open = await this.store.openHandoffs(this.port.instanceId);
    } catch (error) {
      this.port.report?.(error, 'RollingHandoff.open_handoffs_unreadable');
      return; // "could not tell" never retires
    }
    this.openHandoffsSeen = open;
    if (open > 0) return;
    if (this.localRetirementBlocker() !== null) return; // something arrived while we asked
    this.mode = 'retired';
    this.retiredAtMs = this.now();
    this.stopAdoptionLoop();
    try {
      this.port.onRetired?.(this.status());
    } catch (error) {
      this.port.report?.(error, 'RollingHandoff.on_retired_threw');
    }
  }

  /** Re-evaluate retirement (GameServer calls this after any unit leaves). */
  noteUnitLeft(): void {
    void this.checkRetirement();
  }

  status(): RollingHandoffStatus {
    let blocked: string | null = null;
    if (this.mode === 'yielding') {
      blocked =
        this.localRetirementBlocker() ??
        (this.openHandoffsSeen === null || this.openHandoffsSeen > 0
          ? `handoffs_open:${this.openHandoffsSeen ?? 'unknown'}`
          : null);
    }
    return {
      flag: 'on',
      instanceId: this.port.instanceId,
      version: this.port.version,
      mode: this.mode,
      successor: this.successor,
      owned: this.port.ownedUnits().length,
      yields: [...this.yields.values()].map((r) => ({ ...r })),
      adoptions: [...this.adoptions.values()].map((r) => ({ ...r })),
      blockedRetirement: blocked,
      retiredAtMs: this.retiredAtMs,
    };
  }
}
