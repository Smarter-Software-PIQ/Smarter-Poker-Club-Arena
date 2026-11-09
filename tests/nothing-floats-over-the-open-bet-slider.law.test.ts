/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NOTHING FLOATS OVER THE OPEN BET SLIDER, AND NOTHING SITS ON THE TOP SEAT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two placement defects Dan reported on 2026-11-09, both of them a control
 * standing where the player needs to look.
 *
 * 1. "the action slider menu that pops up when click raise, allows the time
 *    bank to appear and bleed through." The stopwatch tile sat on the 33%
 *    preset. `.ca-raising` (TablePage.css) was working - the previous-hand
 *    card and the chat bubble beside it were both correctly gone - and that
 *    tile still painted, because it carries `position: relative` and a
 *    `backdrop-filter` (TimebankCounter.css): a stacking context of its own,
 *    on a compositor that does not have to agree with us about an inherited
 *    `visibility`.
 *
 *    So the guarantee is no longer a rule. ActionPanel reports its raise mode
 *    up and TablePage UNMOUNTS that corner while the overlay is open. A
 *    control that is not in the tree cannot be composited over the slider on
 *    any engine. `.ca-raising` stays beside it, unchanged, because it is also
 *    what hides the chat bubble and dims the rest.
 *
 * 2. "the stand up and leave button for lightning games needs to move to the
 *    left side, not in the middle of the table covering the top villain. And
 *    it should just say, 'Leave Next Hand'." It was in TableHUD's `centerTop`
 *    slot - the centre of the upper row, which is exactly where the top seat
 *    is. Dan said the same thing on 2026-11-08: upper left, under the
 *    hamburger, overlapping nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');

const TABLE_PAGE = read('src/pages/TablePage.tsx');
const TABLE_PAGE_CSS = strip(read('src/pages/TablePage.css'));
const ACTION_PANEL = read('src/components/table/ActionPanel.tsx');
const LEAVE_CONTROL = read('src/components/lightning/LightningLeaveControl.tsx');

describe('the bottom-left corner stands down while a bet is being sized', () => {
  it('the panel reports its raise mode up, and clears it on unmount', () => {
    expect(strip(ACTION_PANEL)).toMatch(/onRaiseModeChange\?\.\(isRaiseMode\);/);
    // The cleanup is the half that matters when the hand ends mid-raise: a
    // panel that unmounts while open would otherwise leave the corner gone.
    expect(strip(ACTION_PANEL)).toMatch(/onRaiseModeChange\?\.\(false\);/);
  });

  it('the table unmounts that corner rather than trusting the cascade', () => {
    expect(strip(TABLE_PAGE)).toMatch(
      /const \[raisePanelOpen, setRaisePanelOpen\] = useState\(false\);/
    );
    expect(strip(TABLE_PAGE)).toMatch(/onRaiseModeChange=\{setRaisePanelOpen\}/);
    expect(strip(TABLE_PAGE)).toMatch(/raisePanelOpen \? null : \(/);
  });

  it('and the rule that hides the rest of it is still there beside it', () => {
    // Belt and braces, deliberately. Removing this block puts the chat bubble
    // back on top of the presets, which is a different 2026-08 defect.
    expect(TABLE_PAGE_CSS).toMatch(/\.table-page\.ca-raising \.table-hud__lower/);
    expect(TABLE_PAGE_CSS).toMatch(/\.table-page\.ca-raising \.tbc-widget/);
    expect(TABLE_PAGE_CSS).toMatch(/\.table-page\.ca-raising \.chat-collapsed/);
  });
});

describe('the Lightning leave control is in the upper left, not on the top seat', () => {
  it('is no longer rendered into the HUD centre', () => {
    expect(strip(TABLE_PAGE)).not.toMatch(/centerTop=/);
  });

  it('renders in the upper-left stack, and not only when the table is standalone', () => {
    const body = strip(TABLE_PAGE);
    const stack = body.indexOf('hud-ul-column hud-ul-column--stack');
    const leave = body.indexOf('<LightningLeaveControl');
    const upperRight = body.indexOf('upperRight=');
    expect(stack).toBeGreaterThan(-1);
    // Inside the upper-left prop: after its stack opens, before the next
    // corner begins.
    expect(leave).toBeGreaterThan(stack);
    expect(leave).toBeLessThan(upperRight);
    // An embedded table is EXACTLY the Lightning case: its hamburger lives in
    // the tab bar, so the menu column is nulled. Gating the leave control on
    // the same condition would delete it from the product, so its own
    // condition is the Lightning room and nothing else.
    expect(body.slice(stack, leave)).toMatch(/embeddedTableId \? null/);
    const ownGuard = body.slice(body.lastIndexOf('{', leave), leave);
    expect(ownGuard).toMatch(/lightningRoom && !lightningRoomClosed/);
    expect(ownGuard).not.toMatch(/embeddedTableId/);
  });

  it('the stack is transparent to taps so it cannot become a slab over the seats', () => {
    expect(TABLE_PAGE_CSS).toMatch(
      /\.table-hud__corner > \.hud-ul-column--stack \{\s*pointer-events: none;/
    );
    expect(TABLE_PAGE_CSS).toMatch(
      /\.table-hud__corner > \.hud-ul-column--stack > \* \{\s*pointer-events: auto;/
    );
  });

  it('says Leave Next Hand', () => {
    expect(strip(LEAVE_CONTROL)).toMatch(/'Leave Next Hand'/);
    expect(strip(LEAVE_CONTROL)).not.toMatch(/'Stand Up & Leave'/);
  });
});
