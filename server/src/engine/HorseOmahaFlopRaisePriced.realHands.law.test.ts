/**
 * LAW: ON REAL AUDITED HEADS-UP FLOP RAISES THE FLOP RAISE PRICE DECIDES AS GRADED (PLO-OWNER lead-7 2026-11-26).
 * HorseOmahaFlopRaisePriced.realHands.fixture.json: flop raise nodes of the PLO hand audits (2026-11-20..24 and the
 * daily of 2026-11-25T230000Z) where the live rule chain raises: the public snapshot and the deciding Horse's own cards.
 * Off, every node keeps the chain's raise; on, each decides the action kind the graded replay did (EV on the audits'
 * own pricing, shown cards only: 34 fixed / 1 newly wrong, +400 bb over both audits with the size-versus-size rule).
 */
import { describe, expect, it } from 'vitest';
import { FLOP_RAISE_FIXTURE, flopRaiseDecide } from './HorseOmahaFlopRaisePriced.test-support.js';

const ON = { omahaFlopRaiseIsPriced: true };
const kind = (a: string) => (a === 'all_in' ? 'raise' : a);

describe('LAW: the flop raise price on real audited nodes', () => {
  const nodes = FLOP_RAISE_FIXTURE.nodes;
  it('the fixture holds resized raises, raises turned into calls or folds, and kept raises', () => {
    expect(nodes.filter((n) => kind(n.expect.flopraise) !== 'raise').length).toBeGreaterThanOrEqual(
      5
    );
    expect(nodes.length).toBeGreaterThanOrEqual(30);
  });
  it('off keeps the raise; on decides the graded action kind', () => {
    for (const n of nodes) {
      expect(kind(flopRaiseDecide(n, {}).action), `${n.hand} off`).toBe(kind(n.expect.off));
      expect(kind(flopRaiseDecide(n, ON).action), `${n.hand} on`).toBe(kind(n.expect.flopraise));
    }
  }, 120_000);
});
