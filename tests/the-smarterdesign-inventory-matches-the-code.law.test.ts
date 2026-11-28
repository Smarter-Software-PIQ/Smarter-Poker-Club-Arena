/**
 * LAW: THE #SMARTERDESIGN INVENTORY IS WHAT THE CODE SAYS, AND CONVERTED ONLY GROWS
 * (2026-11-28).
 *
 * The inventory was written by hand and went stale inside a day: PR #12312
 * converted seven pages while the document still listed them as to-do, and two
 * lanes started the same work. So scripts/smarterdesign-inventory.mjs grades
 * every routed page from markers in source.
 *
 * For one day the generated document was committed and this law required it
 * to equal the scanner's output. Every conversion rewrote that one shared file,
 * so every merge to main made every other open lane conflict on it, and each
 * resolution cost a full CI rerun. The document is now printed on demand and
 * never committed. What is committed is the RATCHET, one file per converted
 * page in docs/club-operations/smarterdesign.d/ (named for the component,
 * holding its module path). Two lanes add two files and cannot conflict.
 *
 * This law holds what mattered about the old document, strictly:
 *
 *   - every ratchet entry still reads as converted: a page that loses its
 *     arena root or mast, or gains a painted section, fails here by name;
 *   - every converted page has an entry (`node scripts/smarterdesign-inventory.mjs
 *     --ratchet` adds it), so the committed count is the real count;
 *   - no entry on the base branch disappears while its page is still routed and
 *     graded, so deleting an entry can never hide a downgrade: Converted only grows;
 *   - the two retired shared documents stay retired.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SCANNER = 'scripts/smarterdesign-inventory.mjs';
const RATCHET_DIR = 'docs/club-operations/smarterdesign.d';
const RETIRED = [
  'docs/club-operations/SMARTERDESIGN-INVENTORY.md',
  'docs/club-operations/SMARTERDESIGN-HISTORY.md',
];
const ADD = `node ${SCANNER} --ratchet`;

const run = (...args: string[]) =>
  execFileSync('node', [SCANNER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

interface Row {
  component: string;
  file: string | null;
  status: 'converted' | 'partial' | 'not-converted' | 'unknown' | 'excluded' | 'no-page';
  why?: string;
  evidence?: { root: string | null; mast: string | null; painted: number };
}

const scan = JSON.parse(run('--json')) as {
  rows: Row[];
  skinProvided: boolean;
  excludedKeysUnused: string[];
};

type Ratchet = {
  entries: Map<string, string>;
  malformed: string[];
  missingDir: boolean;
};
const loadScanner = () =>
  import(/* @vite-ignore */ pathToFileURL(resolve(ROOT, SCANNER)).href) as Promise<{
    readRatchet: (root?: string) => Ratchet;
    regressed: (
      rows: Row[],
      entries: Map<string, string>
    ) => { component: string; file: string; status: string; why: string | null }[];
    unratcheted: (rows: Row[], entries: Map<string, string>) => Row[];
  }>;

/**
 * The commit this branch is measured against: the pull request's base in CI,
 * otherwise where this branch left origin/main. Null only when neither can be
 * read, which the ratchet test reports as COULD NOT TELL (CLAUDE.md 10.86),
 * never as a pass.
 */
function baseCommit(): string | null {
  const candidates = [process.env.CI_BASE_SHA];
  try {
    candidates.push(git('merge-base', 'HEAD', 'origin/main').trim());
  } catch {
    /* no origin/main here; the CI base, if any, decides */
  }
  for (const c of candidates) {
    if (!c || !/^[0-9a-f]{40}$/.test(c)) continue;
    try {
      git('cat-file', '-e', `${c}^{commit}`);
      return c;
    } catch {
      /* not in this clone */
    }
  }
  return null;
}

describe('the #SmarterDesign inventory matches the code', () => {
  it('reads the routes at all, so an empty scan can never pass as an empty to-do list', () => {
    /* 10.86 rule 2: a parser that silently finds nothing would grade nothing as
       converted, and an empty ratchet would then look consistent with it. */
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
        'more. Delete it (or point it at the file that replaced the page).'
    ).toEqual([]);
  });

  it('the ratchet directory is well formed: one line, the page module, per component', async () => {
    const { readRatchet } = await loadScanner();
    const ratchet = readRatchet(ROOT);
    expect(ratchet.missingDir, `${RATCHET_DIR}/ is missing`).toBe(false);
    expect(
      ratchet.malformed,
      `Malformed entries in ${RATCHET_DIR}/: each file is named for a page component ` +
        '(PascalCase, no extension) and holds one line, the page module path (src/...tsx). ' +
        `Let ${ADD} write them.`
    ).toEqual([]);
    /* The same gate as the scan above: an empty ratchet is never a pass. */
    expect(ratchet.entries.size).toBeGreaterThan(40);
  });

  it('every ratchet entry still reads as converted: a converted page can never regress', async () => {
    const { readRatchet, regressed } = await loadScanner();
    const lost = regressed(scan.rows, readRatchet(ROOT).entries);
    expect(
      lost.map(
        (r) => `${r.component} (${r.file}) now reads ${r.status}${r.why ? `: ${r.why}` : ''}`
      ),
      'These pages are in the #SmarterDesign ratchet but no longer read as converted. ' +
        'Restore the arena-workspace root and ArenaWorkspaceHeader mast (and remove any painted ' +
        'console section). If the page module moved, correct the path inside its entry. Never ' +
        'delete an entry to make this pass; the base-branch test below refuses that too.'
    ).toEqual([]);
  });

  it('every converted page has its ratchet entry, so the committed count is the real count', async () => {
    const { readRatchet, unratcheted } = await loadScanner();
    const missing = unratcheted(scan.rows, readRatchet(ROOT).entries);
    expect(
      missing.map((r) => `${r.component} (${r.file})`),
      `These pages read as converted but have no entry in ${RATCHET_DIR}/. Run:\n\n    ${ADD}\n\n` +
        'and commit the new files. They are one file per page, so they never conflict.'
    ).toEqual([]);
  });

  it('no ratchet entry on the base branch is removed while its page is still graded', async () => {
    const base = baseCommit();
    expect(
      base,
      'UNKNOWN: could not read the base commit (no CI_BASE_SHA and no origin/main in this ' +
        'clone), so whether a ratchet entry was deleted cannot be told. Fetch origin main.'
    ).not.toBeNull();
    let listed = '';
    try {
      listed = git('ls-tree', '--name-only', `${base}:${RATCHET_DIR}`);
    } catch {
      /* The base predates the ratchet (the pull request that introduced it). */
      return;
    }
    const { readRatchet } = await loadScanner();
    const now = readRatchet(ROOT).entries;
    const removed = listed
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n && n !== 'README.md' && !now.has(n));
    /* An entry may go only when its page left the routes, or was moved to the
       script's EXCLUDED list (a written ruling) or renders no page. */
    const hidden = removed.filter((name) =>
      scan.rows.some((r) => r.component === name && !['excluded', 'no-page'].includes(r.status))
    );
    expect(
      hidden,
      `Ratchet entries removed from ${RATCHET_DIR}/ while their pages are still routed. ` +
        'Converted only grows: put the entry back and restore the page instead.'
    ).toEqual([]);
  });

  it('the two shared documents every lane edited stay retired', () => {
    for (const doc of RETIRED) {
      expect(
        existsSync(join(ROOT, doc)),
        `${doc} was retired on 2026-11-28 because every lane edited it and every merge ` +
          "conflicted. If a merge brought it back, take main's deletion (`git rm` it): the " +
          `inventory is printed by \`node ${SCANNER}\`, converted pages are recorded in ` +
          `${RATCHET_DIR}/, and the batch history is one file per batch in ` +
          'docs/club-operations/smarterdesign-history.d/.'
      ).toBe(false);
    }
  });

  it('the printed document points at the ratchet and the history directory, not the retired files', () => {
    const doc = run('--markdown');
    expect(doc).toContain(RATCHET_DIR);
    expect(doc).toContain('docs/club-operations/smarterdesign-history.d');
    for (const retired of RETIRED) expect(doc).not.toContain(retired.split('/').pop());
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\.smarterdesign\/$/m);
  });

  it('a change that only touches the ratchet still runs this law', async () => {
    /* A docs-only pull request skips the client unit suite; the ungated docs
       reader (scripts/ci/run-docs-readers.mjs) must select this file, or a PR
       deleting an entry alone would go green with nothing looking (10.83). */
    const { readersOf } = await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, 'scripts/ci/run-docs-readers.mjs')).href
    );
    const self = 'tests/the-smarterdesign-inventory-matches-the-code.law.test.ts';
    for (const changed of [`${RATCHET_DIR}/ClubDashboard`, `${RATCHET_DIR}/README.md`]) {
      expect(readersOf(ROOT, [changed], [self]), `${changed} must select this law`).toEqual([self]);
    }
  });
});
