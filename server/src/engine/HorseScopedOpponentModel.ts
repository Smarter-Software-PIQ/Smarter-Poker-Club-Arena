import {
  adaptiveHandDigest,
  statisticTuple,
  validAdaptiveStatistic,
  type AdaptiveStatistic,
} from './HorseAdaptiveStatistics.js';
import { createHash } from 'node:crypto';
import {
  adaptiveSessionPartition,
  ADAPTIVE_OBSERVATION_HORIZON_MS,
  type AdaptiveAction,
  type AdaptivePartition,
  type QualifiedAdaptiveObservation,
} from './HorseAdaptiveObservation.js';

export const SCOPED_MODEL_POLICY = Object.freeze({
  version: 'session-weighted-opponent-v1',
  maxInputObservations: 20_000,
  halfLifeMs: 7 * 24 * 60 * 60 * 1000,
  priorSessionMass: 8,
  minimumObservations: 80,
  minimumHands: 40,
  minimumSessions: 20,
  minimumEffectiveSessions: 12,
  familyError: 0.05,
});
export const SCOPED_MODEL_ACTIONS = Object.freeze([
  'fold',
  'check',
  'call',
  'bet',
  'raise',
] as const);
type Distribution = Readonly<Record<AdaptiveAction, number>>;
export interface ScopedOpponentModelInput {
  readonly observations: readonly QualifiedAdaptiveObservation[];
  readonly statistics?: readonly AdaptiveStatistic[];
  readonly scopeKey: string;
  readonly opponentKey: string;
  readonly observerKey: string;
  readonly cohort: 'human' | 'horse_policy';
  readonly partition: AdaptivePartition;
  /** Observation time, not commit/drain time. The reader must prove completeness separately. */
  readonly window: Readonly<{ fromMs: number; toMs: number; complete: boolean }>;
  readonly prior: Readonly<{ version: string; probabilities: Distribution }>;
}
/** A complete journal population is a different estimand from a complete
 * source window. Missing captures may bias it. It has no observing horse and
 * cannot authorize a policy for any horse, including the observed actor. */
export type JournaledOpponentModelInput = Omit<
  ScopedOpponentModelInput,
  'observerKey' | 'window'
> & {
  readonly window: Readonly<{ fromMs: number; toMs: number; journalComplete: boolean }>;
};
export interface ScopedOpponentEstimate {
  readonly policyVersion: typeof SCOPED_MODEL_POLICY.version;
  readonly policyDigest: string;
  readonly modelId: string;
  readonly scopeKey: string;
  readonly opponentKey: string;
  readonly cohort: ScopedOpponentModelInput['cohort'];
  readonly partition: AdaptivePartition;
  readonly window: Readonly<{ fromMs: number; toMs: number }>;
  readonly priorVersion: string;
  readonly evidenceDigest: string;
  readonly status: 'estimated' | 'insufficient_evidence';
  readonly observations: number;
  readonly hands: number;
  readonly sessions: number;
  readonly effectiveSessions: number;
  readonly dataWeight: number;
  readonly probabilities: Distribution;
  readonly intervals: Readonly<Record<AdaptiveAction, readonly [number, number]>>;
  /** Conservative family-wise bounds conditional on independent sessions.
   * These are observational probabilities, never causal EV or activation authority. */
  readonly intervalMethod: 'bounded-session-hoeffding-v1';
}
export type ScopedOpponentModelResult =
  | Readonly<{
      status: 'unavailable';
      reason:
        | 'invalid_input'
        | 'incomplete_window'
        | 'input_budget_exceeded'
        | 'self_observation'
        | 'conflicting_observation'
        | 'invalid_observation'
        | 'prior_support_mismatch';
    }>
  | ScopedOpponentEstimate;

const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const empty = (): Record<AdaptiveAction, number> => ({
  fold: 0,
  check: 0,
  call: 0,
  bet: 0,
  raise: 0,
});
const digestKey = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const unavailable = (
  reason: Extract<ScopedOpponentModelResult, { status: 'unavailable' }>['reason']
): ScopedOpponentModelResult => Object.freeze({ status: 'unavailable', reason });
const fingerprint = (o: QualifiedAdaptiveObservation) =>
  JSON.stringify([
    o.version,
    o.observationId,
    o.handId,
    o.actorKey,
    o.sessionKey,
    o.observedAtMs,
    o.partition,
    o.scopeKey,
    o.action,
    o.facedBet,
    o.origin,
  ]);

/** Deterministic, bounded reconstruction from a complete qualified window.
 * Replays do not increment counters. Persistence and complete-window acquisition
 * remain separate responsibilities; this function cannot certify either one. */
export function buildScopedOpponentModel(
  input: ScopedOpponentModelInput
): ScopedOpponentModelResult {
  return fitScopedOpponentModel(input, false);
}

export function buildJournaledOpponentModel(input: JournaledOpponentModelInput) {
  return Object.freeze({
    population:
      input.statistics === undefined
        ? ('journaled_qualified_observations' as const)
        : ('journaled_qualified_observations_and_disposed_statistics' as const),
    sourceCoverage: 'not_established' as const,
    activationAuthorized: false as const,
    model: fitScopedOpponentModel(input, true),
  });
}

function fitScopedOpponentModel(
  input: ScopedOpponentModelInput | JournaledOpponentModelInput,
  journalOnly: boolean
): ScopedOpponentModelResult {
  if (
    !input ||
    !Array.isArray(input.observations) ||
    !digestKey(input.scopeKey) ||
    !digestKey(input.opponentKey) ||
    (!journalOnly && !digestKey((input as ScopedOpponentModelInput).observerKey)) ||
    !['human', 'horse_policy'].includes(input.cohort) ||
    !['training', 'holdout'].includes(input.partition) ||
    !input.window ||
    !Number.isSafeInteger(input.window.fromMs) ||
    !Number.isSafeInteger(input.window.toMs) ||
    input.window.fromMs < 0 ||
    input.window.toMs <= input.window.fromMs ||
    input.window.toMs - input.window.fromMs > ADAPTIVE_OBSERVATION_HORIZON_MS ||
    (journalOnly
      ? typeof (input as JournaledOpponentModelInput).window.journalComplete !== 'boolean'
      : typeof (input as ScopedOpponentModelInput).window.complete !== 'boolean') ||
    !input.prior ||
    typeof input.prior.version !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.prior.version) ||
    !input.prior.probabilities ||
    !SCOPED_MODEL_ACTIONS.every(
      (action) =>
        Number.isFinite(input.prior.probabilities[action]) &&
        input.prior.probabilities[action] >= 0 &&
        input.prior.probabilities[action] <= 1
    ) ||
    Math.abs(SCOPED_MODEL_ACTIONS.reduce((sum, a) => sum + input.prior.probabilities[a], 0) - 1) >
      1e-10
  )
    return unavailable('invalid_input');
  if (
    journalOnly
      ? !(input as JournaledOpponentModelInput).window.journalComplete
      : !(input as ScopedOpponentModelInput).window.complete
  )
    return unavailable('incomplete_window');
  if (!journalOnly && input.statistics !== undefined) return unavailable('invalid_input');
  if (!journalOnly && input.opponentKey === (input as ScopedOpponentModelInput).observerKey)
    return unavailable('self_observation');
  if (input.observations.length > SCOPED_MODEL_POLICY.maxInputObservations)
    return unavailable('input_budget_exceeded');
  const unique = new Map<
    string,
    { observation: QualifiedAdaptiveObservation; fingerprint: string }
  >();
  for (const observation of input.observations) {
    if (!observation || typeof observation !== 'object') return unavailable('invalid_observation');
    // Holdout, other-node and other-player changes must not alter the training estimate or its identity.
    if (
      observation.scopeKey !== input.scopeKey ||
      observation.actorKey !== input.opponentKey ||
      observation.partition !== input.partition ||
      (input.cohort === 'human'
        ? observation.origin !== 'player' && observation.origin !== 'pre_action'
        : observation.origin !== 'horse_policy')
    )
      continue;
    if (
      observation.version !== 1 ||
      !digestKey(observation.sessionKey) ||
      adaptiveSessionPartition(observation.sessionKey) !== input.partition ||
      typeof observation.handId !== 'string' ||
      !UUID.test(observation.handId) ||
      typeof observation.observationId !== 'string' ||
      !observation.observationId.startsWith(observation.handId + ':') ||
      !/^(?:0|[1-9][0-9]{0,3})$/.test(observation.observationId.slice(37)) ||
      Number(observation.observationId.slice(37)) >= 4096 ||
      !Number.isSafeInteger(observation.observedAtMs) ||
      typeof observation.facedBet !== 'boolean' ||
      !SCOPED_MODEL_ACTIONS.includes(observation.action)
    )
      return unavailable('invalid_observation');
    if (
      observation.observedAtMs < input.window.fromMs ||
      observation.observedAtMs >= input.window.toMs
    )
      continue;
    const key = fingerprint(observation),
      previous = unique.get(observation.observationId);
    if (previous && previous.fingerprint !== key) return unavailable('conflicting_observation');
    unique.set(observation.observationId, { observation, fingerprint: key });
  }
  const ordered = [...unique.values()].sort((a, b) =>
    a.observation.observationId.localeCompare(b.observation.observationId)
  );
  if (
    input.statistics !== undefined &&
    (!Array.isArray(input.statistics) ||
      input.statistics.length > SCOPED_MODEL_POLICY.maxInputObservations)
  )
    return unavailable('invalid_input');
  const selectedStatistics: readonly AdaptiveStatistic[] = (input.statistics ?? []).filter(
    (s) =>
      s &&
      s.scopeKey === input.scopeKey &&
      s.actorKey === input.opponentKey &&
      s.partition === input.partition &&
      (input.cohort === 'human'
        ? s.origin === 'player' || s.origin === 'pre_action'
        : s.origin === 'horse_policy')
  );
  if (selectedStatistics.some((s) => !validAdaptiveStatistic(s)))
    return unavailable('invalid_observation');
  const statistics: readonly AdaptiveStatistic[] = selectedStatistics
    .filter((s) => s.observedAtMs >= input.window.fromMs && s.observedAtMs < input.window.toMs)
    .sort((a, b) =>
      JSON.stringify(statisticTuple(a)).localeCompare(JSON.stringify(statisticTuple(b)))
    );
  const represented = unique.size + statistics.reduce((n, s) => n + s.observations, 0);
  if (represented > SCOPED_MODEL_POLICY.maxInputObservations)
    return unavailable('input_budget_exceeded');
  const evidenceDigest =
    input.statistics === undefined
      ? hash(ordered.map((o) => o.fingerprint))
      : hash([
          'disposed-statistics-v1',
          ordered.map((o) => o.fingerprint),
          statistics.map(statisticTuple),
        ]);
  interface Hand {
    count: number;
    mass: number;
    actions: Record<AdaptiveAction, number>;
  }
  const sessions = new Map<string, Map<string, Hand>>();
  const hands = new Set<string>();
  const handSessions = new Map<string, string>();
  const rawHands = new Set<string>();
  for (const { observation: o } of ordered) {
    const handIdentity = input.statistics === undefined ? o.handId : adaptiveHandDigest(o.handId);
    rawHands.add(handIdentity);
    if (input.prior.probabilities[o.action] === 0) return unavailable('prior_support_mismatch');
    const priorSession = handSessions.get(handIdentity);
    if (priorSession !== undefined && priorSession !== o.sessionKey)
      return unavailable('conflicting_observation');
    handSessions.set(handIdentity, o.sessionKey);
    let session = sessions.get(o.sessionKey);
    if (!session) {
      session = new Map();
      sessions.set(o.sessionKey, session);
    }
    let hand = session.get(handIdentity);
    if (!hand) {
      hand = { count: 0, mass: 0, actions: empty() };
      session.set(handIdentity, hand);
    }
    const decay = 2 ** (-(input.window.toMs - o.observedAtMs) / SCOPED_MODEL_POLICY.halfLifeMs);
    hand.count++;
    hand.mass += decay;
    hand.actions[o.action] += decay;
    hands.add(handIdentity);
  }
  const statisticKeys = new Set<string>();
  for (const s of statistics) {
    const key = JSON.stringify(statisticTuple(s).slice(0, 9));
    if (statisticKeys.has(key) || rawHands.has(s.handDigest))
      return unavailable('conflicting_observation');
    statisticKeys.add(key);
    if (input.prior.probabilities[s.action] === 0) return unavailable('prior_support_mismatch');
    const priorSession = handSessions.get(s.handDigest);
    if (priorSession !== undefined && priorSession !== s.sessionKey)
      return unavailable('conflicting_observation');
    handSessions.set(s.handDigest, s.sessionKey);
    let session = sessions.get(s.sessionKey);
    if (!session) {
      session = new Map();
      sessions.set(s.sessionKey, session);
    }
    let hand = session.get(s.handDigest);
    if (!hand) {
      hand = { count: 0, mass: 0, actions: empty() };
      session.set(s.handDigest, hand);
    }
    const decay = 2 ** (-(input.window.toMs - s.observedAtMs) / SCOPED_MODEL_POLICY.halfLifeMs);
    hand.count += s.observations;
    hand.mass += decay * s.observations;
    hand.actions[s.action] += decay * s.observations;
    hands.add(s.handDigest);
  }
  const counts = empty();
  let mass = 0;
  // Each hand contributes at most one unit within a session. Each session
  // contributes at most one unit overall, regardless of its length or repeats.
  for (const [, session] of [...sessions].sort(([a], [b]) => a.localeCompare(b))) {
    const handCounts = empty();
    let handMass = 0,
      sessionWeight = 0;
    for (const [, hand] of [...session].sort(([a], [b]) => a.localeCompare(b))) {
      const weight = hand.mass / hand.count;
      handMass += weight;
      sessionWeight = Math.max(sessionWeight, weight);
      for (const action of SCOPED_MODEL_ACTIONS)
        handCounts[action] += hand.actions[action] / hand.count;
    }
    mass += sessionWeight;
    for (const action of SCOPED_MODEL_ACTIONS)
      counts[action] += (handCounts[action] / handMass) * sessionWeight;
  }
  const priorMass = SCOPED_MODEL_POLICY.priorSessionMass,
    dataWeight = mass / (mass + priorMass);
  const probabilities = empty(),
    intervals = {} as Record<AdaptiveAction, readonly [number, number]>;
  const radius =
    mass > 0
      ? Math.min(
          1,
          Math.sqrt(
            Math.log((2 * SCOPED_MODEL_ACTIONS.length) / SCOPED_MODEL_POLICY.familyError) /
              (2 * mass)
          )
        )
      : 1;
  for (const action of SCOPED_MODEL_ACTIONS) {
    const empirical = mass > 0 ? counts[action] / mass : input.prior.probabilities[action];
    const posterior =
      (counts[action] + priorMass * input.prior.probabilities[action]) / (mass + priorMass);
    probabilities[action] = posterior;
    // Include the observed-frequency bound and the shrunk point estimate.
    // Prior shrinkage cannot produce a falsely narrow confidence interval.
    intervals[action] = Object.freeze(
      mass > 0
        ? [
            Math.max(0, Math.min(posterior, empirical - radius)),
            Math.min(1, Math.max(posterior, empirical + radius)),
          ]
        : [0, 1]
    );
  }
  const status =
    represented >= SCOPED_MODEL_POLICY.minimumObservations &&
    hands.size >= SCOPED_MODEL_POLICY.minimumHands &&
    sessions.size >= SCOPED_MODEL_POLICY.minimumSessions &&
    mass >= SCOPED_MODEL_POLICY.minimumEffectiveSessions
      ? 'estimated'
      : 'insufficient_evidence';
  const identity = [
    ...(journalOnly
      ? [
          input.statistics === undefined
            ? 'journaled-population-v1'
            : 'journaled-population-and-disposed-statistics-v1',
        ]
      : []),
    SCOPED_MODEL_POLICY,
    input.scopeKey,
    input.opponentKey,
    input.cohort,
    input.partition,
    input.window.fromMs,
    input.window.toMs,
    input.prior.version,
    SCOPED_MODEL_ACTIONS.map((a) => input.prior.probabilities[a]),
    evidenceDigest,
  ];
  return Object.freeze({
    policyVersion: SCOPED_MODEL_POLICY.version,
    policyDigest: hash(SCOPED_MODEL_POLICY),
    modelId: hash(identity),
    scopeKey: input.scopeKey,
    opponentKey: input.opponentKey,
    cohort: input.cohort,
    partition: input.partition,
    window: Object.freeze({ fromMs: input.window.fromMs, toMs: input.window.toMs }),
    priorVersion: input.prior.version,
    evidenceDigest,
    status,
    observations: represented,
    hands: hands.size,
    sessions: sessions.size,
    effectiveSessions: mass,
    dataWeight,
    probabilities: Object.freeze(probabilities),
    intervals: Object.freeze(intervals),
    intervalMethod: 'bounded-session-hoeffding-v1',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// FAST INTRA-SESSION GEAR-SHIFT BLENDING (Enhancement #10)
// ─────────────────────────────────────────────────────────────────────────

export const FAST_SESSION_GEAR_SHIFT_POLICY = Object.freeze({
  version: 'fast-session-gear-shift-v1',
  recencyWindowOpportunities: 16,
  fastHalfLifeOpportunities: 12,
  minRecencyOpportunities: 8,
  shiftTotalVariationThreshold: 0.2,
  snapbackTotalVariationThreshold: 0.1,
  maxRecencyBlendWeight: 0.78,
});

export interface SessionGearShiftSummary {
  readonly shifted: boolean;
  readonly direction: 'aggressive_shift' | 'passive_shift' | 'snapped_back' | 'stable';
  readonly recencyWeight: number;
  readonly totalVariationShift: number;
  readonly recentOpportunities: number;
  readonly recentProbabilities: Readonly<Record<AdaptiveAction, number>>;
  readonly blendedProbabilities: Readonly<Record<AdaptiveAction, number>>;
}

export interface GearShiftScopedOpponentEstimate extends ScopedOpponentEstimate {
  readonly gearShift: SessionGearShiftSummary;
}

export type GearShiftScopedOpponentModelResult =
  | Extract<ScopedOpponentModelResult, { status: 'unavailable' }>
  | GearShiftScopedOpponentEstimate;

/**
 * Evaluates `buildScopedOpponentModel(input)` for the lifetime session-bounded
 * posterior, then overlays a fast exponential recency window over the latest
 * 12-20 opportunities (optionally scoped to `activeSessionKey`) so horses adapt
 * immediately to mid-session gear shifts and snap back when recent play reverts.
 */
export function buildGearShiftAwareScopedOpponentModel(
  input: ScopedOpponentModelInput,
  activeSessionKey?: string
): GearShiftScopedOpponentModelResult {
  const base = buildScopedOpponentModel(input);
  if (base.status === 'unavailable') return base;

  const stableSummary = (
    probs: Readonly<Record<AdaptiveAction, number>>
  ): SessionGearShiftSummary =>
    Object.freeze({
      shifted: false,
      direction: 'stable',
      recencyWeight: 0,
      totalVariationShift: 0,
      recentOpportunities: 0,
      recentProbabilities: probs,
      blendedProbabilities: probs,
    });

  interface RecencyItem {
    readonly observedAtMs: number;
    readonly tieKey: string;
    readonly action: AdaptiveAction;
    readonly observations: number;
  }
  const items: RecencyItem[] = [];
  for (const o of input.observations ?? []) {
    if (activeSessionKey !== undefined && o.sessionKey !== activeSessionKey) continue;
    items.push({
      observedAtMs: o.observedAtMs,
      tieKey: o.observationId,
      action: o.action,
      observations: 1,
    });
  }
  for (const s of input.statistics ?? []) {
    if (
      (s as { disposition?: string }).disposition &&
      (s as { disposition?: string }).disposition !== 'settled'
    )
      continue;
    if (activeSessionKey !== undefined && s.sessionKey !== activeSessionKey) continue;
    items.push({
      observedAtMs: s.observedAtMs,
      tieKey: s.handDigest,
      action: s.action,
      observations: s.observations,
    });
  }
  items.sort((a, b) => a.observedAtMs - b.observedAtMs || a.tieKey.localeCompare(b.tieKey));

  const windowSlice = items.slice(-20);
  const totalRecentObs = windowSlice.reduce((acc, s) => acc + s.observations, 0);
  if (totalRecentObs < FAST_SESSION_GEAR_SHIFT_POLICY.minRecencyOpportunities) {
    return Object.freeze({ ...base, gearShift: stableSummary(base.probabilities) });
  }

  const decay = Math.pow(0.5, 1 / FAST_SESSION_GEAR_SHIFT_POLICY.fastHalfLifeOpportunities);
  const weighted = empty();
  let totalWeight = 0;
  let seenBackward = 0;
  for (let i = windowSlice.length - 1; i >= 0; i--) {
    const s = windowSlice[i];
    const w = Math.pow(decay, seenBackward) * s.observations;
    weighted[s.action] += w;
    totalWeight += w;
    seenBackward += s.observations;
  }

  // Light Laplace smoothing toward lifetime base (prior mass = 2 opportunities)
  const smoothMass = 2;
  const recentProbs = empty();
  for (const a of SCOPED_MODEL_ACTIONS) {
    recentProbs[a] =
      (weighted[a] + smoothMass * base.probabilities[a]) / (totalWeight + smoothMass);
  }

  // Total variation distance between recent window and lifetime posterior: 0.5 * sum |p - q|.
  let l1 = 0;
  for (const a of SCOPED_MODEL_ACTIONS) {
    l1 += Math.abs(recentProbs[a] - base.probabilities[a]);
  }
  const tv = Math.round(0.5 * l1 * 10000) / 10000;

  // Tail check (last 6 observations) to detect immediate snap-back after a prior burst.
  const tailSlice = windowSlice.slice(-6);
  const tailObs = tailSlice.reduce((acc, s) => acc + s.observations, 0);
  let tailTvToPrior = 1;
  if (tailObs >= 5) {
    const tailCounts = empty();
    for (const s of tailSlice) tailCounts[s.action] += s.observations;
    let tailL1 = 0;
    for (const a of SCOPED_MODEL_ACTIONS) {
      tailL1 += Math.abs(tailCounts[a] / tailObs - input.prior.probabilities[a]);
    }
    tailTvToPrior = 0.5 * tailL1;
  }

  const aggressiveRecent = recentProbs.bet + recentProbs.raise;
  const aggressiveBase = base.probabilities.bet + base.probabilities.raise;
  const aggressivePrior = input.prior.probabilities.bet + input.prior.probabilities.raise;

  let shifted = false;
  let direction: SessionGearShiftSummary['direction'] = 'stable';
  let recencyWeight = 0;

  if (
    tv >= FAST_SESSION_GEAR_SHIFT_POLICY.shiftTotalVariationThreshold &&
    tailTvToPrior > FAST_SESSION_GEAR_SHIFT_POLICY.snapbackTotalVariationThreshold
  ) {
    shifted = true;
    direction = aggressiveRecent >= aggressiveBase ? 'aggressive_shift' : 'passive_shift';
    const sampleFactor = Math.min(
      1,
      (totalRecentObs - FAST_SESSION_GEAR_SHIFT_POLICY.minRecencyOpportunities + 4) /
        FAST_SESSION_GEAR_SHIFT_POLICY.recencyWindowOpportunities
    );
    const shiftFactor = Math.min(
      1,
      tv / (FAST_SESSION_GEAR_SHIFT_POLICY.shiftTotalVariationThreshold * 1.8)
    );
    recencyWeight =
      Math.round(
        Math.min(
          FAST_SESSION_GEAR_SHIFT_POLICY.maxRecencyBlendWeight,
          0.35 + 0.43 * sampleFactor * shiftFactor
        ) * 1000
      ) / 1000;
  } else if (
    tailObs >= 5 &&
    tailTvToPrior <= FAST_SESSION_GEAR_SHIFT_POLICY.snapbackTotalVariationThreshold &&
    Math.abs(aggressiveBase - aggressivePrior) >= 0.14
  ) {
    shifted = false;
    direction = 'snapped_back';
    recencyWeight = 0;
  }

  const blended = empty();
  let sum = 0;
  for (const a of SCOPED_MODEL_ACTIONS) {
    blended[a] = recencyWeight * recentProbs[a] + (1 - recencyWeight) * base.probabilities[a];
    sum += blended[a];
  }
  if (sum > 0) {
    for (const a of SCOPED_MODEL_ACTIONS) blended[a] = blended[a] / sum;
  }

  return Object.freeze({
    ...base,
    gearShift: Object.freeze({
      shifted,
      direction,
      recencyWeight,
      totalVariationShift: tv,
      recentOpportunities: totalRecentObs,
      recentProbabilities: Object.freeze(recentProbs),
      blendedProbabilities: Object.freeze(blended),
    }),
  });
}
