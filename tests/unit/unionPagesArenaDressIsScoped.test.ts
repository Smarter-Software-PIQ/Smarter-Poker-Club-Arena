/**
 * THE UNION PAGES' ARENA DRESS IS SCOPED TO THEIR PAGES (#SmarterDesign batch
 * U1, 2026-11-28)
 *
 * The Union pages wear the arena workspace. Each page's own sheet dresses it
 * only under that page's arena root, and the shared state screens
 * (EmptyState, ErrorState, LoadingState) take the arena dress only through an
 * opt-in `arena` prop whose sheet is scoped under `.arena-workspace`, so every
 * other page that mounts them keeps the beacon panel.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

/** Split a selector list on its top-level commas, not those inside :is(). */
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

describe('the Union pages wear the arena workspace, scoped', () => {
  it('Unions: the arena root, the chrome mast, every rule under the root', () => {
    const page = read('src/pages/UnionsPage.tsx');
    expect(page).toContain('className="unions-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('SpadeConsole');
    expectScoped(read('src/pages/UnionsPage.css'), '.unions-page.arena-workspace');
  });

  it('Union Command: the arena root, the chrome mast, every rule under the root', () => {
    const page = read('src/pages/UnionDetailPage.tsx');
    expect(page).toContain('className="union-detail arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('SpadeConsole');
    expectScoped(read('src/pages/UnionDetailArena.css'), '.union-detail.arena-workspace');
    // The game keys take the arena switch through GameCreationActions' own opt-in.
    expect(page).toMatch(/<GameCreationActions[^>]*\barena\b/);
  });

  it('Forge A Union: the arena root, the chrome mast, every rule under the root', () => {
    const page = read('src/pages/CreateUnionPage.tsx');
    expect(page).toContain('className="create-union arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('SpadeConsole');
    expectScoped(read('src/pages/CreateUnionPage.css'), '.create-union.arena-workspace');
  });

  it('Union Data: the arena root, the chrome mast, every rule under the root', () => {
    const page = read('src/pages/UnionDataPage.tsx');
    expect(page.match(/className="union-data arena-workspace"/g)?.length).toBe(2);
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).not.toContain('CasinoSurfaceHeader');
    const css = read('src/pages/UnionDataPage.css');
    for (const s of selectors(css))
      expect(s.startsWith('.union-data.arena-workspace'), s).toBe(true);
  });

  it('the arena state screens ride the arena pages, never the entry chunk', () => {
    // EmptyState.tsx is in the entry chunk, so it stays untouched; the arena
    // variants live in their own module, imported only by the arena pages.
    const source = read('src/components/common/EmptyState.tsx');
    expect(source).not.toMatch(/EmptyStateArena|ArenaOps|arena-ops/);
    const arena = read('src/components/common/EmptyStateArena.tsx');
    expect(arena).toContain("import './EmptyStateArena.css';");
    for (const page of ['src/pages/UnionsPage.tsx', 'src/pages/UnionDetailPage.tsx']) {
      expect(read(page), page).toContain("from '../components/common/EmptyStateArena'");
    }
    expectScoped(read('src/components/common/EmptyStateArena.css'), '.arena-workspace ');
    expect(read('src/components/common/EmptyState.module.css')).not.toContain('arena');
  });
});
