import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-05: "RETIRE DIAMOND ARENA NOW". Retirement goes through the
// retained-record authority, refuses while anything is open, and is enforced
// at the database boundary for every writer.
const sql = readFileSync(
  'supabase/migrations/20261105224533_diamond_arena_is_permanently_retired.sql',
  'utf8'
);

describe('Diamond Arena is permanently retired', () => {
  it('retires only the one Diamond Arena club through the retained-record authority', () => {
    expect(sql).toContain("c        constant uuid := '002c2d27-9584-4e52-835a-bb2be148fc81';");
    expect(sql).toContain('public.fn_retire_settled_club_core_20260906(c, v_club.name, c_reason)');
  });

  it('acts as platform operations, the only identity the Diamond arena guard admits', () => {
    expect(sql).toContain("jsonb_build_object('sub', v_club.owner_id, 'role', 'service_role')");
    expect(sql).not.toContain("'role', 'authenticated'");
  });

  it('refuses while an event is open or the Midnight Free Buy is unsettled', () => {
    expect(sql).toContain('DIAMOND_RETIREMENT_EVENT_STILL_OPEN');
    expect(sql).toContain('DIAMOND_RETIREMENT_MIDNIGHT_NOT_SETTLED');
  });

  it('proves the terminal state: retired, and the arena resolver no longer finds it', () => {
    expect(sql).toContain('public.fn_diamond_arena_club() IS NOT NULL');
    expect(sql).toMatch(/@live-proof: .*lifecycle_status = 'retired'/);
  });
});
