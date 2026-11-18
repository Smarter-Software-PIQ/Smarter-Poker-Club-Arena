/**
 * Bounty events (2026-11-13): the fold-side bluff-catch cap no longer stands down. It is applied against the call
 * price including the knockout credit the call earns (V23/V37 pricing), so a bounty that makes the call correct still
 * calls, and one that does not still folds. Fixtures are DEVELOPMENT data replayed as an all-in river bet.
 */
import { describe, expect, it } from 'vitest';
import { HERO, VILLAIN, decide } from './HorseOpponentStyle.contexts.test-support.js';
import { FX, ON, installFixture, spotOf } from './HorseOpponentStyle.fixtures.test-support.js';

function bountySpot(id: string, bountyFactor: number, head: number) {
  const f = FX.find((x) => x.id === id)!;
  const sp = spotOf(f);
  const gs = sp.gs as Record<string, any>;
  const v = gs.players.find((p: any) => p.user_id === VILLAIN);
  v.stack = 0;
  v.is_all_in = true;
  gs.gameMode = 'tournament';
  gs.tournament = {
    entrants: 100,
    playersLeft: 40,
    spotsPaid: 15,
    inMoney: true,
    nearBubble: false,
    bountyFactor,
    meanBountyCents: 100,
    bountyByUser: { [VILLAIN]: head, [HERO]: 100 },
    bountyPoolCents: 5000,
  };
  return { f: { ...f, format: 'tournament' as const }, sp };
}
const run = (id: string, bf: number, head: number) => {
  const { f, sp } = bountySpot(id, bf, head);
  installFixture(f);
  const off = decide(sp, { telemetry: true });
  installFixture(f);
  return { off, on: decide(sp, { ...ON, telemetry: true }) };
};

describe('bounty events: the bluff-catch cap is priced with the knockout', () => {
  it('a large bounty (factor 0.5) makes the call correct: it still calls', () => {
    for (const id of ['F026', 'F032', 'F021']) {
      const { off, on } = run(id, 0.5, 300);
      expect(on.fires.style_bluff_catch_cap_bounty_priced_seen, id).toBeGreaterThan(0);
      expect([off.decision.action, on.decision.action], id).toEqual(['call', 'call']);
    }
  });
  it('a missing or zero bounty factor with other bounty fields present is priced as a regular event', () => {
    for (const bf of [undefined, 0, 0.05]) {
      const { f, sp } = bountySpot('F021', 0.5, 300);
      (sp.gs as Record<string, any>).tournament.bountyFactor = bf;
      installFixture(f);
      const on = decide(sp, { ...ON, telemetry: true });
      expect(on.fires.style_bluff_catch_cap_bounty_priced_seen ?? 0, String(bf)).toBe(0);
      expect(on.decision.action, String(bf)).toBe('fold');
    }
  });
  it('a small bounty (factor 0.1) does not: the cap still folds the bluff-catcher', () => {
    for (const id of ['F026', 'F032', 'F017', 'F018', 'F019', 'F021']) {
      const { off, on } = run(id, 0.1, 100);
      expect(on.fires.style_bluff_catch_cap_seen, id).toBeGreaterThan(0);
      expect([off.decision.action, on.decision.action], id).toEqual(['call', 'fold']);
    }
  });
});
