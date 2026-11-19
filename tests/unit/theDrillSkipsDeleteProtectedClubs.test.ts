/**
 * THE DRILL SKIPS DELETE-PROTECTED CLUBS (2026-11-19, incident 316ed735).
 *
 * 20261119171234 let the weekly alarm drill choose its club. KINGS CLUB had no
 * eligible house horse, so the first club by id was Deep Stack Society, whose
 * club_members rows carry trg_deep_stack_members_are_protected. Arm 7
 * (delete_journals_burn) deletes the subject's row, so the guard refused it
 * before the detector was asked and the drill could not arm. The subject must
 * come from a club no BEFORE DELETE trigger on club_members names.
 *
 * The newest migration that defines fn_ca_alarm_drill is the one production
 * runs, so this law reads that one: a later redefinition that drops the
 * exclusion fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'supabase/migrations');
const HEAD = 'CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill()';

const newest = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => readFileSync(join(DIR, f), 'utf8').includes(HEAD))
  .pop()!;
const sql = readFileSync(join(DIR, newest), 'utf8');
const start = sql.indexOf(HEAD);
const drill = sql.slice(start, sql.indexOf('$function$;', start));
const choice = drill.slice(
  drill.indexOf('INTO c_midway_club, c_cert_user'),
  drill.indexOf('LIMIT 1;', drill.indexOf('INTO c_midway_club, c_cert_user'))
);

describe('the drill skips delete-protected clubs', () => {
  it('is defined no earlier than the fix', () => {
    expect(newest >= '20261119183127').toBe(true);
  });

  it('chooses its subject from a club no BEFORE DELETE trigger on club_members names', () => {
    expect(choice).toContain('AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t');
    expect(choice).toContain("t.tgrelid = 'public.club_members'::regclass");
    expect(choice).toContain('NOT t.tgisinternal');
    expect(choice).toContain("t.tgenabled <> 'D'");
    expect(choice).toContain('(t.tgtype & 8) <> 0');
    expect(choice).toContain("pg_catalog.pg_get_triggerdef(t.oid) LIKE '%' || cm.club_id::text || '%'");
  });

  it('never turns the Deep Stack teardown switch on to get its delete through', () => {
    expect(drill).not.toContain('app.deep_stack_teardown');
  });

  it('still drills the burn on delete, and keeps its choice repeatable and in scope', () => {
    expect(drill).toContain("'check','delete_journals_burn'");
    expect(choice).toContain('public.fn_ca_is_midway_scope(NULL, cm.club_id, NULL, NULL, NULL)');
    expect(choice).toMatch(/ORDER BY \(cm\.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'\) DESC, cm\.club_id, cm\.user_id/);
  });

  it('is single-transaction, exempt from the install probe, and service_role only', () => {
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(sql).toMatch(/^-- @probe-exempt: public\.fn_ca_alarm_drill /m);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.fn_ca_alarm_drill() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_ca_alarm_drill() TO service_role;');
  });
});
