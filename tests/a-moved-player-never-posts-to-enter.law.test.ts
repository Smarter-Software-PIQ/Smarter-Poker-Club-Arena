import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule, Dan 2026-11-15: "WHEN A PLAYER IS MOVED ON A MUST MOVE GAME TO A
// NEW TABLE, THEY NEVER NEED TO POST TO RECEIVE A HAND, IF THEY ARE COMING FROM
// A PREVIOUS TABLE. THEY ONLY POST IF THEY ARE IN THE BB OR IF THEY ARE SITTING
// OUT AND MISS THE BLINDS." Executed against the live function bodies on
// PostgreSQL before merge; this pins the shape.
const MIG = readFileSync(
  'supabase/migrations/20261115170236_a_moved_player_never_posts_to_enter_a_new_table.sql',
  'utf8'
);
const DEALING = readFileSync('server/src/engine/ServerTableEngineDealing.ts', 'utf8');
const BASE = readFileSync('server/src/engine/ServerTableEngineBase.ts', 'utf8');

describe('a moved player never posts to enter a new table', () => {
  it('every executor seats every move reason as moved, never as an entrant who agreed to post', () => {
    expect(MIG).toContain("v_hold := ''moved'';");
    expect(MIG).toContain('v_agreed := false;');
    expect(MIG).toContain("'entry_hold = ''moved'', entry_post_agreed = false, left_at = NULL'");
    // the old seat-change entry is the anchor that is removed, and must be gone afterwards
    expect(MIG).toContain(
      "v_hold := CASE WHEN m.reason = ''seat_change'' THEN ''waiting'' ELSE ''moved'' END;"
    );
    expect(MIG).toMatch(/position\('v_hold := CASE' in v_check\) > 0/);
    expect(MIG).toMatch(/position\('entry_hold = ''waiting''' in v_check\) > 0/);
  });

  it('edits only the reviewed live bodies, in one transaction', () => {
    expect(MIG).toContain("'9c87bb74b8589bf47f6ecb32d573fa4e'");
    expect(MIG).toContain("'85caa2ab67fd4ad8631b3f16c4fb6310'");
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
  });

  it('the engine admits a moved arrival without a wait for the big blind or a bill', () => {
    // arrival: a moved chair is never registered to wait for, or post, the big blind
    expect(DEALING).toMatch(
      /if \(!this\.isTournamentTable\(\) && entryHold === 'moved'\) \{[\s\S]{0,200}?\} else if \(!this\.returningFromSitout\.has\(p\.user_id\) && !this\.isTournamentTable\(\)\) \{[\s\S]{0,450}?this\.registerWaitForBB\(\s*p\.user_id,/
    );
    // admission: the marker clears with nothing billed
    expect(DEALING).toMatch(
      /for \(const p of players\) \{\s*if \(p\.entry_hold === 'moved'\)\s*this\.persistEntryHold\(p\.user_id, \{ hold: null, agreed: false \}\)/
    );
    // between the button and the big blind it only waits for the button
    const admit = BASE.slice(
      BASE.indexOf('protected admitMovedSeats('),
      BASE.indexOf('return admitted;', BASE.indexOf('protected admitMovedSeats('))
    );
    expect(admit).toContain(": p.entry_hold === 'moved';");
    expect(admit).not.toMatch(/postingBBToEnter|mustPostBB|waitingForBB|postBBWhenClear/);
  });
});
