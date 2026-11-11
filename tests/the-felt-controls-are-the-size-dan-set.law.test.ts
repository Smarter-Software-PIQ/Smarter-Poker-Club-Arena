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
 *   2. THE PHONE'S ACTION BUTTONS ARE DOUBLE. "they should be double the
 *      current size. we have alot of room on the bottom."
 *
 * (Dan's third size from that review - the hero avatar matching the villains'
 * - is NOT here. Resizing the hero moves the strip under the felt, the short
 * ring's height, the lane the hero's own hole cards sit in and the point where
 * the table starts shrinking revealed cards mid-hand, each of them a
 * hand-measured constant on thirteen devices. It is its own piece of work; see
 * docs/changelog/2026-11-09-six-live-table-fixes.md.)
 *
 * The geometry these produce is measured in a browser by
 * tests/e2e/table-proportions.spec.ts and the mobile layout specs. This file
 * guards the declarations themselves, which is the half a headless measurement
 * cannot explain when it goes red.
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
const ACTION_CSS = strip(read('src/components/table/ActionPanel.css'));

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

describe('the phone action buttons are double', () => {
  it('declares 96px for a phone, and keeps the two screens that cannot take it', () => {
    expect(ACTION_CSS).toMatch(/--sp-action-btn-h:\s*96px/);
    // 375x667 and 320x568 keep the heights they have today, each for its own
    // measured reason (ActionPanel.css carries both). A later block wins, so
    // the order of these three is what decides a phone's bar - which is why
    // the count is pinned as well as the values.
    expect(ACTION_CSS).toMatch(/--sp-action-btn-h:\s*52px/);
    expect(ACTION_CSS).toMatch(/--sp-action-btn-h:\s*48px/);
    // The fourth is the phone TABLE (Dan 2026-11-11): a portrait phone lays the
    // table out at the 600px desktop width, where none of the <=480px blocks
    // above can match, so the doubled row is declared in the one query that
    // names that layout.
    expect((ACTION_CSS.match(/--sp-action-btn-h:\s*\d+px/g) ?? []).length).toBe(4);
  });

  it('doubles the row at the phone table, the 600px layout a portrait phone plays in', () => {
    const query =
      '@media (max-device-width: 480px) and (min-width: 481px) and (orientation: portrait) {';
    const at = ACTION_CSS.lastIndexOf(query);
    expect(at, 'the phone table query is declared').toBeGreaterThan(-1);
    // It must be the LAST height declaration, or a later block out-orders it.
    const after = ACTION_CSS.slice(at);
    expect(after).toMatch(/--sp-action-btn-h:\s*104px/);
    expect(ACTION_CSS.slice(at + after.indexOf('104px'))).not.toMatch(/--sp-action-btn-h:\s*\d+px/);
  });

  it('and the reserve is still derived from it rather than restated', () => {
    expect(ACTION_CSS).toMatch(
      /--sp-bottom-row-h:\s*calc\(1px \+ var\(--sp-action-pad-top\) \+ var\(--sp-action-btn-h\)\)/
    );
  });
});
