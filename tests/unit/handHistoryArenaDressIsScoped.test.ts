/**
 * THE HAND ARCHIVE'S ARENA DRESS IS SCOPED TO ITS PAGE (#SmarterDesign player
 * pages batch P4, 2026-11-28)
 *
 * /hand-history wears the arena workspace. Its dress lives in
 * HandHistoryArena.css, and every rule of it is scoped under the page's arena
 * root, so nothing it renders elsewhere (the hand rundown, the Hand Detail
 * dialog, the replay) and no other page changes. The page left the Play &
 * Review surface: the shared Play Circuit sheet no longer names it, so its
 * `!important` record frames cannot overpaint the arena rows and meters.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const arenaCss = read('src/pages/HandHistoryArena.css');
const page = read('src/pages/HandHistoryPage.tsx');

function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(/,(?![^(]*\))/))
    .map((s) => s.trim());
}

describe('the Hand Archive arena dress is scoped', () => {
  it('the page root carries the arena workspace and its mast', () => {
    expect(page).toContain('className="hand-history-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain("import './HandHistoryArena.css';");
  });

  it('scopes every rule under the page arena root', () => {
    const all = selectors(arenaCss);
    expect(all.length).toBeGreaterThan(30);
    for (const s of all) expect(s.startsWith('.hand-history-page.arena-workspace')).toBe(true);
  });

  it('the Play Circuit sheet no longer frames the Hand Archive', () => {
    expect(read('src/components/rewards/PlayCircuitSurfaces.css')).not.toContain(
      'hand-history-page'
    );
  });

  it('never restyles the hand rundown, the dialog or the replay', () => {
    expect(arenaCss).not.toMatch(/\.(hdm-|hand-detail|replay-modal|modal-close)/);
  });
});
