import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-05: "RETIRE DIAMOND ARENA NOW". A Diamond club is owned by the
// system account, and fn_poker_guard_arena_structure refuses any change to a
// diamonds club from an authenticated caller unless the JWT role is
// service_role. 20261105224533 carried role 'authenticated' and was refused
// (apply run 42128783812). A door that impersonates a Diamond club's owner
// must therefore carry role service_role, and must go through the core rather
// than the public wrapper, which takes the platform-wide hand settlement lane.
const DIR = 'supabase/migrations';
const FILE = `${DIR}/20261105233352_diamond_arena_retires_as_platform_operations.sql`;
const sql = readFileSync(FILE, 'utf8');

// Refused by the database and never recorded in schema_migrations.
const REFUSED_BEFORE_THIS_LAW = new Set([
  '20261105224533_diamond_arena_is_permanently_retired.sql',
]);

describe('Diamond Arena retires as platform operations', () => {
  it('carries the system account as service_role, never as authenticated', () => {
    expect(sql).toContain("c_owner  constant uuid := '00000000-0000-0000-0000-000000000001';");
    expect(sql).toContain("jsonb_build_object('sub', c_owner, 'role', 'service_role')");
    expect(sql).not.toMatch(/'role',\s*'authenticated'/);
  });

  it('retires through the retained-record core, not the lane-taking public wrapper', () => {
    expect(sql).toContain('public.fn_retire_settled_club_core_20260906(c, v_club.name, c_reason)');
    expect(sql).not.toMatch(/fn_retire_settled_club\(/);
  });

  it('refuses unless every balance and obligation is zero, and proves the terminal state', () => {
    expect(sql).toContain('DIAMOND_RETIREMENT_EVENT_STILL_OPEN');
    expect(sql).toContain('DIAMOND_RETIREMENT_NOT_SETTLED');
    expect(sql).toContain('DIAMOND_RETIREMENT_NOT_TERMINAL');
    expect(sql).toMatch(/@live-proof: .*lifecycle_status = 'retired'.*is_public = false/);
  });

  it('no other migration impersonates a Diamond club owner as authenticated', () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && !REFUSED_BEFORE_THIS_LAW.has(f))
      .filter((f) => {
        const body = readFileSync(`${DIR}/${f}`, 'utf8');
        return (
          body.includes('002c2d27-9584-4e52-835a-bb2be148fc81') &&
          body.includes('request.jwt.claims') &&
          /'role',\s*'authenticated'/.test(body)
        );
      });
    expect(offenders).toEqual([]);
  });
});
