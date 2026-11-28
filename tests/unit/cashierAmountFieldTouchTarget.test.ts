import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Cashier's Send Out / Send Ticket amount field is a transparent input on
 * a painted plate that is about 33px tall on a phone. Post-deploy run
 * 46083886144 measured the field itself at 30.3px. The field keeps a 44px
 * touch target centred on the plate (the plate is a centring flex row), so
 * its text stays where the plate paints it.
 */
const css = readFileSync('src/pages/CashierTradePage.module.css', 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} must exist`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('the Cashier amount field is a 44px touch target', () => {
  it('the field and its select keep a 44px minimum height on the plate', () => {
    const field = block('.console input.entryInput,\n.console select.entrySelect');
    expect(field).toMatch(/\n\s*min-height:\s*44px;/);
    expect(field).not.toMatch(/\n\s*min-height:\s*0;/);
  });

  it('the plate still centres the field, so the taller target paints nothing new', () => {
    const plate = css.match(/\.console \.entryRowPlate \{\s*display: flex;\s*align-items: center;/);
    expect(plate).not.toBeNull();
    const field = block('.console input.entryInput,\n.console select.entrySelect');
    expect(field).toMatch(/background:\s*transparent !important;/);
    expect(field).toMatch(/border:\s*0 !important;/);
  });
});
