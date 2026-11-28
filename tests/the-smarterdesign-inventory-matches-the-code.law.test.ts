/**
 * LAW: THE #SMARTERDESIGN INVENTORY IS WHAT THE CODE SAYS (2026-11-28).
 *
 * The inventory in docs/club-operations/SMARTERDESIGN-INVENTORY.md used to be
 * written by hand. It went stale inside a day: PR #12312 converted seven pages
 * while the document still listed them as to-do, and two lanes started the
 * same work. The #ClubArenaConsole scanner could not catch it either, because
 * it counts a page on painted SpadeConsole plates as finished, and under
 * #SmarterDesign those plates are "THE OLD STYLE" (Dan, 2026-11-27).
 *
 * So the document is now the output of scripts/smarterdesign-inventory.mjs,
 * which grades every routed page from markers in source. This law fails when
 * the committed document differs from what the scanner reads, so a pull
 * request that converts a page updates the inventory in the same diff, and a
 * reader never acts on a list the code has already moved past.
 *
 * If this fails, run ONE command and commit the result:
 *
 *     node scripts/smarterdesign-inventory.mjs --write
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SCANNER = 'scripts/smarterdesign-inventory.mjs';
const DOC = 'docs/club-operations/SMARTERDESIGN-INVENTORY.md';
const REGENERATE = `node ${SCANNER} --write`;

const run = (...args: string[]) =>
  execFileSync('node', [SCANNER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });

interface Row {
  component: string;
  file: string | null;
  status: 'converted' | 'partial' | 'not-converted' | 'unknown' | 'excluded' | 'no-page';
  evidence?: { root: string | null; mast: string | null; painted: number };
}

const scan = JSON.parse(run('--json')) as {
  rows: Row[];
  skinProvided: boolean;
  excludedKeysUnused: string[];
};

describe('the #SmarterDesign inventory matches the code', () => {
  it('the committed inventory is exactly what the scanner reads in src/', () => {
    const committed = readFileSync(join(ROOT, DOC), 'utf8');
    const generated = run('--markdown');
    expect(
      committed === generated,
      `${DOC} is out of date with src/. A page's #SmarterDesign state changed (or a route ` +
        `moved) and the inventory was not regenerated. Run:\n\n    ${REGENERATE}\n\n` +
        'and commit the result. Do not edit the file by hand; the batch history lives in ' +
        'docs/club-operations/SMARTERDESIGN-HISTORY.md.'
    ).toBe(true);
  });

  it('reads the routes at all, so an empty scan can never pass as an empty to-do list', () => {
    /* 10.86 rule 2: a parser that silently finds nothing would generate an
       empty inventory, the committed copy would be regenerated to match, and
       "nothing to convert" would read as good news. */
    expect(scan.rows.length).toBeGreaterThan(80);
    const graded = scan.rows.filter((r) =>
      ['converted', 'partial', 'not-converted'].includes(r.status)
    );
    expect(graded.length).toBeGreaterThan(60);
  });

  it('the reference pages the Club Operations law pins are read as converted', () => {
    /* tests/club-operations-pages-stay-smarterdesign.law.test.ts holds these on
       the arena workspace; if the scanner stops seeing them, it is the scanner
       that broke. */
    for (const file of [
      'src/pages/club/ClubOperationsPage.tsx',
      'src/pages/club/ClubDashboard.tsx',
      'src/pages/ReportReviewPage.tsx',
    ]) {
      const row = scan.rows.find((r) => r.file === file);
      expect(row, `${file} is no longer a routed page the scanner can see`).toBeDefined();
      expect(row?.status, `${file} should read as converted`).toBe('converted');
    }
  });

  it('a page is converted only with an arena root and mast, and no painted section left', () => {
    for (const row of scan.rows.filter((r) => r.status === 'converted')) {
      expect(row.evidence?.root, `${row.component}: converted without a root`).toBeTruthy();
      expect(row.evidence?.mast, `${row.component}: converted without a mast`).toBeTruthy();
      expect(row.evidence?.painted, `${row.component}: converted with painted plates`).toBe(0);
    }
  });

  it('the root smarterdesign console skin is reported, never counted as a conversion', () => {
    const doc = run('--markdown');
    if (scan.skinProvided) {
      expect(doc).toContain('That is a skin, not a conversion');
    }
    for (const row of scan.rows.filter((r) => (r.evidence?.painted ?? 0) > 0)) {
      expect(row.status, `${row.component} has painted sections`).not.toBe('converted');
    }
  });

  it('every deliberate exclusion still names a routed page', () => {
    expect(
      scan.excludedKeysUnused,
      'An EXCLUDED line in scripts/smarterdesign-inventory.mjs matches no routed page any ' +
        'more. Delete it (or point it at the file that replaced the page), then regenerate.'
    ).toEqual([]);
  });
});
