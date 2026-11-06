/**
 * Heads-up league rows dealt before the corrected button (#9526) measured
 * reversed blinds. The pool (fn_league_pooled) leaves them out, so a
 * switch-on rule that reads a "significant pooled league result" (V33's, for
 * one) reads only the game production plays. This pins the excluded list to
 * the two-seat cards; HorseLeagueHeadsUpBlinds.test.ts pins the button itself.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEAGUE_MATCHUPS } from './HorseLeague.js';

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      '../../../supabase/migrations/20261106052532_the_league_pools_heads_up_cards_only_from_the_corrected_butt.sql',
      import.meta.url
    )
  ),
  'utf8'
);

// The two-seat cards on the card when the corrected button first ran nightly.
const DEALT_REVERSED = [
  'hu_mind_layer',
  'hu_v16_overlay',
  'v29_gto_flop',
  'v30_gto_turn_river',
  'v32_facing_defense',
  'v33_depth_ceiling_400bb',
];

describe('heads-up league epoch', () => {
  it('the pool leaves out exactly the two-seat cards dealt with reversed blinds', () => {
    const block =
      /r\.run_date < date '2026-11-06'\s+and r\.matchup = any \(array\[([^\]]+)\]\)/.exec(
        MIGRATION
      );
    expect(block).not.toBeNull();
    const names = [...block![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(names).toEqual(DEALT_REVERSED);
    for (const name of names) {
      const card = LEAGUE_MATCHUPS.find((m) => m.name === name);
      expect(card, name).toBeDefined();
      expect(card!.seats, name).toBe(2);
    }
    // Every two-seat card on today's card that predates the epoch is excluded.
    const twoSeat = LEAGUE_MATCHUPS.filter((m) => m.seats === 2).map((m) => m.name);
    for (const name of DEALT_REVERSED) expect(twoSeat).toContain(name);
  });

  it('keeps the measured-only rule and deletes nothing', () => {
    expect(MIGRATION).toMatch(
      /and r\.status = 'measured'\s+and r\.stderr::numeric > 0\s+and r\.hands > 0/
    );
    expect(MIGRATION).not.toMatch(/\b(delete|update|truncate)\b\s/i);
    expect((MIGRATION.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((MIGRATION.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
  });
});
