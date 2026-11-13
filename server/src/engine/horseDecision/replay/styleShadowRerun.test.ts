/**
 * The offline style re-run's row logic, over a stand-in exact replay whose decision depends on the switch states
 * only. The end-to-end path (a real journaled decision, real exact replay) is in exactReplay.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
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

const { styleShadowRerunRecord, styleShadowRerunCsvLine } = await import('./styleShadowRerun.js');

const TABLE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const OUTSIDE = 'aaaaaaaa-0000-4000-8000-000000000001'; // canary bucket 4
const IN_CANARY = 'aaaaaaaa-0000-4000-8000-000000000010'; // canary bucket 0
const SOURCE = '5'.repeat(40);

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
        lane: 'fast',
        executed: null,
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
      `event-1,turn-1,fast,,1,${TABLE},1000007,3,fb,r,cash,c,f,0.25,,s`
    );
  });

  it('executed: t when the execution witness names this request, f when it names the other lane of the turn', async () => {
    const witness = (requestId: number) => ({
      body: JSON.stringify({ identity: { decisionKey: 'decision-key', requestId } }),
    });
    const run = async (execution: unknown) =>
      (
        await styleShadowRerunRecord(record({ styleFoldBluff: 'shadow' }), {
          runningSource: SOURCE,
          execution,
        })
      ).rows[0].executed;
    expect(await run(witness(7))).toBe('t');
    expect(await run(witness(8))).toBe('f');
    expect(await run(null)).toBeNull();
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
