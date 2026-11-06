import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Dan, 2026-11-05: the break card's "Your VPIP (Last Hour)" read "No Recorded
 * Hands" to an account watching a table it was not entered at, and that read as
 * a broken stat. Every personal row on the break card ("Your Status", "Your
 * VPIP") belongs to an entrant of THIS event and to no other viewer. The VPIP
 * row's read stays the live, rolling-hour, per-tournament fact read.
 */
const card = readFileSync('src/components/table/TournamentBreakScreen.tsx', 'utf8');
const vpipRead = readFileSync('src/services/readTournamentHourVpip.ts', 'utf8');

describe('the break card shows your stats only to an entrant', () => {
  it('derives entrant status from the standings read, any status counted', () => {
    expect(card).toMatch(/heroIsEntrant:\s*\n?\s*!!heroUserId &&/);
    expect(card).toMatch(/\.some\(\s*\(r\) => String\(r\.user_id \?\? ''\) === heroUserId/);
  });

  it('renders the VPIP row only for an entrant', () => {
    const mounts = card.match(/<TournamentHourVpip[\s\S]*?\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(card).toMatch(/currentFacts\?\.heroIsEntrant && \(\s*<TournamentHourVpip/);
  });

  it('keeps the VPIP read scoped to this tournament, this player and the last hour', () => {
    expect(vpipRead).toContain(".from('ca_hand_facts')");
    expect(vpipRead).toContain(".eq('user_id', userId)");
    expect(vpipRead).toContain(".eq('tournament_id', tournamentId)");
    expect(vpipRead).toMatch(/VPIP_HOUR_MS = 60 \* 60 \* 1000/);
  });
});
