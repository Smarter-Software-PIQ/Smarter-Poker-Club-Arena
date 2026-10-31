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
  level: MemoryPressureLevel;
  admittingNewTables: boolean;
  journalTrimRequested: boolean;
  handOffRequested: boolean;
  hardStreak: number;
  rssMb: number | null;
  softCeilingMb: number;
  hardCeilingMb: number;
  limitMb: number | null;
  thresholdSource: MemoryGovernorThresholds['source'];
  lastSampleAt: string | null;
  /** When the current non-normal episode began, or null. */
  pressureSince: string | null;
  softEpisodes: number;
}

/**
 * Runtime holder. GameServer starts it on the leader; the cash admission
 * paths read admitsNewTables(); the hand-off callback is the leadership
 * module's authoritative shutdown.
 */
export class MemoryGovernor {
  private state: MemoryGovernorState = { ...INITIAL_MEMORY_GOVERNOR_STATE };
  private thresholds: MemoryGovernorThresholds;
  private lastRssMb: number | null = null;
  private lastSampleAt: number | null = null;
  private pressureSince: number | null = null;
  private softEpisodes = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: {
      sampleRssBytes: () => number;
      onHandOff: (reason: string) => void;
      onPressureChange?: (level: MemoryPressureLevel, rssMb: number) => void;
      env?: Record<string, string | undefined>;
      now?: () => number;
    }
  ) {
    this.thresholds = memoryGovernorThresholds(options.env ?? process.env);
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
      this.options.onPressureChange?.(decision.state.level, this.lastRssMb ?? -1);
    if (decision.requestHandOff)
      this.options.onHandOff(
        `memory hard ceiling: rss ${this.lastRssMb} MB >= ${this.thresholds.hardMb} MB for ` +
          `${MEMORY_GOVERNOR_HARD_CONSECUTIVE_SAMPLES} samples`
      );
    return decision;
  }

  admitsNewTables(): boolean {
    return this.state.level === 'normal';
  }

  start(intervalMs = MEMORY_GOVERNOR_SAMPLE_MS): void {
    if (this.timer) return;
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
      level: this.state.level,
      admittingNewTables: this.admitsNewTables(),
      journalTrimRequested: this.state.level !== 'normal',
      handOffRequested: this.state.handOffRequested,
      hardStreak: this.state.hardStreak,
      rssMb: this.lastRssMb,
      softCeilingMb: this.thresholds.softMb,
      hardCeilingMb: this.thresholds.hardMb,
      limitMb: this.thresholds.limitMb,
      thresholdSource: this.thresholds.source,
      lastSampleAt: iso(this.lastSampleAt),
      pressureSince: iso(this.pressureSince),
      softEpisodes: this.softEpisodes,
    };
  }
}
