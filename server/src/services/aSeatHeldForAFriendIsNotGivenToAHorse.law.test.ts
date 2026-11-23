/**
 * LAW: A SEAT HELD FOR AN INVITED FRIEND IS NOT GIVEN TO A HORSE, AND A
 * PRIVATE HELD GAME IS NOT ONE OF THE BOARD'S INSTANCES (2026-11-22).
 *
 * The player, to Dan: "The crazy river is always on the table, even when you
 * invite someone. It doesn't open a new table." Invite To Game now opens a
 * game whose seats are held for the friends the inviter sends the link to
 * (supabase/migrations/20261123013126). The database refuses a held seat to
 * anyone but its holder; the engine must not try to fill it, and must not
 * count a private held game as a board (seatFirstLadder.ts: eleven Spins and
 * two Heads Ups are horse-seeded; a private game is a person's, not one of
 * them).
 *
 * What this pins:
 *   1. the reader's answers: live, expired, cancelled-or-fulfilled, unreadable
 *      (null, never "no holds"), not yet installed (PGRST202, no holds);
 *   2. every horse fill of a seat-first board with a person in it asks the
 *      hold first - GameServer's seat-first lane and topUpWithHorses' partner
 *      hold, which every other caller (the past-start walk, the overlay guard)
 *      meets - and an unreadable answer holds the fill instead of filling;
 *   3. the board room and the board's coverage leave private held games out;
 *   4. no horse identity enters the rule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRIVATE_GAME_HOLD_MAX_MS,
  PrivateGameHoldReader,
  parsePrivateGameHolds,
  privateHoldUntilMs,
  privatelyHeldIds,
} from './privateGameHolds.js';
import { sliceMethod } from '../testHelpers/sourceWindow.js';

const NOW = Date.parse('2026-11-22T20:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  tournament_id: 't-1',
  live: true,
  exclusive: true,
  seats_held: 1,
  invitees_seated: 0,
  held_open: 1,
  outcome: 'holding',
  hold_expires_at: new Date(NOW + 6 * 60_000).toISOString(),
  ...over,
});

describe('what the engine reads about a held seat', () => {
  it('a live hold keeps its seat until its freeze-credited end', () => {
    const holds = parsePrivateGameHolds([row()])!;
    expect(privateHoldUntilMs(holds.get('t-1'), NOW)).toBe(NOW + 6 * 60_000);
  });

  it('a hold the database calls over, or whose end has passed, keeps nothing', () => {
    for (const over of [
      { live: false, outcome: 'expired' },
      { live: false, outcome: 'fulfilled' },
      { live: false, outcome: 'cancelled' },
      { live: false, outcome: 'creator_left' },
      { hold_expires_at: new Date(NOW - 1).toISOString() },
      { hold_expires_at: 'not a time' },
    ]) {
      const holds = parsePrivateGameHolds([row(over)])!;
      expect(privateHoldUntilMs(holds.get('t-1'), NOW)).toBe(-Infinity);
    }
  });

  it('no row can hold a seat longer than ten minutes of play plus one thaw', () => {
    const holds = parsePrivateGameHolds([
      row({ hold_expires_at: new Date(NOW + 10 * 3_600_000).toISOString() }),
    ])!;
    expect(privateHoldUntilMs(holds.get('t-1'), NOW)).toBe(NOW + PRIVATE_GAME_HOLD_MAX_MS);
  });

  it('only a PRIVATE held game leaves the board; a seat held in a shared game does not', () => {
    const holds = parsePrivateGameHolds([
      row({ tournament_id: 'private' }),
      row({ tournament_id: 'shared', exclusive: false }),
      row({ tournament_id: 'over', live: false }),
    ])!;
    expect([...privatelyHeldIds(holds, NOW)]).toEqual(['private']);
  });

  it('an unreadable answer is null, never "no holds"; a missing door is no holds', async () => {
    const failing = new PrivateGameHoldReader(
      async () => ({ data: null, error: { code: '57014', message: 'canceling statement' } }),
      0,
      () => NOW
    );
    expect(await failing.snapshot()).toBeNull();
    expect(await failing.holdUntilMs('t-1')).toBeNull();
    expect(await failing.privateIds()).toBeNull();
    const garbage = new PrivateGameHoldReader(async () => ({ data: { not: 'an array' }, error: null }));
    expect(await garbage.snapshot()).toBeNull();
    const notInstalled = new PrivateGameHoldReader(async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    }));
    expect((await notInstalled.snapshot())?.size).toBe(0);
  });

  it('one read answers every caller for a few seconds', async () => {
    let reads = 0;
    let at = NOW;
    const reader = new PrivateGameHoldReader(
      async () => {
        reads++;
        return { data: [row()], error: null };
      },
      4_000,
      () => at
    );
    await Promise.all([reader.snapshot(), reader.holdUntilMs('t-1'), reader.privateIds()]);
    expect(reads).toBe(1);
    at += 4_001;
    await reader.snapshot();
    expect(reads).toBe(2);
  });
});

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const GAME_SERVER = read('../GameServer.ts');
const RECURRING = read('./TournamentRecurringService.ts');
const RULE = read('./privateGameHolds.ts');

describe('every horse fill of a held game asks the hold first', () => {
  it("GameServer's seat-first lane holds a person's board while it is held, and on an unreadable answer", () => {
    const lane = sliceMethod(GAME_SERVER, 'private async fillPartialSeatFirstGame(');
    const ask = lane.indexOf('privateGameHolds.holdUntilMs(tournamentId)');
    const topUp = lane.indexOf('this.topUpPartialSeatFirst(');
    expect(ask).toBeGreaterThan(-1);
    expect(topUp).toBeGreaterThan(ask);
    expect(lane).toMatch(/if \(privateUntil === null\) return;/);
    expect(lane).toMatch(/Math\.max\(\s*privateUntil,/);
  });

  it("topUpWithHorses' partner hold reads the hold before any other bound can end it", () => {
    const hold = sliceMethod(RECURRING, 'private async seatFirstHumanPartnerHold(');
    const ask = hold.indexOf('privateGameHolds.holdUntilMs(tournamentId)');
    expect(ask).toBeGreaterThan(-1);
    // Before the early exits that end the ordinary partner hold.
    expect(ask).toBeLessThan(hold.indexOf('latestPossible'));
    expect(hold).toMatch(
      /if \(privateUntil === null\) return now \+ PRIVATE_GAME_HOLD_UNKNOWN_RETRY_MS;/
    );
    expect(hold).toMatch(/if \(privateUntil > now\) \{[\s\S]*return privateUntil;/);
    // Every caller of topUpWithHorses meets it before a horse is picked.
    const topUp = sliceMethod(RECURRING, 'async topUpWithHorses(');
    expect(topUp.indexOf('this.seatFirstHumanPartnerHold(')).toBeGreaterThan(-1);
    expect(topUp.indexOf('this.seatFirstHumanPartnerHold(')).toBeLessThan(
      topUp.indexOf('const shortfall = Math.max(0, targetPlayers - liveCount);')
    );
  });

  it('a refused race against the database guard is an expected refusal, not an alarm', () => {
    expect(RECURRING).toMatch(/msg\.includes\('PRIVATE_GAME_SEAT_HELD'\)/);
  });
});

describe('a private held game is not one of the board instances', () => {
  it('the board room counts no private held game toward the eleven and the two', () => {
    const room = sliceMethod(RECURRING, 'private async seatFirstBoardRoom(');
    expect(room).toMatch(/this\.privateGameHolds\.privateIds\(\)/);
    expect(room).toMatch(/\.filter\(\(id\) => !privateIds\.has\(id\)\)/);
    expect(room).toMatch(/privateIds === null\s*\?\s*null/);
  });

  it("a private held game does not cover its price point and is never seeded as an empty board", () => {
    const open = sliceMethod(RECURRING, 'private async ensureBoardOpen<');
    const filter = open.indexOf('.filter((r) => !privateIds.has(String(r.id)))');
    expect(filter).toBeGreaterThan(-1);
    expect(open).toMatch(/if \(privateIds === null\) return;/);
    expect(filter).toBeLessThan(open.indexOf('const seatFirstIds'));
    expect(filter).toBeLessThan(open.indexOf('const open = new Set('));
  });

  it('the serving engine says it honours held seats, so the client can offer them', () => {
    expect(GAME_SERVER).toMatch(/privateGameHolds: 1,/);
  });
});

describe('horses are players', () => {
  it('the rule the engine reads names no horse', () => {
    expect(RULE).not.toMatch(/is_horse|isHorse/);
  });
});
