import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Dan 2026-11-08, three rulings on the cash lobby card:
   1. "STAKES SHOULD BE AT THE SAME HEIGHT AS 'PLAYERS' NEXT TO IT AND BOTH THE
      LETTERS AND NUMBERS SHOULD BE LINED UP THE SAME."
   2. "IF ITS JUST 'CLASSIC' CLASSIC SHOULD FIT IN THAT WHOLE SPACE."
   3. "FOR 'LIGHTNING GAMES' PUT JUST 'LIGHTNING' (LIKE CLASSIC IS)" with the
      rules on a second line under the title (pinned by render in
      actionAndMadnessSayWhatTheyChange.test.tsx).
   Measured in a headless render at 393px and 533px: label tops and value
   midlines of Stakes and Players matched to the pixel on every row. */
const css = readFileSync('src/components/lobby/PremiumMttRows.css', 'utf8');
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('the cash lobby card lines up and fills its bays', () => {
  it('Stakes keeps the same cell padding as Players', () => {
    expect(css).not.toMatch(/td\[data-label='Stakes'\] \{\s*padding-bottom/);
  });

  it('a shrunk stake centres in the full-size value line box', () => {
    const zone = rule('.has-premium-chassis .premium-cash-stakes-zone');
    expect(zone).toContain('height: calc(clamp(12px, 4cqw, 28px) * 1.05)');
    expect(zone).toContain('align-items: center');
  });

  it('a one-word style prints larger than the multi-line style text', () => {
    const single = rule('.has-premium-chassis tbody tr[data-id] .premium-cash-style--single > span');
    expect(single).toContain('clamp(14px, 4.6cqw, 34px) * var(--fit, 1)');
  });
});
