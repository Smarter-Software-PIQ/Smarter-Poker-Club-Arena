/**
 * The 80 audit fixtures (DEVELOPMENT DATA: fixtures/horse-opponent-style-fixtures.json, anonymised fields of
 * tight-human-audit/style-fixtures.jsonl, one anonymous opponent). Each spot is rebuilt heads-up from its public
 * fields (amounts in big blinds, 2 chips per BB; earlier streets checked through; a 3-way spot is replayed heads-up)
 * and decided through HorseLogic.decide with every style option off and then on. Flop and turn results are whole-hand
 * nets, so they give direction only. Nothing was tuned on these fixtures.
 */
import { describe, expect, it } from 'vitest';
import { bigBetRespect, classifyOpponentStyle } from './HorseOpponentStyle.js';
import type { Villain } from './HorseOpponentStyle.contexts.test-support.js';
import { FX, RANK, run, villainOf } from './HorseOpponentStyle.fixtures.test-support.js';

describe('80 audit fixtures (DEVELOPMENT data): options ON versus OFF', () => {
  const results = FX.map((f) => ({ f, ...run(f) }));
  it('loads all 80 and every spot decides legally', () => {
    expect(FX.length).toBe(80);
    for (const r of results) expect(['fold', 'call', 'raise', 'all_in', 'check', 'bet']).toContain(r.on.decision.action);
  });
  it('the style read never widens a decision on any fixture', () => {
    for (const r of results) expect(RANK[r.on.decision.action], r.f.id).toBeLessThanOrEqual(RANK[r.off.decision.action]);
  });
  it('genuine coolers, the low-SPR counter-examples and the won river calls are decided exactly as with the options off', () => {
    const protectedCats = ['genuine-cooler', 'counter-example-short-stack', 'horse-won-river-call'];
    const prot = results.filter((r) => protectedCats.includes(r.f.category));
    expect(prot.length).toBe(22);
    for (const r of prot) expect(r.on.decision.action, r.f.id).toBe(r.off.decision.action);
  });
  it('the six lost one-pair river calls the equity cap folds stay folded (development set, not validation)', () => {
    for (const id of ['F017', 'F018', 'F019', 'F021', 'F026', 'F032']) {
      const r = results.find((x) => x.f.id === id)!;
      expect(r.off.decision.action, id).toBe('call');
      expect(r.on.decision.action, id).toBe('fold');
      expect(r.on.fires.style_bluff_catch_cap_seen, id).toBeGreaterThan(0);
    }
  });
  it('credible lost one-pair river calls: measured fold or shrink count (reported; direction only)', () => {
    const lost = results.filter(
      (r) => r.f.counters.credibleSample && (r.f.category === 'lost-river-bet-call' || r.f.category === 'lost-river-raise-call') && /one-pair|high-card|board-pair/.test(r.f.heroStrength)
    );
    const offCalls = lost.filter((r) => RANK[r.off.decision.action] >= 1);
    const flipped = offCalls.filter((r) => RANK[r.on.decision.action] < RANK[r.off.decision.action]);
    const respected = lost.filter((r) => (r.on.fires.style_big_bet_honesty_seen ?? 0) > 0 || (r.on.fires.style_raise_respect_seen ?? 0) > 0 || (r.on.fires.style_bluff_catch_cap_seen ?? 0) > 0);
    console.log(`fixtures: credible lost one-pair river calls ${lost.length}; OFF continues ${offCalls.length}; ON folds ${flipped.length}; respect engaged on ${respected.length}`);
    expect(lost.length).toBeGreaterThan(0);
    for (const r of lost) expect(RANK[r.on.decision.action]).toBeLessThanOrEqual(RANK[r.off.decision.action]);
  });
  it('shown-bluff fixtures: one more shown bluff lowers the river respect proportionally, never raises it', () => {
    let lowered = 0;
    let engaged = 0;
    for (const f of FX.filter((x) => x.category === 'shown-bluff')) {
      const read = (v: Villain) =>
        classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: f.format, counters: v.counters, tallies: v.stats as never, provenance: { complete: true } });
      const spot = { street: 'river' as const, potFraction: Math.max(0.75, f.sizePotFraction), isRaise: false };
      const before = bigBetRespect(read(villainOf(f)), spot);
      const after = bigBetRespect(read(villainOf(f, 1)), spot);
      expect(after, f.id).toBeLessThanOrEqual(before + 1e-12);
      if (before > 0) engaged++;
      if (after < before) lowered++;
    }
    console.log(`fixtures: shown-bluff respect engaged before ${engaged} of 14; lowered by one more shown bluff ${lowered}`);
  });
});
