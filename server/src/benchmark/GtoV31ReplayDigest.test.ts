import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { saveFastRandom, seedFastRandom } from '../engine/HorseEval.js';
import {
  _clearGtoPostflopV31,
  replaceGtoPostflopV31Evaluation,
  type GtoPostflopV31Row,
} from '../engine/GtoPostflopV31.js';
import {
  captureV31ReplayState,
  type V31CertifiedInput,
  type V31ReplayState,
} from '../engine/HorseV31CertifiedPolicy.js';
import {
  buildGtoV31ReplayCorpus,
  canonicalJson,
  gtoV31ReplayAnchorRefusal,
  gtoV31ReplayDigest,
  GTO_V31_REPLAY_MIN_STATES,
  replayGtoV31State,
  verifyGtoV31ReplayCorpus,
} from './GtoV31ReplayDigest.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(value: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < value.length; i += 2) {
    out.push({ rank: value[i] as CardRank, suit: SUITS[value[i + 1]] });
  }
  return out;
}

const CHECKSUM = '7'.repeat(64);
const BOARD = cards('Qh9d7c2h');
/** A mixed facing-bet cell, so the RNG position decides the action. */
const CELL: GtoPostflopV31Row = {
  dataset_id: '22222222-2222-4222-8222-222222222222',
  dataset_key: 'replay-digest-fixture',
  dataset_checksum: CHECKSUM,
  solver_version: 'PioSOLVER-3.0',
  solver_binary_checksum: 'b'.repeat(64),
  pipeline_commit: 'c'.repeat(40),
  pipeline_bundle_checksum: 'b'.repeat(64),
  manifest_version: '5',
  manifest_checksum: 'd'.repeat(64),
  source_artifact_checksum: 'e'.repeat(64),
  source_combo_order_checksum: 'f'.repeat(64),
  range_bundle_checksum: '1'.repeat(64),
  icm_model_checksum: '5'.repeat(64),
  input_bundle_checksum: '6'.repeat(64),
  cell_key_checksum: '3'.repeat(64),
  cell_payload_checksum: '4'.repeat(64),
  lineage_checksum: '2'.repeat(64),
  quality_status: 'validated',
  dataset_state: 'evaluating',
  dataset_cells: 1,
  source_rows: 20,
  train_source_rows: 18,
  holdout_source_rows: 2,
  invalid_rows: 0,
  audited_at: '2026-09-08T12:00:00.000Z',
  street: 'turn',
  game_family: 'cash',
  objective: 'cash_ev',
  utility_context: 'cash_ev',
  table_size: 2,
  pot_type: 'limped',
  hero_position: 'BB',
  opponent_position: 'SB',
  depth_bucket: 80,
  texture_class: 'Brud',
  node_role: 'facing_bet',
  facing_kind: 'bet',
  facing_size_bucket: 'mid',
  hand_matrix: { '43o:11': { f: 0.2, c: 0.5, b75: 0.3 } },
  action_specs: {
    f: { family: 'fold', size_unit: 'none', size_value: null, all_in: false },
    c: { family: 'call', size_unit: 'none', size_value: null, all_in: false },
    b75: { family: 'raise', size_unit: 'pot_after_call_fraction', size_value: 0.75, all_in: false },
  },
  policy_ev_matrix: { '43o:11': 0 },
  action_ev_matrix: { '43o:11': { f: 0, c: 0, b75: 0 } },
};

function spot() {
  const hero = {
    seat: 1,
    user_id: 'hero',
    stack: 8_000,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: cards('3c4d'),
  };
  const villain = {
    seat: 2,
    user_id: 'villain',
    stack: 7_940,
    bet: 60,
    totalInvested: 60,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: [],
  };
  const gs = {
    players: [hero, villain],
    communityCards: BOARD,
    pot: 160,
    currentBet: 60,
    minRaise: 60,
    stage: 'turn',
    gameVariant: 'nlh',
    gameMode: 'cash',
    format: 'cash',
    bigBlind: 100,
    smallBlind: 50,
    dealerSeat: 2,
    actionHistory: [
      { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 0 },
      { stage: 'flop', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 1 },
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 2 },
      { stage: 'turn', seat: 2, userId: 'villain', action: 'bet', amount: 60, timestamp: 3 },
    ],
  };
  return { hero, gs };
}

/** Play the spot `n` times through the real brain, recording as a certification run does. */
function record(n: number) {
  const states: V31ReplayState[] = [];
  const live: HorseDecision[] = [];
  for (let i = 0; i < n; i++) {
    const { hero, gs } = spot();
    seedFastRandom(0x1000 + i * 7919);
    live.push(
      HorseLogic.decide(hero as never, gs as never, 'balanced', {}, {
        mind: false,
        telemetry: false,
        gtoV31DatasetChecksum: CHECKSUM,
        onV31ReplayState: (s) => states.push(s),
      })
    );
  }
  return { states, live };
}

beforeEach(() => {
  _clearGtoPostflopV31();
  replaceGtoPostflopV31Evaluation([CELL]);
});

describe('V31 replay digest: recording', () => {
  it('captures exactly one JSON-safe state per certified decision, carrying the decision made', () => {
    const { states, live } = record(40);
    expect(states).toHaveLength(40);
    states.forEach((s, i) => {
      // decide() decorates the consult's answer afterwards (joint-policy
      // telemetry, think time); the corpus keeps the consult's own answer.
      expect({ action: s.decision.action, amount: s.decision.amount }).toEqual({
        action: live[i].action,
        amount: live[i].amount,
      });
      expect(s.decision).not.toHaveProperty('jointPolicy');
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      expect(Object.keys(s.opts).sort()).toEqual(['gtoV31DatasetChecksum']);
    });
    // The mix is really mixed: the RNG position is part of the state.
    expect(new Set(live.map((d) => d.action)).size).toBeGreaterThanOrEqual(3);
  });

  it('records nothing when the playbook does not decide the spot', () => {
    _clearGtoPostflopV31();
    const { states } = record(5);
    expect(states).toHaveLength(0);
  });

  it('records the opponent read the V53 hand-off would consult, from the injected reader', () => {
    const { hero, gs } = spot();
    const sentinel = { sentinel: true } as never;
    const input = {
      street: 'turn',
      player: hero,
      opponents: [gs.players[1]],
      gs,
      vi: {},
      opts: { gtoV31DatasetChecksum: CHECKSUM, onGtoV31Decision: () => {} },
      tele15: false,
      useMind: true,
      isRiver: false,
      isTournament: false,
      trustedTournament: undefined,
      pot: 160,
      toCall: 60,
      currentBet: 60,
      legalize: (d: HorseDecision) => d,
      readOpponent: () => sentinel,
    } as unknown as V31CertifiedInput;
    const s = captureV31ReplayState(input, 0xdeadbeef, { action: 'call', amount: 60, thinkTime: 0 });
    expect(s.opponentRead).toEqual({ sentinel: true });
    expect(s.rng).toBe(0xdeadbeef);
    // Hooks and anything the consult does not read stay out of the corpus.
    expect(s.opts).toEqual({ gtoV31DatasetChecksum: CHECKSUM });
    expect(s).not.toHaveProperty('legalize');
    expect(s).not.toHaveProperty('readOpponent');
    const off = captureV31ReplayState({ ...input, useMind: false }, 1, s.decision);
    expect(off.opponentRead).toBeNull();
  });
});

describe('V31 replay digest: corpus', () => {
  it('is independent of capture order and duplicates, and refuses tampering', () => {
    const { states } = record(60);
    const a = buildGtoV31ReplayCorpus(states, CHECKSUM);
    const b = buildGtoV31ReplayCorpus([...states].reverse().concat(states.slice(0, 10)), CHECKSUM);
    expect(b.checksum).toBe(a.checksum);
    expect(b.states.map((s) => canonicalJson(s))).toEqual(a.states.map((s) => canonicalJson(s)));
    expect(verifyGtoV31ReplayCorpus(a)).toBeNull();

    const tampered = structuredClone(a);
    tampered.states[3].pot += 1;
    expect(verifyGtoV31ReplayCorpus(tampered)).toMatch(/checksum mismatch|canonical order/);
    const dropped = { ...a, states: a.states.slice(1) };
    expect(verifyGtoV31ReplayCorpus(dropped)).toBe('replay corpus checksum mismatch');

    const extra = structuredClone(states[0]);
    Object.assign(extra.opts, { v32FacingDefense: true });
    expect(() => buildGtoV31ReplayCorpus([extra], CHECKSUM)).toThrow(/unexpected option/);
    expect(() => buildGtoV31ReplayCorpus(states, '8'.repeat(64))).toThrow(/another dataset/);
  });

  it('cuts to the cap by state hash, so the kept set does not depend on play order', () => {
    const { states } = record(50);
    const cut = buildGtoV31ReplayCorpus(states, CHECKSUM, 20);
    const cutReversed = buildGtoV31ReplayCorpus([...states].reverse(), CHECKSUM, 20);
    expect(cut.states).toHaveLength(20);
    expect(cut.recorded).toBe(50);
    expect(cutReversed.checksum).toBe(cut.checksum);
  });
});

describe('V31 replay digest: replay', () => {
  it('reproduces every recorded decision on the recording engine and anchors', () => {
    const { states } = record(GTO_V31_REPLAY_MIN_STATES);
    const corpus = buildGtoV31ReplayCorpus(states, CHECKSUM);
    const rngBefore = saveFastRandom();
    const d1 = gtoV31ReplayDigest(corpus);
    expect(saveFastRandom()).toBe(rngBefore);
    const d2 = gtoV31ReplayDigest(corpus);
    expect(d2.digest).toBe(d1.digest);
    expect(d1).toMatchObject({ states: corpus.states.length, decided: corpus.states.length, unfaithful: 0 });
    expect(gtoV31ReplayAnchorRefusal(d1)).toBeNull();
    // Replay does not mutate the corpus it reads.
    expect(verifyGtoV31ReplayCorpus(corpus)).toBeNull();
  });

  it('carries the probability mix and the receipt, not only the action', () => {
    const { states } = record(1);
    const outcome = replayGtoV31State(states[0]);
    expect(outcome.mix).toEqual({ f: 0.2, c: 0.5, b75: 0.3 });
    expect(outcome.actionId).toMatch(/^(f|c|b75)$/);
    expect(outcome.decision).toEqual(states[0].decision);
  });

  it('a change to legalization across the boundary flips the digest and is refused as an anchor', () => {
    const { states } = record(GTO_V31_REPLAY_MIN_STATES);
    const corpus = buildGtoV31ReplayCorpus(states, CHECKSUM);
    const base = gtoV31ReplayDigest(corpus);
    const live = (HorseLogic as unknown as {
      legalize: (d: HorseDecision, ...rest: unknown[]) => HorseDecision;
    }).legalize.bind(HorseLogic);
    const changed = gtoV31ReplayDigest(corpus, (d, p, g, v) => {
      const out = live(d, p, g, v);
      return out.action === 'raise' ? { ...out, amount: (out.amount ?? 0) + 1 } : out;
    });
    expect(changed.digest).not.toBe(base.digest);
    expect(changed.unfaithful).toBeGreaterThan(0);
    expect(gtoV31ReplayAnchorRefusal(changed)).toMatch(/do not replay/);
  });

  it('a change to the playbook the states were recorded against flips the digest', () => {
    const { states } = record(80);
    const corpus = buildGtoV31ReplayCorpus(states, CHECKSUM);
    const base = gtoV31ReplayDigest(corpus);
    _clearGtoPostflopV31();
    replaceGtoPostflopV31Evaluation([
      { ...CELL, hand_matrix: { '43o:11': { f: 0.2, c: 0.3, b75: 0.5 } } },
    ]);
    expect(gtoV31ReplayDigest(corpus).digest).not.toBe(base.digest);
    _clearGtoPostflopV31();
    const gone = gtoV31ReplayDigest(corpus);
    expect(gone.decided).toBe(0);
    expect(gtoV31ReplayAnchorRefusal(gone)).not.toBeNull();
  });

  it('a corpus below the floor cannot anchor a playbook', () => {
    const { states } = record(10);
    const d = gtoV31ReplayDigest(buildGtoV31ReplayCorpus(states, CHECKSUM));
    expect(gtoV31ReplayAnchorRefusal(d)).toMatch(/the floor is/);
  });
});
