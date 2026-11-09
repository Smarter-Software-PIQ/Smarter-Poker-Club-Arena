/**
 * LAW: a superseded migration that never installed leaves the active chain.
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-11-09. The BBJ sweep-wording change merged three times:
 *
 *   20261109010948 (#10142)  REFUSED at install twice, 25P04 transaction
 *                            timeout on UPDATE public.union_wallet_transactions;
 *                            nothing applied, no schema_migrations row.
 *   20261109064934 (#10148)  REFUSED at install the same way.
 *   20261109073642 (#10150)  INSTALLED (production schema_migrations row
 *                            20261109073642 the_bbj_promo_sweep_label_states_
 *                            the_allocation_actually_use).
 *
 * The first two carried "-- SUPERSEDED BY 20261109073642", which the ledger
 * checks and the applier honour. The daily engine selector does not, and must
 * not learn to: its contents guard (server/scripts/engine-release-installed-
 * migrations.py required_by) requires every ordinary file the candidate adds
 * under supabase/migrations/ to be installed, so a file that is superseded and
 * never ran made every candidate after #10142 unselectable.
 *
 * The disposition is the repository's own for never-installed migrations
 * (supabase/retired-unapplied/, as for the Stage-B chain): the exact bytes
 * move out of the active chain into the archive and are sealed here by
 * sha256. Nothing is deleted, no installed migration changes, and neither file
 * can be dispatched or replayed against the rows 20261109073642 already
 * relabelled. The superseding file must stay active, so the change itself is
 * never lost from a rebuild.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const active = resolve(root, 'supabase/migrations');
const archive = resolve(root, 'supabase/retired-unapplied');
const manifestPath = resolve(archive, 'SUPERSEDED-UNINSTALLED.sha256');

const SLUG = 'the_bbj_promo_sweep_label_states_the_allocation_actually_use.sql';
const SUPERSEDING = `20261109073642_${SLUG}`;
const retired = new Map([
  [`20261109010948_${SLUG}`, 'b2738e7821837de09802c197eca559c0edf0213694e27ad5ce70dd0e2569f6c3'],
  [`20261109064934_${SLUG}`, '013f461a611b0ff9c81b840cd533fc1a38cb4e1768bab25791d4536aa99f1e0e'],
] as const);

const manifest = new Map(
  readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}([^/]+\.sql)$/.exec(line);
      if (!match) throw new Error(`invalid superseded-uninstalled manifest row: ${line}`);
      return [match[2], match[1]] as const;
    })
);

describe('a superseded migration that never installed leaves the active chain', () => {
  it('keeps each retired file byte-sealed in the archive and out of supabase/migrations', () => {
    expect([...manifest.keys()].sort()).toEqual([...retired.keys()].sort());
    for (const [file, sha] of retired) {
      expect(existsSync(resolve(active, file)), `${file} must not be active`).toBe(false);
      const bytes = readFileSync(resolve(archive, file));
      expect(manifest.get(file), `${file} manifest digest drifted`).toBe(sha);
      expect(createHash('sha256').update(bytes).digest('hex'), `${file} bytes drifted`).toBe(sha);
      expect(bytes.toString('utf8').split('\n')[0]).toBe('-- SUPERSEDED BY 20261109073642');
    }
  });

  it('keeps the installed superseding migration active, once', () => {
    const versions = readdirSync(active).filter((f) => f.startsWith('20261109073642_'));
    expect(versions).toEqual([SUPERSEDING]);
    for (const file of retired.keys()) {
      const version = file.slice(0, 14);
      expect(
        readdirSync(active).filter((f) => f.startsWith(`${version}_`)),
        version
      ).toEqual([]);
    }
  });
});
