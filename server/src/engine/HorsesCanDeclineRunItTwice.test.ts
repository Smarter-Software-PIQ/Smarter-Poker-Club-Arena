/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A HORSE CAN DECLINE RUN IT TWICE - AND INSURANCE DEPENDS ON IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * scheduleHorseRITResponses answered the run-it-twice offer with a constant:
 * a horse chooser picked 2 or 3 every time, a horse responder sent 'accept'
 * every time. There was no branch in the code that could produce anything
 * else.
 *
 * checkAllInRunout asks the RIT question FIRST and reaches startInsuranceFlow
 * only on the single-run branch. All 27 live cash tables run both features.
 * So a horse that could not decline made insurance unreachable everywhere:
 * 270 hands in 24h met every precondition for an offer, and
 * insurance_offer_events recorded zero. The only rows that table has ever
 * held came from four hand-built INSURANCE test tables, all now closed.
 *
 * 2026-11-13 (Dan): "Horses should only be running it multiple times
 * SOMETIMES, not all the time." The verdict is now horseRunItTwiceRuns on the
 * Horse's own public all-in equity (HorseRunItTwice.ts, and its own test).
 *
 * These tests pin the two things that keep it fixed: the verdict is not a
 * constant, and both response sites read it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { horseRunItTwiceRuns } from './HorseRunItTwice.js';

const SRC = readFileSync(join(__dirname, 'ServerTableEngineRunout.ts'), 'utf8');

/** The verdict as the engine computes it, at a public equity and pot. */
function verdict(playerId: string, handCount: number, equity = 0.5): 'once' | 'multi' {
  const runs = horseRunItTwiceRuns({
    horseId: playerId,
    handNumber: handCount,
    potBB: 100,
    equity,
    maxRuns: 3,
  });
  return runs === 1 ? 'once' : 'multi';
}

describe('a horse can decline run it twice', () => {
  it('the verdict function exists, reads the equity rule, and both branches are reachable', () => {
    expect(SRC).toContain("protected horseRitVerdict(playerId: string): 'once' | 'multi'");
    expect(SRC).toContain("return this.horseRitRuns(playerId) === 1 ? 'once' : 'multi';");
    expect(SRC).toContain("import { horseRunItTwiceRuns } from './HorseRunItTwice.js';");
    expect(SRC).toContain('return horseRunItTwiceRuns({');
  });

  it('the chooser can pick one board', () => {
    expect(SRC).toContain('const runs = this.horseRitRuns(chooserPlayerId);');
    expect(SRC).toContain('this.respondToRIT(chooserPlayerId, undefined, runs);');
  });

  it('the responder can decline', () => {
    expect(SRC).toContain(
      "const answer = this.horseRitVerdict(pid) === 'once' ? 'decline' : 'accept';"
    );
    expect(SRC).toContain('this.respondToRIT(pid, answer);');
    // The old constant must be gone. A bare accept here is the regression.
    expect(SRC).not.toContain("this.respondToRIT(pid, 'accept');");
  });

  it('is not a constant: both answers appear across hands for one horse', () => {
    const id = Array.from({ length: 200 }, (_, i) => `horse-${i}-seat`).find((h) => {
      const seen = new Set<string>();
      for (let hand = 1; hand <= 40; hand++) seen.add(verdict(h, hand));
      return seen.size === 2;
    });
    expect(id).toBeDefined();
  });

  it('is not a constant: both answers appear across horses in one hand', () => {
    const answers = new Set<string>();
    for (let i = 0; i < 40; i++) answers.add(verdict('horse-' + i + '-seat', 12));
    expect([...answers].sort()).toEqual(['multi', 'once']);
  });

  it('declines often enough to unblock insurance, and agrees only sometimes', () => {
    let once = 0;
    let total = 0;
    for (let i = 0; i < 500; i++) {
      for (let hand = 1; hand <= 20; hand++) {
        total++;
        if (verdict('horse-' + i + '-abcdef', hand) === 'once') once++;
      }
    }
    const rate = once / total;
    // Even at a coin flip in a 100 BB pot most answers are 'once'.
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.85);
  });

  it('always declines a lopsided all-in, and an unknown equity', () => {
    for (let i = 0; i < 100; i++) {
      for (let hand = 1; hand <= 10; hand++) {
        expect(verdict('horse-' + i, hand, 0.04)).toBe('once');
        expect(verdict('horse-' + i, hand, 0.96)).toBe('once');
        expect(
          horseRunItTwiceRuns({
            horseId: 'horse-' + i,
            handNumber: hand,
            potBB: 100,
            equity: null,
            maxRuns: 3,
          })
        ).toBe(1);
      }
    }
  });

  it('is deterministic: the same hand replays to the same answer', () => {
    const id = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
    for (let hand = 1; hand <= 25; hand++) {
      expect(verdict(id, hand)).toBe(verdict(id, hand));
    }
  });

  it('the single-run branch still hands off to insurance', () => {
    // The whole point of letting a horse decline. If this ordering is ever
    // removed, declining buys nothing.
    expect(SRC).toContain("this.emitRitSingleRun('no_agreement');");
    expect(SRC).toContain('if (insuranceEnabled && allInPlayers.length >= 2) {');
    expect(SRC).toContain('startInsuranceFlow();');
  });
});
