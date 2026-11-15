/**
 * HOLD'EM PERSONA POSTFLOP (2026-11-15, option holdemPersonaPostflop, default OFF; persona promises P17, P21).
 * The scales are bounded and keep the fleet average; the bluffing scales never exceed 1 against a tight opponent;
 * with the option off (absent or false) decisions are exactly what they were, seed for seed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOLDEM_MODEL_MEAN_TRAP_FREQUENCY,
  HOLDEM_PERSONA_CBET_SCALE,
  HOLDEM_PERSONA_STAB_SCALE,
  HOLDEM_PERSONA_TRAP_BASE,
  HOLDEM_PERSONA_TRAP_MAX,
  holdemPersonaPostflopScales,
} from './HorseHoldemPersonaPostflop.js';
import { holdemPersonaFor, type HorseHoldemArchetype } from './HorsePersona.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';

const SHARE: Record<HorseHoldemArchetype, number> = {
  lag_shark: 0.25,
  tricky_trap: 0.2,
  tag_crusher: 0.4,
  nit_hunter: 0.15,
};
const IDS = Array.from({ length: 4000 }, (_, i) => `persona-postflop-horse-${i}`);

describe('the persona postflop scales', () => {
  it('the archetype tables have a share-weighted mean of exactly 1', () => {
    for (const table of [HOLDEM_PERSONA_CBET_SCALE, HOLDEM_PERSONA_STAB_SCALE]) {
      const mean = (Object.keys(SHARE) as HorseHoldemArchetype[]).reduce(
        (sum, a) => sum + SHARE[a] * table[a],
        0
      );
      expect(mean).toBeCloseTo(1, 12);
    }
  });

  it('the trap threshold keeps the fleet mean at the old 0.42 and stays inside its bound', () => {
    let sum = 0;
    for (const id of IDS) {
      const { trap } = holdemPersonaPostflopScales(id, false);
      expect(trap).toBeGreaterThan(0.2);
      expect(trap).toBeLessThanOrEqual(HOLDEM_PERSONA_TRAP_MAX);
      sum += trap;
    }
    // 4,000 hashed ids against the model mean: within two percent of the fleet mix
    expect(sum / IDS.length).toBeGreaterThan(HOLDEM_PERSONA_TRAP_BASE * 0.98);
    expect(sum / IDS.length).toBeLessThan(HOLDEM_PERSONA_TRAP_BASE * 1.02);
    expect(HOLDEM_MODEL_MEAN_TRAP_FREQUENCY).toBeCloseTo(0.311, 12);
  });

  it('a Tricky Trap traps more than a LAG, and a Nit Hunter stabs more than everyone', () => {
    const of = (a: HorseHoldemArchetype) => IDS.find((id) => holdemPersonaFor(id).archetype === a)!;
    const lag = holdemPersonaPostflopScales(of('lag_shark'), false);
    const tricky = holdemPersonaPostflopScales(of('tricky_trap'), false);
    const tag = holdemPersonaPostflopScales(of('tag_crusher'), false);
    const nit = holdemPersonaPostflopScales(of('nit_hunter'), false);
    expect(tricky.trap).toBeGreaterThan(lag.trap);
    expect(nit.stab).toBeGreaterThan(Math.max(lag.stab, tricky.stab, tag.stab));
    expect(lag.cbet).toBeGreaterThan(nit.cbet);
  });

  it('the bluffing scales never exceed 1 against a tight opponent; the trap is not a bluff and is unchanged', () => {
    for (const id of IDS.slice(0, 400)) {
      const free = holdemPersonaPostflopScales(id, false);
      const held = holdemPersonaPostflopScales(id, true);
      expect(held.cbet).toBeLessThanOrEqual(1);
      expect(held.stab).toBeLessThanOrEqual(1);
      expect(held.cbet).toBe(Math.min(1, free.cbet));
      expect(held.stab).toBe(Math.min(1, free.stab));
      expect(held.trap).toBe(free.trap);
    }
  });
});

// A recorded no-limit hold'em flop decision (read, never imported: the engine build's JSON census).
const FIXTURE = JSON.parse(
  readFileSync(new URL('./ABluffRaiseNeedsSomeoneWhoCanFold.fixture.json', import.meta.url), 'utf8')
);

function decideSeeds(opts: Record<string, unknown>, seeds: number): string[] {
  const out: string[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    HorseMind.reset();
    seedFastRandom(seed * 7919);
    const gs = structuredClone(FIXTURE.gameState) as HorseGameStateV2;
    const player = structuredClone(FIXTURE.player);
    const d = HorseLogic.decide(player, gs, FIXTURE.style, FIXTURE.mods, {
      ...(FIXTURE.opts ?? {}),
      mind: false,
      telemetry: false,
      ...opts,
    });
    out.push(`${d.action}:${d.amount ?? ''}`);
  }
  return out;
}

describe('holdemPersonaPostflop is default OFF', () => {
  it('absent equals explicit false, seed for seed', () => {
    expect(decideSeeds({}, 40)).toEqual(decideSeeds({ holdemPersonaPostflop: false }, 40));
  });

  it('the option reads only as === true', () => {
    expect(decideSeeds({ holdemPersonaPostflop: 1 as never }, 20)).toEqual(decideSeeds({}, 20));
  });

  it('on, the decision is a legal action of the same hand (no throw, no fallback)', () => {
    for (const d of decideSeeds({ holdemPersonaPostflop: true }, 40))
      expect(d).toMatch(/^(fold|check|call|bet|raise|all_in):/);
  });
});
