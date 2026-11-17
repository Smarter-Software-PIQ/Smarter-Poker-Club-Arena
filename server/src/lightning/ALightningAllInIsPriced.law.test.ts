/**
 * A LIGHTNING ALL-IN IS PRICED (production alert 376656, 2026-11-11).
 *
 * Every Lightning all-in runout was written to ca_hand_facts with
 * all_in_equity_owed = true and all_in_equity = NULL (3,174 of 3,174 on the two
 * Midway Lightning host tables in 30 hours), because the Lightning host never
 * priced a runout and the facts builder only looked in the TableStateHub cache
 * that a physical table's `all_in_equity` event fills.
 *
 * This pins both halves: the host's pricing is computed the physical way
 * (exact, pot-share, variant flags, first all-in only, never throws), and the
 * facts builder writes the priced equity and its EV on a Lightning hand.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/supabase/client.js', () => ({
  supabase: { from: () => ({ upsert: async () => ({ error: null }) }) },
}));
vi.mock('../services/errorReporter.js', () => ({ reportError: () => {} }));

import {
  priceLightningAllInEquity,
  settledAllInEquity,
  type LightningEquityPricer,
} from './LightningAllInEquity.js';
import { buildLightningStatsFacts, type LightningFactsHand } from './LightningHandFacts.js';
import { writeHandFacts } from '../services/supabase/handFacts.js';
import type { Card } from '../types.js';

const c = (rank: string, suit: string) => ({ rank, suit }) as unknown as Card;
const AA = [c('A', 's'), c('A', 'h')];
const KK = [c('K', 's'), c('K', 'h')];

function recordingPricer(result: number[] | Error) {
  const calls: Array<{ hands: Card[][]; board: Card[]; opts: unknown; iters?: number }> = [];
  const pricer: LightningEquityPricer = {
    async estimateEquity(hands, board, _dead, iters, opts) {
      calls.push({ hands, board, opts, iters });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { pricer, calls };
}

function lightningHand(over: Partial<LightningFactsHand> = {}): LightningFactsHand {
  return {
    handId: '30000000-0000-4000-8000-0000000376a6',
    hostTableId: '0f84a1ab-5abb-41b4-a8bd-a33af58f73ea',
    rules: { club_id: '10000000-0000-4000-8000-000000000001', big_blind: 0.5, game_variant: 'nlh' },
    handNumber: 376656,
    playedAtIso: '2026-11-11T09:00:00Z',
    buttonSeat: 1,
    rake: 0,
    board: [c('2', 'c'), c('7', 'd'), c('9', 'h'), c('J', 'c'), c('3', 's')],
    holeCards: new Map([
      ['hero', { seat: 1, cards: AA }],
      ['villain', { seat: 2, cards: KK }],
    ]),
    players: [
      { user_id: 'hero', totalInvested: 50 },
      { user_id: 'villain', totalInvested: 50 },
    ],
    stacksBefore: new Map([
      ['hero', 50],
      ['villain', 50],
    ]),
    allInRunoutWitness: { street: 'preflop', playerIds: ['hero', 'villain'] },
    winners: [{ userId: 'villain', amount: 100 }],
    actions: [
      { seat: 1, userId: 'hero', action: 'all_in', amount: 50, stage: 'preflop' },
      { seat: 2, userId: 'villain', action: 'call', amount: 50, stage: 'preflop' },
    ],
    participants: [
      { playerId: 'hero', isHorse: false },
      { playerId: 'villain', isHorse: true },
    ],
    ...over,
  };
}

describe('a Lightning all-in is priced', () => {
  it('prices the runout exactly, pot-share, with the live pots mapped to player indices', async () => {
    const { pricer, calls } = recordingPricer([0.82, 0.18]);
    const priced = await priceLightningAllInEquity(
      {
        players: [
          { user_id: 'hero', cards: AA },
          { user_id: 'villain', cards: KK },
        ],
        board: [],
        pots: [
          { amount: 100, eligiblePlayers: ['villain', 'hero'] },
          { amount: 0, eligiblePlayers: ['hero'] },
        ],
        variant: 'nlh',
      },
      pricer
    );
    expect(priced?.street).toBe('preflop');
    expect(priced?.byUser.get('hero')).toBe(0.82);
    expect(priced?.byUser.get('villain')).toBe(0.18);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({
      exact: true,
      omaha: false,
      pots: [{ amount: 100, eligible: [1, 0] }],
    });
  });

  it('uses the Omaha evaluator for a PLO host and names the flop street', async () => {
    const { pricer, calls } = recordingPricer([0.5, 0.5]);
    const plo = [c('A', 's'), c('A', 'h'), c('K', 'd'), c('Q', 'c')];
    const plo2 = [c('9', 's'), c('8', 'h'), c('7', 'd'), c('6', 'c')];
    const priced = await priceLightningAllInEquity(
      {
        players: [
          { user_id: 'a', cards: plo },
          { user_id: 'b', cards: plo2 },
        ],
        board: [c('2', 'c'), c('3', 'd'), c('4', 'h')],
        variant: 'plo4',
      },
      pricer
    );
    expect(priced?.street).toBe('flop');
    expect(calls[0].opts).toMatchObject({ omaha: true, exact: true });
  });

  it('publishes no number where the physical engine would publish none, and never throws', async () => {
    const { pricer, calls } = recordingPricer([0.5, 0.5]);
    const river = Array.from({ length: 5 }, () => c('2', 'c'));
    expect(
      await priceLightningAllInEquity(
        { players: [{ user_id: 'a', cards: AA }], board: [], variant: 'nlh' },
        pricer
      )
    ).toBeNull();
    expect(
      await priceLightningAllInEquity(
        {
          players: [
            { user_id: 'a', cards: AA },
            { user_id: 'b', cards: [] },
          ],
          board: [],
          variant: 'nlh',
        },
        pricer
      )
    ).toBeNull();
    expect(
      await priceLightningAllInEquity(
        {
          players: [
            { user_id: 'a', cards: AA },
            { user_id: 'b', cards: KK },
          ],
          board: river,
          variant: 'nlh',
        },
        pricer
      )
    ).toBeNull();
    expect(calls).toHaveLength(0);

    const failing = recordingPricer(new Error('pool unavailable'));
    const report = vi.fn();
    await expect(
      priceLightningAllInEquity(
        {
          players: [
            { user_id: 'a', cards: AA },
            { user_id: 'b', cards: KK },
          ],
          board: [],
          variant: 'nlh',
        },
        failing.pricer,
        report
      )
    ).resolves.toBeNull();
    expect(report).toHaveBeenCalledOnce();

    const bad = recordingPricer([0.5]);
    expect(
      await priceLightningAllInEquity(
        {
          players: [
            { user_id: 'a', cards: AA },
            { user_id: 'b', cards: KK },
          ],
          board: [],
          variant: 'nlh',
        },
        bad.pricer
      )
    ).toBeNull();
  });

  it('a settlement waits a bounded time for the pricing and never for ever', async () => {
    expect(await settledAllInEquity(null)).toBeNull();
    const never = new Promise<null>(() => undefined);
    expect(await settledAllInEquity(never, 20)).toBeNull();
    const ready = Promise.resolve({ byUser: new Map([['a', 1]]), street: 'turn' as const });
    expect((await settledAllInEquity(ready, 20))?.street).toBe('turn');
  });

  it('a priced Lightning hand writes its equity and EV to every owed seat', async () => {
    const priced = {
      byUser: new Map([
        ['hero', 0.82],
        ['villain', 0.18],
      ]),
      street: 'preflop' as const,
    };
    const payload = await buildLightningStatsFacts(
      lightningHand({ allInEquity: priced }),
      writeHandFacts
    );
    const facts = (payload?.facts ?? []) as Array<Record<string, unknown>>;
    const hero = facts.find((f) => f.user_id === 'hero');
    const villain = facts.find((f) => f.user_id === 'villain');
    expect(hero?.all_in_equity_owed).toBe(true);
    expect(villain?.all_in_equity_owed).toBe(true);
    expect(hero?.all_in_equity).toBe(0.82);
    expect(villain?.all_in_equity).toBe(0.18);
    expect(hero?.ev_returned).toBeCloseTo(82, 2);
    expect(hero?.ev_net).toBeCloseTo(32, 2);
  });

  it('the Lightning host prices at ALL_IN_RUNOUT and hands the result to its facts', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      fileURLToPath(new URL('./LightningHandHost.ts', import.meta.url)),
      'utf8'
    );
    const runout = src.slice(src.indexOf("case 'ALL_IN_RUNOUT':"), src.indexOf("case 'SHOWDOWN':"));
    expect(runout).toContain('priceLightningAllInEquity(');
    expect(runout).toContain('computeLivePots');
    expect(src).toMatch(/allInEquity:\s*await settledAllInEquity\(this\.allInEquityPricing\)/);
  });
});
