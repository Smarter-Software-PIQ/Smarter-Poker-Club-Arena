import { describe, expect, it } from 'vitest';
import {
  endedBeforeNextHand,
  refreshPreNavigationSelection,
  nextHandAdvanced,
  retirePausedPreNavigationSubjects,
} from '../e2e/support/preNavigationBoard';
import { createProgressSilenceGuard } from '../e2e/support/progressSilence';
import type { TournamentBoardFacts } from '../e2e/support/tournamentBoardEnding';

const running: TournamentBoardFacts = {
  tableId: 'satellite-table',
  tournamentId: 'satellite',
  tournamentStatus: 'RUNNING',
  currentPlayers: 12,
  tableStatus: 'running',
  endedAt: null,
  bigBlind: 200,
  seatStacks: [1000, 2000],
  seatedUserIds: ['p1', 'p2'],
};

describe('pre-navigation subjects can end before the next hand', () => {
  it('retires the completed satellite without requiring a new hand', () => {
    expect(
      endedBeforeNextHand(running, {
        ...running,
        tournamentStatus: 'COMPLETED',
        tableStatus: 'closed',
        currentPlayers: 0,
        seatStacks: [],
        seatedUserIds: [],
      })
    ).toBe(true);
  });
  it('does not retire a silent still-dealable board or let later recovery erase silence', () => {
    expect(endedBeforeNextHand(running, running)).toBe(false);
    const guard = createProgressSilenceGuard(45000);
    expect(guard({ tableId: running.tableId, msSinceProgress: 45001 })).toBe(false);
    expect(guard({ tableId: running.tableId, msSinceProgress: 0 })).toBe(false);
  });
  it('requires complete relocation evidence for a closed running board', () => {
    const closed = {
      ...running,
      tableStatus: 'closed',
      seatStacks: [],
      seatedUserIds: [],
      relocatedUserIds: ['p1'],
      eliminatedUserIds: ['p2'],
    };
    expect(endedBeforeNextHand(running, closed)).toBe(true);
    expect(endedBeforeNextHand(running, { ...closed, eliminatedUserIds: [] })).toBe(false);
    expect(endedBeforeNextHand(running, { ...closed, tournamentId: 'another' })).toBe(false);
  });
  it('refuses unreadable, aborted and merely waiting subjects', () => {
    expect(endedBeforeNextHand(running, undefined)).toBe(false);
    expect(endedBeforeNextHand(undefined, { ...running, tournamentStatus: 'COMPLETED' })).toBe(
      false
    );
    expect(endedBeforeNextHand(running, { ...running, tournamentStatus: 'CANCELLED' })).toBe(false);
    expect(endedBeforeNextHand(running, { ...running, tableStatus: 'waiting' })).toBe(false);
  });
});

describe('a parked subject before browser admission', () => {
  const setup = () => ({
    baselines: [{ tableId: 'parked', handCount: 10 }],
    facts: new Map<string, TournamentBoardFacts>(),
    excluded: new Set<string>(),
    retired: new Set<string>(),
    failed: new Set<string>(),
    deadline: 90_000,
  });
  const sample = (msSinceProgress = 11_000, paused = true) => ({
    tableId: 'parked',
    handCount: 10,
    running: true,
    paused,
    msSinceProgress,
    loopPhase: 'parked_for_pause+5s',
  });
  it('records ineligibility and requires a healthy replacement to start another hand', async () => {
    const state = setup();
    const receipt = retirePausedPreNavigationSubjects(state, [sample()], 45_000, 12_000);
    expect(receipt).toMatchObject([{ tableId: 'parked', reason: 'paused_before_navigation' }]);
    expect(state.excluded.size).toBe(0); // A pause is not a natural completion.
    expect(
      await refreshPreNavigationSelection(state, undefined, async (deadline) => {
        expect(deadline).toBe(90_000);
        return [{ tableId: 'healthy', handCount: 20 }];
      })
    ).toBe(true);
    expect(nextHandAdvanced(state.baselines[0]!, { tableId: 'healthy', handCount: 20 })).toBe(
      false
    );
    expect(nextHandAdvanced(state.baselines[0]!, { tableId: 'healthy', handCount: 21 })).toBe(true);
    expect(state.deadline).toBe(90_000);
  });
  it('cannot certify or readmit the only parked subject even after it resumes', async () => {
    const state = setup();
    retirePausedPreNavigationSubjects(state, [sample()], 45_000, 12_000);
    for (let poll = 0; poll < 3; poll++) {
      await refreshPreNavigationSelection(state, undefined, async (deadline) => {
        expect(deadline).toBe(90_000);
        return [{ tableId: 'parked', handCount: 11 + poll }];
      });
      expect(state.baselines).toEqual([]);
    }
    expect(state.deadline).toBe(90_000);
    expect(state.excluded.size).toBe(0);
  });
  it('does not retire an unpaused stall or erase an already failed subject', () => {
    const state = setup();
    const active = createProgressSilenceGuard(45_000);
    expect(
      retirePausedPreNavigationSubjects(state, [sample(45_001, false)], 45_000, 46_000)
    ).toEqual([]);
    expect(active(sample(45_001, false))).toBe(false);
    state.failed.add('parked');
    expect(retirePausedPreNavigationSubjects(state, [sample(0)], 45_000, 47_000)).toEqual([]);
    expect(active(sample(0))).toBe(false);
    expect(state.failed.has('parked')).toBe(true);
    expect(state.retired.size).toBe(0);
    expect(retirePausedPreNavigationSubjects(setup(), [sample(45_001)], 45_000, 46_000)).toEqual(
      []
    );
  });
});

it('executes terminal-subject reselection without certifying readmission or resetting its deadline', async () => {
  const a = { ...running, tableId: 'old-a' };
  const b = { ...running, tableId: 'old-b' };
  const c = { ...running, tableId: 'new' };
  let latest = new Map([
    ['old-a', a],
    ['old-b', b],
    ['new', c],
  ]);
  const reader = {
    boardFacts: async (ids: string[]) => new Map(ids.map((id) => [id, latest.get(id)!])),
    accountClosedBoard: async (_start: TournamentBoardFacts, end: TournamentBoardFacts) => end,
  };
  const state = {
    baselines: [
      { tableId: 'old-a', handCount: 10 },
      { tableId: 'old-b', handCount: 11 },
    ],
    facts: new Map([
      ['old-a', a],
      ['old-b', b],
    ]),
    excluded: new Set<string>(),
    failed: new Set<string>(),
    deadline: 90000,
  };
  let discoveries = 0;
  const discover = async (deadline: number) => {
    expect(deadline).toBe(90000);
    discoveries++;
    return [{ tableId: 'new', handCount: 20 }];
  };
  latest = new Map([
    ['old-a', { ...a, tournamentStatus: 'COMPLETED' }],
    ['old-b', { ...b, tournamentStatus: 'COMPLETED' }],
    ['new', c],
  ]);
  expect(await refreshPreNavigationSelection(state, reader, discover)).toBe(true);
  expect(discoveries).toBe(1);
  expect(state.baselines).toEqual([{ tableId: 'new', handCount: 20 }]);
  expect(nextHandAdvanced(state.baselines[0]!, { tableId: 'new', handCount: 20 })).toBe(false);
  expect(await refreshPreNavigationSelection(state, reader, discover)).toBe(false);
  expect(nextHandAdvanced(state.baselines[0]!, { tableId: 'new', handCount: 21 })).toBe(true);
  expect(state.deadline).toBe(90000);
  expect(discoveries).toBe(1);

  // An earlier sampled silence cannot disappear behind a later natural ending.
  state.failed.add('new');
  latest.set('new', { ...c, tournamentStatus: 'COMPLETED' });
  expect(await refreshPreNavigationSelection(state, reader, discover)).toBe(false);
  expect(state.excluded.has('new')).toBe(false);
  expect(discoveries).toBe(1);
});
