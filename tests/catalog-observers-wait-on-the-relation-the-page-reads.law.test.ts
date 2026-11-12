import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * Production alert row 371597 (Post-Deploy E2E), item 6. #10272 moved the
 * completed-event standings read from the base table `tournament_players` to
 * the public view `tournament_players_public` (readTournamentStandings), but
 * tests/e2e/routes/catalog-observers.spec.ts kept waiting for a GET on
 * /rest/v1/tournament_players. The page was right; the witness waited 90 s for
 * a request the page never makes, and failed every production run from 11-10.
 *
 * The law: every PostgREST relation the catalog-observers witness waits on is
 * the relation the page's own loader reads. A future change to a loader's
 * relation must move the witness in the same commit.
 */
const SPEC = 'tests/e2e/routes/catalog-observers.spec.ts';
const read = (path: string) => readFileSync(path, 'utf8');

/** Relations named by `.from('<relation>')` in a source file. */
const relationsReadBy = (path: string) =>
  new Set([...read(path).matchAll(/\.from\(\s*'([a-z0-9_]+)'\s*\)/g)].map((m) => m[1]));

/** Relations the spec waits on, resolving its string constants. */
const waitedRelations = () => {
  const spec = read(SPEC);
  const constants = new Map(
    [...spec.matchAll(/const\s+([A-Z_]+)\s*=\s*'([a-z0-9_]+)'/g)].map((m) => [m[1], m[2]])
  );
  return [...spec.matchAll(/\bread\(\s*page,\s*('([a-z0-9_]+)'|[A-Z_]+)\s*,/g)].map((m) => {
    const name = m[2] ?? constants.get(m[1]);
    expect(name, `unresolved relation ${m[1]} in ${SPEC}`).toBeTruthy();
    return name as string;
  });
};

// Which loader issues each read the witness waits on.
const LOADERS: Record<string, string[]> = {
  tournaments: ['src/pages/tournament/TournamentResultsPage.tsx'],
  tournament_players_public: ['src/services/readTournamentStandings.ts'],
  table_templates: ['src/pages/TableConfigPage.tsx'],
};

describe('catalog observers wait on the relation the page reads', () => {
  it('the results page reads standings through readTournamentStandings', () => {
    const page = read('src/pages/tournament/TournamentResultsPage.tsx');
    expect(page).toMatch(/const loadResults = useVisibleRead[\s\S]*?readTournamentStandings\(/);
  });

  it('every waited relation is read by its loader, and every standings wait names the view', () => {
    const waited = waitedRelations();
    expect(waited.length).toBeGreaterThanOrEqual(5);
    for (const relation of waited) {
      const loaders = LOADERS[relation];
      expect(loaders, `${SPEC} waits on ${relation}, which no known loader reads`).toBeDefined();
      for (const loader of loaders) {
        expect(
          relationsReadBy(loader).has(relation),
          `${SPEC} waits on /rest/v1/${relation}, but ${loader} does not read it`
        ).toBe(true);
      }
    }
    const [standingsRelation] = [...relationsReadBy('src/services/readTournamentStandings.ts')];
    expect(waited.filter((r) => r.startsWith('tournament_players'))).toEqual([
      standingsRelation,
      standingsRelation,
    ]);
  });
});
