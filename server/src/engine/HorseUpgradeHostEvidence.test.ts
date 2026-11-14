/**
 * Per-Horse upgrade evidence from the host side (2026-11-14): the main process
 * records one event per side-game or pre-action opportunity a server-owned
 * Horse had, beside the fleet counter that already fires there. Every block
 * drives the production method; nothing here calls noteHorseUpgradeEvent.
 *
 * The rule under test (HorseUpgradeEvidence.noteHorseUpgradeEvent): one event
 * per opportunity, never for a person or a seat a person's client pilots, and
 * never for a counter that is the same opportunity seen again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('Unexpected database access in the host evidence fixture');
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC in the host evidence fixture');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: vi.fn() }));

const { drainFires, enableBrainTelemetry } = await import('./BrainTelemetry.js');
const { drainHorseUpgradeEvidence, enableHorseUpgradeEvidence } =
  await import('./HorseUpgradeEvidence.js');
const { ServerTableEngine } = await import('./ServerTableEngine.js');
const { buildHost, formedHand, flush } = await import('../testing/lightningHostTestKit.js');

const TABLE_ID = '11111111-2222-4333-8444-555555555555';
const id = (n: number) => `8c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HUMAN = id(99);
const EIGHT = 'upgrade_08_side_games_integration';
const NINE = 'upgrade_09_preaction_purge';
const today = () => new Date().toISOString().slice(0, 10);
const fires = (): Record<string, number> =>
  Object.fromEntries(drainFires().map((f) => [f.feature, f.fires]));
/** `${horse}|${variant}|${lane}|${upgrade}` -> [decisions, invoked] */
const cells = (): Record<string, [number, number]> =>
  Object.fromEntries(
    drainHorseUpgradeEvidence().map((r) => {
      expect(r.day).toBe(today());
      return [
        `${r.horseUserId}|${r.gameVariant}|${r.lane}|${r.upgradeId}`,
        [r.decisions, r.invoked],
      ];
    })
  );

beforeEach(() => {
  enableBrainTelemetry();
  enableHorseUpgradeEvidence();
  drainFires();
  drainHorseUpgradeEvidence();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('upgrade 08: a run-it-twice choice or answer is one event for the Horse that made it', () => {
  function schedule(o: { variant: string; tournament: boolean; piloted?: string }) {
    const proto = ServerTableEngine.prototype as any;
    const ids = [id(1), id(2), id(3), HUMAN];
    proto.scheduleHorseRITResponses.call(
      {
        tableId: TABLE_ID,
        running: true,
        handCount: 4,
        seatedPlayers: ids.map((user_id) => ({ user_id, is_horse: user_id !== HUMAN })),
        isOwnClientControlling: (userId: string) => userId === o.piloted,
        setHandTimeout: () => {},
        runItTwiceEngine: { hasPendingOffer: () => true, getState: () => ({ maxRuns: 3 }) },
        horseRitVerdict: proto.horseRitVerdict,
        respondToRIT: () => {},
        activeHandVariant: () => o.variant,
        isTournamentTable: () => o.tournament,
      },
      ids[0],
      ids
    );
  }

  it('records the chooser and each answering Horse once, in the hand variant and lane, and no person', () => {
    schedule({ variant: 'plo5', tournament: false });
    const counted = fires();
    expect(
      (counted.upgrade08_rit_chooser_once_seen ?? 0) +
        (counted.upgrade08_rit_chooser_multi_seen ?? 0)
    ).toBe(1);
    expect(
      (counted.upgrade08_rit_answer_accept_seen ?? 0) +
        (counted.upgrade08_rit_answer_decline_seen ?? 0)
    ).toBe(2);
    expect(cells()).toEqual({
      [`${id(1)}|plo5|cash|${EIGHT}`]: [1, 1],
      [`${id(2)}|plo5|cash|${EIGHT}`]: [1, 1],
      [`${id(3)}|plo5|cash|${EIGHT}`]: [1, 1],
    });
  });

  it('records the lane of a tournament table, and nothing for a Horse seat a person client pilots', () => {
    schedule({ variant: 'nlh', tournament: true, piloted: id(2) });
    expect(cells()).toEqual({
      [`${id(1)}|nlh|tournament|${EIGHT}`]: [1, 1],
      [`${id(3)}|nlh|tournament|${EIGHT}`]: [1, 1],
    });
  });
});

describe('upgrade 08: an insurance offer is one event, and its answer is the same opportunity', () => {
  async function offer(o: {
    horse: boolean;
    ownClient?: boolean;
    offers?: unknown[];
    tournament?: boolean;
  }) {
    vi.useFakeTimers();
    const answers: string[] = [];
    (ServerTableEngine.prototype as any).scheduleHorseInsuranceResponse.call(
      {
        tableId: TABLE_ID,
        running: true,
        handCount: 9,
        seatedPlayers: [{ user_id: id(7), is_horse: o.horse }],
        isOwnClientControlling: () => o.ownClient === true,
        lifecycleCanMutate: () => true,
        setHandTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        insuranceEngine: { getOffers: () => o.offers ?? [{ playerId: id(7), status: 'offered' }] },
        respondToInsurance: (_pid: string, decision: string) => answers.push(decision),
        activeHandVariant: () => 'plo4',
        isTournamentTable: () => o.tournament === true,
      },
      id(7)
    );
    const atSchedule = cells();
    await vi.advanceTimersByTimeAsync(1_500);
    return { atSchedule, afterTimer: cells(), answers, counted: fires() };
  }

  it('records the offer when it is scheduled and nothing more when the Horse answers it', async () => {
    const r = await offer({ horse: true });
    expect(r.atSchedule).toEqual({ [`${id(7)}|plo4|cash|${EIGHT}`]: [1, 1] });
    expect(r.answers).toEqual(['decline']);
    expect(r.counted.upgrade08_insurance_decline_seen).toBe(1);
    // the answer is the offer answered: a second event would count one opportunity twice
    expect(r.afterTimer).toEqual({});
  });

  it('records the lane of a tournament table', async () => {
    const r = await offer({ horse: true, tournament: true });
    expect(r.atSchedule).toEqual({ [`${id(7)}|plo4|tournament|${EIGHT}`]: [1, 1] });
  });

  it('records an offer the hand retires before the answer', async () => {
    const r = await offer({ horse: true, offers: [] });
    expect(r.atSchedule).toEqual({ [`${id(7)}|plo4|cash|${EIGHT}`]: [1, 1] });
    expect(r.answers).toEqual([]);
    expect(r.afterTimer).toEqual({});
  });

  it('records nothing for a person, or for a Horse seat its own client is driving', async () => {
    for (const who of [{ horse: false }, { horse: true, ownClient: true }]) {
      const r = await offer(who);
      expect(r.atSchedule).toEqual({});
      expect(r.afterTimer).toEqual({});
    }
  });
});

describe('upgrade 09: a stale pre-action purged at a server-owned Horse turn is one event', () => {
  async function turn(o: { stale: boolean; tournament?: boolean; piloted?: boolean }) {
    const engine = new ServerTableEngine(TABLE_ID) as any;
    engine.running = true;
    engine.isCurrentEngine = () => true;
    engine.lifecycleCanMutate = () => true;
    engine.tableInfo = {
      action_time_seconds: 15,
      game_variant: 'plo4',
      ...(o.tournament ? { tournament_id: id(50), game_type: 'tournament' } : {}),
    };
    const horse = {
      seat_number: 1,
      user_id: id(11),
      username: 'HorseA',
      stack: 1_000,
      is_horse: true,
    };
    const state = {
      currentPlayerSeat: 1,
      currentBet: 20,
      minRaise: 20,
      pot: 50,
      communityCards: [],
      stage: 'preflop',
      players: [
        {
          seat: 1,
          user_id: id(11),
          bet: 0,
          stack: 1_000,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
    };
    engine.seatedPlayers = [horse];
    engine.handController = { getState: () => state, performAction: vi.fn(() => true) };
    const clearPreAction = vi.fn();
    engine.preActionEngine = {
      clearPreAction,
      getPreAction: () => (o.stale ? { action: 'auto_check_fold' } : undefined),
      executePreAction: () => ({ executed: false }),
    };
    engine.disconnectEngine = {
      isSittingOut: () => false,
      isClientSitOut: () => false,
      sitBack: vi.fn(),
      onPlayerTurn: () => true,
      armedAutoActionDeadlineMs: () => 0,
      isInReconnectGrace: () => false,
    };
    engine.startTurnTimer = vi.fn();
    engine.scheduleHorseAction = vi.fn();
    if (o.piloted) engine.isOwnClientControlling = () => true;
    drainFires();
    await engine.handleTurnChange(
      { type: 'TURN_CHANGE', seat: 1, availableActions: ['fold', 'call'] },
      [horse]
    );
    return {
      purges: fires().upgrade09_preaction_purge_table_seen ?? 0,
      cells: cells(),
      clearPreAction,
    };
  }

  it('records the Horse once when there was something to purge', async () => {
    const r = await turn({ stale: true });
    expect(r.clearPreAction).toHaveBeenCalledWith(TABLE_ID, id(11));
    expect(r.purges).toBe(1);
    expect(r.cells).toEqual({ [`${id(11)}|plo4|cash|${NINE}`]: [1, 1] });
  });

  it('records the tournament lane on a tournament table', async () => {
    const r = await turn({ stale: true, tournament: true });
    expect(r.purges).toBe(1);
    expect(r.cells).toEqual({ [`${id(11)}|plo4|tournament|${NINE}`]: [1, 1] });
  });

  it('records nothing when nothing was armed', async () => {
    const r = await turn({ stale: false });
    expect(r.purges).toBe(0);
    expect(r.cells).toEqual({});
  });

  it('records nothing for a Horse seat a person client pilots, whatever that branch counts for the fleet', async () => {
    const r = await turn({ stale: true, tournament: true, piloted: true });
    expect(r.cells).toEqual({});
  });
});

describe('upgrade 09: a stale pre-action purged at a Lightning Horse turn is one event', () => {
  async function bigBlindTurn(base: number, arm: boolean, serverOwned = true) {
    const formed = formedHand(2, base);
    const seat = { clientOwned: true };
    const t = buildHost(formed, [100, 100], {
      horses: new Set(formed.players),
      deps: { isClientControlling: () => seat.clientOwned, recordPreAction: () => {} },
    });
    await t.host.start();
    await flush();
    if (arm)
      expect(
        t.host.setPreAction(formed.bb, 'auto_check_fold', undefined, formed.handId).success
      ).toBe(true);
    expect(t.host.handlePlayerAction(formed.sb, 'call').success).toBe(true);
    seat.clientOwned = !serverOwned;
    drainHorseUpgradeEvidence();
    drainFires();
    await flush();
    return {
      horse: formed.bb,
      purges: fires().upgrade09_preaction_purge_lightning_seen ?? 0,
      nine: Object.entries(cells()).filter(([key]) => key.endsWith(`|${NINE}`)),
    };
  }

  it('records the Horse once, as cash, when its armed pre-action is purged', async () => {
    const r = await bigBlindTurn(8500, true);
    expect(r.purges).toBe(1);
    expect(r.nine).toHaveLength(1);
    const [key, counts] = r.nine[0]!;
    expect(key.startsWith(`${r.horse}|`)).toBe(true);
    expect(key.split('|')[2]).toBe('cash');
    expect(counts).toEqual([1, 1]);
  });

  it('records nothing when nothing is armed, or when a person client still holds the seat', async () => {
    expect((await bigBlindTurn(8600, false)).nine).toEqual([]);
    const piloted = await bigBlindTurn(8700, true, false);
    expect(piloted.purges).toBe(0);
    expect(piloted.nine).toEqual([]);
  });
});
