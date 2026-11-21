/**
 * LAW: cashDefenceTrimColdCalls (default OFF, 2026-11-21) trims cash cold-calls
 * and removes V85+V87 multiway double-stacking while keeping off/unset
 * byte-identical and preserving V85/V87 3-bet widths, HU/late-open BB defends,
 * V85 opens, and every tournament decision.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import {
  disarmBrainTelemetryForTest,
  drainFires,
  enableBrainTelemetry,
  withDecisionFireScope,
} from './BrainTelemetry.js';
import {
  CASH_TRIM_IP_PER_PLAYER_BEHIND,
  defenceTargets,
  gtoDefence,
  v87WidenDefence,
  type DefenceSpot,
} from './HorseGtoDefenceRanges.js';
import { shareAtScore } from './HorseGtoOpeningRanges.js';
import { HORSE_HYBRID_PROFILES } from './HorseHybridProfile.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const CLOCK_MS = Date.UTC(2026, 10, 21, 15, 0, 0);
const CASH_MODS = HORSE_HYBRID_PROFILES.cash.mods;
const CASH_STYLE = HORSE_HYBRID_PROFILES.cash.style;
const TOUR_MODS = HORSE_HYBRID_PROFILES.tournament.mods;
const TOUR_STYLE = HORSE_HYBRID_PROFILES.tournament.style;

const decisionProjection = (d: ReturnType<typeof HorseLogic.decide>) => ({
  action: d.action,
  amount: d.amount,
  thinkTime: d.thinkTime,
  preflopReadReceipt: d.preflopReadReceipt,
  preflopAuthority: d.preflopAuthority,
});

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

/** Build a clean facing-open or unopened table state for synthetic testing. */
function makeSpot(opts: {
  seats: number;
  mode: 'cash' | 'tournament';
  bb: number;
  stackBB: number;
  heroSeat: number;
  openerSeat: number | null;
  callerSeats?: number[];
  openBB?: number;
  ante?: number;
  hole: [Card, Card];
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const { seats, mode, bb, stackBB, heroSeat, openerSeat, hole } = opts;
  const callerSet = new Set(opts.callerSeats ?? []);
  const openTo = openerSeat !== null ? (opts.openBB ?? 3.5) * bb : bb;
  const ante = opts.ante ?? 0;
  const players: SeatPlayer[] = [];
  for (let seat = 1; seat <= seats; seat++) {
    const blind = seat === 1 ? bb / 2 : seat === 2 ? bb : 0;
    const bet = seat === openerSeat || callerSet.has(seat) ? openTo : blind;
    const seatAnte = seat === 2 && ante > 0 ? ante : 0;
    players.push({
      seat,
      user_id: `p-${seat}`,
      username: `P${seat}`,
      stack: stackBB * bb - bet - seatAnte,
      bet,
      totalInvested: bet + seatAnte,
      cards: seat === heroSeat ? [...hole] : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
  }
  const actOrder =
    seats === 2 ? [1, 2] : [...Array(seats - 2).keys()].map((k) => 3 + k).concat([1, 2]);
  const history: ActionRecord[] = [];
  let ts = 100;
  for (const seat of actOrder) {
    if (seat === heroSeat) break;
    const p = players[seat - 1];
    if (seat === openerSeat) {
      history.push({
        seat,
        userId: p.user_id,
        action: 'raise',
        amount: openTo,
        timestamp: ts++,
        stage: 'preflop',
        isFullRaise: true,
      } as ActionRecord);
    } else if (callerSet.has(seat)) {
      history.push({
        seat,
        userId: p.user_id,
        action: 'call',
        amount: openTo,
        timestamp: ts++,
        stage: 'preflop',
      } as ActionRecord);
    } else {
      p.is_folded = true;
      history.push({
        seat,
        userId: p.user_id,
        action: 'fold',
        amount: 0,
        timestamp: ts++,
        stage: 'preflop',
      } as ActionRecord);
    }
  }
  const pot = players.reduce((s, p) => s + p.totalInvested, 0);
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet: openTo,
    minRaise: openerSeat !== null ? openTo - bb : bb,
    lastRaise: openerSeat !== null ? openTo - bb : bb,
    stage: 'preflop',
    gameVariant: 'nlh',
    bigBlind: bb,
    smallBlind: bb / 2,
    dealerSeat: seats === 2 ? 1 : seats,
    actionHistory: history,
    gameMode: mode,
    ante,
    bigBlindAnte: ante > 0,
    format: mode === 'cash' ? 'cash' : 'mtt',
    dealtSeatIds: players.map((p) => p.seat),
    blindSeats: { smallBlind: 1, bigBlind: 2 },
    ...(mode === 'tournament'
      ? {
          tournament: {
            schemaVersion: 1,
            contextStatus: 'complete',
            contextIssues: [],
            playersLeft: 120,
            spotsPaid: 24,
            entrants: 200,
            avgStackChips: stackBB * bb,
            medianStackChips: stackBB * bb,
            seatsPerTable: seats,
            playersAtTable: seats,
            nearBubble: false,
            inMoney: false,
            payoutPct: [30, 20, 14, 10, 8, 6, 4, 3, 3, 2],
            currentSmallBlind: bb / 2,
            currentBigBlind: bb,
            currentAnte: ante,
            anteType: ante > 0 ? 'big_blind' : 'none',
            nextSmallBlind: bb,
            nextBigBlind: bb * 2,
            nextAnte: ante * 2,
            nextBlindInMin: 10,
          },
        }
      : {}),
  } as unknown as HorseGameStateV2;
  return { hero: players[heroSeat - 1], gs };
}

describe('cashDefenceTrimColdCalls (default OFF)', () => {
  it('is byte-identical when unset or explicitly false at range and engine levels', () => {
    const spots: DefenceSpot[] = [
      {
        dealt: 9,
        defender: 'ip',
        openerBehind: 8,
        defenderBehind: 6,
        ante: false,
        openToBB: 4,
        cashAction: true,
        callers: 0,
        depthBB: 200,
      },
      {
        dealt: 9,
        defender: 'ip',
        openerBehind: 8,
        defenderBehind: 5,
        ante: false,
        openToBB: 4,
        cashAction: true,
        callers: 2,
        depthBB: 200,
      },
      {
        dealt: 9,
        defender: 'bb',
        openerBehind: 6,
        defenderBehind: 0,
        ante: false,
        openToBB: 4,
        cashAction: true,
        callers: 1,
        depthBB: 200,
      },
      {
        dealt: 9,
        defender: 'sb',
        openerBehind: 3,
        defenderBehind: 1,
        ante: false,
        openToBB: 3,
        cashAction: true,
        callers: 0,
        depthBB: 100,
      },
      {
        dealt: 2,
        defender: 'bb',
        openerBehind: 1,
        defenderBehind: 0,
        ante: false,
        openToBB: 2.5,
        cashAction: true,
        callers: 0,
        depthBB: 100,
      },
    ];
    for (const s of spots) {
      expect(defenceTargets({ ...s, trimColdCalls: false })).toEqual(defenceTargets(s));
    }
    const baseBars = { continueBar: 0.42, valueBar: 0.68, bluffProb: 0.18 };
    expect(
      v87WidenDefence(baseBars, {
        defender: 'ip',
        callers: 2,
        lowStakes: 1,
        weight: 1,
        dealt: 9,
        trimContinueBar: false,
      })
    ).toEqual(
      v87WidenDefence(baseBars, { defender: 'ip', callers: 2, lowStakes: 1, weight: 1, dealt: 9 })
    );

    const { hero, gs } = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 5,
      openerSeat: 3,
      callerSeats: [4],
      openBB: 4,
      hole: [card('9', 'hearts'), card('8', 'hearts')],
    });
    for (const seed of [1, 7, 42]) {
      seedFastRandom(seed);
      const a = HorseLogic.decide(hero, gs, CASH_STYLE, CASH_MODS, {
        mind: false,
        decisionTimeMs: CLOCK_MS,
      });
      seedFastRandom(seed);
      const b = HorseLogic.decide(hero, gs, CASH_STYLE, CASH_MODS, {
        mind: false,
        decisionTimeMs: CLOCK_MS,
        cashDefenceTrimColdCalls: false,
      });
      expect(decisionProjection(b)).toEqual(decisionProjection(a));
    }
  });

  it('trims 9-max EP/MP cold-calls with per-player-behind discipline while preserving V85/V87 3-bet bars and HU/BB/SB/BTN bases', () => {
    const seats: DefenceSpot[] = [
      {
        dealt: 9,
        defender: 'ip',
        openerBehind: 8,
        defenderBehind: 2,
        ante: false,
        openToBB: 3.5,
        cashAction: true,
        callers: 0,
        depthBB: 150,
      },
      {
        dealt: 9,
        defender: 'ip',
        openerBehind: 8,
        defenderBehind: 4,
        ante: false,
        openToBB: 3.5,
        cashAction: true,
        callers: 0,
        depthBB: 150,
      },
      {
        dealt: 9,
        defender: 'ip',
        openerBehind: 8,
        defenderBehind: 6,
        ante: false,
        openToBB: 3.5,
        cashAction: true,
        callers: 0,
        depthBB: 150,
      },
      {
        dealt: 9,
        defender: 'ip',
        openerBehind: 8,
        defenderBehind: 5,
        ante: false,
        openToBB: 4,
        cashAction: true,
        callers: 2,
        depthBB: 200,
      },
      {
        dealt: 9,
        defender: 'sb',
        openerBehind: 3,
        defenderBehind: 1,
        ante: false,
        openToBB: 3,
        cashAction: true,
        callers: 0,
        depthBB: 150,
      },
      {
        dealt: 9,
        defender: 'bb',
        openerBehind: 8,
        defenderBehind: 0,
        ante: false,
        openToBB: 4,
        cashAction: true,
        callers: 1,
        depthBB: 200,
      },
      {
        dealt: 9,
        defender: 'bb',
        openerBehind: 2,
        defenderBehind: 0,
        ante: false,
        openToBB: 3,
        cashAction: true,
        callers: 0,
        depthBB: 150,
      },
      {
        dealt: 2,
        defender: 'bb',
        openerBehind: 1,
        defenderBehind: 0,
        ante: false,
        openToBB: 2.5,
        cashAction: true,
        callers: 0,
        depthBB: 150,
      },
    ];
    for (const s of seats) {
      const live = defenceTargets(s);
      const trim = defenceTargets({ ...s, trimColdCalls: true });
      // 3-bet value and bluff targets are preserved identically everywhere.
      expect(trim.value).toBeCloseTo(live.value, 10);
      expect(trim.bluff).toBeCloseTo(live.bluff, 10);
      expect(trim.cont).toBeLessThanOrEqual(live.cont + 1e-9);
    }

    // Per-player-behind IP discipline: BTN > HJ > UTG+2 facing UTG open.
    const btnVsUtg = defenceTargets({ ...seats[0], trimColdCalls: true });
    const hjVsUtg = defenceTargets({ ...seats[1], trimColdCalls: true });
    const utg2VsUtg = defenceTargets({ ...seats[2], trimColdCalls: true });
    expect(CASH_TRIM_IP_PER_PLAYER_BEHIND).toBe(1.8);
    // BTN (defenderBehind === 2) preserves V85 base width.
    expect(btnVsUtg.cont).toBeCloseTo(defenceTargets(seats[0]).cont, 10);
    expect(btnVsUtg.cont).toBeGreaterThan(hjVsUtg.cont);
    expect(hjVsUtg.cont).toBeGreaterThan(utg2VsUtg.cont);
    expect(utg2VsUtg.cont).toBeLessThan(defenceTargets(seats[2]).cont - 5);

    // HU BB, 3+ handed BB, and SB preserve V85 base continue widths.
    for (const idx of [4, 5, 6, 7]) {
      expect(defenceTargets({ ...seats[idx], trimColdCalls: true }).cont).toBeCloseTo(
        defenceTargets(seats[idx]).cont,
        10
      );
    }
  });

  it('removes V85+V87 multiway/low-stakes continueBar double-stacking while keeping V87 3-bet widening and HU BB/SB/BTN bases', () => {
    const spot: DefenceSpot = {
      dealt: 9,
      defender: 'ip',
      openerBehind: 8,
      defenderBehind: 5,
      ante: false,
      openToBB: 4,
      cashAction: true,
      callers: 2,
      depthBB: 200,
    };
    const dLive = gtoDefence(card('A', 'spades'), card('K', 'spades'), spot)!;
    const dTrim = gtoDefence(card('A', 'spades'), card('K', 'spades'), {
      ...spot,
      trimColdCalls: true,
    })!;
    const wLive = v87WidenDefence(dLive, {
      defender: 'ip',
      callers: 2,
      lowStakes: 1,
      weight: 1,
      dealt: 9,
      defenderBehind: 5,
    });
    const wTrim = v87WidenDefence(dTrim, {
      defender: 'ip',
      callers: 2,
      lowStakes: 1,
      weight: 1,
      dealt: 9,
      defenderBehind: 5,
      trimContinueBar: true,
    });
    const liveContPct = shareAtScore(wLive.continueBar) * 100;
    const trimContPct = shareAtScore(wTrim.continueBar) * 100;
    // Live stacks V85+V87 up near ~40%; trimmed eliminates multiway double-stacking.
    expect(liveContPct).toBeGreaterThan(35);
    expect(trimContPct).toBeLessThan(22);
    // V87 3-bet value and bluff bars remain untouched.
    expect(wTrim.valueBar).toBeCloseTo(wLive.valueBar, 6);
    expect(wTrim.bluffProb).toBeCloseTo(wLive.bluffProb, 10);

    // Single-raised BTN (defenderBehind = 2, callers = 0) preserves V87 base widening,
    // while multiway BB (callers = 2) removes V87 perCaller double-stacking.
    const btnBars = { continueBar: 0.42, valueBar: 0.68, bluffProb: 0.18 };
    const btnHuLive = v87WidenDefence(btnBars, {
      defender: 'ip',
      callers: 0,
      lowStakes: 1,
      weight: 1,
      dealt: 9,
      defenderBehind: 2,
    });
    const btnHuTrim = v87WidenDefence(btnBars, {
      defender: 'ip',
      callers: 0,
      lowStakes: 1,
      weight: 1,
      dealt: 9,
      defenderBehind: 2,
      trimContinueBar: true,
    });
    expect(btnHuTrim.continueBar).toBeCloseTo(btnHuLive.continueBar, 6);

    const bbMwLive = v87WidenDefence(btnBars, {
      defender: 'bb',
      callers: 2,
      lowStakes: 1,
      weight: 1,
      dealt: 9,
      defenderBehind: 0,
    });
    const bbMwTrim = v87WidenDefence(btnBars, {
      defender: 'bb',
      callers: 2,
      lowStakes: 1,
      weight: 1,
      dealt: 9,
      defenderBehind: 0,
      trimContinueBar: true,
    });
    expect(shareAtScore(bbMwTrim.continueBar)).toBeLessThan(shareAtScore(bbMwLive.continueBar));
  });

  it('folds loose EP/MP cash cold-calls while keeping V85 opens, 3-bets, and tournaments unchanged', () => {
    // 1. Loose MP cold-call vs 4bb UTG open + caller at $0.50/$1 200bb folds when trimmed.
    const looseSpot = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 5,
      openerSeat: 3,
      callerSeats: [4],
      openBB: 4,
      hole: [card('K', 'diamonds'), card('9', 'diamonds')],
    });
    seedFastRandom(42);
    const liveLoose = HorseLogic.decide(looseSpot.hero, looseSpot.gs, CASH_STYLE, CASH_MODS, {
      mind: false,
      decisionTimeMs: CLOCK_MS,
    });
    seedFastRandom(42);
    const trimLoose = HorseLogic.decide(looseSpot.hero, looseSpot.gs, CASH_STYLE, CASH_MODS, {
      mind: false,
      decisionTimeMs: CLOCK_MS,
      cashDefenceTrimColdCalls: true,
    });
    expect(liveLoose.action).toBe('call');
    expect(trimLoose.action).toBe('fold');

    // 2. Premium value 3-bet hand from CO still 3-bets identically while its call bar tightens.
    const premSpot = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 8,
      openerSeat: 5,
      openBB: 3.5,
      hole: [card('A', 'spades'), card('K', 'spades')],
    });
    seedFastRandom(7);
    const livePrem = HorseLogic.decide(premSpot.hero, premSpot.gs, CASH_STYLE, CASH_MODS, {
      mind: false,
      decisionTimeMs: CLOCK_MS,
    });
    seedFastRandom(7);
    const trimPrem = HorseLogic.decide(premSpot.hero, premSpot.gs, CASH_STYLE, CASH_MODS, {
      mind: false,
      decisionTimeMs: CLOCK_MS,
      cashDefenceTrimColdCalls: true,
    });
    expect(livePrem.action).toBe('raise');
    expect(trimPrem.action).toBe(livePrem.action);
    expect(trimPrem.amount).toBe(livePrem.amount);
    expect(trimPrem.preflopReadReceipt?.threeBetThreshold).toBe(
      livePrem.preflopReadReceipt?.threeBetThreshold
    );
    expect(trimPrem.preflopReadReceipt?.callThreshold ?? 0).toBeGreaterThan(
      livePrem.preflopReadReceipt?.callThreshold ?? 0
    );

    // 3. Unopened cash spot (V85 open) is 100% identical.
    const openSpot = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 3,
      openerSeat: null,
      hole: [card('7', 'hearts'), card('6', 'hearts')],
    });
    seedFastRandom(1);
    const liveOpen = HorseLogic.decide(openSpot.hero, openSpot.gs, CASH_STYLE, CASH_MODS, {
      mind: false,
      decisionTimeMs: CLOCK_MS,
    });
    seedFastRandom(1);
    const trimOpen = HorseLogic.decide(openSpot.hero, openSpot.gs, CASH_STYLE, CASH_MODS, {
      mind: false,
      decisionTimeMs: CLOCK_MS,
      cashDefenceTrimColdCalls: true,
    });
    expect(decisionProjection(trimOpen)).toEqual(decisionProjection(liveOpen));

    // 4. Tournament facing-open decision is 100% identical across seeds.
    const tourSpot = makeSpot({
      seats: 9,
      mode: 'tournament',
      bb: 200,
      stackBB: 50,
      heroSeat: 6,
      openerSeat: 3,
      openBB: 2.2,
      ante: 200,
      hole: [card('J', 'clubs'), card('T', 'clubs')],
    });
    for (const seed of [1, 7, 42]) {
      seedFastRandom(seed);
      const a = HorseLogic.decide(tourSpot.hero, tourSpot.gs, TOUR_STYLE, TOUR_MODS, {
        mind: false,
        decisionTimeMs: CLOCK_MS,
      });
      seedFastRandom(seed);
      const b = HorseLogic.decide(tourSpot.hero, tourSpot.gs, TOUR_STYLE, TOUR_MODS, {
        mind: false,
        decisionTimeMs: CLOCK_MS,
        cashDefenceTrimColdCalls: true,
      });
      expect(decisionProjection(b)).toEqual(decisionProjection(a));
    }
  });

  afterEach(() => {
    drainFires();
    disarmBrainTelemetryForTest();
  });

  it('5. emits cash_defence_trim_cold_calls_seen only when on and trimming non-BTN IP or multiway cash spots', () => {
    enableBrainTelemetry();

    const runFired = (
      spot: { hero: SeatPlayer; gs: HorseGameStateV2 },
      mode: 'cash' | 'tournament',
      trim: boolean
    ): ReadonlySet<string> => {
      drainFires();
      seedFastRandom(7);
      const { fired } = withDecisionFireScope(() =>
        HorseLogic.decide(
          spot.hero,
          spot.gs,
          mode === 'cash' ? CASH_STYLE : TOUR_STYLE,
          mode === 'cash' ? CASH_MODS : TOUR_MODS,
          {
            mind: false,
            telemetry: true,
            decisionTimeMs: CLOCK_MS,
            ...(trim ? { cashDefenceTrimColdCalls: true } : {}),
          }
        )
      );
      return fired;
    };

    // Non-BTN IP facing UTG open (heroBehind = 5 > 2): fires when on, silent when off.
    const mpSpot = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 6,
      openerSeat: 3,
      openBB: 3.5,
      hole: [card('A', 'clubs'), card('9', 'spades')],
    });
    expect(runFired(mpSpot, 'cash', false).has('cash_defence_trim_cold_calls_seen')).toBe(false);
    expect(runFired(mpSpot, 'cash', true).has('cash_defence_trim_cold_calls_seen')).toBe(true);

    // Multiway BB facing UTG open + caller (callers = 1 > 0): fires when on, silent when off.
    const mwBbSpot = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 2,
      openerSeat: 3,
      callerSeats: [6],
      openBB: 3.5,
      hole: [card('Q', 'diamonds'), card('7', 'spades')],
    });
    expect(runFired(mwBbSpot, 'cash', false).has('cash_defence_trim_cold_calls_seen')).toBe(false);
    expect(runFired(mwBbSpot, 'cash', true).has('cash_defence_trim_cold_calls_seen')).toBe(true);

    // Single-raised BTN (heroBehind = 2, callers = 0): untouched by V2, so receipt stays silent.
    const btnSpot = makeSpot({
      seats: 9,
      mode: 'cash',
      bb: 1,
      stackBB: 200,
      heroSeat: 9,
      openerSeat: 6,
      openBB: 3.0,
      hole: [card('J', 'hearts'), card('T', 'hearts')],
    });
    expect(runFired(btnSpot, 'cash', true).has('cash_defence_trim_cold_calls_seen')).toBe(false);

    // Tournament facing-open: untouched, so receipt stays silent.
    const tourSpot = makeSpot({
      seats: 9,
      mode: 'tournament',
      bb: 200,
      stackBB: 50,
      heroSeat: 6,
      openerSeat: 3,
      openBB: 2.2,
      ante: 200,
      hole: [card('J', 'clubs'), card('T', 'clubs')],
    });
    expect(runFired(tourSpot, 'tournament', true).has('cash_defence_trim_cold_calls_seen')).toBe(
      false
    );
  });
});
