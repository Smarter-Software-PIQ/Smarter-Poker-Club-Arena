/**
 * STYLE READ #4b (2026-11-14): the value raise and the commitment price, behind styleRaiseRespect.
 * The node is a reviewed 0.5/1 cash hand with synthetic players: eight dealt in, the Horse opened under the gun, bet
 * the flop and the turn, and the small blind check-raised the turn from 30 with little left behind.
 *
 * Every opponent profile here is made up. To decide against a stored profile, point
 * HORSE_STYLE_PRIVATE_PROFILE_JSON at a private file
 * `{ "profile": <horse_exact_profiles row>, "aggression": <StreetAggression>, "reference": <StreetAggression> }`;
 * that test is skipped without the file and nothing of it is committed.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  STYLE_VALUE_RAISE_BLUFF_SHARE,
  STYLE_VALUE_RAISE_STRONG_SHARE,
  V66_RAISE_BLUFF_SHARE,
  styleValueRaiseTargetClass,
} from './HorseEval.js';
import {
  STYLE_THRESHOLDS,
  valueRaiseSizeWeight,
  valueRaiseWeight,
  type StreetAggression,
} from './HorseOpponentStyle.js';
import {
  cards,
  decide,
  HERO,
  VILLAIN,
  type Spot,
} from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';
import type { SeatPlayer } from '../types.js';

const THIRD = 'cccccccc-0000-4000-8000-000000000003';
const FOLDED = [1, 2, 3, 5, 9].map((seat) => ({
  seat,
  id: `dddddddd-0000-4000-8000-00000000000${seat}`,
}));
const SEEDS = Array.from(
  { length: Number(process.env.HORSE_STYLE_PRIVATE_SEEDS ?? 24) },
  (_, i) => 0x57e1e + i * 7919
);
const N = SEEDS.length;
const RANK: Record<string, number> = { fold: 0, call: 1, raise: 2, all_in: 2 };
const ON = { styleRaiseRespect: true, styleBigBetHonesty: true, styleValueBettorNotManiac: true };
type Mode = 'cash' | 'tournament';

const seat = (
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  hole = '',
  folded = false
): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `p${n}`,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_all_in: false,
    is_sitting_out: false,
  }) as unknown as SeatPlayer;
const stamp = (acts: Array<Record<string, unknown>>) =>
  acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 }));
const PREFLOP = [
  { stage: 'preflop', seat: 8, userId: HERO, action: 'raise', amount: 5, isFullRaise: true },
  { stage: 'preflop', seat: 6, userId: VILLAIN, action: 'call', amount: 4.5 },
  { stage: 'preflop', seat: 7, userId: THIRD, action: 'call', amount: 4 },
];
const FLOP_CALLED = [
  { stage: 'flop', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
  { stage: 'flop', seat: 7, userId: THIRD, action: 'check', amount: 0 },
  { stage: 'flop', seat: 8, userId: HERO, action: 'bet', amount: 11, isFullRaise: true },
  { stage: 'flop', seat: 6, userId: VILLAIN, action: 'call', amount: 11 },
  { stage: 'flop', seat: 7, userId: THIRD, action: 'call', amount: 11 },
];
function table(
  mode: Mode,
  stage: string,
  board: string,
  hero: SeatPlayer,
  villain: SeatPlayer,
  rest: Record<string, unknown>
): Spot {
  const players = [
    ...FOLDED.map((f) => seat(f.seat, f.id, 200, 0, 0, '', true)),
    villain,
    seat(7, THIRD, 70.65, 0, 16, '', true),
    hero,
  ].sort((a, b) => a.seat - b.seat);
  const gs = {
    stateSchemaVersion: 1,
    players,
    communityCards: cards(board),
    stage,
    gameVariant: 'nlh',
    gameMode: mode,
    ...(mode === 'tournament'
      ? {
          tournament: {
            entrants: 100,
            playersLeft: 40,
            spotsPaid: 15,
            inMoney: true,
            nearBubble: false,
            avgStackChips: 400,
          },
        }
      : {}),
    bettingStructure: 'no_limit',
    chipUnit: 0.01,
    asset: 'chips',
    bigBlind: 1,
    smallBlind: 0.5,
    dealerSeat: 5,
    heroSeat: 8,
    currentPlayerSeat: 8,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    wagersCapped: false,
    ...rest,
  };
  return { name: `${stage}_${mode}`, hero, gs };
}

interface TurnOpts {
  /** what the raiser keeps behind after raising */
  behind?: number;
  /** the raise-to amount over hero's bet of 30 */
  raiseTo?: number;
  mode?: Mode;
}
/** The turn decision: hero bet 30 into 48 and was check-raised. Defaults: to 120 (4x) with 37.65 behind (0.13 pot). */
function turnCheckRaise(heroCards = 'QdTc', board = 'Qs8hTdKs', o: TurnOpts = {}): Spot {
  const raiseTo = o.raiseTo ?? 120;
  const acts = stamp([
    ...PREFLOP,
    ...FLOP_CALLED,
    { stage: 'turn', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'turn', seat: 7, userId: THIRD, action: 'check', amount: 0 },
    { stage: 'turn', seat: 8, userId: HERO, action: 'bet', amount: 30, isFullRaise: true },
    {
      stage: 'turn',
      seat: 6,
      userId: VILLAIN,
      action: 'raise',
      amount: raiseTo,
      isFullRaise: true,
    },
    { stage: 'turn', seat: 7, userId: THIRD, action: 'fold', amount: 0 },
  ]);
  const spot = table(
    o.mode ?? 'cash',
    'turn',
    board,
    seat(8, HERO, 401.95, 30, 46, heroCards),
    seat(6, VILLAIN, o.behind ?? 37.65, raiseTo, 16 + raiseTo),
    {
      pot: 78 + raiseTo,
      currentBet: raiseTo,
      minRaise: raiseTo - 30,
      lastRaise: raiseTo - 30,
      toCall: raiseTo - 30,
      minRaiseTo: 2 * raiseTo - 30,
      maxRaiseTo: 431.95,
      actionHistory: acts,
    }
  );
  return {
    ...spot,
    name: `turn_${heroCards}_${board}_${raiseTo}_${o.behind ?? 37.65}_${o.mode ?? 'cash'}`,
  };
}
/** The flop decision: hero bet 11 into 15 and was check-raised to 33 (3x). */
function flopCheckRaise(heroCards: string, board = 'Qs8hTd', behind = 135.65): Spot {
  const acts = stamp([
    ...PREFLOP,
    { stage: 'flop', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'flop', seat: 7, userId: THIRD, action: 'check', amount: 0 },
    { stage: 'flop', seat: 8, userId: HERO, action: 'bet', amount: 11, isFullRaise: true },
    { stage: 'flop', seat: 6, userId: VILLAIN, action: 'raise', amount: 33, isFullRaise: true },
    { stage: 'flop', seat: 7, userId: THIRD, action: 'fold', amount: 0 },
  ]);
  const spot = table(
    'cash',
    'flop',
    board,
    seat(8, HERO, 431.95, 11, 16, heroCards),
    seat(6, VILLAIN, behind, 33, 38),
    {
      pot: 59,
      currentBet: 33,
      minRaise: 22,
      lastRaise: 22,
      toCall: 22,
      minRaiseTo: 55,
      maxRaiseTo: 442.95,
      actionHistory: acts,
    }
  );
  return { ...spot, name: `flop_${heroCards}_${board}_${behind}` };
}
/** The river twin: hero bet the turn and was called, bet 60 on a blank river and was check-raised to 200 (100 behind). */
function riverCheckRaise(heroCards = 'QdTc', board = 'Qs8hTdKs2c'): Spot {
  const acts = stamp([
    ...PREFLOP,
    ...FLOP_CALLED,
    { stage: 'turn', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'turn', seat: 7, userId: THIRD, action: 'check', amount: 0 },
    { stage: 'turn', seat: 8, userId: HERO, action: 'bet', amount: 30, isFullRaise: true },
    { stage: 'turn', seat: 6, userId: VILLAIN, action: 'call', amount: 30 },
    { stage: 'turn', seat: 7, userId: THIRD, action: 'fold', amount: 0 },
    { stage: 'river', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'river', seat: 8, userId: HERO, action: 'bet', amount: 60, isFullRaise: true },
    { stage: 'river', seat: 6, userId: VILLAIN, action: 'raise', amount: 200, isFullRaise: true },
  ]);
  const spot = table(
    'cash',
    'river',
    board,
    seat(8, HERO, 341.95, 60, 106, heroCards),
    seat(6, VILLAIN, 100, 200, 246),
    {
      pot: 368,
      currentBet: 200,
      minRaise: 140,
      lastRaise: 140,
      toCall: 140,
      minRaiseTo: 340,
      maxRaiseTo: 401.95,
      actionHistory: acts,
    }
  );
  return { ...spot, name: `river_${heroCards}` };
}

const agg = (f: number[], t: number[], r: number[]): StreetAggression => ({
  flop: { aggr: f[0], passive: f[1], raiseOpps: f[2], raises: f[3] },
  turn: { aggr: t[0], passive: t[1], raiseOpps: t[2], raises: t[3] },
  river: { aggr: r[0], passive: r[1], raiseOpps: r[2], raises: r[3] },
});
/**
 * The Horse population in the same format: bets and raises about 70 percent of its postflop actions and raises about
 * 7.7 percent of its turn chances. Each street carries enough raise opportunities for the reference to count (its
 * standard error within half the raise margin); a street with fewer has no reference and the read does not engage.
 */
const HORSE_REFERENCE = agg([500, 230, 700, 45], [380, 170, 520, 40], [400, 150, 460, 36]);

interface Shape {
  profile: Record<string, unknown> | null;
  aggression: StreetAggression | null;
  reference?: StreetAggression;
}
const durable = (c: ReturnType<typeof counters>): Record<string, unknown> => ({
  variant: 'nlh',
  size: 'full',
  observed_hands: 500,
  initialized: true,
  // cash at table speed with no ante: the pre-repair domain, so the fold-to-bet statistics are discounted
  public_memory_domain: { version: 1, speed: 'table', ante: 'none' },
  counters: c,
});
const PASSIVE_COUNTERS = () =>
  counters({
    hands: 60,
    vpip: 0.26,
    pfr: 0.09,
    threeBetOpp: 24,
    threeBet: 0,
    betCheckedToOpp: 18,
    betCheckedTo: 5,
    foldToBetOpp: 14,
    foldToBet: 7,
  });
/** Passive and value-heavy: bets and raises little, one raise in dozens of chances, no usable showdown memory. */
const passiveRegular = (): Shape => ({
  profile: durable(PASSIVE_COUNTERS()),
  aggression: agg([14, 16, 44, 2], [10, 14, 34, 1], [5, 9, 18, 1]),
});
/** The same player with a thin street record: nine turn chances, no raise. Not evidence. */
const thinSample = (): Shape => ({
  profile: durable(PASSIVE_COUNTERS()),
  aggression: agg([8, 12, 20, 0], [3, 6, 9, 0], [1, 3, 4, 0]),
});
/** Passive overall, but raises the turn at `raises` of 40 chances. */
const turnRaiser = (raises: number): Shape => ({
  profile: durable(PASSIVE_COUNTERS()),
  aggression: agg([14, 20, 44, 2], [6 + raises, 22, 40, raises], [5, 9, 18, 1]),
});
/** Passive on record, but the fast window shows him raising and betting everything. */
const gearChanged = (): Shape => ({
  profile: durable(
    counters({
      hands: 60,
      vpip: 0.26,
      pfr: 0.09,
      threeBetOpp: 24,
      threeBet: 0,
      betCheckedToOpp: 18,
      betCheckedTo: 5,
      foldToBetOpp: 14,
      foldToBet: 7,
      fast: { hands: 12, pfr: 9, threeBetOpp: 8, threeBet: 6, betCheckedToOpp: 8, betCheckedTo: 8 },
    })
  ),
  aggression: agg([14, 16, 44, 2], [10, 14, 34, 1], [5, 9, 18, 1]),
});
/** Plays like the Horses do: same entry, same betting share, same raise rates. */
const balanced = (): Shape => ({
  profile: durable(
    counters({
      hands: 80,
      vpip: 0.21,
      pfr: 0.137,
      threeBetOpp: 25,
      threeBet: 1,
      betCheckedToOpp: 40,
      betCheckedTo: 12,
      foldToBetOpp: 30,
      foldToBet: 14,
    })
  ),
  aggression: agg([50, 22, 70, 5], [38, 17, 52, 4], [20, 8, 24, 2]),
});
const maniacShaped = (): Shape => ({
  profile: durable(
    counters({
      hands: 80,
      vpip: 0.75,
      pfr: 0.55,
      threeBetOpp: 25,
      threeBet: 9,
      betCheckedToOpp: 40,
      betCheckedTo: 34,
      foldToBetOpp: 30,
      foldToBet: 5,
    })
  ),
  aggression: agg([70, 8, 40, 14], [50, 6, 30, 10], [30, 4, 16, 6]),
});
const UNKNOWN: Shape = { profile: null, aggression: null };

function install(v: Shape, mode: Mode = 'cash'): void {
  HorseMind.reset();
  HorseMind.importStyleHorseReference([
    { variant: 'nlh', mode, size: 'full', reference: v.reference ?? HORSE_REFERENCE },
  ]);
  if (v.profile)
    HorseMind.importDurableOpponentProfiles([{ mode, ...v.profile, user_id: VILLAIN } as never]);
  if (v.aggression)
    HorseMind.importStyleAggression([
      { user_id: VILLAIN, variant: 'nlh', mode, size: 'full', aggression: v.aggression },
    ]);
}
function tally(v: Shape, spot: Spot, opts: Record<string, unknown>, mode: Mode = 'cash') {
  const actions: Record<string, number> = {};
  const digests: string[] = [];
  let value = 0;
  let commitment = 0;
  for (const seed of SEEDS) {
    install(v, mode);
    const d = decide(spot, opts, seed);
    actions[d.decision.action] = (actions[d.decision.action] ?? 0) + 1;
    digests.push(d.digest);
    value += d.fires.style_value_raise_respect_seen ?? 0;
    commitment += d.fires.style_commitment_priced_seen ?? 0;
  }
  return { actions, digests, value, commitment };
}
const act = (digest: string): string => digest.split(':')[0]!;
function weightOf(v: Shape, street: 'turn' | 'river' = 'turn'): number {
  install(v);
  HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
  const w = valueRaiseWeight(HorseMind.styleRead(VILLAIN), street);
  HorseMind.setDecisionScope(null);
  return w;
}
function identicalToOff(v: Shape, spot: Spot, mode: Mode = 'cash'): void {
  const off = tally(v, spot, {}, mode);
  const on = tally(v, spot, ON, mode);
  expect(on.digests, spot.name).toEqual(off.digests);
  expect(on.value + on.commitment, spot.name).toBe(0);
}
afterEach(() => HorseMind.reset());

describe('style read #4b: a turn raise from a passive, value-heavy player', () => {
  it('off: weak two pair on a four-straight board calls the 4x check-raise on every seed, as the hand was played', () => {
    const off = tally(passiveRegular(), turnCheckRaise(), {});
    expect(off.actions).toEqual({ call: N });
    expect(off.value + off.commitment).toBe(0);
  });

  it('on, passive regular (pre-repair profile, no shown-strength memory): the 4x check-raise is folded on every seed', () => {
    const on = tally(passiveRegular(), turnCheckRaise(), ON);
    expect(on.actions).toEqual({ fold: N });
    expect(on.value).toBe(N);
    expect(tally(passiveRegular(), turnCheckRaise(), { styleRaiseRespect: true }).actions).toEqual({
      fold: N,
    });
  });

  it('unknown, maniac-shaped and balanced players: the off decision, seed for seed (unknown is not tight)', () => {
    for (const v of [UNKNOWN, maniacShaped(), balanced()]) {
      identicalToOff(v, turnCheckRaise());
      expect(tally(v, turnCheckRaise(), ON).actions.fold ?? 0).toBe(0);
    }
  });

  it('a thin street sample (no raise in nine turn chances) is not evidence: the off decision', () => {
    expect(weightOf(thinSample())).toBe(0);
    identicalToOff(thinSample(), turnCheckRaise());
  });

  it('the fast window showing him raising withdraws it at once: the off decision', () => {
    expect(weightOf(gearChanged())).toBe(0);
    identicalToOff(gearChanged(), turnCheckRaise());
  });

  it('the weight is 1 at or below the Horse raise rate and falls to 0 at twice it', () => {
    expect(weightOf(passiveRegular())).toBe(1);
    const mid = weightOf(turnRaiser(5));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(weightOf(turnRaiser(9))).toBe(0);
    identicalToOff(turnRaiser(9), turnCheckRaise());
  });

  it('the raise-size weight: half at a min-raise, full from three times the bet', () => {
    expect(valueRaiseSizeWeight(2)).toBe(0.5);
    expect(valueRaiseSizeWeight(2.5)).toBe(0.75);
    expect(valueRaiseSizeWeight(3)).toBe(1);
    expect(valueRaiseSizeWeight(4)).toBe(1);
    expect(valueRaiseSizeWeight(1)).toBe(0);
  });

  it('a min-raise is not folded when the blended equity covers the price: one pair at 18 percent, bottom two pair on a dry board', () => {
    // 30 more into 138: 30 / 168 = 17.9 percent
    for (const hole of ['Ad9c', '7d2h']) {
      const spot = turnCheckRaise(hole, 'Ah7sKd2c', { raiseTo: 60, behind: 311.65 });
      const off = tally(passiveRegular(), spot, {});
      const on = tally(passiveRegular(), spot, ON);
      expect(off.actions, hole).toEqual({ call: N });
      expect(on.actions, hole).toEqual({ call: N });
      expect(on.digests, hole).toEqual(off.digests);
    }
  });

  it('top two pair on the four-straight board against the 4x raise is not folded: it covers the whole commitment and puts the rest in', () => {
    const spot = turnCheckRaise('KdQc');
    const off = tally(passiveRegular(), spot, {});
    const on = tally(passiveRegular(), spot, ON);
    expect(off.actions).toEqual({ call: N });
    expect(on.actions).toEqual({ raise: N });
    expect(on.commitment).toBe(N);
    // with a real stack behind him it is the plain call
    identicalToOff(passiveRegular(), turnCheckRaise('KdQc', 'Qs8hTdKs', { behind: 150 }));
  });

  it('sets and better are never touched', () => {
    for (const hole of ['8d8c', 'KdKc', 'AdJc', 'Jd9c'])
      identicalToOff(passiveRegular(), turnCheckRaise(hole));
    identicalToOff(passiveRegular(), riverCheckRaise('8d8c'));
  });

  it('the flop is out: flop decisions are the off decisions', () => {
    for (const hole of ['AdQc', 'AdAc', 'QdTc', 'Qd9c', '7d6c'])
      for (const behind of [135.65, 60])
        identicalToOff(passiveRegular(), flopCheckRaise(hole, 'Qs8hTd', behind));
  });

  it('tournaments: the stratum and the commitment price are cash only, so every tournament decision is the off decision', () => {
    for (const hole of ['QdTc', 'KdQc', 'AdKc'])
      identicalToOff(
        passiveRegular(),
        turnCheckRaise(hole, hole === 'AdKc' ? 'Ah7sKd2c' : 'Qs8hTdKs', { mode: 'tournament' }),
        'tournament'
      );
  });

  it('never continues a hand the off decision folded, against any player, hand or raise size', () => {
    for (const v of [passiveRegular(), turnRaiser(5), maniacShaped(), UNKNOWN])
      for (const [hole, board] of [
        ['QdTc', 'Qs8hTdKs'],
        ['AdKc', 'Ah7sKd2c'],
        ['Kd9c', 'Qs8hTdKs'],
        ['7d6c', 'Qs8hTdKs'],
      ])
        for (const o of [{}, { raiseTo: 60, behind: 311.65 }, { raiseTo: 90, behind: 150 }]) {
          const spot = turnCheckRaise(hole, board, o);
          const off = tally(v, spot, {});
          const on = tally(v, spot, ON);
          for (let i = 0; i < N; i++)
            if (RANK[act(off.digests[i]!)] === 0)
              expect(RANK[act(on.digests[i]!)], `${spot.name}/${i}`).toBe(0);
        }
  });
});

describe('style read #4b: the commitment price (cash, turn, a call that leaves him a quarter of the pot or less)', () => {
  it('a hand that continues puts the rest in instead of calling, with the receipt', () => {
    // top two pair on a dry A-K-7-2 board beats every two pair he can raise with and loses only to sets
    const spot = turnCheckRaise('AdKc', 'Ah7sKd2c');
    const off = tally(passiveRegular(), spot, {});
    const on = tally(passiveRegular(), spot, ON);
    expect(off.actions).toEqual({ call: N });
    expect(on.actions.fold ?? 0).toBe(0);
    expect(on.actions.call ?? 0).toBe(0);
    expect(on.commitment).toBe(N);
    expect(on.value).toBe(0);
    install(passiveRegular());
    const d = decide(spot, ON).decision;
    // the matched wager: a raise that covers his 37.65, never more than he can match
    expect(d.action === 'all_in' || (d.action === 'raise' && (d.amount ?? 0) >= 120 + 37.65)).toBe(
      true
    );
  });

  it('applies only when the call leaves him a small share of the pot', () => {
    // 150 behind a 288 pot is a real river decision: the strong hand keeps the plain call, the weak one still folds
    expect(150).toBeGreaterThan(STYLE_THRESHOLDS.raiseCommitRemainderMaxPot * 288);
    const strong = tally(passiveRegular(), turnCheckRaise('AdKc', 'Ah7sKd2c', { behind: 150 }), ON);
    expect(strong.actions).toEqual({ call: N });
    expect(strong.commitment).toBe(0);
    const weak = tally(passiveRegular(), turnCheckRaise('QdTc', 'Qs8hTdKs', { behind: 150 }), ON);
    expect(weak.actions.call ?? 0).toBe(0);
  });
});

describe('style read #4b: a river raise', () => {
  it('weak two pair folds the passive regular’s river check-raise; an unknown player gets the off decision', () => {
    const off = tally(passiveRegular(), riverCheckRaise(), {});
    const on = tally(passiveRegular(), riverCheckRaise(), ON);
    for (let i = 0; i < N; i++)
      expect(RANK[act(on.digests[i]!)]).toBeLessThanOrEqual(RANK[act(off.digests[i]!)]!);
    expect(off.actions).toEqual({ call: N });
    expect(on.actions).toEqual({ fold: N });
    identicalToOff(UNKNOWN, riverCheckRaise());
  });
});

describe('style read #4b: the value-raise stratum', () => {
  it('a turn raise is two pair or better about nine times in ten, with fewer bluffs than the V66 stratum', () => {
    let bluff = 0;
    let strong = 0;
    const n = 200;
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        const c = styleValueRaiseTargetClass(0, (a + 0.5) / n, (b + 0.5) / n);
        if (c === 0) bluff++;
        if (c === 3) strong++;
      }
    expect(STYLE_VALUE_RAISE_BLUFF_SHARE[0]).toBeLessThan(V66_RAISE_BLUFF_SHARE[1]);
    expect(bluff / (n * n)).toBeCloseTo(STYLE_VALUE_RAISE_BLUFF_SHARE[0], 2);
    expect(strong / (n * n)).toBeCloseTo(
      (1 - STYLE_VALUE_RAISE_BLUFF_SHARE[0]) * STYLE_VALUE_RAISE_STRONG_SHARE[0],
      2
    );
  });
});

describe('style read #4b: a stored profile supplied privately (skipped without HORSE_STYLE_PRIVATE_PROFILE_JSON)', () => {
  const path = process.env.HORSE_STYLE_PRIVATE_PROFILE_JSON;
  it.skipIf(!path)(
    'the reviewed turn check-raise: call with the option off, fold with it on, on every seed',
    () => {
      const real = JSON.parse(readFileSync(path!, 'utf8')) as Shape;
      expect(tally(real, turnCheckRaise(), {}).actions).toEqual({ call: N });
      const on = tally(real, turnCheckRaise(), ON);
      expect(on.actions).toEqual({ fold: N });
      expect(on.value).toBe(N);
    }
  );
});
