/**
 * Layer receipts (2026-11-05): the two-week horse inventory listed decision
 * layers that run live but emitted no telemetry receipt, so their use could
 * not be counted. Each now fires a receipt exactly where it acts. These tests
 * drive the real entry points (HorseLogic.decide, HorseMind, the Lightning
 * snapshot, the history cache) on a pinned clock and check that the receipt
 * fires when the layer is reached and acted, and never when it is not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionRecord, Card, GameVariant, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { jointPolicyFixture } from './multiway/JointRangeFixture.test-support.js';
import { BB, stateFor, type Vs3Ctx } from './HorseVs3BetDefence.test-support.js';

const CLOCK_MS = Date.UTC(2026, 10, 5, 15, 0, 0); // pinned decision clock
const VILLAIN = 'villain-1';

const cards = (s: string): Card[] =>
  s.split(' ').map((c) => ({
    rank: c[0] as Card['rank'],
    suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[c[1] as 'c'],
  }));

type Fired = Record<string, number>;
function fires(): Fired {
  const out: Fired = {};
  for (const r of drainFires()) out[r.feature] = r.fires;
  return out;
}

function decide(
  hero: SeatPlayer,
  gs: unknown,
  seed: number,
  opts: Record<string, unknown> = {}
): { action: string; amount?: number; fired: Fired } {
  seedFastRandom(seed);
  drainFires();
  const d = HorseLogic.decide(hero, gs as HorseGameStateV2, 'balanced', {}, {
    telemetry: true,
    decisionTimeMs: CLOCK_MS,
    ...opts,
  } as never);
  return { action: d.action, amount: d.amount, fired: fires() };
}

/** Heads-up postflop spot, villain has wagered `bet` into the pot on `street`. */
function spot(input: {
  variant: GameVariant;
  hole: string;
  board: string;
  street: 'flop' | 'turn' | 'river';
  bet: number;
  mode?: 'cash' | 'tournament';
  stack?: number;
  extraAllIn?: number;
}) {
  const stack = input.stack ?? 400;
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack,
      bet: 0,
      totalInvested: 18,
      cards: cards(input.hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: stack - input.bet,
      bet: input.bet,
      totalInvested: 18 + input.bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: false,
    } as SeatPlayer,
  ];
  const history: Array<Record<string, unknown>> = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
  ];
  let ts = 3;
  for (const st of ['flop', 'turn', 'river'] as const) {
    if (st === input.street) break;
    history.push({
      stage: st,
      seat: 1,
      userId: 'hero',
      action: 'check',
      amount: 0,
      timestamp: ts++,
    });
    history.push({
      stage: st,
      seat: 2,
      userId: VILLAIN,
      action: 'check',
      amount: 0,
      timestamp: ts++,
    });
  }
  history.push({
    stage: input.street,
    seat: 1,
    userId: 'hero',
    action: 'check',
    amount: 0,
    timestamp: ts++,
  });
  if (input.bet > 0)
    history.push({
      stage: input.street,
      seat: 2,
      userId: VILLAIN,
      action: 'bet',
      amount: input.bet,
      timestamp: ts++,
    });
  let pot = 36 + input.bet;
  if (input.extraAllIn) {
    // A third player called all in short after the bet (no raise marker).
    players.push({
      seat: 3,
      user_id: 'short-3',
      username: 's',
      stack: 0,
      bet: input.extraAllIn,
      totalInvested: 18 + input.extraAllIn,
      cards: [],
      is_folded: false,
      is_all_in: true,
      is_sitting_out: false,
      is_horse: false,
    } as SeatPlayer);
    history.push({
      stage: input.street,
      seat: 3,
      userId: 'short-3',
      action: 'all_in',
      amount: input.extraAllIn,
      timestamp: ts++,
    });
    pot += input.extraAllIn;
  }
  const potLimit = ['plo4', 'plo5', 'plo6', 'plo8'].includes(input.variant);
  const toCall = input.bet;
  const minRaiseTo = input.bet > 0 ? input.bet * 2 : 2;
  const maxRaiseTo = potLimit ? Math.min(stack, input.bet + pot + toCall) : stack;
  const gs = {
    stateSchemaVersion: 1,
    players,
    communityCards: cards(input.board),
    pot,
    currentBet: input.bet,
    minRaise: Math.max(2, input.bet),
    lastRaise: Math.max(2, input.bet),
    stage: input.street,
    gameVariant: input.variant,
    gameMode: input.mode ?? 'cash',
    format: (input.mode ?? 'cash') === 'cash' ? 'cash' : 'mtt',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: 1,
    heroSeat: 1,
    currentPlayerSeat: 1,
    boardCount: 1,
    toCall,
    minRaiseTo,
    maxRaiseTo,
    legalActions: input.bet > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    bettingStructure: potLimit ? 'pot_limit' : 'no_limit',
    actionHistory: history as unknown as ActionRecord[],
    dealtSeatIds: players.map((p) => p.seat),
  };
  return { hero: players[0], gs };
}

/** Hand 44826179: the river nuts facing a bet with a legal raise (law test fixture). */
function riverNutsIncident(variant: GameVariant, nuts = true) {
  const { hero, state } = jointPolicyFixture(variant, 1, 'cash', 'river');
  hero.cards = cards(
    nuts
      ? variant === 'plo5'
        ? '7c 5d Ac Kh Qh'
        : '7c 5d'
      : variant === 'plo5'
        ? 'Ac Kh Qh Td 9c'
        : 'Ac Kh'
  );
  hero.stack = 275.5;
  hero.bet = 0;
  state.communityCards = cards('2d 3s 6s Jh 4d');
  state.players = [
    hero,
    { ...state.players[1], bet: 50, stack: 690.7 },
    { ...state.players[2], is_folded: true },
    { ...state.players[3], is_folded: true },
  ];
  Object.assign(state, {
    pot: 169,
    currentBet: 50,
    toCall: 50,
    minRaise: 50,
    lastRaise: 50,
    minRaiseTo: 100,
    maxRaiseTo: 269,
    legalActions: ['fold', 'call', 'raise'],
    dealerSeat: 4,
  });
  return { hero, state };
}

describe('layer receipts fire where the layer acts and nowhere else', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('river nuts (#7780, #7788): the receipt fires only when the rule changed the wager, and never without the nuts', () => {
    let changed = 0;
    for (const variant of ['plo5', 'nlh'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const { hero, state } = riverNutsIncident(variant);
        const r = decide(hero, state, seed, { mind: false, v9Timing: false });
        expect(['raise', 'all_in']).toContain(r.action);
        if (r.action === 'raise' && !r.fired.river_nuts_wager) {
          // valid no-change: the nuts were already raised to the full target
          expect(r.fired.river_nuts_wager_already_full).toBe(1);
        }
        if (r.fired.river_nuts_wager) {
          expect(r.fired.river_nuts_wager_already_full).toBeUndefined();
          changed++;
          // the rule only ever moves a wager up to the full target
          if (r.action === 'raise') expect(r.amount).toBe(269);
        }
        const off = decide(
          riverNutsIncident(variant, false).hero,
          riverNutsIncident(variant, false).state,
          seed,
          {
            mind: false,
            v9Timing: false,
          }
        );
        expect(off.fired.river_nuts_wager).toBeUndefined();
        expect(off.fired.river_nuts_wager_already_full).toBeUndefined();
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('near-pot wagers (#7780): the full-pot receipt never fires on a call, fold or check', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = spot({
        variant: 'nlh',
        hole: '7c 2d',
        board: 'Kh 9d 3s 7h 2c',
        street: 'river',
        bet: 36,
      });
      const r = decide(s.hero, s.gs, seed, { mind: false });
      if (r.action !== 'bet' && r.action !== 'raise')
        expect(r.fired.near_pot_wager_full_pot).toBeUndefined();
    }
  });

  it('Omaha implied credit (#7876): withheld without a draw, granted to a real draw, silent in hold em', () => {
    const noDraw = spot({
      variant: 'plo4',
      hole: '9c 9d 2s 3h',
      board: 'Ah Kh 7c Jd',
      street: 'turn',
      bet: 12,
    });
    const draw = spot({
      variant: 'plo4',
      hole: 'Ah Kh 9s 8s',
      board: 'Qh 7h 6c Jd',
      street: 'turn',
      bet: 12,
    });
    const holdem = spot({
      variant: 'nlh',
      hole: 'Ah Kh',
      board: 'Qh 7h 6c Jd',
      street: 'turn',
      bet: 12,
    });
    let granted = 0;
    let withheld = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const a = decide(noDraw.hero, noDraw.gs, seed, { mind: false });
      expect(a.fired.omaha_implied_credit_draw).toBeUndefined();
      if (a.fired.omaha_implied_credit_withheld) withheld++;
      const b = decide(draw.hero, draw.gs, seed, { mind: false });
      expect(b.fired.omaha_implied_credit_withheld).toBeUndefined();
      if (b.fired.omaha_implied_credit_draw) granted++;
      const c = decide(holdem.hero, holdem.gs, seed, { mind: false });
      expect(c.fired.omaha_implied_credit_draw).toBeUndefined();
      expect(c.fired.omaha_implied_credit_withheld).toBeUndefined();
    }
    expect(withheld).toBeGreaterThan(0);
    expect(granted).toBeGreaterThan(0);
  });

  it('Omaha draw blockers (#8220): the board-blocked nut draw receipt fires for Q-high on A-K of the suit only', () => {
    const blocked = spot({
      variant: 'plo4',
      hole: 'Qh Jh 9s 8s',
      board: 'Ah Kh 6c 2d',
      street: 'turn',
      bet: 12,
    });
    const plain = spot({
      variant: 'plo4',
      hole: 'Ah Jh 9s 8s',
      board: 'Kh 7h 6c 2d',
      street: 'turn',
      bet: 12,
    });
    let fired = 0;
    for (let seed = 1; seed <= 6; seed++) {
      if (
        decide(blocked.hero, blocked.gs, seed, { mind: false }).fired.omaha_board_blocked_nut_draw
      )
        fired++;
      expect(
        decide(plain.hero, plain.gs, seed, { mind: false }).fired.omaha_board_blocked_nut_draw
      ).toBeUndefined();
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('PLO8 outlook (#9351): the low-draw receipt fires for a PLO8 low draw and never in PLO4 or hold em', () => {
    const plo8 = spot({
      variant: 'plo8',
      hole: 'Ah 2d Kc Qs',
      board: '3h 7c Jd',
      street: 'flop',
      bet: 0,
    });
    const plo4 = spot({
      variant: 'plo4',
      hole: 'Ah 2d Kc Qs',
      board: '3h 7c Jd',
      street: 'flop',
      bet: 0,
    });
    const nlh = spot({ variant: 'nlh', hole: 'Ah 2d', board: '3h 7c Jd', street: 'flop', bet: 0 });
    let fired = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = decide(plo8.hero, plo8.gs, seed);
      if (r.fired.plo8_low_outlook_read || r.fired.plo8_low_outlook_considered) fired++;
      for (const s of [plo4, nlh]) {
        const o = decide(s.hero, s.gs, seed);
        expect(o.fired.plo8_low_outlook_read).toBeUndefined();
        expect(o.fired.plo8_low_outlook_considered).toBeUndefined();
      }
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('reads bound to the wager (#8847): the opponent read names the bettor, and the short all-in receipt only when one followed', () => {
    const plain = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
    });
    const shortCaller = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
      extraAllIn: 20,
    });
    const a = decide(plain.hero, plain.gs, 3);
    expect(a.fired.wager_bound_opponent_read).toBe(1);
    expect(a.fired.wager_bound_opponent_read_past_short_all_in).toBeUndefined();
    const b = decide(shortCaller.hero, shortCaller.gs, 3);
    expect(b.fired.wager_bound_opponent_read).toBe(1);
    expect(b.fired.wager_bound_opponent_read_past_short_all_in).toBe(1);
    // nothing wagered: no read to bind
    const free = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 0,
    });
    expect(decide(free.hero, free.gs, 3).fired.wager_bound_opponent_read).toBeUndefined();
    expect(decide(free.hero, free.gs, 3).fired.wager_bound_pressure_read).toBeUndefined();
    // the V40 barrel-count read binds to the same wager, in every variant
    const plo = spot({
      variant: 'plo4',
      hole: 'Ks Kd 5h 4h',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
    });
    expect(decide(plo.hero, plo.gs, 3).fired.wager_bound_pressure_read).toBe(1);
    expect(a.fired.wager_bound_pressure_read).toBe(1);
  });

  it('river caller showdown read (#8160, #8214): consulted on a heads-up river with no sample, and taught at showdown', () => {
    const river = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c 2d',
      street: 'river',
      bet: 36,
    });
    const r = decide(river.hero, river.gs, 5);
    expect(r.fired.river_call_light_read_considered).toBe(1);
    expect(r.fired.river_call_light_read).toBeUndefined();
    const turn = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
    });
    const t = decide(turn.hero, turn.gs, 5);
    expect(t.fired.river_call_light_read_considered).toBeUndefined();
  });

  it('heads-up cash matched commitment (#8464): matched when the opponent is shorter, covered when it is not, never in a tournament', () => {
    const cash = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
    });
    // Equal stacks: the opponent covers, so the matched exposure is the stack (valid no-change).
    const covered = decide(cash.hero, cash.gs, 2, { mind: false }).fired;
    expect(covered.hu_cash_matched_commitment_covered).toBe(1);
    expect(covered.hu_cash_matched_commitment).toBeUndefined();
    const short = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
    });
    const shortVillain = short.gs.players.find((p) => p.seat !== short.hero.seat)!;
    shortVillain.stack = 100;
    const matched = decide(short.hero, short.gs, 2, { mind: false }).fired;
    expect(matched.hu_cash_matched_commitment).toBe(1);
    expect(matched.hu_cash_matched_commitment_covered).toBeUndefined();
    const mtt = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 36,
      mode: 'tournament',
    });
    const mttFired = decide(mtt.hero, mtt.gs, 2, { mind: false }).fired;
    expect(mttFired.hu_cash_matched_commitment).toBeUndefined();
    expect(mttFired.hu_cash_matched_commitment_covered).toBeUndefined();
    const free = spot({
      variant: 'nlh',
      hole: 'Ks 5d',
      board: 'Kh 9d 3s 7c',
      street: 'turn',
      bet: 0,
    });
    expect(
      decide(free.hero, free.gs, 2, { mind: false }).fired.hu_cash_matched_commitment
    ).toBeUndefined();
  });

  it('V60 cash pressure (#8694): the opener-facing-a-3-bet receipt fires in NLH cash and not in a tournament', () => {
    const CASH6: Vs3Ctx = {
      seats: 6,
      stackBB: 100,
      mode: 'cash',
      ante: false,
      openBB: 2.5,
      threeBetX: 4,
    };
    const MTT9: Vs3Ctx = {
      seats: 9,
      stackBB: 80,
      mode: 'tournament',
      ante: true,
      openBB: 2.3,
      threeBetX: 3.6,
    };
    const hole = cards('Ah Qs');
    const cash = stateFor(CASH6, 4, 2, hole);
    const r = decide(cash.hero, cash.gs, 9, { mind: false });
    expect(r.fired.v60_cash_pressure_opener_vs_three_bet).toBe(1);
    expect(r.fired.v60_cash_pressure_facing_open).toBeUndefined();
    const mtt = stateFor(MTT9, 6, 2, hole);
    const m = decide(mtt.hero, mtt.gs, 9, { mind: false });
    expect(m.fired.v60_cash_pressure_opener_vs_three_bet).toBeUndefined();
    const off = decide(cash.hero, cash.gs, 9, { mind: false, v60CashPressure: false });
    expect(off.fired.v60_cash_pressure_opener_vs_three_bet).toBeUndefined();
    // raise first in: neither V60 bar is touched
    const rfi = stateFor(CASH6, 4, -1, hole);
    const o = decide(rfi.hero, rfi.gs, 9, { mind: false });
    expect(o.fired.v60_cash_pressure_opener_vs_three_bet).toBeUndefined();
    expect(o.fired.v60_cash_pressure_facing_open).toBeUndefined();
  });

  it('V60 cash pressure (#8694): the facing-one-open receipt fires for a big blind facing a cutoff open in NLH cash only', () => {
    const facing = (mode: 'cash' | 'tournament') => {
      const n = 6;
      const players: SeatPlayer[] = [];
      for (let seat = 1; seat <= n; seat++) {
        const bet = seat === 1 ? 1 : seat === 2 ? 2 : seat === 5 ? 2.5 * BB : 0;
        players.push({
          seat,
          user_id: `p${seat}`,
          username: `P${seat}`,
          stack: 100 * BB - bet,
          bet,
          totalInvested: bet,
          cards: seat === 2 ? cards('Ah Qs') : [],
          is_folded: seat === 3 || seat === 4 || seat === 6 || seat === 1,
          is_all_in: false,
          is_sitting_out: false,
          is_horse: true,
        } as SeatPlayer);
      }
      const history = [
        { seat: 3, userId: 'p3', action: 'fold', amount: 0, stage: 'preflop', timestamp: 100 },
        { seat: 4, userId: 'p4', action: 'fold', amount: 0, stage: 'preflop', timestamp: 101 },
        {
          seat: 5,
          userId: 'p5',
          action: 'raise',
          amount: 2.5 * BB,
          stage: 'preflop',
          timestamp: 102,
          isFullRaise: true,
        },
        { seat: 6, userId: 'p6', action: 'fold', amount: 0, stage: 'preflop', timestamp: 103 },
        { seat: 1, userId: 'p1', action: 'fold', amount: 0, stage: 'preflop', timestamp: 104 },
      ] as unknown as ActionRecord[];
      const gs = {
        players,
        communityCards: [],
        pot: 1 + 2 + 2.5 * BB,
        currentBet: 2.5 * BB,
        minRaise: 1.5 * BB,
        lastRaise: 1.5 * BB,
        stage: 'preflop',
        gameVariant: 'nlh',
        bigBlind: BB,
        dealerSeat: 6,
        actionHistory: history,
        gameMode: mode,
        format: mode === 'cash' ? 'cash' : 'mtt',
        dealtSeatIds: players.map((p) => p.seat),
      };
      return { hero: players[1], gs };
    };
    const c = facing('cash');
    const r = decide(c.hero, c.gs, 11, { mind: false });
    // The layer is reached; here the V74 per-seat base owns the 3-bet width,
    // so the receipt records the precedence outcome, not an applied bar.
    expect(
      (r.fired.v60_cash_pressure_facing_open ?? 0) +
        (r.fired.v60_cash_pressure_facing_open_superseded ?? 0)
    ).toBe(1);
    expect(r.fired.v60_cash_pressure_facing_open_superseded).toBe(1);
    expect(r.fired.v60_cash_pressure_opener_vs_three_bet).toBeUndefined();
    const t = facing('tournament');
    const tf = decide(t.hero, t.gs, 11, { mind: false }).fired;
    expect(tf.v60_cash_pressure_facing_open).toBeUndefined();
    expect(tf.v60_cash_pressure_facing_open_superseded).toBeUndefined();
  });

  it('range reads (#8563): a priced big wager is counted and a capped all-in call is not, through HorseMind.bandFor', () => {
    const base = [
      {
        seat: 1,
        userId: 'hero',
        action: 'raise',
        amount: 6,
        stage: 'preflop',
        timestamp: 1,
        isFullRaise: true,
      },
      { seat: 2, userId: VILLAIN, action: 'call', amount: 6, stage: 'preflop', timestamp: 2 },
      { seat: 1, userId: 'hero', action: 'bet', amount: 60, stage: 'flop', timestamp: 3 },
    ] as unknown as ActionRecord[];
    drainFires();
    HorseMind.bandFor(
      VILLAIN,
      [
        ...base,
        {
          seat: 2,
          userId: VILLAIN,
          action: 'raise',
          amount: 180,
          stage: 'flop',
          timestamp: 4,
          isFullRaise: true,
        } as unknown as ActionRecord,
      ],
      2,
      true,
      null,
      {} as never
    );
    expect(fires().range_read_big_bet_counted).toBe(1);
    drainFires();
    // a capped all-in CALL of 60 (20bb or more) at the same price is not a bet
    HorseMind.bandFor(
      VILLAIN,
      [
        ...base,
        {
          seat: 2,
          userId: VILLAIN,
          action: 'all_in',
          amount: 60,
          stage: 'flop',
          timestamp: 4,
        } as unknown as ActionRecord,
      ],
      2,
      true,
      null,
      {} as never
    );
    const f = fires();
    expect(f.range_read_capped_all_in_not_big_bet).toBe(1);
    expect(f.range_read_big_bet_counted).toBeUndefined();
    drainFires();
    // no readOut: the read is not consumed, nothing is counted
    HorseMind.bandFor(VILLAIN, base, 2);
    expect(fires().range_read_big_bet_counted).toBeUndefined();
  });

  it('river opportunity counters (#8386) and shown river calls (#8160): counted at hand completion', () => {
    const a = (
      userId: string,
      action: string,
      stage = 'river',
      amount = action === 'check' || action === 'fold' ? 0 : 10
    ) => ({
      userId,
      action,
      stage,
      amount,
    });
    const actions = [a('a', 'check'), a('b', 'bet')].map((v, i) => ({
      ...v,
      seat: i + 1,
      timestamp: 1793000000000 + i,
    })) as ActionRecord[];
    const identity = {
      version: 1 as const,
      tableId: '11111111-1111-4111-8111-111111111111',
      handNumber: 1000001,
    };
    drainFires();
    HorseMind.observe(actions, [], identity, 2);
    expect(fires().river_last_to_act_counted).toBe(1);
    // the same original hand is never counted twice
    HorseMind.observe(actions, [], identity, 2);
    expect(fires().river_last_to_act_counted).toBeUndefined();
  });
});
