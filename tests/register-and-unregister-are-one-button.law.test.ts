/**
 * LAW: REGISTER AND UNREGISTER ARE ONE BUTTON, AND IT IS NEVER CUT OFF
 * (Dan, 2026-11-22).
 *
 * Dan, verbatim: "THE REGISTER / UNREGISTER BUTTON NEED TO BE THE SAME SIZE
 * AND STYLE, AND SHOULD NEVER BE CUT OFF."
 *
 * What shipped: on the tournament lobby page Register printed on the painted
 * plate (TournamentRegisterButton) and Unregister was a bare red-outlined
 * `<button class="btn btn-unregister">`. In the header's action box (capped at
 * 55% of the row, 197px on a 390px phone) the 144px Invite plate left it 47px,
 * `flex: 1 1 0; min-width: 0` let it take exactly that, and its label ran out
 * of the box and off the right edge of the screen. Measured before the fix at
 * 390px: Invite 144px wide, Unregister 47px wide.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sliceBetween } from './helpers/sourceWindow';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const page = read('src/pages/tournament/TournamentDetails.tsx');
const shell = read('src/pages/tournament/TournamentDetails.css');
const plate = read('src/components/tournament/TournamentRegisterButton.css');

function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

describe('Register and Unregister are the same control', () => {
  it('Unregister prints on the Register plate, with the Register class', () => {
    expect(page).toMatch(
      /if \(isRegistered\) \{\s+return \(\s+<RegisterButton\s+className=\{`\$\{registerClass\} btn-unregister`\}\s+type="button"\s+onClick=\{handleUnregister\}\s+disabled=\{isProcessing\}\s+>\s+\{isProcessing \? 'Processing\.\.\.' : 'Unregister'\}\s+<\/RegisterButton>/
    );
    expect(page).toContain('const RegisterButton = TournamentRegisterButton;');
    expect(page).not.toMatch(/<button[^>]*className="btn btn-unregister"/);
  });

  it('the footer offers it too, on the same plate the footer Register wears', () => {
    const branch = page.slice(page.indexOf('if (isRegistered) {\n      return ('));
    expect(sliceBetween(branch, 'if (isRegistered) {', '<RegisterButton')).not.toContain(
      'if (footer) return null'
    );
    expect(page).toContain("{tournamentAction('footer')}");
    expect(page).toContain("{tournamentAction('header')}");
  });

  it('Unregister draws nothing of its own: no outline, no fill, no red', () => {
    const own = rule(
      shell,
      '.details-footer .btn-unregister,\n.details-header__actions .btn-unregister'
    );
    expect(own).not.toMatch(/border|background|rgba\(239|#ffb4|#f0/i);
    expect(own.replace(/\s/g, '')).toBe('color:#ffffff;');
    // Size and art come from the one plate rule, which names no state.
    const face = rule(
      plate,
      '.details-header__actions .tournament-register-button.tournament-register-button,'
    );
    expect(face).toContain("url('/assets/club-buttons/tournament-register-v1.webp')");
    expect(face).toContain('aspect-ratio: 3 / 1');
    expect(plate).not.toContain('btn-unregister');
  });

  it('the Invite plate beside it is the same component', () => {
    expect(page).toMatch(/<TournamentRegisterButton\s+className="btn-invite-game"/);
  });
});

describe('the action row never cuts a button off', () => {
  const phone = shell.slice(
    shell.indexOf('@media (max-width: 767px) {\n  .details-header__actions {')
  );

  it('on a phone the actions own a whole line instead of 55% of one', () => {
    expect(phone.length).toBeGreaterThan(0);
    const actions = rule(phone, '.details-header__actions {');
    expect(actions).toContain('flex: 1 1 100%');
    expect(actions).toContain('max-width: 100%');
    expect(actions).toContain('order: 1');
    expect(actions).not.toContain('nowrap');
  });

  it('every action wraps rather than clips, and a plate never exceeds its painted width', () => {
    const base = rule(shell, '\n.details-header__actions {');
    expect(base).toContain('flex-wrap: wrap');
    expect(base).toContain('min-width: 0');
    const plates = rule(
      phone,
      '.details-header__actions .tournament-register-button.tournament-register-button {'
    );
    expect(plates).toContain('max-width: 144px');
    expect(plates).toContain('flex: 1 1 120px');
    /* Two plates and their gap fit the narrowest supported phone that can
       hold them side by side, and stack (never clip) below it. */
    const gutter = 16;
    const gap = 6;
    for (const width of [360, 375, 390, 393, 430]) {
      expect(width - 2 * gutter).toBeGreaterThanOrEqual(144 * 2 + gap);
    }
    expect(320 - 2 * gutter).toBeGreaterThanOrEqual(144);
  });

  it('the label is fitted to the plate face, never left to overflow it', () => {
    const component = read('src/components/tournament/TournamentRegisterButton.tsx');
    expect(component).toContain('useFitText');
    expect(plate).toMatch(/font-size: calc\(11\.1cqw \* var\(--fit, 1\)\)/);
  });
});
