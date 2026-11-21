/**
 * A SPENT OR REFUSED SUCCESSOR CLAIM HOLDS THE TABLE; IT DOES NOT REBUILD IT
 * TWENTY TIMES A MINUTE (2026-11-21)
 *
 * Production 08:17-14:31 UTC: cash table dbbc148e hand #60380607 was refused
 * at settlement (original_winnings_sources_exceed_accepted_stack: a feeder
 * seat move had left the player's promo principal behind). Every successor
 * start then asked fn_ca_resume_hand_submission for the retained hand and was
 * answered found=true, completed=false with reason successor_financial_refused
 * and later successor_financial_claim_spent - answers decided by durable rows
 * that only an operator correction changes. start() turned each into
 * `watchdog_kill: start_failed:start_seed_hand_count` (the wrong step: the
 * last read that had set a phase), about twenty kills a minute for six hours,
 * nine seats frozen (ClubArenaEngineKillStorm, two drift incidents).
 *
 * Pinned here, against the real modules:
 *   1. those two durable reasons are standing refusals
 *      (RetainedHandSubmissionRefusedError) with the log text unchanged;
 *      every other pending reason stays an ordinary, retried error;
 *   2. through the real checkCrashRecovery, a cash start meeting one fences
 *      its generation with no watchdog kill and publishes the refusal, so
 *      GameServer holds the table (aStandingRetainedHandRefusalHoldsTheTable);
 *   3. a refusal that is NOT standing is killed under the step that failed,
 *      start_retained_hand_resume, never start_seed_hand_count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadTable = vi.fn();
const loadSeatedPlayers = vi.fn();

vi.mock('../services/supabase.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/supabase.js');
  return {
    ...actual,
    loadSeatedPlayers: (...a: unknown[]) => loadSeatedPlayers(...a),
    loadTable: (...a: unknown[]) => loadTable(...a),
  };
});

const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { supabase } = await import('../services/supabase/client.js');
const errors = await import('../services/errorReporter.js');
const {
  RETAINED_HAND_STANDING_PENDING,
  RetainedHandSubmissionRefusedError,
  resumeRetainedHandSubmission,
} = await import('../services/supabase/handHistory.js');

const TABLE = 'dbbc148e-384a-4c38-abb6-833b2d2847ff';
const GENERATION = '4a7464bc-f5ec-4a52-9865-c8142cc842d0';
const SUBMISSION = '9684692d-ce58-4ed5-ba75-9f9e63f85103';
const cashAuthority = () => ({
  scope: 'cash' as const,
  verified: true,
  generation: GENERATION,
  proofDeadlineMonotonicMs: performance.now() + 60_000,
});
const pending = (reason: string) =>
  ({
    data: { found: true, completed: false, submission_id: SUBMISSION, reason },
    error: null,
  }) as any;

afterEach(() => {
  vi.restoreAllMocks();
  loadTable.mockReset();
  loadSeatedPlayers.mockReset();
});

describe('the door names a durable pending answer as standing, and nothing else', () => {
  it('the set is exactly the two answers decided by durable rows', () => {
    expect([...RETAINED_HAND_STANDING_PENDING].sort()).toEqual([
      'successor_financial_claim_spent',
      'successor_financial_refused',
    ]);
  });

  it.each([...RETAINED_HAND_STANDING_PENDING])('%s is a standing refusal', async (reason) => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue(pending(reason));
    const error = await resumeRetainedHandSubmission(TABLE, 'i', GENERATION).catch((e) => e);
    expect(error).toBeInstanceOf(RetainedHandSubmissionRefusedError);
    expect(error).toMatchObject({ tableId: TABLE, code: reason });
    // Unchanged text: every log line and alert still matches it.
    expect(error.message).toBe(`retained_hand_submission_pending: ${reason}`);
  });

  it.each([
    'accepted_postcommit_pending',
    'resume_scan_continues',
    'original_failure_or_handoff_unproven',
    'unknown',
  ])('%s stays an ordinary, retried pending error', async (reason) => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue(pending(reason));
    const error = await resumeRetainedHandSubmission(TABLE, 'i', GENERATION).catch((e) => e);
    expect(error).not.toBeInstanceOf(RetainedHandSubmissionRefusedError);
    expect(error.message).toBe(`retained_hand_submission_pending: ${reason}`);
  });
});

function startable(authority: any) {
  const engine = new ServerTableEngine(TABLE, authority) as any;
  const killed: string[] = [];
  const realKill = engine.killForRestart.bind(engine);
  engine.killForRestart = (reason: string, notify?: boolean) => {
    killed.push(reason);
    realKill(reason, notify);
  };
  engine.sleep = async () => {};
  engine.seedHandCountFromHistory = async () => {
    engine.setLoopPhase('start_seed_hand_count');
  };
  engine.restoreButtonFromHistory = async () => {};
  engine.restoreKillFromHistory = async () => {};
  engine.restoreSitOutsFromSeats = () => {};
  engine.evictExpiredSitOuts = async () => {};
  engine.hasCurrentEngineLeaseAuthority = () => true;
  engine.readParkedTimeBanks = async () => {};
  engine.resolveOrphanedAddOns = async () => {};
  engine.broadcastCurrentState = async () => {};
  engine.scheduleHeartbeatCheck = () => {};
  engine.dealingLoop = async () => {};
  engine.recordRecoveryEvent = vi.fn();
  return { engine, killed };
}

describe('start() through the real checkCrashRecovery', () => {
  beforeEach(() => {
    vi.spyOn(errors, 'reportError').mockImplementation(() => {});
    loadTable.mockResolvedValue({ id: TABLE, small_blind: 1, big_blind: 2, ante: 0 });
    loadSeatedPlayers.mockResolvedValue([]);
  });

  it.each([...RETAINED_HAND_STANDING_PENDING])(
    '%s fences the generation with no watchdog kill and publishes the refusal',
    async (reason) => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue(pending(reason));
      const { engine, killed } = startable(cashAuthority());
      await expect(engine.start()).rejects.toBeInstanceOf(RetainedHandSubmissionRefusedError);
      expect(killed).toEqual([]);
      expect(engine.recordRecoveryEvent).not.toHaveBeenCalled();
      expect(engine.getStartupRetainedHandRefusal()).toEqual({ code: reason, tableId: TABLE });
      expect(errors.reportError).not.toHaveBeenCalledWith(
        expect.anything(),
        `ServerTableEngine.${TABLE}.failed_to_start`
      );
      await engine.stop();
    }
  );

  it('a pending answer that can change on its own is killed under the step that failed', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue(pending('accepted_postcommit_pending'));
    const { engine, killed } = startable(cashAuthority());
    await expect(engine.start()).rejects.toThrow(
      'retained_hand_submission_pending: accepted_postcommit_pending'
    );
    expect(killed).toEqual(['start_failed:start_retained_hand_resume']);
    expect(killed).not.toContain('start_failed:start_seed_hand_count');
    await engine.stop();
  });
});
