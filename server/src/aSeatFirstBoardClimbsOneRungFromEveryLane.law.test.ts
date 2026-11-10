/**
 * A SEAT-FIRST BOARD CLIMBS ITS LADDER ONE RUNG AT A TIME, FROM EVERY LANE
 * (2026-11-10).
 *
 * Dan's Spin ladder: one horse, a second after 60-80 minutes, a third 30-60
 * minutes later. The fast lane adds one horse per rung; the discovery
 * past-start walk fills to a full field. On 840429a3 both reached Spins as
 * their first rung closed and 3 of the first 9 went from one horse to three.
 * A seat-first board with a seat sold (or an unread roster) must not be
 * filled by the past-start walk.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(resolve(__dirname, 'GameServer.ts'), 'utf8');

describe('the past-start walk leaves a seat-first board with a seat sold to the ladder', () => {
  const block = SRC.slice(SRC.indexOf('if (needsPastStartTopUp) {'));
  const guard = 'if (isSngOrSpin && rosterByTournament.get(tournament.id) !== 0) continue;';

  it('guards before the full-field target is computed', () => {
    const at = block.indexOf(guard);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(
      block.indexOf('const target = tournament.effective_max_players ?? minPlayers;')
    );
  });

  it('a board with nothing sold keeps the past-start path and its empty-event cancellation', () => {
    expect(guard).toContain('!== 0');
    expect(block.indexOf('shouldCancelEmptyPastStartEvent(')).toBeGreaterThan(block.indexOf(guard));
  });

  it('the fast lane still climbs one rung for a horse-only board', () => {
    expect(SRC).toMatch(/const target = hasHuman \? seats : Math\.min\(seats, paid \+ 1\);/);
  });
});
