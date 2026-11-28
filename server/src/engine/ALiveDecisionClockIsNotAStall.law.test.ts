/**
 * A LIVE, BOUNDED DECISION CLOCK IS NOT A STALL (2026-11-28, incident f95722a9).
 *
 * On 2026-11-28 at 03:37:08 CST, table dbbc148e (NLH 0.05/0.10 Classic) fired a
 * CRITICAL `TableStoppedDealing` alert ("no progress for 63 seconds with a
 * player waiting") during Hand #61238723 while a human VIP player legally ran:
 *   15s primary + 2s grace -> 20s auto time bank -> mid-bank disconnect ->
 *   31.1s remaining VIP 45s reconnect protection (68.2s total, resolved cleanly
 *   on schedule 4.6s after the alert fired).
 *
 * Root causes fixed at their authoritative source:
 *   1. `ServerTableEngineBase.hasLiveDecisionClock()` is now the single
 *      fail-closed oracle for all six server-owned mid-hand decision clocks
 *      (primary turn, time bank, reconnect protection, Pineapple discard, RIT,
 *      and Insurance/EV Cashout), bounded tightly per clock and returning false
 *      the millisecond any deadline expires or exceeds its bound.
 *   2. Genuine mid-hand clock handoffs (auto/manual/durable time bank,
 *      newly-armed reconnect protection, manual Pineapple extension, Insurance
 *      offer creation) advance `lastProgressAtMs` via `noteActiveClockProgress()`
 *      without zeroing `watchdogTrips`; real stage/player commits
 *      (`PINEAPPLE_DISCARD_REQUIRED`, `submitDiscard`, `respondToRIT`,
 *      `respondToInsurance`) call `markProgress()`.
 *   3. `runTableWatchdog()` (for BOTH `seat < 0` and `seat >= 0`), `GameServer`
 *      Prometheus / `/health` / `ca-stall-watch` gauges, `fleetStallMaxMs`,
 *      `evaluateEngineLiveness`, `tournamentStallExposure`, and `zombieSweep`
 *      all consult `hasLiveDecisionClock()` consistently.
 *   4. Sibling bug: `waitForInsuranceResponses` hardcoded a 22s safety timeout
 *      against `InsuranceEngine`'s 25s offer window; it now derives
 *      `offerTimeoutSeconds(tableId) * 1000 + 5_000`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerTableEngine } from './ServerTableEngine.js';
import { DeadlineScheduler } from './DeadlineScheduler.js';
import { InsuranceEngine } from './InsuranceEngine.js';
import { RunItTwiceEngine } from './RunItTwiceEngine.js';
import { fleetStallMaxMs } from '../fleetStallMax.js';
import { zombieProgressAge } from '../fleetWideZombieVerdict.js';
import { evaluateEngineLiveness } from './EngineLivenessVerdict.js';
import { tournamentStallExposure } from '../observability/tournamentStallExposure.js';

const TABLE = 'dbbc148e-384a-4c38-abb6-833b2d2847ff';
const PLAYER = '08e6ca56-5cdf-4fda-9443-a01b2f7a158b';
const OPPONENT = '2610f833-88cd-4a55-b255-75b75070b5da';
const SEAT = 3;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 28, 9, 37, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function buildEngine(
  opts: {
    actionTimeSeconds?: number;
    currentSeat?: number;
    stage?: string;
    playerFlags?: Record<string, unknown>;
  } = {}
) {
  const engine = new ServerTableEngine(TABLE) as any;
  engine.running = true;
  engine.isCurrentEngine = () => true;
  engine.lifecycleCanMutate = () => true;
  engine.tableInfo = {
    action_time_seconds: opts.actionTimeSeconds ?? 15,
  };
  const state = {
    currentPlayerSeat: opts.currentSeat ?? SEAT,
    currentBet: 10,
    stage: opts.stage ?? 'preflop',
    pot: 100,
    players: [
      {
        user_id: PLAYER,
        seat: SEAT,
        bet: 0,
        stack: 1000,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        ...(opts.playerFlags ?? {}),
      },
      {
        user_id: OPPONENT,
        seat: 4,
        bet: 10,
        stack: 1000,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
    ],
  };
  engine.handController = {
    getState: () => state,
    continueRunout: vi.fn(),
    performAction: vi.fn(() => true),
    performDiscard: vi.fn(() => true),
    owesPineappleDiscard: vi.fn(() => true),
    allPineappleDiscardsIn: vi.fn(() => false),
  };
  engine.seatedPlayers = [
    { seat_number: SEAT, user_id: PLAYER, stack: 1000 },
    { seat_number: 4, user_id: OPPONENT, stack: 1000 },
  ];
  engine.timeBankEngine.configure(TABLE, { secondsPerUse: 20 });
  engine.timeBankEngine.initializePlayer(TABLE, PLAYER, {
    remainingSeconds: 40,
    usesRemaining: 2,
  });
  engine.killForRestart = vi.fn();
  return { engine, state };
}

describe('incident f95722a9 reproduction — primary + time bank + VIP disconnect handoff', () => {
  it('advances lastProgressAtMs across time-bank and VIP disconnect handoffs without zeroing watchdogTrips', async () => {
    const { engine } = buildEngine();
    try {
      engine.disconnectEngine.registerPlayer(TABLE, PLAYER, {
        is_vip: true,
        vip_tier: 'lifetime',
        vip_expires_at: null,
      });

      // Step 1: Turn started 17s ago; watchdogTrips set to 1 to prove clock
      // handoffs never disarm escalation.
      engine.lastProgressAtMs = Date.now() - 17_000;
      engine.watchdogTrips = 1;
      engine.playerTurnStartTime = Date.now() - 15_001;
      engine.playerTurnDuration = 15;

      // Step 2: Time bank activates (manual / auto / durable all advance progress).
      const beforeBank = engine.lastProgressAtMs;
      expect((await engine.activateTimeBank(PLAYER)).success).toBe(true);
      expect(engine.lastProgressAtMs).toBeGreaterThan(beforeBank);
      expect(engine.msSinceProgress()).toBeLessThan(1_000);
      expect(engine.watchdogTrips).toBe(1);
      expect(engine.hasLiveDecisionClock()).toBe(true);

      // Step 3: Player disconnects mid-bank; bank finishes accounting and hands
      // off to remaining VIP 45s reconnect protection.
      engine.disconnectEngine.markDisconnected(TABLE, PLAYER);
      engine.lastProgressAtMs = Date.now() - 25_000;
      const beforeHandoff = engine.lastProgressAtMs;
      engine.timeBankEngine.onTimeBankExpired(TABLE, PLAYER);

      const disconnectDeadline = engine.disconnectEngine.armedAutoActionDeadlineMs(TABLE, PLAYER);
      expect(disconnectDeadline).toBeGreaterThan(Date.now());
      expect(engine.lastProgressAtMs).toBeGreaterThan(beforeHandoff);
      expect(engine.msSinceProgress()).toBeLessThan(1_000);
      expect(engine.watchdogTrips).toBe(1);

      // Step 4: Repeated armRemainingReconnectProtection is idempotent and must
      // NOT keep resetting lastProgressAtMs once disconnect:<userId> is armed.
      const staleStamp = Date.now() - 63_000;
      engine.lastProgressAtMs = staleStamp;
      expect(engine.armRemainingReconnectProtection(PLAYER)).toBe(true);
      expect(engine.lastProgressAtMs).toBe(staleStamp);

      // Step 5: Even at 63s raw age, while the bounded VIP disconnect deadline
      // is still in the future, the table has a live decision clock and the
      // watchdog stands down — and the millisecond the deadline passes, it
      // fails closed immediately.
      expect(engine.hasLiveDecisionClock()).toBe(true);
      engine.runTableWatchdog();
      expect(engine.handController.performAction).not.toHaveBeenCalled();

      expect(engine.hasLiveDecisionClock(disconnectDeadline)).toBe(false);
      expect(engine.hasLiveDecisionClock(disconnectDeadline + 1)).toBe(false);
    } finally {
      engine.preciseTimer.dispose();
    }
  });
});

describe('all six server-owned mid-hand decision clocks are live while bounded and fail closed on expiry or corruption', () => {
  it('shields a custom 90s primary action clock inside its bound and fails closed when expired or far-future', () => {
    const { engine } = buildEngine({ actionTimeSeconds: 90 });
    try {
      engine.startTurnTimer(PLAYER, SEAT, 90);
      engine.lastProgressAtMs = Date.now() - 65_000;

      expect(engine.hasLiveDecisionClock()).toBe(true);
      engine.runTableWatchdog();
      expect(engine.handController.performAction).not.toHaveBeenCalled();

      const deadline = engine.preciseTimer.getDeadline(TABLE, PLAYER);
      expect(engine.hasLiveDecisionClock(deadline)).toBe(false);

      // Corrupted far-future deadline (> ceiling) must NEVER mask a stall.
      vi.spyOn(engine.preciseTimer, 'getDeadline').mockReturnValue(Date.now() + 300_000);
      expect(engine.hasLiveDecisionClock()).toBe(false);
    } finally {
      engine.preciseTimer.dispose();
    }
  });

  it('shields Pineapple simultaneous discard (seat < 0) while sweep + bounded deadline are live and fails closed without sweep', () => {
    const { engine } = buildEngine({
      currentSeat: -1,
      stage: 'pineapple_discard',
      actionTimeSeconds: 30,
    });
    try {
      const deadline = Date.now() + 25_000;
      engine.pineappleDiscardTimer = setTimeout(() => {}, 25_000);
      engine.pineappleDiscardDeadlines.set(SEAT, deadline);
      engine.lastProgressAtMs = Date.now() - 50_000;

      expect(engine.hasLiveDecisionClock()).toBe(true);
      engine.runTableWatchdog();
      expect(engine.handController.continueRunout).not.toHaveBeenCalled();

      // Expired deadline fails closed.
      expect(engine.hasLiveDecisionClock(deadline)).toBe(false);

      // Missing sweep timer fails closed even with map entries left behind.
      clearTimeout(engine.pineappleDiscardTimer);
      engine.pineappleDiscardTimer = null;
      expect(engine.hasLiveDecisionClock()).toBe(false);

      // Manual discard extension advances progress without zeroing watchdogTrips.
      engine.pineappleDiscardDeadlines.set(SEAT, Date.now() + 500);
      engine.lastProgressAtMs = Date.now() - 20_000;
      engine.watchdogTrips = 1;
      const ext = engine.extendPineappleDiscard(PLAYER);
      expect(ext.success).toBe(true);
      expect(engine.msSinceProgress()).toBeLessThan(1_000);
      expect(engine.watchdogTrips).toBe(1);
      if (engine.pineappleDiscardTimer) clearTimeout(engine.pineappleDiscardTimer);
    } finally {
      engine.preciseTimer.dispose();
    }
  });

  it('shields Run It Twice offers (seat < 0) from the scheduler deadline and fails closed when cancelled or unsafe', () => {
    const { engine } = buildEngine({ currentSeat: -1, stage: 'flop' });
    const scheduler = new DeadlineScheduler();
    const rit = new RunItTwiceEngine(undefined, scheduler);
    engine.runItTwiceEngine = rit;
    try {
      rit.configure(TABLE, { enabled: true, maxRuns: 2, autoDeclineTimeout: 10 });
      rit.offer(TABLE, `${TABLE}:1`, PLAYER, [PLAYER, OPPONENT], 100);
      engine.lastProgressAtMs = Date.now() - 50_000;

      const deadline = rit.activeOfferDeadlineMs(TABLE);
      expect(deadline).toBeGreaterThan(Date.now());
      expect(engine.hasLiveDecisionClock()).toBe(true);
      engine.runTableWatchdog();
      expect(engine.handController.continueRunout).not.toHaveBeenCalled();

      // Payout-mutation-unsafe ALWAYS bypasses live-clock shielding.
      engine.runoutPayoutMutationUnsafe = true;
      expect(engine.hasLiveDecisionClock()).toBe(false);
      engine.runoutPayoutMutationUnsafe = false;

      // Cancelled scheduler entry fails closed immediately.
      scheduler.cancel(TABLE, 'rit_offer');
      expect(rit.activeOfferDeadlineMs(TABLE)).toBe(0);
      expect(engine.hasLiveDecisionClock()).toBe(false);
    } finally {
      scheduler.stop();
      engine.preciseTimer.dispose();
    }
  });

  it('shields All-In Insurance offers (seat < 0) from the scheduler deadline and advances progress on player responses', () => {
    const { engine } = buildEngine({ currentSeat: -1, stage: 'flop' });
    const scheduler = new DeadlineScheduler();
    const ins = new InsuranceEngine(undefined, scheduler);
    engine.insuranceEngine = ins;
    try {
      ins.configure(TABLE, { enabled: true, offerTimeoutSeconds: 25 });
      expect(ins.offerTimeoutSeconds(TABLE)).toBe(25);
      const offers = ins.createOffers(
        TABLE,
        `${TABLE}:1`,
        PLAYER,
        [
          {
            playerId: PLAYER,
            holeCards: [
              { rank: 'A', suit: 'spades' },
              { rank: 'A', suit: 'hearts' },
            ],
            atRisk: 50,
          },
          {
            playerId: OPPONENT,
            holeCards: [
              { rank: 'K', suit: 'diamonds' },
              { rank: 'K', suit: 'clubs' },
            ],
            atRisk: 50,
          },
        ],
        [
          { rank: '2', suit: 'clubs' },
          { rank: '7', suit: 'diamonds' },
          { rank: '9', suit: 'spades' },
        ],
        100,
        'nlh',
        false,
        { equity: 88, strictLossPct: 12, pushPct: 0, exact: true, runouts: 990 }
      );
      expect(offers).toHaveLength(1);
      engine.lastProgressAtMs = Date.now() - 50_000;

      const deadline = ins.activeOfferDeadlineMs(TABLE);
      expect(deadline).toBeGreaterThan(Date.now() + 20_000);
      expect(engine.hasLiveDecisionClock()).toBe(true);
      engine.runTableWatchdog();
      expect(engine.handController.continueRunout).not.toHaveBeenCalled();

      // Player declining insurance records progress and clears the live clock.
      const res = engine.respondToInsurance(PLAYER, 'decline', 100, true);
      expect(res.success).toBe(true);
      expect(engine.msSinceProgress()).toBeLessThan(1_000);
      expect(ins.activeOfferDeadlineMs(TABLE)).toBe(0);
      expect(engine.hasLiveDecisionClock()).toBe(false);
    } finally {
      scheduler.stop();
      engine.preciseTimer.dispose();
    }
  });

  it('never shields a folded, all-in, missing, stopped, or handless seat', () => {
    for (const flags of [{ is_folded: true }, { is_all_in: true }]) {
      const { engine } = buildEngine({ playerFlags: flags });
      engine.startTurnTimer(PLAYER, SEAT, 15);
      expect(engine.hasLiveDecisionClock()).toBe(false);
      engine.preciseTimer.dispose();
    }

    const { engine: missingSeat } = buildEngine({ currentSeat: 99 });
    expect(missingSeat.hasLiveDecisionClock()).toBe(false);
    missingSeat.preciseTimer.dispose();

    const { engine: stopped } = buildEngine();
    stopped.startTurnTimer(PLAYER, SEAT, 15);
    stopped.running = false;
    expect(stopped.hasLiveDecisionClock()).toBe(false);
    stopped.preciseTimer.dispose();

    const { engine: betweenHands } = buildEngine();
    betweenHands.handController = null;
    expect(betweenHands.hasLiveDecisionClock()).toBe(false);
    betweenHands.preciseTimer.dispose();
  });
});

describe('fleet liveness, stall max, and tournament exposure exclude bounded live decision clocks', () => {
  it('excludes liveDecisionClock tables from fleetStallMaxMs, evaluateEngineLiveness, and tournamentStallExposure', () => {
    const sample = {
      tableId: TABLE,
      gameFormat: 'mtt' as const,
      seated: 7,
      dealable: 7,
      paused: false,
      liveDecisionClock: true,
      msSinceProgress: 65_000,
    };

    expect(fleetStallMaxMs([sample])).toBe(0);
    expect(fleetStallMaxMs([{ ...sample, liveDecisionClock: false }])).toBe(65_000);

    const verdictLive = evaluateEngineLiveness({
      isLeader: true,
      processUptimeMs: 600_000,
      discoveryLoopStalledMs: 1_000,
      discoveryStaleMs: 1_000,
      dbConfirmedDead: false,
      tables: [{ dealable: 7, paused: false, liveDecisionClock: true, msSinceProgress: 400_000 }],
    });
    expect(verdictLive.deadStalledCount).toBe(0);
    expect(verdictLive.wholeFleetStalled).toBe(false);
    expect(verdictLive.anyTableProgressedRecently).toBe(true);

    const linesLive = tournamentStallExposure([sample], new Map());
    expect(linesLive).toContain('poker_tournament_observed_stalled_tables{format="mtt"} 0');
    const linesExpired = tournamentStallExposure(
      [{ ...sample, liveDecisionClock: false }],
      new Map()
    );
    expect(linesExpired).toContain('poker_tournament_observed_stalled_tables{format="mtt"} 1');

    expect(
      zombieProgressAge({
        describeStallForRecovery: () => 'live_hand',
        msSinceProgress: () => 200_000,
        msSinceLoopPhase: () => 200_000,
        hasLiveDecisionClock: () => true,
      })
    ).toBe(0);
    expect(
      zombieProgressAge({
        describeStallForRecovery: () => 'live_hand',
        msSinceProgress: () => 200_000,
        msSinceLoopPhase: () => 200_000,
        hasLiveDecisionClock: () => false,
      })
    ).toBe(200_000);
  });
});

describe('source-contract hardening across GameServer, Turns, and Runout', () => {
  const here = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it('pins GameServer stall samples and poker_fleet_tables_stalled to the exact same !t.liveDecisionClock predicate', () => {
    const gs = here('../GameServer.ts');
    expect(gs).toMatch(
      /const stalledSamples = liveness\s*\.filter\(\s*\(t\) => t\.dealable >= 2 && !t\.liveDecisionClock && t\.msSinceProgress >= STALL_SAMPLE_FLOOR_MS\s*\)/
    );
    expect(gs).toContain(
      'liveness.filter((t) => t.dealable >= 2 && !t.liveDecisionClock && t.msSinceProgress >= STALL_SAMPLE_FLOOR_MS).length'
    );
    expect(gs).toContain('t.humans > 0 && !t.liveDecisionClock');
    expect(gs).toContain('liveDecisionClock: engine.hasLiveDecisionClock?.() === true');
  });

  it('pins runTableWatchdog to check hasLiveDecisionClock before both seat < 0 and seat >= 0 branches', () => {
    const turns = here('./ServerTableEngineTurns.ts');
    const stallGuardIdx = turns.indexOf(
      'if (idleMs <= ServerTableEngineBase.WATCHDOG_STALL_MS) return;'
    );
    const liveClockIdx = turns.indexOf('if (this.hasLiveDecisionClock()) return;', stallGuardIdx);
    const noSeatIdx = turns.indexOf('if (seat < 0) {', stallGuardIdx);
    expect(stallGuardIdx).toBeGreaterThan(-1);
    expect(liveClockIdx).toBeGreaterThan(stallGuardIdx);
    expect(liveClockIdx).toBeLessThan(noSeatIdx);
  });

  it('pins waitForInsuranceResponses to derive safetyTimeout from offerTimeoutSeconds instead of hardcoded 22_000', () => {
    const runout = here('./ServerTableEngineRunout.ts');
    const waitStart = runout.indexOf('protected waitForInsuranceResponses(');
    expect(waitStart).toBeGreaterThan(-1);
    const waitBody = runout.slice(waitStart);
    expect(waitBody).toContain('this.insuranceEngine.offerTimeoutSeconds(this.tableId)');
    expect(waitBody).not.toContain('}, 22_000);');
  });
});
