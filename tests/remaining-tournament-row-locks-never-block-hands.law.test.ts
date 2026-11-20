import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/*
 * Owner rules: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION"
 * (Dan, 2026-08-30); "i just don't want any 'un intended delays'"
 * (Dan, 2026-11-18). Incident 075013fd, lag-finish lane 6.
 *
 * Migration 20261119181500 (#11437 / #11451) already downgraded
 * fn_sweep_pending_tournament_bounties (a0c5e323a496d8630894d1cb4866c76b)
 * and fn_move_tournament_player (272f9aeeee9ba5a63069b54ff565f1ba) to
 * FOR NO KEY UPDATE on public.tournaments.
 *
 * Four remaining shared-lane paths still took FOR UPDATE (3) or FOR SHARE (1):
 *   - fn_register_for_tournament_before_atomic_capacity_20260907
 *   - fn_register_horse_for_tournament_before_maintenance_gate
 *   - trg_refuse_finalized_tournament_entry
 *   - fn_terminal_tournament_seat_is_immutable (BEFORE INSERT FOR SHARE on tournaments & tables)
 *
 * Migration 20261119185300 requires 20261119181500's post-images for sweep &
 * move, downgrades the 3 remaining FOR UPDATE locks to FOR NO KEY UPDATE
 * (none updates any primary or unique key column on public.tournaments), and
 * downgrades the 1 FOR SHARE BEFORE INSERT guard to FOR KEY SHARE. Executed
 * natively on PostgreSQL by
 * scripts/ci/test-remaining-tournament-row-locks-never-block-hands.py.
 */
const file = '20261119185300_remaining_tournament_row_locks_never_block_hands.sql';
const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const fixtures: { functions: Array<{ signature: string; md5: string; definition: string }> } =
  JSON.parse(
    readFileSync('scripts/ci/fixtures/remaining-tournament-row-locks/preimages.json', 'utf8')
  );
const harness = readFileSync(
  'scripts/ci/test-remaining-tournament-row-locks-never-block-hands.py',
  'utf8'
);
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

const NO_KEY_UPDATE_WRITERS = [
  'public.fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)',
  'public.fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)',
  'public.trg_refuse_finalized_tournament_entry()',
];
const REQUIRED_20261119181500 = [
  ['public.fn_sweep_pending_tournament_bounties(uuid,integer)', 'a0c5e323a496d8630894d1cb4866c76b'],
  [
    'public.fn_move_tournament_player(uuid,uuid,uuid,uuid,integer,uuid,text)',
    '272f9aeeee9ba5a63069b54ff565f1ba',
  ],
] as const;
const IMMUTABLE_SEAT_GUARD = 'public.fn_terminal_tournament_seat_is_immutable()';

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

describe('Remaining tournament row locks never block hands', () => {
  it('is one bounded function-only transaction requiring 20261119181500 with @live-proof for all 4 rewritten post-images', () => {
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).not.toMatch(
      /@install-window|LOCK TABLE|ALTER TABLE|CREATE INDEX|CREATE TABLE/
    );
    const reqBlock = migration.match(/DO \$requires\$([\s\S]*?)END \$requires\$;/)![1];
    for (const [sig, hash] of REQUIRED_20261119181500) {
      expect(reqBlock).toContain(sig);
      expect(reqBlock).toContain(hash);
      const fixture = fixtures.functions.find((f) => f.signature === sig)!;
      expect(fixture.md5).toBe(hash);
      expect(md5(fixture.definition)).toBe(hash);
    }
    const imgs = postImages();
    expect(imgs.size).toBe(4);
    const liveProof = migration.match(/^-- @live-proof: (.+)$/m)![1];
    for (const [, { post }] of imgs) {
      expect(liveProof).toContain(post);
    }
  });

  it('downgrades all 3 remaining shared-lane tournament row writers from FOR UPDATE to FOR NO KEY UPDATE', () => {
    const imgs = postImages();
    for (const sig of NO_KEY_UPDATE_WRITERS) {
      const body = imgs.get(sig)!.body;
      expect(body, `${sig} should take FOR NO KEY UPDATE on tournaments`).toMatch(
        /FROM (?:public\.)?tournaments\b[\s\S]{0,120}FOR NO KEY UPDATE;/
      );
      expect(body, `${sig} must not take FOR UPDATE on tournaments`).not.toMatch(
        /FROM (?:public\.)?tournaments\b[\s\S]{0,120}FOR UPDATE;/
      );
    }
  });

  it('downgrades fn_terminal_tournament_seat_is_immutable BEFORE INSERT branch from FOR SHARE to FOR KEY SHARE', () => {
    const imgs = postImages();
    const body = imgs.get(IMMUTABLE_SEAT_GUARD)!.body;
    expect(body).toMatch(
      /FROM public\.tournaments t\s+WHERE t\.id = v_new_tournament_id\s+FOR KEY SHARE;/
    );
    expect(body).toMatch(
      /FROM public\.tables tb\s+WHERE tb\.id = NEW\.table_id\s+AND tb\.tournament_id = v_new_tournament_id\s+FOR KEY SHARE;/
    );
    expect(body).not.toMatch(/FOR SHARE;/);
  });

  it('proves before/after non-blocking behavior and safety invariants on native PostgreSQL and is wired into CI', () => {
    expect(harness).toContain('20261119185300_');
    for (const proof of [
      'BEFORE: trg_refuse_finalized_tournament_entry blocks hand commit FOR KEY SHARE',
      'BEFORE: fn_terminal_tournament_seat_is_immutable FOR SHARE blocks pool writer FOR NO KEY UPDATE',
      'BEFORE: human register FOR UPDATE blocks hand commit FOR KEY SHARE',
      'BEFORE: horse register FOR UPDATE blocks hand commit FOR KEY SHARE',
      'PREREQ 20261119181500: fn_sweep_pending_tournament_bounties FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE',
      'AFTER: trg_refuse_finalized_tournament_entry + non-key UPDATE does NOT block hand commit FOR KEY SHARE',
      'AFTER: fn_terminal_tournament_seat_is_immutable FOR KEY SHARE does NOT block pool writer FOR NO KEY UPDATE',
      'AFTER: human register FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE',
      'AFTER: horse register FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE',
      'AFTER: fn_sweep_pending_tournament_bounties FOR NO KEY UPDATE does NOT block hand commit FOR KEY SHARE',
      'AFTER: fn_move_tournament_player locks public.tournaments FOR NO KEY UPDATE, never FOR UPDATE',
      'SAFETY: lifecycle FOR UPDATE still blocks hand commit FOR KEY SHARE',
      'SAFETY: lifecycle FOR UPDATE still blocks seat INSERT FOR KEY SHARE',
      'SAFETY: lifecycle FOR UPDATE still blocks trg_refuse_finalized_tournament_entry FOR NO KEY UPDATE',
      'SAFETY: finalized tournament still refuses new entry via trg_refuse_finalized_tournament_entry',
      'SAFETY: completed tournament still refuses new seat via fn_terminal_tournament_seat_is_immutable',
      'SAFETY: concurrent FOR NO KEY UPDATE pool writers serialize',
    ]) {
      expect(harness).toContain(proof);
    }
    const workflow = readFileSync('.github/workflows/tournament-event-lane.yml', 'utf8');
    expect(workflow).toContain(`supabase/migrations/${file}`);
    expect(workflow).toContain('scripts/ci/fixtures/remaining-tournament-row-locks/**');
    expect(workflow).toContain(
      'python3 scripts/ci/test-remaining-tournament-row-locks-never-block-hands.py'
    );
  });
});
