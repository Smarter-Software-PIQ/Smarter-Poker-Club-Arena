/**
 * LAW: THE MOBILE GLOBAL HEADER NEVER APPEARS FADED OR BLURRED ON iOS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Incident (2026-11-28, Dan's iPhone screenshot of /hub/club-arena):
 *   The Club Arena mobile header appeared heavily dimmed/blurred across the
 *   upper portion of the bar.
 *
 * Root causes fixed at source:
 *   1. index.html declared apple-mobile-web-app-status-bar-style="black-translucent",
 *      which on iOS 26+ activates the system Liquid Glass progressive top blur
 *      (~38-40pt below the status bar) right across the global header artwork.
 *      Fixed to opaque "black".
 *   2. GlobalHeader.module.css `.frameFinish` applied
 *      `-webkit-backdrop-filter: brightness(0.45); backdrop-filter: brightness(0.45);`
 *      with `clip-path: polygon(evenodd, ...)`. On iOS Safari WebKit,
 *      backdrop-filter + evenodd clip-path can leak dimming across the interior
 *      and trips Safari 26's top-edge blur compositor. Because both header PNGs
 *      are 100% opaque (alpha 255 everywhere), plain alpha shading
 *      `background: rgba(0, 0, 0, 0.55)` produces the exact same 0.45 metal
 *      darkening with zero backdrop-filter compositor bugs.
 *   3. src/styles/globals.css left `html` without an explicit opaque background
 *      color. Fixed with `background: #0a0a1a;`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stripComments(css).match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `expected CSS rule for ${selector}`).not.toBeNull();
  return match![1];
}

describe('mobile global header is never faded or blurred on iOS', () => {
  it('index.html uses opaque black iOS status bar style (never black-translucent)', () => {
    const html = read('index.html');
    expect(html).toMatch(
      /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black"\s*\/>/
    );
    expect(html).not.toMatch(
      /apple-mobile-web-app-status-bar-style["']?\s+content=["']black-translucent["']/
    );
  });

  it('GlobalHeader.module.css never uses backdrop-filter, filter, mask-image, or resting opacity < 1', () => {
    const css = stripComments(read('src/components/navigation/GlobalHeader.module.css'));
    expect(css).not.toMatch(/(?:-webkit-)?backdrop-filter\s*:/i);
    expect(css).not.toMatch(/(?:-webkit-)?mask(?:-image)?\s*:/i);

    const frameFinish = ruleBody(css, '.frameFinish');
    expect(frameFinish).toMatch(/background\s*:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.55\s*\)/);

    const headerRule = ruleBody(css, '.header');
    const artworkRule = ruleBody(css, '.desktopArtwork');
    for (const [name, body] of [
      ['.header', headerRule],
      ['.desktopArtwork', artworkRule],
    ]) {
      expect(body, `${name} must not apply CSS filter`).not.toMatch(/(?:^|;|\s)filter\s*:/i);
      expect(body, `${name} must not reduce opacity at rest`).not.toMatch(
        /opacity\s*:\s*0?\.[0-9]+/i
      );
    }
  });

  it('src/styles/globals.css sets explicit opaque backgrounds on both html and body', () => {
    const css = stripComments(read('src/styles/globals.css'));
    const htmlRule = ruleBody(css, 'html');
    const bodyRule = ruleBody(css, 'body');
    expect(htmlRule).toMatch(/background(?:-color)?\s*:\s*#[0-9a-f]{3,6}\s*;/i);
    expect(bodyRule).toMatch(
      /background(?:-color)?\s*:\s*(?:#[0-9a-f]{3,6}|var\(--near-black\))\s*;/i
    );
  });
});
