/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIGHTNING POOL VPIP FLOOR JUDGE (25% floor / 30-hand rolling / 10 grace)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Previously, while a Lightning pool was live, nothing enforced the VPIP floor
 * on anyone (human or Horse): fn_nit_enforce ran only inside a physical table's
 * dealing loop, while parked Lightning anchors ran the sit-out clock alone
 * (ServerTableEngineDealing.standUpExpiredLightningSitOuts, sitOutOnly: true).
 *
 * This module is the real Lightning pool VPIP judge:
 *   - Default contract: 25% VPIP floor (read from the host table's configured
 *     maintain_percent_min when nit_game is enabled), 30-hand rolling window,
 *     10-hand grace (both minimum sample before first warning AND recovery
 *     grace after warning before eviction).
 *   - HORSES ARE PLAYERS (CLAUDE.md 10.5): applies identically to human
 *     players and Horses seated in the Lightning pool. This file reads no
 *     horse identity anywhere.
 *   - REAL COMMITTED PARTICIPATION: counts only committed settled hands where
 *     the participant had a voluntary preflop action opportunity (excluding
 *     walks and forced-only blind/ante postings). A voluntary preflop call,
 *     bet, raise or all-in counts as VPIP; a preflop fold or big blind check
 *     counts as an eligible hand not voluntarily entered.
 *   - WARN BEFORE BOOT: first lapse at >= graceHands emits a warning and costs
 *     no seat. Recovering to >= floorPct clears the warning cleanly. Only when
 *     graceHands additional eligible hands elapse while still below the floor
 *     does the judge request a between-hands eviction through the registered
 *     anchor seat eviction door (services/LightningPoolVpipDoor.ts).
 *   - CLEAN RESETS: keyed by poolSessionId so leaving and rejoining starts a
 *     fresh sample, and resetCluster(clusterId) clears the pool cleanly when
 *     Lightning switches off, drains, stops, or restarts (harmonious with
 *     fn_nit_sitting_since resetting on Lightning switch-off).
 *   - NO DIRECT DB OR SEAT WRITES HERE: obeys ALightningHandsCardsAndMoneyStay
 *     WithTheirOwners (no table_seats, wallet, or money RPCs in src/lightning).
 *   - NO CRON, WATCHER, OR REPAIR LOOP (CLAUDE.md 10.12): driven exclusively
 *     by committed hand boundaries.
 */

/** Default VPIP floor percentage when no explicit table override is provided. */
export const LIGHTNING_POOL_VPIP_DEFAULT_FLOOR_PCT = 25;
/** Default rolling window size in eligible hands. */
export const LIGHTNING_POOL_VPIP_DEFAULT_WINDOW_HANDS = 30;
/** Default grace hands (both minimum sample before warning and recovery grace after warning). */
export const LIGHTNING_POOL_VPIP_DEFAULT_GRACE_HANDS = 10;
/** Bounded LRU capacity of tracked pool sessions (memory guard, not a gameplay rule). */
export const LIGHTNING_POOL_VPIP_MAX_SESSIONS = 20_000;
/** Bounded failed eviction attempts per pool session to prevent retry storms. */
export const LIGHTNING_POOL_VPIP_MAX_EVICT_ATTEMPTS = 3;
/** An eviction ask unanswered after this long is abandoned; late answers are ignored. */
export const LIGHTNING_POOL_VPIP_EVICT_STALE_MS = 30_000;

export interface LightningPoolVpipPolicy {
  /** Required minimum VPIP percentage (1..100). */
  floorPct: number;
  /** Rolling window size in eligible hands (default 30). */
  windowHands: number;
  /** Minimum eligible hands before judging AND recovery grace hands after warning (default 10). */
  graceHands: number;
}

export const DEFAULT_LIGHTNING_POOL_VPIP_POLICY: Readonly<LightningPoolVpipPolicy> = Object.freeze({
  floorPct: LIGHTNING_POOL_VPIP_DEFAULT_FLOOR_PCT,
  windowHands: LIGHTNING_POOL_VPIP_DEFAULT_WINDOW_HANDS,
  graceHands: LIGHTNING_POOL_VPIP_DEFAULT_GRACE_HANDS,
});

export interface LightningPreflopParticipation {
  /** True when the player had a voluntary preflop action opportunity (excludes walks and forced-only blinds). */
  hadOpportunity: boolean;
  /** True when the player voluntarily put chips into the pot preflop (call, bet, raise, all_in). */
  entered: boolean;
}

export type LightningPoolVpipVerdictKind =
  | 'disabled'
  | 'skipped'
  | 'duplicate'
  | 'grace'
  | 'ok'
  | 'recovered'
  | 'warn'
  | 'evict';

export interface LightningPoolVpipStatus {
  clusterId: string;
  poolSessionId: string;
  playerId: string;
  /** Eligible hands currently inside the rolling window (0..windowHands). */
  hands: number;
  /** Voluntarily entered hands currently inside the rolling window. */
  vpipHands: number;
  /** Total eligible hands recorded on this pool sitting. */
  totalEligibleHands: number;
  /** Current rolling VPIP percentage rounded to 1 decimal place, or null if hands === 0. */
  vpipPct: number | null;
  /** Required floor percentage. */
  requiredPct: number;
  /** Rolling window size in eligible hands. */
  windowHands: number;
  /** Configured grace hands. */
  graceHands: number;
  /** True while a warning is open on this sitting. */
  warned: boolean;
  /** Eligible hands remaining to recover before eviction, or null when not warned. */
  graceRemaining: number | null;
  /** True once eviction is due (grace exhausted while below floor). */
  evictPending: boolean;
  /** True once the anchor eviction door confirmed eviction. */
  evicted: boolean;
}

export interface LightningPoolVpipHandEvaluation extends LightningPoolVpipStatus {
  verdict: LightningPoolVpipVerdictKind;
  /** True on the exact hand that opened a new warning (first lapse). */
  warningOpened: boolean;
}

export interface LightningPoolVpipHandInput {
  clusterId: string;
  poolSessionId: string;
  playerId: string;
  handNumber: number | null;
  hadOpportunity: boolean;
  entered: boolean;
  policy: LightningPoolVpipPolicy | null;
}

export type LightningPoolVpipEvictOutcome =
  /** Anchor seat cashed out cleanly with leaveMode 'vpip_evicted'. */
  | 'evicted'
  /** Player is currently in a live Lightning hand or platform frozen; retry on next boundary. */
  | 'deferred'
  /** Seat/session already vacated or replaced; stop asking. */
  | 'not_seated'
  /** Transient refusal or failure; seat and chips preserved, bounded retry on next boundary. */
  | 'failed'
  /** No eviction door handler registered (e.g. standby or isolated unit test). */
  | 'no_handler'
  /** Another eviction ask is already in flight for this pool session. */
  | 'in_flight'
  /** Session already evicted or reached MAX_EVICT_ATTEMPTS. */
  | 'exhausted';

export interface LightningPoolVpipEvictRequest {
  clusterId: string;
  hostTableId: string;
  poolSessionId: string;
  playerId: string;
  vpip: number;
  required: number;
  hands: number;
  windowHands: number;
  graceHands: number;
}

export type LightningPoolVpipEvictHandler = (
  req: LightningPoolVpipEvictRequest
) => Promise<
  Extract<LightningPoolVpipEvictOutcome, 'evicted' | 'deferred' | 'not_seated' | 'failed'>
>;

export interface LightningPoolVpipJudgeOptions {
  /** Override feature gate (defaults to isLightningPoolVpipJudgeEnabled). */
  enabled?: () => boolean;
  /** Bounded session capacity (default LIGHTNING_POOL_VPIP_MAX_SESSIONS). */
  maxSessions?: number;
  /** Clock function in epoch ms (default Date.now). */
  now?: () => number;
  /** Optional per-instance eviction handler (defaults to the registered leader door). */
  evictHandler?: LightningPoolVpipEvictHandler | null;
}

const VOLUNTARY_PREFLOP_ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const VPIP_ENTERED_ACTIONS = new Set(['call', 'bet', 'raise', 'all_in']);

/**
 * Feature contract gate for the Lightning Pool VPIP Floor Judge.
 * Enabled by default; setting LIGHTNING_POOL_VPIP_JUDGE=false cleanly disables enforcement.
 */
export function isLightningPoolVpipJudgeEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.LIGHTNING_POOL_VPIP_JUDGE !== 'false';
}

/**
 * Classify a participant's preflop participation in one committed hand. Pure.
 *
 * - Excludes walks (everyone folds to the BB before BB makes any voluntary action)
 *   and forced-only blind/ante postings (e.g. forced all-in in the blind).
 * - Counts voluntary preflop actions: fold/check (opportunity, not entered) vs
 *   call/bet/raise/all_in (opportunity, entered).
 * - Ignores uncalled bet returns and postflop actions.
 */
export function classifyLightningPreflopParticipation(
  userId: string,
  actions: ReadonlyArray<Record<string, unknown>>
): LightningPreflopParticipation {
  if (!userId || !Array.isArray(actions)) return { hadOpportunity: false, entered: false };
  let hadOpportunity = false;
  let entered = false;
  for (const a of actions) {
    if (!a || a.userId !== userId || a.stage !== 'preflop') continue;
    if (a.dead === true) continue;
    const action = String(a.action ?? '');
    if (!VOLUNTARY_PREFLOP_ACTIONS.has(action)) continue;
    // A timeout fold/check is recorded with origin: 'forced' (LightningHandHost.timeoutAct),
    // but the player still had a real preflop action opportunity and cannot dodge the VPIP
    // floor by letting the clock expire. Forced chip postings (sb/bb/ante/straddle) never
    // carry fold/check/call/bet/raise/all_in, and forced wagers never count as voluntary entry.
    if (a.origin === 'forced') {
      if (action === 'fold' || action === 'check') hadOpportunity = true;
      continue;
    }
    hadOpportunity = true;
    if (VPIP_ENTERED_ACTIONS.has(action)) {
      entered = true;
      break;
    }
  }
  return { hadOpportunity, entered };
}

/**
 * Resolve the pool VPIP floor policy from the host table's rules (and optional overrides).
 * Returns null when the host table does not run a VPIP floor (nit_game !== true or floor <= 0).
 * Reads the floor dynamically from tables.maintain_percent_min so the table/template remains
 * the single source of truth for the floor percentage, while applying the Lightning pool's
 * 30-hand rolling window and 10-hand grace (overridable via pool rules). Pure.
 */
export function resolveLightningPoolVpipPolicy(
  rules: Record<string, unknown> | null | undefined,
  overrides?: Partial<LightningPoolVpipPolicy>
): LightningPoolVpipPolicy | null {
  if (!rules || rules.nit_game !== true) return null;
  const rawFloor =
    overrides?.floorPct !== undefined ? overrides.floorPct : Number(rules.maintain_percent_min);
  if (!Number.isFinite(rawFloor) || !(rawFloor > 0)) return null;
  const floorPct = Math.min(100, rawFloor);

  const snapshot =
    rules.ruleset_snapshot &&
    typeof rules.ruleset_snapshot === 'object' &&
    !Array.isArray(rules.ruleset_snapshot)
      ? (rules.ruleset_snapshot as Record<string, unknown>)
      : undefined;

  const rawWindow =
    overrides?.windowHands ?? rules.lightning_vpip_window ?? snapshot?.lightning_vpip_window;
  const parsedWindow = Number(rawWindow);
  const windowHands =
    Number.isInteger(parsedWindow) && parsedWindow >= 1
      ? Math.min(200, parsedWindow)
      : LIGHTNING_POOL_VPIP_DEFAULT_WINDOW_HANDS;

  const rawGrace =
    overrides?.graceHands ??
    rules.lightning_vpip_grace_hands ??
    snapshot?.lightning_vpip_grace_hands;
  const parsedGrace = Number(rawGrace);
  const graceHands =
    Number.isInteger(parsedGrace) && parsedGrace >= 1
      ? Math.min(100, parsedGrace)
      : LIGHTNING_POOL_VPIP_DEFAULT_GRACE_HANDS;

  return { floorPct, windowHands, graceHands };
}

interface SessionState {
  clusterId: string;
  poolSessionId: string;
  playerId: string;
  /** Eligible hands in deal order (ascending handNumber; null filed last), capped at windowHands. */
  recent: Array<{ handNumber: number | null; entered: boolean }>;
  /** Recently recorded hand numbers to deduplicate replayed settlements. */
  seenHands: Set<number>;
  totalEligibleHands: number;
  warnedAtEligibleHands: number | null;
  evictPending: boolean;
  evicted: boolean;
  evictAttempts: number;
  evictToken: number;
  evictAskedAtMs: number | null;
}

let registeredEvictHandler: LightningPoolVpipEvictHandler | null = null;

/** Register or clear the leader-owned anchor eviction door (server/src/index.ts). */
export function onLightningPoolVpipEvict(handler: LightningPoolVpipEvictHandler | null): void {
  registeredEvictHandler = handler;
}

function roundVpipPct(vpipHands: number, hands: number): number | null {
  if (hands <= 0) return null;
  return Math.round((vpipHands * 1000) / hands) / 10;
}

function isBelowFloorExact(vpipHands: number, hands: number, floorPct: number): boolean {
  if (hands <= 0) return false;
  return vpipHands * 100 < floorPct * hands;
}

export class LightningPoolVpipJudge {
  private readonly sessions = new Map<string, SessionState>();
  private readonly enabled: () => boolean;
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly instanceEvictHandler?: LightningPoolVpipEvictHandler | null;
  private nextEvictToken = 0;

  constructor(opts: LightningPoolVpipJudgeOptions = {}) {
    this.enabled = opts.enabled ?? (() => isLightningPoolVpipJudgeEnabled());
    this.maxSessions = opts.maxSessions ?? LIGHTNING_POOL_VPIP_MAX_SESSIONS;
    this.now = opts.now ?? Date.now;
    this.instanceEvictHandler = opts.evictHandler;
  }

  private evictHandler(): LightningPoolVpipEvictHandler | null {
    return this.instanceEvictHandler !== undefined
      ? this.instanceEvictHandler
      : registeredEvictHandler;
  }

  private touch(clusterId: string, poolSessionId: string, playerId: string): SessionState {
    let row = this.sessions.get(poolSessionId);
    if (!row) {
      row = {
        clusterId,
        poolSessionId,
        playerId,
        recent: [],
        seenHands: new Set<number>(),
        totalEligibleHands: 0,
        warnedAtEligibleHands: null,
        evictPending: false,
        evicted: false,
        evictAttempts: 0,
        evictToken: 0,
        evictAskedAtMs: null,
      };
    } else {
      row.clusterId = clusterId;
      row.playerId = playerId;
    }
    // Maintain LRU order (oldest inactive sitting evicted first on memory cap).
    this.sessions.delete(poolSessionId);
    this.sessions.set(poolSessionId, row);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    return row;
  }

  private snapshot(row: SessionState, policy: LightningPoolVpipPolicy): LightningPoolVpipStatus {
    const hands = row.recent.length;
    let vpipHands = 0;
    for (const h of row.recent) if (h.entered) vpipHands += 1;
    const warned = row.warnedAtEligibleHands !== null && !row.evicted;
    const graceRemaining = warned
      ? Math.max(0, policy.graceHands - (row.totalEligibleHands - row.warnedAtEligibleHands!))
      : null;
    return {
      clusterId: row.clusterId,
      poolSessionId: row.poolSessionId,
      playerId: row.playerId,
      hands,
      vpipHands,
      totalEligibleHands: row.totalEligibleHands,
      vpipPct: roundVpipPct(vpipHands, hands),
      requiredPct: policy.floorPct,
      windowHands: policy.windowHands,
      graceHands: policy.graceHands,
      warned,
      graceRemaining,
      evictPending: row.evictPending,
      evicted: row.evicted,
    };
  }

  private emptyEvaluation(
    input: LightningPoolVpipHandInput,
    verdict: LightningPoolVpipVerdictKind
  ): LightningPoolVpipHandEvaluation {
    const policy = input.policy ?? DEFAULT_LIGHTNING_POOL_VPIP_POLICY;
    return {
      clusterId: input.clusterId,
      poolSessionId: input.poolSessionId,
      playerId: input.playerId,
      hands: 0,
      vpipHands: 0,
      totalEligibleHands: 0,
      vpipPct: null,
      requiredPct: policy.floorPct,
      windowHands: policy.windowHands,
      graceHands: policy.graceHands,
      warned: false,
      graceRemaining: null,
      evictPending: false,
      evicted: false,
      verdict,
      warningOpened: false,
    };
  }

  /**
   * Record one committed hand for a Lightning pool participant and evaluate their
   * standing against the rolling VPIP floor. Never throws.
   */
  recordHand(input: LightningPoolVpipHandInput): LightningPoolVpipHandEvaluation {
    try {
      if (!this.enabled() || !input.policy || !(input.policy.floorPct > 0)) {
        return this.emptyEvaluation(input, 'disabled');
      }
      if (!input.clusterId || !input.poolSessionId || !input.playerId) {
        return this.emptyEvaluation(input, 'skipped');
      }
      const policy = input.policy;
      const row = this.touch(input.clusterId, input.poolSessionId, input.playerId);

      // Walks and forced-only blinds do not enter the rolling sample.
      if (!input.hadOpportunity) {
        const snap = this.snapshot(row, policy);
        if (row.evictPending && !row.evicted) {
          return { ...snap, verdict: 'evict', warningOpened: false };
        }
        return { ...snap, verdict: 'skipped', warningOpened: false };
      }

      const handNumber =
        input.handNumber !== null && Number.isFinite(Number(input.handNumber))
          ? Number(input.handNumber)
          : null;
      if (handNumber !== null && row.seenHands.has(handNumber)) {
        return { ...this.snapshot(row, policy), verdict: 'duplicate', warningOpened: false };
      }

      // Insert in deal order (ascending handNumber) and trim to the rolling window.
      let insertAt = row.recent.length;
      if (handNumber !== null) {
        row.seenHands.add(handNumber);
        const maxSeen = Math.max(policy.windowHands * 2, 64);
        while (row.seenHands.size > maxSeen) {
          const oldestSeen = row.seenHands.values().next().value;
          if (oldestSeen === undefined) break;
          row.seenHands.delete(oldestSeen);
        }
        while (
          insertAt > 0 &&
          row.recent[insertAt - 1].handNumber !== null &&
          row.recent[insertAt - 1].handNumber! > handNumber
        ) {
          insertAt -= 1;
        }
      }
      row.recent.splice(insertAt, 0, { handNumber, entered: input.entered === true });
      while (row.recent.length > policy.windowHands) row.recent.shift();
      row.totalEligibleHands += 1;

      if (row.evicted) {
        return { ...this.snapshot(row, policy), verdict: 'ok', warningOpened: false };
      }

      // Initial grace: under graceHands eligible hands, never warn or evict even at 0% VPIP.
      if (row.totalEligibleHands < policy.graceHands) {
        return { ...this.snapshot(row, policy), verdict: 'grace', warningOpened: false };
      }

      const hands = row.recent.length;
      let vpipHands = 0;
      for (const h of row.recent) if (h.entered) vpipHands += 1;
      const belowFloor = isBelowFloorExact(vpipHands, hands, policy.floorPct);

      if (!belowFloor) {
        const wasWarned = row.warnedAtEligibleHands !== null || row.evictPending;
        row.warnedAtEligibleHands = null;
        row.evictPending = false;
        return {
          ...this.snapshot(row, policy),
          verdict: wasWarned ? 'recovered' : 'ok',
          warningOpened: false,
        };
      }

      // Below floor at >= graceHands: warn first, then evict only once grace is spent.
      if (row.warnedAtEligibleHands === null) {
        row.warnedAtEligibleHands = row.totalEligibleHands;
        row.evictPending = false;
        return { ...this.snapshot(row, policy), verdict: 'warn', warningOpened: true };
      }

      const handsSinceWarning = row.totalEligibleHands - row.warnedAtEligibleHands;
      if (handsSinceWarning < policy.graceHands) {
        return { ...this.snapshot(row, policy), verdict: 'warn', warningOpened: false };
      }

      row.evictPending = true;
      return { ...this.snapshot(row, policy), verdict: 'evict', warningOpened: false };
    } catch {
      return this.emptyEvaluation(input, 'skipped');
    }
  }

  /**
   * Dispatch a between-hands eviction request to the registered anchor eviction door.
   * Bounded to at most one in-flight call per session and MAX_EVICT_ATTEMPTS failed attempts.
   * Never throws.
   */
  async requestEviction(
    req: LightningPoolVpipEvictRequest
  ): Promise<LightningPoolVpipEvictOutcome> {
    if (!this.enabled()) return 'no_handler';
    const handler = this.evictHandler();
    if (!handler) return 'no_handler';
    const row = this.sessions.get(req.poolSessionId);
    if (!row) return 'not_seated';
    if (row.evicted || row.evictAttempts >= LIGHTNING_POOL_VPIP_MAX_EVICT_ATTEMPTS) {
      return 'exhausted';
    }
    const nowMs = this.now();
    if (
      row.evictAskedAtMs !== null &&
      nowMs - row.evictAskedAtMs < LIGHTNING_POOL_VPIP_EVICT_STALE_MS
    ) {
      return 'in_flight';
    }
    const token = ++this.nextEvictToken;
    row.evictToken = token;
    row.evictAskedAtMs = nowMs;
    try {
      const outcome = await handler(req);
      if (row.evictToken !== token || this.sessions.get(req.poolSessionId) !== row) {
        return outcome;
      }
      row.evictAskedAtMs = null;
      if (outcome === 'evicted' || outcome === 'not_seated') {
        row.evicted = true;
        row.evictPending = false;
      } else if (outcome === 'failed') {
        row.evictAttempts += 1;
      }
      // 'deferred' (e.g. LIGHTNING_HAND_IN_PROGRESS or freeze) consumes no attempt;
      // the next settled hand boundary tries again cleanly.
      return outcome;
    } catch {
      if (row.evictToken === token && this.sessions.get(req.poolSessionId) === row) {
        row.evictAskedAtMs = null;
        row.evictAttempts += 1;
      }
      return 'failed';
    }
  }

  /** Read a pool session's current VPIP standing, or null if not tracked. */
  getStatus(
    poolSessionId: string | null | undefined,
    policy: LightningPoolVpipPolicy = DEFAULT_LIGHTNING_POOL_VPIP_POLICY
  ): LightningPoolVpipStatus | null {
    if (!poolSessionId) return null;
    const row = this.sessions.get(poolSessionId);
    return row ? this.snapshot(row, policy) : null;
  }

  /** Clear one pool session's sample (e.g. player left the pool or room closed). */
  resetSession(poolSessionId: string | null | undefined): boolean {
    if (!poolSessionId) return false;
    return this.sessions.delete(poolSessionId);
  }

  /** Clear all tracked sessions for a player in a cluster (e.g. rejoin/reset). */
  resetPlayer(clusterId: string, playerId: string): number {
    let removed = 0;
    for (const [id, row] of this.sessions) {
      if (row.clusterId === clusterId && row.playerId === playerId) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Clear every tracked session of a Cluster (called when Lightning switches off,
   * stops, freezes, or restarts — harmonious with fn_nit_sitting_since resetting
   * on Lightning switch-off).
   */
  resetCluster(clusterId: string): number {
    if (!clusterId) return 0;
    let removed = 0;
    for (const [id, row] of this.sessions) {
      if (row.clusterId === clusterId) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Clear all state (tests only). */
  clear(): void {
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}

/** The process-wide Lightning pool VPIP judge (one engine process hosts a pool's hands). */
export const lightningPoolVpipJudge = new LightningPoolVpipJudge();
