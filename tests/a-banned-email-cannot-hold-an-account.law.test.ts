/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A BANNED EMAIL CANNOT HOLD AN ACCOUNT (2026-11-09, binding)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The owner removed a player from the platform and ordered that the same
 * mailbox never open another account. Closing an account does not do that: the
 * closed login is gone, but nothing stopped the same address signing up again
 * a minute later, by email, by a provider login or by changing another
 * account's email to it.
 *
 * THE LAW: a mailbox listed in public.banned_signup_emails cannot become the
 * email of any auth.users row. The gate is a BEFORE INSERT OR UPDATE OF email
 * trigger on auth.users, so every door that creates an account or changes its
 * email meets it. One mailbox has one key: case, a +tag and Gmail dots do not
 * make a new person. The list itself is closed to anon and authenticated.
 *
 * WHAT IT DOES NOT CLAIM: a different mailbox is a different key. This law
 * stops a known address returning; it cannot recognise a person.
 *
 * Registry: docs/laws.d/a-banned-email-cannot-hold-an-account.md
 */
import { describe, expect, it } from 'vitest';
import { functionBody, latestDeclaring, migrationFiles, readMigration } from './helpers/migrations';

const GATE = 'fn_a_banned_email_cannot_hold_an_account';
const KEY = 'fn_signup_email_key';
const TABLE = 'public.banned_signup_emails';
const INTRODUCED = '20261109224452_a_banned_email_cannot_hold_an_account.sql';
const { name: MIGRATION, sql: SQL } = latestDeclaring(GATE);

describe(`${GATE} (in force: ${MIGRATION})`, () => {
  it('fires before an account is born and before its email changes', () => {
    expect(SQL).toMatch(
      /CREATE TRIGGER a_banned_email_cannot_hold_an_account\s+BEFORE INSERT OR UPDATE OF email ON auth\.users\s+FOR EACH ROW EXECUTE FUNCTION public\.fn_a_banned_email_cannot_hold_an_account\(\);/
    );
  });

  it('refuses by the mailbox key and never swallows its own refusal', () => {
    const body = functionBody(SQL, GATE);
    expect(body).toMatch(/b\.email_key = public\.fn_signup_email_key\(NEW\.email\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'SIGNUP_BANNED:[^']*'\s+USING ERRCODE = '42501'/);
    // handle_new_user catches every error so a signup is never lost; this gate
    // must do the opposite, or a banned mailbox signs up and nothing says so.
    expect(body).not.toMatch(/\bEXCEPTION\s+WHEN\b/i);
  });

  it('lets a row with no email, or an update that keeps its email, through', () => {
    const body = functionBody(SQL, GATE);
    expect(body).toMatch(/IF NEW\.email IS NULL THEN\s+RETURN NEW;/);
    expect(body).toMatch(
      /IF TG_OP = 'UPDATE' AND NEW\.email IS NOT DISTINCT FROM OLD\.email THEN\s+RETURN NEW;/
    );
  });
});

describe(`${KEY}: one mailbox, one key`, () => {
  const key = functionBody(latestDeclaring(KEY).sql, KEY);

  it('folds case, a +tag and Gmail dots, and googlemail.com into gmail.com', () => {
    expect(key).toContain("IN ('gmail.com', 'googlemail.com')");
    expect(key).toContain(
      "replace(split_part(lower(btrim(split_part(p_email, '@', 1))), '+', 1), '.', '') || '@gmail.com'"
    );
  });

  it('keeps the dots of every other provider, where they are part of the address', () => {
    expect(key).toContain("ELSE split_part(lower(btrim(split_part(p_email, '@', 1))), '+', 1)");
  });
});

describe(`${TABLE} is closed to players`, () => {
  it('is born with row level security and no grant to anon or authenticated', () => {
    const born = readMigration(INTRODUCED);
    expect(born).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(born).toContain(`REVOKE ALL ON ${TABLE} FROM PUBLIC, anon, authenticated;`);
  });

  it('is never opened afterwards by a policy or a grant', () => {
    const later = migrationFiles().filter((file) => file >= INTRODUCED);
    expect(later).toContain(INTRODUCED);
    for (const file of later) {
      const sql = readMigration(file);
      if (!sql.includes('banned_signup_emails')) continue;
      expect(sql, file).not.toMatch(/CREATE POLICY[^;]*\bON\s+public\.banned_signup_emails\b/i);
      expect(sql, file).not.toMatch(
        /GRANT[^;]*\bON\s+(?:TABLE\s+)?public\.banned_signup_emails\s+TO[^;]*\b(?:anon|authenticated|PUBLIC)\b/i
      );
      expect(sql, file).not.toMatch(
        /ALTER TABLE\s+public\.banned_signup_emails\s+DISABLE ROW LEVEL SECURITY/i
      );
    }
  });
});
