/**
 * LAW: THE OUT-OF-POSITION 3-BET RANGE HOLDS AGAINST A 4-BET (PLO-LEAD-6 2026-11-24; hand a6f9206d, trace
 * OOP-3BET-FOLD-TRACE.md). With omahaOopReraiseRangeHoldsVsReraise (PLO4/PLO5 cash) or
 * holdemOopReraiseRangeHoldsVsReraise (NLH cash) on, over generated out-of-position states (seeded deals, 150 to 800
 * bb, the big blind against the cutoff and the small blind against the button, the opener unread and read as a tight
 * opener), the share of the out-of-position 3-bet range that folds to the 4-bet is at most the cap
 * (horse.reraiseFoldShareCap, 0.45) and under the 4-bettor's pure-bluff break-even; aces double-suited (PLO) and aces
 * (NLH) still 3-bet (NLH kings at 800 bb unread are priced below the call: the population 4-bet range there is the top 1.2%); off, or in PLO6 or a tournament, the decision is the one without the option.
 *
 * On main the options do not exist: the generated range folds 55-91% at 150 bb and deeper, and the first law fails.
 * Production options of 2026-11-24 (fixture; the V53 pressure and every live row as they ran when the hand was played).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Card } from '../types.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import { stateAt } from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  OOP_OPENER_ID,
  oopAsk,
  oopCell,
  oopDeal,
  oopHand,
  oopOpenerRows,
  type OopCellResult,
  type OopGame,
  type OopPos,
  type OopRead,
} from './HorseOopReraiseRangeHolds.test-support.js';
import { RERAISE_FOLD_SHARE_CAP_DEFAULT } from './HorseOopReraiseRangeHolds.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./HorseOopReraiseRangeHolds.fixture.json', import.meta.url), 'utf8')
) as { opts: Record<string, unknown> };
const LIVE: Record<string, unknown> = { ...FIXTURE.opts, telemetry: true, observeMind: false };
const ON: Record<string, unknown> = {
  ...LIVE,
  omahaOopReraiseRangeHoldsVsReraise: true,
  holdemOopReraiseRangeHoldsVsReraise: true,
};
const CAP = RERAISE_FOLD_SHARE_CAP_DEFAULT;
enableBrainTelemetry();
// frozen clocks (as the replay harness): a decision's receipts carry elapsed times
beforeAll(() => {
  vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(1795501563479);
});

const GAMES: OopGame[] = ['plo4', 'plo5', 'nlh'];
// the depths where the defect lives (deeper than about 135 bb); 60 and 100 bb are held by the AA test below
const DEPTHS = [150, 300, 800];
const POSITIONS: OopPos[] = ['bb_co', 'sb_btn'];
// unread and a tight opener (who folds to 3-bets): the openers a planned fold is priced against; a wide re-raiser
// is held by the AA test and the identity law
const READS: OopRead[] = ['none', 'tight'];
const N: Record<OopGame, number> = { plo4: 250, plo5: 250, plo6: 0, nlh: 600 };

const add = (a: OopCellResult, b: OopCellResult): OopCellResult => ({
  dealt: a.dealt + b.dealt,
  threeBets: a.threeBets + b.threeBets,
  foldsToFourBet: a.foldsToFourBet + b.foldsToFourBet,
  foldsWithoutAce: a.foldsWithoutAce + b.foldsWithoutAce,
});
const zero = (): OopCellResult => ({
  dealt: 0,
  threeBets: 0,
  foldsToFourBet: 0,
  foldsWithoutAce: 0,
});

describe('the out-of-position 3-bet range holds against a 4-bet', () => {
  for (const game of GAMES)
    it(`${game}: the share of the out-of-position 3-bet range that folds to a 4-bet is at most the cap, at every depth`, () => {
      let pooled = zero();
      const rows: string[] = [];
      let block = 0;
      for (const depthBB of DEPTHS) {
        let byDepth = zero();
        for (const pos of POSITIONS)
          for (const read of READS)
            // each cell its own deals (the keep unit is a hash of the cards: shared deals would share it)
            byDepth = add(
              byDepth,
              oopCell(
                { game, pos, depthBB },
                ON,
                oopOpenerRows(game, read),
                N[game],
                N[game] * block++
              )
            );
        pooled = add(pooled, byDepth);
        const share = byDepth.threeBets ? byDepth.foldsToFourBet / byDepth.threeBets : 0;
        rows.push(`${depthBB} bb: ${byDepth.threeBets} 3-bets, fold ${share.toFixed(3)}`);
        // a depth with enough 3-bets to read is held to the cap by itself
        if (byDepth.threeBets >= 20)
          expect(share, `${game} ${rows.at(-1)}`).toBeLessThanOrEqual(CAP);
      }
      expect(
        pooled.threeBets,
        `${game}: the range is not empty (${rows.join('; ')})`
      ).toBeGreaterThan(0);
      expect(
        pooled.foldsToFourBet / pooled.threeBets,
        `${game}: ${rows.join('; ')}`
      ).toBeLessThanOrEqual(CAP);
    }, 600_000);

  it('aces double-suited (PLO4, PLO5) and aces (NLH) still 3-bet at every depth against every read', () => {
    const c = (rank: string, suit: string): Card => ({ rank, suit }) as Card;
    const hands: [OopGame, Card[]][] = [
      ['plo4', [c('A', 'spades'), c('A', 'hearts'), c('K', 'spades'), c('Q', 'hearts')]],
      [
        'plo5',
        [c('A', 'spades'), c('A', 'hearts'), c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs')],
      ],
      ['nlh', [c('A', 'spades'), c('A', 'hearts')]],
    ];
    for (const [game, hole] of hands)
      for (const depthBB of [60, 100, 200, 800])
        for (const read of ['none', 'wide', 'tight'] as OopRead[]) {
          const a = oopAsk(
            { game, pos: 'bb_co', depthBB, hole, threeTo: null },
            ON,
            oopOpenerRows(game, read),
            7
          );
          expect(['raise', 'jam'], `${game} ${depthBB} bb ${read}: ${a.kind}`).toContain(a.kind);
        }
  }, 120_000);

  it('off, the decision is exactly the decision without the option; on, PLO6 and tournaments are untouched', () => {
    for (const game of ['plo4', 'plo5', 'nlh', 'plo6'] as OopGame[])
      for (let i = 0; i < 40; i++) {
        const hole = oopDeal(game, i);
        const spec = { game, pos: 'bb_co' as OopPos, depthBB: 300, hole, threeTo: null };
        const rows = oopOpenerRows(game === 'plo6' ? 'plo5' : game, 'none');
        const base = oopAsk(spec, LIVE, rows, 11 + i).decision;
        const off = oopAsk(
          spec,
          {
            ...LIVE,
            omahaOopReraiseRangeHoldsVsReraise: false,
            holdemOopReraiseRangeHoldsVsReraise: false,
          },
          rows,
          11 + i
        ).decision;
        expect(JSON.stringify(off)).toBe(JSON.stringify(base));
        const tourney = (gs: Record<string, unknown>) => {
          gs.gameMode = 'tournament';
        };
        if (game === 'plo6') {
          const on = oopAsk(spec, ON, rows, 11 + i).decision;
          expect(JSON.stringify(on), `plo6 ${i}`).toBe(JSON.stringify(base));
        }
        const tOff = oopAsk(spec, LIVE, rows, 11 + i, undefined, tourney).decision;
        const tOn = oopAsk(spec, ON, rows, 11 + i, undefined, tourney).decision;
        expect(JSON.stringify(tOn), `${game} tournament ${i}`).toBe(JSON.stringify(tOff));
      }
  }, 300_000);

  it('the response validator admits the call and the fold the rule makes, the call only under its gate', () => {
    const verdicts: Record<string, number> = {};
    let refusedWithoutGate = 0;
    for (const game of ['plo5', 'nlh'] as OopGame[])
      for (let i = 0; i < 160; i++) {
        const spec = {
          game,
          pos: 'bb_co' as OopPos,
          depthBB: 300,
          hole: oopDeal(game, i),
          threeTo: null,
        };
        const a = oopAsk(spec, ON, oopOpenerRows(game, 'none'), 77 + i);
        const receipt = a.decision.oopReraiseRangeHolds as { verdict: string } | undefined;
        if (!receipt) continue;
        verdicts[`${game} ${receipt.verdict}`] = (verdicts[`${game} ${receipt.verdict}`] ?? 0) + 1;
        const { hand, node } = oopHand(spec);
        const st = stateAt(
          hand as never,
          (hand.actions as unknown[])[node] as never
        ) as unknown as {
          gs: { players: { user_id: string }[] };
          hero: unknown;
        };
        for (const p of st.gs.players) if (p.user_id === 'p6') p.user_id = OOP_OPENER_ID;
        const ctx = { player: st.hero as never, gameState: st.gs as never };
        expect(
          horseDecisionReceiptRefusal(a.decision, game, { ...ctx, oopReraiseRangeHolds: true }),
          `${game} ${i} ${receipt.verdict}`
        ).toBeNull();
        if (
          receipt.verdict === 'called' &&
          horseDecisionReceiptRefusal(a.decision, game, ctx) !== null
        )
          refusedWithoutGate++;
      }
    expect(
      Object.keys(verdicts).some((k) => k.endsWith('called')),
      JSON.stringify(verdicts)
    ).toBe(true);
    expect(
      Object.keys(verdicts).some((k) => k.endsWith('folded')),
      JSON.stringify(verdicts)
    ).toBe(true);
    expect(refusedWithoutGate, JSON.stringify(verdicts)).toBeGreaterThan(0);
  }, 300_000);
});
