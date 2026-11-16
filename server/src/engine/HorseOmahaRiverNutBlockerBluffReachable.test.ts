/**
 * omahaRiverNutBlockerBluffReachable (PLO Strategy 2026-11-15, default OFF).
 *
 * The Omaha nut-blocker river bluff (receipt v86_river_nut_blocker_bluff) is
 * on and has never fired in production. Two facts, both pinned here:
 *  1. Its made-hand gate is `cat <= 1`, no pair at all. A no-pair Omaha river
 *     hand is under the baseline river bluff's 0.25 air line, and with a real
 *     action history the baseline owns every such heads-up river against a
 *     capped opponent and answers it (bet or check) first.
 *  2. The band the baseline leaves, 0.25 to 0.28 equity, holds one-pair hands,
 *     the "bottom-pair" its own comment names, which `cat <= 1` refuses.
 * The option admits one pair. Every other gate is unchanged.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { ploPersonaFor } from './HorsePersona.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const RECEIPT = 'v86_river_nut_blocker_bluff';
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] => {
  const out: Card[] = [];
  for (let i = 0; i + 1 < spec.length; i += 2)
    out.push({ rank: spec[i] as CardRank, suit: SUIT[spec[i + 1]] });
  return out;
};
const seat = (n: number, id: string, hole: string, over: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `P${n}`,
    stack: 400,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    ...over,
  }) as SeatPlayer;

function lagSharkHorse(): string {
  for (let i = 1; i <= 500; i++) {
    const id = `86000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    if (ploPersonaFor(id).archetype === 'lag_shark') return id;
  }
  throw new Error('no lag_shark Horse');
}
const HERO = lagSharkHorse();
const UNKNOWN = '52000000-0000-4000-8000-000000000099';
const STATION = '52000000-0000-4000-8000-000000000002';
const THIRD = '52000000-0000-4000-8000-000000000077';

type Step = [stage: string, who: 'H' | 'O', action: string, amount: number];
/** Real lines: every street has its records, as the live table sends them. */
const CHECKED_DOWN_IP: Step[] = [
  ['flop', 'O', 'check', 0],
  ['flop', 'H', 'check', 0],
  ['turn', 'O', 'check', 0],
  ['turn', 'H', 'check', 0],
  ['river', 'O', 'check', 0],
];
const DELAYED_IP: Step[] = [
  ['flop', 'O', 'check', 0],
  ['flop', 'H', 'bet', 8],
  ['flop', 'O', 'call', 8],
  ['turn', 'O', 'check', 0],
  ['turn', 'H', 'check', 0],
  ['river', 'O', 'check', 0],
];
const BARREL_IP: Step[] = [
  ['flop', 'O', 'check', 0],
  ['flop', 'H', 'bet', 8],
  ['flop', 'O', 'call', 8],
  ['turn', 'O', 'check', 0],
  ['turn', 'H', 'bet', 20],
  ['turn', 'O', 'call', 20],
  ['river', 'O', 'check', 0],
];

interface Spot {
  variant: 'plo4' | 'plo5';
  hole: string;
  board: string;
  pot: number;
  seed: number;
  line?: Step[];
  oppId?: string;
  opp?: Partial<SeatPlayer>;
  extra?: SeatPlayer[];
}

function run(spot: Spot, opts: HorseDecideOpts = {}) {
  const oppId = spot.oppId ?? UNKNOWN;
  const hero = seat(2, HERO, spot.hole);
  const opp = seat(1, oppId, '', spot.opp);
  let t = 1;
  const rec = (stage: string, who: 'H' | 'O', action: string, amount: number): ActionRecord =>
    ({
      stage,
      seat: who === 'H' ? 2 : 1,
      userId: who === 'H' ? HERO : oppId,
      action,
      amount,
      timestamp: t++,
    }) as unknown as ActionRecord;
  const gs = {
    players: [opp, hero, ...(spot.extra ?? [])],
    communityCards: cards(spot.board),
    pot: spot.pot,
    currentBet: 0,
    toCall: 0,
    minRaise: 2,
    minRaiseTo: 2,
    maxRaiseTo: spot.pot,
    legalActions: ['check', 'bet'],
    stage: 'river',
    gameVariant: spot.variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 2,
    gameMode: 'cash',
    actionHistory: [
      rec('preflop', 'O', 'call', 2),
      rec('preflop', 'H', 'check', 0),
      ...(spot.line ?? CHECKED_DOWN_IP).map(([s, w, a, m]) => rec(s, w, a, m)),
    ],
  } as unknown as HorseGameStateV2;
  HorseMind.setDecisionScope(readScopeOf(spot.variant, 2));
  seedFastRandom(spot.seed);
  drainFires();
  const decision = HorseLogic.decide(hero, gs, 'lag', {}, { telemetry: true, ...opts });
  const fires = drainFires().map((f) => f.feature);
  return { decision, fires };
}

/** One pair (sixes), the bare ace of spades, three spades on the board. */
const PLO4_PAIR: Spot = {
  variant: 'plo4',
  hole: 'As4cQh6h',
  board: 'KsJs8s6d2c',
  pot: 56,
  seed: 1069,
};
/** One pair (jacks, weak kicker structure), the bare ace of spades. */
const PLO5_PAIR: Spot = {
  variant: 'plo5',
  hole: 'AsJcQd5h9d',
  board: 'KsJs8s6d2c',
  pot: 52,
  seed: 1047,
};
const ON: HorseDecideOpts = { omahaRiverNutBlockerBluffReachable: true };

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
});
afterEach(() => {
  HorseMind.reset();
});

describe('omahaRiverNutBlockerBluffReachable', () => {
  it.each([
    ['PLO4', PLO4_PAIR],
    ['PLO5', PLO5_PAIR],
  ])(
    '%s one pair with the bare nut-flush blocker, checked to on the river: on bets the pot with the receipt',
    (_name, spot) => {
      const on = run(spot, ON);
      expect(on.fires).toContain(RECEIPT);
      expect(on.decision.action).toBe('bet');
      expect(on.decision.amount).toBe(spot.pot);
    }
  );

  it.each([
    ['PLO4', PLO4_PAIR],
    ['PLO5', PLO5_PAIR],
  ])('%s the same spot with the option unset or false: no receipt, a check', (_name, spot) => {
    for (const opts of [{}, { omahaRiverNutBlockerBluffReachable: false }]) {
      const off = run(spot, opts);
      expect(off.fires).not.toContain(RECEIPT);
      expect(off.decision.action).toBe('check');
    }
  });

  it('never against a calling station', () => {
    const scope = readScopeOf('plo4', 2);
    for (let h = 0; h < 40; h++) {
      const a = (
        stage: string,
        userId: string,
        action: string,
        amount: number,
        ts: number
      ): ActionRecord =>
        ({ stage, userId, action, amount, timestamp: ts }) as unknown as ActionRecord;
      HorseMind.observeHandComplete(
        `station-train:${h}`,
        [
          { ...a('preflop', HERO, 'raise', 6, 1), isFullRaise: true } as ActionRecord,
          a('preflop', STATION, 'call', 4, 2),
          a('flop', HERO, 'bet', 8, 3),
          a('flop', STATION, 'call', 8, 4),
          a('turn', HERO, 'bet', 16, 5),
          a('turn', STATION, 'call', 16, 6),
          a('river', HERO, 'bet', 30, 7),
          a('river', STATION, 'call', 30, 8),
        ],
        2,
        null,
        scope
      );
    }
    const vsStation = run({ ...PLO4_PAIR, oppId: STATION }, ON);
    expect(vsStation.fires).not.toContain(RECEIPT);
    expect(vsStation.decision.action).toBe('check');
    // The unread opponent in the same process state still gets the bluff.
    expect(run(PLO4_PAIR, ON).fires).toContain(RECEIPT);
  });

  it('never without the nut-flush blocker', () => {
    // The ace of hearts for the ace of spades: same pair, no spade.
    const noBlocker = run({ ...PLO4_PAIR, hole: 'Ah4cQd6h' }, ON);
    expect(noBlocker.fires).not.toContain(RECEIPT);
    const noBlocker5 = run({ ...PLO5_PAIR, hole: 'AhJcQd5h9d' }, ON);
    expect(noBlocker5.fires).not.toContain(RECEIPT);
  });

  it('never multiway, never into an all-in opponent, never on a paired board', () => {
    const third = seat(3, THIRD, '');
    expect(run({ ...PLO4_PAIR, extra: [third] }, ON).fires).not.toContain(RECEIPT);
    expect(run({ ...PLO4_PAIR, opp: { is_all_in: true, stack: 0 } }, ON).fires).not.toContain(
      RECEIPT
    );
    expect(run({ ...PLO4_PAIR, board: 'KsJs8s6d6c' }, ON).fires).not.toContain(RECEIPT);
  });

  it('never when the opponent bet the turn (his range is not capped)', () => {
    const oppBetTurn: Step[] = [
      ['flop', 'O', 'check', 0],
      ['flop', 'H', 'check', 0],
      ['turn', 'O', 'bet', 10],
      ['turn', 'H', 'call', 10],
      ['river', 'O', 'check', 0],
    ];
    expect(run({ ...PLO4_PAIR, line: oppBetTurn }, ON).fires).not.toContain(RECEIPT);
  });

  it('why it never fired: with a real history the baseline answers every no-pair blocker river first, on or off', () => {
    // Textbook spots: no pair, the bare ace of spades, the flush on board.
    const textbook: Array<[Spot['variant'], string, string]> = [
      ['plo4', 'As4d3h7c', 'KsJs8s6d2c'],
      ['plo4', 'AsQdJh7c', '9s6dKs2c5s'],
      ['plo5', 'As4d3h7cTd', 'KsJs8s6d2c'],
      ['plo5', 'AsQdJh7c3d', '9s6dKs2c5s'],
    ];
    let decisions = 0;
    let baselineBets = 0;
    for (const [variant, hole, board] of textbook) {
      for (const line of [CHECKED_DOWN_IP, DELAYED_IP, BARREL_IP]) {
        for (let pot = 20; pot <= 120; pot += 20) {
          const spot: Spot = { variant, hole, board, pot, seed: 777 + pot, line };
          const off = run(spot);
          const on = run(spot, ON);
          decisions++;
          // The baseline river bluff took the spot: it bet or it checked.
          const owned = off.fires.some(
            (f) =>
              f === 'river_bluff_baseline_check' ||
              /^river_bluff_baseline_(blocker|missedDraw|junk)/.test(f)
          );
          expect(owned, `${variant} ${hole} ${board} pot ${pot}`).toBe(true);
          expect(off.fires).not.toContain(RECEIPT);
          expect(on.fires).not.toContain(RECEIPT);
          expect(on.decision.action).toBe(off.decision.action);
          expect(on.decision.amount).toBe(off.decision.amount);
          if (off.decision.action === 'bet') baselineBets++;
        }
      }
    }
    expect(decisions).toBe(72);
    // The blocker bluff itself is made, by the baseline.
    expect(baselineBets).toBeGreaterThan(0);
  });
});
