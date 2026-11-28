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

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(','))
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

  it('the shared state screens take the arena dress only by opt-in', () => {
    const source = read('src/components/common/EmptyState.tsx');
    expect(source).toContain('arena = false');
    expectScoped(read('src/components/common/EmptyStateArena.css'), '.arena-workspace ');
    expect(read('src/components/common/EmptyState.module.css')).not.toContain('arena');
  });
});
