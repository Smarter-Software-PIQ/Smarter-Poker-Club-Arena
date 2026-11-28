/**
 * LAW: EVERY PSEUDO-ELEMENT `border-image` FRAME DECLARES AN EXPLICIT SOLID
 * BORDER AND BOX-SIZING, AND CLUB CARDS DO NOT NEST REDUNDANT GPU LAYERS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Incident (2026-11-28, Dan's iPhone screenshot of Poker Arena):
 *   On mobile iOS Safari, the metallic #SmarterDesign chrome frames vanished
 *   from club cards (Kings Club, Club Savage) in the Poker Arena carousel,
 *   leaving bare dark navy rectangles while the inner ID pills (which DID
 *   declare `border: 4px solid transparent`) kept their frames.
 *
 * Root causes fixed at source:
 *   1. `.sc.sc--sd.sc--sd::before` in `SpadeConsole.css` (and 23 sibling
 *      #SmarterDesign `::before`/`::after` frame rules across `src/`) declared
 *      `border-image: var(--sd-case) 41 / 19px stretch;` WITHOUT declaring
 *      `border-style: solid`, `border-width`, or `border-color: transparent`.
 *      Per CSS Backgrounds & Borders Level 3, `border-style` defaults to
 *      `none` and `border-width` to `0px`; iOS Safari's GPU compositor drops
 *      `border-image` on composited pseudo-elements whose computed
 *      `border-style` is `none`.
 *   2. `.club-card-panel` in `ClubCardPanel.css` declared
 *      `transform: translateZ(0); backface-visibility: hidden;` inside
 *      `.sp-carousel__item`, which already owns the compositor transform and
 *      `will-change: transform, opacity`. Nesting a second GPU layer around a
 *      `border-style: none` `::before` frame while `clubCardActivePulse`
 *      animated opacity caused WebKit to drop the frame paint layer on live
 *      club cards.
 *
 * What this law pins so missing mobile frames can NEVER regress again:
 *   1. Every `::before` / `::after` rule in stylesheets under `src/` that declares a
 *      non-none `border-image` MUST explicitly declare `box-sizing: border-box`,
 *      `border-style: solid` (or `border: ... solid`), and a positive
 *      `border-width` (matching the border-image width).
 *   2. `.sc.sc--sd.sc--sd::before` in `SpadeConsole.css` keeps explicit
 *      separate `border-style: solid`, `border-width: 19px`,
 *      `border-color: transparent`, `box-sizing: border-box`, and
 *      `border-image: var(--sd-case) 41 / 19px stretch`.
 *   3. `.club-card-panel` in `ClubCardPanel.css` must not declare
 *      `translateZ(0)` or `backface-visibility: hidden`.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

function walkCss(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCss(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('border-image frames declare explicit solid borders for iOS Safari', () => {
  it('every ::before / ::after border-image rule under src/ declares border-style: solid, border-width, and box-sizing: border-box', () => {
    const offenders: string[] = [];
    const ruleRe = /([^{}]+)\{([^{}]+)\}/g;

    for (const file of walkCss(SRC)) {
      const raw = readFileSync(file, 'utf8');
      if (!raw.includes('border-image')) continue;
      const clean = stripComments(raw);
      ruleRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = ruleRe.exec(clean))) {
        const selector = match[1].replace(/\s+/g, ' ').trim();
        const body = match[2];
        if (!/::(?:before|after)\b/.test(selector)) continue;
        if (!/(?:^|;|\s)border-image\s*:/.test(body)) continue;
        if (/border-image\s*:\s*none\b/.test(body)) continue;

        const hasSolid =
          /border-style\s*:\s*solid\b/.test(body) ||
          /(?:^|;|\s)border\s*:[^;]*\bsolid\b/.test(body);
        const hasWidth =
          /border-width\s*:\s*[1-9]/.test(body) || /(?:^|;|\s)border\s*:\s*[1-9]/.test(body);
        const hasBoxSizing = /box-sizing\s*:\s*border-box\b/.test(body);

        if (!hasSolid || !hasWidth || !hasBoxSizing) {
          const missing = [
            !hasSolid && 'border-style: solid',
            !hasWidth && 'border-width',
            !hasBoxSizing && 'box-sizing: border-box',
          ]
            .filter(Boolean)
            .join(', ');
          offenders.push(`${relative(ROOT, file)} :: ${selector} (missing ${missing})`);
        }
      }
    }

    expect(
      offenders,
      `Pseudo-element border-image rules missing explicit border declarations fail to paint on iOS Safari:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('SpadeConsole .sc.sc--sd.sc--sd::before declares explicit separate border properties before border-image', () => {
    const css = stripComments(
      readFileSync(join(ROOT, 'src/components/console/SpadeConsole.css'), 'utf8')
    );
    const match = css.match(/\.sc\.sc--sd\.sc--sd::before\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/box-sizing\s*:\s*border-box\s*;/);
    expect(body).toMatch(/border-style\s*:\s*solid\s*;/);
    expect(body).toMatch(/border-width\s*:\s*19px\s*;/);
    expect(body).toMatch(/border-color\s*:\s*transparent\s*;/);
    expect(body).toMatch(/border-image\s*:\s*var\(--sd-case\)\s+41\s*\/\s*19px\s+stretch\s*;/);
  });

  it('ClubCardPanel does not nest a redundant GPU compositing layer inside the carousel item', () => {
    const css = stripComments(
      readFileSync(join(ROOT, 'src/components/club/ClubCardPanel.css'), 'utf8')
    );
    const match = css.match(/(?:^|[\s}])\.club-card-panel\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).not.toMatch(/translateZ\(|translate3d\(/);
    expect(body).not.toMatch(/backface-visibility\s*:/);
  });
});
