/**
 * THE O2 OPERATOR MONEY PAGES KEEP THEIR #SmarterDesign DRESS INSIDE THEIR OWN
 * WORKSPACE (batch O2, 2026-11-28)
 *
 * Settlement History moved off the painted shark console onto the arena
 * workspace with a sheet of its own. Every rule of that sheet must apply only
 * under the page's own `.arena-workspace` root, so no other page that shares a
 * class name changes, and no sheet may draw its own gradient, shadow, radius or
 * hover: the chrome comes from ArenaWorkspace.css and ArenaOps.css. The page
 * keeps no painted console and no module sheet of the old dress.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const PAGES = [
  {
    page: 'src/pages/SettlementHistoryPage.tsx',
    sheet: 'src/pages/SettlementHistoryPage.css',
    root: 'settlement-history-page',
    retired: 'src/pages/SettlementHistoryPage.module.css',
  },
] as const;

function selectors(css: string): string[] {
  return [...strip(css).matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !s.startsWith('@') && !/^(from|to|\d+%)$/.test(s))
    .flatMap((group) => group.split(/,(?![^(]*\))/).map((s) => s.trim()));
}

describe('the O2 operator money pages wear the arena workspace', () => {
  it.each(PAGES)('$sheet scopes every selector under its page root', ({ sheet, root }) => {
    const all = selectors(read(sheet));
    expect(all.length).toBeGreaterThan(5);
    for (const selector of all)
      expect(selector, selector).toMatch(
        new RegExp(`^\\.arena-workspace\\.${root}[\\s.]|^\\.arena-workspace\\.${root}$`)
      );
  });

  it.each(PAGES)('$sheet draws no gradient, shadow, radius or hover of its own', ({ sheet }) => {
    const css = strip(read(sheet));
    expect(css).not.toMatch(/gradient\(/);
    expect(css).not.toMatch(/:hover/);
    expect(css).not.toMatch(/box-shadow/);
    expect(css).not.toMatch(/border-radius/);
  });

  it.each(PAGES)(
    '$page has an arena root and mast and no painted console',
    ({ page, root, retired }) => {
      const source = read(page);
      expect(source).toContain(`className="${root} arena-workspace"`);
      expect(source).toContain('<ArenaWorkspaceHeader');
      expect(source).toContain('arena-case arena-ops-case');
      expect(source).toContain('className="arena-section-title"');
      expect(source).not.toMatch(/SpadeConsole|PlateButton|sc-ink--|sc-copy/);
      expect(existsSync(retired)).toBe(false);
    }
  );

  it.each(PAGES)('$page names its section titles by their words alone', ({ page }) => {
    // #12353: a pill or count inside an h2 joins its accessible name.
    for (const title of read(page).matchAll(
      /<h2 className="arena-section-title">([\s\S]*?)<\/h2>/g
    ))
      expect(title[1], title[1]).not.toMatch(/<small|\{/);
  });
});
