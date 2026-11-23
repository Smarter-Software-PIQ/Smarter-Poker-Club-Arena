/**
 * LAW: omahaTurnRiverRaiseIsPricedInLightning (PLO-OWNER lead-4 lane LEAKS-RULES, 2026-11-22; default OFF).
 *
 * Gives #2 (omahaRiverNutRaiseOnly) a priced Lightning PLO4/PLO5 cash owner by opening Lightning pools
 * strictly to omahaTurnRiverRaiseIsPriced (and its raise -> call receipt admission), with ZERO blast radius
 * on any other priced rule and ZERO reach outside PLO4/PLO5 cash Lightning pools.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';
import {
  omahaPricedInScope,
  omahaPricedOwnsTurnRiverRaise,
  omahaTurnRiverRaiseInLightningOn,
} from './HorseOmahaPricedWiring.js';
import { OMAHA_OPTION_CLASSES } from './HorseOmahaRuleSites.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import {
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForGates,
  omahaTurnRiverRaiseInLightningGateCandidates,
} from './horseDecision/responseValidation.js';

const DIR = resolve(process.cwd(), 'src/engine/horseComplaints');
const FX = JSON.parse(
  readFileSync(
    resolve(DIR, 'plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json'),
    'utf8'
  )
) as ComplaintFixture;
const LIVE = replayProfiles('cash').find((p) => p.live)!;

const SUIT_MAP: Record<string, CardSuit> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

function cards(str: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < str.length; i += 2) {
    out.push({ rank: str[i] as CardRank, suit: SUIT_MAP[str[i + 1]!]! });
  }
  return out;
}

function buildSpot(lightning: boolean, hole: string | null = '4h5h2d6cJs') {
  const copy = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
  const node = copy.actions.find((a) => a.ord === 19)!;
  if (hole) copy.hole[String(node.seat)] = cards(hole);
  const st = stateAt(copy, node);
  if (lightning) {
    (st.gs as unknown as { publicMemoryDomain: object }).publicMemoryDomain = {
      version: 1,
      speed: 'lightning',
      ante: 'bb',
    };
  }
  return st;
}

describe('LAW: omahaTurnRiverRaiseIsPricedInLightning opens Lightning strictly to omahaTurnRiverRaiseIsPriced', () => {
  it('is registered default OFF, game-scopable, and classed priced in RuleSites', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaTurnRiverRaiseIsPricedInLightning');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaTurnRiverRaiseIsPricedInLightning');
    expect(OMAHA_OPTION_CLASSES.omahaTurnRiverRaiseIsPricedInLightning?.cls).toBe('priced');
  });

  it('opens ownership in Lightning ONLY when both omahaTurnRiverRaiseIsPriced and the scope option are true, with zero blast radius on omahaPricedInScope', () => {
    const pool = buildSpot(true);
    const table = buildSpot(false);

    // OFF (unset or false): Lightning is NOT owned
    expect(omahaTurnRiverRaiseInLightningOn({})).toBe(false);
    expect(
      omahaPricedOwnsTurnRiverRaise(pool.hero, pool.gs, { omahaTurnRiverRaiseIsPriced: true })
    ).toBe(false);
    expect(
      omahaPricedOwnsTurnRiverRaise(pool.hero, pool.gs, {
        omahaTurnRiverRaiseIsPriced: true,
        omahaTurnRiverRaiseIsPricedInLightning: false,
      })
    ).toBe(false);

    // Alone without omahaTurnRiverRaiseIsPriced: owns nothing
    expect(
      omahaPricedOwnsTurnRiverRaise(pool.hero, pool.gs, {
        omahaTurnRiverRaiseIsPricedInLightning: true,
      })
    ).toBe(false);

    // Both ON in Lightning: owns turn/river raise (so #2 omahaRiverNutRaiseOnly stands aside)
    const narrowOn: HorseDecideOpts = {
      omahaTurnRiverRaiseIsPriced: true,
      omahaTurnRiverRaiseIsPricedInLightning: true,
    };
    expect(omahaPricedOwnsTurnRiverRaise(pool.hero, pool.gs, narrowOn)).toBe(true);

    // ZERO BLAST RADIUS: omahaPricedInScope stays false for every other priced rule in Lightning!
    expect(omahaPricedInScope(pool.hero, pool.gs, narrowOn)).toBe(false);
    expect(omahaPricedInScope(pool.hero, pool.gs, { omahaPricedInLightning: true })).toBe(true);

    // Table untouched
    expect(omahaPricedOwnsTurnRiverRaise(table.hero, table.gs, narrowOn)).toBe(true);
  });

  it('fires omaha_turn_river_raise_in_lightning and prices the Lightning decision; OFF is byte-identical; non-PLO4/5 games untouched', () => {
    const run = (lightning: boolean, opts: HorseDecideOpts, variantOverride?: string) => {
      const st = buildSpot(lightning, null);
      if (variantOverride) st.gs.gameVariant = variantOverride as HorseGameStateV2['gameVariant'];
      enableBrainTelemetry();
      drainFires();
      HorseMind.reset();
      seedFastRandom(7);
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        mind: false,
        telemetry: true,
        ...opts,
      });
      const fires = drainFires().map((f) => f.feature);
      return { action: d.action, amount: d.amount, fires };
    };

    const offUnset = run(true, { omahaTurnRiverRaiseIsPriced: true });
    const offFalse = run(true, {
      omahaTurnRiverRaiseIsPriced: true,
      omahaTurnRiverRaiseIsPricedInLightning: false,
    });
    expect(offFalse).toEqual(offUnset);
    expect(offUnset.fires).not.toContain('omaha_turn_river_raise_in_lightning');

    // ON in Lightning: fires omaha_turn_river_raise_in_lightning and matches table priced turn/river raise
    const onPool = run(true, {
      omahaTurnRiverRaiseIsPriced: true,
      omahaTurnRiverRaiseIsPricedInLightning: true,
    });
    expect(onPool.fires).toContain('omaha_turn_river_raise_in_lightning');
    expect(onPool.fires.some((f) => f.startsWith('omaha_priced_raise_'))).toBe(true);

    // On a regular table: narrow receipt never fires and decision is identical
    const onTableOff = run(false, { omahaTurnRiverRaiseIsPriced: true });
    const onTableOn = run(false, {
      omahaTurnRiverRaiseIsPriced: true,
      omahaTurnRiverRaiseIsPricedInLightning: true,
    });
    expect({ action: onTableOn.action, amount: onTableOn.amount }).toEqual({
      action: onTableOff.action,
      amount: onTableOff.amount,
    });
    expect(onTableOn.fires).not.toContain('omaha_turn_river_raise_in_lightning');

    // Out-of-scope variants (PLO6, PLO8, NLH, tournament) stay untouched
    for (const v of ['plo6', 'plo8', 'nlh']) {
      const st = buildSpot(true);
      st.gs.gameVariant = v as HorseGameStateV2['gameVariant'];
      expect(
        omahaPricedOwnsTurnRiverRaise(st.hero, st.gs, {
          omahaTurnRiverRaiseIsPriced: true,
          omahaTurnRiverRaiseIsPricedInLightning: true,
        }),
        v
      ).toBe(false);
    }
    const tourney = buildSpot(true);
    tourney.gs.gameMode = 'tournament';
    expect(
      omahaPricedOwnsTurnRiverRaise(tourney.hero, tourney.gs, {
        omahaTurnRiverRaiseIsPriced: true,
        omahaTurnRiverRaiseIsPricedInLightning: true,
      })
    ).toBe(false);
  });

  it('receipt validator admits Lightning raise -> call ONLY under omahaTurnRiverRaiseIsPricedInLightning (or omahaPricedInLightning)', () => {
    const real = buildSpot(false, null);
    seedFastRandom(7);
    HorseMind.reset();
    const d = structuredClone(
      HorseLogic.decide(real.hero, real.gs, LIVE.style, LIVE.mods, {
        mind: false,
        telemetry: false,
        omahaBeatenMadeHandDefense: true,
      })
    ) as HorseDecision;
    expect({ action: d.action, amount: d.amount }).toEqual({ action: 'call', amount: 212 });

    const pool = buildSpot(true);
    expect(omahaNutClassNow(pool.hero, pool.gs)).toBe(false);
    const ctx = { player: pool.hero, gameState: pool.gs };

    // Refused without Lightning gate
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { ...ctx, omahaPricedRaise: true })
    ).toBe('policy_graph');
    // Admitted with omahaTurnRiverRaiseIsPricedInLightning + omahaPricedRaise
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaPricedRaise: true,
        omahaTurnRiverRaiseIsPricedInLightning: true,
      })
    ).toBeNull();
    // Alone without omahaPricedRaise: still refused
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
        ...ctx,
        omahaTurnRiverRaiseIsPricedInLightning: true,
      })
    ).toBe('policy_graph');

    // Candidate gates
    expect(
      horseDecisionReceiptRefusalForGates(
        structuredClone(d),
        'plo5',
        ctx,
        [false],
        [true],
        [false],
        [false],
        [false],
        [false],
        [false],
        [false]
      )
    ).toBe('policy_graph');
    expect(
      horseDecisionReceiptRefusalForGates(
        structuredClone(d),
        'plo5',
        ctx,
        [false],
        [true],
        [false],
        [false],
        [false],
        [false],
        [false],
        [false, true]
      )
    ).toBeNull();

    expect(omahaTurnRiverRaiseInLightningGateCandidates(undefined, null)).toEqual([false]);
    expect(
      omahaTurnRiverRaiseInLightningGateCandidates(
        { omahaTurnRiverRaiseIsPricedInLightning: true },
        null
      )
    ).toEqual([true]);
    expect(
      omahaTurnRiverRaiseInLightningGateCandidates(
        { omahaTurnRiverRaiseIsPricedInLightning: 1 },
        null
      )
    ).toEqual([false]);
  });
});
