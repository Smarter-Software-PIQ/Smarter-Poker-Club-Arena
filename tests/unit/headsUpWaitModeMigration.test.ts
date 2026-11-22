import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_REL = 'supabase/migrations/20261122025900_heads_up_wait_mode_and_invite_hold.sql';
const MIGRATION_SQL = readFileSync(resolve(ROOT, MIGRATION_REL), 'utf8');
const MANIFEST_FRAGMENT = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/ci/schema-manifest.d/heads-up-wait-mode-engine.json'), 'utf8')
) as {
  tables: string[];
  functions: string[];
  columns: Record<string, string[]>;
};

let definerAuth: {
  unauthorisedWriters: (sql: string) => string[];
  anonReadableDefiners: (sql: string) => string[];
  unrevokedClones: (sql: string) => string[];
  unscopedRosterDefiners: (sql: string) => string[];
};
let explicitAccess: { auditMigration: (sql: string) => string[] };
let probes: { missingProbes: (sql: string) => Array<{ fn: string; reason: string }> };

beforeAll(async () => {
  definerAuth = await import(
    /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/check-definer-authorization.mjs'))
      .href
  );
  explicitAccess = await import(
    /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/check-explicit-table-access.mjs'))
      .href
  );
  probes = await import(
    /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs')).href
  );
});

describe('heads_up_wait_mode_and_invite_hold migration contract & security guards', () => {
  it('wraps DDL in one transaction with bounded lock_timeout and zero hot-table locks', () => {
    expect(MIGRATION_SQL).toMatch(/\bBEGIN;/);
    expect(MIGRATION_SQL).toMatch(/\bCOMMIT;/);
    expect(MIGRATION_SQL).toContain("SET LOCAL lock_timeout = '5s';");
    // No FK locks into hot tables (tournaments / tables / table_seats) and no FOR UPDATE locks on tournaments.
    expect(MIGRATION_SQL).not.toMatch(
      /\bREFERENCES\s+public\.(?:tournaments|tables|table_seats)\b/i
    );
    expect(MIGRATION_SQL).not.toMatch(/\bFOR\s+(?:UPDATE|SHARE)\b/i);
  });

  it('passes explicit table access, definer authorization, and function probe CI guards with zero findings', () => {
    expect(explicitAccess.auditMigration(MIGRATION_SQL)).toEqual([]);
    expect(definerAuth.unauthorisedWriters(MIGRATION_SQL)).toEqual([]);
    expect(definerAuth.anonReadableDefiners(MIGRATION_SQL)).toEqual([]);
    expect(definerAuth.unrevokedClones(MIGRATION_SQL)).toEqual([]);
    expect(definerAuth.unscopedRosterDefiners(MIGRATION_SQL)).toEqual([]);
    expect(probes.missingProbes(MIGRATION_SQL)).toEqual([]);
  });

  it('grants EXECUTE to authenticated and service_role only (anon revoked) and restricts table SELECT via RLS to creator', () => {
    expect(MIGRATION_SQL).toContain(
      'ALTER TABLE public.heads_up_wait_holds ENABLE ROW LEVEL SECURITY;'
    );
    expect(MIGRATION_SQL).toContain('USING (creator_user_id = auth.uid())');
    expect(MIGRATION_SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_set_heads_up_wait_mode(uuid, text)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(MIGRATION_SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_set_heads_up_wait_mode(uuid, text)\n  TO authenticated, service_role;'
    );
    expect(MIGRATION_SQL).toContain(
      'REVOKE ALL ON FUNCTION public.fn_check_heads_up_seat_invite(uuid, text)\n  FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(MIGRATION_SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_check_heads_up_seat_invite(uuid, text)\n  TO authenticated, service_role;'
    );
  });

  it('enforces bounded 5-minute hold, preserves existing invite token, and falls open on expiry or creator departure', () => {
    expect(MIGRATION_SQL).toContain("interval '5 minutes'");
    expect(MIGRATION_SQL).toContain('v_existing.invite_token');
    expect(MIGRATION_SQL).toContain('v_hold.hold_expires_at <= now()');
    expect(MIGRATION_SQL).toContain('v_creator_still_seated');
    expect(MIGRATION_SQL).toContain("'heads_up_invite_required'");
  });

  it('registers the new table, columns, and RPCs in schema-manifest.d', () => {
    expect(MANIFEST_FRAGMENT.tables).toContain('heads_up_wait_holds');
    expect(MANIFEST_FRAGMENT.functions).toEqual(
      expect.arrayContaining(['fn_set_heads_up_wait_mode', 'fn_check_heads_up_seat_invite'])
    );
    expect(MANIFEST_FRAGMENT.columns.heads_up_wait_holds).toEqual(
      expect.arrayContaining([
        'tournament_id',
        'table_id',
        'creator_user_id',
        'wait_mode',
        'invite_token',
        'hold_expires_at',
        'updated_at',
      ])
    );
  });
});
