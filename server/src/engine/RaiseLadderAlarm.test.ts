/**
 * THE LIVE RAISE-LADDER ALARM (RaiseLadderAlarm.ts): measurement only. The real HandController counts the run of
 * consecutive minimum raises per street and stamps the accepted record; the engine's handler fires
 * raise_ladder_<variant>_<horse_only|mixed>_seen once, on the 4th. Nothing about the action, the record, the event or
 * the menu changes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HandController } from './HandController.js';
import type { HandConfig, HandEvent, SeatPlayer } from '../types.js';
import { disarmBrainTelemetryForTest, drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  RAISE_LADDER_ALARM_RUN,
  carryRaiseLadder,
  noteRaiseLadder,
  raiseLadderAlarmOf,
  raiseLadderStampOf,
} from './RaiseLadderAlarm.js';

function mkPlayers(n: number, stack = 1000): SeatPlayer[] {
  return Array.from(
    { length: n },
    (_, i) =>
      ({
        seat: i + 1,
        user_id: `u${i + 1}`,
        username: `P${i + 1}`,
        stack,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      }) as SeatPlayer
  );
}
const mkConfig = (over: Partial<HandConfig> = {}): HandConfig =>
  ({
    tableId: 't1',
    handNumber: 1,
    gameVariant: 'nlh',
    smallBlind: 1,
    bigBlind: 2,
    rakeConfig: { percent: 5, cap: 100, noFlopNoDrop: true },
    ...over,
  }) as HandConfig;

function harness(config: HandConfig, players: number) {
  const events: HandEvent[] = [];
  const hc = new HandController(config, mkPlayers(players), 1);
  hc.onEvent((e) => events.push(e));
  hc.start();
  const cur = () =>
    (hc as unknown as { state: { currentPlayerSeat: number } }).state.currentPlayerSeat;
  const act = (action: string, amount?: number) => {
    const seat = cur();
    expect(
      hc.performAction(seat, action as never, amount),
      `${seat} ${action} ${amount ?? ''}`
    ).toBe(true);
    const last = events.filter((e) => e.type === 'PLAYER_ACTION').pop() as Extract<
      HandEvent,
      { type: 'PLAYER_ACTION' }
    >;
    return last.record!;
  };
  return { hc, events, act, cur };
}
const runs = (records: object[]) => records.map((r) => raiseLadderStampOf(r)?.run ?? 0);

afterEach(() => {
  drainFires();
  disarmBrainTelemetryForTest();
});

describe('the run of consecutive minimum raises', () => {
  it('heads up: four alternating minimum raises stamp runs 1..4, the 5th is 5 (fires on the 4th only)', () => {
    const h = harness(mkConfig(), 2);
    // HU: the dealer (seat 1) is the small blind and acts first preflop; the bet is 2, the minimum raise 2
    const recs = [4, 6, 8, 10, 12].map((to) => h.act('raise', to));
    expect(runs(recs)).toEqual([1, 2, 3, 4, 5]);
    expect(raiseLadderStampOf(recs[3])!.raisers).toEqual(['u1', 'u2', 'u1', 'u2']);
    const horse = () => true;
    expect(recs.map((r) => raiseLadderAlarmOf(raiseLadderStampOf(r), horse))).toEqual([
      null,
      null,
      null,
      { variant: 'nlh', raisers: 'horse_only' },
      null,
    ]);
  });

  it('calls between raises do not break the run; a larger raise does', () => {
    const h = harness(mkConfig(), 3);
    // 3 handed, dealer seat 1 acts first preflop
    const a = h.act('raise', 4); // 1: min
    h.act('call'); // 2
    const b = h.act('raise', 6); // 3: min
    const c = h.act('raise', 8); // 1: min
    h.act('call'); // 2
    const d = h.act('raise', 10); // 3: min, the 4th
    expect(runs([a, b, c, d])).toEqual([1, 2, 3, 4]);
    const e = h.act('raise', 40); // 1: a larger raise ends the run, and is not stamped
    expect(raiseLadderStampOf(e)).toBeUndefined();
    h.act('call'); // 2
    const f = h.act('raise', 70); // 3: the minimum is now 30: a min raise starts a new run
    expect(runs([f])).toEqual([1]);
  });

  it('a new street starts a new run, and a bet is not a raise', () => {
    const h = harness(mkConfig(), 2);
    const pre = [4, 6, 8].map((to) => h.act('raise', to));
    expect(runs(pre)).toEqual([1, 2, 3]);
    h.act('call'); // preflop closes at 8
    const bet = h.act('bet', 2); // flop: first to act bets the minimum
    expect(raiseLadderStampOf(bet)).toBeUndefined();
    const r = h.act('raise', 4);
    expect(runs([r])).toEqual([1]);
  });

  it('pot limit counts the same way (the live engine has no raise cap there)', () => {
    const h = harness(mkConfig({ gameVariant: 'plo4' }), 2);
    const recs = [4, 6, 8, 10].map((to) => h.act('raise', to));
    expect(runs(recs)).toEqual([1, 2, 3, 4]);
    expect(raiseLadderAlarmOf(raiseLadderStampOf(recs[3]), () => false)).toEqual({
      variant: 'plo4',
      raisers: 'mixed',
    });
  });

  it('fixed limit is not counted (every raise is the minimum there, and the street is capped)', () => {
    const h = harness(mkConfig({ gameVariant: 'flh' }), 2);
    const recs = [4, 6, 8].map((to) => h.act('raise', to));
    expect(recs.map((r) => (r as { amount: number }).amount)).toEqual([4, 6, 8]);
    expect(runs(recs)).toEqual([0, 0, 0]);
  });
});

describe('the receipt', () => {
  it('fires raise_ladder_<variant>_horse_only_seen once per street when every raiser is a Horse, mixed otherwise', () => {
    enableBrainTelemetry();
    drainFires();
    const h = harness(mkConfig(), 2);
    const recs = [4, 6, 8, 10, 12, 14].map((to) => h.act('raise', to));
    for (const r of recs) noteRaiseLadder(r, () => true);
    for (const r of recs) noteRaiseLadder(r, (id) => id === 'u1');
    expect(drainFires().sort((x, y) => x.feature.localeCompare(y.feature))).toEqual([
      { feature: 'raise_ladder_nlh_horse_only_seen', fires: 1 },
      { feature: 'raise_ladder_nlh_mixed_seen', fires: 1 },
    ]);
  });

  it('survives the continuation lane clone (carried by identity, never serialized)', () => {
    const h = harness(mkConfig(), 2);
    const recs = [4, 6, 8, 10].map((to) => h.act('raise', to));
    const copy = structuredClone(recs[3]);
    expect(raiseLadderStampOf(copy)).toBeUndefined();
    carryRaiseLadder(recs[3], copy);
    expect(raiseLadderStampOf(copy)!.run).toBe(RAISE_LADDER_ALARM_RUN);
  });

  it('never throws and fires nothing for a record without a stamp', () => {
    enableBrainTelemetry();
    drainFires();
    expect(() => noteRaiseLadder(undefined, () => true)).not.toThrow();
    expect(() => noteRaiseLadder({}, () => true)).not.toThrow();
    expect(() =>
      noteRaiseLadder({}, () => {
        throw new Error('seat lookup failed');
      })
    ).not.toThrow();
    expect(drainFires()).toEqual([]);
  });
});

describe('measurement only: the record, the event and the menu are unchanged', () => {
  it('a stamped record carries exactly the fields an unstamped one does, and the event JSON names no ladder', () => {
    const h = harness(mkConfig(), 2);
    const recs = [4, 6, 8, 10].map((to) => h.act('raise', to));
    const call = h.act('call');
    for (const r of [...recs, call])
      expect(Object.keys(r).sort()).toEqual(
        [
          'action',
          'amount',
          'isFullRaise',
          'publicNode',
          'seat',
          'stage',
          'timestamp',
          'userId',
        ].sort()
      );
    expect(JSON.stringify(h.events)).not.toMatch(/ladder|minimumRaiseRun/i);
    // the 4th minimum raise still offers raise to the next player: the alarm caps nothing
    const tc = h.events.filter((e) => e.type === 'TURN_CHANGE').slice(-2)[0] as {
      availableActions: string[];
    };
    expect(tc.availableActions).toContain('raise');
  });
});
