/**
 * THE SEAT CHANGE BUTTON IS ON THE LEFT (Dan 2026-10-14): "THE 'SEAT CHANGE'
 * BUTTON SHOULD NEVER BE IN THE UPPER RIGHT HAND CORNER, IT SHOULD BE ON THE
 * LEFT SIDE."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE = readFileSync(resolve(__dirname, '../../src/pages/TablePage.tsx'), 'utf8');
const CSS = readFileSync(
  resolve(__dirname, '../../src/components/table/TableHUD.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

describe('seat change dock', () => {
  it('wraps the cash must-move box', () => {
    const dock = PAGE.indexOf('<div className="hud-seat-change-dock">');
    const hud = PAGE.indexOf('<CashClusterHUD', dock);
    expect(dock).toBeGreaterThan(0);
    expect(hud - dock).toBeLessThan(80);
  });

  it('uses the chat tile size on every feeder and shares its vertical anchor', () => {
    const chat = readFileSync(
      resolve(__dirname, '../../src/components/table/TableChat.css'),
      'utf8'
    );
    const dockSizes = [...CSS.matchAll(/\.hud-seat-change-dock \{([^}]+)}/g)];
    expect(dockSizes).toHaveLength(1);
    expect(dockSizes[0][1]).toContain('--sp-hud-tile-size: var(--sp-tabbar-control, 52px)');
    expect(chat).toMatch(
      /\.chat-collapsed,\s*\.hud-seat-change-dock \{[^}]*top: var\(--table-chat-top\)/
    );
    expect(chat).toContain('left: var(--table-chat-edge, 8px)');
    expect(chat).toContain('right: var(--table-chat-edge, 8px)');
    expect(chat).toMatch(
      /\.hud-seat-change-dock:has\(\.cch-seat-change--control\) \{[^}]*bottom: var\(--sp-hud-line\)/
    );
  });
});
