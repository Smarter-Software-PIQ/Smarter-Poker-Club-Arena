/**
 * A MIGRATION'S PINS ARE CHECKED AGAINST PRODUCTION BEFORE IT MERGES
 * (2026-11-18, incident 075013fd).
 *
 * #11256 passed every check and merged; production's applier then refused its
 * 20261118034950 with 55000 migration_left_a_stale_pin, because the installed
 * smarter_private.original_erased_cash_base_discharge pinned the md5 of
 * fn_ca_tally_balance_move's body, which the file changes. The guard ran only
 * inside the applier, after merge, so the refusal surfaced at install, in an
 * engine release window, and cost a revert (#11260) and a re-land (#11270).
 *
 * The pull-request gate is the `pins` job of
 * window-migrations-install-before-merge.yml
 * (scripts/ci/migration-pins-before-merge.mjs). This law pins its shape and
 * its static reading; tests/unit/aMigrationsPinsAreCheckedBeforeMerge.pg.test.ts
 * is the native proof that both halves refuse #11256's original file when the
 * pin exists and pass the re-landed one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  identityArgs,
  loadCatalog,
  pinRehearsalSQL,
  planPinCheck,
  regprocedureKey,
  scanMigration,
  signatureKey,
  staticPinFindings,
  statementText,
  verdict,
} from '../scripts/ci/migration-pins-before-merge.mjs';
import {
  CATALOG_SQL_CATALOG_PATH,
  CATALOG_SQL_PUBLIC_PATH,
  PINS_SQL,
} from '../scripts/ci/migration-pins-capture.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const NAME = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const RELANDED = read(`supabase/migrations/${NAME}`);
const ORIGINAL = RELANDED.replace(
  /-- STALE PIN, DECLARED[\s\S]*?\n-- @stale-pin-ok:[^\n]*\n\n/,
  ''
);
const TALLY = 'public.fn_ca_tally_balance_move()';
const BEFORE = 'b7911a245d4bf33134a9a2f474c1f410';
const PINNER = 'smarter_private.original_erased_cash_base_discharge(bigint,text)';
const h = (c: string) => c.repeat(32);

/** Production as it stood when #11256 merged, reduced to what the check reads. */
function productionAtMerge(extraPins: string[] = []) {
  const catalog = [
    [1, TALLY, BEFORE],
    [2, 'public.fn_ca_supply_snapshot()', 'de5f2ec2b0897d91d12689288723b57f'],
    [3, PINNER, h('9')],
  ];
  return loadCatalog(
    catalog.map((r) => r.join('\t')).join('\n'),
    catalog.map(([oid]) => `${oid}\t${h('8')}`).join('\n'),
    [`${PINNER}\t${BEFORE}`, ...extraPins].join('\n')
  );
}

describe("a migration's pins are checked against production before it merges", () => {
  it("#11256's original 20261118034950 is refused by the static reading of production at merge", () => {
    const stat = staticPinFindings(ORIGINAL, productionAtMerge());
    expect(stat.stale).toEqual([
      expect.objectContaining({ signature: TALLY, md5: BEFORE, pinner: PINNER, verdict: 'stale' }),
    ]);
    expect(verdict({ outcome: 'not-installable' }, stat)).toMatchObject({
      fail: true,
      by: 'static',
    });
  });

  it("the re-landed file's -- @stale-pin-ok is honoured by the applier's own parser", () => {
    const stat = staticPinFindings(RELANDED, productionAtMerge());
    expect(stat.stale).toEqual([]);
    expect(stat.findings).toEqual([expect.objectContaining({ md5: BEFORE, verdict: 'allowed' })]);
  });

  it('a pin held by a function the same file changes counts as moved', () => {
    const sql = `BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;\nCREATE OR REPLACE FUNCTION public.g() RETURNS int LANGUAGE plpgsql AS $b$ BEGIN RETURN 1; END $b$;\nCOMMIT;`;
    const cat = loadCatalog(
      `1\tpublic.f()\t${h('a')}\n2\tpublic.g()\t${h('b')}\n3\tpublic.h()\t${h('c')}`,
      `1\t${h('a')}\n2\t${h('b')}\n3\t${h('c')}`,
      `public.g()\t${h('a')}\npublic.h()\t${h('a')}0`
    );
    const stat = staticPinFindings(sql, cat);
    expect(stat.findings.map((f) => [f.pinner, f.verdict]).sort()).toEqual([
      ['public.g()', 'moved'],
      ['public.h()', 'stale'],
    ]);
  });

  it('the exact half governs: an install that passes the guard passes, a 55000 refusal fails', () => {
    const stale = {
      stale: [{ signature: 'x', md5: h('a'), how: '', pinner: 'p', verdict: 'stale' }],
    } as any;
    expect(verdict({ outcome: 'installed' }, stale).fail).toBe(false);
    expect(verdict({ outcome: 'stale-pin', detail: 'd' }, { stale: [] } as any).fail).toBe(true);
  });

  it('reads what a migration changes from statements, not from the bodies it installs', () => {
    const sql = `
-- CREATE OR REPLACE FUNCTION public.commented() ...
BEGIN;
CREATE OR REPLACE FUNCTION public.pinner(p_at timestamptz, VARIADIC p_ids int[] DEFAULT '{}', OUT r int)
LANGUAGE plpgsql AS $f$ BEGIN IF md5('x') = '${h('d')}' THEN NULL; END IF; END $f$;
ALTER FUNCTION public.a(text) SET search_path = pg_catalog;
ALTER FUNCTION public.b(text) OWNER TO postgres;
DROP FUNCTION IF EXISTS public.c(integer, character varying), smarter_private.d(bigint) CASCADE;
DO $$ BEGIN PERFORM pg_temp.ca_patch('public.e(uuid,timestamptz)'::regprocedure, '${h('e')}', ARRAY['a'], ARRAY['b']); END $$;
COMMIT;`;
    const scan = scanMigration(sql);
    expect(scan.definite.map((d) => `${d.how} ${d.key}`)).toEqual([
      'CREATE OR REPLACE public.pinner(timestamp with time zone,integer[])',
      'ALTER public.a(text)',
      'DROP public.c(integer,character varying)',
      'DROP smarter_private.d(bigint)',
      'pg_temp.ca_patch public.e(uuid,timestamp with time zone)',
    ]);
    expect(scan.preimages).toEqual([
      {
        key: 'public.e(uuid,timestamp with time zone)',
        md5: h('e'),
        how: 'pg_temp.ca_patch preimage',
      },
    ]);
    // the md5 inside the installed body is a pin, not a preimage
    expect(scan.md5Literals).toEqual([h('e')]);
    expect(statementText(sql)).not.toContain('commented');
  });

  it('keys signatures the way regprocedure prints them', () => {
    expect(
      identityArgs('p_club uuid, p_at timestamp with time zone DEFAULT now(), OUT x int')
    ).toEqual(['uuid', 'timestamp with time zone']);
    expect(signatureKey('fn', 'int4, bool, varchar(20), double precision')).toBe(
      'public.fn(integer,boolean,character varying,double precision)'
    );
    expect(regprocedureKey('smarter_private.f(public.thing,text[])')).toBe(
      'smarter_private.f(thing,text[])'
    );
  });

  it('checks only what the applier will run: guarded, uninstalled, not superseded, changed by the branch', () => {
    const f = (name: string, sql = 'BEGIN;\nSELECT 1;\nCOMMIT;\n') => ({ name, sql });
    const plan = planPinCheck(
      [
        f('20261107000000_old.sql'),
        f('20261118000000_installed.sql'),
        f('20261118000001_mine.sql'),
        f('20261118000002_replaced.sql', '-- SUPERSEDED BY 20261118000001\nBEGIN;\nCOMMIT;\n'),
        f('20261118000003_main_pending.sql'),
      ],
      new Set(['20261118000000']),
      new Set([
        '20261107000000_old.sql',
        '20261118000000_installed.sql',
        '20261118000001_mine.sql',
        '20261118000002_replaced.sql',
      ])
    );
    expect(plan.checked).toEqual(['20261118000001_mine.sql']);
    expect(plan.skipped.map((s) => s.name)).toEqual([
      '20261107000000_old.sql',
      '20261118000000_installed.sql',
      '20261118000002_replaced.sql',
    ]);
    expect(plan.prerequisites).toEqual(['20261118000003_main_pending.sql']);
  });

  it("the exact half is the applier's own guard, spliced the applier's way", () => {
    const sql = pinRehearsalSQL(NAME, ORIGINAL);
    expect(sql.indexOf('$ca_stale_pin_snapshot$')).toBeGreaterThan(sql.indexOf('BEGIN;'));
    expect(sql.indexOf('$ca_stale_pin_check$')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
    expect(sql).toContain('migration_left_a_stale_pin');
  });

  it("the capture's questions are read-only and ask every schema for pins, as the guard does", () => {
    for (const q of [CATALOG_SQL_CATALOG_PATH, CATALOG_SQL_PUBLIC_PATH, PINS_SQL])
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT)\b/i);
    expect(CATALOG_SQL_CATALOG_PATH).toContain('SET search_path = pg_catalog');
    expect(CATALOG_SQL_PUBLIC_PATH).toContain('SET search_path = public');
    expect(PINS_SQL).not.toContain('nspname');
  });

  it('runs on every same-repository pull request: credentials only in the default-branch capture, the branch SQL only in a secretless job', () => {
    const wf = parse(
      read('.github/workflows/window-migrations-install-before-merge.yml')
    ) as Record<string, any>;
    expect(Object.keys(wf.on)).toEqual(['pull_request_target']);
    const { capture, pins } = wf.jobs;
    const step = capture.steps.find((s: any) => /md5s and pins/.test(s.name ?? ''));
    expect(step.env).toEqual({ DATABASE_URL: '${{ secrets.DATABASE_URL }}' });
    expect(step.run).toContain('default_transaction_read_only=on');
    expect(step.run).toContain('node scripts/ci/migration-pins-capture.mjs');
    expect(capture.steps[0].with['sparse-checkout']).toContain(
      'scripts/ci/migration-pins-capture.mjs'
    );
    expect(JSON.stringify(capture)).not.toContain('head.sha');
    expect(pins.name).toBe('Migration pins move before merge');
    expect(pins.environment).toBeUndefined();
    expect(JSON.stringify(pins)).not.toContain('secrets.');
    expect(pins.permissions).toEqual({ contents: 'read' });
    expect(pins.needs).toEqual(['scope', 'capture']);
    // An unreadable capture is UNKNOWN, never a pass.
    expect(JSON.stringify(pins)).toContain("needs.capture.result != 'success'");
    expect(JSON.stringify(pins)).toContain(
      'node scripts/ci/migration-pins-before-merge.mjs rehearse'
    );
    const checkout = pins.steps.find((s: any) =>
      String(s.uses ?? '').startsWith('actions/checkout')
    );
    expect(checkout.with.ref).toBe('${{ github.event.repository.default_branch }}');
  });
});
