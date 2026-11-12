/**
 * LAW - A CERTIFICATION IDENTITY IS NEVER LISTED TO A PERSON
 *
 * Dan, 2026-10-26 and again 2026-11-12: no PostDeploy accounts in his Player
 * Management. Both times the accounts were settled out of KINGS CLUB by a
 * migration and both times they came back, because the certification fleet
 * fixtures KINGS CLUB and joins a reserved identity to the club for the minutes
 * a certificate runs, and the agent certificates then read the roster AS that
 * identity and assert it is listed.
 *
 * The fix is at the roster's source, not in a client filter: the roster
 * reader, the summary counts and the live-seats reader skip a reserved
 * certification identity (auth.users email in the certification namespace)
 * unless the viewer is the service role or is itself a reserved identity. So a
 * certificate still sees everything it asserts and a person never sees a
 * certification robot in a club.
 *
 * This is not a horse filter (CLAUDE.md 10.5). Horses are players and are
 * never named here; the predicate names only the certification fleet's own
 * reserved identities.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const NAME = '20261112231056_a_certification_identity_is_never_listed_to_a_person.sql';
const VERSION = NAME.slice(0, 14);
const sql = readFileSync(join(MIGRATIONS, NAME), 'utf8');

const PREDICATE = 'ca_is_reserved_certification_identity';
const VIEWER = 'ca_viewer_sees_certification_identities';
const READERS = ['ca_club_roster_rows', 'ca_club_members_summary', 'ca_club_live_seats'];

describe('A certification identity is never listed to a person', () => {
  it('names the certification namespace and nothing else', () => {
    expect(sql).toContain(
      "au.email ~* '^(ca-customization-cert-postdeploy-|club-create-cert-).*\\.invalid$'"
    );
    // Never a horse: the predicate reads auth.users email only.
    const body = sql.slice(
      sql.indexOf(`FUNCTION public.${PREDICATE}`),
      sql.indexOf('$$;', sql.indexOf(`FUNCTION public.${PREDICATE}`))
    );
    expect(body).not.toMatch(/is_horse|is_bot|horse/i);
    expect(sql).not.toMatch(/is_horse/);
  });

  it('shows the identities to the service role and to a reserved viewer only', () => {
    expect(sql).toContain(`FUNCTION public.${VIEWER}()`);
    expect(sql).toContain("coalesce(auth.role(), 'service_role') = 'service_role'");
    expect(sql).toContain(`auth.uid() IS NOT NULL AND public.${PREDICATE}(auth.uid())`);
  });

  it('patches every roster reader against its recorded preimage', () => {
    expect(sql).toContain("pg_get_functiondef('public.ca_club_roster_rows(uuid)'::regprocedure)");
    expect(sql).toContain("pg_get_functiondef('public.ca_club_members_summary(uuid)'::regprocedure)");
    expect(sql).toMatch(/md5\(original\) <> '43ad1d54271354bf6d47378d1fe8b139'/);
    expect(sql).toMatch(/md5\(original\) <> '778c38861d39d8847e2f7697a0f1d216'/);
    expect(sql).toContain(
      `AND (v_sees_certification OR NOT public.${PREDICATE}(cm.user_id))`
    );
    expect(sql).toContain(`FUNCTION public.ca_club_live_seats(p_club_id uuid)`);
    expect(sql).toContain(`AND (v_sees_certification OR NOT public.${PREDICATE}(l.uid))`);
  });

  it('is DDL in one transaction and never rewrites a member row', () => {
    expect(sql.trim().startsWith('--')).toBe(true);
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+public\./i);
    expect(sql).toContain('@live-proof:');
  });

  it('a later redefinition of a roster reader keeps the rule', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f.slice(0, 14) > VERSION)
      .sort();
    for (const file of later) {
      const text = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const reader of READERS) {
        const redefines = new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${reader}\\s*\\(`,
          'i'
        ).test(text);
        if (!redefines) continue;
        expect(
          text.includes(PREDICATE),
          `${file} redefines ${reader} without ${PREDICATE}: a person would see the certification fleet again`
        ).toBe(true);
      }
    }
  });
});
