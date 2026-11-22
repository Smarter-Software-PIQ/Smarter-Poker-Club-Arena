/**
 * Lane COREWIRE laws: every delivered component is wired into omahaMathCore, every table the core
 * loads is public, PLO6 never enters, the wired decision is deterministic and legal. Constructed
 * spots only (no recorded hole cards).
 */
import { OMAHA_MATH_CORE_ALLOWED_PROVENANCE } from './OmahaMathCoreTables.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCardString } from './OmahaMathCoreEval.js';
import { decideOmahaMathCore, type CoreState } from './OmahaMathCore.js';
import { OMAHA_MATH_CORE_VARIANTS } from './OmahaMathCoreRule.js';
import {
  PREFLOP_REALIZATION_ADMITTED,
  publicHistoryOf,
  wireInScope,
  wiredTrack,
} from './OmahaMathCoreWire.js';
import type { HorseGameStateV2 } from '../HorseLogic.js';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const fixed = { now: () => 0 };

function spot(
  p: Omit<Partial<CoreState>, 'hole' | 'board'> & { hole: string; board: string }
): CoreState {
  const { hole, board, ...rest } = p;
  const toCall = rest.toCall ?? 0;
  const pot = rest.pot ?? 100;
  return {
    variant: hole.length === 10 ? 'plo5' : 'plo4',
    chipUnit: 0.01,
    mode: 'table',
    street: 'flop',
    pot,
    toCall,
    heroBet: 0,
    heroStack: 1000,
    currentBet: toCall,
    minRaiseTo: toCall > 0 ? toCall * 2 : 2,
    maxRaiseTo: toCall > 0 ? toCall + pot + toCall : pot,
    bigBlind: 2,
    legal: toCall > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    heroSeat: 5,
    heroPosition: 'BTN',
    ip: true,
    opponents: [
      {
        seat: 2,
        stack: 1000,
        bet: toCall,
        folded: false,
        allIn: false,
        streetAction: toCall > 0 ? 'wager' : 'check',
        calledPrevStreet: false,
        prevAggressor: false,
        position: 'BB',
        preflopLevel: 'call',
      },
    ],
    aggressorSeat: toCall > 0 ? 2 : null,
    line: toCall > 0 ? 'stab' : null,
    band: toCall > 0 ? 'pot' : null,
    wagerFrac: toCall > 0 ? toCall / (pot - toCall) : 0,
    heroWagerLine: toCall > 0 ? 'raise' : 'stab',
    preflopRaises: 1,
    rake: { percent: 5, cap: 6, noFlopNoDrop: true },
    seed: `${hole}|${board}|${pot}|${toCall}`,
    history:
      toCall > 0
        ? [
            {
              street: 'flop',
              seat: 2,
              action: 'bet',
              frac: toCall / (pot - toCall),
              facing: false,
              players: 2,
            },
          ]
        : [{ street: 'flop', seat: 2, action: 'check', frac: 0, facing: false, players: 2 }],
    preflopActions: [
      { seat: 5, action: 'raise', level: 0, limpers: 0, position: 'BTN' },
      { seat: 2, action: 'call', level: 1, limpers: 0, position: 'BB' },
    ],
    ...rest,
    hole: parseCardString(hole),
    board: parseCardString(board),
  } as CoreState;
}

describe('COREWIRE: provenance law on every table the core loads', () => {
  const tables = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  it('the hidden-card measuredRanges.v1 table is gone and every shipped table names a public provenance', () => {
    expect(existsSync(DIR + 'measuredRanges.v1.json')).toBe(false);
    expect(tables.some((f) => f.includes('publicTables.v1'))).toBe(false);
    for (const f of tables) {
      const t = JSON.parse(readFileSync(DIR + f, 'utf8')) as Record<string, unknown>;
      const prov = t.provenance;
      const text = typeof prov === 'string' ? prov : JSON.stringify(prov ?? null);
      if (f === 'publicTables.v4-pooled.json') continue; // per-cell provenance, law in OmahaMathCore.test.ts
      if (f === 'preflopRealization.v2-pooled.json') {
        // lead ruling 2026-11-19: the Horses' own cards in their own past hands (own_cards_history), admitted;
        // nothing about any opponent's hidden cards
        expect((prov as { class?: string }).class).toBe('own_cards_history');
        expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has('own_cards_history')).toBe(true);
        expect(text).toMatch(/No opponent hole cards are read/);
        expect(PREFLOP_REALIZATION_ADMITTED).toBe(true);
        continue;
      }
      if (f === 'preflopStrength.v1.json') {
        expect(text).toMatch(/random holdings only/);
        continue;
      }
      if (f === 'preflopTables.v2-pooled.json') {
        expect(text).toMatch(/NO hole cards/);
        continue;
      }
      expect(['public_actions', 'showdown_only']).toContain(prov);
    }
  });
  it('preflop realization is read (admitted, own_cards_history) and never moves a postflop decision', () => {
    const s = spot({ hole: 'AsAhKsQh', board: '', street: 'preflop', toCall: 4, pot: 7 });
    const { receipt } = decideOmahaMathCore(s, fixed);
    expect(Number.isFinite(receipt.realization.value)).toBe(true);
    const post = decideOmahaMathCore(spot({ hole: 'AsAhKsQh', board: '9c6h2h' }), fixed).receipt;
    expect(post.realization.source).not.toMatch(/preflop realization/);
  });
});

describe('COREWIRE: PLO6 never enters (owner 8:27 PM)', () => {
  it('the core variants and every adapter refuse six cards', () => {
    expect(OMAHA_MATH_CORE_VARIANTS.has('plo6')).toBe(false);
    expect(wireInScope({ variant: 'plo6' as never, hole: [0, 1, 2, 3, 4, 5] })).toBe(false);
    const s = spot({ hole: 'AsAhKsQhJdTd', board: '9c6h2h' });
    expect(wiredTrack({ ...s, variant: 'plo6' as never }, fixed.now)).toBeNull();
  });
});

describe('COREWIRE: every component prices a postflop decision', () => {
  it('heads-up flop, checked to: RANGEADV tracks, VALUE prices, the choice is a priced candidate; deterministic', () => {
    const s = spot({ hole: '9h8h7cKd', board: '9c6h2h' });
    const a = decideOmahaMathCore(s, fixed).receipt;
    const b = decideOmahaMathCore(s, fixed).receipt;
    expect(a.wire?.track).toMatch(/rangeadv tracked 1 seats/);
    expect(a.wire?.value?.value).toMatch(/omaha-math-core-value/);
    expect(a.opponents[0].range).toMatch(/Tracked EffN/);
    expect(a.evs.some((e) => e.action === 'check')).toBe(true);
    expect(a.evs.filter((e) => e.action === 'bet').length).toBeGreaterThan(1);
    expect(a.evs.some((e) => e.action === a.choice.action && e.amount === a.choice.amount)).toBe(
      true
    );
    expect(
      JSON.stringify({
        ...a,
        ms: 0,
        wire: { ...a.wire, track: null, value: { ...a.wire!.value!, ms: null } },
      })
    ).toBe(
      JSON.stringify({
        ...b,
        ms: 0,
        wire: { ...b.wire, track: null, value: { ...b.wire!.value!, ms: null } },
      })
    );
  });
  it('facing a pot bet: response cells are the pooled population cell with PLAYBOOK texture and blockers; a call is priced', () => {
    const s = spot({ hole: 'AhKhQsJd', board: 'Th9h2c', pot: 300, toCall: 100 });
    const r = decideOmahaMathCore(s, fixed).receipt;
    expect(r.wire?.value).not.toBeNull();
    const raise = r.evs.find((e) => e.action === 'raise' || e.action === 'all_in');
    expect(raise?.foldSource ?? '').not.toMatch(/opponent-model|person|horse/i);
    expect(raise?.foldSource ?? '').toMatch(/texture/);
    expect(r.evs.some((e) => e.action === 'call')).toBe(true);
    expect(r.evs.some((e) => e.action === 'fold')).toBe(true);
  });
  it('no responder is priced by theory: every fold share is the measured pooled cell (no Horse defence rule)', () => {
    const s = spot({ hole: '9h8h7cKd', board: '9c6h2h' });
    const r = decideOmahaMathCore(s, fixed).receipt;
    const bet = r.evs.find((e) => e.action === 'bet');
    expect(bet?.foldSource ?? '').not.toMatch(/self-consistent Horse defence/);
  });
  it('three-way: the field response comes from HVH-MULTI continuation outcomes', () => {
    const s = spot({ hole: '9h8h7cKd', board: '9c6h2h' });
    s.opponents.push({ ...s.opponents[0], seat: 3, position: 'SB' });
    s.history = [
      { street: 'flop', seat: 3, action: 'check', frac: 0, facing: false, players: 3 },
      { street: 'flop', seat: 2, action: 'check', frac: 0, facing: false, players: 3 },
    ];
    const r = decideOmahaMathCore(s, fixed).receipt;
    expect(r.wire?.value?.mwPower).toBeGreaterThanOrEqual(1);
    const bet = r.evs.find((e) => e.action === 'bet');
    expect(bet?.foldSource ?? '').toMatch(/correlation|independent|all-fold/i);
  });
});

describe('COREWIRE: the public line', () => {
  it('pot shares are reconstructed from the public actions and the current pot', () => {
    const gs = {
      pot: 40,
      bigBlind: 2,
      dealtSeatIds: [1, 2],
      players: [],
      actionHistory: [
        { stage: 'preflop', seat: 1, action: 'raise', amount: 6 },
        { stage: 'preflop', seat: 2, action: 'call', amount: 4 },
        { stage: 'flop', seat: 2, action: 'check', amount: 0 },
        { stage: 'flop', seat: 1, action: 'bet', amount: 8 },
        { stage: 'flop', seat: 2, action: 'raise', amount: 20 },
      ],
    } as unknown as HorseGameStateV2;
    const { history, preflopActions } = publicHistoryOf(
      gs,
      new Map([
        [1, 'BTN'],
        [2, 'BB'],
      ])
    );
    expect(preflopActions.map((a) => [a.seat, a.action, a.level])).toEqual([
      [1, 'raise', 0],
      [2, 'call', 1],
    ]);
    const bet = history.find((h) => h.action === 'bet')!;
    const raise = history.find((h) => h.action === 'raise')!;
    // pot before the flop bet = 40 - 8 - 20 = 12: bet 8 / 12; raise adds 20 facing 8: (20 - 8) / (20 + 8)
    expect(bet.frac).toBeCloseTo(8 / 12, 6);
    expect(raise.facing).toBe(true);
    expect(raise.frac).toBeCloseTo(12 / 28, 6);
  });
});
