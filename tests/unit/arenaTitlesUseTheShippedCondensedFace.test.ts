/**
 * The arena workspace lettering is narrow on every platform (2026-11-27).
 *
 * The workspace titles asked for 'Arial Narrow' first. Macs and Windows have
 * it; Android and Linux do not, so a phone fell back to wide Arial and the
 * same page read differently by device. The app already self-hosts Roboto
 * Condensed (scripts/self-host-fonts.mjs moves it onto our own origin), so
 * every stack that names 'Arial Narrow' names Roboto Condensed ahead of it,
 * and the shell preloads that face's latin file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

const SHEETS = ['src/components/lobby/ArenaWorkspace.css', 'src/components/club/RosterRecords.css'];

describe('arena workspace titles use the shipped condensed face', () => {
  it.each(SHEETS)('%s names Roboto Condensed before every Arial Narrow', (sheet) => {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
    const stacks = css.match(/[^;{}]*'Arial Narrow'[^;{}]*/g) ?? [];
    expect(stacks.length).toBeGreaterThan(0);
    for (const stack of stacks) {
      const condensed = stack.indexOf("'Roboto Condensed'");
      expect(condensed, stack.trim()).toBeGreaterThanOrEqual(0);
      expect(condensed, stack.trim()).toBeLessThan(stack.indexOf("'Arial Narrow'"));
    }
  });

  it('the section title itself leads with Roboto Condensed', () => {
    const css = read('src/components/lobby/ArenaWorkspace.css');
    const rule = /\.arena-workspace \.arena-section-title,[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font:\s*800 20px\/1\.05 'Roboto Condensed',\s*'Arial Narrow'/);
  });

  it('the face is self-hosted and preloaded, never fetched from a third party at runtime', () => {
    expect(read('scripts/prerender-public-routes.mjs')).toMatch(
      /PRERENDER_FONT_FAMILIES = \[[^\]]*'Roboto Condensed'[^\]]*\]/
    );
    expect(read('index.html')).toMatch(/family=Roboto\+Condensed:wght@400;500;600;700;800/);
    for (const sheet of SHEETS) expect(read(sheet)).not.toMatch(/@import|fonts\.googleapis/);
  });
});
