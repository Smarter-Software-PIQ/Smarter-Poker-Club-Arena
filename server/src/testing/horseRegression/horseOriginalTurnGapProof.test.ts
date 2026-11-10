import { expect, it, afterAll, vi } from 'vitest';
import type { Card } from '../../types.js';
vi.hoisted(() => {
  vi.stubEnv('SUPABASE_URL', 'https://supabase.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-placeholder-key');
});
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-expect-error standalone maintained host helper
import * as diagnostic from '../../../../scripts/ci/horse-tournament-predicate-proof.mjs';
// @ts-expect-error standalone maintained host helper
import * as riverDiagnostic from '../../../../scripts/ci/horse-river-value-proof.mjs';
// @ts-expect-error standalone maintained host helper
import * as fleetDiagnostic from '../../../../scripts/ci/horse-fleet-slice-proof.mjs';
// @ts-expect-error standalone maintained host helper
import { inspectOriginalWagerRules } from '../../../../scripts/ci/horse-original-wager-proof.mjs';
import {
  horsePolicyOrderForVersion,
  HORSE_POLICY_ORDER,
  HORSE_POLICY_GRAPH_VERSION,
} from '../../engine/HorsePolicyGraph.js';
import { checkedToNonBottomRiverBoat } from '../../engine/HorseNonBottomRiverValue.js';
import { hasRiverNuts } from '../../engine/HorseRiverNuts.js';
import { v81StreetWager } from '../../engine/HorseOmahaBigBetCalls.js';
import { omahaBoatPosition, omahaQuickCategory } from '../../engine/HorseEval.js';
import * as records from '../../services/horseDecisionJournal/record.js';
import * as binding from '../../engine/HorseDecisionHandBinding.js';
import * as review from '../../services/horseDecisionJournal/review.js';
import * as witness from '../../engine/HorseExecutionWitness.js';
import * as lifecycle from '../../services/horseDecisionJournal/lifecycle.js';
import {
  HorseQualifiedAuthorityHolder,
  HorsePhase8AuthorityGate,
} from '../../engine/HorseQualifiedAuthority.js';
import { qualifiedTestAdmission } from '../../engine/HorseQualifiedAuthority.test-support.js';
import { buildHorseDecisionKey } from '../../engine/horseDecision/protocol.js';
import { jointPolicyFixture } from '../../engine/multiway/JointRangeFixture.test-support.js';
import { encodeHorseDecisionReads } from '../../engine/HorseDecisionReadFrame.js';
import { HorseMind } from '../../engine/HorseMind.js';
import { channelHub } from '../../hub/ChannelHub.js';
import * as effects from '../../services/horseDecisionJournal/effects.js';
import * as planEffects from '../../engine/HorseDecisionEffects.js';
import * as readFrame from '../../engine/HorseDecisionReadFrame.js';
import * as observer from '../../engine/HorseObserverReadEvidence.js';
import * as historyContext from '../../engine/HorseObserverReadContext.js';
import { HorseFleetPhaseInterpreter } from '../../services/horseDecisionJournal/phaseProof.js';
import { createHash } from 'node:crypto';
import { captureHorseTournamentPayoutTerms } from '../../engine/HorseTournamentPayoutTerms.js';
import { evidenceDigest } from '../../services/horseCorrectiveReview/authority.js';
import { classifyTournamentRiverSnapshot } from '../../services/horseCorrectiveReview/kernelTournamentEligibility.js';
// @ts-expect-error maintained host control JavaScript
import * as census from '../../../../scripts/ci/horse-turn-census-proof.mjs';
const api = {
  ...records,
  ...binding,
  ...review,
  ...lifecycle,
  ...effects,
  ...planEffects,
  ...readFrame,
  ...observer,
  ...historyContext,
  buildHorseDecisionKey,
  HorseFleetPhaseInterpreter,
  classifyTournamentRiverSnapshot,
};
afterAll(() => {
  channelHub.close();
  vi.unstubAllEnvs();
});
const table = '12345678-abcd-4321-abcd-123456789abc',
  lease = '22345678-abcd-4321-abcd-123456789abc',
  handId = '32345678-abcd-4321-abcd-123456789abc',
  producer = '42345678-abcd-4321-abcd-123456789abc',
  source = 'a'.repeat(40);
function fixture(
  actionKind = 'raise',
  change?: (x: any) => void,
  provided?: any,
  prepare?: (hero: any, state: any) => void
) {
  const { hero, state }: any =
    provided ??
    JSON.parse(JSON.stringify(jointPolicyFixture('plo5', 1, 'cash', 'river')), (_k, v) =>
      typeof v === 'string' && /^p[0-9]$/.test(v)
        ? '20000000-0000-4000-8000-00000000000' + (Number(v[1]) + 1)
        : v
    );
  if (!provided) {
    hero.stack = 100;
    hero.bet = 0;
    state.players[0].stack = 100;
    state.players[0].bet = 0;
    Object.assign(state, {
      pot: 451,
      currentBet: 20,
      toCall: 20,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      minRaiseTo: 40,
      maxRaiseTo: 100,
    });
    if (['check', 'bet'].includes(actionKind))
      Object.assign(state, {
        currentBet: 0,
        toCall: 0,
        legalActions: ['check', 'bet', 'all_in'],
        minRaiseTo: 2,
        maxRaiseTo: 100,
      });
  }
  delete state.contestablePot;
  state.actionHistory = Array.from({ length: 3 }, (_, i) => ({
    seat: 2,
    userId: state.players[1].user_id,
    action: 'check',
    amount: 0,
    stage: 'preflop',
    timestamp: 100 + i,
  }));
  prepare?.(hero, state);
  const ordinal = state.actionHistory.length;
  const s: any = {
    type: 'DECIDE_FAST',
    requestId: 9,
    generation: 7,
    fence: `${table}:123:${hero.seat}:${lease}:7`,
    decisionTimeMs: provided ? 100 : 1000,
    decisionKey: '',
    player: hero,
    gameState: state,
    style: 'balanced',
    opts: {},
    handJournalContext: binding.captureHorseHandJournalContext(state.actionHistory),
  };
  s.decisionKey = buildHorseDecisionKey(s);
  const amount =
    actionKind === 'all_in'
      ? 100
      : actionKind === 'call'
        ? 20
        : actionKind === 'raise'
          ? 40
          : actionKind === 'bet'
            ? 20
            : undefined;
  const decision: any = {
    action: actionKind,
    ...(amount === undefined ? {} : { amount }),
    thinkTime: 0,
  };
  const capture: any = {
    snapshot: s,
    decision,
    effects: [],
    rngBefore: 1,
    rngAfter: 2,
    computeMs: 1,
    governorScale: 1,
    runtimePins: 'incomplete',
    readFrame: encodeHorseDecisionReads(
      HorseMind.createSandbox(),
      state.players,
      HorseMind.handKeyOf(state.actionHistory)
    ),
  };
  const w = witness.createHorseExecutionWitness(s, decision, {
    requestId: 9,
    lane: 'fast',
    computeMs: 1,
    governorScale: 1,
  });
  const action: any = {
    seat: hero.seat,
    userId: hero.user_id,
    action: actionKind,
    amount: amount ?? 0,
    timestamp: 1001,
    stage: 'river',
  };
  witness.settleHorseExecutionWitness(w, {
    applied: true,
    acceptedActions: [{ record: action, intended: true }],
  });
  const node: any = {
    version: 1,
    status: 'captured',
    mode: state.gameMode,
    street: 'river',
    actorSeat: hero.seat,
    variant: state.gameVariant,
    currentBet: state.currentBet,
    pot: state.pot,
    toCall: state.toCall,
    seats: state.players.map((p: any) => [p.seat, p.stack, p.bet, p.totalInvested, 0, 0, 0]),
  };
  const hand: any = {
    type: 'OBSERVE_COMPLETED_HAND',
    requestId: 10,
    generation: 123,
    fence: `${table}:123:${lease}:observe`,
    handKey: `${table}:123`,
    committedHandId: handId,
    bigBlind: 2,
    actions: [
      ...state.actionHistory.map((a: any) => ({ ...a, origin: 'player' })),
      {
        ...action,
        origin: 'horse_policy',
        publicNode: node,
        observationIdentity: {
          version: 1,
          status: 'bound',
          handId,
          actionOrdinal: ordinal,
          observationId: `${handId}:${ordinal}`,
          sessionKey: 'c'.repeat(64),
        },
      },
    ],
  };
  const handKey = records.journalHash(`${table}:123:${lease}`),
    turnKey = records.journalHash(JSON.stringify([7, s.fence, 9, s.decisionKey, s.decisionTimeMs]));
  const input: any = {
    version: 7,
    probe: 'original_turn_gap',
    sourceRelease: source,
    cases: [
      {
        handKey,
        tableId: table,
        handId,
        handNumber: 123,
        leaseGeneration: lease,
        decisionRecordSha256: null,
        actorId: hero.user_id,
        seat: hero.seat,
        actionOrdinal: ordinal,
      },
    ],
  };
  change?.({ input, capture, w, hand, node });
  const make = (kind: any, sequence: number, body: any) =>
    records.makeHorseJournalRecord(
      {
        producerId: producer,
        sequence,
        atMs: 2000,
        sourceRelease: source,
        kind,
        handKey,
        turnKey: kind === 'accepted_hand' ? handKey : turnKey,
      },
      body
    );
  const rows = [
    make('decision', 1, capture),
    make('execution', 2, w),
    make('accepted_hand', 3, hand),
  ];
  return {
    capture,
    w,
    hand,
    make,
    input,
    batch: {
      status: 'canonical_journal_export',
      sourceRelease: source,
      recordsByHand: [{ handKey, records: rows }],
    },
    rows,
  };
}

const inspect = (f: any, actual: any = api) =>
  diagnostic.inspectOriginalTurnGapRecords(f.input, f.batch, actual);
function sanitize(f: any, out: any) {
  return spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import json,runpy,sys\nm=runpy.run_path(sys.argv[1]);d=json.loads(sys.stdin.read());print(json.dumps(m["sanitize_original_turn_gap_result"](d["result"],d["input"])))',
      resolve('../scripts/ci/inspect-tournament-refill.py'),
    ],
    { input: JSON.stringify({ input: f.input, result: out }), encoding: 'utf8', timeout: 5000 }
  );
}
for (const action of ['fold', 'check', 'call', 'bet', 'raise', 'all_in'])
  it(`binds actual original ${action} journal facts`, () => {
    const f = fixture(action),
      out = inspect(f);
    expect(
      review.reconcileHorseJournalHand(f.rows, f.input.cases[0].handKey),
      JSON.stringify(out)
    ).toMatchObject({ status: 'reconciled', gaps: [] });
    expect(out, JSON.stringify(out)).toMatchObject({
      status: 'observed',
      rawRecordsExported: false,
      activationAllowed: false,
    });
    expect(out.cases[0]).toMatchObject({
      actions: { captured: action, selected: action, executed: action, accepted: action },
      selection: { matched: true, failures: [] },
    });
    const checked = sanitize(f, out);
    expect(checked.status, checked.stderr).toBe(0);
    expect(JSON.stringify(out)).not.toContain(f.capture.snapshot.player.user_id);
    expect(JSON.stringify(out)).not.toMatch(
      /cards|username|policyGraph|private-sentinel|stackByUser/
    );
  });
for (const variant of ['flh', 'flo8'])
  it(`binds distinct fixed-limit ${variant} original chains without strategy qualification`, () => {
    const f = fixture('check', undefined, undefined, (hero, state) => {
      state.gameVariant = variant;
      state.fixedBetSize = 4;
      state.bettingStructure = 'fixed_limit';
      state.minRaiseTo = state.maxRaiseTo = 4;
      hero.cards = hero.cards.slice(0, variant === 'flh' ? 2 : 4);
    });
    const out = inspect(f);
    expect(out.cases[0]).toMatchObject({
      status: 'observed',
      variant,
      selection: { matched: true, failures: [] },
      actions: { captured: 'check', selected: 'check', executed: 'check', accepted: 'check' },
      guards: { wholeHandReconciled: true, canonicalInputAndReadFrameBound: true },
    });
    expect(out).toMatchObject({
      replayVerified: false,
      causalReplayVerified: false,
      activationAllowed: false,
    });
    expect(sanitize(f, out).status).toBe(0);
    const broken = {
      ...f,
      batch: {
        ...f.batch,
        recordsByHand: [
          {
            ...f.batch.recordsByHand[0],
            records: f.rows.filter((r: any) => r.kind !== 'accepted_hand'),
          },
        ],
      },
    };
    expect(inspect(broken).cases[0].status).toBe('unknown');
  });
for (const variant of ['unknown_limit', 'FLO8', null])
  it(`refuses unsupported original variant ${variant}`, () => {
    const f = fixture('check', undefined, undefined, (_hero, state) => {
      state.gameVariant = variant;
    });
    expect(inspect(f).cases[0].status).toBe('unknown');
    const valid = fixture('check'),
      out = inspect(valid);
    out.cases[0].variant = variant;
    expect(sanitize(valid, out).status).not.toBe(0);
  });
it('preserves ABSENT, stored null and numeric zero without pretending to recover undefined', () => {
  const out = inspect(fixture('check')).cases[0];
  expect(out.amounts).toEqual({
    captured: { kind: 'absent', value: null },
    selected: { kind: 'null', value: null },
    expected: { kind: 'number', value: 0 },
    executed: { kind: 'null', value: null },
    accepted: { kind: 'number', value: 0 },
  });
  expect(out.comparisons).toMatchObject({
    capturedSelectedAmount: 'absent_vs_null',
    expectedExecutedAmount: 'null_vs_number',
  });
  expect(diagnostic.originalStoredAmount({ amount: null })).toEqual({ kind: 'null', value: null });
  expect(diagnostic.originalStoredAmount({ amount: 0 })).toEqual({ kind: 'number', value: 0 });
  for (const amount of [undefined, NaN, Infinity, -1, '0'])
    expect(() => diagnostic.originalStoredAmount({ amount })).toThrow();
});
it('routes exact v7 metadata through the existing encoder and rejects private/duplicate/oversized metadata', () => {
  const f = fixture('check');
  const run = (input: any) =>
    spawnSync(
      'python3',
      [
        '-B',
        resolve('../scripts/ci/inspect-tournament-refill.py'),
        '--encode-reference-cases',
        source,
      ],
      { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 }
    );
  const good = run(f.input);
  expect(good.status, good.stderr).toBe(0);
  expect(JSON.parse(Buffer.from(good.stdout.trim(), 'base64').toString())).toEqual(f.input);
  for (const input of [
    { ...f.input, cases: [...f.input.cases, ...f.input.cases] },
    { ...f.input, cases: [{ ...f.input.cases[0], cards: ['private-sentinel'] }] },
    { ...f.input, cases: Array(7).fill(f.input.cases[0]) },
    { ...f.input, probe: 'private-sentinel' },
  ]) {
    expect(diagnostic.originalTurnGapInputIsValid(input, source)).toBe(false);
    const out = run(input);
    expect(out.status).toBe(1);
    expect(out.stdout).toBe('');
    expect(out.stderr).not.toContain('private-sentinel');
  }
  for (const mutate of [
    (x: any) => (x.cases[0].cards = ['private-sentinel']),
    (x: any) => (x.cases[0].amounts.captured.kind = 'raw'),
    (x: any) => (x.cases[0].selection.failures = ['raw-private-sentinel']),
    (x: any) => (x.cases[0].phase14.reason = 'raw-private-sentinel'),
  ]) {
    const out = JSON.parse(JSON.stringify(inspect(f)));
    mutate(out);
    expect(sanitize(f, out).status).not.toBe(0);
  }
});
for (const mode of [
  'hash',
  'source',
  'duplicate',
  'ordinal',
  'sequence',
  'readframe',
  'decision-key',
  'unexplained-substitution',
  'missing-execution',
  'duplicate-execution',
  'incomplete-hand',
])
  it(`refuses ${mode} before exposing stored scalars`, () => {
    const f = fixture('call', ({ capture, hand, input }: any) => {
      if (mode === 'ordinal') input.cases[0].actionOrdinal = 2;
      if (mode === 'readframe')
        capture.readFrame = { ...capture.readFrame, sha256: 'f'.repeat(64) };
      if (mode === 'decision-key') capture.snapshot.decisionKey = 'private-sentinel';
      if (mode === 'unexplained-substitution') capture.decision.action = 'fold';
      if (mode === 'incomplete-hand')
        hand.actions.push({ ...hand.actions[3], observationIdentity: undefined });
    });
    if (mode === 'hash') f.rows[0] = { ...f.rows[0], sha256: 'f'.repeat(64) };
    if (mode === 'source')
      f.rows[0] = records.makeHorseJournalRecord(
        { ...f.rows[0], sourceRelease: 'b'.repeat(40) },
        f.capture
      );
    if (mode === 'duplicate') f.rows.push(f.rows[0]);
    if (mode === 'sequence') f.rows[1] = f.make('execution', 1, f.w);
    if (mode === 'missing-execution') f.rows.splice(1, 1);
    if (mode === 'duplicate-execution') f.rows.push(f.make('execution', 4, f.w));
    const out = inspect(f);
    expect(out.cases[0], JSON.stringify(out)).toMatchObject({ status: 'unknown' });
    expect(Object.keys(out.cases[0]).sort()).toEqual(['handKey', 'reason', 'status']);
    const checked = sanitize(f, out);
    expect(checked.status, checked.stderr).toBe(0);
  });
function actualCensus(f: any) {
  const ids = Array.from(
    { length: 999 },
    (_, i) => `90000000-0000-4000-8000-${i.toString().padStart(12, '0')}`
  );
  ids.push(f.capture.snapshot.player.user_id);
  ids.sort();
  const packet = {
    version: 2,
    sourceSha: source,
    window: { startUtc: new Date(5999).toISOString(), endUtc: new Date(6001).toISOString() },
    horseIds: ids,
    hands: [
      {
        handKey: f.input.cases[0].handKey,
        committedAtMs: 6000,
        actions: f.hand.actions.flatMap((a: any, actionOrdinal: number) =>
          ids.includes(a.userId)
            ? [
                {
                  actorIndex: ids.indexOf(a.userId),
                  actionOrdinal,
                  stage: a.stage,
                  action: a.action,
                  origin: a.origin ?? 'unknown',
                  amount: a.amount ?? null,
                  seat: a.seat ?? null,
                  timestamp: a.timestamp ?? null,
                },
              ]
            : []
        ),
      },
    ],
  };
  const out = census.inspectHorseTurnCensus(
    packet,
    { sourceRelease: f.batch.sourceRelease, recordsByHand: f.batch.recordsByHand },
    api
  );
  return out.turns.find((t: any) => t.actionOrdinal === 3);
}
for (const action of ['check', 'fold', 'call', 'bet', 'raise', 'all_in'])
  it(`agrees with actual maintained census selection for ${action}`, () => {
    const f = fixture(action);
    expect(inspect(f).cases[0].selection.matched).toBe(actualCensus(f).selection === 'matched');
  });
it.each(['action', 'amount'])(
  'observes a genuine authority withdrawal changing the %s',
  (change) => {
    const amountOnly = change === 'amount';
    const action = amountOnly ? 'bet' : 'all_in';
    const f = fixture(action, ({ capture, w, hand }: any) => {
      const holder = new HorseQualifiedAuthorityHolder('original-gap-worker');
      holder.apply(qualifiedTestAdmission(1));
      const ledger = (authority: any) => ({
        version: 'horse-tournament-postflop-round2-v1',
        mode: 'candidate',
        changed: true,
        applied: true,
        selection: 'selected',
        authority,
        authorityVerdict: null,
        baselineAction: action,
        baselineAmount: amountOnly ? hand.actions[3].amount : null,
        candidateAction: amountOnly ? 'bet' : 'fold',
        candidateAmount: amountOnly ? hand.actions[3].amount + 1 : null,
        executionStatus: 'pending',
        executedAction: null,
        executedAmount: null,
      });
      capture.decision = {
        action: amountOnly ? 'bet' : 'fold',
        ...(amountOnly ? { amount: hand.actions[3].amount + 1 } : {}),
        thinkTime: 0,
        tournamentPostflop: ledger(holder.receipt()),
      };
      const gate = new HorsePhase8AuthorityGate(
        () => qualifiedTestAdmission(1),
        'original-gap-main'
      );
      gate.refresh();
      const delivered = {
        ...capture.decision,
        tournamentPostflop: ledger(gate.stamp(holder.receipt())),
      };
      const replacement = witness.createHorseExecutionWitness(capture.snapshot, delivered, {
        requestId: 9,
        lane: 'fast',
        computeMs: 1,
        governorScale: 1,
      });
      witness.withdrawHorsePhase8Selection(replacement, capture.snapshot, 'withdrawn');
      witness.settleHorseExecutionWitness(replacement, {
        applied: true,
        acceptedActions: [{ record: hand.actions[3], intended: true }],
      });
      Object.assign(w, replacement);
    });
    const out = inspect(f);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'observed' });
    expect(out.cases[0]).toMatchObject({
      selection: {
        matched: false,
        failures: [
          amountOnly ? 'selected_captured_amount_mismatch' : 'selected_captured_action_mismatch',
        ],
      },
      actions: {
        captured: amountOnly ? 'bet' : 'fold',
        selected: action,
        executed: action,
        accepted: action,
      },
    });
    expect(out.cases[0].originalWitnessWithdrawals).toEqual([['phase8', 'withdrawn', true]]);
    expect(actualCensus(f).selection).toBe('authority_withdrawn');
    const checked = sanitize(f, out);
    expect(checked.status, checked.stderr).toBe(0);
    (f.w.phase8Authority as any).verdict = 'private-sentinel';
    f.rows[1] = f.make('execution', 2, f.w);
    const refused = inspect(f);
    expect(refused.cases[0]).toMatchObject({
      status: 'observed',
      originalWitnessWithdrawals: [['phase8', null, null]],
    });
    const sanitizedRefusal = sanitize(f, refused);
    expect(sanitizedRefusal.status, sanitizedRefusal.stderr).toBe(0);
    expect(JSON.stringify(refused)).not.toContain('private-sentinel');
  }
);
it('names every census conjunct and never treats null as zero', () => {
  const f = fixture('check'),
    w = JSON.parse(JSON.stringify(f.w));
  expect(diagnostic.originalTurnSelectionFailures(f.capture, w)).toEqual([]);
  w.executionStatus = 'coerced';
  w.selected.action = 'fold';
  w.executedAmount = 0;
  w.expectedExecutionAmount = null;
  w.acceptedActions[0].record.amount = null;
  expect(diagnostic.originalTurnSelectionFailures(f.capture, w)).toEqual([
    'execution_status_not_intended',
    'executed_selected_action_mismatch',
    'selected_captured_action_mismatch',
    'zero_executed_amount_not_null',
    'zero_expected_amount_not_zero',
    'zero_accepted_amount_not_zero',
  ]);
  const g = fixture('call');
  g.w.executedAmount = 0;
  expect(diagnostic.originalTurnSelectionFailures(g.capture, g.w)).toEqual([
    'wager_executed_expected_amount_mismatch',
  ]);
});

const cards = (s: string): Card[] =>
  s.split(' ').map((c) => ({
    rank: c[0] as Card['rank'],
    suit: ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' } as const)[c[1] as 's'],
  }));
function eligibilityFixture(): any {
  const hero = {
    user_id: 'hero',
    username: 'Hero',
    seat: 1,
    stack: 80,
    bet: 10,
    totalInvested: 20,
    cards: cards('As Ah'),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const opponent = {
    ...hero,
    user_id: 'villain',
    seat: 2,
    stack: 0,
    bet: 30,
    totalInvested: 40,
    cards: [] as Card[],
    is_all_in: true,
  };
  const source = {
    version: 1,
    tournamentId: 'spin',
    cacheId: '00000000-0000-4000-8000-000000000001',
    generation: 1,
    readStartedAtMs: 90,
    readCompletedAtMs: 100,
    contextDigest: 'a'.repeat(64),
    contextStatus: 'complete',
    contextIssues: [],
  };
  const tournament = {
    schemaVersion: 1,
    contextStatus: 'complete',
    contextIssues: [],
    sourceAgeMs: 0,
    tournamentId: 'spin',
    tournamentStatus: 'RUNNING',
    gameVariant: 'nlh',
    tournamentType: 'SPIN',
    entrants: 3,
    playersLeft: 2,
    playersAtTable: 2,
    spotsPaid: 1,
    payoutPct: [100],
    registrationOpen: false,
    lateRegistrationOpen: false,
    reentryOpen: false,
    rebuyOpen: false,
    addOnPeriodOpen: false,
    reentryAllowed: false,
    rebuyAllowed: false,
    addOnAvailable: false,
    isPko: false,
    isBounty: false,
    isMysteryBounty: false,
    satellite: false,
    bountyPoolCents: 0,
    onBreak: false,
    prizePoolCents: 10001,
    currentSmallBlind: 1,
    currentBigBlind: 2,
    currentAnte: 0,
    stackByUser: { hero: 100, villain: 40 },
    stacks: [100, 40],
    ...captureHorseTournamentPayoutTerms(
      {
        id: 'spin',
        prize_pool_finalized: true,
        bubble_protection: false,
        payout_club: { asset: 'chips', is_platform: false, union_id: null },
        prize_pool: 100.01,
        buy_in_amount: 10,
        is_bounty: false,
        is_pko: false,
        is_mystery_bounty: false,
      },
      [{ place: 1, percentage: 100 }],
      3,
      false
    ),
    contextProvenance: {
      version: 1,
      readAtMs: 100,
      status: 'complete',
      issues: [],
      ageMs: 0,
      source,
      projection: {
        tableId: 'table',
        handNumber: 1,
        actorId: 'hero',
        actorSeat: hero.seat,
        dealerSeat: 2,
        dealtSeatIds: [1, 2],
        smallBlind: 1,
        bigBlind: 2,
        ante: 0,
        gameVariant: 'nlh',
      },
    },
  };
  // Like the cache publication, bind the context including its captured payout
  // terms before adding decision provenance. This is a synthetic source
  // interval, never a signed qualification or an atomic database receipt.
  const { contextProvenance: _projection, ...capturedContext } = tournament;
  source.contextDigest = createHash('sha256').update(JSON.stringify(capturedContext)).digest('hex');
  return {
    version: 'horse-wta-spin-river-reference-v1',
    original: {
      readFrame: { publicReads: [] },
      snapshot: {
        type: 'DECIDE_FAST',
        requestId: 1,
        generation: 1,
        fence: 'table:1:1:river',
        decisionTimeMs: 100,
        decisionKey: 'test',
        player: hero,
        gameState: {
          stateSchemaVersion: 1,
          gameVariant: 'nlh',
          format: 'spin',
          gameMode: 'tournament',
          stage: 'river',
          bettingStructure: 'no_limit',
          asset: 'chips',
          chipUnit: 1,
          ante: 0,
          bigBlind: 2,
          dealerSeat: 2,
          heroSeat: 1,
          currentPlayerSeat: 1,
          players: [{ ...hero, cards: [] }, opponent],
          dealtSeatIds: [1, 2],
          pot: 60,
          currentBet: 30,
          toCall: 20,
          legalActions: ['fold', 'call'],
          communityCards: cards('2c 4d 7h 9s Jc'),
          tournament,
        },
      } as any,
    },
    range: [{ cards: cards('Ks Kh'), weight: 1 }],
    rangeReadFrameDigest: evidenceDigest({ publicReads: [] }),
  };
}

function tournamentOriginal(mutate?: (s: any) => void) {
  const original = JSON.parse(
    JSON.stringify(eligibilityFixture().original.snapshot)
      .replaceAll('"hero"', '"20000000-0000-4000-8000-000000000001"')
      .replaceAll('"villain"', '"20000000-0000-4000-8000-000000000002"')
  );
  const t = original.gameState.tournament;
  Object.assign(t.contextProvenance.projection, { tableId: table, handNumber: 123 });
  const { contextProvenance, ...captured } = t;
  contextProvenance.source.contextDigest = createHash('sha256')
    .update(JSON.stringify(captured))
    .digest('hex');
  original.gameState.boardCount = 1;
  mutate?.(original);
  return fixture('fold', undefined, { hero: original.player, state: original.gameState });
}
for (const status of ['eligible', 'excluded', 'gap'])
  it(`derives closed ${status} from the actual original-bound tournament snapshot`, () => {
    const f = tournamentOriginal(
      status === 'excluded'
        ? (s: any) => (s.gameState.tournament.registrationOpen = true)
        : status === 'gap'
          ? (s: any) => (s.gameState.chipUnit = undefined)
          : undefined
    );
    const expected = classifyTournamentRiverSnapshot(f.capture.snapshot),
      out = inspect(f);
    expect(expected, JSON.stringify(expected)).toMatchObject({ status });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'observed' });
    expect(out.cases[0].phase14).toEqual({
      ...expected,
      reason: expected.status === 'eligible' ? null : expected.reason,
      derivedFromOriginalSnapshot: true,
    });
    const checked = sanitize(f, out);
    expect(checked.status, checked.stderr).toBe(0);
  });
it('keeps optional classifier unavailability independent of bound selection facts', () => {
  const f = tournamentOriginal(),
    out = inspect(f, { ...api, classifyTournamentRiverSnapshot: undefined });
  expect(out).toMatchObject({ status: 'observed' });
  expect(out.cases[0]).toMatchObject({
    selection: { matched: true },
    phase14: { status: 'unknown', reason: 'installed_classifier_unavailable' },
  });
  const checked = sanitize(f, out);
  expect(checked.status, checked.stderr).toBe(0);
});
it('preserves all six original targets under the hard 8KiB output and 64KiB helper bounds', () => {
  const cases: any[] = [],
    recordsByHand: any[] = [];
  for (let i = 0; i < 6; i++) {
    const old = fixture('check'),
      tableId = `12345678-abcd-4321-abcd-${String(i + 100).padStart(12, '0')}`,
      leaseId = `22345678-abcd-4321-abcd-${String(i + 100).padStart(12, '0')}`,
      committed = `32345678-abcd-4321-abcd-${String(i + 100).padStart(12, '0')}`;
    const change = (v: any) =>
      JSON.parse(
        JSON.stringify(v)
          .replaceAll(table, tableId)
          .replaceAll(lease, leaseId)
          .replaceAll(handId, committed)
      );
    const capture = change(old.capture),
      hand = change(old.hand),
      s = capture.snapshot;
    s.decisionKey = buildHorseDecisionKey(s);
    const w = witness.createHorseExecutionWitness(s, capture.decision, {
      requestId: 9,
      lane: 'fast',
      computeMs: 1,
      governorScale: 1,
    });
    witness.settleHorseExecutionWitness(w, {
      applied: true,
      acceptedActions: [{ record: hand.actions[3], intended: true }],
    });
    const handKey = records.journalHash(`${tableId}:123:${leaseId}`),
      turnKey = records.journalHash(
        JSON.stringify([7, s.fence, 9, s.decisionKey, s.decisionTimeMs])
      );
    cases.push({
      ...old.input.cases[0],
      tableId,
      leaseGeneration: leaseId,
      handId: committed,
      handKey,
    });
    const make = (kind: any, n: number, body: any) =>
      records.makeHorseJournalRecord(
        {
          producerId: producer,
          sequence: i * 3 + n,
          atMs: 2000,
          sourceRelease: source,
          kind,
          handKey,
          turnKey: kind === 'accepted_hand' ? handKey : turnKey,
        },
        body
      );
    recordsByHand.push({
      handKey,
      records: [
        make('decision', 1, capture),
        make('execution', 2, w),
        make('accepted_hand', 3, hand),
      ],
    });
  }
  const f = {
      input: { version: 7, probe: 'original_turn_gap', sourceRelease: source, cases },
      batch: { status: 'canonical_journal_export', sourceRelease: source, recordsByHand },
    },
    out = inspect(f);
  expect(out.cases).toHaveLength(6);
  expect(out.cases.map((c: any) => c.handKey)).toEqual(cases.map((c) => c.handKey));
  expect(out.cases.some((c: any) => c.status === 'observed')).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(8192);
  const checked = sanitize(f, out);
  expect(checked.status, checked.stderr).toBe(0);
  const helper = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import pathlib,sys; print(pathlib.Path(sys.argv[1]).stat().st_size)',
      resolve('../scripts/ci/horse-tournament-predicate-proof.mjs'),
    ],
    { encoding: 'utf8' }
  );
  expect(Number(helper.stdout)).toBeLessThanOrEqual(65536);
});
it('uses the existing child transport with the v7 installed API and strict sanitizer', () => {
  const f = fixture('check'),
    out = inspect(f);
  const code =
    'import json,runpy,sys,pathlib\nm=runpy.run_path(sys.argv[1]);d=json.loads(sys.stdin.read());f=m["decision_case_diagnostic"];g=f.__globals__;g["TOURNAMENT_PREDICATE_JS"]=pathlib.Path(sys.argv[2]).read_text()\ndef transport(args,**kw):\n assert "--max-old-space-size=128" in args\n js=args[args.index("-e")+1]; assert "loadInstalledOriginalTurnGapApi" in js and "inspectOriginalTurnGapRecords" in js\n assert json.loads(kw["input_bytes"])==d["input"]\n return json.dumps(d["result"])\ng["bounded_command"]=transport\nprint(json.dumps(f(d["input"])))';
  const r = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      code,
      resolve('../scripts/ci/inspect-tournament-refill.py'),
      resolve('../scripts/ci/horse-tournament-predicate-proof.mjs'),
    ],
    { input: JSON.stringify({ input: f.input, result: out }), encoding: 'utf8', timeout: 5000 }
  );
  expect(r.status, r.stderr).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual(out);
});

function riverFixture(
  checked = true,
  action = 'bet',
  mutate?: (g: any, hero: any) => void,
  change?: (x: any) => void
) {
  const f = fixture(action, change, undefined, (hero, g) => {
    const card = (s: string) => ({
      rank: s[0],
      suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as any)[s[1]],
    });
    hero.cards = ['Kc', 'Kh', 'Ac', '7d', '6d'].map(card);
    g.communityCards = ['9c', '4s', 'Qd', '9h', 'Ks'].map(card);
    g.dealerSeat = 2;
    g.bettingStructure = 'pot_limit';
    g.boardCount = 1;
    const before = g.players.find((p: any) => p.seat === 3),
      behind = g.players.find((p: any) => p.seat === 2);
    const a = (p: any, action: string, stage: string, amount = 0) => ({
      userId: p.user_id,
      seat: p.seat,
      action,
      stage,
      amount,
      timestamp: 10,
    });
    g.actionHistory = checked
      ? [
          a(before, 'bet', 'turn', 3),
          a(hero, 'call', 'turn', 3),
          a(behind, 'call', 'turn', 3),
          a(before, 'check', 'river'),
        ]
      : [
          a(before, 'check', 'turn'),
          a(hero, 'check', 'turn'),
          a(behind, 'bet', 'turn', 3),
          a(before, 'call', 'turn', 3),
          a(hero, 'call', 'turn', 3),
          a(before, 'check', 'river'),
        ];
    mutate?.(g, hero);
  });
  f.input.version = 8;
  f.input.probe = 'river_value';
  return f;
}
const riverInspect = (f: any, extra: any = {}) =>
  riverDiagnostic.inspectRiverValueRecords(
    f.input,
    f.batch,
    { ...api, omahaQuickCategory, ...extra },
    diagnostic.inspectOriginalTurnGapRecords
  );
function riverSanitize(f: any, result: any) {
  return spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import json,runpy,sys; m=runpy.run_path(sys.argv[1]); d=json.loads(sys.stdin.read()); print(json.dumps(m["sanitize_river_value_result"](d["result"],d["input"])))',
      resolve('../scripts/ci/inspect-tournament-refill.py'),
    ],
    { input: JSON.stringify({ input: f.input, result }), encoding: 'utf8' }
  );
}
it.each(['bet', 'check'])(
  'river value mode binds natural %s without claiming cause or EV',
  (action) => {
    const f = riverFixture(true, action),
      out = riverInspect(f);
    expect(out, JSON.stringify(out)).toMatchObject({
      status: 'observed',
      causalReplayVerified: false,
      gtoVerified: false,
      cases: [
        {
          initiative: 'aggressor_checked',
          actions: { accepted: action },
          baselineAttribution: 'unavailable',
        },
      ],
    });
    expect(riverSanitize(f, out).status).toBe(0);
    expect(JSON.stringify(out)).not.toContain('cards');
  }
);
it('requires installed non-bottom eligibility for pending aggressor, with unavailable distinct from false', () => {
  const f = riverFixture(false);
  expect(riverInspect(f).cases[0].reason).toBe('eligibility_unavailable');
  expect(riverInspect(f, { checkedToNonBottomRiverBoat: () => false }).cases[0].reason).toBe(
    'outside_nonbottom_context'
  );
  const out = riverInspect(f, { checkedToNonBottomRiverBoat: () => true });
  expect(out.cases[0].initiative).toBe('nonbottom_aggressor_pending');
  expect(riverSanitize(f, out).status).toBe(0);
});
it.each(['variant', 'hilo', 'boards', 'bet', 'cards', 'history'])(
  'river value refuses unsupported %s',
  (kind) => {
    const f = riverFixture(true, 'bet', (g) => {
      if (kind === 'variant') g.gameVariant = 'nlh';
      if (kind === 'hilo') g.variantRules = { ...g.variantRules, splitLow8OrBetter: true };
      if (kind === 'boards') g.boardCount = 2;
      if (kind === 'bet') g.currentBet = 5;
      if (kind === 'cards') g.communityCards = g.communityCards.slice(0, 4);
      if (kind === 'history')
        g.actionHistory = g.actionHistory.filter((a: any) => a.stage !== 'river');
    });
    expect(riverInspect(f).status).toBe('unknown');
  }
);
it('river value refuses source mismatch, corrupted acceptance, and private output extension', () => {
  const f = riverFixture();
  expect(riverInspect({ ...f, batch: { ...f.batch, sourceRelease: 'b'.repeat(40) } }).status).toBe(
    'unknown'
  );
  const broken = {
    ...f,
    batch: {
      ...f.batch,
      recordsByHand: [
        {
          ...f.batch.recordsByHand[0],
          records: f.rows.filter((r: any) => r.kind !== 'accepted_hand'),
        },
      ],
    },
  };
  expect(riverInspect(broken).cases[0].reason).toBe('accepted_hand_missing_or_ambiguous');
  const out = riverInspect(f);
  out.cases[0].cards = ['private'];
  expect(riverSanitize(f, out).status).not.toBe(0);
});
it('river value metadata is bounded, exact and wired into existing host inspector', () => {
  const f = riverFixture();
  const run = (input: any) =>
    spawnSync(
      'python3',
      [
        '-B',
        resolve('../scripts/ci/inspect-tournament-refill.py'),
        '--encode-reference-cases',
        source,
      ],
      { input: JSON.stringify(input), encoding: 'utf8' }
    );
  expect(run(f.input).status).toBe(0);
  expect(run({ ...f.input, cases: Array(7).fill(f.input.cases[0]) }).status).not.toBe(0);
  expect(run({ ...f.input, command: 'private' }).status).not.toBe(0);
});
it('routes v8 through the fixed bounded host adapter and sanitizer', () => {
  const f = riverFixture(),
    out = riverInspect(f);
  const run = spawnSync(
    'python3',
    [
      '-B',
      '-c',
      `import json,runpy,sys
from pathlib import Path
m=runpy.run_path(sys.argv[1]);d=json.loads(sys.stdin.read());g=m['decision_case_diagnostic'].__globals__
g['TOURNAMENT_PREDICATE_JS']=Path(sys.argv[1]).with_name('horse-tournament-predicate-proof.mjs').read_text()
g['RIVER_VALUE_JS']=Path(sys.argv[1]).with_name('horse-river-value-proof.mjs').read_text()
def bounded(args,**kwargs):
 assert args[:4]==['docker','exec','-i','club-arena-engine']
 assert 'inspectRiverValueRecords(input,batch,api,inspectOriginalTurnGapRecords)' in args[8]
 assert 'loadInstalledRiverValueApi(loadInstalledOriginalTurnGapApi)' in args[8]
 assert json.loads(kwargs['input_bytes'])==d['input']
 return json.dumps(d['result'])
g['bounded_command']=bounded
print(json.dumps(m['decision_case_diagnostic'](d['input'])))`,
      resolve('../scripts/ci/inspect-tournament-refill.py'),
    ],
    { input: JSON.stringify({ input: f.input, result: out }), encoding: 'utf8' }
  );
  expect(run.status, run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual(out);
});

function fleetFixture(memory = false, action = 'bet', variant?: 'flh' | 'flo8') {
  const f = riverFixture(true, action, (g, hero) => {
    if (variant) {
      g.gameVariant = variant;
      g.fixedBetSize = 4;
      g.bettingStructure = 'fixed_limit';
      g.minRaiseTo = g.maxRaiseTo = 4;
      hero.cards = hero.cards.slice(0, variant === 'flh' ? 2 : 4);
    }
    if (action === 'all_in')
      Object.assign(g, { currentBet: 0, toCall: 0, legalActions: ['check', 'bet', 'all_in'] });
    if (memory) g.publicMemoryDomain = { version: 1, speed: 'table', ante: 'none' };
  });
  if (memory) {
    const context = {
      ...historyContext.horseObserverReadContextFromRequest(f.capture.snapshot)!,
      version: 2,
      publicMemoryDomain: structuredClone(f.capture.snapshot.gameState.publicMemoryDomain),
    };
    f.capture.observerReads = {
      version: 3,
      individualVersion: 1,
      disposition: 'pooled_public',
      context,
      cutoffMs: 1000,
      learnedThroughMs: 900,
      history: 'volatile_only',
      pooledPublicProfiles: {
        version: 1,
        source: 'accepted_hand_public_profiles',
        availableAtMs: 900,
        digest: 'c'.repeat(64),
        profiles: 1,
      },
    };
    f.rows[0] = f.make('decision', 1, f.capture);
  }
  const c = f.input.cases[0];
  f.input = {
    version: 9,
    probe: 'fleet_slice',
    sourceRelease: source,
    expectedInstanceId: '1-test',
    window: { startUtc: '1970-01-01T00:00:00.000Z', endUtc: '1970-01-01T00:00:03.000Z' },
    roster: {
      digest: 'd'.repeat(64),
      total: 1000,
      horseIds: [c.actorId, '99999999-0000-4000-8000-000000000000'],
    },
    cases: [
      {
        handKey: c.handKey,
        tableId: c.tableId,
        handId: c.handId,
        handNumber: c.handNumber,
        leaseGeneration: c.leaseGeneration,
      },
    ],
  };
  return f;
}
function fleetInspect(f: any, extra: any = {}, clock?: () => number) {
  return fleetDiagnostic.inspectHorseFleetSlice(
    f.input,
    f.batch,
    { ...api, omahaQuickCategory, ...extra },
    diagnostic.inspectOriginalTurnGapRecords,
    riverDiagnostic.inspectRiverValueRecords,
    clock
  );
}
function fleetPython(
  f: any,
  result: any,
  code = 'print(json.dumps(m["sanitize_fleet_slice_result"](d["result"],d["input"])))'
) {
  return spawnSync(
    'python3',
    [
      '-B',
      '-c',
      'import json,runpy,sys; m=runpy.run_path(sys.argv[1]); d=json.loads(sys.stdin.read()); ' +
        code,
      resolve('../scripts/ci/inspect-tournament-refill.py'),
    ],
    { input: JSON.stringify({ input: f.input, result }), encoding: 'utf8', timeout: 5000 }
  );
}
it('fleet slice binds accepted source and keeps dormant Horse and missing memory unobserved', () => {
  const f = fleetFixture(),
    out = fleetInspect(f),
    r = out.hands[0].rows[0];
  expect(out).toMatchObject({
    status: 'observed',
    completePopulation: false,
    strategyApplicationVerified: false,
    rosterAuthority: 'externally_supplied_unverified',
    selectedHands: 1,
    inspectedHands: 1,
  });
  expect(out.selectedHorseHashes).toHaveLength(2);
  expect(out.hands[0].rows).toHaveLength(1);
  expect(r).toMatchObject({
    acceptedActions: 1,
    sourceWitnesses: 1,
    selectionMatched: 1,
    qualifyingRiver: 1,
    acceptedValueBets: 1,
    exactMemoryReads: 0,
    gaps: { exact_memory_unavailable: 1 },
  });
  expect(fleetPython(f, out).status).toBe(0);
  expect(JSON.stringify(out)).not.toContain(f.capture.snapshot.player.user_id);
  expect(JSON.stringify(out)).not.toContain('cards');
});
it('fleet slice observes exact original domain memory without equating receipt to strategy application', () => {
  const f = fleetFixture(true),
    out = fleetInspect(f);
  expect(
    fleetInspect(f, { horseObserverReadsUsedPublicPool: undefined }).hands[0].rows[0]
      .exactMemoryReads
  ).toBe(0);
  expect(
    fleetInspect(f, { horseObserverReadsUsedPublicPool: () => false }).hands[0].rows[0]
      .exactMemoryReads
  ).toBe(0);
  expect(out.strategyApplicationVerified).toBe(false);
  expect(out.hands[0].rows[0]).toMatchObject({
    exactMemoryReads: 1,
    contexts: [{ speed: 'table', ante: 'none', exactMemoryReads: 1 }],
  });
  expect(fleetPython(f, out).status).toBe(0);
});
it.each(['speed', 'ante', 'variant', 'format', 'future'])(
  'fleet slice refuses mismatched or future memory %s',
  (key) => {
    const f = fleetFixture(true),
      m = f.capture.observerReads;
    if (key === 'speed') m.context.publicMemoryDomain.speed = 'lightning';
    if (key === 'ante') m.context.publicMemoryDomain.ante = 'big_blind';
    if (key === 'variant') m.context.variant = 'plo4';
    if (key === 'format') m.context.format = 'tournament';
    if (key === 'future') m.pooledPublicProfiles.availableAtMs = 1001;
    f.rows[0] = f.make('decision', 1, f.capture);
    expect(fleetInspect(f).hands[0].rows[0].exactMemoryReads).toBe(0);
  }
);
it.each(['source', 'acceptance', 'duplicate', 'window', 'missing'])(
  'fleet slice never counts unverified %s chains',
  (kind) => {
    const f = fleetFixture();
    if (kind === 'source') f.batch.sourceRelease = 'b'.repeat(40);
    if (kind === 'acceptance') {
      f.hand.actions.at(-1).amount = 99;
      f.rows[2] = f.make('accepted_hand', 3, f.hand);
    }
    if (kind === 'duplicate') f.rows.push(f.rows[0]);
    if (kind === 'window') f.input.window.startUtc = '1970-01-01T00:00:01.500Z';
    if (kind === 'missing') f.rows.splice(0, 1);
    const out = fleetInspect(f);
    expect(out.status).not.toBe('observed');
    expect(out.hands?.[0]?.rows?.[0]?.sourceWitnesses ?? 0).toBe(0);
    expect(fleetPython(f, out).status).toBe(0);
  }
);
it('fleet slice refuses duplicate roster and marks reached execution budget partial', () => {
  const f = fleetFixture();
  f.input.roster.horseIds.push(f.input.roster.horseIds[0]);
  expect(fleetInspect(f)).toMatchObject({ status: 'unknown', reason: 'input_refused' });
  f.input.roster.horseIds.pop();
  let t = 0;
  const out = fleetInspect(f, {}, () => {
    t += 10001;
    return t;
  });
  expect(out).toMatchObject({ status: 'partial', boundReached: true, inspectedHands: 0 });
  expect(fleetPython(f, out).status).toBe(0);
});
it('fleet slice input and output remain closed metadata with fixed cutoff and real hand coordinates', () => {
  const f = fleetFixture(),
    out = fleetInspect(f);
  const validate =
    'print(json.dumps(m["reference_case_metadata"](json.dumps(d["input"]).encode(),d["input"]["sourceRelease"])))';
  expect(fleetPython(f, out, validate).status).toBe(0);
  for (const change of [
    (x: any) => x.roster.horseIds.push(x.roster.horseIds[0]),
    (x: any) => (x.window.endUtc = '9999-01-01T00:00:00.000Z'),
    (x: any) => x.cases.push(x.cases[0]),
    (x: any) => (x.cases[0].command = 'id'),
  ]) {
    const bad = structuredClone(f.input);
    change(bad);
    expect(fleetPython({ input: bad }, out, validate).status).not.toBe(0);
  }
  for (const change of [
    (x: any) => (x.hands[0].raw = 'private'),
    (x: any) => (x.completePopulation = true),
    (x: any) => (x.hands[0].rows[0].exactMemoryReads = 2),
    (x: any) => (x.hands[0].rows[0].horseHash = 'e'.repeat(64)),
  ]) {
    const bad = structuredClone(out);
    change(bad);
    expect(fleetPython(f, bad).status).not.toBe(0);
  }
});

it('fleet slice inspects two real actor chains in one retained accepted hand', () => {
  const f = fleetFixture(false, 'check');
  const state = structuredClone(f.capture.snapshot.gameState);
  const hero = state.players.find((p: any) => p.seat === 2);
  hero.stack = 100;
  hero.bet = 0;
  hero.cards = f.capture.snapshot.player.cards;
  state.currentPlayerSeat = 2;
  const second = fixture('check', undefined, { hero, state }, (_hero, g) => {
    g.actionHistory = structuredClone(f.hand.actions);
  });
  second.hand.actions = [...f.hand.actions, second.hand.actions.at(-1)];
  const rows = [
    f.rows[0],
    f.rows[1],
    second.make('decision', 4, second.capture),
    second.make('execution', 5, second.w),
    second.make('accepted_hand', 6, second.hand),
  ];
  f.batch.recordsByHand[0].records = rows;
  f.input.roster.horseIds = [f.capture.snapshot.player.user_id, hero.user_id];
  const out = fleetInspect(f);
  expect(
    review.reconcileHorseJournalHand(rows, f.input.cases[0].handKey),
    JSON.stringify(review.reconcileHorseJournalHand(rows, f.input.cases[0].handKey))
  ).toMatchObject({ status: 'reconciled' });
  expect(out, JSON.stringify(out)).toMatchObject({
    status: 'observed',
    hands: [{ selectedActions: 2, inspectedActions: 2 }],
  });
  expect(out.hands[0].rows.map((r: any) => r.sourceWitnesses)).toEqual([1, 1]);
  expect(fleetPython(f, out).status).toBe(0);
});
it('fleet slice adapter uses only fixed installed APIs and private bounded export', () => {
  const f = fleetFixture(),
    out = fleetInspect(f);
  const code = `
from pathlib import Path
g=m['decision_case_diagnostic'].__globals__
for name,file in [('TOURNAMENT_PREDICATE_JS','horse-tournament-predicate-proof.mjs'),('RIVER_VALUE_JS','horse-river-value-proof.mjs'),('FLEET_SLICE_JS','horse-fleet-slice-proof.mjs')]:
 g[name]=Path(sys.argv[1]).with_name(file).read_text()
def bounded(args,**kwargs):
 assert args[:4]==['docker','exec','-i','club-arena-engine']
 assert 'inspectHorseFleetSlice(input,batch,api,inspectOriginalTurnGapRecords,inspectRiverValueRecords)' in args[8]
 assert 'loadInstalledFleetSliceApi(loadInstalledRiverValueApi,loadInstalledOriginalTurnGapApi)' in args[8]
 assert json.loads(kwargs['input_bytes'])==d['input']
 return json.dumps(d['result'])
g['bounded_command']=bounded
print(json.dumps(m['decision_case_diagnostic'](d['input'])))`;
  const run = fleetPython(f, out, code);
  expect(run.status, run.stderr).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual(out);
});
it('river value projects retained outer policy ownership and graph without private amounts or feature text', () => {
  const decision = {
    policyOwnership: {
      owner: 'phase11',
      mode: 'candidate',
      outcome: 'computed',
      reason: 'reference_retained',
    },
    omahaVariantPolicy: {
      mode: 'candidate',
      eligible: true,
      fired: true,
      changed: false,
      applied: false,
      reason: 'reference_retained',
      baselineAction: 'check',
      proposalAction: 'check',
      finalAction: 'check',
      selection: 'none',
      selectionRefusal: null,
      features: ['PRIVATE'],
      baselineAmount: 123,
    },
    policyGraph: {
      version: 'horse-policy-order-v3',
      finalAction: { action: 'check', amount: 123 },
      transitions: [
        { node: 'reference', before: null, after: { action: 'check', amount: 123 }, changed: true },
      ],
    },
  };
  const out = riverDiagnostic.riverValuePolicyTrace(decision, {
    ...decision,
    phase11Authority: { selection: 'withdrawn_before_acceptance' },
  });
  expect(out).toMatchObject({
    scope: 'outer_receipts_only',
    decisionOwnership: { reason: 'reference_retained' },
    omahaVariant: { baselineAction: 'check' },
    executionPhase11Selection: 'withdrawn_before_acceptance',
  });
  expect(JSON.stringify(out)).not.toMatch(/PRIVATE|123|amount/);
  const f = riverFixture();
  const projected = riverInspect(f);
  projected.cases[0].policyTrace = out;
  expect(riverSanitize(f, projected).status).toBe(0);
  decision.policyOwnership.reason = 'private arbitrary text';
  decision.omahaVariantPolicy.reason = 'private arbitrary text';
  expect(riverDiagnostic.riverValuePolicyTrace(decision, {})).toMatchObject({
    decisionOwnership: null,
    omahaVariant: null,
  });
  projected.cases[0].policyTrace.executionGraph.transitions[0].amount = 123;
  expect(riverSanitize(f, projected).status).not.toBe(0);
});

it('fleet slice rejects instance, health or container changes through the host identity guard', () => {
  const f = fleetFixture(),
    code = `
a={'instanceId':'1-test','health':'ok','containerId':'a','imageId':'b'}
assert m['fleet_runtime_identity_matches'](d['input'],a,a)
for k,v in [('instanceId','1-other'),('health','unavailable'),('containerId','c'),('imageId','c')]:
 b={**a,k:v}
 assert not m['fleet_runtime_identity_matches'](d['input'],a,b)
assert not m['fleet_runtime_identity_matches']({**d['input'],'expectedInstanceId':'other'},a,a)
print('ok')`;
  const run = fleetPython(f, {}, code);
  expect(run.status, run.stderr).toBe(0);
});

it('fleet slice counts a qualifying accepted all-in separately from ordinary value bets', () => {
  const f = fleetFixture(false, 'all_in'),
    out = fleetInspect(f);
  expect(out.hands[0].rows[0]).toMatchObject({
    qualifyingRiver: 1,
    acceptedAllIns: 1,
    acceptedValueBets: 0,
  });
  expect(fleetPython(f, out).status).toBe(0);
});

for (const variant of ['flh', 'flo8'] as const)
  it(`fleet slice retains fixed-limit ${variant} source witnesses without river-value qualification`, () => {
    const f = fleetFixture(false, 'check', variant),
      out = fleetInspect(f);
    expect(out.hands[0].rows[0]).toMatchObject({
      sourceWitnesses: 1,
      selectionMatched: 1,
      qualifyingRiver: 0,
      exactMemoryReads: 0,
      contexts: [expect.objectContaining({ variant })],
    });
    expect(out).toMatchObject({ strategyApplicationVerified: false, activationAllowed: false });
    expect(fleetPython(f, out).status).toBe(0);
    out.hands[0].rows[0].contexts[0].variant = 'unknown_limit';
    expect(fleetPython(f, out).status).not.toBe(0);
  });

function originalWagerFixture(facing: boolean, mismatch = false) {
  const action = facing ? 'call' : 'bet';
  const f = riverFixture(
    true,
    action,
    (g, h) => {
      if (facing) {
        const bettor = g.players[1];
        for (const p of g.players) p.bet = 0;
        bettor.bet = 20;
        g.pot = 40;
        g.toCall = 20;
        g.currentBet = 20;
        g.actionHistory = [
          {
            seat: bettor.seat,
            userId: bettor.user_id,
            stage: 'river',
            action: 'bet',
            amount: 20,
            timestamp: 1,
          },
        ];
      }
    },
    ({ capture, w }) => {
      const before = { action: facing ? 'fold' : 'check', amount: null },
        after = { action, amount: 20 };
      let previous: any = null;
      const graph = {
        version: HORSE_POLICY_GRAPH_VERSION,
        transitions: HORSE_POLICY_ORDER.map((node) => {
          const next = node === 'wager_rules' || node === 'timing' ? after : before;
          const t = {
            node,
            before: previous,
            after: next,
            changed: previous !== null && previous !== next,
            elapsedMs: 0,
          };
          previous = next;
          return t;
        }),
        finalAction: after,
      };
      capture.decision.policyGraph = graph;
      w.policyGraph = structuredClone(graph);
      if (mismatch) w.policyGraph.transitions.at(-2).before.amount = 17;
    }
  );
  f.input.version = 10;
  f.input.probe = 'original_wager_rules';
  return f;
}
const wagerInspect = (f: any) =>
  inspectOriginalWagerRules(
    f.input,
    f.batch,
    {
      ...api,
      checkedToNonBottomRiverBoat,
      omahaQuickCategory,
      omahaBoatPosition,
      hasRiverNuts,
      horsePolicyOrderForVersion,
      v81StreetWager,
    },
    diagnostic.inspectOriginalTurnGapRecords
  );
function wagerTransport(input: unknown, result: unknown) {
  return spawnSync(
    'python3',
    [
      '-B',
      '-c',
      `import runpy,sys,json,pathlib
m=runpy.run_path(sys.argv[1]); d=json.loads(sys.stdin.read()); inp=d['input']; root=pathlib.Path(sys.argv[1]).parent
assert m['reference_case_metadata'](json.dumps(inp).encode(),inp['sourceRelease'])==inp
f=m['decision_case_diagnostic']; g=f.__globals__
for name,file in [('ORIGINAL_WAGER_JS','horse-original-wager-proof.mjs'),('RIVER_VALUE_JS','horse-river-value-proof.mjs'),('TOURNAMENT_PREDICATE_JS','horse-tournament-predicate-proof.mjs')]: g[name]=(root/file).read_text()
def transport(args,**kwargs):
 assert 'report=inspectOriginalWagerRules(input,batch,api,inspectOriginalTurnGapRecords)' in args[8]
 assert 'const api=await loadInstalledOriginalWagerApi(loadInstalledOriginalTurnGapApi,loadInstalledRiverValueApi)' in args[8]
 assert json.loads(kwargs['input_bytes'])==inp
 return json.dumps(d['result'])
g['bounded_command']=transport
print(json.dumps(f(inp)))`,
      resolve('../scripts/ci/inspect-tournament-refill.py'),
    ],
    { input: JSON.stringify({ input, result }), encoding: 'utf8' }
  );
}
it.each([false, true])(
  'v10 verifies both original graphs and accepted wager, facing=%s',
  (facing) => {
    const f = originalWagerFixture(facing),
      out = wagerInspect(f);
    expect(out.cases[0]).toMatchObject({
      status: 'observed',
      opportunity: facing ? 'facing_opening_pot_bet' : 'checked_to',
      wagerRules: {
        before: { action: facing ? 'fold' : 'check', amount: null },
        after: { action: facing ? 'call' : 'bet', amount: 20 },
        changed: true,
      },
    });
    const transport = wagerTransport(f.input, out);
    expect(transport.status, transport.stderr).toBe(0);
    expect(JSON.parse(transport.stdout)).toEqual(out);
    if (facing) {
      const malformed = structuredClone(out);
      malformed.cases[0].wagerRules.before.cards = ['private'];
      expect(JSON.parse(wagerTransport(f.input, malformed).stdout).status).toBe('unknown');
    }
  }
);
it('v10 refuses divergent signed graph observations', () => {
  const f = originalWagerFixture(true, true);
  expect(wagerInspect(f).cases[0].status).toBe('unknown');
});
