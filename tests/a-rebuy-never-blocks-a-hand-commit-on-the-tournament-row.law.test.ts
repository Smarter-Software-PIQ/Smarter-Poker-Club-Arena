import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rules: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION"
 * (Dan, 2026-08-30); "i just don't want any 'un intended delays'"
 * (Dan, 2026-11-18). Incident 075013fd, lag-finish lane 3.
 *
 * Migration 20261119181500 (#11437) moved fn_ca_commit_hand_settlement_exact_
 * before_obligations to FOR KEY SHARE and 17 shared-lane writers to FOR NO KEY
 * UPDATE, leaving two functions on the old conflicting locks:
 *   1. public.fn_ca_retain_hand_submission(jsonb) still locked
 *      public.tournaments FOR SHARE.
 *   2. public.fn_claim_bounty_legacy_candidate_20260907(...) still locked
 *      public.tournaments FOR UPDATE (called by every still-open bounty rebuy).
 *
 * Migration 20261119175856 requires 20261119181500 and closes both remaining
 * gaps cleanly. Executed natively on PostgreSQL by
 * scripts/ci/test-a-rebuy-never-blocks-a-hand-commit-on-the-tournament-row.py.
 */
const file = '20261119175856_a_rebuy_never_blocks_a_hand_commit_on_the_tournament_row.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(readFileSync('scripts/ci/fixtures/rebuy-off-tournament-row/preimages.json', 'utf8'));
const harness = readFileSync(
  'scripts/ci/test-a-rebuy-never-blocks-a-hand-commit-on-the-tournament-row.py',
  'utf8'
);
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const HAND_RETAIN = 'public.fn_ca_retain_hand_submission(jsonb)';
const BOUNTY_CLAIM =
  'public.fn_claim_bounty_legacy_candidate_20260907(uuid,uuid,integer,numeric,uuid,uuid,bigint,timestamp with time zone,uuid,jsonb,numeric,boolean)';

function postImages() {
  const block = migration.match(/DO \$subs\$([\s\S]*?)END \$subs\$;/)![1];
  const re =
    /\('((?:public|smarter_private)\.[^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*ARRAY\[([\s\S]*?)\],\s*ARRAY\[([\s\S]*?)\]\)/g;
  const quoted = (s: string, tag: string) =>
    [...s.matchAll(new RegExp(`\\$(${tag}[0-9a-z]+)\\$([\\s\\S]*?)\\$\\1\\$`, 'g'))].map(
      (m) => m[2]
    );
  const out = new Map<string, { pre: string; post: string; body: string }>();
  for (const m of block.matchAll(re)) {
    const [, sig, pre, post, oldArr, newArr] = m;
    const fixture = fixtures.functions.find((f) => f.signature === sig)!;
    expect(fixture, `missing fixture for ${sig}`).toBeDefined();
    expect(md5(fixture.definition)).toBe(fixture.md5);
    expect(fixture.md5).toBe(pre);
    const olds = quoted(oldArr, 'o');
    const news = quoted(newArr, 'n');
    expect(olds.length).toBeGreaterThan(0);
    expect(olds.length).toBe(news.length);
    let def = fixture.definition;
    olds.forEach((old, i) => {
      expect(def.split(old).length - 1, `${sig} anchor ${i + 1}`).toBe(1);
      def = def.replace(old, () => news[i]);
    });
    expect(md5(def), `${sig} post-image md5`).toBe(post);
    out.set(sig, { pre, post, body: def });
  }
  return out;
}

describe('A rebuy never blocks a hand commit on the tournament row', () => {
  it('is one bounded function-only transaction requiring 20261119181500 with @live-proof for both post-images', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    expect(migration).toContain("'95863075b8d44c6177dd893c946cd1b4'");
    expect(migration).toContain('20261119181500 must be installed first');
    const imgs = postImages();
    expect(imgs.size).toBe(2);
    const liveProof = migration.match(/^-- @live-proof: (.+)$/m)![1];
    for (const [, { post }] of imgs) {
      expect(liveProof).toContain(post);
    }
  });

  it('hand retain locks public.tournaments FOR KEY SHARE, never FOR SHARE', () => {
    const imgs = postImages();
    const retainBody = imgs.get(HAND_RETAIN)!.body;
    expect(retainBody).toContain('FROM public.tournaments WHERE id=tour FOR KEY SHARE;');
    expect(retainBody).not.toContain('FROM public.tournaments WHERE id=tour FOR SHARE;');
  });

  it('bounty legacy claim locks public.tournaments FOR NO KEY UPDATE, never FOR UPDATE', () => {
    const imgs = postImages();
    const claimBody = imgs.get(BOUNTY_CLAIM)!.body;
    expect(claimBody).toMatch(
      /FROM public\.tournaments t\s+WHERE t\.id=p_tournament_id FOR NO KEY UPDATE;/
    );
    expect(claimBody).not.toMatch(
      /FROM public\.tournaments t\s+WHERE t\.id=p_tournament_id FOR UPDATE;/
    );
  });

  it('proves before/after non-blocking behavior and safety invariants on native PostgreSQL and is wired into CI', () => {
    expect(harness).toContain('20261119175856_');
    for (const proof of [
      'BEFORE: hand commit on unrelated Table B waited behind bounty-claim FOR UPDATE',
      'BEFORE: hand retain on unrelated Table B waited behind rebuy FOR NO KEY UPDATE',
      'AFTER: hand commit on unrelated Table B does NOT wait',
      'AFTER: hand retain on unrelated Table B does NOT wait',
      'SAFETY: lifecycle FOR UPDATE still blocks hand commit',
      'SAFETY: lifecycle FOR UPDATE still blocks rebuy FOR NO KEY UPDATE',
      'SAFETY: concurrent pool writers serialize',
      'SAFETY: same-table hand commit vs rebuy serializes cleanly with 0 deadlocks',
    ]) {
      expect(harness).toContain(proof);
    }
    const workflow = readFileSync('.github/workflows/tournament-event-lane.yml', 'utf8');
    expect(workflow).toContain(`supabase/migrations/${file}`);
    expect(workflow).toContain('scripts/ci/fixtures/rebuy-off-tournament-row/**');
    expect(workflow).toContain(
      'python3 scripts/ci/test-a-rebuy-never-blocks-a-hand-commit-on-the-tournament-row.py'
    );
  });
});
