/**
 * STAND UP & LEAVE IS IN THE UPPER LEFT (Dan 2026-11-08): "THE 'STAND UP &
 * LEAVE' BUTTON SHOULD NOT BE IN THE MIDDLE OF THE TABLE. IT SHOULD BE IN THE
 * UPPER LEFT HAND CORNER BELOW THE HAMBURGER MENU. NOT OVERLAPPING ANYTHING OR
 * INSIDE ITS CURRENT LOCATION. ... IT SHOULD BE LINED UP HOW THE 'CHAT MESSAGE
 * ICON IS'."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const PAGE = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
const HUD = readFileSync(
  resolve(__dirname, '../../src/components/table/TableHUD.tsx'),
  'utf8'
);
const CSS = strip(
  readFileSync(resolve(__dirname, '../../src/components/table/TableHUD.css'), 'utf8')
);
const CHAT_CSS = strip(
  readFileSync(resolve(__dirname, '../../src/components/table/TableChat.css'), 'utf8')
);

const rule = (css: string, selector: string) => {
  const at = css.indexOf(selector);
  return at < 0 ? null : css.slice(at, css.indexOf('}', at));
};

describe('stand up & leave placement', () => {
  it('is in the left dock, never the centring slot', () => {
    expect(PAGE).toMatch(/leftDock=\{/);
    const dock = PAGE.indexOf('leftDock={');
    const control = PAGE.indexOf('<LightningLeaveControl', dock);
    expect(control).toBeGreaterThan(dock);
    // Nothing centres it any more: the one centring slot is unused.
    expect(PAGE).not.toMatch(/centerTop=\{/);
  });

  it('the HUD renders the dock around whatever it is handed', () => {
    expect(HUD).toMatch(/leftDock\?: React\.ReactNode/);
    expect(HUD).toMatch(/className="hud-leave-dock">\{leftDock\}/);
  });

  it('is pinned to the left edge, never the right', () => {
    const dock = rule(CSS, '.hud-leave-dock {');
    expect(dock).not.toBeNull();
    expect(dock).toMatch(/position:\s*fixed/);
    expect(dock).toMatch(/left:\s*6px/);
    expect(dock).toMatch(/right:\s*auto/);
  });

  it('sits on the same line as the chat icon', () => {
    const dock = rule(CSS, '.hud-leave-dock {') ?? '';
    const chat = CHAT_CSS.slice(CHAT_CSS.indexOf('.chat-collapsed {'));
    const anchor = /top:\s*calc\(env\(safe-area-inset-top,\s*0px\)\s*\+\s*54px\)/;
    expect(dock).toMatch(anchor);
    expect(chat).toMatch(anchor);
  });

  it('takes the same under-bar gap as chat inside a multi-table slot', () => {
    const dock = rule(CSS, '.multi-table-page .hud-leave-dock {');
    expect(dock).not.toBeNull();
    expect(dock).toMatch(/position:\s*absolute/);
    expect(dock).toMatch(/top:\s*12px/);
    expect(CHAT_CSS).toMatch(/\.multi-table-page \.chat-collapsed \{[^}]*top:\s*12px/);
  });
});
