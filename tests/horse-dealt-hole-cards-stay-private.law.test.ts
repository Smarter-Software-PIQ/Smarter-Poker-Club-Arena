/**
 * ===========================================================================
 *  LAW: A HORSE'S DEALT HOLE CARDS ARE KEPT, AND NO PLAYER CAN EVER READ THEM
 * ===========================================================================
 *
 * Dan 2026-11-19 ordered every Horse decision on every street audited, and
 * an audit needs the Horse's cards. Migration 20261120014240 keeps every
 * Horse's own dealt cards for every hand in
 * smarter_private.horse_dealt_hole_cards. A Horse's UNSHOWN cards in a
 * player's hands would be a cheating vector, so this law pins the other side:
 *
 *   1. Only the files that write, prove or declare the table name it. No
 *      client code, edge function, server read path, view, replay, rabbit
 *      hunt or realtime channel does.
 *   2. The migration gives the table RLS with no policy, revokes PUBLIC,
 *      anon and authenticated, grants service_role SELECT only, and creates
 *      no view, policy or publication entry for it.
 *   3. The payload key that carries the cards (stats_facts.horse_hole_cards)
 *      is built in exactly one place, from roster entries flagged as Horses,
 *      and nothing else in the server or the client reads it.
 *
 * The native proof (privileges enforced, a human named in the payload is
 * never kept) is scripts/ci/test-horse-dealt-hole-cards.py.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..');
const MIGRATION =
  'supabase/migrations/20261120014240_every_horse_dealt_hole_cards_are_kept_for_audit.sql';
const sql = readFileSync(resolve(ROOT, MIGRATION), 'utf8');
const code = sql
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('--'))
  .join('\n');

function filesNaming(needle: string): string[] {
  const r = spawnSync('git', ['grep', '-l', '-F', needle, '--', '.'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr);
  return r.stdout.split('\n').filter(Boolean).sort();
}

describe("LAW: a Horse's dealt hole cards are kept and never reach a player", () => {
  it('names the table only where it is written, proven or declared', () => {
    expect(filesNaming('horse_dealt_hole_cards')).toEqual(
      [
        MIGRATION,
        'docs/laws.d/tests-horse-dealt-hole-cards-stay-private.md',
        // the generated list of files the accounting harnesses read (it lists the migration's path)
        'scripts/ci/accounting-harness-reads.json',
        'scripts/ci/schema-manifest.d/horse-dealt-hole-cards.json',
        'scripts/ci/test-horse-dealt-hole-cards.py',
        'server/src/services/supabase/handFacts.ts',
        'tests/horse-dealt-hole-cards-stay-private.law.test.ts',
      ].sort()
    );
    // handFacts.ts names it only in the comment explaining where the cards go.
    const facts = readFileSync(resolve(ROOT, 'server/src/services/supabase/handFacts.ts'), 'utf8');
    expect(facts).not.toMatch(/from\(['"`][^'"`]*horse_dealt_hole_cards/);
    expect(facts).not.toMatch(/rpc\(['"`][^'"`]*horse_dealt_hole_cards/);
  });

  it('keeps the table service-role only: RLS, no policy, no client grant, no view or publication', () => {
    expect(code).toMatch(/CREATE TABLE smarter_private\.horse_dealt_hole_cards \(/);
    expect(code).toContain(
      'ALTER TABLE smarter_private.horse_dealt_hole_cards ENABLE ROW LEVEL SECURITY;'
    );
    expect(code).toContain(
      'REVOKE ALL ON smarter_private.horse_dealt_hole_cards FROM PUBLIC, anon, authenticated, service_role;'
    );
    expect(code).toContain(
      'GRANT SELECT ON smarter_private.horse_dealt_hole_cards TO service_role;'
    );
    expect(code).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i);
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i);
    expect(code).not.toMatch(/CREATE\s+POLICY/i);
    expect(code).not.toMatch(/PUBLICATION/i);
    // Writer and pruner run only inside the definer projector and pg_cron.
    for (const fn of [
      'smarter_private.project_horse_dealt_hole_cards(uuid, jsonb, uuid)',
      'smarter_private.prune_horse_dealt_hole_cards(integer)',
    ])
      expect(code).toContain(
        `REVOKE ALL ON FUNCTION ${fn}\n  FROM PUBLIC, anon, authenticated, service_role;`
      );
    // The database itself decides who is a Horse, not the payload.
    expect(code).toContain(
      "JOIN public.profiles pr ON pr.id = (e->>'user_id')::uuid AND pr.is_horse IS TRUE"
    );
  });

  it('builds the payload key once, from Horses only, and nothing else reads it', () => {
    const facts = readFileSync(resolve(ROOT, 'server/src/services/supabase/handFacts.ts'), 'utf8');
    expect(facts).toContain('roster.filter((p) => p.isHorse === true)');
    expect(facts).toContain('payload.horse_hole_cards = horseHoleCards;');
    // Code that runs: the client, the server, edge functions. Tests, docs,
    // the migration and its native proof only describe it.
    const readers = filesNaming('horse_hole_cards').filter(
      (f) => /^(src|server\/src|supabase\/functions)\//.test(f) && !/\.test\.ts$/.test(f)
    );
    expect(readers).toEqual(['server/src/services/supabase/handFacts.ts']);
  });
});
