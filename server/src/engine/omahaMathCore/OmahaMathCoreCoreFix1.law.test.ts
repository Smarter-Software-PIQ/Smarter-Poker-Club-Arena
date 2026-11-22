/**
 * Lane CORE-FIX-1 (PLO-OWNER lead-3, session_01Gw7aDuHREYyRnFwNqVFJAe; owner order Nov 21): the math-core bugs and
 * gaps AUDIT-A found (repairs/EMERG/AUDIT-A-MATHCORE.md items 5, 7, 8, 9, 11, 13, 14, 15, 16). Each law below failed
 * on PR-2 head df8ec8813a6a before its repair. States are constructed (seeded or written here): no recorded hole
 * cards. The core is off in production; every repair keeps core-off decisions identical (the off-identity laws).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../../types.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';

const hooks = vi.hoisted(() => ({
  fired: [] as string[],
  // OmahaMathCoreValue.planValue: prepend synthetic candidates / throw
  valuePrepend: null as null | ((spot: { pot: number }) => unknown[]),
  valueThrow: false,
  // OmahaMathCore.decideOmahaMathCore: replace the receipt
  decide: null as null | ((...a: unknown[]) => unknown),
  // equity calls: record [ranges, maxSamples]; return NaN for the first `nan` calls
  calls: [] as Array<{ k: number; max: number }>,
  nan: 0,
}));

vi.mock('../BrainTelemetry.js', async (orig) => {
  const m = await orig<typeof import('../BrainTelemetry.js')>();
  return {
    ...m,
    noteFire: (k: string) => {
      hooks.fired.push(k);
      m.noteFire(k);
    },
  };
});
vi.mock('./OmahaMathCoreValue.js', async (orig) => {
  const m = await orig<typeof import('./OmahaMathCoreValue.js')>();
  return {
    ...m,
    planValue: (spot: Parameters<typeof m.planValue>[0]) => {
      if (hooks.valueThrow) throw new Error('value search failed (test)');
      const r = m.planValue(spot);
      if (!r || !hooks.valuePrepend) return r;
      return { ...r, candidates: [...hooks.valuePrepend(spot as never), ...r.candidates] };
    },
  };
});
vi.mock('./OmahaMathCoreEquity.js', async (orig) => {
  const m = await orig<typeof import('./OmahaMathCoreEquity.js')>();
  const wrap =
    <F extends (...a: never[]) => unknown>(f: F) =>
    (...a: Parameters<F>) => {
      const ranges = a[3] as unknown[];
      const opts = a[5] as { maxSamples: number };
      hooks.calls.push({ k: ranges.length, max: opts.maxSamples });
      if (hooks.nan > 0) {
        hooks.nan--;
        return { equity: Number.NaN, se: 0, samples: 0 };
      }
      return f(...a);
    };
  return {
    ...m,
    equityVsPools: wrap(m.equityVsPools),
    equityVsPoolsEquityLane: wrap(m.equityVsPoolsEquityLane),
  };
});
vi.mock('./OmahaMathCore.js', async (orig) => {
  const m = await orig<typeof import('./OmahaMathCore.js')>();
  return {
    ...m,
    decideOmahaMathCore: (...a: Parameters<typeof m.decideOmahaMathCore>) =>
      hooks.decide
        ? (hooks.decide(...a) as ReturnType<typeof m.decideOmahaMathCore>)
        : m.decideOmahaMathCore(...a),
  };
});

import {
  decideOmahaMathCore,
  omahaMathCoreCallDraws,
  omahaMathCoreDrawCost,
  omahaMathCoreLateDraws,
  type CoreReceipt,
} from './OmahaMathCore.js';
import {
  omahaMathCoreRule,
  omahaMathCoreState,
  OMAHA_MATH_CORE_ALL_STREETS,
} from './OmahaMathCoreRule.js';
import {
  omahaMathCoreExactLegalize,
  omahaMathCoreOwns,
  omahaMathCoreRecover,
} from './OmahaMathCoreAcceptance.js';
import {
  omahaMathCoreStreetSpots,
  warmOmahaMathCore,
  OMAHA_MATH_CORE_WARM_STREETS,
} from './OmahaMathCoreWarmUp.js';
import {
  OMAHA_MATH_CORE_UNTRACKED_TRAP_RATE,
  omahaMathCoreUntrackedCheckedRange,
} from './OmahaMathCoreUntrackedCheck.js';
import { buildPool, seededRng } from './OmahaMathCoreEquity.js';
import { parseCardString } from './OmahaMathCoreEval.js';
import { trackRanges } from './OmahaMathCoreRangeTrack.js';
import { setWiredValueForTests } from './OmahaMathCoreWire.js';
import { lightningOmahaRecoverState } from '../../lightning/LightningOmahaRecoverState.js';

afterEach(() => {
  hooks.fired.length = 0;
  hooks.valuePrepend = null;
  hooks.valueThrow = false;
  hooks.decide = null;
  hooks.calls.length = 0;
  hooks.nan = 0;
});

const ON = { omahaMathCore: true, omahaMathCorePreflop: true, ...OMAHA_MATH_CORE_ALL_STREETS };
const spots = () => omahaMathCoreStreetSpots();
const spotOf = (key: string) => spots().find((s) => s.key === key)!;
const frozen = () => 0;
const legalizeOn = (player: SeatPlayer, gs: HorseGameStateV2) => (d: HorseDecision) =>
  omahaMathCoreExactLegalize(d, player, gs);

/** a CoreReceipt carrying only what the rule reads */
function receiptOf(
  evs: Array<Partial<CoreReceipt['evs'][number]> & { action: string }>
): CoreReceipt {
  const full = evs.map((e) => ({
    amount: null,
    adds: 0,
    ev: 0,
    se: 0,
    sd: 0,
    equity: null,
    foldProb: 0,
    foldSource: 'test',
    range: null,
    future: null,
    ...e,
  }));
  return {
    evs: full,
    choice: { action: full[0].action, amount: full[0].amount, ev: full[0].ev },
  } as unknown as CoreReceipt;
}

describe('CORE-FIX-1 item 1 (AUDIT-A 5): a clamped VALUE size carries no EV it was not priced at', () => {
  it('a wager VALUE priced past the stack is not a candidate (its EV never reaches the receipt as the all-in)', () => {
    const spot = spotOf('plo5|flop');
    const player = spot.player;
    const gs = {
      ...spot.gs,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
    } as unknown as HorseGameStateV2;
    hooks.valuePrepend = () => [
      {
        kind: 'wager',
        frac: 40,
        allIn: false,
        adds: 100000,
        ev: 777.77,
        fold: 0.9,
        raise: 0,
        call: 0.1,
        evFold: 0,
        evRaise: 0,
        evCall: 0,
        sd: 0,
        plan: 'synthetic over-stack size (test)',
        se: 0.01,
        source: 'test',
      },
    ];
    const { receipt } = decideOmahaMathCore(omahaMathCoreState(player, gs), { now: frozen });
    // the synthetic size is clamped to the all-in: before the repair it was pushed there with its own EV
    expect(
      receipt.evs.some((e) => String(e.foldSource).includes('synthetic over-stack size'))
    ).toBe(false);
    // the legal sizes VALUE did price still stand
    expect(receipt.evs.some((e) => e.action === 'raise' || e.action === 'all_in')).toBe(true);
  });
});

describe('CORE-FIX-1 item 2 (AUDIT-A 7): fold is ranked like every action; recovery has no synthetic incumbent', () => {
  it('recovery on a +EV / high-SE call spot calls (it used to fold: EV - SE ranked fold first, then K x SE kept it)', () => {
    const { player, gs } = spotOf('plo5|flop');
    const toCall = (gs as unknown as { toCall: number }).toCall;
    hooks.decide = () => ({
      receipt: receiptOf([
        { action: 'fold', ev: 0, se: 0 },
        { action: 'call', amount: toCall, adds: toCall, ev: 1.5, se: 2 },
      ]),
    });
    const out = omahaMathCoreRecover({
      player,
      gs,
      on: true,
      from: 'brain_exception',
      error: new Error('test'),
      runCore: true,
      preflopOwned: true,
      streetOpts: { ...OMAHA_MATH_CORE_ALL_STREETS },
      thinkTime: 1,
      now: frozen,
    } as never);
    expect(out?.action).toBe('call');
  });
  it("with a real incumbent the change margin still keeps today's fold when the edge is inside K x SE", () => {
    const { player, gs } = spotOf('plo5|flop');
    const toCall = (gs as unknown as { toCall: number }).toCall;
    hooks.decide = () => ({
      receipt: receiptOf([
        { action: 'fold', ev: 0, se: 0 },
        { action: 'call', amount: toCall, adds: toCall, ev: 1.5, se: 2 },
      ]),
    });
    const out = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1 },
      player,
      gs,
      ON,
      legalizeOn(player, gs),
      frozen
    );
    expect(out.action).toBe('fold');
  });
});

describe('CORE-FIX-1 item 3 (AUDIT-A 8): the draws of an equity call never depend on the pricing order', () => {
  it('every equity call of a decision takes omahaMathCoreCallDraws of its range count, first call or last', () => {
    let multi = 0;
    // the wired value search and the core's own one-step loop (the path a value-search null or error takes)
    for (const wired of [true, false])
      try {
        setWiredValueForTests(wired);
        for (const { key, player, gs } of spots()) {
          if (key.endsWith('preflop')) continue;
          hooks.calls.length = 0;
          decideOmahaMathCore(omahaMathCoreState(player, gs), { now: frozen });
          expect(hooks.calls.length, key).toBeGreaterThan(0);
          if (hooks.calls.length > 1) multi++;
          for (const c of hooks.calls)
            expect(c.max, `${key} wired ${wired}`).toBe(omahaMathCoreCallDraws(c.k));
        }
      } finally {
        setWiredValueForTests(true);
      }
    // the multiway spots price several calls: the law is about the later ones
    expect(multi).toBeGreaterThan(0);
  });
  it('omahaMathCoreCallDraws is a function of the range count alone: 2,400 / 750 / 312 / 150 / 150', () => {
    expect([1, 2, 3, 4, 5].map(omahaMathCoreCallDraws)).toEqual([2400, 750, 312, 150, 150]);
    for (let k = 1; k < 8; k++) {
      expect(omahaMathCoreCallDraws(k + 1)).toBeLessThanOrEqual(omahaMathCoreCallDraws(k));
      expect(omahaMathCoreCallDraws(k)).toBeGreaterThanOrEqual(omahaMathCoreLateDraws(k));
      expect(omahaMathCoreCallDraws(k) * omahaMathCoreDrawCost(k)).toBeLessThanOrEqual(
        Math.max(2400, omahaMathCoreLateDraws(k) * omahaMathCoreDrawCost(k))
      );
    }
  });
  it('the same state decides the same way twice (deterministic)', () => {
    const { player, gs } = spotOf('plo4|turn');
    const a = decideOmahaMathCore(omahaMathCoreState(player, gs), { now: frozen }).receipt;
    const b = decideOmahaMathCore(omahaMathCoreState(player, gs), { now: frozen }).receipt;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("CORE-FIX-1 item 4 (AUDIT-A 9): a rules action the core could not price is not the core's choice", () => {
  it('kept unpriced: owned false, no door protection (omahaMathCoreOwns false), receipt choice EV null', () => {
    const { player, gs } = spotOf('plo5|flop');
    const toCall = (gs as unknown as { toCall: number }).toCall;
    hooks.decide = () => ({
      receipt: receiptOf([
        { action: 'call', amount: toCall, adds: toCall, ev: 3, se: 0.1 },
        { action: 'fold', ev: 0, se: 0 },
      ]),
    });
    const incoming: HorseDecision = { action: 'raise', amount: 40, thinkTime: 1 };
    const out = omahaMathCoreRule(incoming, player, gs, ON, (d) => d, frozen);
    expect(out.action).toBe('raise');
    expect(out.omahaMathCore?.core?.kept?.unpriced).toBe(true);
    expect(out.omahaMathCore?.owned).toBe(false);
    expect(out.omahaMathCore?.core?.choice.ev).toBeNull();
    expect(omahaMathCoreOwns(out)).toBe(false);
  });
  it('a priced core choice is still owned', () => {
    const { player, gs } = spotOf('plo5|flop');
    const toCall = (gs as unknown as { toCall: number }).toCall;
    hooks.decide = () => ({
      receipt: receiptOf([
        { action: 'call', amount: toCall, adds: toCall, ev: 30, se: 0.1 },
        { action: 'fold', ev: 0, se: 0 },
      ]),
    });
    const out = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1 },
      player,
      gs,
      ON,
      legalizeOn(player, gs),
      frozen
    );
    expect(out.action).toBe('call');
    expect(out.omahaMathCore?.owned).toBeUndefined();
    expect(omahaMathCoreOwns(out)).toBe(true);
  });
});

describe('CORE-FIX-1 item 5 (AUDIT-A 11): omahaMathCoreNetsTheWholeDeduction is inert', () => {
  it('CORE-FIX-1: the option changes no decision (every core street, PLO4 and PLO5, byte-identical)', () => {
    for (const { key, player, gs } of spots())
      for (const incoming of ['fold', 'call'] as const) {
        const run = (whole: boolean) =>
          JSON.stringify(
            omahaMathCoreRule(
              { action: incoming, thinkTime: 1 },
              player,
              gs,
              { ...ON, omahaMathCoreNetsTheWholeDeduction: whole },
              (d) => d,
              frozen
            )
          );
        expect(run(true), key).toBe(run(false));
      }
  });
});

describe('CORE-FIX-1 item 6 (AUDIT-A 13): the untracked check update has the trap-rate seam', () => {
  const pool = buildPool(
    parseCardString('AsKdQh9c8c'),
    parseCardString('Ts7h2d'),
    5,
    700,
    8,
    seededRng('core-fix-1')
  );
  const node = { game: 'plo5', street: 'flop' as const, first: true, players: 2 };
  it('with no rate (the seam today) it is the old strip exactly: below the top b, weight 1', () => {
    expect(OMAHA_MATH_CORE_UNTRACKED_TRAP_RATE).toBeNull();
    const r = omahaMathCoreUntrackedCheckedRange(pool, 0.4, 'src', node);
    const a = Math.floor(0.4 * pool.size);
    expect(r.parts).toHaveLength(1);
    expect(Array.from(r.parts[0].idx)).toEqual(Array.from(pool.order.slice(a, pool.size)));
    expect(r.label).toBe('checked: below the top 0.4 [src]');
  });
  it("with a measured trap rate tau the top b keeps tau per holding (the tracked update's checkKeep, pb 0)", () => {
    const r = omahaMathCoreUntrackedCheckedRange(pool, 0.4, 'src', node, () => 0.35);
    const a = Math.floor(0.4 * pool.size);
    expect(r.parts).toHaveLength(2);
    expect(r.parts[0].idx.length).toBe(a);
    expect(r.parts[0].weight / r.parts[0].idx.length).toBeCloseTo(0.35, 9);
    expect(r.parts[1].weight / r.parts[1].idx.length).toBeCloseTo(1, 9);
  });
});

describe('CORE-FIX-1 item 7 (AUDIT-A 14): every core fallback is a live counter', () => {
  it('core error', () => {
    const { player, gs } = spotOf('plo5|flop');
    hooks.decide = () => {
      throw new Error('core failed (test)');
    };
    const out = omahaMathCoreRule(
      { action: 'fold', thinkTime: 1 },
      player,
      gs,
      ON,
      (d) => d,
      frozen
    );
    expect(out.omahaMathCore?.applied).toBe(false);
    expect(hooks.fired).toContain('omaha_math_core_fallback_core_error');
  });
  it('value-search error', () => {
    const { player, gs } = spotOf('plo5|flop');
    hooks.valueThrow = true;
    decideOmahaMathCore(omahaMathCoreState(player, gs), { now: frozen });
    expect(hooks.fired).toContain('omaha_math_core_fallback_value_search_error');
  });
  it('equity collision', () => {
    const { player, gs } = spotOf('plo5|turn');
    hooks.nan = 2;
    const { receipt } = decideOmahaMathCore(omahaMathCoreState(player, gs), { now: frozen });
    expect(receipt.equityFallbacks ?? 1).toBeGreaterThan(0);
    expect(hooks.fired).toContain('omaha_math_core_fallback_equity_collision');
  });
  it('tracker failure', () => {
    const r = trackRanges({
      variant: 'plo5',
      hole: parseCardString('AsKdQh9c8c'),
      board: null as never,
      seed: 't',
    } as never);
    expect(r).toBeNull();
    expect(hooks.fired).toContain('omaha_math_core_fallback_tracker_failure');
  });
});

describe('CORE-FIX-1 item 8 (AUDIT-A 16): the Lightning refused-choice recovery sees the whole table state', () => {
  const base = () => {
    const { player, gs } = spotOf('plo5|flop');
    const g = gs as unknown as Record<string, unknown> & { toCall: number };
    const input = {
      state: {
        players: (g.players as Array<Record<string, unknown>>).map((p, i) => ({
          ...p,
          user_id: i === 0 ? 'hero' : `v${i}`,
        })),
        communityCards: g.communityCards as unknown[],
        stage: 'flop',
        currentBet: g.currentBet as number,
        pot: g.pot as number,
        minRaise: 2,
        dealerSeat: g.dealerSeat as number,
        actionHistory: g.actionHistory as Array<Record<string, unknown>>,
      },
      heroUserId: 'hero',
      blinds: { smallBlind: 1, bigBlind: 2 },
      variant: 'plo5',
      boardCount: 1,
      asset: 'chips' as string | null,
      allInOrFold: false,
      rakeConfig: null,
      auth: { toCall: g.toCall, legalActions: ['fold', 'call', 'raise'], structure: 'pot_limit' },
    };
    return { player, input };
  };
  const recover = (player: SeatPlayer, gs: HorseGameStateV2) =>
    omahaMathCoreRecover({
      player,
      gs,
      on: true,
      from: 'controller_refused',
      error: 'controller_refused',
      runCore: false,
      budgetMs: 15,
    } as never);
  it('a chips table is priced', () => {
    const { player, input } = base();
    expect(recover(player, lightningOmahaRecoverState(input))).not.toBeNull();
  });
  it('a Diamond table, a double board and an all-in-or-fold menu are out of scope (null)', () => {
    const { player, input } = base();
    expect(recover(player, lightningOmahaRecoverState({ ...input, asset: 'diamonds' }))).toBeNull();
    expect(recover(player, lightningOmahaRecoverState({ ...input, boardCount: 2 }))).toBeNull();
    expect(recover(player, lightningOmahaRecoverState({ ...input, allInOrFold: true }))).toBeNull();
  });
  it("other seats' cards never reach the recovery state", () => {
    const { input } = base();
    input.state.players = input.state.players.map((p) => ({
      ...p,
      cards: [{ rank: 'A', suit: 's' }],
    }));
    const gs = lightningOmahaRecoverState(input) as unknown as {
      players: Array<{ user_id: string; cards: unknown[] }>;
    };
    for (const p of gs.players) if (p.user_id !== 'hero') expect(p.cards).toEqual([]);
  });
});

describe('CORE-FIX-1 item 9 (AUDIT-A 15): the warm-up covers every street the core can own', () => {
  it('PLO4 and PLO5 x preflop, flop, turn, river all priced', () => {
    const w = warmOmahaMathCore(frozen);
    expect(w.ok).toBe(true);
    expect([...w.warmed].sort()).toEqual(
      OMAHA_MATH_CORE_WARM_STREETS.map(({ variant, stage }) => `${variant}|${stage}`).sort()
    );
  });
});
