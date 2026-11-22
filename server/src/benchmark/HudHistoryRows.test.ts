/** SIMULATED HANDS -> hand_history ROWS (benchmark-only): rows OpponentHudAsOf reads, deterministic, no cards. */
import { describe, expect, it } from 'vitest';
import { OpponentHudAsOf } from '../engine/opponentHud/OpponentHudAsOf.js';
import { handRecordFromRow } from '../engine/opponentHud/OpponentHudProfile.js';
import {
  simHandId,
  simUserId,
  simulatedHandToHistoryRow,
  simulatedHandsToHistoryRows,
  type SimulatedHand,
} from './HudHistoryRows.js';

const T0 = 1_800_000_000_000;
function hand(n: number, raiseIncrement: boolean): SimulatedHand {
  return {
    seed: 'bench-7',
    handNo: n,
    startedAtMs: T0 + n * 60_000,
    variant: 'plo5',
    bigBlind: 2,
    buttonSeat: 2,
    players: [
      { seat: 1, player: 'horse-a', stack: 400 },
      { seat: 2, player: 'pot_stab', stack: 400 },
    ],
    actions: [
      { seat: 2, stage: 'preflop', action: 'sb', amount: 1 },
      { seat: 1, stage: 'preflop', action: 'bb', amount: 2 },
      { seat: 2, stage: 'preflop', action: 'raise', amount: raiseIncrement ? 5 : 6 },
      { seat: 1, stage: 'preflop', action: 'call', amount: 4 },
      { seat: 1, stage: 'flop', action: 'check' },
      { seat: 2, stage: 'flop', action: 'bet', amount: 12 },
      { seat: 1, stage: 'flop', action: 'fold' },
    ],
    board: ['Ah', '7d', '2c'],
    winners: [{ seat: 2, amount: 24 }],
  };
}

describe('simulated hands -> hand_history rows', () => {
  it('writes the public row the HUD reads, with deterministic ids and street-total wager amounts', () => {
    const a = simulatedHandToHistoryRow(hand(1, false));
    const b = simulatedHandToHistoryRow(hand(1, true), { amounts: 'increments' });
    expect(a).toEqual(b); // an increments log converts to the engine convention
    expect(a.id).toBe(simHandId('bench-7', 1));
    expect(a.players[1].userId).toBe(simUserId('pot_stab'));
    expect(a.actions[2]).toMatchObject({ action: 'raise', amount: 6 });
    expect(simulatedHandToHistoryRow(hand(1, false), { ids: 'keep' }).players[1].userId).toBe(
      'pot_stab'
    );
    const rec = handRecordFromRow(a);
    expect(typeof rec).not.toBe('string');
    // no hole card field exists anywhere in a row
    expect(JSON.stringify(a)).not.toMatch(/"cards"|hole/);
  });

  it('OpponentHudAsOf builds real profiles from a converted session (fold to a flop stab counted)', () => {
    const rows = simulatedHandsToHistoryRows([1, 2, 3, 4].map((n) => hand(n, false)));
    const b = new OpponentHudAsOf(rows);
    expect(b.size).toBe(4);
    const c = b.countsBefore(
      simHandId('bench-7', 4),
      'plo5',
      [simUserId('horse-a'), simUserId('pot_stab')],
      ['f.fb.bg.hu', 'f.stab.hu', 'f.lead.hu', 'pf.vpip']
    );
    expect(c![simUserId('horse-a')]['f.fb.bg.hu']).toEqual([3, 3]); // 12 into 12: a big first wager, folded
    expect(c![simUserId('pot_stab')]['f.stab.hu']).toEqual([3, 3]);
    expect(c![simUserId('horse-a')]['f.lead.hu']).toEqual([3, 0]); // first to act, checked each time
    expect(c![simUserId('horse-a')]['pf.vpip']).toEqual([3, 3]);
  });
});
