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

  // With no chips added at start, the pool during late registration is what
  // the field has actually paid. Every live pool display reads it through the
  // shared rule (Dan, 2026-11-06/07: actual real-time totals only; the
  // guarantee is shown as the guarantee, never as the pool).
  it.each([
    ['src/components/table/TournamentBreakScreen.tsx'],
    ['src/pages/XMTTPage.tsx'],
    ['src/components/lobby/GameLobbyPanel.tsx'],
  ])('%s prints the live pool through the shared rule', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/(effectivePrizePool|displayTotalPool)\(/);
    expect(src).toContain('guaranteed_prize');
  });
});
