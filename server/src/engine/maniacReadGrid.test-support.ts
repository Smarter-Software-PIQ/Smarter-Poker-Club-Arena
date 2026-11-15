/**
 * MANIAC READ GRID (2026-11-15, opponent classifier C3). Synthetic decayed counters over the three no-limit hold'em
 * table sizes (decayed hands 3 to 43.78, PFR and first-in raise rates 0.1 to 1.0, with and without 3-bet evidence),
 * read by opponentExploitRead and maniacRaiseWidth with no option. The hash was captured on the base commit; an option
 * that is off must leave it unchanged.
 */
import { createHash } from 'node:crypto';
import {
  freshExploitCounters,
  maniacRaiseWidth,
  opponentExploitRead,
  type ExploitCounters,
} from './HorseOpponentExploit.js';

export const MANIAC_READ_GRID_BASE_PIN = 'bedb1dd6407e52da8312c14e';

export interface RaiserSpec {
  hands: number;
  pfr: number;
  rfi: number;
  /** share of hands that were a first-in opportunity */
  rfiShare?: number;
  threeBetOpp?: number;
  threeBet?: number;
}
export function raiser(spec: RaiserSpec): ExploitCounters {
  const c = freshExploitCounters();
  c.hands = spec.hands;
  c.vpip = spec.hands * Math.min(1, spec.pfr + 0.05);
  c.pfr = spec.hands * spec.pfr;
  c.rfiOpp = spec.hands * (spec.rfiShare ?? 0.6);
  c.rfi = c.rfiOpp * spec.rfi;
  c.threeBetOpp = spec.threeBetOpp ?? 0;
  c.threeBet = spec.threeBet ?? 0;
  const fh = Math.min(spec.hands, 12.05);
  c.fHands = fh;
  c.fPfr = fh * spec.pfr;
  c.fRfiOpp = fh * (spec.rfiShare ?? 0.6);
  c.fRfi = c.fRfiOpp * spec.rfi;
  return c;
}

export function maniacReadGridPin(): string {
  const h = createHash('sha256');
  for (const size of ['full', 'short', 'hu'] as const)
    for (const hands of [3, 3.87, 4.78, 5.67, 10, 15.56, 30, 43.78])
      for (const pfr of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1])
        for (const rfi of [0.2, 0.5, 0.8, 1])
          for (const tb of [0, 1]) {
            const c = raiser({
              hands,
              pfr,
              rfi,
              threeBetOpp: tb ? hands * 0.3 : 0,
              threeBet: tb ? hands * 0.3 * 0.4 : 0,
            });
            const read = opponentExploitRead(c, `holdem:${size}` as never, 'nlh');
            h.update(JSON.stringify([read, maniacRaiseWidth(read)]));
          }
  return h.digest('hex').slice(0, 24);
}
