/**
 * LATER LAYERS KEEP THE STYLE READ, rule 2a (2026-11-15).
 *
 * The V87 branch for a horse that limped and now faces an iso-raise returns
 * before the opener bars, so styleTightReRaiserRespect was never consulted:
 * 5c4c limp re-raised a credibly tight raiser to 16bb on every seed with the
 * option on or off (reproduction claim 2a on a796551420a5). Now the
 * suited-connector limp-reraise bluff is not taken against a raiser the tight
 * read respects (the hand calls the iso-raise); the premium-pair value
 * limp-reraise is unchanged. Option off: byte-identical to the commit before.
 *
 * Spot: cash 6-max, 100bb; hero limped under the gun, a credibly tight raiser
 * (valueHeavyGrinder) iso-raises to 8 on the button, blinds fold.
 */
import { describe, expect, it } from 'vitest';
import { install, VILLAINS } from './HorseOpponentStyle.contexts.test-support.js';
import {
  decide,
  limpIsoSpot,
  pinAll,
  seeds,
  supply,
  tally,
} from './laterLayersKeepTheStyleRead.test-support.js';

const RESPECT = { styleTightReRaiserRespect: true };
const run = (hand: string, opts: Record<string, unknown>) =>
  seeds(40).map((s) => {
    install(VILLAINS.grinder!, 'cash');
    supply(120);
    return decide(limpIsoSpot(hand), opts, s);
  });
const branches = (ds: ReturnType<typeof run>) =>
  tally(ds, (d) => d.decision.preflopAuthority?.events.at(-1)?.branch ?? 'none');
// Captured on a668406c (before the change), seeds 1..40.
const BASE = {
  '5c4c': 'a6f1c7d42bd9182cb8d97479',
  '9c8c': '001dac0c9c8d52d96943fb0a',
  QsQh: '8e4676d90d685f65f1aafa3d',
  '7h6h': '45c2b26271fca855b128e597',
} as const;

describe('a limper does not bluff re-raise a tight raiser', () => {
  it('option off: byte-identical to the commit before', () => {
    for (const hand of Object.keys(BASE) as Array<keyof typeof BASE>)
      expect(pinAll(run(hand, {})), hand).toBe(BASE[hand]);
  });

  it('the suited-connector limp-reraise bluff becomes the iso call against a respected tight raiser', () => {
    // Before: raise 40 of 40, branch v87_ep_limp_reraise_bluff, no respect receipt.
    const ds = run('5c4c', RESPECT);
    expect(tally(ds)).toEqual({ call: 40 });
    expect(branches(ds)).toEqual({ v87_ep_limp_call_iso: 40 });
    expect(ds.every((d) => d.fires.style_tight_opener_respect_seen === 1)).toBe(true);
  });

  it('the premium-pair value limp-reraise and the plain iso calls are unchanged', () => {
    expect(pinAll(run('QsQh', RESPECT))).toBe(BASE.QsQh);
    expect(pinAll(run('9c8c', RESPECT))).toBe(BASE['9c8c']);
    expect(pinAll(run('7h6h', RESPECT))).toBe(BASE['7h6h']);
  });
});
