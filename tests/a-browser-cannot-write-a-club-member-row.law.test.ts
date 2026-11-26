/**
 * LAW - A BROWSER CANNOT WRITE A CLUB MEMBER ROW
 *
 * club_members carries every player's club chips (chip_balance, promo_balance,
 * held_chips, locked_chips), promo playthrough, diamonds and the commission and
 * rakeback columns. Joining, leaving, role changes, agreements and every chip
 * movement are SECURITY DEFINER RPCs, which run as their owner. The browser
 * roles held table-wide INSERT and UPDATE anyway, so the only thing between a
 * player and their own promo_playthrough_required or diamonds was a row policy
 * and a handful of current_user triggers. Migration
 * 20261126191556_the_browser_writes_no_club_member_row revokes the grant and
 * asserts it; this law keeps it revoked and keeps the client from writing the
 * table directly.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');
const strip = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const CLOSE = '20261126191556_the_browser_writes_no_club_member_row.sql';
// Source comments may describe the old write; only code counts.
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.(ts|tsx|js|jsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : []
  );
}

describe('LAW: a browser cannot write a club member row', () => {
  it('the closing migration revokes INSERT and UPDATE from every browser role and asserts it', () => {
    expect(files).toContain(CLOSE);
    const sql = strip(read(CLOSE));
    expect(sql).toMatch(
      /REVOKE INSERT, UPDATE ON TABLE public\.club_members FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toContain('a browser role can still write club_members');
    expect(sql).toContain('has_any_column_privilege');
    expect(sql).not.toMatch(/REVOKE\s+ALL/i);
    expect(read(CLOSE)).toMatch(/^-- @live-proof: /m);
  });

  it('nothing after the close grants a browser role a write on club_members', () => {
    const offenders = files
      .filter((f) => f > CLOSE)
      .filter((f) =>
        /GRANT\s+[^;]*\b(INSERT|UPDATE|ALL)\b[^;]*ON\s+(TABLE\s+)?public\.club_members\b[^;]*TO[^;]*\b(anon|authenticated|PUBLIC)\b/i.test(
          strip(read(f))
        )
      );
    expect(offenders).toEqual([]);
  });

  it('no browser source writes club_members directly', { timeout: 30_000 }, () => {
    const writers = walk(join(ROOT, 'src')).filter((f) =>
      /from\(\s*['"]club_members['"]\s*\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/.test(
        code(readFileSync(f, 'utf8'))
      )
    );
    expect(writers, 'membership and chips move only through the club RPCs').toEqual([]);
  });
});

describe('LAW: held and locked club chips never go below zero', () => {
  const FLOOR = files.find((f) =>
    /^\d{14}_club_member_held_and_locked_chips_never_go_below_zero\.sql$/.test(f)
  );

  it('a break-window migration adds validated zero floors and drops the dead browser policies', () => {
    expect(FLOOR).toBeDefined();
    const raw = read(FLOOR as string);
    expect(raw).toMatch(/^-- @install-window: daily-maintenance$/m);
    const sql = strip(raw);
    expect(sql).toMatch(
      /club_members_held_chips_nonneg CHECK \(held_chips IS NULL OR held_chips >= 0\)/
    );
    expect(sql).toMatch(
      /club_members_locked_chips_nonneg CHECK \(locked_chips IS NULL OR locked_chips >= 0\)/
    );
    expect(sql).not.toMatch(/NOT VALID/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Users can join clubs" ON public\.club_members;/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS club_members_update ON public\.club_members;/);
  });
});
