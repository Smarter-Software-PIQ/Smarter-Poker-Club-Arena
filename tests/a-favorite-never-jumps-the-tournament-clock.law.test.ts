/**
 * Dan 2026-11-05: "WHY WOULD TOURNAMENTS THAT ARE STARTING IN 22 HOURS EVER BE
 * DISPLAYED BEFORE TOURNAMENTS STARTING IN 22 MINUTES?! FAVORITES THAT START
 * MORE THEN 24 HOURS OUT, SHOULD NOT BE DISPLAYED." Then, at 17:07: "MAKE IT SO
 * 'FAVORITES' ONLY SHOW WHEN THEY ARE 18 HOURS AWAY FROM STARTING, NOT 24".
 */
import { describe, expect, it } from 'vitest';
import {
  FAVORITE_DISPLAY_HORIZON_MS,
  isFavoriteBeyondHorizon,
  prioritizeTournamentFavorites,
  withoutFavoritesBeyondHorizon,
} from '../src/components/lobby/tournamentFavoriteOrder';
import { tournamentEntry, type LobbyTournamentRow } from '../src/components/lobby/lobbyEntries';

const NOW = Date.UTC(2026, 10, 5, 23, 0, 0);
const HOUR = 60 * 60 * 1000;

function mtt(id: string, startsInMs: number, status = 'REGISTERING') {
  return tournamentEntry(
    {
      id,
      name: id,
      game_type: 'NLH',
      format_contract: 'mtt-v2',
      current_players: 1,
      max_players: null,
      buy_in_amount: 10,
      buy_in_fee: 0,
      status,
      start_time: new Date(NOW + startsInMs).toISOString(),
      is_pinned: false,
    } as LobbyTournamentRow,
    'mtt'
  );
}

describe('a favorite never jumps the tournament clock', () => {
  it('the horizon is 18 hours', () => {
    expect(FAVORITE_DISPLAY_HORIZON_MS).toBe(18 * HOUR);
  });

  it('a starred MTT 22 hours out never sits above an event 22 minutes out', () => {
    const soon = mtt('starts-in-22-minutes', 22 * 60 * 1000);
    const later = mtt('starred-22-hours', 17 * HOUR);
    const order = prioritizeTournamentFavorites([soon, later], new Set([later.id]));
    expect(order.map((e) => e.id)).toEqual(['starts-in-22-minutes', 'starred-22-hours']);
  });

  it('a starred MTT starting more than 18 hours out is not displayed', () => {
    const tonight = mtt('tonight', 2 * HOUR);
    const tomorrow = mtt('tomorrow-edition', 19 * HOUR);
    const edge = mtt('seventeen-hours', 17 * HOUR);
    const unstarred = mtt('unstarred-later', 30 * HOUR);
    const stars = new Set([tonight.id, tomorrow.id, edge.id]);
    expect(isFavoriteBeyondHorizon(edge, stars, NOW)).toBe(false);
    expect(isFavoriteBeyondHorizon(tomorrow, stars, NOW)).toBe(true);
    expect(isFavoriteBeyondHorizon(tonight, stars, NOW)).toBe(false);
    expect(isFavoriteBeyondHorizon(unstarred, stars, NOW)).toBe(false);
    expect(
      withoutFavoritesBeyondHorizon([tonight, tomorrow, unstarred], stars, NOW).map((e) => e.id)
    ).toEqual(['tonight', 'unstarred-later']);
  });

  it('the board and the ALL tab both apply the horizon', async () => {
    const fs = await import('node:fs');
    const table = fs.readFileSync('src/components/lobby/LobbyTable.tsx', 'utf8');
    const page = fs.readFileSync('src/pages/ClubHomePage.tsx', 'utf8');
    expect(table).toMatch(/withoutFavoritesBeyondHorizon\(/);
    expect(table).not.toMatch(/return 'Favorites'/);
    expect(page).toMatch(/withoutFavoritesBeyondHorizon\(/);
  });
});

describe('a registration-closed (Running) tournament is always on the bottom', () => {
  it('sinks below every open event, pinned, starred or not, keeping order', async () => {
    const { runningLast } = await import('../src/components/lobby/tournamentFavoriteOrder');
    const running = mtt('running-starred', -2 * HOUR, 'RUNNING');
    running.status = 'running';
    running.featured = true;
    const late = mtt('late-reg', -10 * 60 * 1000, 'LATE_REG');
    late.status = 'late_reg';
    const soon = mtt('starts-soon', 30 * 60 * 1000);
    const tomorrow = mtt('tomorrow', 26 * HOUR);
    const order = runningLast([running, late, soon, tomorrow]);
    expect(order.map((e) => e.id)).toEqual([
      'late-reg',
      'starts-soon',
      'tomorrow',
      'running-starred',
    ]);
    const untouched = [late, soon];
    expect(runningLast(untouched)).toBe(untouched);
  });

  it('the board applies it after every sort path', async () => {
    const fs = await import('node:fs');
    const table = fs.readFileSync('src/components/lobby/LobbyTable.tsx', 'utf8');
    expect(table.match(/runningLast\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(table).toMatch(/return 'Running'/);
  });
});
