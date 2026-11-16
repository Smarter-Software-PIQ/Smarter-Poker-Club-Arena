/**
 * LAW (2026-11-16, Fixed-Limit lane): A FIXED-LIMIT READ IS JUDGED AGAINST THE FIXED-LIMIT HORSE POPULATION, with
 * HorseDecideOpts.fixedLimitPopulationCells on (read as === true, DEFAULT OFF), and nothing else moves.
 *
 * The defect (Phase 3 diagnosis, P3-TIGHT-READ-DESIGN.md). The style and exploit reads judge an opponent against the
 * Horse population cell of his game and table size (exploitEnvelopeFor). The 2026-10-16 fixed-limit cells are sparse
 * (+/- 0.20 around a few horses) and there is no flo8 full-ring cell, so a full-ring flo8 read borrowed flo8 short:
 * a VPIP mean of 0.526 against the 0.31 Horses actually play, so an ordinary flo8 player read tight. The option
 * swaps in FIXED_LIMIT_POPULATION_ENVELOPE, measured from 107,538 Horse-only fixed-limit cash hands
 * (2026-11-09..16, public actions only), at the decision's own game and size; thresholds, margins, minimum hands
 * and credibility are unchanged.
 *
 * (1) With the option on, every no-limit and pot-limit read gets exactly main's envelope (same object), at every
 *     size; a fixed-limit read gets its own measured cell; outside a decision the option cannot engage.
 * (2) The census (every Horse's own decayed counters, built as the learner builds them, fixture
 *     fixed-limit-population-census.json) replayed through the style read: with the option on, no flh cell
 *     engages the tight consumers (tight-opener and tight-reraiser respect) or the tight participation side on more
 *     Horses than with it off; at full-ring flh the tight-opener respect engages on at most 1% of Horses (the P1
 *     share); at full-ring flo8 the tight participation side falls.
 * (3) A synthetic 10% VPIP / 6% PFR history reads tight by its 40th hand at full-ring flh and flo8 with the option
 *     on; a 20% (flh) or 28% (flo8) history never does.
 * (4) The option is registered in the live switch, release default OFF, owner Fixed-Limit.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { HorseLogic } from './HorseLogic.js';
import {
  EXPLOIT_COUNTER_FIELDS,
  EXPLOIT_LONG_FIELDS,
  FIXED_LIMIT_POPULATION_ENVELOPE,
  FIXED_LIMIT_POPULATION_ENVELOPE_VERSION,
  OPPONENT_EXPLOIT_ENVELOPE,
  OPPONENT_EXPLOIT_ENVELOPE_VERSION,
  exploitEnvelopeFor,
  exploitEnvelopeVersionFor,
  exploitHandIncrements,
  observeExploitRow,
  type ExploitCounters,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';
import {
  classifyOpponentStyle,
  tightOpenerRespect,
  tightReRaiserRespect,
  type OpponentStyleRead,
} from './HorseOpponentStyle.js';
import { OPTION_SWITCH_REGISTRY, optionSwitchOffOnly } from './HorseOptionSwitch.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import type { ReadScope } from './HorseMind.js';

const SIZES = ['hu', 'short', 'full'] as const;
const DEALT = { hu: 2, short: 4, full: 6 } as const;
const NON_FIXED_LIMIT = ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck', 'pineapple'] as const;
const FIXED_LIMIT = ['flh', 'flo8'] as const;

function inDecision<T>(scope: ReadScope, variant: string, on: boolean, fn: () => T): T {
  HorseMind.setDecisionScope(scope, variant, 'cash');
  HorseMind.setDecisionReadOptions(on ? { fixedLimitPopulationCells: true } : {});
  try {
    return fn();
  } finally {
    HorseMind.setDecisionScope(null);
  }
}
/** main's answer: the variant's own cell at the nearest measured size, else the family cell */
function mainEnvelope(scope: ReadScope, variant: string) {
  const size = scope.slice(scope.indexOf(':') + 1);
  for (const s of [size, 'short', 'full', 'hu']) {
    const own = OPPONENT_EXPLOIT_ENVELOPE[`${variant}:${s}`];
    if (own) return own;
  }
  return OPPONENT_EXPLOIT_ENVELOPE[scope];
}

afterEach(() => HorseMind.setDecisionScope(null));

describe('(1) only a fixed-limit read moves, and only with the option on inside a decision', () => {
  it('no-limit and pot-limit reads get exactly main envelope at every size, option on or off', () => {
    for (const v of NON_FIXED_LIMIT)
      for (const size of SIZES) {
        const scope = readScopeOf(v, DEALT[size]);
        const off = inDecision(scope, v, false, () => exploitEnvelopeFor(scope, v));
        const on = inDecision(scope, v, true, () => exploitEnvelopeFor(scope, v));
        expect(on, `${v}:${size}`).toBe(off);
        expect(on, `${v}:${size}`).toBe(mainEnvelope(scope, v));
        expect(inDecision(scope, v, true, () => exploitEnvelopeVersionFor(scope, v))).toBe(
          OPPONENT_EXPLOIT_ENVELOPE_VERSION
        );
      }
  });

  it('a fixed-limit read gets its own measured cell with the option on, and main envelope with it off', () => {
    for (const v of FIXED_LIMIT)
      for (const size of SIZES) {
        const scope = readScopeOf(v, DEALT[size]);
        const on = inDecision(scope, v, true, () => exploitEnvelopeFor(scope, v));
        expect(on, `${v}:${size}`).toBe(FIXED_LIMIT_POPULATION_ENVELOPE[`${v}:${size}`]);
        expect(on, `${v}:${size}`).toBeDefined();
        expect(inDecision(scope, v, false, () => exploitEnvelopeFor(scope, v))).toBe(
          mainEnvelope(scope, v)
        );
        expect(inDecision(scope, v, true, () => exploitEnvelopeVersionFor(scope, v))).toBe(
          FIXED_LIMIT_POPULATION_ENVELOPE_VERSION
        );
      }
    // the flo8 full-ring read no longer borrows flo8 short
    const full = readScopeOf('flo8', 6);
    expect(inDecision(full, 'flo8', false, () => exploitEnvelopeFor(full, 'flo8'))).toBe(
      OPPONENT_EXPLOIT_ENVELOPE['flo8:short']
    );
    expect(
      inDecision(full, 'flo8', true, () => exploitEnvelopeFor(full, 'flo8'))!.vpip.mean
    ).toBeLessThan(0.4);
  });

  it('outside a decision the option cannot engage', () => {
    HorseMind.setDecisionScope(null);
    HorseMind.setDecisionReadOptions({ fixedLimitPopulationCells: true });
    const scope = readScopeOf('flo8', 6);
    expect(exploitEnvelopeFor(scope, 'flo8')).toBe(mainEnvelope(scope, 'flo8'));
  });

  it('HorseLogic carries the option beside the scope only when it is explicitly true', () => {
    const gameState = {
      gameVariant: 'flh',
      players: [
        { user_id: 'a', seat: 1 },
        { user_id: 'b', seat: 2 },
        { user_id: 'c', seat: 3 },
        { user_id: 'd', seat: 4 },
        { user_id: 'e', seat: 5 },
        { user_id: 'f', seat: 6 },
      ],
    };
    HorseLogic.prepareOriginalReads({ user_id: 'a', seat: 1 } as never, gameState as never, {
      fixedLimitPopulationCells: true,
      mind: false,
    });
    expect(HorseMind.currentDecisionReadOptions().fixedLimitPopulationCells).toBe(true);
    HorseMind.setDecisionScope(null);
    HorseLogic.prepareOriginalReads({ user_id: 'a', seat: 1 } as never, gameState as never, {
      mind: false,
    });
    expect('fixedLimitPopulationCells' in HorseMind.currentDecisionReadOptions()).toBe(false);
  });
});

describe('(2) the recorded Horse census through the style read', () => {
  const fx = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src/engine/fixtures/fixed-limit-population-census.json'),
      'utf8'
    )
  ) as { fields: string[]; cells: Record<string, number[][]> };
  const fields = [...EXPLOIT_COUNTER_FIELDS, ...EXPLOIT_LONG_FIELDS] as string[];
  const tally = (cell: string, on: boolean) => {
    const [variant, size] = cell.split(':') as [string, keyof typeof DEALT];
    const scope = readScopeOf(variant, DEALT[size]);
    let tight = 0;
    let opener = 0;
    let reRaiser = 0;
    for (const r of fx.cells[cell]!) {
      const counters = Object.fromEntries(
        fields.map((f, i) => [f, r[i]])
      ) as unknown as ExploitCounters;
      const s: OpponentStyleRead = inDecision(scope, variant, on, () =>
        classifyOpponentStyle({ scope, variant, domain: 'cash', counters })
      );
      if (s.participation.side === 'tight' && s.participation.credible) tight++;
      if (tightOpenerRespect(s)) opener++;
      if (tightReRaiserRespect(s)) reRaiser++;
    }
    return { horses: fx.cells[cell]!.length, tight, opener, reRaiser };
  };

  it('the fixture is the declared census: fields in wire order, all six cells', () => {
    expect(fx.fields).toEqual(fields);
    expect(Object.keys(fx.cells).sort()).toEqual(
      ['flh:full', 'flh:hu', 'flh:short', 'flo8:full', 'flo8:hu', 'flo8:short'].sort()
    );
  });

  it('no flh cell reads more Horses tight, or engages a tight consumer on more Horses, with the option on', () => {
    for (const size of SIZES) {
      const off = tally(`flh:${size}`, false);
      const on = tally(`flh:${size}`, true);
      expect(on.tight, `flh:${size} tight`).toBeLessThanOrEqual(off.tight);
      expect(on.opener, `flh:${size} tight-opener`).toBeLessThanOrEqual(off.opener);
      expect(on.reRaiser, `flh:${size} tight-reraiser`).toBeLessThanOrEqual(off.reRaiser);
    }
  });

  it('full-ring flh: the tight-opener respect engages on at most the P1 share of Horses', () => {
    const on = tally('flh:full', true);
    expect(on.opener / on.horses).toBeLessThanOrEqual(0.01);
  });

  it('full-ring flo8: the false tight reads fall', () => {
    const off = tally('flo8:full', false);
    const on = tally('flo8:full', true);
    expect(on.tight).toBeLessThan(off.tight);
  });
});

describe('(3) synthetic histories: a tight player is read tight, an ordinary one never', () => {
  const PHI = (Math.sqrt(5) - 1) / 2;
  const regular = '30000000-0000-4000-8000-000000000011';
  const horse = '40000000-0000-4000-8000-000000000013';
  /** his preflop action on hand n at the given rates (raise, call or fold, a low-discrepancy sequence) */
  function hand(n: number, vpip: number, pfr: number): ExploitHandAction[] {
    const u = ((n + 1) * PHI) % 1;
    const a = u < pfr ? 'raise' : u < vpip ? 'call' : 'fold';
    return [
      {
        userId: regular,
        stage: 'preflop',
        action: a,
        origin: 'player',
        amount: a === 'raise' ? 2 : a === 'call' ? 1 : 0,
        isFullRaise: a === 'raise' ? true : undefined,
      },
      { userId: horse, stage: 'preflop', action: 'fold', origin: 'horse_policy', amount: 0 },
    ];
  }
  /** the first hand (1-based) at which the full-ring read is tight, or -1 within `max` hands */
  function firstTight(variant: string, vpip: number, pfr: number, max = 400): number {
    const scope = readScopeOf(variant, 6);
    const rows = new Map<string, ExploitCounters>();
    for (let n = 0; n < max; n++) {
      for (const [id, inc] of exploitHandIncrements(hand(n, vpip, pfr), true))
        observeExploitRow(rows, id, inc, 1e9, true);
      const s = inDecision(scope, variant, true, () =>
        classifyOpponentStyle({ scope, variant, domain: 'cash', counters: rows.get(regular)! })
      );
      if (s.participation.side === 'tight' && s.participation.credible) return n + 1;
    }
    return -1;
  }

  it('a 10% VPIP / 6% PFR player reads tight by his 40th hand at full-ring flh and flo8', () => {
    for (const v of FIXED_LIMIT) {
      const n = firstTight(v, 0.1, 0.06);
      expect(n, v).toBeGreaterThan(0);
      expect(n, v).toBeLessThanOrEqual(40);
    }
  });

  it('an ordinary player (20% flh, 28% flo8) never reads tight', () => {
    expect(firstTight('flh', 0.2, 0.1)).toBe(-1);
    expect(firstTight('flo8', 0.28, 0.14)).toBe(-1);
  });
});

describe('(4) registered, release default OFF, owner Fixed-Limit', () => {
  it('is a ledger flag, a registry entry that may be switched on, released OFF', () => {
    expect(
      HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === 'fixedLimitPopulationCells')
    ).toBe(true);
    const entry = OPTION_SWITCH_REGISTRY.find((e) => e.name === 'fixedLimitPopulationCells');
    expect(entry).toBeDefined();
    expect(entry!.releaseDefault).toBe('off');
    expect(entry!.owner).toBe('Fixed-Limit');
    expect(optionSwitchOffOnly('fixedLimitPopulationCells')).toBeNull();
  });
});
