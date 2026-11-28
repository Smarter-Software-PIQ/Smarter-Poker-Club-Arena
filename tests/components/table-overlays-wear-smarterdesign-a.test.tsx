import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #SmarterDesign on the table (Dan 2026-11-27), worker A's surfaces: All-In
 * Insurance / EV Cashout, the Must Move lobby sheet and the full-screen
 * Tournament Lobby host. Each carries the arena workspace dress, and the keys
 * that live inside role="dialog" carry !important so the painted kit's and
 * metallic-popups.css's dialog resets cannot strip their chrome.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const block = (css: string, sel: string) => {
  const i = css.indexOf(sel);
  expect(i, `${sel} exists`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

describe('table overlays wear #SmarterDesign (A)', () => {
  it('Insurance: one chrome case, flow head, chrome keys that survive the dialog reset', () => {
    const css = read('src/components/table/InsuranceModal.css');
    expect(css).toMatch(/\.insurance-modal\.insurance-modal::before \{[\s\S]*?chrome-case\.webp/);
    expect(block(css, '.insurance-modal.insurance-modal :is(.sc-zone, .sc-plate) {')).toMatch(
      /position: relative !important;/
    );
    expect(block(css, '.insurance-modal.insurance-modal > .insurance-modal__head {')).toMatch(
      /box-shadow: none !important;/
    );
    const plate = block(
      css,
      '.insurance-modal.insurance-modal .insurance-modal__actions > .sc-plate {'
    );
    expect(plate).toMatch(/border-image: url\([^)]*chrome-stat\.webp'?\)[^;]*!important;/);
    expect(plate).toMatch(/min-height: 50px !important;/);
    expect(css).toMatch(
      /insurance-modal__btn--accept, \.insurance-modal__btn--cashout\)\s*\{[\s\S]*?chrome-active\.webp/
    );
  });

  it('Must Move lobby: chrome case, chrome keys at 44px, no gold ink', () => {
    const css = read('src/components/table/MustMoveLobbyModal.css');
    const sd = css.slice(css.indexOf('#SMARTERDESIGN'));
    expect(sd).toMatch(/\.tlm-panel\.mml-panel\.mml-panel::before \{[\s\S]*?chrome-case\.webp/);
    const keys = block(sd, '.mml-panel.mml-panel :is(.tlm-close, .mml-btn, .mml-join) {');
    expect(keys).toMatch(/min-height: 44px;/);
    expect(keys).toMatch(/border-image: [^;]*chrome-stat\.webp[^;]*!important;/);
    expect(block(sd, '.mml-panel.mml-panel .mml-btn--small {')).toMatch(/min-height: 44px;/);
    expect(sd).not.toMatch(/#ffd700|#f5c518|#fbbf24|gold/i);
  });

  it('Tournament Lobby host: ink navy, still frameless', () => {
    const css = read('src/components/table/TournamentLobbyModal.css');
    const sd = css.slice(css.indexOf('#SMARTERDESIGN'));
    expect(sd).toMatch(/\.tlm-panel\.tlm-panel--full \{[\s\S]*?#030b14/);
    expect(sd).not.toMatch(/border-image/);
  });
});
