/**
 * OPTION-OFF STYLE READ GRID (2026-11-15, opponent classifier). A fixed grid of synthetic opponents (three table
 * sizes, VPIP 0.08 to 0.60, four raise shares, with and without a fold-to-3-bet read, saturated 30-hand, 120-hand and
 * fast windows) read by classifyOpponentStyle with no classifier option. The hash of every read, serialised, was
 * captured on the base commit (b262fd3e0e2); a classifier option that is off must leave it unchanged.
 */
import { createHash } from 'node:crypto';
import { classifyOpponentStyle } from './HorseOpponentStyle.js';
import { freshExploitCounters } from './HorseOpponentExploit.js';

export const STYLE_READ_OFF_GRID_BASE_PIN = '3e107ae731fbca2b63b84bd5';

export function styleReadOffGridPin(): string {
  const h = createHash('sha256');
  for (const size of ['full', 'short', 'hu'] as const)
    for (let i = 0; i < 14; i++) {
      const vpip = 0.08 + 0.04 * i;
      for (const share of [0.3, 0.5, 0.7, 0.9])
        for (const f3bOpp of [0, 20])
          for (const f3b of [0.3, 0.9]) {
            const c = freshExploitCounters();
            c.hands = 43.78;
            c.vpip = 43.78 * vpip;
            c.pfr = 43.78 * vpip * share;
            c.fHands = 12.05;
            c.fPfr = 12.05 * vpip * share;
            c.foldTo3BetOpp = f3bOpp;
            c.foldTo3Bet = f3bOpp * f3b;
            const counters = {
              ...c,
              lHands: 173.62,
              lVpip: 173.62 * vpip,
              lPfr: 173.62 * vpip * share,
            };
            h.update(
              JSON.stringify(
                classifyOpponentStyle({
                  scope: `holdem:${size}` as never,
                  variant: 'nlh',
                  domain: 'cash',
                  counters,
                  provenance: { source: 'live', complete: true },
                })
              )
            );
          }
    }
  return h.digest('hex').slice(0, 24);
}
