import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as auth from '../../src/lib/supabase';
import { tournamentService, type TournamentConfig } from '../../src/services/TournamentService';
import { BLIND_STRUCTURES, newTournamentPlayingLevels } from '../../src/config/blindStructures';

vi.mock('../../src/services/GameAccessService', () => ({
  fetchGameCreationAccess: async () => ({ allowed: true }),
}));
vi.mock('../../src/utils/clubIdResolver', () => ({ resolveClubUUID: async (id: string) => id }));
const actor = 'a1000000-0000-4000-8000-000000000001';
const club = 'c1000000-0000-4000-8000-000000000001';
const config = (): TournamentConfig =>
  ({
    name: 'Original Event',
    type: 'mtt',
    gameVariant: 'NLH',
    buyIn: 100,
    startingStack: 10000,
    minPlayers: 3,
    maxPlayers: 100,
    tableSize: 9,
    blindStructure: newTournamentPlayingLevels(BLIND_STRUCTURES.regular),
    payoutStructure: [{ place: 1, percentage: 100 }],
  }) as TournamentConfig;
const builder = (result: unknown) => ({
  abortSignal: vi.fn().mockReturnThis(),
  then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject),
});
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(auth, 'getAuthUser').mockResolvedValue({
    data: { user: { id: actor } },
    error: null,
  } as any);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it('submits a multi-day plan through the atomic create-and-seal authority', async () => {
  const db = authority(false);
  const plan = {
    time_zone: 'America/Chicago',
    stages: [
      { stage_no: 1, scheduled_start_utc: null, end_after_level: 20 },
      { stage_no: 2, scheduled_start_utc: '2099-12-02T12:00:00Z', end_after_level: null },
    ],
  };
  await tournamentService.createTournament(club, config(), plan);
  expect(db.rpc).toHaveBeenCalledWith(
    'fn_create_staged_tournament_request',
    expect.objectContaining({ p_plan: plan })
  );
});

function authority(loseReply = true) {
  const accepted = new Map<string, string>();
  const rows = new Map<string, { id: string; club_id: string }>();
  const rpc = vi.spyOn(auth.supabase, 'rpc').mockImplementation((name: string, args: any) => {
    const key = ['fn_create_tournament_request', 'fn_create_staged_tournament_request'].includes(
      name
    )
      ? args.p_request_id
      : crypto.randomUUID();
    let id = accepted.get(key);
    if (!id) {
      id = crypto.randomUUID();
      accepted.set(key, id);
      rows.set(id, { id, club_id: club });
    }
    if (loseReply) {
      loseReply = false;
      return builder({
        data: null,
        error: { code: 'NETWORK', message: 'lost acknowledgement' },
      }) as any;
    }
    return builder({
      data: {
        success: true,
        tournament_id: id,
        request_id: key,
        request_state: 'accepted',
        user_id: actor,
        club_id: club,
        ...(args.p_plan
          ? {
              stage_plan: {
                ok: true,
                tournament_id: id,
                stage_count: args.p_plan.stages.length,
                plan_hash: 'a'.repeat(32),
              },
            }
          : {}),
      },
      error: null,
    }) as any;
  });
  vi.spyOn(auth.supabase, 'from').mockImplementation(() => {
    let id = '';
    const query: any = {
      select: () => query,
      eq: (_key: string, value: string) => {
        id = value;
        return query;
      },
      abortSignal: () => query,
      maybeSingle: () => Promise.resolve({ data: rows.get(id), error: null }),
    };
    return query;
  });
  return { accepted, rows, rpc };
}

it('replays the original accepted create after its acknowledgement is lost', async () => {
  const db = authority();
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow();
  const event = await tournamentService.createTournament(club, config());
  expect(db.accepted.size).toBe(1);
  expect(event.id).toBe([...db.accepted.values()][0]);
  expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1]);
});

it('retains an uncertain original when its request function temporarily cannot be found', async () => {
  const db = authority();
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow();
  db.rpc.mockImplementationOnce(
    () => builder({ data: null, error: { code: 'PGRST202', message: 'schema unavailable' } }) as any
  );
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow(
    'Safe Tournament Creation'
  );
  await tournamentService.createTournament(club, config());
  expect(db.accepted.size).toBe(1);
  expect(db.rpc.mock.calls[2][1]).toEqual(db.rpc.mock.calls[0][1]);
});

it('replays the saved payload even after its start time passes and the form changes', async () => {
  const db = authority();
  vi.useFakeTimers();
  const original = { ...config(), startTime: new Date(Date.now() + 120000) };
  await expect(tournamentService.createTournament(club, original)).rejects.toThrow();
  vi.setSystemTime(Date.now() + 600000);
  const event = await tournamentService.createTournament(club, {
    ...original,
    name: 'Edited Draft',
  });
  expect(event.id).toBe([...db.accepted.values()][0]);
  expect(db.accepted.size).toBe(1);
  expect(db.rpc.mock.calls[1][1]).toEqual(db.rpc.mock.calls[0][1]);
});

it('bounds an unanswered create, aborts transport and ignores its late reply', async () => {
  vi.useFakeTimers();
  const db = authority(false);
  let reply!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    reply = resolve;
  });
  const first = builder(pending);
  db.rpc.mockImplementationOnce((_name: string, args: any) => {
    const id = crypto.randomUUID();
    db.accepted.set(args.p_request_id, id);
    db.rows.set(id, { id, club_id: club });
    return first as any;
  });
  const unknown = tournamentService.createTournament(club, config()).catch((error) => error);
  await vi.advanceTimersByTimeAsync(12001);
  expect(await unknown).toBeInstanceOf(Error);
  expect(first.abortSignal.mock.calls[0][0].aborted).toBe(true);
  const event = await tournamentService.createTournament(club, config());
  expect(db.accepted.size).toBe(1);
  const args = db.rpc.mock.calls[0][1] as any;
  reply({
    data: {
      success: true,
      tournament_id: event.id,
      request_id: args.p_request_id,
      request_state: 'accepted',
      user_id: actor,
      club_id: club,
    },
    error: null,
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(db.accepted.size).toBe(1);
  expect(
    JSON.parse(sessionStorage.getItem('ca:tournament-create:v1:' + actor + ':' + club)!)
  ).toMatchObject({ state: 'resolved' });
});

it('keeps an accepted main and first child when the next child acknowledgement is lost', async () => {
  const db = authority(false);
  const normal = db.rpc.getMockImplementation()!;
  let calls = 0;
  db.rpc.mockImplementation((name: string, args: any) => {
    const result = normal(name, args);
    if (++calls === 3) return builder({ data: null, error: { code: 'NETWORK' } }) as any;
    return result;
  });
  const child = {
    ...config(),
    type: 'satellite',
    satelliteTarget: { tournamentId: '', seatsAwarded: 1 },
  } as TournamentConfig;
  await expect(
    tournamentService.createTournamentWithSatellites(club, config(), [
      child,
      { ...child, name: 'Child Two' },
    ])
  ).rejects.toThrow();
  expect(db.accepted.size).toBe(3);
  const events = await tournamentService.createTournamentWithSatellites(
    club,
    { ...config(), name: 'Edited' },
    []
  );
  expect(events).toHaveLength(3);
  expect(db.accepted.size).toBe(3);
  expect((db.rpc.mock.calls[4][1] as any).p_config.satelliteTargetId).toBe(events[0].id);
  expect(db.rpc.mock.calls.slice(0, 3).map((call) => call[1])).toEqual(
    db.rpc.mock.calls.slice(3).map((call) => call[1])
  );
});

it('refuses a missing request authority without falling back to unkeyed creation', async () => {
  const db = authority(false);
  db.rpc.mockReturnValue(builder({ data: null, error: { code: 'PGRST202' } }) as any);
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow('Not Available');
  expect(db.accepted.size).toBe(0);
  expect(db.rpc.mock.calls.map((call) => call[0])).toEqual(['fn_create_tournament_request']);
});

it('retains identity through an unreadable post-creation row', async () => {
  const db = authority(false);
  const normal = vi.mocked(auth.supabase.from).getMockImplementation()!;
  vi.mocked(auth.supabase.from).mockImplementationOnce(() => {
    const query: any = {
      select: () => query,
      eq: () => query,
      abortSignal: () => query,
      maybeSingle: () => Promise.resolve({ data: null, error: { code: 'NETWORK' } }),
    };
    return query;
  });
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow();
  vi.mocked(auth.supabase.from).mockImplementation(normal);
  await tournamentService.createTournament(club, config());
  expect(db.accepted.size).toBe(1);
  expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[1][1]);
});

it('retains the original multi-day plan through an unknown create and later resume', async () => {
  authority();
  const plan = {
    time_zone: 'UTC',
    stages: [
      { stage_no: 1, scheduled_start_utc: null, end_after_level: 12 },
      { stage_no: 2, scheduled_start_utc: '2026-12-02T12:00:00Z', end_after_level: null },
    ],
  };
  await expect(tournamentService.createTournament(club, config(), plan)).rejects.toThrow();
  const resumed = await tournamentService.resumePendingTournamentCreation(club, true);
  expect(resumed?.[0].creationStagePlan).toEqual(plan);
});

it('requires exact typed retirement evidence before releasing the old request', async () => {
  const db = authority();
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow();
  db.rpc.mockImplementationOnce(
    (_name: string, args: any) =>
      builder({
        data: {
          success: false,
          request_state: 'retired',
          request_id: 'wrong-request',
          user_id: actor,
          club_id: club,
          tournament_id: [...db.accepted.values()][0],
          error: 'tournament_request_target_retired',
        },
        error: null,
      }) as any
  );
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow(
    'Could Not Be Confirmed'
  );
  await tournamentService.createTournament(club, config());
  expect(db.accepted.size).toBe(1);
  expect(db.rpc.mock.calls[0][1]).toEqual(db.rpc.mock.calls[2][1]);
});

it('retires a verified original without recreating it and allows a subsequent explicit new intent', async () => {
  const db = authority();
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow();
  db.rpc.mockImplementationOnce(
    (_name: string, args: any) =>
      builder({
        data: {
          success: false,
          request_state: 'retired',
          request_id: args.p_request_id,
          user_id: actor,
          club_id: club,
          tournament_id: [...db.accepted.values()][0],
          error: 'tournament_request_target_retired',
        },
        error: null,
      }) as any
  );
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow('Retired');
  expect(db.accepted.size).toBe(1);
  await tournamentService.createTournament(club, config());
  expect(db.accepted.size).toBe(2);
  expect((db.rpc.mock.calls[2][1] as any).p_request_id).not.toBe(
    (db.rpc.mock.calls[0][1] as any).p_request_id
  );
});

it('refuses storage loss before any create is submitted', async () => {
  const db = authority(false);
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow(
    'storage unavailable'
  );
  expect(db.rpc).not.toHaveBeenCalled();
});

it('permits a corrected definitively refused child without changing accepted siblings', async () => {
  const db = authority(false);
  const normal = db.rpc.getMockImplementation()!;
  let calls = 0;
  db.rpc.mockImplementation((name: string, args: any) => {
    if (++calls === 3)
      return builder({
        data: {
          success: false,
          request_state: 'not_created',
          request_id: args.p_request_id,
          user_id: actor,
          club_id: club,
          error: 'satellite_seats_invalid',
        },
        error: null,
      }) as any;
    return normal(name, args);
  });
  const child = {
    ...config(),
    type: 'satellite',
    satelliteTarget: { tournamentId: '', seatsAwarded: 1 },
  } as TournamentConfig;
  await expect(
    tournamentService.createTournamentWithSatellites(club, config(), [
      child,
      { ...child, name: 'Second Child' },
    ])
  ).rejects.toThrow();
  expect(db.accepted.size).toBe(2);
  expect(await tournamentService.resumePendingTournamentCreation(club)).toBeNull();
  const events = await tournamentService.createTournamentWithSatellites(
    club,
    { ...config(), name: 'Edited Main' },
    [
      { ...child, name: 'Edited First' },
      { ...child, name: 'Corrected Second', buyIn: 20 },
    ]
  );
  expect(db.accepted.size).toBe(3);
  expect(events).toHaveLength(3);
  expect(db.rpc.mock.calls[3][1]).toEqual(db.rpc.mock.calls[0][1]);
  expect(db.rpc.mock.calls[4][1]).toEqual(db.rpc.mock.calls[1][1]);
  expect((db.rpc.mock.calls[5][1] as any).p_request_id).toBe(
    (db.rpc.mock.calls[2][1] as any).p_request_id
  );
  expect((db.rpc.mock.calls[5][1] as any).p_config.name).toBe('Corrected Second');
});

it('does not wait indefinitely behind another tab owning the original request', async () => {
  const db = authority(false);
  vi.spyOn(navigator.locks, 'request').mockImplementationOnce(
    (_name: any, _options: any, callback: any) => Promise.resolve(callback(null))
  );
  await expect(tournamentService.createTournament(club, config())).rejects.toThrow(
    'Active In Another Tab'
  );
  expect(db.rpc).not.toHaveBeenCalled();
});

it('does not report a multi-day creation complete from the modal resume path', async () => {
  const db = authority();
  const plan = {
    time_zone: 'UTC',
    stages: [
      { stage_no: 1, scheduled_start_utc: null, end_after_level: 12 },
      { stage_no: 2, scheduled_start_utc: '2026-12-02T12:00:00Z', end_after_level: null },
    ],
  };
  await expect(tournamentService.createTournament(club, config(), plan)).rejects.toThrow();
  await expect(tournamentService.resumePendingTournamentCreation(club)).rejects.toThrow(
    'Original Multi-Day'
  );
  expect(db.rpc).toHaveBeenCalledTimes(1);
});

it('retains stage ownership across a crash before the separate stage record is written', async () => {
  const db = authority(false);
  const plan = {
    time_zone: 'UTC',
    stages: [
      { stage_no: 1, scheduled_start_utc: null, end_after_level: 12 },
      { stage_no: 2, scheduled_start_utc: '2026-12-02T12:00:00Z', end_after_level: null },
    ],
  };
  const created = await tournamentService.createTournament(club, config(), plan);
  sessionStorage.clear(); // The second stage-continuation record never committed.
  const resumed = await tournamentService.resumePendingTournamentCreation(club, true);
  expect(resumed?.[0]).toMatchObject({ id: created.id, creationStagePlan: plan });
  expect(db.accepted.size).toBe(1);
});
