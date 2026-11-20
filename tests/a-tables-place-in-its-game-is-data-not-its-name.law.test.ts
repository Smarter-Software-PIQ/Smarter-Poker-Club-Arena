/**
 * LAW: A TABLE'S PLACE IN ITS GAME IS DATA, NEVER ITS NAME (2026-11-19).
 *
 * Main vs feeder is `tables.role` ('main' | 'feeder', CHECK tables_role_check)
 * with `tables.main_index`; Cluster membership is `tables.cluster_id`; the
 * Cluster's mode (Lightning) is `cash_games.cluster_mode`. Names are display
 * text: Main 1 has always worn the bare game name, and at 02:37 UTC on
 * 2026-11-19 the generated names changed ("NLH 0.50/1 Classic", "... Classic
 * Feeder"), which silently broke the seat-move announcement and its
 * production proof, both of which matched /\bmain(?:\s*\d+)?\b/i on a name.
 *
 * This law refuses any client, engine or production-proof code that again
 * classifies a table by matching "main" or "feeder" in text.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEAT_MOVE_DESTINATION_COLUMNS,
  seatMoveDestinationLabel,
} from '../src/utils/clusterTableRole';

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Text that classifies a table from its name. */
const NAME_CLASSIFIERS: readonly RegExp[] = [
  // a regex literal built on a \bmain word boundary: /\bmain(?:\s*\d+)?\b/i
  /\/[^/\n]*\\b\(?\??:?main[^/\n]*\/[a-z]*/i,
  // a regex literal on "feeder" applied with .test()/.exec(), or .match(/...main|feeder/)
  /\/[^/\n]*\bfeeder\b[^/\n]*\/[a-z]*\s*\.\s*(?:test|exec)\(|\.match\(\s*\/[^/\n]*\b(?:main|feeder)\b/i,
  // name.includes('Main'), label.startsWith('Feeder'), ...
  /\.(?:includes|startsWith|endsWith|indexOf)\(\s*['"`](?:main|feeder)\b/i,
  // .ilike('name', '%Main%')
  /\.ilike\(\s*['"]name['"]\s*,\s*['"][^'"]*(?:main|feeder)/i,
];

/**
 * Matches that do not classify a table. Each names why.
 *  - customCashGameName strips generated caption words ("Main 2", "Feeder")
 *    from a name for DISPLAY; it never decides what a table is.
 */
const NOT_A_CLASSIFIER = new Set(['src/utils/customCashGameName.ts:28']);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, out);
    else if (/\.(?:ts|tsx|mjs)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

function nameClassifiers(path: string, text: string): string[] {
  const hits: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    const at = `${path}:${i + 1}`;
    if (!NOT_A_CLASSIFIER.has(at) && NAME_CLASSIFIERS.some((re) => re.test(line))) hits.push(at);
  });
  return hits;
}

describe("a table's place in its game is data, not its name", () => {
  it('no client, engine or production proof classifies a table by its name', () => {
    const hits = ['src', 'server/src', 'tests/e2e'].flatMap((dir) =>
      sources(dir).flatMap((path) => nameClassifiers(path, read(path)))
    );
    expect(hits).toEqual([]);
  });

  it('the scan refuses the name-based code it replaced', () => {
    // The two lines this law was written against (#11405 and before).
    expect(
      nameClassifiers(
        'x.ts',
        "            data.reason === 'must_move' || /\\bmain(?:\\s*\\d+)?\\b/i.test(label)"
      )
    ).toEqual(['x.ts:1']);
    expect(nameClassifiers('x.ts', 'const MAIN_NAME = /\\bmain(?:\\s*\\d+)?\\b/i;')).toEqual([
      'x.ts:1',
    ]);
    expect(nameClassifiers('x.ts', "if (table.name.includes('Main')) return true;")).toEqual([
      'x.ts:1',
    ]);
    expect(nameClassifiers('x.ts', 'const feeder = /feeder/i.test(name);')).toEqual(['x.ts:1']);
  });

  it('the seat-move announcement reads the destination role, not just its name', () => {
    expect(SEAT_MOVE_DESTINATION_COLUMNS.split(',')).toContain('role');
    const hook = read('src/hooks/useSeatMoveAnnouncement.ts');
    expect(hook).toMatch(/\.select\(SEAT_MOVE_DESTINATION_COLUMNS\)/);
    expect(hook).toMatch(/seatMoveDestinationLabel\(data\.reason, table\.data\)/);
    expect(hook).not.toMatch(/\.select\(['"]name['"]\)/);
  });

  it('the production seat-move proof chooses its destinations by role', () => {
    const spec = read('tests/e2e/production-seat-move-announcement.spec.ts');
    expect(spec).toMatch(/isMainTable\(table\)/);
    expect(spec).toMatch(/!isMainTable\(table\)/);
    expect(spec).toMatch(/=== SEAT_MOVE_DESTINATION_COLUMNS/);
    // Its catalogue read is the lobby's, which selects the role columns.
    const lobby = read('src/pages/ClubHomePage.tsx');
    expect(lobby).toMatch(/'id, name, game_variant,[^']*\bcluster_id, role, main_index\b/);
  });

  it('a renamed table keeps its place (production names of 2026-11-19)', () => {
    // Main 1 wears the bare game name; Main 2 still says "Main"; a feeder may
    // or may not say "Feeder"; a must-move main may say "Lightning Games".
    for (const name of [
      'NLH 0.50/1 Classic',
      'PLO4 0.50/1 Classic Main 2',
      'PLO4 1.00/2.00 Lightning Games',
      'Renamed By The Host',
    ])
      expect(seatMoveDestinationLabel('seat_change', { name, role: 'main' })).toBe('The Main Game');
    for (const name of ['PLO6 0.50/1 Classic Feeder', 'PLO5 1.00/2.00 Lightning Games', 'Main'])
      expect(seatMoveDestinationLabel('must_move', { name, role: 'feeder' })).toBe(name);
  });
});
