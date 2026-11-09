/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FELT'S CONTROLS ARE THE SIZE DAN SET (2026-11-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three sizes from one screenshot review, each of which had already been asked
 * for once and each of which had drifted back by a different mechanism. They
 * are pinned together because they are one complaint - "these controls are the
 * wrong size" - and because every one of them is a single token that any
 * later rule can quietly out-order.
 *
 *   1. THE FOUR TABLE TOOLS ARE THE HAMBURGER'S SIZE. "the message button,
 *      previous hand, time bank and rabbit hunt buttons should all be the same
 *      size as the hamburger menu button." Asked for on 2026-11-01 and done
 *      HALF: the tiles moved to --sp-tabbar-control, and the painted frame -
 *      the normalisation in TableToolIconSizing.css, which is what a player
 *      actually sees - stayed on the 40px Lobby footprint. Measured off Dan's
 *      screenshot: hamburger 39px, each tool 30-31px, i.e. 40/52 of it.
 *
 *   2. THE HERO IS THE SAME SIZE AS EVERY VILLAIN. "the 'hero' avatar is
 *      smaller then all the other avatars at the table, it should always be
 *      the same size", superseding 2026-08-15's "33% bigger". The frame was
 *      1.3333x and the BUST inside it was not (it reads --seat-avatar-base,
 *      which the hero never redeclared), so the hero was a villain-sized
 *      character in an oversized box.
 *
 *   3. THE PHONE'S ACTION BUTTONS ARE DOUBLE. "they should be double the
 *      current size. we have alot of room on the bottom."
 *
 * The geometry these produce is measured in a browser by
 * tests/e2e/table-proportions.spec.ts (the hero ratio) and the mobile layout
 * specs. This file guards the declarations themselves, which is the half a
 * headless measurement cannot explain when it goes red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
/* Comments in these files quote the old numbers on purpose (they say what was
   wrong and why), so every assertion runs against the stripped source. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const TOOL_SIZING = strip(read('src/components/table/TableToolIconSizing.css'));
const HUD_CSS = strip(read('src/components/table/TableHUD.css'));
const CHAT_CSS = strip(read('src/components/table/TableChat.css'));
const SEAT_CSS = strip(read('src/components/table/SeatSlot.css'));
const ACTION_CSS = strip(read('src/components/table/ActionPanel.css'));
const TOKENS = strip(read('src/styles/design-tokens.css'));

describe('the four table tools are the hamburger size', () => {
  it('normalises the painted frame against the tab-bar control, not the Lobby tile', () => {
    expect(TOOL_SIZING).toMatch(/--sp-table-tool-frame:\s*var\(--sp-tabbar-control,\s*52px\)/);
    // The frame is what the width, the height and the art offset all read.
    // A stray --sp-game-tool-size here is the 2026-11-01 half-fix returning.
    const rule = TOOL_SIZING.slice(TOOL_SIZING.indexOf('.table-page'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).not.toMatch(/--sp-game-tool-size/);
    expect(block).toMatch(/width:\s*calc\(var\(--sp-table-tool-frame\)/);
    expect(block).toMatch(/height:\s*calc\(var\(--sp-table-tool-frame\)/);
  });

  it('covers all four of the controls Dan named', () => {
    for (const icon of [
      'chat-collapsed__icon-img',
      'tbc-icon-img',
      'rabbit-hunt__icon-img',
      'prev-hand-card__icon-img',
    ]) {
      expect(TOOL_SIZING, `${icon} is not normalised with the others`).toContain(icon);
    }
  });

  it('and their boxes read the same control, so box and art cannot disagree', () => {
    expect(HUD_CSS).toMatch(/--sp-hud-tile-size:\s*var\(--sp-tabbar-control,\s*52px\)/);
    expect(CHAT_CSS).toMatch(/width:\s*var\(--sp-tabbar-control,\s*52px\)/);
  });
});

describe('the hero avatar is the same size as every other avatar', () => {
  it('the hero ratio is 1, where it is declared and where it is read', () => {
    // The DECLARATION is the one that decides it. The fallback below only
    // matters outside the token sheet, and a fallback that disagrees with the
    // declared value is how a preview renders a table nobody ships.
    expect(TOKENS).toMatch(/--seat-avatar-hero-ratio:\s*1;/);
    expect(SEAT_CSS).toMatch(
      /--seat-avatar-size:\s*calc\(var\(--seat-avatar-base,\s*84px\)\s*\*\s*var\(--seat-avatar-hero-ratio,\s*1\)\)/
    );
  });

  it('and no rung may pin the hero to its own number again', () => {
    // The 2026-08-28 regression: three `!important` hero sizes inside
    // breakpoints, out-ordering the proportional declaration on every phone.
    const heroSizeDeclarations = SEAT_CSS.match(/--seat-avatar-size:/g) ?? [];
    expect(heroSizeDeclarations.length).toBeLessThanOrEqual(2);
    expect(SEAT_CSS).not.toMatch(/--seat-avatar-size:[^;]*!important/);
  });
});

describe('the phone action buttons are double', () => {
  it('declares 104px at the phone breakpoint and 96px on the smallest', () => {
    expect(ACTION_CSS).toMatch(/--sp-action-btn-h:\s*104px/);
    // The 340px block comes LAST and therefore wins on a 320px screen. It is
    // doubled too, or the device with the least room to read a button on is
    // the one device whose bar did not grow.
    expect(ACTION_CSS).toMatch(/--sp-action-btn-h:\s*96px/);
    // Two literal declarations, and no third: every other width rides the
    // continuous clamp at the top of the file.
    expect((ACTION_CSS.match(/--sp-action-btn-h:\s*\d+px/g) ?? []).length).toBe(2);
  });

  it('and the reserve is still derived from it rather than restated', () => {
    expect(ACTION_CSS).toMatch(
      /--sp-bottom-row-h:\s*calc\(1px \+ var\(--sp-action-pad-top\) \+ var\(--sp-action-btn-h\)\)/
    );
  });
});
