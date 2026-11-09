import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { sliceMethod } from '../helpers/sourceWindow';
import { TOURNAMENT_CHAMPION_DISPLAY_MS } from '../../src/utils/tournamentChampion';
import { awaitTournamentResultEnrichment } from '../../src/utils/tournamentResultEnrichment';

const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
const compiled = ts.transpileModule(
  sliceMethod(source, 'async function announceSpectatorChampion'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;

function viewer(
  options: {
    embedded?: boolean;
    outcome?: unknown;
    pending?: Promise<unknown>;
    qualifiers?: unknown[];
    target?: boolean;
  } = {}
) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn(async () => ({
      data: options.qualifiers ?? [],
      count: options.qualifiers?.length ?? 0,
      error: null,
    })),
    maybeSingle: vi.fn(
      () =>
        options.pending ??
        Promise.resolve(
          options.outcome ?? {
            data: { user_id: 'champion', username: 'xXVikingXx', prize: 98.72 },
            error: null,
          }
        )
    ),
  };
  const announce = vi.fn(),
    emit = vi.fn(),
    navigate = vi.fn(),
    report = vi.fn(),
    retry = vi.fn();
  const factory = new Function(
    'supabase',
    'setTournamentWinner',
    'masterBus',
    'navigate',
    'reportError',
    'scheduleDurableCompletionRetry',
    'TOURNAMENT_CHAMPION_DISPLAY_MS',
    'awaitTournamentResultEnrichment',
    `
    let isMounted=true, exitStarted=false, championAnnouncementInFlight=false, terminalCelebrationStarted=false;
    let durableCompletionHandled=false;
    const tournamentExitTimerRef={current:null}, durableTournamentId='event', tableId='final';
    const embeddedTableId=${options.embedded ? "'final'" : 'undefined'};
    const durableTournamentName='Championship', formatGameTitle=(s)=>s;
    const lobbyClubIdRef={current:'my-club'};
    const loadedSatelliteTarget=${(options.target ?? !!options.qualifiers) ? "'target'" : 'null'};
    const goToLobbyWithResult=(position,prize,delay)=>setTimeout(()=>masterBus.emit('entrant-result',{position,prize}),delay);
    ${compiled}
    return {run:announceSpectatorChampion, dispose:()=>{
      isMounted=false; clearTimeout(tournamentExitTimerRef.current);
    }};`
  );
  return {
    query,
    announce,
    emit,
    navigate,
    report,
    retry,
    ...factory(
      { from: () => query },
      announce,
      { emit },
      navigate,
      report,
      retry,
      TOURNAMENT_CHAMPION_DISPLAY_MS,
      awaitTournamentResultEnrichment
    ),
  };
}
afterEach(() => vi.useRealTimers());

describe('Everyone sees the committed champion then this table closes', () => {
  it('announces the identity and exact prize, then closes at 20 seconds exactly once', async () => {
    vi.useFakeTimers();
    const v = viewer();
    await v.run();
    await v.run();
    expect(v.query.eq).toHaveBeenCalledWith('position', 1);
    expect(v.query.eq).toHaveBeenCalledWith('status', 'winner');
    expect(v.announce).toHaveBeenCalledExactlyOnceWith({
      prize: 98.72,
      name: 'Championship',
      championName: 'xXVikingXx',
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(v.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(v.emit).toHaveBeenCalledExactlyOnceWith('TABLE_MENU_ACTION', {
      tableId: 'final',
      action: 'CLOSE_TABLE_TAB',
    });
    expect(v.navigate).toHaveBeenCalledExactlyOnceWith('/clubs/my-club');
  });
  /* REWRITTEN 2026-11-09, and the old wording is why. It asserted that a
     participant finishing SECOND was announced with `championName:
     'xXVikingXx'` and `prize: 98.72` - the champion's name and the champion's
     prize - and called that "separate from" their own result because the
     lobby card behind it carried the right numbers. It is not separate; it is
     the card the player is looking at. Dan, from a finished heads-up match:
     "in heads up, the loser received a Champion and prize 38 even though they
     lost." The overlay's `position` prop defaults to 1, so no position meant
     "Champion! / 1st Place". A participant's announcement is now their own
     result, and the dwell either side of it is unchanged. */
  it('announces a cashing participant their own finish and their own prize', async () => {
    vi.useFakeTimers();
    const v = viewer();
    await v.run({ position: 2, prize: 40.25 });
    expect(v.announce).toHaveBeenCalledExactlyOnceWith({
      prize: 40.25,
      name: 'Championship',
      championName: undefined,
      position: 2,
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(v.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(v.emit).toHaveBeenCalledExactlyOnceWith('entrant-result', { position: 2, prize: 40.25 });
  });
  it('celebrates nothing for a participant who lost and was paid nothing', async () => {
    vi.useFakeTimers();
    const v = viewer();
    await v.run({ position: 2, prize: 0 });
    expect(v.announce).not.toHaveBeenCalled();
    // ...and they leave on the short bust beat rather than sitting through the
    // champion dwell in front of somebody else's trophy.
    await vi.advanceTimersByTimeAsync(2_499);
    expect(v.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(v.emit).toHaveBeenCalledExactlyOnceWith('entrant-result', { position: 2, prize: 0 });
  });
  it('still gives a participant who WON the champion card, with their own prize', async () => {
    vi.useFakeTimers();
    const v = viewer();
    await v.run({ position: 1, prize: 98.72 });
    expect(v.announce).toHaveBeenCalledExactlyOnceWith({
      prize: 98.72,
      name: 'Championship',
      championName: 'xXVikingXx',
    });
  });
  it('announces all satellite qualifiers and their committed award values without inventing first place', async () => {
    vi.useFakeTimers();
    const v = viewer({
      outcome: { data: null, error: null },
      qualifiers: [
        { user_id: 'a', username: 'Alice', prize: 50 },
        { user_id: 'b', username: 'Bob', prize: 50 },
      ],
    });
    await v.run();
    expect(v.query.is).toHaveBeenCalledWith('position', null);
    expect(v.announce).toHaveBeenCalledExactlyOnceWith({
      prize: 0,
      name: 'Championship',
      championName: undefined,
      qualifiers: [
        { username: 'Alice', prize: 50 },
        { username: 'Bob', prize: 50 },
      ],
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(v.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(v.emit).toHaveBeenCalledOnce();
  });
  it('does not infer satellite qualification from a missing first place in an ordinary tournament', async () => {
    vi.useFakeTimers();
    const v = viewer({
      outcome: { data: null, error: null },
      qualifiers: [{ user_id: 'bad', username: 'Unranked', prize: 50 }],
      target: false,
    });
    await v.run();
    expect(v.query.range).not.toHaveBeenCalled();
    expect(v.announce).not.toHaveBeenCalled();
    expect(v.retry).toHaveBeenCalledOnce();
  });
  it('closes only the finished embedded tab and preserves the other tables', async () => {
    vi.useFakeTimers();
    const v = viewer({ embedded: true });
    await v.run();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(v.emit).toHaveBeenCalledTimes(1);
    expect(v.navigate).not.toHaveBeenCalled();
  });
  it('does not navigate after unmount or accept a late read', async () => {
    vi.useFakeTimers();
    const v = viewer();
    await v.run();
    v.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(v.emit).not.toHaveBeenCalled();
    let resolve!: (v: unknown) => void;
    const late = viewer({
      pending: new Promise((r) => {
        resolve = r;
      }),
    });
    const run = late.run();
    late.dispose();
    resolve({ data: { user_id: 'champion', prize: 500 }, error: null });
    await run;
    expect(late.announce).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: new Error('Unreadable') },
    { data: { user_id: 'champion', prize: null }, error: null },
    { data: { user_id: 'champion', prize: -1 }, error: null },
  ])('never invents a prize when the committed result is unavailable', async (outcome) => {
    vi.useFakeTimers();
    const v = viewer({ outcome });
    await v.run();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(v.announce).not.toHaveBeenCalled();
    expect(v.emit).not.toHaveBeenCalled();
    expect(v.retry).toHaveBeenCalledOnce();
  });
  it('bounds a hung read and does not duplicate an in-flight lookup', async () => {
    vi.useFakeTimers();
    const v = viewer({ pending: new Promise(() => {}) });
    const first = v.run();
    await v.run();
    await vi.advanceTimersByTimeAsync(1500);
    await first;
    expect(v.query.maybeSingle).toHaveBeenCalledOnce();
    expect(v.retry).toHaveBeenCalledOnce();
    expect(v.announce).not.toHaveBeenCalled();
  });
  it('wires both the winner event and the durable spectator recovery to the announcement', () => {
    expect(sliceMethod(source, 'async function exitFromDurableCompletion()')).toContain(
      'await announceSpectatorChampion()'
    );
    const start = source.indexOf("data?.type === 'tournament_winner'");
    expect(
      source.slice(start, source.indexOf("data?.type === 'late_reg_closed'", start))
    ).toContain('void exitFromDurableCompletion()');
    expect(sliceMethod(source, 'async function exitFromDurableCompletion()')).toContain(
      'await announceSpectatorChampion({ position, prize })'
    );
  });
});
