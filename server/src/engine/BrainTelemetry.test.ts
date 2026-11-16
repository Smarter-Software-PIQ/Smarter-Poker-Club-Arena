/**
 * PROOF OF RECEIPT — the telemetry gate and the counters.
 * The whole point is that ONLY live decisions count: a league burst faking
 * "the fleet uses layer X" would defeat the instrument.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  enableBrainTelemetry,
  noteFire,
  telemetryOn,
  drainFires,
  restoreFires,
  noteDecisionMs,
  noteHorseActionClamped,
  noteSecondLookFires,
  peekBrainWatchcounters,
  peekDecisionLatency,
  secondLookReceiptKey,
  withBrainTelemetrySuspended,
  withDecisionFireScope,
  withSecondLookFireCapture,
} from './BrainTelemetry.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card, SeatPlayer } from '../types.js';

const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;

function mkPlayer(cards: Card[]): SeatPlayer {
  return {
    seat: 1,
    user_id: 'hero',
    username: 'hero',
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as SeatPlayer;
}
const opp = (): SeatPlayer =>
  ({
    seat: 3,
    user_id: 'opp3',
    username: 'opp3',
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  }) as never as SeatPlayer;

function decideFlop(opts: Record<string, unknown>, seed: number) {
  seedFastRandom(seed);
  const hero = mkPlayer([c('A', 'spades'), c('K', 'spades')]);
  const gs: HorseGameStateV2 = {
    players: [hero, opp()],
    communityCards: [c('Q', 'hearts'), c('8', 'diamonds'), c('3', 'clubs')],
    pot: 12,
    currentBet: 0,
    minRaise: 2,
    stage: 'flop',
    gameVariant: 'nlh',
    bigBlind: 2,
    dealerSeat: 1,
    actionHistory: [],
    gameMode: 'cash',
    format: 'cash',
  } as HorseGameStateV2;
  return HorseLogic.decide(hero, gs, 'balanced', {}, opts as never);
}

function decideOnce(opts: Record<string, unknown>): void {
  seedFastRandom(4242);
  const hero = mkPlayer([c('A', 'spades'), c('K', 'spades')]);
  const gs: HorseGameStateV2 = {
    players: [hero, opp()],
    communityCards: [c('Q', 'hearts'), c('8', 'diamonds'), c('3', 'clubs')],
    pot: 12,
    currentBet: 0,
    minRaise: 2,
    stage: 'flop',
    gameVariant: 'nlh',
    bigBlind: 2,
    dealerSeat: 1,
    actionHistory: [],
    gameMode: 'cash',
    format: 'cash',
  } as HorseGameStateV2;
  HorseLogic.decide(hero, gs, 'balanced', {}, opts as never);
}

describe('BrainTelemetry', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });

  it('counts and drains', () => {
    noteFire('x');
    noteFire('x');
    noteFire('y');
    const rows = drainFires();
    expect(rows).toContainEqual({ feature: 'x', fires: 2 });
    expect(rows).toContainEqual({ feature: 'y', fires: 1 });
    expect(drainFires()).toHaveLength(0);
  });

  it('restore merges a failed flush back', () => {
    noteFire('x');
    restoreFires([
      { feature: 'x', fires: 5 },
      { feature: 'z', fires: 1 },
    ]);
    const rows = drainFires();
    expect(rows).toContainEqual({ feature: 'x', fires: 6 });
    expect(rows).toContainEqual({ feature: 'z', fires: 1 });
  });

  it('the gate: only telemetry:true decisions count', () => {
    decideOnce({ mind: false }); // synthetic caller shape (league/tests)
    expect(drainFires()).toHaveLength(0);

    decideOnce({ telemetry: true });
    const rows = drainFires();
    const decide = rows.find((r) => r.feature === 'decide');
    expect(decide?.fires).toBe(1);
    expect(rows.some((r) => r.feature === 'decide_nlh')).toBe(true);
  });

  it('telemetryOn requires BOTH the boot switch and the opt-in', () => {
    expect(telemetryOn({ telemetry: true })).toBe(true);
    expect(telemetryOn({})).toBe(false);
    expect(telemetryOn(undefined)).toBe(false);
  });

  it('an Omaha live decision stamps the variant and the V15 layer when it runs', () => {
    seedFastRandom(777);
    const hero = mkPlayer([
      c('9', 'spades'),
      c('6', 'spades'),
      c('A', 'hearts'),
      c('J', 'diamonds'),
    ]);
    const gs: HorseGameStateV2 = {
      players: [hero, opp()],
      communityCards: [
        c('K', 'spades'),
        c('T', 'spades'),
        c('4', 'spades'),
        c('7', 'diamonds'),
        c('2', 'hearts'),
      ],
      pot: 40,
      currentBet: 20,
      minRaise: 20,
      stage: 'river',
      gameVariant: 'plo4',
      bigBlind: 2,
      dealerSeat: 3,
      actionHistory: [],
      gameMode: 'cash',
      format: 'cash',
    } as HorseGameStateV2;
    HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true } as never);
    const rows = drainFires();
    expect(rows.some((r) => r.feature === 'decide_omaha')).toBe(true);
    expect(rows.some((r) => r.feature === 'v15_nut_status')).toBe(true);
  });
});

describe('league deep-reads harness', () => {
  it('sandboxed league hands accumulate mind read samples', async () => {
    const { playHand } = await import('../benchmark/HorseLeague.js');
    const { HorseMind } = await import('./HorseMind.js');
    const sb = HorseMind.createSandbox();
    for (let hnd = 0; hnd < 500; hnd++) {
      playHand(31000 + hnd * 7919, (hnd % 6) + 1, () => ({}), undefined, sb);
    }
    // Inside the sandbox, someone must have accumulated c-bet opportunities.
    const anyReads = HorseMind.runInSandbox(sb, () => {
      for (let s = 1; s <= 6; s++) {
        const ftc = HorseMind.foldToCbetOf(`league-${s}`);
        if (ftc !== null) return true;
      }
      return false;
    });
    expect(anyReads).toBe(true);
    // And NOTHING leaked into live memory.
    for (let s = 1; s <= 6; s++) {
      expect(HorseMind.foldToCbetOf(`league-${s}`)).toBeNull();
    }
  });
});

describe('BrainTelemetry - second-look receipts (2026-11-16)', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });

  it('inside the capture a fire is collected and not counted; the rule keeps its one count', () => {
    noteFire('rule_a'); // the FAST look
    const captured = withSecondLookFireCapture(() => {
      noteFire('rule_a');
      noteFire('rule_a');
      noteFire('rule_b_seen');
      return 7;
    });
    expect(captured.value).toBe(7);
    expect([...captured.fired].sort()).toEqual(['rule_a', 'rule_b_seen']);
    expect(drainFires()).toEqual([{ feature: 'rule_a', fires: 1 }]);
  });

  it('the collected keys count once each under second_look_<key>_seen, the suffix not doubled', () => {
    expect(secondLookReceiptKey('rule_a')).toBe('second_look_rule_a_seen');
    expect(secondLookReceiptKey('rule_b_seen')).toBe('second_look_rule_b_seen');
    const { fired } = withSecondLookFireCapture(() => {
      noteFire('rule_a');
      noteFire('rule_a');
      noteFire('rule_b_seen');
    });
    noteSecondLookFires(fired);
    const rows = drainFires().sort((x, y) => x.feature.localeCompare(y.feature));
    expect(rows).toEqual([
      { feature: 'second_look_rule_a_seen', fires: 1 },
      { feature: 'second_look_rule_b_seen', fires: 1 },
    ]);
  });

  it('a paused evaluation and a once-per-decision read receipt add nothing to the capture', () => {
    const { fired } = withSecondLookFireCapture(() => {
      withBrainTelemetrySuspended(() => noteFire('shadow_rule'));
      noteFire('style_fold_bluff_seen');
      noteFire('style_label_maniac_seen');
    });
    expect([...fired]).toEqual([]);
    expect(drainFires()).toEqual([]);
  });

  it('no watchcounter and no latency is recorded inside the capture', () => {
    const clampedBefore = JSON.stringify(peekBrainWatchcounters());
    const latencyBefore = JSON.stringify(peekDecisionLatency());
    withSecondLookFireCapture(() => {
      noteHorseActionClamped('plo6', 'cash', 'second_look_probe');
      noteDecisionMs('second_look_probe', 12);
    });
    expect(JSON.stringify(peekBrainWatchcounters())).toBe(clampedBefore);
    expect(JSON.stringify(peekDecisionLatency())).toBe(latencyBefore);
  });

  it('the capture closes on a throw, and an open fire scope does not see captured keys', () => {
    const scoped = withDecisionFireScope(() => {
      expect(() =>
        withSecondLookFireCapture(() => {
          noteFire('rule_a');
          throw new Error('x');
        })
      ).toThrow('x');
      noteFire('rule_c');
    });
    expect([...scoped.fired]).toEqual(['rule_c']);
    expect(drainFires()).toEqual([{ feature: 'rule_c', fires: 1 }]);
  });

  it('a decision is the same with telemetry off, on, and on inside the capture', () => {
    for (const seed of [11, 4242, 90210, 7, 31337]) {
      const off = decideFlop({ mind: false }, seed);
      const on = decideFlop({ mind: false, telemetry: true }, seed);
      const captured = withSecondLookFireCapture(() =>
        decideFlop({ mind: false, telemetry: true }, seed)
      );
      // the receipts carry wall-clock latency fields; the played action is what must not move
      const played = (d: { action: string; amount?: number }) => ({
        action: d.action,
        amount: d.amount,
      });
      expect(played(on), `seed ${seed}`).toEqual(played(off));
      expect(played(captured.value), `seed ${seed}`).toEqual(played(off));
      expect(captured.fired.has('decide'), `seed ${seed}`).toBe(true);
    }
    // only the telemetry-on decisions outside the capture counted
    expect(drainFires().find((r) => r.feature === 'decide')?.fires).toBe(5);
  });
});
