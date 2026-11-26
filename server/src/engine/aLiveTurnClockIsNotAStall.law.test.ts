/**
 * A LIVE BOUNDED IN-HAND CLOCK IS NOT A STALL (2026-11-26, incident 9313cabc).
 *
 * On 2026-11-26 at 03:47:07Z, cash table PLO5 1/2 Madness
 * (f1458b1c-fd8e-4dcb-8c79-762dbb2d29cf) fired CRITICAL TableStoppedDealing
 * (ca-stall-watch, threshold 60s) with ms_since_progress=60442 while a VIP
 * player's single turn legitimately spanned:
 *   - 15s primary action clock (03:46:06.749Z -> 03:46:21.631Z)
 *   - 20s paid time bank       (03:46:21.631Z -> 03:46:42.294Z)
 *   - 35.3s VIP reconnect protection (03:46:42.295Z -> 03:47:17.558Z)
 *
 * PR #11926 had taught runTableWatchdog() to stand down on live turn deadlines
 * past 45s, but msSinceProgress() (which feeds poker_table_ms_since_progress,
 * ca-stall-watch, poker_fleet_table_stall_max_ms, poker_fleet_tables_stalled,
 * tournamentStallExposure, evaluateEngineLiveness, MaintenanceBreak, and the
 * zombie reaper) stayed blind to live bounded in-hand clocks.
 *
 * These tests pin the single shared authority (`hasLiveBoundedInHandClock`)
 * used by both msSinceProgress() and runTableWatchdog(), plus every safety
 * invariant that prevents a genuinely stuck or recovery-looping table from
 * ever hiding behind a clock.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeadlineScheduler } from './DeadlineScheduler.js';
import { InsuranceEngine } from './InsuranceEngine.js';
import { ServerTableEngine } from './ServerTableEngine.js';

const TABLE = 'f1458b1c-fd8e-4dcb-8c79-762dbb2d29cf';
const STALL_MS = 45_000;
const STALL_WATCH_MS = 60_000;

interface HarnessOpts {
  actionTimeSeconds?: number;
  disconnectTimeoutSeconds?: number;
  currentSeat?: number;
  hasClock?: boolean;
  noHand?: boolean;
  deadlines?: {
    primary?: number;
    disconnect?: number;
    timebank?: number;
    rit?: number;
    insurance?: number;
    pineapple?: number[];
  };
  pendingTimeBank?: {
    isActive: boolean;
    pendingPublication: boolean;
    activatedAt: number;
  };
  action?: 'accept' | 'reject';
}

function buildHarness(opts: HarnessOpts = {}) {
  const engine = new ServerTableEngine(TABLE);
  const e = engine as any;
  const calls = {
    performAction: [] as Array<[number, string]>,
    startTimer: [] as Array<[string, number, number]>,
    killed: [] as string[],
    continueRunout: 0,
  };

  const state = {
    currentPlayerSeat: opts.currentSeat ?? 1,
    currentBet: 100,
    stage: 'preflop',
    players: [
      {
        seat: 1,
        user_id: 'u1',
        bet: 0,
        stack: 1000,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
      {
        seat: 2,
        user_id: 'u2',
        bet: 100,
        stack: 1000,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
    ],
  };

  e.running = true;
  e.isCurrentEngine = () => true;
  e.handCount = 60968305;
  e.tableInfo = {
    action_time_seconds: opts.actionTimeSeconds ?? 15,
    disconnect_timeout_seconds: opts.disconnectTimeoutSeconds ?? 30,
    game_variant: 'plo5',
  };
  e.seatedPlayers = [
    { seat_number: 1, user_id: 'u1', username: 'vip_human', stack: 1000, is_horse: false },
    { seat_number: 2, user_id: 'u2', username: 'horse_2', stack: 1000, is_horse: true },
  ];
  e.waitingForBB = new Set<string>();
  const deadlines = { ...(opts.deadlines ?? {}) };

  e.disconnectEngine = {
    isSittingOut: () => false,
    armedAutoActionDeadlineMs: () => deadlines.disconnect ?? 0,
  };
  e.timeBankEngine = {
    playerActed: () => {},
    getPlayerBank: () => opts.pendingTimeBank,
  };
  e.preciseTimer = {
    hasTimer: () => opts.hasClock ?? false,
    getDeadline: (_tableId: string, key: string) =>
      key.startsWith('timebank:') ? (deadlines.timebank ?? 0) : (deadlines.primary ?? 0),
    clearTable: () => {},
    startTimer: () => {},
    cancelTimer: () => {},
  };
  e.runItTwiceEngine = {
    isDecisionPending: () => (deadlines.rit ?? 0) > 0,
  };
  e.ritOfferDeadlineTs = deadlines.rit ?? 0;
  e.insuranceEngine = {
    getActiveOfferDeadlineMs: () => deadlines.insurance ?? 0,
  };
  e.pineappleDiscardDeadlines = new Map<number, number>(
    (deadlines.pineapple ?? []).map((d, idx) => [idx + 1, d])
  );
  e.pineappleDiscardBaseDeadlineMs =
    deadlines.pineapple && deadlines.pineapple.length > 0 ? deadlines.pineapple[0] : null;

  e.handController = opts.noHand
    ? null
    : {
        getState: () => state,
        performAction: (seat: number, a: string) => {
          calls.performAction.push([seat, a]);
          return opts.action === 'reject' ? false : true;
        },
        continueRunout: () => {
          calls.continueRunout++;
        },
      };
  e.startTurnTimer = (uid: string, seat: number, secs: number) => {
    calls.startTimer.push([uid, seat, secs]);
    // Simulate a real startTurnTimer updating preciseTimer primary deadline.
    deadlines.primary = Date.now() + secs * 1000 + 2_000;
  };
  e.killForRestart = (reason: string) => {
    calls.killed.push(reason);
    e.running = false;
  };

  return {
    engine,
    e,
    deadlines,
    calls,
    setRawAge(ms: number) {
      e.lastProgressAtMs = Date.now() - ms;
    },
    runWatchdog() {
      e.runTableWatchdog();
    },
  };
}

describe('a live bounded in-hand clock is not a stall (incident 9313cabc)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('replays incident 9313cabc: 15s primary + 20s timebank + 35s VIP disconnect at 60.4s reports 0ms stall, then surfaces immediately if expiry drops', () => {
    const h = buildHarness({
      actionTimeSeconds: 15,
      deadlines: { disconnect: Date.now() + 10_400 },
    });
    // Exact scrape instant: 60.442s since turn start, 10.4s left on VIP disconnect:<uid>.
    h.setRawAge(60_442);
    expect(h.engine.msSinceProgress()).toBe(0);
    h.runWatchdog();
    expect(h.e.watchdogTrips).toBe(0);
    expect(h.calls.performAction).toHaveLength(0);

    // If disconnect:<uid> expires without resolving the turn, stall surfaces immediately.
    h.deadlines.disconnect = Date.now() - 200;
    h.setRawAge(71_000);
    expect(h.engine.msSinceProgress()).toBeGreaterThanOrEqual(70_900);
    h.runWatchdog();
    expect(h.e.watchdogTrips).toBe(1);
  });

  it('respects a slow configured primary clock (120s DB max) past 60s and 90s without tripping stall watch or watchdog', () => {
    const h = buildHarness({
      actionTimeSeconds: 120,
      hasClock: true,
      deadlines: { primary: Date.now() + 105_000 },
    });
    h.setRawAge(65_000);
    expect(h.engine.msSinceProgress()).toBe(0);
    h.runWatchdog();
    expect(h.e.watchdogTrips).toBe(0);
    expect(h.calls.performAction).toHaveLength(0);
  });

  it('respects an active timebank:<uid> and a tightly bounded deferred-publication timebank', () => {
    const activeBank = buildHarness({
      deadlines: { timebank: Date.now() + 18_000 },
    });
    activeBank.setRawAge(62_000);
    expect(activeBank.engine.msSinceProgress()).toBe(0);

    const pendingFresh = buildHarness({
      pendingTimeBank: {
        isActive: true,
        pendingPublication: true,
        activatedAt: Date.now() - 2_000,
      },
    });
    pendingFresh.setRawAge(61_000);
    expect(pendingFresh.engine.msSinceProgress()).toBe(0);

    // A hung durable persistence write (>15s pendingPublication) MUST surface as stalled.
    const pendingHung = buildHarness({
      pendingTimeBank: {
        isActive: true,
        pendingPublication: true,
        activatedAt: Date.now() - 20_000,
      },
    });
    pendingHung.setRawAge(61_000);
    expect(pendingHung.engine.msSinceProgress()).toBeGreaterThanOrEqual(STALL_WATCH_MS);
  });

  it('respects active seat<0 in-hand prompts (RIT, Insurance, Pineapple discard) and stops watchdog continueRunout() stomp', () => {
    const rit = buildHarness({
      currentSeat: -1,
      deadlines: { rit: Date.now() + 12_000 },
    });
    rit.setRawAge(STALL_WATCH_MS + 1_000);
    expect(rit.engine.msSinceProgress()).toBe(0);
    rit.runWatchdog();
    expect(rit.calls.continueRunout).toBe(0);

    const insurance = buildHarness({
      currentSeat: -1,
      deadlines: { insurance: Date.now() + 18_000 },
    });
    insurance.setRawAge(STALL_WATCH_MS + 1_000);
    expect(insurance.engine.msSinceProgress()).toBe(0);
    insurance.runWatchdog();
    expect(insurance.calls.continueRunout).toBe(0);

    const pineapple = buildHarness({
      currentSeat: -1,
      actionTimeSeconds: 60,
      deadlines: { pineapple: [Date.now() + 10_000, Date.now() + 30_000] },
    });
    pineapple.setRawAge(STALL_WATCH_MS + 2_000);
    expect(pineapple.engine.msSinceProgress()).toBe(0);
    pineapple.runWatchdog();
    expect(pineapple.calls.continueRunout).toBe(0);

    // Once the prompt deadline expires without resolving, both msSinceProgress and watchdog fire.
    insurance.deadlines.insurance = Date.now() - 500;
    expect(insurance.engine.msSinceProgress()).toBeGreaterThanOrEqual(STALL_WATCH_MS);
    insurance.runWatchdog();
    expect(insurance.calls.continueRunout).toBe(1);
  });

  it('HARDENING: never defers between-hands idle stalls, lost clocks, or corrupted deadlines', () => {
    const betweenHands = buildHarness({
      noHand: true,
      deadlines: { primary: Date.now() + 10_000 },
    });
    betweenHands.setRawAge(95_000);
    expect(betweenHands.engine.msSinceProgress()).toBeGreaterThanOrEqual(94_900);

    const noClock = buildHarness({ hasClock: false });
    noClock.setRawAge(62_000);
    expect(noClock.engine.msSinceProgress()).toBeGreaterThanOrEqual(61_900);

    for (const bad of [
      Date.now() - 100,
      Date.now() + 120_000,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      const corrupted = buildHarness({
        actionTimeSeconds: 15,
        hasClock: true,
        deadlines: { primary: bad },
      });
      corrupted.setRawAge(STALL_MS + 2_000);
      expect(corrupted.engine.msSinceProgress()).toBeGreaterThanOrEqual(STALL_MS + 1_900);
    }
  });

  it('HARDENING: recovery re-arms (forceArmTurnTimer / watchdogTrips > 0) NEVER mask a failing seat', () => {
    const h = buildHarness({
      actionTimeSeconds: 15,
      hasClock: true,
      action: 'reject',
      deadlines: { primary: Date.now() + 10_000 },
    });
    // Simulate rejected auto-action calling forceArmTurnTimer (recovery re-arm).
    h.e.forceArmTurnTimer(1, 15);
    h.setRawAge(STALL_MS + 5_000);
    // Even though startTurnTimer armed a fresh live primary deadline, recovery
    // mode MUST expose raw stall age so Tier 2 -> Tier 3 escalation cannot stall.
    expect(h.engine.msSinceProgress()).toBeGreaterThanOrEqual(STALL_MS + 4_900);
    for (let i = 0; i < 5 && h.calls.killed.length === 0; i++) {
      h.setRawAge(STALL_MS + 5_000);
      h.runWatchdog();
    }
    expect(h.calls.killed).toEqual(['turn_unrecoverable']);

    // Once genuine markProgress() lands on a healthy engine, live-clock deferral works again.
    const healthy = buildHarness({ actionTimeSeconds: 15 });
    healthy.e.forceArmTurnTimer(1, 15);
    healthy.e.markProgress();
    healthy.setRawAge(61_000);
    expect(healthy.engine.msSinceProgress()).toBe(0);
  });

  it('HARDENING: hard per-turn wall-clock ceiling breaks through any infinite timer-extension bug', () => {
    const h = buildHarness({
      actionTimeSeconds: 15,
      hasClock: true,
      deadlines: { primary: Date.now() + 10_000 },
    });
    // 15s table ceiling is 97s; at 120s raw age a live deadline must NOT hide the stall.
    h.setRawAge(120_000);
    expect(h.engine.msSinceProgress()).toBeGreaterThanOrEqual(119_900);
    h.runWatchdog();
    expect(h.calls.performAction).toEqual([[1, 'fold']]);
  });

  it('HARDENING (real collaborators): DeadlineScheduler.getDeadline and InsuranceEngine.getActiveOfferDeadlineMs track real scheduled expiry and clear on resolve', () => {
    let now = 1_700_000_000_000;
    const scheduler = new DeadlineScheduler({ tickMs: 50, now: () => now });
    try {
      expect(scheduler.getDeadline(TABLE, 'missing')).toBe(0);
      scheduler.schedule({
        tableId: TABLE,
        eventId: 'insurance_offer:u1',
        deadlineMs: now + 25_000,
        callback: () => {},
      });
      expect(scheduler.getDeadline(TABLE, 'insurance_offer:u1')).toBe(now + 25_000);

      // Weekly pause preserves shifted deadline while parked.
      scheduler.pauseForWeeklyPayout(TABLE, 'weekly', 'insurance_offer:');
      now += 5_000;
      expect(scheduler.getDeadline(TABLE, 'insurance_offer:u1')).toBe(now + 25_000);
      scheduler.resumeFromWeeklyPayout(TABLE, 'weekly', 'insurance_offer:');
      expect(scheduler.getDeadline(TABLE, 'insurance_offer:u1')).toBe(now + 25_000);

      scheduler.cancel(TABLE, 'insurance_offer:u1');
      expect(scheduler.getDeadline(TABLE, 'insurance_offer:u1')).toBe(0);

      const ins = new InsuranceEngine(undefined, scheduler);
      ins.configure(TABLE, { enabled: true, offerTimeoutSeconds: 25 });
      expect(ins.getActiveOfferDeadlineMs(TABLE)).toBe(0);
      const offers = ins.createOffers(
        TABLE,
        'hand-1',
        'u1',
        [
          {
            playerId: 'u1',
            holeCards: [
              { rank: 'A', suit: 'spades' },
              { rank: 'A', suit: 'hearts' },
            ],
            atRisk: 500,
          },
          {
            playerId: 'u2',
            holeCards: [
              { rank: 'K', suit: 'clubs' },
              { rank: 'K', suit: 'diamonds' },
            ],
            atRisk: 500,
          },
        ],
        [
          { rank: '2', suit: 'spades' },
          { rank: '7', suit: 'diamonds' },
          { rank: '9', suit: 'clubs' },
        ],
        1000,
        'nlh',
        false,
        { equity: 81, strictLossPct: 18, pushPct: 2, exact: true, runouts: 990 }
      );
      expect(offers.length).toBeGreaterThan(0);
      const liveDeadline = ins.getActiveOfferDeadlineMs(TABLE);
      expect(liveDeadline).toBeGreaterThan(Date.now());
      expect(liveDeadline).toBeLessThanOrEqual(Date.now() + 30_000);
      ins.decline(TABLE, offers[0].playerId);
      expect(ins.getActiveOfferDeadlineMs(TABLE)).toBe(0);
      ins.disposeAll();
    } finally {
      scheduler.stop();
    }
  });

  it('HARDENING (real engine timers): full VIP primary -> timebank -> mid-turn disconnect -> disconnect protection flow never triggers stall before expiry', async () => {
    const engine = new ServerTableEngine(TABLE);
    const e = engine as any;
    e.running = true;
    e.isCurrentEngine = () => true;
    e.handCount = 60968305;
    e.tableInfo = {
      action_time_seconds: 15,
      disconnect_timeout_seconds: 30,
      game_variant: 'plo5',
    };
    e.seatedPlayers = [
      { seat_number: 1, user_id: 'u1', username: 'vip_human', stack: 1000, is_horse: false },
      { seat_number: 2, user_id: 'u2', username: 'horse_2', stack: 1000, is_horse: true },
    ];
    e.handController = {
      getState: () => ({
        currentPlayerSeat: 1,
        currentBet: 100,
        stage: 'preflop',
        players: [
          {
            seat: 1,
            user_id: 'u1',
            bet: 0,
            stack: 1000,
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
          {
            seat: 2,
            user_id: 'u2',
            bet: 100,
            stack: 1000,
            is_folded: false,
            is_all_in: false,
            is_sitting_out: false,
          },
        ],
      }),
    };
    try {
      e.timeBankEngine.configure(TABLE, { secondsPerUse: 20 });
      e.timeBankEngine.initializePlayer(TABLE, 'u1', { remainingSeconds: 40, usesRemaining: 2 });
      e.disconnectEngine.configure(TABLE, { disconnectTimeoutSeconds: 30 });
      e.disconnectEngine.registerPlayer(TABLE, 'u1', {
        is_vip: true,
        vip_tier: 'lifetime',
        vip_expires_at: null,
      });

      // 1. Primary turn starts; player spends primary clock and activates 20s timebank.
      e.playerTurnDuration = 15;
      e.playerTurnStartTime = Date.now() - 15_100;
      const tbRes = await e.activateTimeBank('u1');
      expect(tbRes.success).toBe(true);
      expect(e.preciseTimer.getDeadline(TABLE, 'timebank:u1')).toBeGreaterThan(Date.now());

      // 2. Player disconnects mid-timebank (45s VIP protection starts).
      e.disconnectEngine.markDisconnected(TABLE, 'u1');

      // 3. Time bank finishes and hands over to armRemainingReconnectProtection().
      e.timeBankEngine.playerActed(TABLE, 'u1');
      expect(e.armRemainingReconnectProtection('u1')).toBe(true);
      expect(e.disconnectEngine.armedAutoActionDeadlineMs(TABLE, 'u1')).toBeGreaterThan(Date.now());

      // 4. Simulate 60.442s since turn start while real disconnect:u1 is live.
      e.lastProgressAtMs = Date.now() - 60_442;
      expect(engine.msSinceProgress()).toBe(0);

      // 5. Simulate disconnect:u1 cancelled/expired without resolving the hand -> immediate stall.
      e.preciseTimer.cancelTimer(TABLE, 'disconnect:u1');
      expect(engine.msSinceProgress()).toBeGreaterThanOrEqual(60_400);
    } finally {
      e.preciseTimer.dispose();
    }
  });

  it('SOURCE LAW: msSinceProgress() and runTableWatchdog() share hasLiveBoundedInHandClock() and forceArmTurnTimer marks recovery', () => {
    const baseSrc = fs.readFileSync(path.join(__dirname, 'ServerTableEngineBase.ts'), 'utf8');
    const turnsSrc = fs.readFileSync(path.join(__dirname, 'ServerTableEngineTurns.ts'), 'utf8');
    expect(baseSrc).toContain('hasLiveBoundedInHandClock(');
    expect(baseSrc).toMatch(
      /msSinceProgress\(\):\s*number\s*\{[\s\S]{0,200}hasLiveBoundedInHandClock\(/
    );
    expect(turnsSrc).toMatch(
      /forceArmTurnTimer\([\s\S]{0,300}this\.turnRecoveryReArmed\s*=\s*true/
    );
    // No duplicated inline isLiveDeadline copy in runTableWatchdog.
    expect(turnsSrc).not.toContain('const isLiveDeadline =');
  });
});
