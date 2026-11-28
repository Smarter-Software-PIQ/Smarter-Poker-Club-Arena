/**
 * Post-deploy run 46101513017 (live a735262e5): at 480px PERFORMANCE drew in
 * an Arial-width face, 105.9px inside a 107.5px grid track, and ran 2px into
 * the 6px chrome edge of its Stats section tab. A grid track cannot grow for
 * its label, so the tabs are flex items that may not shrink below their own
 * label plus padding that clears the chrome. The rendered proof is
 * expectStatsTabLabelsFit in tests/e2e/support/statsPanelLayout.ts; this pins
 * the CSS it depends on so the bar cannot go back to fixed tracks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const CSS = readFileSync(resolve(root, 'src/pages/PlayerStatsPage.css'), 'utf8');
const ARENA = readFileSync(resolve(root, 'src/components/lobby/ArenaWorkspace.css'), 'utf8');

function lastBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...CSS.matchAll(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  expect(matches.length, `${selector} must be declared`).toBeGreaterThan(0);
  return matches.at(-1)![2];
}

function chromeEdgePx(): number {
  const rule = ARENA.match(
    /\.arena-workspace \.stats-pill-tabs > :is\(button, a\)::after \{[^}]*border-image:[^;]*\/\s*(\d+(?:\.\d+)?)px/
  );
  expect(rule, 'the Stats tab chrome edge width must be readable').not.toBeNull();
  return Number(rule![1]);
}

describe('a Stats section tab is never narrower than its label', () => {
  it('wraps the tabs as flex items, not fixed grid tracks', () => {
    const bar = lastBlock('.stats-page.arena-workspace .stats-pill-tabs');
    expect(bar).toMatch(/display:\s*flex/);
    expect(bar).toMatch(/flex-wrap:\s*wrap/);
    expect(bar).not.toMatch(/grid-template-columns/);
  });

  it('never lets a tab shrink below its label, and keeps the 6.5rem ask', () => {
    const tab = lastBlock('.stats-page.arena-workspace .stats-pill-tabs > button');
    expect(tab).toMatch(/min-width:\s*max-content/);
    expect(tab).toMatch(/flex:\s*1 1 6\.5rem/);
  });

  it('pads each side past the chrome edge, so max-content clears it', () => {
    const tab = lastBlock('.stats-page.arena-workspace .stats-pill-tabs > button');
    const pad = tab.match(/padding-inline:\s*(\d+(?:\.\d+)?)px/);
    expect(pad, 'the tab declares its own inline padding').not.toBeNull();
    expect(Number(pad![1])).toBeGreaterThan(chromeEdgePx());
  });

  it('keeps a short last row on the column width of the rows above it', () => {
    expect(CSS).toMatch(
      /@container stats-section-tabs \(min-width: 20rem\) \{\s*\.stats-page\.arena-workspace \.stats-pill-tabs:has\(> button:nth-child\(4\)\) > button \{\s*max-width: calc\(\(100% - 8px\) \/ 3\);/
    );
    expect(lastBlock('.stats-page.arena-workspace .stats-pill-tabs')).toMatch(
      /container:\s*stats-section-tabs \/ inline-size/
    );
  });
});
