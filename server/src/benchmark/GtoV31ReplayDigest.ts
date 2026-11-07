/**
 * V31 REPLAY DIGEST (2026-11-06, Phase 3 of the R8 plan).
 *
 * The execution fingerprint (scripts/ci/v31-execution-fingerprint.mjs) proves
 * the playbook's own files did not change. It cannot see behaviour that
 * reaches the playbook across its boundary: HorseLogic.legalize (bet
 * legalization lives in the 13,000-line brain file) and the shape of the
 * state the brain hands in. The replay digest closes that gap.
 *
 * Recording: while a certification run plays its tables, every certified
 * decision is captured (HorseLogic opts.onV31ReplayState) with its inputs,
 * the exact RNG position before the consult, the opponent read the V53
 * hand-off saw, and the decision returned.
 *
 * Corpus: the captures are deduplicated and ordered by the SHA-256 of their
 * canonical bytes, then cut to GTO_V31_REPLAY_MAX_STATES. Order of play,
 * worker scheduling and run concurrency therefore cannot change the corpus;
 * only the decisions themselves can.
 *
 * Replay: each state goes through the CURRENT engine's decideV31Certified
 * with the current HorseLogic.legalize, the RNG restored to the recorded
 * position and the recorded opponent read injected. The digest hashes, per
 * state, the decision and the receipt's action id, sampled family, final
 * action and amount and the full probability mix.
 *
 * Faithfulness: replayed on the engine that recorded it, every state must
 * reproduce its recorded decision exactly. A corpus that fails that is
 * refused, so a digest is never anchored to a replay that does not replay.
 */

import { createHash } from 'node:crypto';
import type { HorseDecision } from '../types.js';
import type { GtoV31DecisionReceipt } from '../engine/HorseLogic.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { restoreFastRandom, saveFastRandom } from '../engine/HorseEval.js';
import {
  decideV31Certified,
  V31_REPLAY_OPTS,
  type V31ReplayState,
} from '../engine/HorseV31CertifiedPolicy.js';

export const GTO_V31_REPLAY_PROTOCOL = 'smarter-poker.v31-replay-digest.v1';
/** The plan's "about 6,000" recorded spots: enough to see a change, small enough to store. */
export const GTO_V31_REPLAY_MAX_STATES = 6_000;
/** A corpus this small cannot speak for a playbook. */
export const GTO_V31_REPLAY_MIN_STATES = 300;

/** Key-sorted JSON: the one byte form every hash here is taken over. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface GtoV31ReplayCorpus {
  protocol: typeof GTO_V31_REPLAY_PROTOCOL;
  datasetChecksum: string;
  /** SHA-256 over the ordered state hashes: the identity of the replay set. */
  checksum: string;
  recorded: number;
  states: V31ReplayState[];
}

/** A replay state is only admissible if it is the shape the recorder writes. */
export function gtoV31ReplayStateProblem(
  state: V31ReplayState,
  datasetChecksum: string
): string | null {
  if (!state || typeof state !== 'object') return 'not an object';
  if (state.schemaVersion !== 1) return 'unknown schema version';
  if (state.opts?.gtoV31DatasetChecksum !== datasetChecksum)
    return 'recorded against another dataset';
  for (const key of Object.keys(state.opts)) {
    if (!(V31_REPLAY_OPTS as readonly string[]).includes(key)) return `unexpected option ${key}`;
  }
  if (!Number.isInteger(state.rng) || state.rng < 0 || state.rng > 0xffffffff)
    return 'bad RNG position';
  if (!state.decision || typeof state.decision.action !== 'string') return 'no recorded decision';
  if (!Array.isArray(state.opponents) || state.opponents.length !== 1) return 'not heads-up';
  return null;
}

export function buildGtoV31ReplayCorpus(
  captured: readonly V31ReplayState[],
  datasetChecksum: string,
  maxStates = GTO_V31_REPLAY_MAX_STATES
): GtoV31ReplayCorpus {
  if (!/^[0-9a-f]{64}$/.test(datasetChecksum))
    throw new Error('replay corpus needs a dataset checksum');
  const byHash = new Map<string, V31ReplayState>();
  for (const state of captured) {
    const problem = gtoV31ReplayStateProblem(state, datasetChecksum);
    if (problem) throw new Error(`replay state refused: ${problem}`);
    byHash.set(sha256(canonicalJson(state)), state);
  }
  const hashes = [...byHash.keys()].sort().slice(0, maxStates);
  return {
    protocol: GTO_V31_REPLAY_PROTOCOL,
    datasetChecksum,
    checksum: gtoV31ReplayCorpusChecksum(hashes),
    recorded: captured.length,
    states: hashes.map((h) => byHash.get(h)!),
  };
}

function gtoV31ReplayCorpusChecksum(orderedStateHashes: readonly string[]): string {
  return sha256(`${GTO_V31_REPLAY_PROTOCOL}\n${orderedStateHashes.join('\n')}`);
}

/** Recompute a stored corpus's identity from its states; refuse a tampered one. */
export function verifyGtoV31ReplayCorpus(corpus: GtoV31ReplayCorpus): string | null {
  if (corpus.protocol !== GTO_V31_REPLAY_PROTOCOL) return 'unknown replay protocol';
  const hashes: string[] = [];
  for (const state of corpus.states) {
    const problem = gtoV31ReplayStateProblem(state, corpus.datasetChecksum);
    if (problem) return `replay state refused: ${problem}`;
    hashes.push(sha256(canonicalJson(state)));
  }
  for (let i = 1; i < hashes.length; i++) {
    if (hashes[i - 1] >= hashes[i]) return 'replay states are not in canonical order';
  }
  if (gtoV31ReplayCorpusChecksum(hashes) !== corpus.checksum)
    return 'replay corpus checksum mismatch';
  return null;
}

export interface GtoV31ReplayOutcome {
  decision: HorseDecision | null;
  actionId: string | null;
  sampledActionFamily: string | null;
  sampledAmount: number | null;
  finalAction: string | null;
  finalAmount: number | null;
  executedAsIntended: boolean | null;
  mix: Record<string, number> | null;
}

type Legalize = (
  decision: HorseDecision,
  player: V31ReplayState['player'],
  gs: V31ReplayState['gs'],
  vi: V31ReplayState['vi']
) => HorseDecision;

/** HorseLogic's own legalization, exactly as the live consult receives it. */
const liveLegalize: Legalize = (decision, player, gs, vi) =>
  (HorseLogic as unknown as { legalize: Legalize }).legalize.call(
    HorseLogic,
    decision,
    player,
    gs,
    vi
  );

/** Replay one state through the current engine. The RNG is left as found. */
export function replayGtoV31State(
  recorded: V31ReplayState,
  legalize: Legalize = liveLegalize
): GtoV31ReplayOutcome {
  // A fresh copy per replay: the consult must not be able to see a previous
  // replay's mutation, nor leave one in the corpus.
  const state = JSON.parse(JSON.stringify(recorded)) as V31ReplayState;
  let receipt: GtoV31DecisionReceipt | null = null;
  const before = saveFastRandom();
  restoreFastRandom(state.rng);
  let decision: HorseDecision | null;
  try {
    decision = decideV31Certified({
      street: state.street,
      player: state.player,
      opponents: state.opponents,
      gs: state.gs,
      vi: state.vi,
      opts: { ...state.opts, onGtoV31Decision: (r) => (receipt = r) },
      tele15: false,
      useMind: state.useMind,
      isRiver: state.isRiver,
      isTournament: state.isTournament,
      trustedTournament: state.trustedTournament,
      pot: state.pot,
      toCall: state.toCall,
      currentBet: state.currentBet,
      legalize: (d) => legalize(d, state.player, state.gs, state.vi),
      readOpponent: () => state.opponentRead,
    });
  } finally {
    restoreFastRandom(before);
  }
  const r = receipt as GtoV31DecisionReceipt | null;
  return {
    decision: decision ? JSON.parse(JSON.stringify(decision)) : null,
    actionId: r?.actionId ?? null,
    sampledActionFamily: r?.sampledActionFamily ?? null,
    sampledAmount: r?.sampledAmount ?? null,
    finalAction: r?.finalAction ?? null,
    finalAmount: r?.finalAmount ?? null,
    executedAsIntended: r?.executedAsIntended ?? null,
    mix: r ? JSON.parse(JSON.stringify(r.referenceDistribution)) : null,
  };
}

export interface GtoV31ReplayDigest {
  protocol: typeof GTO_V31_REPLAY_PROTOCOL;
  datasetChecksum: string;
  corpusChecksum: string;
  digest: string;
  states: number;
  decided: number;
  /** States whose replayed decision differs from the recorded one. */
  unfaithful: number;
  firstUnfaithful: {
    index: number;
    recorded: HorseDecision;
    replayed: HorseDecision | null;
  } | null;
}

export function gtoV31ReplayDigest(
  corpus: GtoV31ReplayCorpus,
  legalize: Legalize = liveLegalize
): GtoV31ReplayDigest {
  const problem = verifyGtoV31ReplayCorpus(corpus);
  if (problem) throw new Error(problem);
  const h = createHash('sha256');
  h.update(`${GTO_V31_REPLAY_PROTOCOL}\n${corpus.datasetChecksum}\n${corpus.checksum}\n`);
  let decided = 0;
  let unfaithful = 0;
  let firstUnfaithful: GtoV31ReplayDigest['firstUnfaithful'] = null;
  corpus.states.forEach((state, index) => {
    const outcome = replayGtoV31State(state, legalize);
    if (outcome.decision) decided++;
    if (canonicalJson(outcome.decision) !== canonicalJson(state.decision)) {
      unfaithful++;
      firstUnfaithful ??= { index, recorded: state.decision, replayed: outcome.decision };
    }
    h.update(`${canonicalJson(outcome)}\n`);
  });
  return {
    protocol: GTO_V31_REPLAY_PROTOCOL,
    datasetChecksum: corpus.datasetChecksum,
    corpusChecksum: corpus.checksum,
    digest: h.digest('hex'),
    states: corpus.states.length,
    decided,
    unfaithful,
    firstUnfaithful,
  };
}

/**
 * The certification-time anchor: the corpus must be large enough and must
 * replay faithfully on the engine that recorded it. Returns the refusal, or
 * null when the digest may be stored with the evaluation.
 */
export function gtoV31ReplayAnchorRefusal(digest: GtoV31ReplayDigest): string | null {
  if (digest.states < GTO_V31_REPLAY_MIN_STATES) {
    return `replay corpus has ${digest.states} states, the floor is ${GTO_V31_REPLAY_MIN_STATES}`;
  }
  if (digest.unfaithful > 0) {
    return `${digest.unfaithful} recorded decisions do not replay on the recording engine (first at state ${digest.firstUnfaithful?.index})`;
  }
  if (digest.decided !== digest.states) return 'a recorded decision replayed as no decision';
  return null;
}
