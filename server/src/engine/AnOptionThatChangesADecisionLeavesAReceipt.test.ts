/**
 * AN OPTION THAT CHANGES A DECISION LEAVES A RECEIPT, AND CHANGES NOTHING ELSE (2026-11-25).
 *
 * Per-hand option receipts (HorseHandOptionReceipts): the two live Hold'em options record, where they change the
 * action, a rule receipt under the option's own name with the action before and after. Through the real
 * HorseLogic.decide:
 *
 *  - holdemTournamentAllInCallIsPriced (Packet 1): an audit fixture the reference folds and the price calls
 *    records fold -> call; the postflop jam spot records the turn it makes; a decision the price leaves alone
 *    records nothing.
 *  - cashDefenceTrimColdCalls (Packet 3): the trim moves a range bar, not an action, so its receipt is the same
 *    preflop intent on the untrimmed base, rewound. Over every hold'em class in a 9-max overcall spot: a receipt
 *    is recorded exactly where the option-on and option-off actions differ, and names those two kinds.
 *  - The receipt is evidence only: with the option on, the decision, and the generator state after it, are the
 *    same whether or not anything is listening (telemetry on inside a scope, telemetry off); with the option
 *    off nothing is recorded at all.
 *  - A receipt carries the option name and two action words. No amount, no card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { saveFastRandom, seedFastRandom } from './HorseEval.js';
import {
  disarmBrainTelemetryForTest,
  drainFires,
  enableBrainTelemetry,
  withDecisionFireScope,
  type DecisionRuleReceipt,
} from './BrainTelemetry.js';
import {
  HAND_OPTION_RECEIPT_KINDS,
  HAND_OPTION_RECEIPT_OPTIONS,
  handOptionReceiptsOf,
} from './HorseHandOptionReceipts.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import {
  BASE_DECISION_TIME_MS,
  BASE_MODS,
  BASE_STYLE,
  buildSpot,
} from './AHoldemTournamentAllInCallIsPriced.fixtures.js';
import { AUDIT_CASES } from './AHoldemTournamentAllInCallIsPriced.cases.js';
import { HOLDEM_CLASSES } from './HorseHoldemTournamentAllInCall.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

afterEach(() => {
  drainFires();
  disarmBrainTelemetryForTest();
  HorseMind.reset();
});

interface Ran {
  json: string;
  action: string;
  rngAfter: number;
  receipts: readonly DecisionRuleReceipt[];
}

/** One decide on a fixed seed. `listening` = telemetry on inside a decision scope, as the worker's FAST look. */
function run(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  style: unknown,
  mods: unknown,
  opts: Record<string, unknown>,
  seed: number,
  listening: boolean
): Ran {
  HorseMind.reset();
  if (listening) enableBrainTelemetry();
  else disarmBrainTelemetryForTest();
  seedFastRandom(seed);
  const decideOnce = () =>
    HorseLogic.decide(
      structuredClone(player),
      structuredClone(gs),
      style as never,
      mods as never,
      {
        ...opts,
        telemetry: listening,
      } as never
    );
  const scoped = listening
    ? withDecisionFireScope(decideOnce)
    : { value: decideOnce(), ruleReceipts: [] as DecisionRuleReceipt[] };
  const rngAfter = saveFastRandom();
  drainFires();
  disarmBrainTelemetryForTest();
  const { thinkTime: _thinkTime, ...rest } = scoped.value as unknown as Record<string, unknown>;
  return {
    json: JSON.stringify({ action: rest.action, amount: rest.amount ?? null }),
    action: String(scoped.value.action),
    rngAfter,
    receipts: scoped.ruleReceipts,
  };
}

const named = (receipts: readonly DecisionRuleReceipt[], option: string) =>
  receipts.filter((r) => r.receipt === option);

describe('holdemTournamentAllInCallIsPriced records the call or fold it turned', () => {
  const OPTION = 'holdemTournamentAllInCallIsPriced';
  const opts = (on: boolean) => ({
    decisionTimeMs: BASE_DECISION_TIME_MS,
    ...(on ? { [OPTION]: true } : {}),
  });

  it('preflop: the audit fixture the reference folds and the price calls records fold -> the call', () => {
    const { gs, player } = buildSpot(AUDIT_CASES['95b1c217'].spec);
    for (const seed of [1, 2, 3]) {
      const off = run(player, gs, BASE_STYLE, BASE_MODS, opts(false), seed, true);
      const on = run(player, gs, BASE_STYLE, BASE_MODS, opts(true), seed, true);
      expect(off.action).toBe('fold');
      expect(['call', 'all_in']).toContain(on.action);
      expect(named(off.receipts, OPTION)).toEqual([]);
      expect(named(on.receipts, OPTION)).toEqual([
        {
          receipt: OPTION,
          before: { action: 'fold', amount: null },
          after: { action: on.action, amount: null },
        },
      ]);
      // What the worker's reply would carry: the option and two kinds, nothing else.
      expect(handOptionReceiptsOf(on.receipts)).toEqual([
        { option: OPTION, before: 'fold', after: on.action },
      ]);
      // Evidence only: nobody listening, the same decision from the same draws.
      const quiet = run(player, gs, BASE_STYLE, BASE_MODS, opts(true), seed, false);
      expect(quiet.json).toBe(on.json);
      expect(quiet.rngAfter).toBe(on.rngAfter);
    }
  });

  it('postflop: a fold the price turns into a call records it; a decision it leaves alone records nothing', () => {
    const { gs, player } = buildSpot({ ...AUDIT_CASES.fb6eb2ec.spec, heroCards: 'QdJd' });
    let turned = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const off = run(player, gs, BASE_STYLE, BASE_MODS, opts(false), seed, true);
      const on = run(player, gs, BASE_STYLE, BASE_MODS, opts(true), seed, true);
      const mine = named(on.receipts, OPTION);
      expect(named(off.receipts, OPTION)).toEqual([]);
      for (const r of mine) {
        expect(r.before).not.toBeNull();
        expect(r.before!.action).not.toBe(r.after.action);
        expect(r.before!.amount).toBeNull();
        expect(r.after.amount).toBeNull();
      }
      if (off.action === 'fold' && on.action !== 'fold') {
        turned++;
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.at(-1)!.before!.action).toBe('fold');
      }
      if (off.action === on.action && mine.length > 0) {
        // The reference itself differed before the price acted; the receipt still names a real turn.
        expect(mine.at(-1)!.after.action).toBe(on.action);
      }
    }
    expect(turned).toBeGreaterThan(0);
  });
});

describe('cashDefenceTrimColdCalls records the preflop choice the trim changed', () => {
  const OPTION = 'cashDefenceTrimColdCalls';
  const CASH = HORSE_HYBRID_PROFILES.cash;
  const CLOCK_MS = Date.UTC(2026, 10, 25, 15, 0, 0);
  const RANKS = '23456789TJQKA';

  /** 9-max 200bb cash: seat 3 opens to 4bb, seat 4 calls, the hero in seat 5 has four players behind. */
  function overcallSpot(hole: [Card, Card]): { hero: SeatPlayer; gs: HorseGameStateV2 } {
    const seats = 9;
    const bb = 1;
    const openTo = 4;
    const players: SeatPlayer[] = [];
    for (let seat = 1; seat <= seats; seat++) {
      const blind = seat === 1 ? bb / 2 : seat === 2 ? bb : 0;
      const bet = seat === 3 || seat === 4 ? openTo : blind;
      players.push({
        seat,
        user_id: `p-${seat}`,
        username: `P${seat}`,
        stack: 200 * bb - bet,
        bet,
        totalInvested: bet,
        cards: seat === 5 ? [...hole] : [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      } as SeatPlayer);
    }
    const history: ActionRecord[] = [
      {
        seat: 3,
        userId: 'p-3',
        action: 'raise',
        amount: openTo,
        timestamp: 100,
        stage: 'preflop',
        isFullRaise: true,
      },
      { seat: 4, userId: 'p-4', action: 'call', amount: openTo, timestamp: 101, stage: 'preflop' },
    ] as ActionRecord[];
    const gs = {
      players,
      communityCards: [],
      pot: players.reduce((s, p) => s + p.totalInvested, 0),
      currentBet: openTo,
      minRaise: openTo - bb,
      lastRaise: openTo - bb,
      stage: 'preflop',
      gameVariant: 'nlh',
      bigBlind: bb,
      smallBlind: bb / 2,
      dealerSeat: seats,
      actionHistory: history,
      gameMode: 'cash',
      ante: 0,
      bigBlindAnte: false,
      format: 'cash',
      dealtSeatIds: players.map((p) => p.seat),
      blindSeats: { smallBlind: 1, bigBlind: 2 },
    } as unknown as HorseGameStateV2;
    return { hero: players[4], gs };
  }

  const holeOf = (cls: string): [Card, Card] => {
    const suited = cls[2] === 's';
    return [
      { rank: cls[0], suit: 'hearts' } as Card,
      { rank: cls[1], suit: suited ? 'hearts' : 'spades' } as Card,
    ];
  };

  it("over every hold'em class: a receipt exactly where on and off differ, naming those two kinds", () => {
    expect(HOLDEM_CLASSES.length).toBe(169);
    expect(RANKS.length).toBe(13);
    const kinds = new Set<string>(HAND_OPTION_RECEIPT_KINDS);
    let changed = 0;
    let unchanged = 0;
    for (const cls of HOLDEM_CLASSES) {
      const { hero, gs } = overcallSpot(holeOf(cls));
      const base = { decisionTimeMs: CLOCK_MS, mind: false };
      const off = run(hero, gs, CASH.style, CASH.mods, base, 7, true);
      const on = run(hero, gs, CASH.style, CASH.mods, { ...base, [OPTION]: true }, 7, true);
      // Option off: nothing of the receipt runs.
      expect(named(off.receipts, OPTION)).toEqual([]);
      const mine = named(on.receipts, OPTION);
      if (off.action !== on.action) {
        changed++;
        expect(mine, cls).toEqual([
          {
            receipt: OPTION,
            before: { action: off.action, amount: null },
            after: { action: on.action, amount: null },
          },
        ]);
        expect(kinds.has(off.action) && kinds.has(on.action), cls).toBe(true);
        expect(handOptionReceiptsOf(on.receipts)).toEqual([
          { option: OPTION, before: off.action, after: on.action },
        ]);
      } else {
        unchanged++;
        expect(mine, cls).toEqual([]);
      }
      // Evidence only: the rewound intent leaves the decision and the generator exactly where they were.
      const quiet = run(hero, gs, CASH.style, CASH.mods, { ...base, [OPTION]: true }, 7, false);
      expect(quiet.json, cls).toBe(on.json);
      expect(quiet.rngAfter, cls).toBe(on.rngAfter);
    }
    // The trim acts in this seat (some overcalls become folds) and leaves most hands alone.
    expect(changed).toBeGreaterThan(0);
    expect(unchanged).toBeGreaterThan(changed);
  });
});

it('the listed options are exactly the two that record a receipt under their own name', () => {
  expect([...HAND_OPTION_RECEIPT_OPTIONS].sort()).toEqual([
    'cashDefenceTrimColdCalls',
    'holdemTournamentAllInCallIsPriced',
  ]);
});
