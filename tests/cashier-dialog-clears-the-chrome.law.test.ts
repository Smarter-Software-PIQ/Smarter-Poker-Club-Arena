/**
 * A CASHIER DIALOG IS NEVER UNDER THE CHROME (Dan 2026-11-14, binding)
 *
 * "ANYTIME YOU CLICK MULTIPLE PLAYERS INSIDE THE CASHIER PAGES, IT FAILS, YOU
 * SHOULD BE ALLOWED TO CLICK MULTIPLE USERS AT ONCE IF EVERY USER IS GETTING
 * THE SAME TRANSACTION. RIGHT NOW IT SILENTLY FAILES AND DOESN'T ALLOW IT TO
 * HAPPEN."
 *
 * The batch itself was never the defect. Send Out grows one recipient card and
 * one amount row per selected player, so two or more players push the dialog
 * to the bottom of the screen. The overlay sat inside the page's stacking
 * context under the sticky header (390) and the fixed bottom nav (1000), and
 * its padding reserved neither: scrolled to its end, Cancel and Confirm lay
 * beneath the nav, and a tap on Confirm landed on a nav link (measured on
 * production at 1024x768 with two players: Confirm 628-700, elementFromPoint
 * the nav item). cashier_operations held no batch of more than one recipient
 * in thirty days. With the chrome reserved, Confirm measured 559 against a nav
 * top of 642 at 1024x768, and 732 against 791 at 393x852, both hit-tested as
 * the Confirm button.
 *
 * A z-index cannot fix this (400 still lost to the header in the same page),
 * so the overlay reserves the header's measured height and the footer's live
 * height. Both variables are published by the chrome itself.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

function overlayRule(): string {
  const css = read('src/pages/CashierTradePage.module.css');
  const start = css.indexOf('.page .modalOverlay {');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1).replace(/\s+/g, ' ');
}

describe('a cashier dialog is never under the chrome', () => {
  it('the overlay reserves the footer live height below the dialog', () => {
    expect(overlayRule()).toContain('calc(var(--bottom-nav-stack-base, 0px) + 12px)');
    // A dropped footer publishes 0px; the home indicator is still reserved.
    expect(overlayRule()).toContain('env(safe-area-inset-bottom, 0px)');
  });

  it('the overlay reserves the header measured height above the dialog', () => {
    const rule = overlayRule();
    expect(rule).toContain('--ca-global-header-height');
    expect(rule).toContain('--ca-in-tab-header-height');
  });

  it('the dialog scrolls inside what is left, so Confirm is always reachable', () => {
    const css = read('src/pages/CashierTradePage.module.css');
    const start = css.indexOf('.consoleDialog {');
    const rule = css.slice(start, css.indexOf('}', start) + 1);
    expect(rule).toMatch(/max-height:\s*100%/);
    expect(rule).toMatch(/overflow:\s*visible auto/);
  });

  it('the chrome still publishes the heights the overlay reserves', () => {
    expect(read('src/components/navigation/GlobalHeader.tsx')).toContain(
      "root.style.setProperty('--ca-global-header-height', height)"
    );
    expect(read('src/components/club/ClubBottomNav.tsx')).toContain(
      "export const BOTTOM_CHROME_HEIGHT_VAR = '--ca-bottom-chrome-h'"
    );
    expect(read('src/styles/globals.css')).toMatch(
      /--bottom-nav-stack-base:\s*var\(\s*--ca-bottom-chrome-h,/
    );
  });

  it('a multi-recipient Send Out still names every recipient with its own amount', () => {
    const page = read('src/pages/CashierTradePage.tsx');
    expect(page).toContain("amountModal === 'send' &&\n                      picked.length > 1 &&");
    expect(page).toContain("supabase.rpc('fn_cashier_batch_transfer'");
  });
});
