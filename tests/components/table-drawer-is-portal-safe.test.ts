/**
 * THE TABLE'S #SMARTERDESIGN FOLLOW-UPS STAY FIXED (2026-11-27)
 *
 * #12280 moved the table to #SmarterDesign. Rendering every table surface at
 * 393px afterwards found five places it had not reached, each fixed in the
 * follow-up and pinned here so it cannot slip back:
 *
 * 1. THE DRAWER. TableMenu portals its drawer to document.body, so the
 *    drawer is never a descendant of `.table-menu`. Its #SmarterDesign rules
 *    were written as `.table-menu .table-menu__*` and matched nothing in the
 *    app: the live drawer stayed the old generic panel. A drawer rule must be
 *    anchored on the drawer itself.
 * 2. LEAVE TABLE rounded a cash stack: 412.50 printed as "413" (Dan
 *    2026-11-13: real figures are never rounded).
 * 3. GAME RULES printed the raw variant code ("nlh Rules") once the painted
 *    uppercase transform retired.
 * 4. THE CHAT SHEET was still the generic panel, with an amber dealer line and
 *    a gold mention highlight.
 * 5. HAND DETAIL still printed gold (winning hand, private tag, primary rake
 *    share) and its full-screen head started under the tab strip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the table #SmarterDesign follow-ups', () => {
  it('the drawer portals out of .table-menu, so its rules are anchored on the drawer', () => {
    const tsx = read('src/components/table/TableMenu.tsx');
    expect(tsx).toContain('createPortal(');
    expect(tsx).toContain('className="table-menu__dropdown"');
    const css = code(read('src/components/table/TableMenu.css'));
    expect(css).not.toMatch(/\.table-menu\s+\.table-menu__/);
    expect(css).toContain('.table-menu__dropdown.table-menu__dropdown {');
    expect(css).toMatch(/\.table-menu__dropdown \.table-menu__action\s*\{/);
  });

  it('Leave Table prints the cash stack exactly', () => {
    const tsx = read('src/components/table/LeaveTableConfirm.tsx');
    expect(tsx).toContain('<strong>{exactChips(currentStack)}</strong> Chips At');
  });

  it('Game Rules names the variant in capitals', () => {
    expect(read('src/components/table/GameRulesModal.tsx')).toContain(
      'title={`${vUpper || variant} Rules`}'
    );
  });

  it('the chat sheet wears the material, with no amber or gold left', () => {
    const css = code(read('src/components/table/TableChat.css'));
    expect(css).toContain('.table-chat.table-chat {');
    expect(css).toContain('/assets/club-buttons/console/smarterdesign-v1/chrome-case.webp');
    const sd = css.slice(css.indexOf('.table-chat.table-chat {'));
    expect(sd).toMatch(/\.chat-message--dealer\s*\{[^}]*background:\s*#071421/);
    expect(sd).toMatch(
      /\.chat-message--highlighted \.chat-message__bubble\s*\{[^}]*(?:#86daff|#74dfff|var\(--sd-ice(?:-strong)?\))/
    );
  });

  it('Hand Detail prints no gold and starts below the tab strip', () => {
    const css = read('src/components/table/HandDetailModal.css');
    expect(css).not.toMatch(/#ffd700|255 215 0/i);
    expect(css).toMatch(/\.hdm-console\.sc--sd\s*\{\s*margin-top:\s*var\(--sp-tabbar-h, 0px\);/);
  });
});
