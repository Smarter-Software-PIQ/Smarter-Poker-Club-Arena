/**
 * The file paths an option authority doc (docs/horse-option-authority.d/) cites, read the way the law
 * tests/an-authority-doc-cites-evidence-that-exists.law.test.ts reads them (2026-11-24).
 *
 * Two kinds:
 *  - repo paths: a token that starts at a top-level folder of this repository (docs/, server/, scripts/, tests/,
 *    src/, client/, supabase/, .github/) and ends in a file extension. It must exist in the checkout, at the root or
 *    under server/ (server-relative citations such as `scripts/audited-decision-replay.ts` are common), unless the
 *    allow-list records it (an archive-relative path that only looks like a repo path, or a file marked not found).
 *  - external paths: an absolute path on the Mac (/Volumes/... or /Users/...). CI cannot see the SSD, so each one is
 *    listed in docs/horse-option-authority-external-evidence.json with the date it was last checked and what was found.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const EXTERNAL_EVIDENCE_FILE = 'docs/horse-option-authority-external-evidence.json';
export const NOT_FOUND_MARK = 'EVIDENCE FILE NOT FOUND (checked ';

const REPO_ROOTS = ['docs', 'server', 'scripts', 'tests', 'src', 'client', 'supabase', '\\.github'];
const REPO_PATH = new RegExp(
  `(?<![A-Za-z0-9_./~$-])((?:${REPO_ROOTS.join('|')})/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)`,
  'g'
);
const EXTERNAL_PATH = /(?<![A-Za-z0-9_.-])(\/(?:Volumes|Users)\/[^\s`'"()<>\]|*]+)/g;

function clean(p) {
  return p.replace(/[.,;:]+$/, '');
}

/** Every repo-looking path and every absolute Mac path the text cites, each once, in order of first mention. */
export function citedPaths(text) {
  const repo = [];
  const external = [];
  for (const m of String(text ?? '').matchAll(REPO_PATH)) {
    const p = clean(m[1]);
    if (!repo.includes(p)) repo.push(p);
  }
  for (const m of String(text ?? '').matchAll(EXTERNAL_PATH)) {
    const p = clean(m[1]);
    if (!external.includes(p)) external.push(p);
  }
  return { repo, external };
}

/** A repo path exists at the root or under server/. */
export function repoPathExists(root, p) {
  return existsSync(join(root, p)) || existsSync(join(root, 'server', p));
}
