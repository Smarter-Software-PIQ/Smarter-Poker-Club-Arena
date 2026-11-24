/**
 * LAW: THE RELEASE FREEZE REFUSES MIGRATION DDL FROM EVERY REPO (2026-11-24).
 *
 * The 04:00 America/Chicago cutover serves a Backup copy of the schema taken
 * inside the 23:45-04:15 Chicago release schema freeze. A migration installed
 * inside the freeze is missing from that copy and the routine cutover keeps
 * serving. Club Arena's dispatcher and applier hold the freeze, but other
 * routes reach the same database: hand Apply Merged Migration runs (11-21
 * 06:38Z, 11-22 07:15Z) and Smarter-Poker-World-Hub trivia migrations installed
 * through the management API (11-24, five files; the 01:00 CST cycle deferred
 * d749a61e4c94). So the database enforces it: migration
 * 20261124085047_the_release_freeze_refuses_migration_ddl_from_every_repo.
 *
 * This law pins what must not drift: the database freeze is the dispatcher's
 * freeze, the installer's own marker is the only route admitted, the override
 * is the break-window override, and the break-window guard and the engine
 * recovery contract are not touched. Native proof:
 * tests/unit/theReleaseFreezeRefusesDdlFromEveryRepo.pg.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_SCHEMA_FREEZE_CHICAGO } from '../scripts/ci/merged-migration-dispatch.mjs';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const SQL = read(
  'supabase/migrations/20261124085047_the_release_freeze_refuses_migration_ddl_from_every_repo.sql'
);
const code = SQL.split('\n')
  .filter((l) => !/^\s*--/.test(l))
  .join('\n');
const hhmm = ([h, m]: number[]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

describe('the release freeze refuses migration DDL from every repo', () => {
  it("is the dispatcher's freeze, in America/Chicago", () => {
    expect(code).toContain(
      `c_freeze_from  CONSTANT time := '${hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.from)}';`
    );
    expect(code).toContain(
      `c_freeze_until CONSTANT time := '${hhmm(RELEASE_SCHEMA_FREEZE_CHICAGO.until)}';`
    );
    expect(code).toContain("v_local := (p_at AT TIME ZONE 'America/Chicago')::time;");
    expect(code).toContain('IF v_local >= c_freeze_from OR v_local < c_freeze_until THEN');
  });

  it("admits only the installer's own marker, which the installer sets on every transaction", () => {
    expect(code).toContain(
      "IF coalesce(p_app, '') = 'apply-recorded-migration'\n     OR coalesce(p_app, '') LIKE 'install-window-migrations%' THEN\n    RETURN NULL;"
    );
    expect(code.match(/p_app/g)?.length).toBe(3); // the parameter and its two tests, nothing else
    const identity = read('scripts/ci/migration-session-identity.mjs');
    expect(identity).toContain("SET LOCAL application_name = 'apply-recorded-migration';");
    const applier = read('scripts/ci/apply-recorded-migration.mjs');
    expect(applier).toContain("application_name: 'apply-recorded-migration',");
    // A hand dispatch cannot ride the marker: the applier refuses it inside the freeze.
    expect(applier).toContain('releaseFreezeAdmission(');
  });

  it('governs the sessions the break-window guard governs, on the same two events', () => {
    expect(code).toContain(
      'IF NOT public.fn_ca_break_window_governs(session_user::text, v_app) THEN RETURN; END IF;'
    );
    expect(code).toContain(
      "IF TG_EVENT = 'ddl_command_end' AND TG_TAG IN ('GRANT', 'REVOKE') THEN RETURN; END IF;"
    );
    expect(code).toMatch(
      /CREATE EVENT TRIGGER ca_release_freeze_refuses_ddl ON ddl_command_end\s+EXECUTE FUNCTION smarter_private\.fn_ca_release_freeze_ddl_guard\(\);\s*CREATE EVENT TRIGGER ca_release_freeze_refuses_drops ON sql_drop\s+EXECUTE FUNCTION smarter_private\.fn_ca_release_freeze_ddl_guard\(\);\s*COMMIT;\s*$/
    );
  });

  it('uses the break-window override: a reason, recorded once per transaction', () => {
    expect(code).toContain(
      "current_setting('ca.break_window_override_in_force', true) = txid_current()::text"
    );
    expect(code).toContain("current_setting('ca.break_window_migration_override', true)");
    expect(code).toContain('INSERT INTO public.ca_break_window_migration_overrides');
    expect(code).toContain("'release freeze: ' || v_override");
    expect(code).toContain(
      "IN ('on', 'off', 'true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0')"
    );
  });

  it('leaves the break-window guard and the engine recovery contract byte-identical', () => {
    expect(code).not.toMatch(/FUNCTION\s+public\.fn_ca_break_window_/);
    expect(code).not.toMatch(/FUNCTION\s+public\.fn_engine_recovery_window_contract/);
    expect(code).not.toMatch(/EVENT TRIGGER ca_break_window_/);
    expect(code).toContain(
      "IF public.fn_engine_recovery_window_contract() IS DISTINCT FROM 'engine-recovery-window-v1' THEN"
    );
  });
});
