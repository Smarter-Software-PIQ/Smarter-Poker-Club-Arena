/**
 * LAW: an option authority doc cites evidence that exists (2026-11-24).
 *
 * The Hold'em switch ablation of 2026-11-24 checked the evidence files authority docs cite and could not find
 * several. On a second, bounded look most were present under a different folder or volume than the citation
 * implied (an archive entry that is a link to another volume, a server-relative path, a renamed law file), and one
 * (`scripts/r4.sql`) is absent everywhere. A doc that cites a file nobody can open reads as evidence and is not.
 *
 * Every repo path a file in docs/horse-option-authority.d/ cites must exist in this checkout (at the root, or under
 * server/ for server-relative citations). Absolute Mac paths, which CI cannot see, and archive-relative paths that
 * only look like repo paths must be listed in docs/horse-option-authority-external-evidence.json with the date they
 * were checked and whether the file was found; a not-found entry needs "EVIDENCE FILE NOT FOUND (checked <date>)"
 * in its doc. An entry whose doc no longer cites its path is stale and fails, so the list stays true.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_EVIDENCE_FILE,
  NOT_FOUND_MARK,
  citedPaths,
  repoPathExists,
} from '../scripts/ops/horse-authority-evidence-paths.mjs';

const ROOT = resolve(__dirname, '..');
const AUTH_DIR = join(ROOT, 'docs/horse-option-authority.d');

type Entry = {
  doc: string;
  path: string;
  status: 'found' | 'not-found';
  verifiedOn: string;
  where?: string;
};

function authorityDocs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(AUTH_DIR).sort())
    if (f.endsWith('.md')) out[f] = readFileSync(join(AUTH_DIR, f), 'utf8');
  return out;
}

describe('an authority doc cites evidence that exists', () => {
  const docs = authorityDocs();
  const list = JSON.parse(readFileSync(join(ROOT, EXTERNAL_EVIDENCE_FILE), 'utf8')) as {
    schema: string;
    entries: Entry[];
  };
  const listed = new Map(list.entries.map((e) => [`${e.doc}\u0000${e.path}`, e]));

  it('the external-evidence list is well formed', () => {
    expect(list.schema).toBe('horse-option-authority-external-evidence/v1');
    for (const e of list.entries) {
      expect(Object.keys(docs), `${EXTERNAL_EVIDENCE_FILE}: unknown doc ${e.doc}`).toContain(e.doc);
      expect(['found', 'not-found'], `${e.doc} ${e.path}`).toContain(e.status);
      expect(e.verifiedOn, `${e.doc} ${e.path}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(listed.size, 'duplicate entries').toBe(list.entries.length);
  });

  it('every repo path a doc cites exists, or is listed', () => {
    const missing: string[] = [];
    for (const [doc, text] of Object.entries(docs))
      for (const p of citedPaths(text).repo)
        if (!repoPathExists(ROOT, p) && !listed.has(`${doc}\u0000${p}`))
          missing.push(`${doc}: ${p}`);
    expect(
      missing,
      `cited repo paths that do not exist (fix the path, or list it in ${EXTERNAL_EVIDENCE_FILE})`
    ).toEqual([]);
  });

  it('every absolute Mac path a doc cites is listed with the date it was checked', () => {
    const unlisted: string[] = [];
    for (const [doc, text] of Object.entries(docs))
      for (const p of citedPaths(text).external)
        if (!listed.has(`${doc}\u0000${p}`)) unlisted.push(`${doc}: ${p}`);
    expect(unlisted, `check each path by hand and list it in ${EXTERNAL_EVIDENCE_FILE}`).toEqual(
      []
    );
  });

  it('a listed path is still cited, and a file not found is marked in its doc', () => {
    for (const e of list.entries) {
      const { repo, external } = citedPaths(docs[e.doc]);
      expect(
        [...repo, ...external],
        `${EXTERNAL_EVIDENCE_FILE}: ${e.doc} no longer cites ${e.path}`
      ).toContain(e.path);
      if (e.status === 'not-found')
        expect(docs[e.doc], `${e.doc} must mark ${e.path}`).toContain(NOT_FOUND_MARK);
    }
  });

  it('reads the paths the docs write', () => {
    const t =
      'run `npx tsx scripts/audited-decision-replay.ts` (from server/), see docs/ops/x.md. Archive ' +
      '`/Volumes/SmarterArchives/agent-evidence/extreme-archive/a/REPORT.md`, and server/src/engine/HorseLogic.ts; ' +
      'https://github.com/o/r/blob/main/docs/y.md is a link, $ARCHIVE/nodes/E.nodes.jsonl is a variable.';
    expect(citedPaths(t)).toEqual({
      repo: [
        'scripts/audited-decision-replay.ts',
        'docs/ops/x.md',
        'server/src/engine/HorseLogic.ts',
      ],
      external: ['/Volumes/SmarterArchives/agent-evidence/extreme-archive/a/REPORT.md'],
    });
    expect(repoPathExists(ROOT, 'scripts/audited-decision-replay.ts')).toBe(true); // server-relative
    expect(repoPathExists(ROOT, 'scripts/no-such-file-anywhere.sql')).toBe(false);
  });
});
