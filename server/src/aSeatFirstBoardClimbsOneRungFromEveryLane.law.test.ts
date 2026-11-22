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

describe('the past-start walk leaves regular seat-first boards (both empty 0/3 & 0/2 and occupied ladder boards) alone (Dan 2026-11-22)', () => {
  const block = SRC.slice(SRC.indexOf('if (needsPastStartTopUp) {'));
  const guardMatch = block.match(
    /if\s*\(\s*isSngOrSpin\s*&&\s*\(rosterByTournament\.get\(tournament\.id\)\s*!==\s*0\s*\|\|\s*tournament\.format_contract\s*!==\s*'seat-first-satellite-v1'\)\s*\)\s*continue;/
  );

  it('guards before the full-field target is computed', () => {
    expect(guardMatch).toBeTruthy();
    const at = guardMatch!.index!;
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(
      block.indexOf('const target = tournament.effective_max_players ?? minPlayers;')
    );
  });

  it('leaves empty 0/3 Spins and 0/2 Heads-Up boards untouched while empty legacy satellite feeders keep the past-start path', () => {
    expect(guardMatch![0]).toContain("tournament.format_contract !== 'seat-first-satellite-v1'");
    expect(block.indexOf('shouldCancelEmptyPastStartEvent(')).toBeGreaterThan(guardMatch!.index!);
  });

  it('the fast lane still climbs one rung for a horse-only board', () => {
    expect(SRC).toMatch(/const target = hasHuman \? seats : Math\.min\(seats, paid \+ 1\);/);
  });
});
