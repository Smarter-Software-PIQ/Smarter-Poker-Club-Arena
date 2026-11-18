/**
 * The offline style re-run's row logic, over a stand-in exact replay whose decision depends on the switch states
 * only. The end-to-end path (a real journaled decision, real exact replay) is in exactReplay.test.ts.
 *
 * Review finding B1/B2 (2026-11-13): the turn and the executed lane are tested on the journal's own records of one
 * turn, FAST request 435750 and its DEEP second look 435768 with their two execution witnesses, exactly as the
 * engine host wrote them (fixtures/phase6c-journal-sample.ndjson).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PHASE6C_FIXTURE_IDS as IDS,
  loadPhase6cFixtureRecords,
  phase6cFixtureBody,
  phase6cFixtureRecord,
  resignHorseJournalRecord,
} from './fixtures/index.js';
import type { HorseJournalRecord } from '../../../services/horseDecisionJournal/record.js';
import {
  STYLE_SWITCH_SOURCE_DEFAULT,
  styleCanaryBucket,
  type StyleSwitchStates,
} from '../../HorseStyleSwitch.js';

const replay = vi.hoisted(() => ({
  baselineOutcome: 'replayed_exact' as string,
  /** the action a decision takes for the given styleFoldBluff treatment */
  decide: (fbOn: boolean) => (fbOn ? 'fold' : 'call'),
  /** a broken re-run: the recorded arm decides differently from the baseline */
  liveArmDiffers: false,
}));

vi.mock('./exactReplay.js', () => ({
  exactReplayHorseDecisionRecord: async (
    raw: { body: string },
    options: { styleStatesOverride?: StyleSwitchStates }
  ) => {
    const body = JSON.parse(raw.body);
    const states: StyleSwitchStates = options.styleStatesOverride ?? body.replayState.style;
    const id: string = body.snapshot.player.user_id;
    const fb = states.styleFoldBluff;
    const on = fb === 'on' || (fb === 'canary' && styleCanaryBucket(id) === 0);
    const baseline = !options.styleStatesOverride;
    const action = replay.liveArmDiffers && !baseline && fb === 'off' ? 'check' : replay.decide(on);
    return {
      outcome: baseline ? replay.baselineOutcome : 'replayed_mismatch',
      replayed: { action, amount: action === 'call' ? 100 : null, rngAfter: 1, effects: 0 },
      context: { gameMode: 'cash', format: 'cash', variant: 'nlh', stage: 'river' },
    };
  },
}));

const {
  styleShadowCountedRows,
  styleShadowExecution,
  styleShadowRerunRecord,
  styleShadowRerunCsvLine,
  styleShadowTurnIdentity,
} = await import('./styleShadowRerun.js');

const TABLE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OUTSIDE = 'aaaaaaaa-0000-4000-8000-000000000001'; // canary bucket 4
const IN_CANARY = 'aaaaaaaa-0000-4000-8000-000000000010'; // canary bucket 0
const SOURCE = '5'.repeat(40);
/** the synthetic record's turn: the journal's turn key material without the request id */
const TURN_IDENTITY = createHash('sha256')
  .update(JSON.stringify([0, `${TABLE}:1000007:3:9:0`, 'decision-key', 1000]))
  .digest('hex');

/** The journal's own records of one turn: FAST request 435750 and its DEEP second look, request 435768. */
const realFast = phase6cFixtureRecord(IDS.tournamentAtlasEvaluated);
const realDeep = phase6cFixtureRecord(IDS.deepSecondLook);
const realOtherTurn = phase6cFixtureRecord(IDS.cashNlhRiver);
/** The join the script makes: the execution record under the decision record's own journal turn key. */
const witnessOf = (decision: HorseJournalRecord): HorseJournalRecord => {
  const found = loadPhase6cFixtureRecords().filter(
    (r) => r.kind === 'execution' && r.turnKey === decision.turnKey
  );
  if (found.length !== 1) throw new Error(`expected one witness, found ${found.length}`);
  return found[0];
};
const snapshotOf = (record: HorseJournalRecord) =>
  phase6cFixtureBody<{ snapshot: Record<string, unknown> }>(record).snapshot;
/** The sample is older than the switch states: give the record the states it would carry today, nothing else. */
const withShadow = (record: HorseJournalRecord): HorseJournalRecord =>
  resignHorseJournalRecord(record, (body) => {
    body.replayState = {
      version: 'horse-decision-replay-state-v4',
      style: { ...STYLE_SWITCH_SOURCE_DEFAULT, styleFoldBluff: 'shadow' },
    };
  });
const withStatus = (
  witness: HorseJournalRecord,
  executionStatus: unknown,
  retirementReason: string | null = null
): HorseJournalRecord =>
  resignHorseJournalRecord(witness, (body) => {
    body.executionStatus = executionStatus;
    body.retirementReason = retirementReason;
  });

function record(style: Partial<StyleSwitchStates> | null, horse = OUTSIDE) {
  return {
    kind: 'decision',
    eventId: 'event-1',
    turnKey: 'turn-1',
    body: JSON.stringify({
      replayState: {
        version: style ? 'horse-decision-replay-state-v4' : 'horse-decision-replay-state-v3',
        ...(style ? { style: { ...STYLE_SWITCH_SOURCE_DEFAULT, ...style } } : {}),
      },
      snapshot: {
        type: 'DECIDE_FAST',
        requestId: 7,
        decisionKey: 'decision-key',
        decisionTimeMs: 1000,
        fence: `${TABLE}:1000007:3:9:0`,
        generation: 0,
        player: { seat: 3, user_id: horse, bet: 0 },
        gameState: {
          stage: 'river',
          gameMode: 'cash',
          pot: 300,
          currentBet: 100,
          // the Horse already checked this river (ordinal 1); its flop bet and the opponent's bet do not count
          actionHistory: [
            { userId: horse, stage: 'flop', action: 'bet', amount: 50 },
            { userId: horse, stage: 'river', action: 'check', amount: 0 },
            { userId: 'opponent', stage: 'river', action: 'bet', amount: 100 },
          ],
        },
      },
    }),
  };
}

describe('offline style re-run rows', () => {
  it('shadow: one row, the committed off action against the option-on action, arm s, at the call price', async () => {
    const r = await styleShadowRerunRecord(record({ styleFoldBluff: 'shadow' }), {
      runningSource: SOURCE,
    });
    expect(r.status).toBe('rerun');
    expect(r.rerunOptions).toEqual(['styleFoldBluff']);
    expect(r.lane).toBe('fast');
    expect(r.rows).toEqual([
      {
        decision_id: 'event-1',
        turn_key: 'turn-1',
        turn_identity: TURN_IDENTITY,
        lane: 'fast',
        // no execution witness was joined: unknown, never executed
        executed: 'u',
        execution_status: 'none',
        street_ordinal: 1,
        table_id: TABLE,
        hand_number: 1000007,
        seat: 3,
        opt: 'fb',
        street: 'r',
        format: 'cash',
        actual: 'c',
        would_be: 'f',
        price: 0.25,
        confidence: null,
        arm: 's',
      },
    ]);
    expect(styleShadowRerunCsvLine(r.rows[0])).toBe(
      `event-1,turn-1,${TURN_IDENTITY},fast,u,none,1,${TABLE},1000007,3,fb,r,cash,c,f,0.25,,s`
    );
  });

  it('the real FAST and DEEP records of one turn: two journal turn keys, two witnesses, one turn identity', () => {
    const [fast, deep] = [snapshotOf(realFast), snapshotOf(realDeep)];
    expect([fast.type, fast.requestId]).toEqual(['DECIDE_FAST', 435750]);
    expect([deep.type, deep.requestId]).toEqual(['DECIDE_DEEP', 435768]);
    // the journal turn key hashes the request id, so it is one per lane and cannot say "same turn"
    expect(realFast.turnKey).toBe(
      '44c6aa3fbd1fbafceed502105421b6fa440fb8c11a5933600edcc4e47b69daf7'
    );
    expect(realDeep.turnKey).toBe(
      '2de1ebdd960c954d32c252ad1e0fda50e8edb73ae740cf422bfebadb2073e4ac'
    );
    // each lane has its own witness, and each witness names its own request
    for (const [record, snapshot] of [
      [realFast, fast],
      [realDeep, deep],
    ] as const)
      expect(
        phase6cFixtureBody<{ identity: { requestId: number } }>(witnessOf(record)).identity
          .requestId
      ).toBe(snapshot.requestId);
    // the turn identity is the same for both lanes and is another value for another turn
    expect(styleShadowTurnIdentity(fast)).toBe(
      '516436e5f17fb3cd2a90b5952b8faabba4952ff2aa87bbcbf7fe82df1059432a'
    );
    expect(styleShadowTurnIdentity(deep)).toBe(styleShadowTurnIdentity(fast));
    const all = loadPhase6cFixtureRecords()
      .filter((r) => r.kind === 'decision')
      .map((r) => styleShadowTurnIdentity(snapshotOf(r)));
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(7);
    expect(styleShadowTurnIdentity(snapshotOf(realOtherTurn))).toBe(
      'cd5b7ed949021adb19698b8605881e7dea4ef1341e8235b24ebef77c13771688'
    );
    // a snapshot without one of the four fields has no turn identity (and the re-run then gives no row)
    for (const field of ['generation', 'fence', 'decisionKey', 'decisionTimeMs'])
      expect(styleShadowTurnIdentity({ ...fast, [field]: undefined }), field).toBeNull();
  });

  it('the real pair re-run: the FAST decision executed, its DEEP look was retired; one turn is counted, on the executed lane', async () => {
    const rerun = async (record: HorseJournalRecord, execution: HorseJournalRecord | null) => {
      const r = await styleShadowRerunRecord(withShadow(record), {
        runningSource: SOURCE,
        execution,
      });
      expect(r.rows).toHaveLength(1);
      return r.rows[0];
    };
    const fast = await rerun(realFast, witnessOf(realFast));
    const deep = await rerun(realDeep, witnessOf(realDeep));
    expect([fast.lane, fast.executed, fast.execution_status]).toEqual(['fast', 't', 'intended']);
    // the witness exists and names the DEEP request: its presence is not execution
    expect([deep.lane, deep.executed, deep.execution_status]).toEqual([
      'deep',
      'f',
      'not_executed',
    ]);
    expect(fast.turn_key).not.toBe(deep.turn_key);
    expect(fast.turn_identity).toBe(deep.turn_identity);
    expect(fast.decision_id).not.toBe(deep.decision_id);
    // the option changed both lanes' decisions the same way: that is ONE changed decision, not two
    expect([fast.actual, fast.would_be, deep.actual, deep.would_be]).toEqual(['c', 'f', 'c', 'f']);
    const counted = styleShadowCountedRows([fast, deep]);
    expect(counted).toEqual([fast]);
    expect(styleShadowCountedRows([deep, fast])).toEqual([fast]);

    // the other outcome of a second look: it replaced the FAST decision and was executed
    const replacedFast = await rerun(
      realFast,
      withStatus(witnessOf(realFast), 'not_executed', 'second_look_replaced')
    );
    const executedDeep = await rerun(realDeep, withStatus(witnessOf(realDeep), 'intended'));
    expect([replacedFast.executed, executedDeep.executed]).toEqual(['f', 't']);
    expect(styleShadowCountedRows([replacedFast, executedDeep])).toEqual([executedDeep]);
    // neither lane executed (the turn was abandoned), or nothing known: no changed decision is counted
    const abandoned = await rerun(
      realFast,
      withStatus(witnessOf(realFast), 'not_executed', 'turn_abandoned')
    );
    const unknown = await rerun(realFast, null);
    expect([abandoned.executed, unknown.executed, unknown.execution_status]).toEqual([
      'f',
      'u',
      'none',
    ]);
    expect(styleShadowCountedRows([abandoned, deep, unknown])).toEqual([]);
    // another turn is another count
    const other = await rerun(realOtherTurn, witnessOf(realOtherTurn));
    expect(other.executed).toBe('t');
    expect(styleShadowCountedRows([fast, deep, other])).toEqual([fast, other]);
  });

  it('executed comes from the witness status of this request only; unknown is never executed', () => {
    const snapshot = snapshotOf(realFast);
    const witness = witnessOf(realFast);
    const of = (execution: unknown) =>
      styleShadowExecution(execution, realFast as unknown as Record<string, unknown>, snapshot);
    const none = { executed: 'u', execution_status: 'none' };
    expect(of(witness)).toEqual({ executed: 't', execution_status: 'intended' });
    expect(of(withStatus(witness, 'coerced'))).toEqual({
      executed: 't',
      execution_status: 'coerced',
    });
    for (const status of ['not_executed', 'fallback'])
      expect(of(withStatus(witness, status)), status).toEqual({
        executed: 'f',
        execution_status: status,
      });
    for (const status of ['unverified', 'pending'])
      expect(of(withStatus(witness, status)), status).toEqual({
        executed: 'u',
        execution_status: status,
      });
    // a status the witness never has, or none at all
    for (const status of ['executed', '', null, 1])
      expect(of(withStatus(witness, status)), String(status)).toEqual(none);
    expect(of(null)).toEqual(none);
    expect(of(undefined)).toEqual(none);
    expect(of({ ...witness, body: 'not json' })).toEqual(none);
    // the DEEP look's witness is the same decision key under another turn key and request: not this request's
    const deepWitness = withStatus(witnessOf(realDeep), 'intended');
    expect(of(deepWitness)).toEqual(none);
    expect(of({ ...deepWitness, turnKey: realFast.turnKey })).toEqual(none);
    // a decision record is not a witness
    expect(of(realFast)).toEqual(none);
  });

  it('canary: a Horse outside bucket 0 gives an arm c row; a bucket-0 Horse ran it on and gives an arm o row', async () => {
    expect(styleCanaryBucket(IN_CANARY)).toBe(0);
    const outside = await styleShadowRerunRecord(record({ styleFoldBluff: 'canary' }), {
      runningSource: SOURCE,
    });
    expect(outside.rows.map((x) => [x.arm, x.actual, x.would_be])).toEqual([['c', 'c', 'f']]);
    const inside = await styleShadowRerunRecord(record({ styleFoldBluff: 'canary' }, IN_CANARY), {
      runningSource: SOURCE,
    });
    expect(inside.rows.map((x) => [x.arm, x.actual, x.would_be])).toEqual([['o', 'f', 'c']]);
  });

  it('no change gives no row; every option that is not off is re-run', async () => {
    replay.decide = () => 'call';
    try {
      const r = await styleShadowRerunRecord(
        record({ styleFoldBluff: 'shadow', styleRaiseRespect: 'on', styleBigBetHonesty: 'canary' }),
        { runningSource: SOURCE }
      );
      expect(r.rows).toEqual([]);
      expect(r.rerunOptions.sort()).toEqual(
        ['styleBigBetHonesty', 'styleFoldBluff', 'styleRaiseRespect'].sort()
      );
      expect(r.failedOptions).toEqual([]);
    } finally {
      replay.decide = (on) => (on ? 'fold' : 'call');
    }
  });

  it('refuses rather than guesses: all off, a baseline that is not exact, a live arm that is not the record', async () => {
    expect((await styleShadowRerunRecord(record(null), { runningSource: SOURCE })).status).toBe(
      'all_off'
    );
    replay.baselineOutcome = 'replayed_mismatch';
    try {
      const r = await styleShadowRerunRecord(record({ styleFoldBluff: 'shadow' }), {
        runningSource: SOURCE,
      });
      expect(r).toMatchObject({ status: 'baseline_not_exact', rows: [] });
    } finally {
      replay.baselineOutcome = 'replayed_exact';
    }
    replay.liveArmDiffers = true;
    try {
      const r = await styleShadowRerunRecord(record({ styleFoldBluff: 'shadow' }), {
        runningSource: SOURCE,
      });
      expect(r.failedOptions).toEqual(['styleFoldBluff']);
      expect(r.rows).toEqual([]);
    } finally {
      replay.liveArmDiffers = false;
    }
    const noHand = record({ styleFoldBluff: 'shadow' });
    noHand.body = noHand.body.replace(`${TABLE}:1000007`, 'not-a-table:1000007');
    expect((await styleShadowRerunRecord(noHand, { runningSource: SOURCE })).status).toBe(
      'no_hand_identity'
    );
  });
});
