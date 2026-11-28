/**
 * THE P6 PLAYER PAGES' ARENA DRESS IS SCOPED TO EACH PAGE
 * (#SmarterDesign player pages batch P6, 2026-11-28)
 *
 * /bonuses wears the arena workspace. Its sheet is shared with the modal the
 * shell raises on entry, so the sheet's own stylesheet is untouched and every
 * rule that dresses it sits under the page's arena root; the modal keeps its
 * painted console. Each rule here is the shape of a regression that would
 * leak the arena onto another host or bring the painted header back.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

/** Every selector in a sheet, comments and keyframe steps left out. */
function selectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)/.test(s))
    .flatMap((s) => s.split(/,(?![^(]*\))/))
    .map((s) => s.trim());
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Daily Bonus wears the arena workspace, scoped to its page', () => {
  const page = read('src/pages/DailyBonusPage.tsx');
  const css = read('src/pages/DailyBonusPage.css');

  it('the page root carries the arena workspace and the chrome mast, never the painted header', () => {
    expect(page).toContain('className="daily-bonus-page arena-workspace"');
    expect(page).toContain('<ArenaWorkspaceHeader');
    expect(page).toContain('className="arena-case arena-ops-case daily-bonus-page__case"');
    expect(page).toContain('className="arena-section-title"');
    expect(page).not.toContain('RewardsSurfaceHeader');
    expect(page).not.toContain('SpadeConsole');
    // The sheet prints its frameless glass variant inside the case.
    expect(page).toContain('mode="inline" chassis="glass"');
  });

  it('every rule in the page sheet sits under the page arena root', () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) expect(s.startsWith('.daily-bonus-page.arena-workspace')).toBe(true);
  });

  it('leaves the shared sheet stylesheet untouched by the arena', () => {
    expect(read('src/components/daily-bonus/DailyBonusSheet.css')).not.toContain('arena');
  });

  it('only this page sets the sheet on its glass', () => {
    const hosts = sources('src')
      .filter((path) => /<DailyBonusSheet\b[^>]*chassis="glass"/.test(read(path)))
      .sort();
    expect(hosts).toEqual([join('src', 'pages', 'DailyBonusPage.tsx')]);
  });
});
