/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A BANNED NETWORK CANNOT CREATE AN ACCOUNT (2026-11-09, binding)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * An account is created by Supabase Auth, which browsers and the apps call
 * directly. A firewall in front of the World Hub never sees that request, so a
 * denied address with a new mailbox met no rule.
 *
 * THE LAW: the function Supabase Auth's before-user-created hook calls refuses
 * a request whose observed address is inside a listed network, with the
 * documented error object, and answers every other request with an empty
 * object. A missing or unreadable address is allowed: this function runs for
 * every signup on the platform and must never be the reason nobody can join.
 * supabase_auth_admin executes it for every Auth path that runs the hook.
 * GoTrue's POST /admin/users does not run the hook, so service_role may
 * execute it too: a server route that creates accounts through the admin API
 * (Club Commander's public registration) asks it with the address its edge
 * observed before creating anything. No client may execute it, and the list is
 * closed to players and to the service role.
 *
 * WHAT IT DOES NOT CLAIM: a different address is not on the list, and the hook
 * is in force only while the project's Auth configuration names this function.
 *
 * Registry: docs/laws.d/a-banned-network-cannot-create-an-account.md
 */
import { describe, expect, it } from 'vitest';
import { functionBody, latestDeclaring, migrationFiles, readMigration } from './helpers/migrations';

const HOOK = 'fn_a_banned_network_cannot_create_an_account';
const TABLE = 'public.banned_signup_networks';
const INTRODUCED = '20261109235402_a_banned_network_cannot_create_an_account.sql';
const { name: MIGRATION, sql: SQL } = latestDeclaring(HOOK);

describe(`${HOOK} (in force: ${MIGRATION})`, () => {
  const body = functionBody(SQL, HOOK);

  it('reads the address Auth observed and refuses one inside a listed network', () => {
    expect(body).toContain("event -> 'metadata' ->> 'ip_address'");
    expect(body).toMatch(/v_address <<= b\.network/);
    expect(body).toMatch(/'http_code', 403/);
    expect(body).toMatch(/RETURN jsonb_build_object\('error'/);
  });

  it('allows a request whose address is missing or unreadable', () => {
    expect(body).toMatch(/EXCEPTION WHEN invalid_text_representation THEN\s+v_address := NULL;/);
    expect(body).toMatch(/IF v_address IS NOT NULL\s+AND EXISTS/);
    expect(body.trimEnd()).toMatch(/RETURN '\{\}'::jsonb;\s*END;?$/);
  });

  it('never raises: a refusal is an answer, and nothing else stops a signup', () => {
    expect(body).not.toMatch(/\bRAISE\b/i);
  });

  it('is executable by the Auth server and by no client', () => {
    expect(SQL).toContain(
      `REVOKE ALL ON FUNCTION public.${HOOK}(jsonb) FROM PUBLIC, anon, authenticated, service_role;`
    );
    expect(SQL).toContain(
      `GRANT EXECUTE ON FUNCTION public.${HOOK}(jsonb) TO supabase_auth_admin;`
    );
  });
});

describe('a server signup asks the same rule', () => {
  const GRANT = readMigration('20261110152816_a_server_signup_asks_the_banned_network_rule.sql');
  it('lets the service role ask, and never a client', () => {
    expect(GRANT).toContain(`GRANT EXECUTE ON FUNCTION public.${HOOK}(jsonb) TO service_role;`);
    for (const file of migrationFiles().filter((f) => f >= INTRODUCED)) {
      expect(readMigration(file), file).not.toMatch(
        new RegExp(
          `^\\s*GRANT[^;]*\\b${HOOK}\\b[^;]*\\bTO\\b[^;]*\\b(?:anon|authenticated|PUBLIC)\\b`,
          'im'
        )
      );
    }
  });
});

describe(`${TABLE} is closed`, () => {
  it('is born with row level security and no grant', () => {
    const born = readMigration(INTRODUCED);
    expect(born).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(born).toContain(
      `REVOKE ALL ON ${TABLE} FROM PUBLIC, anon, authenticated, service_role;`
    );
  });

  it('is never opened afterwards by a policy or a grant', () => {
    for (const file of migrationFiles().filter((f) => f >= INTRODUCED)) {
      const sql = readMigration(file);
      if (!sql.includes('banned_signup_networks')) continue;
      expect(sql, file).not.toMatch(/CREATE POLICY[^;]*\bON\s+public\.banned_signup_networks\b/i);
      expect(sql, file).not.toMatch(
        /GRANT[^;]*\bON\s+(?:TABLE\s+)?public\.banned_signup_networks\s+TO[^;]*\b(?:anon|authenticated|PUBLIC|service_role)\b/i
      );
    }
  });
});
