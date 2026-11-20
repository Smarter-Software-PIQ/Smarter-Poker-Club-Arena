/**
 * TABLE CHAT HAS ONE STYLESHEET, AND ITS RESTING STATE IS ON SCREEN (2026-11-19).
 *
 * Player "nevin" reported he could not chat at a live table. Nobody could: no
 * human table chat reached `table_chat` from 22:21 Chicago on 2026-11-15
 * until this fix, while horses (server inserts) kept talking.
 *
 * Cause: `src/pages/TablePage.css` carried an April 2026 `.table-chat` rule
 * whose RESTING transform was `translateX(100%)`, relying on
 * `animation: slideInChat 0.3s forwards` to bring the panel on screen.
 * `TableChat.css` declares `animation: chatSlideUp` on the same selector at
 * the same specificity. Which one won was decided by stylesheet order in the
 * bundle. #11049 made SharedTableStage import TablePage.css, the order
 * flipped, chatSlideUp won, and the open chat sat one panel-width off the
 * right edge of the screen with its input unreachable.
 *
 * Two pins, one per half of that cause:
 *   1. No stylesheet but TableChat.css may declare a rule that targets the
 *      `.table-chat` element itself. (The popup chassis in
 *      metallic-popups.css lists it inside a zero-specificity `:where()` and
 *      only paints; it is the one sanctioned reader and may not position or
 *      move the sheet.)
 *   2. TableChat.css may never park the sheet off screen at rest: no
 *      `.table-chat` rule carries a translate, and the sheet's entry
 *      keyframes end at the identity, so the panel is on screen whether or
 *      not its animation runs, finishes, or is overridden.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');
const OWNER = 'src/components/table/TableChat.css';
const CHASSIS = 'src/styles/metallic-popups.css';

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (/\.(css|scss)$/.test(name)) out.push(p);
  }
  return out;
}

/** Comment-free CSS, so a tombstone that names the old rule is not a rule. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector list paired with its declaration block, at any nesting depth. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** True when a selector list addresses the `.table-chat` element itself. */
const targetsSheet = (selector: string) => /\.table-chat(?![\w-])/.test(selector);

describe('table chat has one stylesheet', () => {
  it('no stylesheet but TableChat.css styles the .table-chat element', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (rel === OWNER) continue;
      for (const { selector, body } of rules(stripComments(readFileSync(file, 'utf8')))) {
        if (!targetsSheet(selector)) continue;
        if (rel === CHASSIS) {
          // Paint only: the chassis may never move or place the sheet.
          expect(
            body,
            `${CHASSIS} may paint .table-chat but never position or move it`
          ).not.toMatch(/(^|[;\s])(transform|animation|left|right|top|bottom|inset|width|height|display|visibility)\s*:/);
          continue;
        }
        offenders.push(`${rel}: ${selector.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(offenders, 'move these declarations into TableChat.css').toEqual([]);
  });

  it('the sheet is on screen at rest, whatever its animation does', () => {
    const css = stripComments(readFileSync(join(ROOT, OWNER), 'utf8'));
    for (const { selector, body } of rules(css)) {
      if (!targetsSheet(selector)) continue;
      expect(body, `${selector} must not translate the sheet at rest`).not.toMatch(
        /transform\s*:\s*[^;]*translate/
      );
      expect(body, `${selector} must not depend on animation-fill-mode`).not.toMatch(
        /animation[^;]*\b(forwards|both)\b/
      );
    }
    const sheet = rules(css).find((r) => r.selector === '.table-chat');
    expect(sheet, 'TableChat.css owns a top-level .table-chat rule').toBeTruthy();
    const anim = /animation\s*:\s*([\w-]+)/.exec(sheet!.body)?.[1];
    expect(anim, '.table-chat names its entry animation').toBeTruthy();
    const kf = new RegExp(`@keyframes\\s+${anim}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
    const to = /\bto\s*\{([^}]*)\}/.exec(kf)?.[1] ?? '';
    expect(to, `${anim} must end with the sheet in place`).toMatch(/translate[XY]?\(\s*0(px)?\s*\)|transform\s*:\s*none/);
  });
});
