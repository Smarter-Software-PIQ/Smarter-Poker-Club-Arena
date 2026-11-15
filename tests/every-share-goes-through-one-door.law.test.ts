/**
 * EVERY SHARE GOES THROUGH ONE DOOR (Dan 2026-11-14: "THE SHARE LINKS ISN'T
 * WORKING FOR THE TOURNAMENTS OR OTHER 'SHARE STATS' OR SHARE TOURNAMENT ON
 * BREAK ... HARD CODE FIX ANY AND ALL ISSUES WITH THE LINK SHARING").
 *
 * The defect was structural: some twenty-five share and copy buttons each
 * carried their own copy of "system sheet, else clipboard", and each copy
 * dead-ended somewhere different (a sheet that refused, a Clipboard API that
 * was present but denied, a failure nobody reported). The repair made on
 * 2026-11-06 reached two hand-link buttons and none of the others.
 *
 * src/lib/share.ts is now the only caller of navigator.share and
 * src/lib/copyToClipboard.ts the only caller of clipboard.writeText. A new
 * hand-rolled share is the old bug again, so it fails here.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const DOORS = new Set(['src/lib/share.ts', 'src/lib/copyToClipboard.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments describe the old calls at length; only code is judged. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const RAW =
  /navigator\s*(?:as[^)]*\))?\.\s*(?:share|canShare)\b|clipboard\s*\??\.\s*writeText\b|['"]share['"]\s+in\s+navigator/;

describe('every share goes through one door', () => {
  const files = sourceFiles(SRC);

  it('reads the tree it claims to read', () => {
    expect(files.length).toBeGreaterThan(500);
    for (const door of DOORS) expect(files.map((f) => relative(ROOT, f))).toContain(door);
  });

  it('no file outside the door calls the Web Share or Clipboard write APIs', () => {
    const offenders = files
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((rel) => !DOORS.has(rel))
      .filter((rel) => RAW.test(stripComments(readFileSync(join(ROOT, rel), 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('the door falls through a refused sheet to the copy, and reports it', () => {
    const door = stripComments(readFileSync(join(SRC, 'lib/share.ts'), 'utf8'));
    expect(door).toMatch(
      /if \(isCancel\(error\)\) return 'cancelled';\s*reportError\(error, `\$\{source\}\.share_refused`\)/
    );
    expect(door).toMatch(/copyText\(clip, source\)\) \? 'copied' : 'failed'/);
    const copy = stripComments(readFileSync(join(SRC, 'lib/copyToClipboard.ts'), 'utf8'));
    expect(copy).toMatch(/return copyBySelection\(text\)/);
  });

  it('a tournament is shared as one address from one builder', () => {
    for (const rel of [
      'src/components/table/TournamentBreakScreen.tsx',
      'src/pages/tournament/TournamentDetails.tsx',
      'src/components/tournament/TournamentRankingCard.tsx',
    ]) {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      expect(code, rel).toMatch(/tournamentShareUrl\(/);
      expect(code, rel).not.toMatch(/\/hub\/club-arena\/tournaments\/\$\{/);
    }
  });
});
