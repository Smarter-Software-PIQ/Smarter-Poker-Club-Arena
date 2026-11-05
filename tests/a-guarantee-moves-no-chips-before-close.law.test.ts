import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-04: a guarantee is displayed as a floor; chips move only when
// registration closes, and only for the shortfall.
const MIGRATION =
  'supabase/migrations/20261105034239_guarantee_overlay_shrinks_live_as_entries_arrive.sql';

describe('a guarantee moves no chips before registration closes', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('the start trigger returns before any bank debit unless a satellite seat guarantee applies', () => {
    expect(sql).toContain('A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES');
    expect(sql).toContain('IF COALESCE(v_seat_guarantee, 0) <= 0 THEN RETURN NEW; END IF;');
    expect(sql).toContain(
      "v_anchor constant text := E'  IF v_short <= 0 THEN RETURN NEW; END IF;\\n'"
    );
  });

  it('the patch refuses unless its anchor appears exactly once', () => {
    expect(sql).toMatch(/<> 1 THEN\s+RAISE EXCEPTION/);
  });

  // With no chips added at start, a screen that prints the raw pool reads
  // below the guarantee during late registration. Every live pool display
  // floors it.
  it.each([
    ['src/components/table/TournamentBreakScreen.tsx'],
    ['src/pages/XMTTPage.tsx'],
    ['src/components/lobby/GameLobbyPanel.tsx'],
  ])('%s shows the guarantee as the floor', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/effectivePrizePool\(/);
    expect(src).toContain('guaranteed_prize');
  });
});
