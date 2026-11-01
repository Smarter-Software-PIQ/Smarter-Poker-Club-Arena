/**
 * ENGINE MEMORY GOVERNOR (Phase 6, 2026-10-31)
 *
 * Production evidence, 2026-10-31: engine eed06fe5 restarted nine times
 * outside a break in 24 hours with /health rssMb 5821 (anon 5702) and
 * heapUsed 769 MB. EngineProcessMemoryHigh fired 10x and
 * EngineCoreOutOfHeadroom 12x, and nothing acted on either. A process that is
 * SIGKILLed loses its in-flight hands and its lease hand-off; a process that
 * sees the ceiling coming can stop growing and hand off on purpose.
 *
 * Two ceilings, measured on whole-process RSS (every isolate, every arena):
 *
 *  - SOFT: stop admitting NEW cash tables (running tables and tournaments are
 *    untouched) and shrink the Horse decision journal archive ring to a
 *    bounded pressure retention, so the writer retires its oldest published
 *    segments instead of growing. Lifted with hysteresis once RSS falls back
 *    below SOFT_RELEASE_RATIO of the soft ceiling.
 *  - HARD: request ONE controlled drain + leader hand-off through the
 *    leadership module's authoritative shutdown (the same path SIGTERM and a
 *    lost lease take: GameServer.stop() releases every lease, then the
 *    supervisor / standby takes over), instead of waiting to be SIGKILLed.
 *    Requires HARD_CONSECUTIVE_SAMPLES samples in a row so one transient
 *    spike cannot hand off a healthy leader.
 *
 * Ceilings:
 *  - MEMORY_LIMIT_MB set (the container/host budget for this process):
 *    soft = 80% of it, hard = 95% of it.
 *  - unset: soft = 6144 MB, hard = 8192 MB (the EngineProcessMemoryHigh
 *    warning line, which sits above the 4.85-6.82 GiB hourly band measured
 *    2026-10-17/19, so "a firing means growth again").
 *  MEMORY_SOFT_CEILING_MB / MEMORY_HARD_CEILING_MB override either directly.
 *
 * MODE (2026-10-31 safety review, before first deploy). Production RSS was
 * 8.85-9.49 GB in steady state on eed06fe5, i.e. ABOVE the 8192 MB fallback
 * hard line, and there is one engine instance: a "hand-off" there is a
 * process exit that the supervisor answers with a cold boot (~72 s to dealer
 * ready, every table re-adopted), not a warm standby taking over. Enforcing
 * on first deploy would therefore turn steady-state memory into a restart
 * loop, and the soft hold would also refuse to re-adopt seated tables after
 * each boot. So nothing acts until an operator opts in:
 *
 *  - MEMORY_GOVERNOR_MODE=observe (DEFAULT, and any unrecognised value):
 *    sample, classify, publish on /health and report the first hard crossing
 *    per process as an alert. Never holds a table, never trims the journal,
 *    never hands off.
 *  - MEMORY_GOVERNOR_MODE=enforce: the soft ceiling holds new tables and
 *    bounds the journal ring. The hard ceiling still only ALERTS unless
 *    MEMORY_GOVERNOR_HARD_ACTION=handoff is also set, and even then never
 *    within MEMORY_GOVERNOR_HANDOFF_MIN_UPTIME_S (default 3600 s) of process
 *    start, so a mis-set ceiling below boot RSS cannot loop faster than that.
 *  - MEMORY_GOVERNOR_MODE=off: no sampling at all.
 *
 * The threshold logic below is pure; the runtime singleton only samples and
 * dispatches.
 */

export const MEMORY_GOVERNOR_FALLBACK_SOFT_MB = 6144;
export const MEMORY_GOVERNOR_FALLBACK_HARD_MB = 8192;
export const MEMORY_GOVERNOR_SOFT_RATIO = 0.8;
export const MEMORY_GOVERNOR_HARD_RATIO = 0.95;
/** Soft pressure lifts only once RSS is below this share of the soft ceiling. */
export const MEMORY_GOVERNOR_SOFT_RELEASE_RATIO = 0.95;
export const MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES = 3;
export const MEMORY_GOVERNOR_SAMPLE_MS = 10_000;
/** Under pressure the journal ring keeps this share of its segment allocation. */
export const JOURNAL_PRESSURE_RETENTION_SHARE = 4;
/** ...but never fewer than this many segments of new capture beyond the hold. */
export const JOURNAL_PRESSURE_MIN_RING_SEGMENTS = 50_000;

export type MemoryPressureLevel = 'normal' | 'soft' | 'hard';
export type MemoryGovernorMode = 'off' | 'observe' | 'enforce';
export type MemoryGovernorHardAction = 'alert' | 'handoff';
export const MEMORY_GOVERNOR_DEFAULT_HANDOFF_MIN_UPTIME_S = 3600;

export interface MemoryGovernorPolicy {
  mode: MemoryGovernorMode;
  /** What the hard ceiling does in enforce mode; observe/off never act. */
  hardAction: MemoryGovernorHardAction;
  /** No hand-off before the process has been up this long. */
  handOffMinUptimeS: number;
}

/**
 * The operator's opt-in. Observe-only unless MEMORY_GOVERNOR_MODE=enforce is
 * set exactly; hand-off only with MEMORY_GOVERNOR_HARD_ACTION=handoff too.
 */
export function memoryGovernorPolicy(
  env: Record<string, string | undefined> = process.env
): MemoryGovernorPolicy {
  const rawMode = (env.MEMORY_GOVERNOR_MODE ?? '').trim().toLowerCase();
  const mode: MemoryGovernorMode =
    rawMode === 'enforce' ? 'enforce' : rawMode === 'off' ? 'off' : 'observe';
  const hardAction: MemoryGovernorHardAction =
    mode === 'enforce' && (env.MEMORY_GOVERNOR_HARD_ACTION ?? '').trim().toLowerCase() === 'handoff'
      ? 'handoff'
      : 'alert';
  const rawUptime = env.MEMORY_GOVERNOR_HANDOFF_MIN_UPTIME_S;
  const parsedUptime =
    rawUptime !== undefined && /^[0-9]+$/.test(rawUptime.trim()) ? Number(rawUptime.trim()) : null;
  const handOffMinUptimeS =
    parsedUptime !== null && Number.isSafeInteger(parsedUptime)
      ? parsedUptime
      : MEMORY_GOVERNOR_DEFAULT_HANDOFF_MIN_UPTIME_S;
  return { mode, hardAction, handOffMinUptimeS };
}

/** Whether a journal writer may bound its ring: only an enforcing governor. */
export function journalPressureTrimEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return memoryGovernorPolicy(env).mode === 'enforce';
}

export interface MemoryGovernorThresholds {
  limitMb: number | null;
  softMb: number;
  hardMb: number;
  source: 'memory_limit_env' | 'fallback' | 'explicit';
}

function positiveMb(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  if (!/^[1-9][0-9]*$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) ? n : null;
}

export function memoryGovernorThresholds(
  env: Record<string, string | undefined> = process.env
): MemoryGovernorThresholds {
  const limitMb = positiveMb(env.MEMORY_LIMIT_MB);
  let softMb = limitMb
    ? Math.floor(limitMb * MEMORY_GOVERNOR_SOFT_RATIO)
    : MEMORY_GOVERNOR_FALLBACK_SOFT_MB;
  let hardMb = limitMb
    ? Math.floor(limitMb * MEMORY_GOVERNOR_HARD_RATIO)
    : MEMORY_GOVERNOR_FALLBACK_HARD_MB;
  let source: MemoryGovernorThresholds['source'] = limitMb ? 'memory_limit_env' : 'fallback';
  const softOverride = positiveMb(env.MEMORY_SOFT_CEILING_MB);
  const hardOverride = positiveMb(env.MEMORY_HARD_CEILING_MB);
  if (softOverride) {
    softMb = softOverride;
    source = 'explicit';
  }
  if (hardOverride) {
    hardMb = hardOverride;
    source = 'explicit';
  }
  // A hard ceiling at or below the soft one would hand off before ever
  // shedding load: the hard line always sits above the soft one.
  if (hardMb <= softMb) hardMb = softMb + 1;
  return { limitMb, softMb, hardMb, source };
}

/** Stateless level of one sample: what a worker thread can ask on its own. */
export function memoryPressureLevel(
  rssMb: number,
  thresholds: MemoryGovernorThresholds
): MemoryPressureLevel {
  if (!Number.isFinite(rssMb) || rssMb < 0) return 'normal';
  if (rssMb >= thresholds.hardMb) return 'hard';
  if (rssMb >= thresholds.softMb) return 'soft';
  return 'normal';
}

/**
 * The journal ring's segment bound while memory is under pressure, or null
 * when the configured allocation applies. Never below the evidence hold plus
 * a working ring, so pressure shrinks new capture and never the held window.
 */
export function journalPressureRetentionSegments(
  level: MemoryPressureLevel,
  maxSegments: number,
  heldSegments: number
): number | null {
  if (level === 'normal') return null;
  const share = Math.floor(maxSegments / JOURNAL_PRESSURE_RETENTION_SHARE);
  const floor = Math.max(0, heldSegments) + JOURNAL_PRESSURE_MIN_RING_SEGMENTS;
  return Math.min(maxSegments, Math.max(share, floor));
}

export interface MemoryGovernorState {
  level: MemoryPressureLevel;
  /** Consecutive samples at or above the hard ceiling. */
  hardStreak: number;
  handOffRequested: boolean;
}

export interface MemoryGovernorDecision {
  state: MemoryGovernorState;
  admitNewTables: boolean;
  trimJournal: boolean;
  /** True exactly once: on the sample that crosses the hard streak. */
  requestHandOff: boolean;
}

export const INITIAL_MEMORY_GOVERNOR_STATE: MemoryGovernorState = Object.freeze({
  level: 'normal',
  hardStreak: 0,
  handOffRequested: false,
});

/** One governor step: pure, with soft hysteresis and a hard streak. */
export function stepMemoryGovernor(
  previous: MemoryGovernorState,
  rssMb: number,
  thresholds: MemoryGovernorThresholds
): MemoryGovernorDecision {
  const raw = memoryPressureLevel(rssMb, thresholds);
  let level: MemoryPressureLevel = raw;
  // Hysteresis: once under pressure, stay there until RSS is clearly below.
  if (
    raw === 'normal' &&
    previous.level !== 'normal' &&
    rssMb >= thresholds.softMb * MEMORY_GOVERNOR_SOFT_RELEASE_RATIO
  )
    level = 'soft';
  const hardStreak = raw === 'hard' ? previous.hardStreak + 1 : 0;
  const requestHandOff =
    !previous.handOffRequested && hardStreak >= MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES;
  return {
    state: {
      level,
      hardStreak,
      handOffRequested: previous.handOffRequested || requestHandOff,
    },
    admitNewTables: level === 'normal',
    trimJournal: level !== 'normal',
    requestHandOff,
  };
}

export interface MemoryGovernorHealth {
  /** off | observe | enforce: observe classifies and alerts, never acts. */
  mode: MemoryGovernorMode;
  /** alert | handoff: what the hard ceiling does when enforcing. */
  hardAction: MemoryGovernorHardAction;
  level: MemoryPressureLevel;
  admittingNewTables: boolean;
  journalTrimRequested: boolean;
  /** True once a hand-off was actually requested (enforce + handoff only). */
  handOffRequested: boolean;
  /** True once the hard streak was reached, whether or not it acted. */
  hardCeilingReached: boolean;
  /** Hard streaks reached but not acted on (observe, alert, uptime guard). */
  handOffsWithheld: number;
  hardStreak: number;
  rssMb: number | null;
  softCeilingMb: number;
  hardCeilingMb: number;
  limitMb: number | null;
  thresholdSource: MemoryGovernorThresholds['source'];
  handOffMinUptimeS: number;
  lastSampleAt: string | null;
  /** When the current non-normal episode began, or null. */
  pressureSince: string | null;
  softEpisodes: number;
}

/**
 * Runtime holder. GameServer starts it on the leader; the cash admission
 * paths read admitsNewTables(); the hand-off callback is the leadership
 * module's authoritative shutdown. Only MEMORY_GOVERNOR_MODE=enforce lets it
 * act (see the MODE note at the top of this file).
 */
export class MemoryGovernor {
  private state: MemoryGovernorState = { ...INITIAL_MEMORY_GOVERNOR_STATE };
  private thresholds: MemoryGovernorThresholds;
  private readonly policy: MemoryGovernorPolicy;
  private lastRssMb: number | null = null;
  private lastSampleAt: number | null = null;
  private pressureSince: number | null = null;
  private softEpisodes = 0;
  private handOffRequested = false;
  private hardCeilingReached = false;
  private handOffsWithheld = 0;
  private uptimeGuardAlerted = false;
  private readonly startedAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: {
      sampleRssBytes: () => number;
      onHandOff: (reason: string) => void;
      /** The hard ceiling was reached and NOT acted on (detection only). */
      onHardCeilingWithheld?: (reason: string) => void;
      onPressureChange?: (level: MemoryPressureLevel, rssMb: number, enforcing: boolean) => void;
      env?: Record<string, string | undefined>;
      now?: () => number;
      /** Process start (ms epoch) for the hand-off uptime guard. */
      processStartedAt?: number;
    }
  ) {
    const env = options.env ?? process.env;
    this.thresholds = memoryGovernorThresholds(env);
    this.policy = memoryGovernorPolicy(env);
    this.startedAt = options.processStartedAt ?? (options.now ?? Date.now)();
  }

  private get enforcing(): boolean {
    return this.policy.mode === 'enforce';
  }

  sample(): MemoryGovernorDecision {
    const now = (this.options.now ?? Date.now)();
    let rssMb: number;
    try {
      rssMb = this.options.sampleRssBytes() / 1e6;
    } catch {
      rssMb = Number.NaN;
    }
    const decision = stepMemoryGovernor(this.state, rssMb, this.thresholds);
    const before = this.state.level;
    this.state = decision.state;
    this.lastRssMb = Number.isFinite(rssMb) ? Math.round(rssMb) : null;
    this.lastSampleAt = now;
    if (before === 'normal' && decision.state.level !== 'normal') {
      this.pressureSince = now;
      this.softEpisodes++;
    } else if (decision.state.level === 'normal') {
      this.pressureSince = null;
    }
    if (before !== decision.state.level)
      this.options.onPressureChange?.(decision.state.level, this.lastRssMb ?? -1, this.enforcing);
    let requestHandOff = false;
    if (decision.requestHandOff) {
      this.hardCeilingReached = true;
      const reason =
        `memory hard ceiling: rss ${this.lastRssMb} MB >= ${this.thresholds.hardMb} MB for ` +
        `${MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES} samples`;
      const uptimeS = (now - this.startedAt) / 1000;
      if (!this.enforcing || this.policy.hardAction !== 'handoff') {
        this.handOffsWithheld++;
        this.options.onHardCeilingWithheld?.(
          `${reason}; mode=${this.policy.mode} hardAction=${this.policy.hardAction}: not acting`
        );
      } else if (uptimeS < this.policy.handOffMinUptimeS) {
        // Withheld, and the latch is re-armed so the next sustained streak
        // after the guard expires can still act.
        // Alerted once per process, not every streak.
        this.handOffsWithheld++;
        this.state = { ...this.state, handOffRequested: false, hardStreak: 0 };
        if (!this.uptimeGuardAlerted) {
          this.uptimeGuardAlerted = true;
          this.options.onHardCeilingWithheld?.(
            `${reason}; uptime ${Math.floor(uptimeS)} s < ${this.policy.handOffMinUptimeS} s guard: not acting`
          );
        }
      } else {
        requestHandOff = true;
        this.handOffRequested = true;
        this.options.onHandOff(reason);
      }
    }
    return {
      state: this.state,
      admitNewTables: this.enforcing ? decision.admitNewTables : true,
      trimJournal: this.enforcing ? decision.trimJournal : false,
      requestHandOff,
    };
  }

  admitsNewTables(): boolean {
    return !this.enforcing || this.state.level === 'normal';
  }

  start(intervalMs = MEMORY_GOVERNOR_SAMPLE_MS): void {
    if (this.timer || this.policy.mode === 'off') return;
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  health(): MemoryGovernorHealth {
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    return {
      mode: this.policy.mode,
      hardAction: this.policy.hardAction,
      level: this.state.level,
      admittingNewTables: this.admitsNewTables(),
      journalTrimRequested: this.enforcing && this.state.level !== 'normal',
      handOffRequested: this.handOffRequested,
      hardCeilingReached: this.hardCeilingReached,
      handOffsWithheld: this.handOffsWithheld,
      hardStreak: this.state.hardStreak,
      rssMb: this.lastRssMb,
      softCeilingMb: this.thresholds.softMb,
      hardCeilingMb: this.thresholds.hardMb,
      limitMb: this.thresholds.limitMb,
      thresholdSource: this.thresholds.source,
      handOffMinUptimeS: this.policy.handOffMinUptimeS,
      lastSampleAt: iso(this.lastSampleAt),
      pressureSince: iso(this.pressureSince),
      softEpisodes: this.softEpisodes,
    };
  }
}
