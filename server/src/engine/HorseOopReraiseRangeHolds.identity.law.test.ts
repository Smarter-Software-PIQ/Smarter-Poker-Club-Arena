/**
 * LAW, IDENTITY AND CARDS (PLO-LEAD-6 2026-11-24, binding rulings): the out-of-position 3-bet range rule reads no
 * person-or-Horse identity, no player's name and no card but the Horse's own. The same public spot and the same public
 * counters under two different opener ids give the same decision and the same receipt; the rule's two source files
 * read no identity field and no other player's cards.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import {
  oopAsk,
  oopDeal,
  oopOpenerRows,
  type OopGame,
} from './HorseOopReraiseRangeHolds.test-support.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./HorseOopReraiseRangeHolds.fixture.json', import.meta.url), 'utf8')
) as { opts: Record<string, unknown> };
const ON: Record<string, unknown> = {
  ...FIXTURE.opts,
  telemetry: true,
  observeMind: false,
  omahaOopReraiseRangeHoldsVsReraise: true,
  holdemOopReraiseRangeHoldsVsReraise: true,
};
enableBrainTelemetry();
// frozen clocks (as the replay harness): a decision's receipts carry elapsed times
beforeAll(() => {
  vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(1795501563479);
});

describe('the out-of-position 3-bet range rule reads no identity and no unshown card', () => {
  it('the same public spot under two opener ids decides the same', () => {
    let priced = 0;
    for (const game of ['plo5', 'nlh'] as OopGame[])
      for (let i = 0; i < 120; i++) {
        const spec = {
          game,
          pos: 'bb_co' as const,
          depthBB: 400,
          hole: oopDeal(game, i),
          threeTo: null,
        };
        const rows = oopOpenerRows(game, 'wide');
        const a = oopAsk(spec, ON, rows, 50 + i, '00000000-0000-4000-8000-00000000000a').decision;
        const b = oopAsk(spec, ON, rows, 50 + i, 'ffffffff-ffff-4fff-8fff-fffffffffffb').decision;
        if (a.oopReraiseRangeHolds) priced++;
        expect(JSON.stringify({ ...a, thinkTime: 0 }), `${game} ${i}`).toBe(
          JSON.stringify({ ...b, thinkTime: 0 })
        );
      }
    expect(priced).toBeGreaterThan(0);
  }, 300_000);

  it('the rule source reads no identity field and no other player cards', () => {
    for (const f of ['./HorseOopReraiseRangeHolds.ts', './HorseOopReraiseRangeHoldsWiring.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        ''
      );
      for (const banned of [
        /is_horse/,
        /isHorse/,
        /humanUserIds/,
        /username/,
        /hole_cards/,
        /holeCards/,
      ])
        expect(src, `${f} ${banned}`).not.toMatch(banned);
      // the only cards read are the deciding player's own (player.cards, player.knownDeadCards)
      for (const m of src.matchAll(/(\w+)\.cards\b/g)) expect(m[1], f).toBe('player');
    }
  });
});
