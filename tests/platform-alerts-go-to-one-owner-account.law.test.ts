/**
 * PLATFORM ALERTS GO TO ONE OWNER ACCOUNT (Dan, 2026-11-09).
 *
 * "My instruction is one recipient for important operational information:
 * daniel@bekavactrading.com. Other admin or god accounts must not become
 * required recipients simply because of their role."
 *
 * public.fn_is_platform_alert_recipient is the one predicate both delivery
 * guards read. Its newest definition across supabase/migrations must name
 * exactly the owner account, and the test fixture that mirrors it must agree.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const OWNER = '47965354-0e56-43ef-931c-ddaab82af765';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');
const DEF = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.fn_is_platform_alert_recipient\s*\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi;

const bodies = (sql: string) => [...code(sql).matchAll(DEF)].map((m) => m[1]);

describe('platform alerts go to one owner account', () => {
  it('the newest migration definition of the recipient predicate names only the owner account', () => {
    const files = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    const defining = files.filter((f) => bodies(readFileSync(join(MIGRATIONS, f), 'utf8')).length > 0);
    expect(defining.length).toBeGreaterThan(0);
    const newest = bodies(readFileSync(join(MIGRATIONS, defining[defining.length - 1]), 'utf8')).pop()!;
    expect([...new Set(newest.match(UUID) ?? [])].map((u) => u.toLowerCase())).toEqual([OWNER]);
  });

  it('the bug-report routing fixture mirrors the same single recipient', () => {
    const fixture = readFileSync(join(ROOT, 'tests/fixtures/bug-report-routing/bootstrap.sql'), 'utf8');
    const [body] = bodies(fixture);
    expect([...new Set(body.match(UUID) ?? [])].map((u) => u.toLowerCase())).toEqual([OWNER]);
  });
});
