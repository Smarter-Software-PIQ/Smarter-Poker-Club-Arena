/**
 * LATER LAYERS KEEP THE STYLE READ, rule 5 (2026-11-15): no behavior change.
 *
 * One fold-to-bet counter raises the bluff multiplier twice: the exploit read
 * (postflopBluffMod / the legacy fold-rate branch, up to about 1.5) and
 * styleFoldBluff (up to 1.25 more) multiply into exploit.bluffMod
 * (reproduction claim 5 on a796551420a5: 1.49 x 1.19 = 1.78). What keeps the
 * product from reaching the table is the consumers' own caps: 1.3 on the four
 * hold'em flop/turn bluff draws in HorseLogic (Math.min(1.3, bluffScaleAt(...)))
 * and 1.35 in HorseFlopTurnBluffRange.flopTurnReadFactor. This test pins those
 * caps so a later edit cannot remove them silently, and pins that the doubled
 * multiplier changes no decision where the older read is already engaged.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flopTurnReadFactor } from './HorseFlopTurnBluffRange.js';
import { checkedTo, install } from './HorseOpponentStyle.contexts.test-support.js';
import {
  decide,
  foldToBetVillain,
  pinAll,
  seeds,
  supply,
} from './laterLayersKeepTheStyleRead.test-support.js';

const here = dirname(fileURLToPath(import.meta.url));
const flop = (hand: string, opts: Record<string, unknown>) =>
  seeds(200).map((s) => {
    install(foldToBetVillain(26), 'cash');
    supply(120);
    return decide(checkedTo('cash', hand, 'flop'), opts, s);
  });

describe('the fold-to-bet boost stops at its consumer caps', () => {
  it('flopTurnReadFactor caps the multiplier at 1.35: the doubled product reads as the cap', () => {
    const at = (bluffMod: number) =>
      flopTurnReadFactor({ station: false, foldToCbet: null, bluffMod }, false);
    expect(at(1.35)).toBe(1.35);
    expect(at(1.49)).toBe(1.35);
    expect(at(1.78)).toBe(1.35);
    expect(at(1.49 * 1.25)).toBe(1.35);
  });

  it("the four hold'em flop/turn bluff draws read the scale through a 1.3 cap", () => {
    const src = readFileSync(join(here, 'HorseLogic.ts'), 'utf8');
    expect(src.match(/Math\.min\(1\.3, bluffScaleAt\(/g)?.length).toBe(4);
    expect(readFileSync(join(here, 'HorseFlopTurnBluffRange.ts'), 'utf8')).toContain(
      'Math.min(1.35, reads.bluffMod)'
    );
  });

  it('with the older read engaged (fold-to-bet 26 of 30), styleFoldBluff changes no decision of these flop bets', () => {
    // Captured on a668406c and unchanged since; option on equals option off.
    expect(pinAll(flop('5d4d', {}))).toBe('34bc3e8e3da4de5b931d18ac');
    expect(pinAll(flop('5d4d', { styleFoldBluff: true }))).toBe('34bc3e8e3da4de5b931d18ac');
    expect(pinAll(flop('QcJc', {}))).toBe('fae6d78dce57571a8bc64530');
    expect(pinAll(flop('QcJc', { styleFoldBluff: true }))).toBe('fae6d78dce57571a8bc64530');
  });
});
