/**
 * ===========================================================================
 *  LAW: A SIGNED-OUT OPEN OF A SHARED HAND IS COUNTED, AND NOTHING A CALLER
 *  WITH NO ACCOUNT CAN RUN WRITES THE COUNT
 * ===========================================================================
 *
 * Migration 20261126054024 (issue #9828) made fn_ca_shared_hand_open a pure
 * read and fn_ca_shared_hand_count_view the only writer of view_count,
 * executable by authenticated and service_role only. Signed-out opens then
 * went uncounted. They are counted again by World Hub's server route
 * POST /api/club-arena/shared-hand-view, which calls the writer with the
 * service role (Smarter-Poker-World-Hub, src/lib/sharedHandView.js).
 *
 * This law fails the build if:
 *  - the client ever reaches the counter RPC while signed out, or counts a
 *    signed-in open through World Hub as well (a double count);
 *  - the signed-out path sends an Authorization header (the route refuses to
 *    count those, so the view would silently vanish);
 *  - any migration from 20261126054024 on makes a shared-hand writer
 *    anon-executable, or grants the counter to anon or PUBLIC.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  anonExecutableWriters,
  stripComments,
} from '../scripts/ci/check-definer-authorization.mjs';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

const SERVICE_PATH = 'src/services/SharedHandLinkService.ts';
const SERVICE = stripTs(read(SERVICE_PATH));
const countFn = (() => {
  const start = SERVICE.indexOf('export async function countSharedHandView');
  const end = SERVICE.indexOf('\nexport ', start + 10);
  return SERVICE.slice(start, end);
})();

describe('the client counts every real open exactly once', () => {
  it('the counter RPC is named in exactly one place in the client', () => {
    const callers = walk('src').filter((p) =>
      /\.rpc\(\s*['"]fn_ca_shared_hand_count_view['"]/.test(stripTs(read(p)))
    );
    expect(callers).toEqual([SERVICE_PATH]);
    expect(SERVICE.match(/fn_ca_shared_hand_count_view/g)).toHaveLength(1);
  });

  it('the RPC is reached only inside the signed-in branch, which returns before posting', () => {
    const signedIn = countFn.match(/if \(hasLocalSession\(\)\) \{([\s\S]*?)\n {4}\}/);
    expect(signedIn).not.toBeNull();
    expect(signedIn![1]).toContain(
      "supabase.rpc('fn_ca_shared_hand_count_view', { p_token: valid })"
    );
    expect(signedIn![1]).toMatch(/return;\s*$/);
    expect(signedIn![1]).not.toMatch(/fetch\(/);
    const signedOut = countFn.slice(countFn.indexOf(signedIn![0]) + signedIn![0].length);
    expect(signedOut).not.toMatch(/\.rpc\(/);
    expect(signedOut).toMatch(/await fetch\(new URL\(SIGNED_OUT_VIEW_PATH, publicOrigin\(\)\)/);
  });

  it('the signed-out post goes to the World Hub route, without an Authorization header', () => {
    expect(SERVICE).toContain(
      "export const SIGNED_OUT_VIEW_PATH = '/api/club-arena/shared-hand-view';"
    );
    expect(countFn).not.toMatch(/authorization|Bearer|access_token|getSession/i);
    expect(countFn).toMatch(/credentials: 'omit'/);
    expect(countFn).toMatch(/\} catch \{/);
  });

  it('opening never waits on the count', () => {
    expect(SERVICE).toMatch(/void countSharedHandView\(valid\);/);
    expect(SERVICE).not.toMatch(/await countSharedHandView/);
  });
});

describe('nothing anon-executable writes the count', () => {
  const FROM = '20261126054024';
  const migrations = fs
    .readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql') && f.slice(0, 14) >= FROM)
    .map((f) => ({ f, sql: read(`supabase/migrations/${f}`) }));

  it('reads the migrations it guards', () => {
    expect(migrations.map((m) => m.f)).toContain(
      '20261126054024_a_shared_hand_link_reads_without_writing.sql'
    );
  });

  it('no migration that touches shared hands declares an anon-executable writer', () => {
    for (const { f, sql } of migrations.filter((m) => /ca_shared_hand/.test(m.sql))) {
      expect(anonExecutableWriters(sql), f).toEqual([]);
    }
  });

  it('the counter is never granted to anon or PUBLIC', () => {
    for (const { f, sql } of migrations) {
      const grants = stripComments(sql).match(
        /GRANT\s+(?:EXECUTE|ALL)[^;]*fn_ca_shared_hand_count_view[^;]*;/gi
      );
      for (const g of grants ?? []) {
        const to = g.slice(g.search(/\bTO\b/i));
        expect(to, `${f}: ${g}`).not.toMatch(/\b(anon|PUBLIC)\b/i);
      }
    }
  });
});
