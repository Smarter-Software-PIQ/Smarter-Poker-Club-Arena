/**
 * GAMES, ADVERTISE & TOURNAMENT RESULTS ARENA DRESS IS SCOPED (#SmarterDesign
 * batch G1, 2026-11-28)
 *
 * TableConfigPage, CreateTablePage, ClubAdvertisePage and TournamentResultsPage
 * wear the arena workspace. Every rule in CreateTablePage.css,
 * ClubAdvertisePage.css and TournamentResultsPage.css (and the new arena rules
 * in TableConfigPage.css) is scoped under the page's `.arena-workspace` root so
 * nothing leaks onto non-arena pages or shared controls.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => topLevel(s))
    .map((s) => s.trim())
    .filter(Boolean);
}

function expectScoped(css: string, root: string) {
  const all = selectors(css);
  expect(all.length).toBeGreaterThan(5);
  for (const s of all) expect(s.startsWith(root), s).toBe(true);
}

describe('Batch G1 pages wear the arena workspace, scoped', () => {
  it('TableConfigPage: arena root, chrome mast, no SpadeConsole, new arena rules scoped', () => {
    const page = read('src/pages/TableConfigPage.tsx');
    expect(page).toContain('className="arena-workspace table-config-page__standalone"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('className="arena-case arena-ops-case table-config-page__case"');
    expect(page).not.toContain('SpadeConsole');

    const css = read('src/pages/TableConfigPage.css');
    const arenaBlock = css.slice(css.indexOf('/* ── #SmarterDesign arena workspace dress'));
    expectScoped(arenaBlock, '.arena-workspace');
  });

  it('CreateTablePage: arena root, chrome mast, ArenaGameCards unframed, every rule scoped', () => {
    const page = read('src/pages/CreateTablePage.tsx');
    expect(page).toContain('className="arena-workspace create-table-page__standalone"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('<ArenaGameCard');
    expect(page).not.toContain('SpadeConsole');
    expectScoped(read('src/pages/CreateTablePage.css'), '.arena-workspace');
  });

  it('ClubAdvertisePage: arena root, chrome mast, zero SpadeConsoles, every rule scoped', () => {
    const page = read('src/pages/ClubAdvertisePage.tsx');
    expect(page).toContain('className="club-advertise arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('SpadeConsole');
    expectScoped(read('src/pages/ClubAdvertisePage.css'), '.club-advertise.arena-workspace');
  });

  it('TournamentResultsPage: arena root, chrome mast, zero RewardsSurfaceHeader, every rule scoped', () => {
    const page = read('src/pages/tournament/TournamentResultsPage.tsx');
    expect(page).toContain('className="tournament-results-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('RewardsSurfaceHeader');
    expect(page).not.toContain('CasinoSurfaceHeader');
    expect(page).not.toContain('SpadeConsole');
    expectScoped(
      read('src/pages/tournament/TournamentResultsPage.css'),
      '.tournament-results-page.arena-workspace'
    );
  });
});
