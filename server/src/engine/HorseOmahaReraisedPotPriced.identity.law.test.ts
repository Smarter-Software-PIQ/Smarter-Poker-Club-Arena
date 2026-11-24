/**
 * LAW (PLO lead-6 2026-11-24, owner rule: nothing keyed on person-vs-Horse identity or a named player):
 * omahaReraisedPotCallIsPriced and omahaReraisedPotReraiseIsPriced decide the same whether the re-raiser is seated as
 * a person or as a Horse. Only his public record moves the price, never what he is. Synthetic cards and players.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind, readScopeOf } from './HorseMind.js';
import {
  rrHands,
  rrSetRead,
  rrSpot,
  type RrSpotKind,
} from './HorseOmahaReraisedPotPriced.test-support.js';
import { reraisedPotPricedDecision } from './HorseOmahaReraisedPotPricedRule.js';

afterEach(() => HorseMind.reset());

describe('the re-raised-pot price never reads whether the re-raiser is a person or a Horse', () => {
  for (const kind of ['bbVsSbSqueezeMw', 'oopHu', 'ipHu', 'oopHuFiveBet'] as RrSpotKind[])
    for (const read of [
      [0, 0],
      [30, 50],
    ] as [number, number][])
      it(`${kind}, read ${read.join('/')}: the same priced answer`, () => {
        for (const h of rrHands(10, 5, 99)) {
          const out = [false, true].map((raiserIsHorse) => {
            const { hero, gs } = rrSpot(h, kind, { raiserIsHorse });
            rrSetRead('plo5', read[0], read[1]);
            HorseMind.setDecisionScope(readScopeOf('plo5', 6), 'plo5', 'cash');
            try {
              return (['fold', 'call', 'raise'] as const).map((action) => {
                const standing =
                  action === 'raise'
                    ? { action, amount: gs.maxRaiseTo ?? 0 }
                    : action === 'call'
                      ? { action, amount: gs.toCall }
                      : { action };
                const r = reraisedPotPricedDecision(
                  standing as never,
                  hero,
                  gs,
                  { call: true, reraise: true },
                  { mind: true, telemetry: false }
                );
                return JSON.stringify({
                  a: r.decision.action,
                  m: r.decision.amount,
                  rc: r.receipt,
                  c: r.verdict?.evCall,
                  x: r.verdict?.evRaise,
                });
              });
            } finally {
              HorseMind.setDecisionScope(null);
            }
          });
          expect(out[1], h).toEqual(out[0]);
        }
      });

  it('the rule source reads no person/Horse flag and no roster of persons', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['HorseOmahaReraisedPotPriced.ts', 'HorseOmahaReraisedPotPricedRule.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        ''
      );
      expect(src, f).not.toMatch(/is_horse|humanUserIds|omahaOpponentKindOf|isHorse/);
    }
  });
});
